/**
 * The whole architecture, in one real browser, across two real origins.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Do not describe work as complete if the browser has not
 * actually typed a credential into the cross-origin Secure Plane and exercised
 * the full lifecycle end-to-end."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Conversation Plane  http://127.0.0.1:4871   ← the page, the transcript
 *   Secure Plane        http://localhost:4872   ← the iframe, the password
 *
 * Two DIFFERENT origins. `127.0.0.1` and `localhost` resolve to the same host
 * and are, to a browser, different origins — which is exactly what is needed:
 * the same-origin policy applies in full, so the assertions below about what
 * the conversation page cannot reach are enforced by Chromium rather than by
 * this file's good intentions.
 *
 * Two databases as well, because the planes have separate ones (ADR-0037) and a
 * shared one would let a test pass for a reason production does not have.
 */

import type { Server } from "node:http";
import { join } from "node:path";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import pg from "pg";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import {
  ConversationEventStore,
  MIGRATIONS_DIR as CONVERSATION_MIGRATIONS,
  createConversationApp,
} from "@askimate/aas-conversation-service";
import {
  LifecycleOutbox,
  MIGRATIONS_DIR as SECURE_MIGRATIONS,
  SecureLogger,
  SecureRequestStore,
  buildSecureControl,
  createSecureApp,
  internalAppend,
} from "@askimate/aas-secure-service";
import {
  EnvelopeVault,
  InMemoryEnvelopeCache,
  LocalDataKeyProvider,
} from "@askimate/aas-secrets";

import { buildChatClient } from "./build-client.js";

const CHAT_PORT = 4871;
const SECURE_PORT = 4872;
const CHAT = `http://127.0.0.1:${String(CHAT_PORT)}`;
const SECURE = `http://localhost:${String(SECURE_PORT)}`;
const SESSION_SECRET = "two-origin-session-secret";
const CERT = "conversation-service";
/**
 * The REAL clock, for both services and the browser.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * This was a frozen `new Date("2026-08-28T10:00:00Z")`, and it was a latent
 * flaw that only surfaced when `decideRendering` was wired into the real path.
 *
 * The servers minted `expiresAt` from the frozen clock; the BROWSER compares it
 * with `Date.now()`. Two days later every secure step the tests opened was
 * already expired as far as the page was concerned — so the frame was refused
 * with `prompt_expired` and never mounted. Before the expiry check existed
 * nothing looked, and the tests passed while the timestamps were nonsense.
 *
 * Production has one real clock on both sides. So does this file now. Tests
 * that need a deterministic instant take one as an argument; nothing here needs
 * the whole world frozen.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const clock = (): Date => new Date();

/**
 * A conversation used only by tests that talk to the services directly.
 *
 * It never gets a page, so it needs no row in the conversation plane — the
 * secure plane stores the id as an opaque string and cannot read that database
 * anyway, which is the separation ADR-0037 requires.
 */
const CONVERSATION_FOR_DIRECT_TESTS = "01JBXQ8Z9WKTQ6M4H2NPT99999";
/** The credential a real browser types into the Secure Plane. */
const PASSWORD = "Tr0ub4dor-and-3-HORSE-battery!";

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the two-origin secure credential journey");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let chatPool: pg.Pool;
let securePool: pg.Pool;
let conversationStore: ConversationEventStore;
let secureStore: SecureRequestStore;
let outbox: LifecycleOutbox;
let cache: InMemoryEnvelopeCache;
let vault: EnvelopeVault;
let chatServer: Server;
let secureServer: Server;
let browser: Browser;
let clientDir: string;
let secureDir: string;
let studentId: string;
let secureLog: string[] = [];

async function freshDatabase(name: string): Promise<pg.Pool> {
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  return new pg.Pool({ connectionString: url.toString(), max: 10 });
}

let counter = 0;
async function newConversation(): Promise<string> {
  counter += 1;
  const id = `01JBXQ8Z9WKTQ6M4H2NPT${String(counter).padStart(5, "0")}`;
  await chatPool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
    id,
    studentId,
  ]);
  return id;
}

/**
 * Opens a secure request the way the orchestrator will: the Conversation
 * Service asks the Secure Service over the internal API, then records the
 * durable `secret_requested` event in its own log.
 */
async function openSecureStep(conversationId: string): Promise<string> {
  const opened = await fetch(`${SECURE}/internal/v1/secret-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-service-cert": CERT },
    body: JSON.stringify({
      studentRef: studentId,
      conversationId,
      caseRef: "case-1",
      purpose: "portal_account_creation",
      targetHost: "portal.example.ac.uk",
      title: "Choose a password for the university portal",
      explanation: "AskiMate uses it once and can never read it back.",
      ttlSeconds: 300,
    }),
  });
  expect(opened.status).toBe(201);
  const { requestId, expiresAt } = (await opened.json()) as {
    requestId: string;
    expiresAt: string;
  };
  await conversationStore.append({
    conversationId,
    event: { kind: "secret_requested", requestId, channel: "secure_control", expiresAt },
  });
  return requestId;
}

async function chatPage(
  conversationId: string,
  observe?: (page: Page) => void,
): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Before anything is requested, so a listener sees the whole page load.
  observe?.(page);
  const response = await page.request.post(`${CHAT}/dev/session`, {
    data: { subject: studentId },
    headers: { "Content-Type": "application/json" },
  });
  expect(response.status()).toBe(204);
  await page.addInitScript((id) => {
    (window as unknown as Record<string, unknown>)["__askimateDurableConversationId"] = id;
  }, conversationId);
  await page.goto(`${CHAT}/index.html`);
  await page.locator('[data-testid="composer"]').waitFor({ state: "visible" });
  await page.waitForFunction(
    () => (window as unknown as { __askimateLoaded?: () => boolean }).__askimateLoaded?.() === true,
    undefined,
    { timeout: 15_000 },
  );
  return page;
}

/** Drains the outbox, which is what a background publisher does in production. */
async function publish(now: Date = clock()): Promise<{ delivered: number; failed: number }> {
  return await outbox.publish(
    internalAppend({ baseUrl: CHAT, serviceCertificate: "secure-service" }),
    { now },
  );
}

/** Opens a secure request WITHOUT recording it in the conversation log. */
async function openSecureRequest(
  conversationId: string = CONVERSATION_FOR_DIRECT_TESTS,
): Promise<{ requestId: string; frameToken: string }> {
  const response = await fetch(`${SECURE}/internal/v1/secret-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-service-cert": CERT },
    body: JSON.stringify({
      studentRef: studentId,
      conversationId,
      caseRef: "case-1",
      purpose: "portal_account_creation",
      targetHost: "portal.example.ac.uk",
      ttlSeconds: 300,
    }),
  });
  const text = await response.text();
  expect(response.status, text).toBe(201);
  return JSON.parse(text) as { requestId: string; frameToken: string };
}

