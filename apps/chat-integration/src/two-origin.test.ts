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
const NOW = new Date("2026-08-28T10:00:00Z");
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
async function publish(now: Date = NOW): Promise<{ delivered: number; failed: number }> {
  return await outbox.publish(
    internalAppend({ baseUrl: CHAT, serviceCertificate: "secure-service" }),
    { now },
  );
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
    now: () => NOW,
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
    now: () => NOW,
    publicDir: clientDir,
    pollIntervalMs: 150,
    heartbeatIntervalMs: 5_000,
    maxStreamMs: 30_000,
    secureOrigin: SECURE,
    authoriseService: (req) => req.header("x-service-cert") === "secure-service",
    // The conversation plane asks the secure plane for a bootstrap capability
    // over the internal API, and hands it straight to the page. It stores none.
    mintFrameToken: async (requestId) => await secureStore.mintFrameToken(requestId, NOW),
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
