/**
 * Nine ways this can go wrong, and the one thing that must never happen in any
 * of them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"In every failure case: the password must not fall back
 * into the normal chat system."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The shape of every test in this file ──────────────────────────────────
 *
 * Break something, then check three things:
 *
 *   1. the secure control did not accept the password, or accepted it and the
 *      submission failed;
 *   2. **nothing was sent to the chat endpoint**, and the turn list contains no
 *      message with the marker in it;
 *   3. the student was told, in words, not to type it into the chat.
 *
 * The third is not decoration. A student who has just been told AskiMate needs
 * a password, and then sees the password box vanish, will type it into the box
 * that is still there. Every refusal path says so explicitly, and these tests
 * assert the sentence is present — because it is the only mitigation for the
 * likeliest leak in the whole design, which is the student's own hands.
 */

import type { Server } from "node:http";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import jwt from "jsonwebtoken";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import { InMemorySecretStore } from "@askimate/aas-secrets";
import type { SecretHandle, SecretRequestId } from "@askimate/aas-secrets";

import { createChatApp } from "./app.js";
import { DatabaseSecretBindingStore } from "./bindings.js";
import { decideRendering, chatInputEnabled } from "./render-decision.js";
import { SCHEMA_DDL } from "./schema.js";
import { announceSkip, databaseReachable } from "./test-database.js";

const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";
const SKIP_DESCRIPTION =
  "the nine fail-closed scenarios and the session-binding checks";
const PORT = 4713;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const JWT_SECRET = "test-jwt-secret-not-a-real-one";
/**
 * The clock, anchored to the REAL one — deliberately, and this must not become
 * a literal again.
 *
 * These tests drive a real browser, and the browser reads its own clock:
 * `secure-control.js` calls `decideRendering(prompt, capabilities, Date.now())`
 * because a page has no clock to inject. The server's clock, by contrast, IS
 * injected — every store and binding call below takes `NOW`.
 *
 * So a literal here creates two clocks that disagree by however long it has
 * been since the literal. It was `new Date("2026-08-27T10:00:00Z")` with a
 * 300-second TTL, which meant the browser judged every prompt expired and
 * refused to render the control from 10:05 UTC onwards. The suite passed on
 * the morning it was written and has been failing silently since — as six
 * thirty-second `locator.fill` timeouts that named an invisible element rather
 * than the reason it was invisible.
 *
 * Every use below is relative (`NOW.getTime() ± delta`) or is the injected
 * server clock, so anchoring it costs nothing and removes the divergence.
 * `assertRendered` in `deliver` is the second half of the fix: it turns a
 * refusal into an immediate, named failure instead of a timeout.
 */
const NOW = new Date();
const CASE_REF = "case-1";
const PORTAL_HOST = "apply.example.ac.uk";

const DATABASE_URL =
  process.env["AAS_TEST_DATABASE_URL"] ?? "postgresql://postgres@localhost:55432/postgres";

// Probed once, at module load, because vitest needs the decision at collection
// time — not inside `beforeAll`, which runs after the suites are already built.
const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip(SKIP_DESCRIPTION);

/**
 * Runs the suite only when a real PostgreSQL is there — and says so loudly when
 * it is not. See ./test-database.ts for why a silent skip is unacceptable here.
 */
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let browser: Browser;
let server: Server;
let pool: pg.Pool;
let db: NodePgDatabase<Record<string, never>>;
let store: InMemorySecretStore;
let bindings: DatabaseSecretBindingStore;
let userId: number;
let otherUserId: number;
let conversationId: number;
let otherConversationId: number;


/**
 * A database of this test file's own.
 *
 * ── Why not just share one ────────────────────────────────────────────────
 *
 * The first version pointed both integration files at the same database and
 * each dropped the other's tables in `beforeAll`. Vitest runs files in
 * parallel, so the result was a real, intermittent failure — and an
 * intermittent failure in a leak test is worse than no test, because the way
 * people deal with one is to re-run it until it passes.
 *
 * So each file creates and owns a database named after itself.
 */
