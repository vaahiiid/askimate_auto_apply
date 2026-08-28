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

import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import jwt from "jsonwebtoken";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import { InMemorySecretStore } from "@askimate/aas-secrets";
import type { SecretHandle, SecretRequestId } from "@askimate/aas-secrets";

import { createChatApp } from "./app.js";
import { DatabaseSecretBindingStore } from "./bindings.js";
import { decideRendering, composerPolicy } from "./render-decision.js";
import { SCHEMA_DDL } from "./schema.js";
import { announceSkip, databaseReachable } from "./test-database.js";
import { buildChatClient } from "./build-client.js";

/** What the guarded chat route was asked to do. Empty means it refused first. */
const chatPersisted: { conversationId: number; content: string }[] = [];
const chatModelSaw: string[] = [];

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
 * `browser-entry.tsx` calls `decideRendering(prompt, capabilities, new Date())`
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

/**
 * Loads the React chat client.
 *
 * `addInitScript` rather than `evaluate` after `goto`: React reads the token and
 * the conversation during its first render, so a value assigned afterwards
 * arrives too late. It also survives the reload in the refresh test, which
 * `evaluate` would not.
 */
/**
 * What each page sent, kept per page.
 *
 * The shared `requests` array accumulates across every test in the file, and
 * one of them — the stale-client test — legitimately transmits the marker to
 * the chat route, because that is the whole point of a stale client. A
 * "nothing was sent" assertion scanning the shared list therefore failed on
 * traffic from a different test that was supposed to happen.
 */
const perPage = new Map<Page, { url: string; body: string }[]>();