/** This plane's session cookie, as a `Cookie` header value. */
async function secureSessionCookie(requestId: string, frameToken: string): Promise<string> {
  const response = await fetch(`${SECURE}/v1/frame-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SECURE, "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ requestId, frameToken }),
  });
  expect(response.status).toBe(204);
  const value = /__Host-secure_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  expect(value, "no secure session cookie was set").toBeDefined();
  return `__Host-secure_session=${String(value)}`;
}

/** The conversation plane's session cookie, as a `Cookie` header value. */
async function chatSessionCookie(): Promise<string> {
  const response = await fetch(`${CHAT}/dev/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: studentId }),
  });
  expect(response.status).toBe(204);
  const value = /__Host-aas-session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  expect(value, "no conversation session cookie was set").toBeDefined();
  return `__Host-aas-session=${String(value)}`;
}

async function sendFromComposer(page: Page, text: string): Promise<void> {
  await page.locator("#chat-input").fill(text);
  await page.locator("#chat-send").click();
}

async function durableKinds(conversationId: string): Promise<string[]> {
  return (await conversationStore.since(conversationId, 0)).map((event) => event.kind);
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  chatPool = await freshDatabase("aas_two_origin_chat");
  securePool = await freshDatabase("aas_two_origin_secure");
  await migrate(chatPool, CONVERSATION_MIGRATIONS);
  await migrate(securePool, SECURE_MIGRATIONS);

  conversationStore = new ConversationEventStore(chatPool);
  secureStore = new SecureRequestStore(securePool);
  outbox = new LifecycleOutbox(securePool);
  cache = new InMemoryEnvelopeCache();
  vault = new EnvelopeVault(new LocalDataKeyProvider(), cache);

  const student = await chatPool.query<{ id: string }>(
    "INSERT INTO students (subject, email_verified) VALUES ('oidc-two-origin', true) RETURNING id",
  );
  studentId = student.rows[0]!.id;

  clientDir = await mkdtemp(join(tmpdir(), "aas-two-origin-chat-"));
  secureDir = await mkdtemp(join(tmpdir(), "aas-two-origin-secure-"));
  await cp(join(import.meta.dirname, "..", "public", "index.html"), join(clientDir, "index.html"));
  await buildChatClient(join(clientDir, "chat-client.js"));
  await buildSecureControl(secureDir);

  const secureApp = createSecureApp({
    store: secureStore,
    vault,
    outbox,
    now: clock,
    selfOrigin: SECURE,
    // The ONE origin permitted to embed the control document.
    parentOrigin: CHAT,
    logger: new SecureLogger((line) => secureLog.push(line)),
    authoriseService: (req) => req.header("x-service-cert") === CERT,
    assetDir: secureDir,
  });
  secureServer = await new Promise<Server>((resolve) => {
    const listening = secureApp.listen(SECURE_PORT, "127.0.0.1", () => resolve(listening));
  });

  const chatApp = createConversationApp({
    store: conversationStore,
    sessionSecret: SESSION_SECRET,
    authorise: async (subject, conversationId) => {
      const owned = await chatPool.query(
        "SELECT 1 FROM conversations WHERE id = $1 AND student_id = $2",
        [conversationId, subject],
      );
      return owned.rowCount === 1;
    },
    now: clock,
    publicDir: clientDir,
    pollIntervalMs: 150,
    heartbeatIntervalMs: 5_000,
    maxStreamMs: 30_000,
    secureOrigin: SECURE,
    authoriseService: (req) => req.header("x-service-cert") === "secure-service",
    // The conversation plane asks the secure plane for a bootstrap capability
    // over the internal API, and hands it straight to the page. It stores none.
    mintFrameToken: async (requestId) => await secureStore.mintFrameToken(requestId, clock()),
    issueSessionFor: (req) => {
      const subject = (req.body as { subject?: unknown } | undefined)?.subject;
      return typeof subject === "string" ? subject : null;
    },
  });
  chatServer = await new Promise<Server>((resolve) => {
    const listening = chatApp.listen(CHAT_PORT, "127.0.0.1", () => resolve(listening));
  });

  browser = await chromium.launch({ headless: true });
}, 240_000);

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  await browser.close();
  await new Promise<void>((resolve) => chatServer.close(() => resolve()));
  await new Promise<void>((resolve) => secureServer.close(() => resolve()));
  await chatPool.end();
  await securePool.end();
  await rm(clientDir, { recursive: true, force: true });
  await rm(secureDir, { recursive: true, force: true });
});