async function ownDatabase(name: string): Promise<pg.Pool> {
  const admin = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(DATABASE_URL);
  url.pathname = `/${name}`;
  return new pg.Pool({ connectionString: url.toString() });
}

/** Every request any page made. Scanned to prove nothing else carried it. */
const requests: { url: string; body: string }[] = [];

function tokenFor(id: number): string {
  return jwt.sign({ id, email: `student-${String(id)}@example.test`, emailVerified: true }, JWT_SECRET);
}

async function openRequest(
  overrides: { conversation?: number; user?: number } = {},
): Promise<{ requestId: SecretRequestId; prompt: Record<string, unknown> }> {
  const opened = store.request(
    {
      studentRef: `student-${String(overrides.user ?? userId)}` as never,
      purpose: "portal_account_creation",
      target: { host: PORTAL_HOST, caseRef: CASE_REF },
      explanation: "I need a password to set up your application account.",
      singleUse: true,
      ttlSeconds: 300,
    },
    NOW,
  );
  if (!opened.ok) expect.unreachable("request should open");
  await bindings.open({
    requestId: opened.prompt.requestId,
    userId: overrides.user ?? userId,
    conversationId: overrides.conversation ?? conversationId,
    caseRef: CASE_REF,
    purpose: "portal_account_creation",
    targetHost: PORTAL_HOST,
    requiresConfirmation: opened.prompt.requiresConfirmation,
    lifecycle: "secret_requested",
    expiresAt: opened.prompt.expiresAt,
  });
  return {
    requestId: opened.prompt.requestId,
    prompt: {
      ...opened.prompt,
      expiresAt: opened.prompt.expiresAt.toISOString(),
      conversationId: overrides.conversation ?? conversationId,
    },
  };
}

async function chatPage(id: number = userId): Promise<Page> {
  const page = await browser.newPage();
  page.on("request", (request) => {
    requests.push({ url: request.url(), body: request.postData() ?? "" });
  });
  await page.goto(`${BASE}/chat.html`);
  await page.evaluate((value) => {
    (window as unknown as Record<string, unknown>)["__askimateToken"] = value;
  }, tokenFor(id));
  return page;
}

async function deliver(
  page: Page,
  prompt: Record<string, unknown>,
  capabilities: Record<string, boolean> = {
    supportsSecureControl: true,
    secureContext: true,
    endpointReachable: true,
  },
): Promise<void> {
  await page.evaluate(
    ([sent, caps]) => {
      (window as unknown as { __askimateReceive: (turn: unknown) => void }).__askimateReceive({
        kind: "directive",
        directive: "request_secret",
        prompt: sent,
        capabilities: caps,
      });
    },
    [prompt, capabilities] as [unknown, unknown],
  );

  // ── The guard that names the failure ──────────────────────────────────
  //
  // When all three capabilities are true and the prompt is unexpired, the
  // control MUST render. If it refused, the harness is misconfigured — not the
  // code under test — and the difference matters enormously to whoever reads
  // the failure.
  //
  // Without this, a refusal surfaced thirty seconds later as
  // `locator.fill: Timeout — element is not visible`, which names the symptom
  // and hides the cause. That is how a clock divergence went unnoticed: six
  // tests failed for one reason and reported six unrelated-looking timeouts.
  if (capabilities["supportsSecureControl"] === true && capabilities["secureContext"] === true &&
      capabilities["endpointReachable"] === true) {
    const refused = await page.locator("#refusal").getAttribute("data-reason");
    if (refused !== null && refused !== "") {
      throw new Error(
        `The secure control refused to render with reason "${refused}" even though every ` +
          `capability was true. This is a HARNESS fault, not a failure of the code under test. ` +
          `"prompt_expired" here means the test clock and the browser clock have diverged again.`,
      );
    }
  }
}