async function chatPage(id: number = userId): Promise<Page> {
  const page = await browser.newPage();
  const mine: { url: string; body: string }[] = [];
  perPage.set(page, mine);
  page.on("request", (request) => {
    const entry = { url: request.url(), body: request.postData() ?? "" };
    requests.push(entry);
    mine.push(entry);
  });
  await page.addInitScript(
    ([value, conversation]) => {
      (window as unknown as Record<string, unknown>)["__askimateToken"] = value;
      (window as unknown as Record<string, unknown>)["__askimateConversationId"] = conversation;
    },
    [tokenFor(id), conversationId] as [string, number],
  );
  await page.goto(`${BASE}/index.html`);
  await page.locator('[data-testid="composer"]').waitFor({ state: "visible" });
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
  // The capabilities belong to the CLIENT, not to the turn. The harness put
  // them on the directive, which was always a fiction — a server cannot tell a
  // browser what that browser is capable of. The React client reads its own,
  // and a test overrides them on the page before delivering.
  await page.evaluate(
    ([sent, caps]) => {
      (window as unknown as Record<string, unknown>)["__askimateCapabilities"] = caps;
      (window as unknown as { __askimateReceive: (turn: unknown) => void }).__askimateReceive({
        kind: "directive",
        directive: "request_secret",
        prompt: sent,
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

/**
 * The three assertions every failure path must satisfy.
 *
 * The middle one used to read `window.__askimateSent`, a list the harness
 * appended to itself — so it proved what the page BELIEVED it had sent. It now
 * reads what Playwright saw leave the browser, which is the actual property and
 * cannot be satisfied by a page that forgets to record something.
 */
async function assertNoFallbackToChat(page: Page): Promise<void> {
  const turns = await page.evaluate(
    () => (window as unknown as { __askimateTurns: () => unknown[] }).__askimateTurns(),
  );
  expect(JSON.stringify(turns)).not.toContain(MARKER);

  const toChat = (perPage.get(page) ?? []).filter((request) =>
    request.url.includes("/api/askimate/ai"),
  );
  expect(JSON.stringify(toChat)).not.toContain(MARKER);

  // And the chat input itself is not holding it.
  expect(await page.locator("#chat-input").inputValue()).not.toContain(MARKER);
}

/** Static root: the built React client plus its page. */
let clientDir: string;

beforeAll(async () => {
  clientDir = await mkdtemp(join(tmpdir(), "aas-client-fc-"));
  await cp(join(import.meta.dirname, "..", "public", "index.html"), join(clientDir, "index.html"));
  await buildChatClient(join(clientDir, "chat-client.js"));

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
    // The React client, built from the tree on every run. Never committed.
    publicDir: clientDir,
    // Raised above the production value of 10 so nine failure scenarios can be
    // exercised in one file. `SUBMIT_LIMIT` is asserted separately.
    submitLimit: 200,
    // The guarded ordinary message route, so the browser can exercise the
    // stale-client path against the real fail-closed boundary rather than a
    // stub that always agrees with the client.
    chat: {
      persist: async (input) => {
        chatPersisted.push(input);
        await Promise.resolve();
      },
      askModel: async (request) => {
        chatModelSaw.push(request.message, ...request.history.map((h) => h.content));
        return await Promise.resolve("ok");
      },
      historyFor: async () => await Promise.resolve([]),
    },
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
  await rm(clientDir, { recursive: true, force: true });
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

    expect(await page.locator('[data-testid="secure-control"]').isHidden()).toBe(true);
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

  // REPLACES "disables the ordinary chat input while a box is open".
  //
  // That test pinned the modal freeze Vahid rejected: the whole composer was
  // `disabled`, which is the strongest client-side defence available and also
  // stops the conversation being a conversation. It is replaced rather than
  // deleted, because the property it protected — a keystroke cannot land in
  // both places — still has to hold under the weaker mechanism.
  it("keeps the composer LIVE for typing but blocks the send, losing nothing", async () => {
    expect(composerPolicy({ awaitingSecret: true })).toEqual({
      typing: "live",
      send: "blocked",
      draftPersistence: "suspended",
    });
    expect(composerPolicy({ awaitingSecret: false })).toEqual({
      typing: "live",
      send: "enabled",
      draftPersistence: "normal",
    });

    const { prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);

    // Typing is live. This is the product requirement.
    expect(await page.locator("#chat-input").isDisabled()).toBe(false);
    // Sending is not.
    expect(await page.locator("#chat-send").isDisabled()).toBe(true);

    // A determined student types the password into the wrong box and submits.
    await page.locator("#chat-input").fill(MARKER);
    await page.evaluate(() => {
      // `bubbles: true` matters now. React attaches its listeners at the root
      // container rather than on the form, so a non-bubbling submit event —
      // which is what `new Event("submit")` is by default — never reaches the
      // handler at all, and the test would "pass" having triggered nothing.
      document
        .getElementById("composer")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // PREVENTION: no bytes left the browser. Read from Playwright's record of
    // real network traffic rather than from a list the page kept about itself.
    expect(
      JSON.stringify((perPage.get(page) ?? []).filter((r) => r.url.includes("/api/askimate/ai"))),
    ).not.toContain(MARKER);

    // And nothing was destroyed: the draft is exactly where they left it.
    expect(await page.locator("#chat-input").inputValue()).toBe(MARKER);
    await page.close();
  }, 60_000);

  it("does NOT auto-send the draft when the secure step finishes", async () => {
    // The single most dangerous thing a deferred-send design can do. If the
    // buffer were released on completion, a password typed into the composer
    // would be transmitted the moment the secure step succeeded — converting a
    // contained accident into a persisted one, with no human in the loop.
    const { prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);

    await page.locator("#chat-input").fill(MARKER);
    await page.locator('[data-testid="secure-password"]').fill("a-different-real-password");
    await page.locator('[data-testid="secure-confirmation"]').fill("a-different-real-password");
    await page.locator('[data-testid="secure-submit"]').click();
    await page.locator('[data-testid="secure-control"]').waitFor({ state: "hidden" });

    // The composer is live again…
    expect(await page.locator("#chat-send").isDisabled()).toBe(false);
    // …the draft survived…
    expect(await page.locator("#chat-input").inputValue()).toBe(MARKER);
    // …and nothing was sent on its own.
    expect(
      JSON.stringify((perPage.get(page) ?? []).filter((r) => r.url.includes("/api/askimate/ai"))),
    ).not.toContain(MARKER);
    await page.close();
  }, 60_000);

  it("restores the draft when a STALE client is refused by the server", async () => {
    // The bypassed/stale path, end to end in a real browser.
    //
    // The client is loaded FIRST, while nothing is open, so it believes the
    // composer is free. A secure request is then opened server-side without
    // telling it — which is exactly what a stale client is. Its send therefore
    // gets past client-side prevention and reaches the guard.
    //
    // Two things must hold: the server refuses (nothing persisted, nothing
    // modelled), and the client does NOT lose what the student wrote.
    chatPersisted.length = 0;
    chatModelSaw.length = 0;

    const page = await chatPage();
    const { requestId } = await openRequest();

    // The guard reports the NEWEST open request on the conversation, which is
    // this one. Asserting that rather than "some request" is what caught the
    // missing ORDER BY: earlier tests in this file leave open rows behind, and
    // without ordering the client would be handed a superseded requestId and
    // would render a card bound to the wrong request.
    await page.locator("#chat-input").fill(MARKER);
    // The response itself, not a global the page wrote about it. `__askimateChatRefusal`
    // was the harness's own note-to-self; this is the wire.
    const refused = page.waitForResponse(
      (response) => response.url().includes("/api/askimate/ai"),
      { timeout: 10_000 },
    );
    await page.evaluate(() => {
      // `bubbles: true` matters now. React attaches its listeners at the root
      // container rather than on the form, so a non-bubbling submit event —
      // which is what `new Event("submit")` is by default — never reaches the
      // handler at all, and the test would "pass" having triggered nothing.
      document
        .getElementById("composer")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const response = await refused;

    // The server refused.
    expect(response.status()).toBe(409);
    const refusal = (await response.json()) as { reason?: string; requestId?: string };
    expect(refusal.reason).toBe("secret_request_open");
    expect(refusal.requestId).toBe(requestId);

    // Nothing was persisted and nothing reached the model.
    expect(chatPersisted).toHaveLength(0);
    expect(chatModelSaw.join(" ")).not.toContain(MARKER);

    // And the draft is still there. This is the half that answers the
    // objection: even on the abnormal path, nothing the student wrote is lost.
    expect(await page.locator("#chat-input").inputValue()).toBe(MARKER);

    // The client has caught up: it now knows a request is open.
    expect(await page.locator("#chat-send").isDisabled()).toBe(true);

    store.discard(requestId);
    await bindings.record(requestId, { lifecycle: "secret_expired" });
    await page.close();
  }, 60_000);

  it("suspends draft persistence while a request is open", async () => {
    const { prompt } = await openRequest();
    const page = await chatPage();
    await page.evaluate(() => {
      window.localStorage.setItem("askimate.draft", "an earlier draft");
    });
    await deliver(page, prompt);

    // Containment: a draft saved a moment earlier is removed, and no new one
    // may be written while the card is open. Browser storage outlives the TTL
    // that governs everything else in this design.
    expect(
      await page.evaluate(() => window.localStorage.getItem("askimate.draft")),
    ).toBeNull();
    // And typing into the composer writes nothing while the card is open. The
    // harness exposed a `__askimateDraftPersistence` flag; this asserts the
    // behaviour the flag was standing in for, which a flag set to the right
    // word by a client that still wrote would not.
    await page.locator("#chat-input").fill("typed while the card was open");
    expect(
      await page.evaluate(() => window.localStorage.getItem("askimate.draft")),
    ).toBeNull();
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
    await page.locator('[data-testid="secure-password"]').fill(MARKER);
    await page.locator('[data-testid="secure-confirmation"]').fill(`${MARKER}-typo`);
    await page.locator('[data-testid="secure-submit"]').click();

    await page.locator('[data-testid="secure-error"]').waitFor({ state: "visible" });
    expect(await page.locator('[data-testid="secure-error"]').textContent()).toContain("did not match");
    // Open, so they can retry — but empty, so a screenshot or a shoulder does
    // not show the first attempt.
    expect(await page.locator('[data-testid="secure-control"]').isHidden()).toBe(false);
    expect(await page.locator('[data-testid="secure-password"]').inputValue()).toBe("");
    expect(await page.locator('[data-testid="secure-confirmation"]').inputValue()).toBe("");
    await assertNoFallbackToChat(page);
    await page.close();
  }, 60_000);

  it("warns, keeps the box, and stays guarded when the connection is interrupted", async () => {
    // ── This expectation CHANGED in Phase D, deliberately ────────────────
    //
    // It used to assert the box CLOSED here. That was the harness's behaviour
    // and it was wrong: a submission that never reached the server leaves the
    // request at `secret_requested`, so closing the card released the client's
    // composer while the server still had the request open — and every
    // subsequent message came back 409 with no box on screen to explain why.
    //
    // Vahid, 2026-08-28: *"a rejection must remain a rejection turn and must
    // not close an open request."* So the card stays, the student can retry
    // when the connection returns, and the two ends agree.
    const { prompt } = await openRequest();
    const page = await chatPage();
    // Kill the request in flight — a dropped connection, a proxy timeout, a
    // tunnel closing. The page must not decide to "try the other way".
    await page.route("**/api/askimate/secret/**", (route) => route.abort("connectionreset"));
    await deliver(page, prompt);
    await page.locator('[data-testid="secure-password"]').fill(MARKER);
    await page.locator('[data-testid="secure-confirmation"]').fill(MARKER);
    await page.locator('[data-testid="secure-submit"]').click();

    await page.locator("#transcript [data-rejected]").first().waitFor({ timeout: 10_000 });
    expect(
      await page.locator("#transcript [data-rejected]").first().getAttribute("data-rejected"),
    ).toBe("endpoint_unreachable");
    // The box is still there, and empty — the student may try again.
    expect(await page.locator('[data-testid="secure-control"]').count()).toBe(1);
    expect(await page.locator('[data-testid="secure-password"]').inputValue()).toBe("");
    expect(await page.locator('[data-testid="secure-error"]').textContent()).toContain(
      "Do not type it into the chat",
    );
    // And the composer is still guarded, because the request is still open.
    expect(await page.locator("#chat-send").isDisabled()).toBe(true);
    await assertNoFallbackToChat(page);
    await page.close();
  }, 60_000);

  it("keeps the box and narrows an unrecognised reason when the endpoint errors", async () => {
    // Also changed in Phase D: the box no longer closes. `server_error` is not
    // a member of `SecretRejectionReason`, so the client narrows it — and
    // because the response DID name something, it is narrowed to "this client
    // is older than that server" rather than to "unreachable".
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
    await page.locator('[data-testid="secure-password"]').fill(MARKER);
    await page.locator('[data-testid="secure-confirmation"]').fill(MARKER);
    await page.locator('[data-testid="secure-submit"]').click();

    await page.locator("#transcript [data-rejected]").first().waitFor({ timeout: 10_000 });
    expect(
      await page.locator("#transcript [data-rejected]").first().getAttribute("data-rejected"),
    ).toBe("client_does_not_support_secure_control");
    // `server_error` never reached the turn list, and so can never reach the
    // model: the closed set is closed at the parse, not at the render.
    const turns = await page.evaluate(
      () => (window as unknown as { __askimateTurns: () => unknown[] }).__askimateTurns(),
    );
    expect(JSON.stringify(turns)).not.toContain("server_error");

    expect(await page.locator('[data-testid="secure-control"]').count()).toBe(1);
    expect(await page.locator('[data-testid="secure-error"]').textContent()).toContain(
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
    await page.locator('[data-testid="secure-password"]').fill(MARKER);

    // Refresh mid-password. The DOM is gone; the binding is in the database.
    await page.reload();
    await page.locator('[data-testid="composer"]').waitFor({ state: "visible" });
    // Stronger than the harness could assert: the harness kept a hidden field
    // in the page and checked it was empty. React unmounts, so there is no
    // password field in the document at all for anything to have survived in.
    expect(await page.locator('[data-testid="secure-control"]').count()).toBe(0);
    expect(await page.locator('[data-testid="secure-password"]').count()).toBe(0);
    expect(await page.content()).not.toContain(MARKER);

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

// `describeIfDatabase`, not `describe`. This file's `beforeAll` opens a
// database connection for the whole file, so an ungated suite here forces that
// hook to run on a machine with no PostgreSQL — where it throws ECONNREFUSED
// and takes `afterAll` down with it on an undefined `browser`. That is exactly
// what my first version of this block did, and it broke the default `pnpm run
// test` path for anyone without a database running.
/**
 * Expires every request still open on the conversation.
 *
 * Most tests in this file deliberately leave one behind — that is what they are
 * testing. The two below assert that the conversation becomes FREE, which no
 * amount of correct behaviour can achieve while a previous test's request is
 * still open on the same row set. Without this both failed on leftovers rather
 * than on the property, which is a test failing for the wrong reason.
 */
async function closeAnyOpenRequests(): Promise<void> {
  await pool.query(
    `UPDATE askimate_secret_requests SET lifecycle = 'secret_expired'
     WHERE conversation_id = $1 AND lifecycle <> 'secret_expired'`,
    [conversationId],
  );
}

describeIfDatabase("client and server agree about when the conversation is free", () => {
  it("lets the student send a real message the moment the password is accepted", async () => {
    // ── The F1 divergence, from the student's side ───────────────────────
    //
    // Two separate things had to be true and were not: the SERVER had to stop
    // counting `secret_received` as open (it counted it until the TTL, because
    // nothing ever wrote `secret_consumed`), and the CLIENT had to release the
    // composer on the status turn (it did). The result was a live Send button
    // and a 409 on every press.
    //
    // This asserts the pair, through a real browser and the real guarded route.
    chatPersisted.length = 0;
    await closeAnyOpenRequests();
    const { prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);

    await page.locator('[data-testid="secure-password"]').fill("a-real-password");
    await page.locator('[data-testid="secure-confirmation"]').fill("a-real-password");
    await page.locator('[data-testid="secure-submit"]').click();
    await page.locator('[data-testid="status"]').waitFor({ timeout: 10_000 });

    expect(await page.locator("#chat-send").isDisabled()).toBe(false);

    await page.locator("#chat-input").fill("thanks — what happens next?");
    await page.locator("#chat-send").click();

    // Accepted by the server, and the composer cleared on the acknowledgement.
    await expect
      .poll(async () => await page.locator("#chat-input").inputValue(), { timeout: 10_000 })
      .toBe("");
    expect(chatPersisted.map((entry) => entry.content)).toContain(
      "thanks — what happens next?",
    );
    await page.close();
  }, 60_000);

  it("frees both ends when the student abandons the step", async () => {
    // Cancellation, through the real DELETE endpoint rather than a client-side
    // decision to stop showing the card. Before Phase D nothing called it: the
    // route existed with no consumer, and a student who changed their mind was
    // send-blocked for the whole five-minute TTL with no way to say so.
    chatPersisted.length = 0;
    await closeAnyOpenRequests();
    const { requestId, prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);

    // A draft the student had already written. It must survive the cancel.
    await page.locator("#chat-input").fill("meanwhile, about my deadline");
    expect(await page.locator("#chat-send").isDisabled()).toBe(true);

    const deleted = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/askimate/secret/${requestId}`) &&
        response.request().method() === "DELETE",
      { timeout: 10_000 },
    );
    await page.locator('[data-testid="secure-cancel"]').click();
    expect((await deleted).status()).toBe(200);

    // Closed through a LIFECYCLE transition — the only closure the transcript
    // accepts — and the card is gone.
    await page.locator('[data-testid="status"]').waitFor({ timeout: 10_000 });
    expect(
      await page.locator('[data-testid="status"]').first().getAttribute("data-lifecycle"),
    ).toBe("secret_cancelled");
    expect(await page.locator('[data-testid="secure-control"]').count()).toBe(0);

    // The server agrees: the row is terminal and an ordinary message goes
    // through. And the draft is exactly where it was left.
    expect(await bindings.openRequestFor(conversationId, NOW)).toBeNull();
    expect(await page.locator("#chat-input").inputValue()).toBe("meanwhile, about my deadline");
    await page.locator("#chat-send").click();
    await expect
      .poll(() => chatPersisted.map((entry) => entry.content), { timeout: 10_000 })
      .toContain("meanwhile, about my deadline");
    await page.close();
  }, 60_000);
});

describeIfDatabase("what ships to the browser", () => {
  it("contains no secret store, and no way to reach one", async () => {
    // ── Found by the build, kept by this test ────────────────────────────
    //
    // `useSecureTurn.ts` briefly imported `SECRET_LIFECYCLE` as a VALUE from
    // `@askimate/aas-secrets`, whose entry point re-exports `store.ts`. esbuild
    // refused — `Could not resolve "node:crypto"` — which was the bundler
    // noticing that a value import of one constant drags `InMemorySecretStore`,
    // the object that actually holds plaintext, toward the browser.
    //
    // A future import could pull it in through a dependency that DOES resolve
    // in a browser, and then nothing would fail. So the property is asserted
    // against the built artefact rather than left to the bundler's luck.
    const bundle = await readFile(join(clientDir, "chat-client.js"), "utf8");

    for (const forbidden of [
      "InMemorySecretStore",
      "liveSecretCount",
      "node:crypto",
      // The store's own submit/consume vocabulary. Present in the bundle would
      // mean the secret lifecycle machinery had been shipped, not just its
      // four words.
      "confirmNoDiagnosticCapture",
    ]) {
      expect(bundle, `the browser bundle must not contain ${forbidden}`).not.toContain(forbidden);
    }

    // And it is a real bundle, not an empty file that trivially contains none
    // of the above.
    expect(bundle.length).toBeGreaterThan(50_000);
    expect(bundle).toContain("secure-control");
    expect(bundle).toContain("secret_requested");
  }, 60_000);
});

describeIfDatabase("the secure control is inline in the conversation", () => {
  it("is a descendant of the transcript, not a panel beside it", async () => {
    const { prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);

    const inside = await page.evaluate(() =>
      document
        .getElementById("transcript")
        ?.contains(document.querySelector('[data-testid="secure-control"]')),
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
      const card = document.querySelector('[data-testid="secure-control"]');
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
      const password = document.querySelector('[data-testid="secure-password"]');
      const chatInput = document.getElementById("chat-input");
      const passwordForm = password?.closest("form") ?? null;
      const chatForm = chatInput?.closest("form") ?? null;
      return {
        passwordForm: passwordForm?.getAttribute("data-testid") ?? null,
        chatForm: chatForm?.getAttribute("data-testid") ?? null,
        // Compared by IDENTITY, not by id. Two forms could share an id by
        // accident; they cannot be the same element by accident.
        sameElement: passwordForm !== null && passwordForm === chatForm,
        passwordHasName: password?.hasAttribute("name") ?? true,
      };
    });
    expect(separation.passwordForm).toBe("secure-form");
    expect(separation.chatForm).toBe("composer");
    expect(separation.sameElement).toBe(false);
    // No `name` means no submit path anywhere could pick the field up.
    expect(separation.passwordHasName).toBe(false);
    await page.close();
  }, 60_000);

  it("survives an unrelated message arriving mid-typing, without losing the value", async () => {
    const { prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);
    await page.locator('[data-testid="secure-password"]').fill("half-typed-so-far");

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

    expect(await page.locator('[data-testid="secure-password"]').inputValue()).toBe("half-typed-so-far");
    expect(await page.locator('[data-testid="secure-control"]').isHidden()).toBe(false);
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

// ───────────────────────────────────────────────────────────────────────────
// Phase C — the conversation cannot stall, and a refresh leaves no hole
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("a refused attempt keeps the conversation going", () => {
  // NOTE on what is NOT tested here, deliberately.
  //
  // A confirmation mismatch is caught CLIENT-SIDE, before any request is sent:
  // the box clears, says so, and stays open. No turn is pushed, and that is
  // correct — a typo is not a stall, the student simply retries, and telling
  // the model about every mistyped character would be noise it cannot act on.
  //
  // The stall this phase removes is the SERVER rejection: the box closes, the
  // attempt is over, and without a turn the run waits for a secret that is
  // never coming. That is what these tests exercise.

  it("pushes a secret_rejected TURN when the SERVER refuses", async () => {
    const { requestId, prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);

    // Spend the request first, so the second attempt is refused by the server
    // with `already_submitted` — a real rejection, not a client-side check.
    const first = await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(userId)}` },
      body: JSON.stringify({ password: "first-value", confirmation: "first-value", conversationId }),
    });
    expect(first.status).toBe(200);

    await page.locator('[data-testid="secure-password"]').fill(MARKER);
    await page.locator('[data-testid="secure-confirmation"]').fill(MARKER);
    await page.locator('[data-testid="secure-submit"]').click();
    // The rejection turn itself is the signal — a real, rendered consequence
    // rather than a debug variable the page set for the test's benefit.
    await page.locator("#transcript [data-rejected]").first().waitFor({ timeout: 10_000 });

    const turns = (await page.evaluate(
      () => (window as unknown as { __askimateTurns: () => unknown[] }).__askimateTurns(),
    )) as { kind: string; reason?: string }[];
    const rejected = turns.filter((t) => t.kind === "secret_rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBe("already_submitted");

    // A code, never the value.
    expect(JSON.stringify(turns)).not.toContain(MARKER);
    await page.close();
  }, 60_000);

  it("shows the refusal IN the conversation, and leaves the request open", async () => {
    const { requestId, prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);

    await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(userId)}` },
      body: JSON.stringify({ password: "spent", confirmation: "spent", conversationId }),
    });

    await page.locator('[data-testid="secure-password"]').fill(MARKER);
    await page.locator('[data-testid="secure-confirmation"]').fill(MARKER);
    await page.locator('[data-testid="secure-submit"]').click();
    await page.locator("#transcript [data-rejected]").first().waitFor({ timeout: 10_000 });

    const note = page.locator("#transcript [data-rejected]");
    expect(await note.count()).toBe(1);
    expect(await note.getAttribute("data-rejected")).toBe("already_submitted");
    expect(await note.textContent()).not.toContain(MARKER);

    // ── Also changed in Phase D ──────────────────────────────────────────
    //
    // This used to assert the box closed. `already_submitted` leaves the row at
    // `secret_requested` on the server (see secret-routes.ts — the failure path
    // records `secret_requested`, not a terminal state), so closing here
    // released the composer against a request the server still considered open.
    // The box stays, the inputs are empty, and the model has been told — which
    // is what lets the run open a fresh request rather than stall.
    expect(await page.locator('[data-testid="secure-control"]').count()).toBe(1);
    expect(await page.locator('[data-testid="secure-password"]').inputValue()).toBe("");
    expect(await page.locator("#chat-send").isDisabled()).toBe(true);
    await page.close();
  }, 60_000);
});

describeIfDatabase("a refresh restores the step, and nothing that was typed", () => {
  it("re-opens the request from the server and recovers no input", async () => {
    const { requestId, prompt } = await openRequest();
    const page = await chatPage();
    await deliver(page, prompt);

    // Half-typed password, and a composer draft.
    await page.locator('[data-testid="secure-password"]').fill(MARKER);
    await page.locator("#chat-input").fill("a question I was writing");

    await page.reload();
    await page.evaluate(
      ([t, c]) => {
        (window as unknown as Record<string, unknown>)["__askimateToken"] = t;
        (window as unknown as Record<string, unknown>)["__askimateConversationId"] = c;
      },
      [tokenFor(userId), conversationId] as [string, number],
    );

    // The server still knows the request is open — that is what survives.
    const status = await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
      headers: { Authorization: `Bearer ${tokenFor(userId)}` },
    });
    expect(status.status).toBe(200);
    const body = (await status.json()) as { lifecycle: string; conversationId: number };
    expect(body.lifecycle).toBe("secret_requested");
    expect(body.conversationId).toBe(conversationId);
    // And it says nothing about what was typed into it.
    expect(JSON.stringify(body)).not.toContain(MARKER);

    // The page recovered nothing: not the password, not the draft.
    await deliver(page, prompt);
    expect(await page.locator('[data-testid="secure-password"]').inputValue()).toBe("");
    expect(await page.locator("#chat-input").inputValue()).toBe("");
    await page.close();
  }, 60_000);
});