// ───────────────────────────────────────────────────────────────────────────
// The student journey
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("a student gives a password to the Secure Plane", () => {
  it("completes the whole journey, and the credential crosses nothing", async () => {
    secureLog = [];
    const conversation = await newConversation();
    await conversationStore.append({
      conversationId: conversation,
      event: { kind: "message", actor: "assistant", content: "I need a portal password." },
    });
    await openSecureStep(conversation);

    // Every request the page makes, recorded from BEFORE it navigates.
    // Attaching after `chatPage` resolved meant the session POST, the document,
    // the bundle, the transcript load and the stream had all already happened —
    // so "no request to the chat origin carried the password" was asserted over
    // an empty list, which is how a leak scan passes while looking at nothing.
    const urls: string[] = [];
    const bodies: string[] = [];
    const page = await chatPage(conversation, (created) => {
      created.on("request", (request) => {
        urls.push(request.url());
        bodies.push(request.postData() ?? "");
      });
    });

    // ── 1–3. The frame appears, cross-origin, at the right position ──────
    const frameElement = page.locator('[data-testid="secure-iframe"]');
    await frameElement.waitFor({ state: "attached", timeout: 20_000 });
    expect(await frameElement.getAttribute("src")).toContain(SECURE);
    // In the transcript, between the messages — not a panel beside it.
    const inTranscript = await page
      .locator('#transcript [data-testid="secure-frame"]')
      .count();
    expect(inTranscript, "the secure step is not inside the conversation").toBe(1);

    // ── 4. The bootstrap handshake completed ─────────────────────────────
    const frame = page.frameLocator('[data-testid="secure-iframe"]');
    await frame.locator('[data-testid="secure-form"]').waitFor({ timeout: 20_000 });
    // The prompt text is rendered INSIDE the frame, from the secure plane's own
    // database. It never reached the conversation plane at all.
    expect(await frame.locator('[data-testid="secure-title"]').textContent()).toContain(
      "Choose a password",
    );

    // ── 5–6. A real password, typed into the cross-origin document ───────
    await frame.locator('[data-testid="secure-password"]').fill(PASSWORD);
    await frame.locator('[data-testid="secure-confirmation"]').fill(PASSWORD);
    await frame.locator('[data-testid="secure-submit"]').click();

    // ── The frame CLOSES, and that is the UX accelerator working ─────────
    //
    // The secure plane posts `secret_status: secret_received`; the parent
    // draws a provisional entry; `openSecretRequest` then reports nothing open
    // and the iframe unmounts. Waiting for anything INSIDE the frame after
    // this point waits for a document that is correctly gone — which is what
    // my first version of this test did.
    //
    // Nothing durable has happened yet. That is the next assertion but one.
    await expect
      .poll(async () => await page.locator('[data-testid="secure-iframe"]').count(), {
        timeout: 20_000,
      })
      .toBe(0);

    // ── 7. The Conversation Plane never received it ──────────────────────
    //
    // The whole page, its scripts, and everything React holds.
    expect(await page.content()).not.toContain(PASSWORD);
    const conversationState = await page.evaluate(() =>
      JSON.stringify({
        turns: (window as unknown as { __askimateTurns: () => unknown }).__askimateTurns(),
        storage: { ...window.localStorage },
        session: { ...window.sessionStorage },
      }),
    );
    expect(conversationState).not.toContain(PASSWORD);

    // ── 8. No URL, anywhere ──────────────────────────────────────────────
    for (const url of urls) expect(url, url).not.toContain(PASSWORD);
    expect(urls.join(" ")).not.toContain(encodeURIComponent(PASSWORD));

    // ── 10. The Conversation Service never saw it ────────────────────────
    //
    // Every request body the browser sent to the CHAT origin. The one body
    // containing the password went to the secure origin, and only there.
    const toChat = urls
      .map((url, index) => ({ url, body: bodies[index] ?? "" }))
      .filter((entry) => entry.url.startsWith(CHAT));
    expect(toChat.length, "the page made no requests to the chat origin").toBeGreaterThan(0);
    for (const entry of toChat) {
      expect(entry.body, entry.url).not.toContain(PASSWORD);
    }

    // And its database, column by column.
    const columns = await chatPool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type IN ('text','character varying','character','json','jsonb')`,
    );
    expect(columns.rowCount).toBeGreaterThan(5);
    for (const { table_name, column_name } of columns.rows) {
      const hits = await chatPool.query<{ n: string }>(
        `SELECT count(*) AS n FROM "${table_name}" WHERE "${column_name}"::text LIKE $1`,
        [`%${PASSWORD}%`],
      );
      expect(Number(hits.rows[0]!.n), `${table_name}.${column_name}`).toBe(0);
    }

    // ── The secure plane's own database, too ─────────────────────────────
    const secureColumns = await securePool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type IN ('text','character varying','character','json','jsonb')`,
    );
    for (const { table_name, column_name } of secureColumns.rows) {
      const hits = await securePool.query<{ n: string }>(
        `SELECT count(*) AS n FROM "${table_name}" WHERE "${column_name}"::text LIKE $1`,
        [`%${PASSWORD}%`],
      );
      expect(Number(hits.rows[0]!.n), `secure.${table_name}.${column_name}`).toBe(0);
    }

    // ── The vault holds CIPHERTEXT ───────────────────────────────────────
    expect(cache.rawEntries(), "nothing reached the vault").toHaveLength(1);
    expect(JSON.stringify(cache.rawEntries())).not.toContain(PASSWORD);

    // ── The logs ─────────────────────────────────────────────────────────
    expect(secureLog.join("\n")).not.toContain(PASSWORD);
    expect(secureLog.join("\n")).toContain("event=secret_submitted");

    // ── 11. The lifecycle settles through the AUTHORITATIVE path ─────────
    //
    // Nothing has reached the conversation log yet: the browser told the page
    // the step succeeded, and the page is not the authority.
    expect(await durableKinds(conversation)).toEqual(["message", "secret_requested"]);
    // The composer is STILL blocked, because the log still shows the step open.
    const refusedWhileUndelivered = await page.evaluate(async (id) => {
      const response = await fetch(`/v1/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "stale-client-key-1234" },
        body: JSON.stringify({ content: "can I talk yet?" }),
      });
      return response.status;
    }, conversation);
    expect(refusedWhileUndelivered, "the guard released on the browser's word").toBe(409);

    // The outbox publishes, and only now does the log settle.
    expect(await publish()).toEqual({ delivered: 1, failed: 0 });
    expect(await durableKinds(conversation)).toEqual([
      "message",
      "secret_requested",
      "secret_received",
    ]);

    // ── 12. The composer reopens, and the page learns from the stream ────
    await expect
      .poll(async () => await page.locator("#chat-send").isDisabled(), { timeout: 20_000 })
      .toBe(false);
    await page.locator("#chat-input").fill("thanks, that worked");
    await page.locator("#chat-send").click();
    await expect
      .poll(async () => (await durableKinds(conversation)).length, { timeout: 15_000 })
      .toBe(4);

    await page.close();
  }, 180_000);

  it("keeps the password out of every postMessage that crosses the boundary — R2", async () => {
    const conversation = await newConversation();
    const requestId = await openSecureStep(conversation);
    const page = await chatPage(conversation);

    // Every message the conversation page receives, captured in the page before
    // React's listener runs. This is the actual boundary: whatever appears here
    // is what the secure plane chose to send.
    await page.evaluate(() => {
      const seen: unknown[] = [];
      (window as unknown as { __frameMessages: unknown[] }).__frameMessages = seen;
      window.addEventListener("message", (event) => seen.push(event.data), true);
    });

    const frame = page.frameLocator('[data-testid="secure-iframe"]');
    await frame.locator('[data-testid="secure-form"]').waitFor({ timeout: 20_000 });
    await frame.locator('[data-testid="secure-password"]').fill(PASSWORD);
    await frame.locator('[data-testid="secure-confirmation"]').fill(PASSWORD);
    await frame.locator('[data-testid="secure-submit"]').click();
    await expect
      .poll(async () => await page.locator('[data-testid="secure-iframe"]').count(), {
        timeout: 20_000,
      })
      .toBe(0);

    const messages = await page.evaluate(() =>
      JSON.stringify((window as unknown as { __frameMessages: unknown[] }).__frameMessages),
    );
    expect(messages, "a postMessage carried the credential").not.toContain(PASSWORD);
    // And it DID carry the lifecycle, so the scan is not passing on an empty
    // list — the classic way a leak scan quietly stops looking.
    expect(messages).toContain("secret_received");
    expect(messages).toContain(requestId);
    await page.close();
  }, 120_000);

  it("survives a refresh mid-step: a NEW capability, and nothing typed comes back", async () => {
    const conversation = await newConversation();
    await openSecureStep(conversation);
    const page = await chatPage(conversation);

    const frame = page.frameLocator('[data-testid="secure-iframe"]');
    await frame.locator('[data-testid="secure-form"]').waitFor({ timeout: 20_000 });
    // Half-typed, then the student reloads.
    await frame.locator('[data-testid="secure-password"]').fill(PASSWORD);

    await page.reload();
    await page.locator('[data-testid="composer"]').waitFor({ state: "visible" });
    const reopened = page.frameLocator('[data-testid="secure-iframe"]');
    await reopened.locator('[data-testid="secure-form"]').waitFor({ timeout: 20_000 });

    // The box is back and EMPTY. There is nowhere the value could have been
    // kept: no storage is written, and the previous document is gone.
    expect(await reopened.locator('[data-testid="secure-password"]').inputValue()).toBe("");
    expect(await page.content()).not.toContain(PASSWORD);

    // A second frame token was minted rather than the first reissued, so the
    // capability stays single-use across a refresh.
    const tokens = await securePool.query<{ n: string }>(
      "SELECT count(*) AS n FROM frame_tokens WHERE request_id = (SELECT request_id FROM secret_requests ORDER BY created_at DESC LIMIT 1)",
    );
    expect(Number(tokens.rows[0]!.n)).toBeGreaterThanOrEqual(2);
    await page.close();
  }, 120_000);

  it("cancels from inside the frame, and the log settles through the outbox", async () => {
    // Drain first. Earlier tests in this file leave delivered-nothing rows —
    // a successful submission whose lifecycle nobody published — and a count
    // assertion below would then be counting them too.
    await publish();

    const conversation = await newConversation();
    const requestId = await openSecureStep(conversation);
    const page = await chatPage(conversation);

    const frame = page.frameLocator('[data-testid="secure-iframe"]');
    await frame.locator('[data-testid="secure-form"]').waitFor({ timeout: 20_000 });
    expect(await page.locator("#chat-send").isDisabled()).toBe(true);

    await frame.locator('[data-testid="secure-cancel"]').click();

    // ── Wait for the WRITE, then publish once ────────────────────────────
    //
    // Playwright's click returns as soon as the event is dispatched, not when
    // the DELETE it triggers has been answered. Polling `publish()` instead
    // made the test depend on whether the first drain happened to run after
    // the write — a race that failed about half the time. Waiting for the
    // outbox row is waiting for the thing that actually has to have happened.
    await expect
      .poll(
        async () =>
          (
            await securePool.query(
              "SELECT 1 FROM lifecycle_outbox WHERE request_id = $1 AND kind = 'secret_cancelled'",
              [requestId],
            )
          ).rowCount,
        { timeout: 20_000 },
      )
      .toBe(1);
    expect(await publish()).toEqual({ delivered: 1, failed: 0 });
    expect(await durableKinds(conversation)).toEqual(["secret_requested", "secret_cancelled"]);

    await expect
      .poll(async () => await page.locator("#chat-send").isDisabled(), { timeout: 20_000 })
      .toBe(false);
    await page.close();
  }, 120_000);

  it("shows a rejection, keeps the step open, and keeps the composer shut", async () => {
    const conversation = await newConversation();
    await openSecureStep(conversation);
    const page = await chatPage(conversation);

    const frame = page.frameLocator('[data-testid="secure-iframe"]');
    await frame.locator('[data-testid="secure-form"]').waitFor({ timeout: 20_000 });
    await frame.locator('[data-testid="secure-password"]').fill(PASSWORD);
    await frame.locator('[data-testid="secure-confirmation"]').fill(`${PASSWORD}-typo`);
    await frame.locator('[data-testid="secure-submit"]').click();

    await expect
      .poll(async () => await frame.locator('[data-testid="secure-error"]').textContent(), {
        timeout: 20_000,
      })
      .toContain("did not match");
    // Both fields cleared, so a retry retypes both — the point of confirming.
    expect(await frame.locator('[data-testid="secure-password"]').inputValue()).toBe("");
    // A rejection settles nothing: the step is still open and the composer shut.
    expect(await durableKinds(conversation)).toEqual(["secret_requested"]);
    expect(await page.locator("#chat-send").isDisabled()).toBe(true);
    expect(await page.content()).not.toContain(PASSWORD);
    await page.close();
  }, 120_000);

  it("refuses a stale client that POSTs directly, bypassing the UI entirely", async () => {
    const conversation = await newConversation();
    await openSecureStep(conversation);
    const page = await chatPage(conversation);

    const refused = await page.evaluate(async (id) => {
      const response = await fetch(`/v1/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "bypassing-the-ui-key" },
        body: JSON.stringify({ content: "A-PASSWORD-TYPED-INTO-THE-WRONG-BOX" }),
      });
      return { status: response.status, body: await response.text() };
    }, conversation);

    expect(refused.status).toBe(409);
    expect(refused.body).not.toContain("A-PASSWORD-TYPED-INTO-THE-WRONG-BOX");
    const stored = await chatPool.query<{ n: string }>(
      "SELECT count(*) AS n FROM message_bodies WHERE content LIKE '%WRONG-BOX%'",
    );
    expect(Number(stored.rows[0]!.n)).toBe(0);
    await page.close();
  }, 120_000);

  it("shows a second browser the settled step, and never the credential", async () => {
    const conversation = await newConversation();
    await openSecureStep(conversation);
    const author = await chatPage(conversation);
    const observer = await chatPage(conversation);

    const frame = author.frameLocator('[data-testid="secure-iframe"]');
    await frame.locator('[data-testid="secure-form"]').waitFor({ timeout: 20_000 });
    await frame.locator('[data-testid="secure-password"]').fill(PASSWORD);
    await frame.locator('[data-testid="secure-confirmation"]').fill(PASSWORD);
    await frame.locator('[data-testid="secure-submit"]').click();
    await expect
      .poll(async () => await author.locator('[data-testid="secure-iframe"]').count(), {
        timeout: 20_000,
      })
      .toBe(0);

    await expect.poll(async () => (await publish()).delivered, { timeout: 20_000 }).toBe(1);

    // The OTHER browser learns from the log, over its own stream.
    await expect
      .poll(async () => await observer.locator('[data-lifecycle="secret_received"]').count(), {
        timeout: 20_000,
      })
      .toBe(1);
    expect(await observer.content()).not.toContain(PASSWORD);
    await author.close();
    await observer.close();
  }, 180_000);
});