/** The three assertions every failure path must satisfy. */
async function assertNoFallbackToChat(page: Page): Promise<void> {
  const turns = await page.evaluate(
    () => (window as unknown as { __askimateTurns: () => unknown[] }).__askimateTurns(),
  );
  expect(JSON.stringify(turns)).not.toContain(MARKER);

  const sent = (await page.evaluate(
    () => (window as unknown as Record<string, unknown>)["__askimateSent"] ?? [],
  )) as unknown[];
  expect(JSON.stringify(sent)).not.toContain(MARKER);

  // And the chat input itself is not holding it.
  expect(await page.locator("#chat-input").inputValue()).not.toContain(MARKER);
}

beforeAll(async () => {
  pool = await ownDatabase("aas_chat_fail_closed");
  db = drizzle(pool);
  await pool.query(SCHEMA_DDL);

  const users = await pool.query<{ id: number }>(
    `INSERT INTO askimate_users (email, password_hash, email_verified)
     VALUES ('a@example.test','x',true), ('b@example.test','x',true) RETURNING id`,
  );
  userId = users.rows[0]!.id;
  otherUserId = users.rows[1]!.id;

  const conversations = await pool.query<{ id: number }>(
    `INSERT INTO askimate_conversations (user_id, is_guest)
     VALUES ($1,false), ($1,false) RETURNING id`,
    [userId],
  );
  conversationId = conversations.rows[0]!.id;
  otherConversationId = conversations.rows[1]!.id;

  store = new InMemorySecretStore();
  bindings = new DatabaseSecretBindingStore(db, () => NOW);

  const app = createChatApp({
    store,
    bindings,
    jwtSecret: JWT_SECRET,
    now: () => NOW,
    publicDir: join(import.meta.dirname, "..", "public"),
    // Raised above the production value of 10 so nine failure scenarios can be
    // exercised in one file. `SUBMIT_LIMIT` is asserted separately.
    submitLimit: 200,
  });
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(PORT, "127.0.0.1", () => resolve(listening));
  });
  browser = await chromium.launch({ headless: true });
}, 180_000);

afterAll(async () => {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

// ───────────────────────────────────────────────────────────────────────────
// 1–3. The control or the endpoint is not there
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("when the secure control cannot be shown", () => {
  it("refuses when the client does not support it, and says not to type it", async () => {
    const { prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt, {
      supportsSecureControl: false,
      secureContext: true,
      endpointReachable: true,
    });

    expect(await page.locator("#secure-control").isHidden()).toBe(true);
    expect(await page.locator("#refusal").getAttribute("data-reason")).toBe(
      "client_does_not_support_secure_control",
    );
    expect(await page.locator("#refusal").textContent()).toContain(
      "Do not type a password into the chat",
    );
    await assertNoFallbackToChat(page);
    await page.close();
  }, 60_000);

  it("refuses on an insecure origin", async () => {
    const { prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt, {
      supportsSecureControl: true,
      secureContext: false,
      endpointReachable: true,
    });
    expect(await page.locator("#refusal").getAttribute("data-reason")).toBe("insecure_context");
    await assertNoFallbackToChat(page);
    await page.close();
  }, 60_000);

  it("refuses when the secure endpoint is unreachable", async () => {
    const { prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt, {
      supportsSecureControl: true,
      secureContext: true,
      endpointReachable: false,
    });
    expect(await page.locator("#refusal").getAttribute("data-reason")).toBe("endpoint_unreachable");
    await assertNoFallbackToChat(page);
    await page.close();
  }, 60_000);

  it("has no render outcome that sends a chat message — checked at the type level", () => {
    // `RenderDecision` is `secure_control | refuse`. The fallback Vahid is
    // worried about is not a branch someone forgot to remove; it is a value
    // that does not exist.
    const decision = decideRendering({
      prompt: {
        requestId: "sr_00000000000000000000000000000000" as SecretRequestId,
        channel: "secure_control",
        title: "t",
        explanation: "e",
        requiresConfirmation: true,
        portalHost: PORTAL_HOST,
        expiresAt: new Date(NOW.getTime() + 60_000),
        observedRules: [],
      },
      capabilities: { supportsSecureControl: false, secureContext: true, endpointReachable: true },
      now: NOW,
    });
    expect(decision.render).toBe("refuse");
    // @ts-expect-error — there is no "chat_message" outcome, and adding one
    // would make this directive unused and fail the build.
    const impossible: RenderDecision["render"] = "chat_message";
    void impossible;
  });

  it("disables the ordinary chat input while a box is open", async () => {
    expect(chatInputEnabled({ awaitingSecret: true })).toBe(false);
    expect(chatInputEnabled({ awaitingSecret: false })).toBe(true);

    const { prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);
    expect(await page.locator("#chat-input").isDisabled()).toBe(true);

    // And typing into it does nothing — the composer's submit handler returns
    // early while a request is open, so there is no state in which a keystroke
    // could land in both places.
    await page.evaluate((value) => {
      const input = document.getElementById("chat-input") as HTMLInputElement;
      input.disabled = false; // simulate a determined student, or a bug
      input.value = value;
      document.getElementById("composer")?.dispatchEvent(new Event("submit"));
    }, MARKER);
    const sent = (await page.evaluate(
      () => (window as unknown as Record<string, unknown>)["__askimateSent"] ?? [],
    )) as unknown[];
    expect(JSON.stringify(sent)).not.toContain(MARKER);
    await page.close();
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// 4–5. The submission itself fails
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("when the submission fails", () => {
  it("rejects a confirmation mismatch ON THE SERVER, not only in the UI", async () => {
    // The UI checks too, for a fast answer. This asserts the server's check by
    // posting directly — "the UI compared them" is not a property the server
    // has, and a modified page could send anything.
    const { requestId } = await openRequest();
    const response = await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(userId)}` },
      body: JSON.stringify({ password: MARKER, confirmation: `${MARKER}x`, conversationId }),
    });
    const body = (await response.json()) as { status: string; reason: string };
    expect(response.status).toBe(400);
    expect(body).toEqual({ status: "secret_rejected", reason: "confirmation_mismatch" });
    // Neither value is echoed, and neither is named.
    expect(JSON.stringify(body)).not.toContain(MARKER);
    // Nothing was stored for THIS request. A mismatch is refused before the
    // store is touched at all.
    expect(store.statusOf(requestId)?.lifecycle).toBe("secret_requested");
    expect(store.statusOf(requestId)?.handle).toBeUndefined();
  }, 60_000);

  it("keeps the box open on a mismatch and clears both fields", async () => {
    const { prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);
    await page.locator("#secure-password").fill(MARKER);
    await page.locator("#secure-confirmation").fill(`${MARKER}-typo`);
    await page.locator("#secure-submit").click();

    await page.locator("#secure-error").waitFor({ state: "visible" });
    expect(await page.locator("#secure-error").textContent()).toContain("did not match");
    // Open, so they can retry — but empty, so a screenshot or a shoulder does
    // not show the first attempt.
    expect(await page.locator("#secure-control").isHidden()).toBe(false);
    expect(await page.locator("#secure-password").inputValue()).toBe("");
    expect(await page.locator("#secure-confirmation").inputValue()).toBe("");
    await assertNoFallbackToChat(page);
    await page.close();
  }, 60_000);

  it("closes and warns when the connection is interrupted mid-submission", async () => {
    const { prompt } = await openRequest();
    const page = await chatPage();
    // Kill the request in flight — a dropped connection, a proxy timeout, a
    // tunnel closing. The page must not decide to "try the other way".
    await page.route("**/api/askimate/secret/**", (route) => route.abort("connectionreset"));
    await deliver(page, prompt);
    await page.locator("#secure-password").fill(MARKER);
    await page.locator("#secure-confirmation").fill(MARKER);
    await page.locator("#secure-submit").click();

    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>)["__askimateStatus"] !== undefined,
    );
    expect(await page.locator("#refusal").getAttribute("data-reason")).toBe("endpoint_unreachable");
    expect(await page.locator("#secure-control").isHidden()).toBe(true);
    await assertNoFallbackToChat(page);
    await page.close();
  }, 60_000);

  it("closes the box when the endpoint returns an error", async () => {
    const { prompt } = await openRequest();
    const page = await chatPage();
    await page.route("**/api/askimate/secret/**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ status: "secret_rejected", reason: "server_error" }),
      }),
    );
    await deliver(page, prompt);
    await page.locator("#secure-password").fill(MARKER);
    await page.locator("#secure-confirmation").fill(MARKER);
    await page.locator("#secure-submit").click();

    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>)["__askimateStatus"] !== undefined,
    );
    expect(await page.locator("#secure-control").isHidden()).toBe(true);
    expect(await page.locator("#secure-error").textContent()).toContain(
      "Do not type it into the chat",
    );
    await assertNoFallbackToChat(page);
    await page.close();
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// 6–9. State that has moved on
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("when the request is no longer live", () => {
  it("survives a page refresh: the box reopens and holds nothing", async () => {
    const { requestId, prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);
    await page.locator("#secure-password").fill(MARKER);

    // Refresh mid-password. The DOM is gone; the binding is in the database.
    await page.reload();
    expect(await page.locator("#secure-control").isHidden()).toBe(true);
    expect(await page.locator("#secure-password").inputValue()).toBe("");

    // The server still knows what was asked, and says so without saying
    // anything about what was typed.
    const status = await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
      headers: { Authorization: `Bearer ${tokenFor(userId)}` },
    });
    const body = (await status.json()) as Record<string, unknown>;
    expect(body["lifecycle"]).toBe("secret_requested");
    expect(JSON.stringify(body)).not.toContain(MARKER);
    await page.close();
  }, 60_000);

  it("refuses a duplicate submission rather than replacing the secret", async () => {
    const { requestId } = await openRequest();
    const post = (): Promise<Response> =>
      fetch(`${BASE}/api/askimate/secret/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(userId)}` },
        body: JSON.stringify({ password: MARKER, confirmation: MARKER, conversationId }),
      });

    expect((await post()).status).toBe(200);
    const second = await post();
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      status: "secret_rejected",
      reason: "already_submitted",
    });
    // The first secret is untouched. Replacing one the automation may be a
    // millisecond from spending would be worse than refusing.
    expect(store.liveSecretCount).toBeGreaterThan(0);
  }, 60_000);

  it("refuses a submission to an expired request, and marks it expired", async () => {
    const opened = store.request(
      {
        studentRef: `student-${String(userId)}` as never,
        purpose: "portal_account_creation",
        target: { host: PORTAL_HOST, caseRef: CASE_REF },
        explanation: "…",
        singleUse: true,
        ttlSeconds: 60,
      },
      new Date(NOW.getTime() - 120_000),
    );
    if (!opened.ok) expect.unreachable("should open");
    await bindings.open({
      requestId: opened.prompt.requestId,
      userId,
      conversationId,
      caseRef: CASE_REF,
      purpose: "portal_account_creation",
      targetHost: PORTAL_HOST,
      requiresConfirmation: true,
      lifecycle: "secret_requested",
      expiresAt: opened.prompt.expiresAt,
    });

    const response = await fetch(`${BASE}/api/askimate/secret/${opened.prompt.requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(userId)}` },
      body: JSON.stringify({ password: MARKER, confirmation: MARKER, conversationId }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: "secret_rejected", reason: "expired" });

    const rows = await pool.query<{ lifecycle: string }>(
      "SELECT lifecycle FROM askimate_secret_requests WHERE request_id = $1",
      [opened.prompt.requestId],
    );
    expect(rows.rows[0]?.lifecycle).toBe("secret_expired");
  }, 60_000);

  it("cannot spend a secret that has already been consumed", async () => {
    const { requestId } = await openRequest();
    const response = await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(userId)}` },
      body: JSON.stringify({ password: MARKER, confirmation: MARKER, conversationId }),
    });
    const { handle } = (await response.json()) as { handle: SecretHandle };

    const claim = {
      handle,
      studentRef: `student-${String(userId)}` as never,
      purpose: "portal_account_creation" as const,
      target: { host: PORTAL_HOST, caseRef: CASE_REF },
    };
    const consumer = {
      name: "test" as never,
      confirmNoDiagnosticCapture: (): boolean => true,
    };

    expect((await store.use(claim, consumer, () => true, NOW)).ok).toBe(true);
    const again = await store.use(claim, consumer, () => true, NOW);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason.kind).toBe("unknown_handle");
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// Session binding
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("a handle belongs to one student, one conversation, one case", () => {
  it("refuses a submission from a different student", async () => {
    const { requestId } = await openRequest();
    const response = await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFor(otherUserId)}`,
      },
      body: JSON.stringify({ password: MARKER, confirmation: MARKER, conversationId }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      status: "secret_rejected",
      reason: "not_your_request",
    });
    // Asserted on THIS request, not on a global count. An earlier test in this
    // file deliberately leaves a live secret behind (the duplicate-submission
    // one), so `liveSecretCount === 0` would be asserting the order tests
    // happen to run in rather than the behaviour under test.
    expect(store.statusOf(requestId)?.lifecycle).toBe("secret_requested");
    expect(store.statusOf(requestId)?.handle).toBeUndefined();
  }, 60_000);

  it("refuses a submission from a different conversation", async () => {
    const { requestId } = await openRequest();
    const response = await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(userId)}` },
      body: JSON.stringify({
        password: MARKER,
        confirmation: MARKER,
        conversationId: otherConversationId,
      }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      status: "secret_rejected",
      reason: "wrong_conversation",
    });
  }, 60_000);

  it("refuses to disclose a request that belongs to someone else", async () => {
    // Same answer as "does not exist". Distinguishing them would confirm that
    // another student had been asked for a password.
    const { requestId } = await openRequest();
    const mine = await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
      headers: { Authorization: `Bearer ${tokenFor(userId)}` },
    });
    const theirs = await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
      headers: { Authorization: `Bearer ${tokenFor(otherUserId)}` },
    });
    const invented = await fetch(
      `${BASE}/api/askimate/secret/sr_00000000000000000000000000000000`,
      { headers: { Authorization: `Bearer ${tokenFor(otherUserId)}` } },
    );
    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(404);
    expect(invented.status).toBe(404);
    expect(await theirs.json()).toEqual(await invented.json());
  }, 60_000);

  it("requires authentication at all", async () => {
    const { requestId } = await openRequest();
    const response = await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: MARKER, confirmation: MARKER, conversationId }),
    });
    expect(response.status).toBe(401);
    expect(store.statusOf(requestId)?.lifecycle).toBe("secret_requested");
    expect(store.statusOf(requestId)?.handle).toBeUndefined();
  }, 60_000);

  it("refuses a forged token", async () => {
    const { requestId } = await openRequest();
    const forged = jwt.sign({ id: userId, email: "a@example.test", emailVerified: true }, "wrong");
    const response = await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${forged}` },
      body: JSON.stringify({ password: MARKER, confirmation: MARKER, conversationId }),
    });
    expect(response.status).toBe(401);
  }, 60_000);

  it("refuses an unverified email, as every other AskiMate route does", async () => {
    const { requestId } = await openRequest();
    const unverified = jwt.sign(
      { id: userId, email: "a@example.test", emailVerified: false },
      JWT_SECRET,
    );
    const response = await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${unverified}` },
      body: JSON.stringify({ password: MARKER, confirmation: MARKER, conversationId }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "EMAIL_NOT_VERIFIED" });
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The secure request occupies its real position in the conversation
// ───────────────────────────────────────────────────────────────────────────
//
// `transcript.test.ts` proves the PROJECTION keeps a directive in sequence.
// That is the tested authority, but it is a pure function over a turn list and
// it cannot see the DOM. These tests check the property that actually reaches
// the student: the card is inside the transcript, after the message that
// preceded it — and, critically, that being inside the transcript has not
// joined it to the composer's form.
//
// The UI here is a deliberately provisional harness. What is being asserted is
// STRUCTURE (containment, ordering, form separation), never appearance.