// ───────────────────────────────────────────────────────────────────────────
// Composer and draft, on the real architecture
//
// ═══════════════════════════════════════════════════════════════════════════
// These replace four properties that only `fail-closed.test.ts` proved, and
// they prove them against the REAL planes: a durable `secret_requested` event
// in the conversation log, a cross-origin frame, and an authoritative
// lifecycle that arrives over SSE after the outbox publishes.
//
// The legacy versions drove the provisional same-origin control and a
// same-origin chat route. Where the semantics have changed, the change is
// named rather than quietly preserved.
// ═══════════════════════════════════════════════════════════════════════════

describeIfDatabase("what the composer does around a secure step", () => {
  it("types freely and sends freely while nothing is open — Q1", async () => {
    const conversation = await newConversation();
    const page = await chatPage(conversation);

    expect(await page.locator("#chat-input").isDisabled()).toBe(false);
    expect(await page.locator("#chat-send").isDisabled()).toBe(false);
    await sendFromComposer(page, "an ordinary question");
    await expect
      .poll(async () => (await durableKinds(conversation)).length, { timeout: 15_000 })
      .toBe(1);
    // Cleared on ACKNOWLEDGEMENT — the box empties because the server accepted,
    // not because Send was pressed. Polled, because the durable event can
    // arrive on the stream a render before the response resolves, and reading
    // once made this assertion depend on which won.
    await expect
      .poll(async () => await page.locator("#chat-input").inputValue(), { timeout: 10_000 })
      .toBe("");
    await page.close();
  }, 90_000);

  it("keeps typing live and blocks the send when a step opens mid-sentence — Q2", async () => {
    const conversation = await newConversation();
    const page = await chatPage(conversation);

    // The student is already mid-sentence when the step arrives.
    await page.locator("#chat-input").fill("I was in the middle of this");
    await openSecureStep(conversation);

    await expect
      .poll(async () => await page.locator("#chat-send").isDisabled(), { timeout: 20_000 })
      .toBe(true);
    // Typing is NEVER blocked. `ComposerPolicy.typing` is the literal "live",
    // so "disable the composer" is not a value the policy can return — a modal
    // freeze is what breaks the one-continuous-conversation requirement.
    expect(await page.locator("#chat-input").isDisabled()).toBe(false);
    // Q3: the draft is untouched. Nothing cleared it, nothing queued it.
    expect(await page.locator("#chat-input").inputValue()).toBe("I was in the middle of this");
    await page.locator("#chat-input").fill("and I can still type more");
    expect(await page.locator("#chat-input").inputValue()).toBe("and I can still type more");
    await page.close();
  }, 90_000);

  it("cannot submit a stale draft while the step is open, and loses nothing — Q4", async () => {
    // The dangerous case: a student types their password into the WRONG box and
    // presses Enter. No bytes may leave, and the text must survive.
    const conversation = await newConversation();
    const page = await chatPage(conversation);
    const sent: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/messages")) sent.push(request.postData() ?? "");
    });
    await openSecureStep(conversation);
    await expect
      .poll(async () => await page.locator("#chat-send").isDisabled(), { timeout: 20_000 })
      .toBe(true);

    await page.locator("#chat-input").fill(PASSWORD);
    // A real submit event, bubbling. React attaches its listeners at the root
    // container, so a non-bubbling `new Event("submit")` never reaches the
    // handler and the test would pass having triggered nothing.
    await page.evaluate(() => {
      document
        .getElementById("composer")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(500);

    // PREVENTION: nothing left the browser, read from Playwright's record of
    // real traffic rather than from anything the page said about itself.
    expect(sent.join("\n"), "the composer sent a message while blocked").not.toContain(PASSWORD);
    expect(sent).toHaveLength(0);
    // And the text is exactly where the student left it.
    expect(await page.locator("#chat-input").inputValue()).toBe(PASSWORD);
    expect(await page.locator('[data-testid="hint"]').textContent()).toContain("Held");
    // Nothing reached the log or the database either.
    expect(await durableKinds(conversation)).toEqual(["secret_requested"]);
    const bodies = await chatPool.query<{ n: string }>(
      "SELECT count(*) AS n FROM message_bodies WHERE content LIKE $1",
      [`%${PASSWORD}%`],
    );
    expect(Number(bodies.rows[0]!.n)).toBe(0);
    await page.close();
  }, 90_000);

  it("does NOT auto-send the draft when the step finishes — Q4, the release case", async () => {
    // The single most dangerous thing a deferred-send design can do. If the
    // held draft were released on completion, a password typed into the wrong
    // box would be transmitted the moment the secure step succeeded — turning a
    // contained accident into a persisted one with no human in the loop.
    const conversation = await newConversation();
    const page = await chatPage(conversation);
    const sent: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/messages")) sent.push(request.postData() ?? "");
    });
    await openSecureStep(conversation);

    const frame = page.frameLocator('[data-testid="secure-iframe"]');
    await frame.locator('[data-testid="secure-form"]').waitFor({ timeout: 20_000 });
    // The password goes in the WRONG box as well as the right one.
    await page.locator("#chat-input").fill(PASSWORD);
    await frame.locator('[data-testid="secure-password"]').fill("a-different-real-password");
    await frame.locator('[data-testid="secure-confirmation"]').fill("a-different-real-password");
    await frame.locator('[data-testid="secure-submit"]').click();

    await expect
      .poll(async () => await page.locator('[data-testid="secure-iframe"]').count(), {
        timeout: 20_000,
      })
      .toBe(0);
    await expect
      .poll(
        async () =>
          (
            await securePool.query(
              "SELECT 1 FROM lifecycle_outbox WHERE conversation_id = $1 AND kind = 'secret_received'",
              [conversation],
            )
          ).rowCount,
        { timeout: 20_000 },
      )
      .toBe(1);
    await publish();

    // ── Wait for the RELEASE, or for something to be sent ────────────────
    //
    // Polling only for "the composer reopened" made a released-buffer bug show
    // up as a TIMEOUT: the auto-sent message is refused with a 409 while the
    // log is still settling, the client latches the server's open request, and
    // the composer never reopens at all. A timeout is not proof of the property
    // this test is about, so the poll ends on EITHER outcome and the assertion
    // that follows names which one happened.
    await expect
      .poll(
        async () => sent.length > 0 || !(await page.locator("#chat-send").isDisabled()),
        { timeout: 25_000 },
      )
      .toBe(true);
    expect(sent.join("\n"), "the held draft was auto-sent on completion").not.toContain(PASSWORD);
    expect(sent, "something was sent that nobody asked to send").toHaveLength(0);

    // The composer is live again and the draft survived.
    expect(await page.locator("#chat-send").isDisabled()).toBe(false);
    expect(await page.locator("#chat-input").inputValue()).toBe(PASSWORD);
    await page.close();
  }, 120_000);

  it("suspends draft persistence while a step is open, and clears an earlier one", async () => {
    const conversation = await newConversation();
    const page = await chatPage(conversation);

    // A draft saved a moment BEFORE the step opened. Browser storage outlives
    // the five-minute TTL that governs everything else here, so a draft written
    // before the request must be removed as well as not added to.
    await page.evaluate(() => {
      window.localStorage.setItem("askimate.draft", "an earlier draft");
    });
    await openSecureStep(conversation);
    await expect
      .poll(async () => await page.locator("#chat-send").isDisabled(), { timeout: 20_000 })
      .toBe(true);

    expect(await page.evaluate(() => window.localStorage.getItem("askimate.draft"))).toBeNull();
    // And typing writes nothing while the step is open. Asserting the BEHAVIOUR
    // rather than a flag: a flag set to the right word by a client that still
    // wrote would pass a flag assertion.
    await page.locator("#chat-input").fill("typed while the step was open");
    expect(await page.evaluate(() => window.localStorage.getItem("askimate.draft"))).toBeNull();
    await page.close();
  }, 90_000);

  it("restores the correct BLOCKED state after a refresh — Q5", async () => {
    const conversation = await newConversation();
    // Opened BEFORE the page loads, so the transcript arrives already holding
    // it — `chatPage` waits for `__askimateLoaded`, so this is an assertion
    // rather than a race.
    await openSecureStep(conversation);
    const page = await chatPage(conversation);
    expect(
      await page.locator("#chat-send").isDisabled(),
      "the composer was not blocked by a step already in the transcript",
    ).toBe(true);

    await page.reload();
    await page.locator('[data-testid="composer"]').waitFor({ state: "visible" });
    // Wait for the durable transcript to ARRIVE, then assert directly. Polling
    // for "disabled" would report a lost restore as a timeout, and a timeout is
    // not proof of this property — the assertion has to be the thing that
    // fails, naming what it found.
    await page.waitForFunction(
      () => (window as unknown as { __askimateLoaded?: () => boolean }).__askimateLoaded?.() === true,
      undefined,
      { timeout: 20_000 },
    );
    expect(
      await page.locator("#chat-send").isDisabled(),
      "the composer came back UNBLOCKED for a step the log still holds open",
    ).toBe(true);
    // The frame came back too.
    await page
      .frameLocator('[data-testid="secure-iframe"]')
      .locator('[data-testid="secure-form"]')
      .waitFor({ timeout: 20_000 });
    // Nothing typed survived the reload — there is nowhere it could have been
    // kept, and the previous document is gone.
    expect(await page.locator("#chat-input").inputValue()).toBe("");
    await page.close();
  }, 120_000);

  it("reopens on cancellation ONLY after the authoritative event lands — Q6", async () => {
    const conversation = await newConversation();
    const requestId = await openSecureStep(conversation);
    const page = await chatPage(conversation);
    const frame = page.frameLocator('[data-testid="secure-iframe"]');
    await frame.locator('[data-testid="secure-form"]').waitFor({ timeout: 20_000 });

    await frame.locator('[data-testid="secure-cancel"]').click();
    await expect
      .poll(
        async () =>
          (
            await securePool.query(
              "SELECT 1 FROM lifecycle_outbox WHERE request_id = $1 AND kind = 'secret_cancelled'",
              [requestId],
            )
          ).rowCount,
        { timeout: 20_000 },
      )
      .toBe(1);

    // ── The frame has closed, and the SERVER has not been told ──────────
    //
    // The transition is written in the secure plane and queued, and the
    // conversation log still shows the step open. A direct POST is refused —
    // which is the whole distinction between what the browser SHOWS and what
    // the server ALLOWS.
    expect(await durableKinds(conversation)).toEqual(["secret_requested"]);
    const refusedBeforePublish = await page.evaluate(async (id) => {
      const response = await fetch(`/v1/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "before-publish-key-1" },
        body: JSON.stringify({ content: "may I speak?" }),
      });
      return response.status;
    }, conversation);
    expect(refusedBeforePublish, "the guard released before the transition landed").toBe(409);

    await publish();
    await expect
      .poll(async () => await page.locator("#chat-send").isDisabled(), { timeout: 20_000 })
      .toBe(false);
    await page.close();
  }, 120_000);

  it("reopens on EXPIRY only through the authoritative path — Q7", async () => {
    // Expiry is the Secure Service's to declare, exactly like cancellation:
    // it settles the request in its own database and publishes the transition.
    // The conversation plane learns it from the log, never from a clock the
    // browser read.
    const conversation = await newConversation();
    const requestId = await openSecureStep(conversation);
    const page = await chatPage(conversation);
    await expect
      .poll(async () => await page.locator("#chat-send").isDisabled(), { timeout: 20_000 })
      .toBe(true);

    await secureStore.withTransaction(async (client) => {
      const now = clock();
      await secureStore.settle(client, requestId, "secret_expired", now);
      await outbox.enqueue(client, {
        requestId,
        conversationId: conversation,
        transition: { kind: "secret_expired" },
        now,
      });
    });
    // Still blocked: the transition exists in the secure plane and has not
    // been published.
    expect(await page.locator("#chat-send").isDisabled()).toBe(true);

    await publish();
    expect(await durableKinds(conversation)).toEqual(["secret_requested", "secret_expired"]);
    await expect
      .poll(async () => await page.locator("#chat-send").isDisabled(), { timeout: 20_000 })
      .toBe(false);
    await page.close();
  }, 120_000);

  it("keeps the step OPEN after a rejection, per the lifecycle rules — Q8", async () => {
    // `openSecretRequest` deliberately ignores a rejection: a mistyped
    // confirmation leaves the request open so the student can retry. Treating
    // it as closure would release the composer while the server still holds
    // the request.
    const conversation = await newConversation();
    const page = await chatPage(conversation);
    await openSecureStep(conversation);
    const frame = page.frameLocator('[data-testid="secure-iframe"]');
    await frame.locator('[data-testid="secure-form"]').waitFor({ timeout: 20_000 });

    await frame.locator('[data-testid="secure-password"]').fill(PASSWORD);
    await frame.locator('[data-testid="secure-confirmation"]').fill(`${PASSWORD}-typo`);
    await frame.locator('[data-testid="secure-submit"]').click();
    await expect
      .poll(async () => await frame.locator('[data-testid="secure-error"]').textContent(), {
        timeout: 20_000,
      })
      .toContain("did not match");

    // The step is still open, the frame is still there to retry in, and the
    // composer is still blocked.
    expect(await page.locator('[data-testid="secure-iframe"]').count()).toBe(1);
    expect(await page.locator("#chat-send").isDisabled()).toBe(true);
    expect(await durableKinds(conversation)).toEqual(["secret_requested"]);

    // And the retry succeeds, which is what leaving it open is FOR.
    await frame.locator('[data-testid="secure-password"]').fill(PASSWORD);
    await frame.locator('[data-testid="secure-confirmation"]').fill(PASSWORD);
    await frame.locator('[data-testid="secure-submit"]').click();
    await expect
      .poll(async () => await page.locator('[data-testid="secure-iframe"]').count(), {
        timeout: 20_000,
      })
      .toBe(0);
    await page.close();
  }, 120_000);

  it("converges two browsers on the SAME composer state — Q9", async () => {
    const conversation = await newConversation();
    const first = await chatPage(conversation);
    const second = await chatPage(conversation);

    // Both free.
    expect(await first.locator("#chat-send").isDisabled()).toBe(false);
    expect(await second.locator("#chat-send").isDisabled()).toBe(false);

    const requestId = await openSecureStep(conversation);
    // Both blocked, from the same durable event over their own streams.
    for (const page of [first, second]) {
      await expect
        .poll(async () => await page.locator("#chat-send").isDisabled(), { timeout: 20_000 })
        .toBe(true);
    }

    // One browser finishes the step. The OTHER must not release until the
    // authoritative transition reaches the log.
    const frame = first.frameLocator('[data-testid="secure-iframe"]');
    await frame.locator('[data-testid="secure-form"]').waitFor({ timeout: 20_000 });
    await frame.locator('[data-testid="secure-password"]').fill(PASSWORD);
    await frame.locator('[data-testid="secure-confirmation"]').fill(PASSWORD);
    await frame.locator('[data-testid="secure-submit"]').click();
    await expect
      .poll(
        async () =>
          (
            await securePool.query(
              "SELECT 1 FROM lifecycle_outbox WHERE request_id = $1 AND kind = 'secret_received'",
              [requestId],
            )
          ).rowCount,
        { timeout: 20_000 },
      )
      .toBe(1);

    // ── BOTH browsers are still blocked, including the one that submitted ──
    //
    // The second saw no postMessage at all — it is not embedding that frame.
    // The FIRST saw one, drew a provisional `secret_received`, and closed its
    // card; its composer must nevertheless stay shut, because the conversation
    // log has not settled the step. This is the assertion that pins
    // "provisional UI must never override server authority", and it FAILED
    // before the composer gate was changed to read the durable log only.
    expect(
      await second.locator("#chat-send").isDisabled(),
      "a browser released on another browser's UX event",
    ).toBe(true);
    expect(
      await first.locator("#chat-send").isDisabled(),
      "the submitting browser released on its own postMessage, before the log settled",
    ).toBe(true);
    // Its card HAS closed, which is the UX accelerator doing its job.
    expect(await first.locator('[data-testid="secure-iframe"]').count()).toBe(0);
    expect(await durableKinds(conversation)).toEqual(["secret_requested"]);

    await publish();
    for (const page of [first, second]) {
      await expect
        .poll(async () => await page.locator("#chat-send").isDisabled(), { timeout: 20_000 })
        .toBe(false);
    }
    await first.close();
    await second.close();
  }, 180_000);

  it("cannot be unblocked by a stale stream or a delayed event — Q10", async () => {
    // The window this asks about: a page whose stream dropped while a step was
    // opening. It must not be free merely because it has not heard yet.
    const conversation = await newConversation();
    const page = await chatPage(conversation);

    // Sever the stream, THEN open the step. The page cannot learn about it.
    await page.route("**/stream*", (route) => route.abort());
    await openSecureStep(conversation);
    await page.waitForTimeout(1_000);

    // The page may still SHOW an enabled composer — it knows nothing. What
    // matters is that the SERVER refuses, which is why the guard exists at all.
    const refused = await page.evaluate(async (id) => {
      const response = await fetch(`/v1/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "stale-stream-key-77" },
        body: JSON.stringify({ content: "sent by a page that never heard" }),
      });
      return response.status;
    }, conversation);
    expect(refused, "a stale client's message was accepted").toBe(409);
    expect(await durableKinds(conversation)).toEqual(["secret_requested"]);

    // And when the stream comes back, the page converges on blocked.
    await page.unroute("**/stream*");
    await page.reload();
    await page.locator('[data-testid="composer"]').waitFor({ state: "visible" });
    await expect
      .poll(async () => await page.locator("#chat-send").isDisabled(), { timeout: 20_000 })
      .toBe(true);
    await page.close();
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The capability refusals, on the real path
//
// ═══════════════════════════════════════════════════════════════════════════
// `decideRendering` was written for THIS architecture and the real path was
// not calling it. These are the three refusals that had no browser coverage.
//
// The semantics changed in one respect, deliberately: the provisional path
// CANCELLED the request on a refusal, because it held a token that let it.
// This client cannot — cancellation needs a secure session, which needs the
// bootstrap it has just declined to fetch — and it should not be able to. So
// the request stays open, the composer stays BLOCKED, and the TTL settles it.
// A client that cannot show a password box is not a client that should decide
// nobody will be asked for the password.
// ═══════════════════════════════════════════════════════════════════════════