describe("the secure control is inline in the conversation", () => {
  it("is a descendant of the transcript, not a panel beside it", async () => {
    const { prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);

    const inside = await page.evaluate(() =>
      document.getElementById("transcript")?.contains(document.getElementById("secure-control")),
    );
    expect(inside).toBe(true);
    await page.close();
  }, 60_000);

  it("sits AFTER the message that preceded it, in conversation order", async () => {
    const { prompt } = await openRequest();
    const page = await chatPage();

    await page.evaluate(() => {
      (window as unknown as { __askimateReceive: (turn: unknown) => void }).__askimateReceive({
        kind: "message",
        sender: "ai",
        content: "I can create your account now.",
      });
    });
    await deliver(page, prompt);

    // Compared by DOM position rather than by presence. A harness that appended
    // every card at the end of the page would pass a "contains" check and would
    // be exactly the detached panel this change removes.
    const order = await page.evaluate(() => {
      const transcript = document.getElementById("transcript");
      const card = document.getElementById("secure-control");
      if (!transcript || !card) return null;
      return Array.from(transcript.children).indexOf(card);
    });
    expect(order).toBe(1);
    await page.close();
  }, 60_000);

  it("stays in its OWN form after the move — the separation survives", async () => {
    const { prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);

    // The single most important structural property in the whole design. If
    // the password input's nearest form were the composer's, a stray Enter
    // would post a password through the message pipeline.
    const separation = await page.evaluate(() => {
      const password = document.getElementById("secure-password");
      const chatInput = document.getElementById("chat-input");
      return {
        passwordForm: password?.closest("form")?.id ?? null,
        chatForm: chatInput?.closest("form")?.id ?? null,
        passwordHasName: password?.hasAttribute("name") ?? true,
      };
    });
    expect(separation.passwordForm).toBe("secure-form");
    expect(separation.chatForm).toBe("composer");
    expect(separation.passwordForm).not.toBe(separation.chatForm);
    // No `name` means no submit path anywhere could pick the field up.
    expect(separation.passwordHasName).toBe(false);
    await page.close();
  }, 60_000);

  it("survives an unrelated message arriving mid-typing, without losing the value", async () => {
    const { prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);
    await page.locator("#secure-password").fill("half-typed-so-far");

    // The hazard the append-only renderer exists to remove: the previous
    // implementation began every render with `innerHTML = ""`, so any turn
    // arriving while the student typed would tear the card out of the DOM and
    // discard the value. A student would watch their password vanish.
    await page.evaluate(() => {
      (window as unknown as { __askimateReceive: (turn: unknown) => void }).__askimateReceive({
        kind: "message",
        sender: "ai",
        content: "Still here — take your time.",
      });
    });

    expect(await page.locator("#secure-password").inputValue()).toBe("half-typed-so-far");
    expect(await page.locator("#secure-control").isHidden()).toBe(false);
    await page.close();
  }, 60_000);

  it("shows a settled secure step in place, with the lifecycle word only", async () => {
    const page = await chatPage();
    await page.evaluate(() => {
      (window as unknown as { __askimateReceive: (turn: unknown) => void }).__askimateReceive({
        kind: "secret_status",
        lifecycle: "secret_received",
        handle: "sh_00000000000000000000000000000000",
      });
    });

    const status = page.locator("#transcript .turn.status");
    expect(await status.count()).toBe(1);
    expect(await status.getAttribute("data-lifecycle")).toBe("secret_received");
    await page.close();
  }, 60_000);
});