describeIfDatabase("when this client cannot show the step", () => {
  /** A page whose reported capabilities are overridden before it loads. */
  async function pageWith(
    conversationId: string,
    capabilities: Record<string, boolean>,
  ): Promise<Page> {
    const context = await browser.newContext();
    const page = await context.newPage();
    const response = await page.request.post(`${CHAT}/dev/session`, {
      data: { subject: studentId },
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status()).toBe(204);
    await page.addInitScript(
      ([id, caps]) => {
        const w = window as unknown as Record<string, unknown>;
        w["__askimateDurableConversationId"] = id;
        w["__askimateCapabilities"] = caps;
      },
      [conversationId, capabilities] as [string, Record<string, boolean>],
    );
    await page.goto(`${CHAT}/index.html`);
    await page.locator('[data-testid="composer"]').waitFor({ state: "visible" });
    return page;
  }

  const CASES = [
    { override: { supportsSecureControl: false }, reason: "client_does_not_support_secure_control" },
    { override: { secureContext: false }, reason: "insecure_context" },
    { override: { endpointReachable: false }, reason: "endpoint_unreachable" },
  ] as const;

  for (const { override, reason } of CASES) {
    it(`refuses with ${reason}, mounts NO frame, and stays blocked`, async () => {
      const conversation = await newConversation();
      await openSecureStep(conversation);
      const page = await pageWith(conversation, override);

      // Wait for the transcript to arrive, then ASSERT. Polling for the
      // refusal would report "the client rendered the step anyway" as a
      // timeout, and a timeout is not proof of this property.
      await page.waitForFunction(
        () =>
          (window as unknown as { __askimateLoaded?: () => boolean }).__askimateLoaded?.() === true,
        undefined,
        { timeout: 20_000 },
      );
      // The refusal is on screen, with its CODE. The sentence comes from a
      // fixed table keyed by that code — never assembled from anything.
      expect(
        await page.locator('[data-testid="refusal"]').getAttribute("data-reason"),
        "this client rendered a step it reported it cannot show",
      ).toBe(reason);
      expect(await page.locator('[data-testid="refusal"]').textContent()).not.toBe("");

      // NO iframe was mounted, so no password box exists anywhere.
      expect(await page.locator('[data-testid="secure-iframe"]').count()).toBe(0);
      expect(await page.content()).not.toContain("type=\"password\"");

      // FAIL CLOSED: the composer stays blocked, because the log still shows
      // the step open. The client did not cancel it and cannot.
      expect(await page.locator("#chat-send").isDisabled()).toBe(true);
      expect(await durableKinds(conversation)).toEqual(["secret_requested"]);

      // And a direct POST is refused too, so nothing depends on the UI.
      const refused = await page.evaluate(async (id) => {
        const response = await fetch(`/v1/conversations/${id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": "cannot-render-key-1" },
          body: JSON.stringify({ content: "can I type it here instead?" }),
        });
        return response.status;
      }, conversation);
      expect(refused).toBe(409);
      await page.close();
    }, 120_000);
  }

  it("NEVER fetches a bootstrap capability it cannot use", async () => {
    // A one-time token minted for a frame that will never mount is a token
    // sitting unspent. The check runs BEFORE the fetch for exactly this reason.
    const conversation = await newConversation();
    const requestId = await openSecureStep(conversation);
    const before = (
      await securePool.query("SELECT 1 FROM frame_tokens WHERE request_id = $1", [requestId])
    ).rowCount;

    const page = await pageWith(conversation, { secureContext: false });
    await expect
      .poll(
        async () => await page.locator('[data-testid="refusal"]').getAttribute("data-reason"),
        { timeout: 20_000 },
      )
      .toBe("insecure_context");
    await page.waitForTimeout(500);

    const after = (
      await securePool.query("SELECT 1 FROM frame_tokens WHERE request_id = $1", [requestId])
    ).rowCount;
    expect(after, "a capability was minted for a frame that never mounted").toBe(before);
    await page.close();
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The two planes are different services, and neither answers for the other
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("plane separation", () => {
  it("the Conversation Service has NO route that accepts a secret", async () => {
    const conversation = await newConversation();
    const cookie = await chatSessionCookie();

    // Every shape the secure endpoint accepts, offered to the conversation
    // plane at the secure plane's paths. All 404: the routes do not exist here.
    for (const path of [
      `/v1/secret-requests/sr_${"a".repeat(32)}/secret`,
      "/v1/frame-sessions",
      `/control/sr_${"a".repeat(32)}`,
    ]) {
      const response = await fetch(`${CHAT}${path}`, {
        method: path.startsWith("/control") ? "GET" : "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        ...(path.startsWith("/control")
          ? {}
          : { body: JSON.stringify({ secret: PASSWORD, conversationId: conversation }) }),
      });
      expect(response.status, `${path} answered ${String(response.status)}`).toBe(404);
      expect(await response.text()).not.toContain(PASSWORD);
    }

    // And the ONE route it does have refuses a body with a `secret` field: the
    // schema is closed, so the field is simply not read. What is stored is the
    // `content`, and nothing else in the body reaches a column.
    const smuggled = await fetch(`${CHAT}/v1/conversations/${conversation}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "smuggling-a-secret-field-01",
        Cookie: cookie,
      },
      body: JSON.stringify({ content: "an ordinary message", secret: PASSWORD }),
    });
    expect(smuggled.status).toBe(201);
    expect(await smuggled.text()).not.toContain(PASSWORD);

    const columns = await chatPool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type IN ('text','character varying','character','json','jsonb')`,
    );
    expect(columns.rowCount).toBeGreaterThan(5);
    for (const { table_name, column_name } of columns.rows) {
      const hits = await chatPool.query<{ n: string }>(
        `SELECT count(*) AS n FROM "${table_name}" WHERE "${column_name}"::text LIKE $1`,
        [`%${PASSWORD}%`],
      );
      expect(Number(hits.rows[0]!.n), `${table_name}.${column_name}`).toBe(0);
    }
  }, 60_000);

  it("the Secure Service has NO route that accepts an ordinary message", async () => {
    const conversation = await newConversation();
    for (const path of [
      `/v1/conversations/${conversation}/messages`,
      `/v1/conversations/${conversation}/events`,
      `/v1/conversations/${conversation}/stream`,
    ]) {
      const response = await fetch(`${SECURE}${path}`, {
        method: path.endsWith("/messages") ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        ...(path.endsWith("/messages")
          ? { body: JSON.stringify({ content: "an ordinary message" }) }
          : {}),
      });
      expect(response.status, `${path} answered ${String(response.status)}`).toBe(404);
    }
  }, 60_000);

  it("keeps the two sessions apart: neither cookie works on the other plane", async () => {
    // Both are named `__Host-…` and both are HttpOnly, and they are DIFFERENT
    // cookies on different origins. A browser will not send one to the other,
    // and neither service would accept it if it did.
    const { requestId, frameToken } = await openSecureRequest();
    const secureCookie = await secureSessionCookie(requestId, frameToken);
    const conversation = await newConversation();

    const withSecureCookie = await fetch(
      `${CHAT}/v1/conversations/${conversation}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "wrong-plane-cookie-key-1",
          Cookie: secureCookie,
        },
        body: JSON.stringify({ content: "using the wrong plane's session" }),
      },
    );
    expect(withSecureCookie.status).toBe(401);

    const chatCookie = await chatSessionCookie();
    const withChatCookie = await fetch(`${SECURE}/v1/secret-requests/${requestId}`, {
      headers: { Cookie: chatCookie },
    });
    expect(withChatCookie.status).toBe(401);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The automation spends the handle
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("spending a handle through the internal API", () => {
  it("hands the plaintext to the caller's callback and destroys the entry", async () => {
    // The last leg of the journey: a browser gave a password, the vault holds
    // ciphertext, and the automation spends it. What the runner receives is
    // the CALLBACK'S RESULT — the vault has no accessor that returns a value,
    // so there is no shape in which the plaintext travels back over the wire.
    const conversation = await newConversation();
    const page = await chatPage(conversation);
    await openSecureStep(conversation);
    const frame = page.frameLocator('[data-testid="secure-iframe"]');
    await frame.locator('[data-testid="secure-form"]').waitFor({ timeout: 20_000 });
    await frame.locator('[data-testid="secure-password"]').fill(PASSWORD);
    await frame.locator('[data-testid="secure-confirmation"]').fill(PASSWORD);
    await frame.locator('[data-testid="secure-submit"]').click();
    await expect
      .poll(async () => await page.locator('[data-testid="secure-iframe"]').count(), {
        timeout: 20_000,
      })
      .toBe(0);
    await page.close();

    const handleRow = await securePool.query<{ handle: string }>(
      "SELECT handle FROM secret_requests WHERE conversation_id = $1 AND handle IS NOT NULL",
      [conversation],
    );
    const handle = handleRow.rows[0]?.handle;
    expect(handle, "no handle was recorded").toMatch(/^sh_[0-9a-f]{32}$/);

    const spend = async (): Promise<{ status: number; text: string }> => {
      const response = await fetch(`${SECURE}/internal/v1/secret-uses`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-service-cert": CERT },
        body: JSON.stringify({
          handle,
          studentRef: studentId,
          caseRef: "case-1",
          purpose: "portal_account_creation",
          targetHost: "portal.example.ac.uk",
          consumer: "browser-runner",
          noDiagnosticCapture: true,
        }),
      });
      return { status: response.status, text: await response.text() };
    };

    const used = await spend();
    expect(used.status).toBe(200);
    expect(used.text).toContain("secret_consumed");
    // The response reports WHETHER it worked. It cannot carry the value.
    expect(used.text).not.toContain(PASSWORD);

    // SINGLE USE: the entry is destroyed, so a second spend fails.
    expect((await spend()).status).toBe(409);

    // The audit row names the consumer and the outcome, and no value.
    const audit = await securePool.query<{ consumer: string; outcome: string }>(
      "SELECT consumer, outcome FROM secret_uses WHERE handle = $1 ORDER BY id",
      [handle],
    );
    expect(audit.rows.map((row) => row.outcome)).toEqual(["used", "refused"]);
    expect(JSON.stringify(audit.rows)).not.toContain(PASSWORD);

    // And the consumption reaches the conversation log through the outbox.
    await publish();
    expect(await durableKinds(conversation)).toContain("secret_consumed");
  }, 180_000);

  it("refuses a handle whose binding does not match, and fails closed on capture", async () => {
    const conversation = await newConversation();
    const { requestId, frameToken } = await openSecureRequest(conversation);
    const cookie = await secureSessionCookie(requestId, frameToken);
    const submitted = await fetch(`${SECURE}/v1/secret-requests/${requestId}/secret`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: SECURE,
        "Sec-Fetch-Site": "same-origin",
        Cookie: cookie,
      },
      body: JSON.stringify({ secret: PASSWORD, confirmation: PASSWORD, conversationId: conversation }),
    });
    expect(submitted.status).toBe(200);
    const { handle } = (await submitted.json()) as { handle: string };

    const spendWith = async (body: Record<string, unknown>): Promise<number> =>
      (
        await fetch(`${SECURE}/internal/v1/secret-uses`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-service-cert": CERT },
          body: JSON.stringify({
            handle,
            studentRef: studentId,
            caseRef: "case-1",
            purpose: "portal_account_creation",
            targetHost: "portal.example.ac.uk",
            consumer: "browser-runner",
            noDiagnosticCapture: true,
            ...body,
          }),
        })
      ).status;

    // The binding is re-checked at the moment of spending: student, case,
    // purpose and target must all match what the request was opened FOR.
    expect(await spendWith({ studentRef: "someone-else" })).toBe(403);
    expect(await spendWith({ caseRef: "another-case" })).toBe(403);
    expect(await spendWith({ purpose: "portal_password_reset" })).toBe(403);
    expect(await spendWith({ targetHost: "attacker.example" })).toBe(403);
    // ADR-0025: a false or absent assertion that diagnostic capture is off is
    // REFUSED rather than warned about.
    expect(await spendWith({ noDiagnosticCapture: false })).toBe(403);
    // And with everything correct it still works, so the refusals above are
    // about the binding rather than about the handle being dead already.
    expect(await spendWith({})).toBe(200);
  }, 120_000);
});
