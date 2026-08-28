/**
 * The whole path, for real: a browser types a password into a chat page, and
 * the marker is hunted through every place AskiMate could put it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"The test must exercise the real Chat transport path,
 * not just unit-test the secrets package."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What "real" means here, precisely ─────────────────────────────────────
 *
 *   • a real Chromium, driving a real page, with a real password input
 *   • the real Express 5 stack — helmet, compression, cors, cookie-parser,
 *     express.json, express-rate-limit — in AskiMate's order, with AskiMate's
 *     options (see ./app.ts for the transcription)
 *   • AskiMate's real JWT bearer auth, with a real signed token
 *   • **a real PostgreSQL**, with AskiMate's real table shapes, and every
 *     column scanned afterwards
 *   • stdout and stderr captured for the duration and scanned
 *   • every network request the page makes, recorded and scanned
 *
 * The one thing that is NOT real: the live askimate.com deployment, which is
 * not in any repository this session can reach. See §1 of
 * `docs/chat-integration-report.md` — this is built against the archived
 * AskiMate codebase in `vaahiiid/Universitio`, which is the real ancestor of
 * the live app and shares its database, but is ~10 weeks behind it.
 */

import type { Server } from "node:http";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { inspect } from "node:util";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import express, { type ErrorRequestHandler } from "express";
import jwt from "jsonwebtoken";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import { InMemorySecretStore } from "@askimate/aas-secrets";
import type { SecretHandle, SecretRequestId } from "@askimate/aas-secrets";

import { createChatApp, scrubParseErrorBody } from "./app.js";
import { DatabaseSecretBindingStore } from "./bindings.js";
import type { ConversationEvent } from "@askimate/aas-contracts";
import { buildModelRequest, persistableContent } from "@askimate/aas-conversation";
import { FREE_TEXT_COLUMNS, SCHEMA_DDL } from "./schema.js";
import { announceSkip, databaseReachable } from "./test-database.js";
import { buildChatClient } from "./build-client.js";

/**
 * `JSON.stringify` is typed as returning `string` but returns `undefined` for
 * `undefined`, a function or a symbol. A scan that searched the literal text
 * "undefined" for a marker would be scanning nothing and would not know it.
 */
function stringifyError(error: unknown): string {
  const written: unknown = JSON.stringify(error);
  return typeof written === "string" ? written : "";
}

/** The marker. The one value that must not appear anywhere. */
const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";
const SKIP_DESCRIPTION =
  "the end-to-end password path (browser → endpoint → database → model)";

const PORT = 4711;
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
let runDir: string;
/** Static root: the built React client plus its page. */
let clientDir: string;

/** Everything written to stdout/stderr while the run is in flight. */
const captured: string[] = [];
let restoreConsole: (() => void) | null = null;

function captureOutput(): () => void {
  // ── Why console and not only process.stdout.write ─────────────────────
  //
  // The first version hooked `process.stdout.write` and captured ZERO bytes,
  // so the scan passed while scanning an empty string. Vitest replaces the
  // `console` methods with its own reporters, which do not necessarily reach
  // the real stdout stream during a run — so the hook has to be on `console`
  // itself, which is what application code actually calls.
  //
  // Both are hooked, because a dependency writing straight to the stream would
  // otherwise slip past.
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  const record = (parts: unknown[]): void => {
    captured.push(parts.map((part) => (typeof part === "string" ? part : inspect(part))).join(" "));
  };

  const originals = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };
  for (const name of ["log", "error", "warn", "info", "debug"] as const) {
    console[name] = ((...parts: unknown[]): void => {
      record(parts);
      originals[name](...parts);
    }) as typeof console.log;
  }

  const tee =
    (real: typeof process.stdout.write): typeof process.stdout.write =>
    (chunk, ...rest): boolean => {
      record([chunk]);
      return (real as (...args: unknown[]) => boolean)(chunk, ...rest);
    };
  process.stdout.write = tee(realOut);
  process.stderr.write = tee(realErr);

  return () => {
    for (const name of ["log", "error", "warn", "info", "debug"] as const) {
      console[name] = originals[name];
    }
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  };
}

/** Every request the page made, with its body. Scanned afterwards. */
const requests: { url: string; method: string; body: string }[] = [];

let userId: number;
let conversationId: number;

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


async function openRequest(): Promise<{ requestId: SecretRequestId; prompt: unknown }> {
  const opened = store.request(
    {
      studentRef: `student-${String(userId)}` as never,
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
    userId,
    conversationId,
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
      conversationId,
    },
  };
}

/**
 * Loads the React chat client with a real signed token.
 *
 * ── `addInitScript`, not `evaluate` after the load ────────────────────────
 *
 * The vanilla harness read `window.__askimateToken` lazily, at the moment it
 * built a request, so setting it after `goto` was fine. React reads it during
 * its FIRST RENDER — the mount is the point at which the container is
 * constructed — so a value assigned afterwards arrives too late and the page
 * comes up with an empty token and conversation 0. `addInitScript` runs before
 * any page script on every navigation, including the reload in the refresh
 * test, which is the behaviour this actually needs.
 */
async function chatPage(): Promise<Page> {
  const page = await browser.newPage();
  const token = jwt.sign(
    { id: userId, email: "student@example.test", emailVerified: true },
    JWT_SECRET,
  );
  page.on("request", (request) => {
    requests.push({ url: request.url(), method: request.method(), body: request.postData() ?? "" });
  });
  // Both values are passed as ARGUMENTS. The callback is serialised and run
  // inside the browser, so it closes over nothing from this file — referring to
  // `conversationId` directly threw "conversationId is not defined" at runtime,
  // in the page rather than here.
  await page.addInitScript(
    ([value, conversation]) => {
      (window as unknown as Record<string, unknown>)["__askimateToken"] = value;
      // The composer posts to the guarded route, so the page needs to know
      // which conversation it is in. This app deliberately does NOT mount that
      // route, so a send here fails at the network — the correct outcome for a
      // deployment that has not adopted the guard, and one the composer treats
      // as "keep the draft" rather than "discard it".
      (window as unknown as Record<string, unknown>)["__askimateConversationId"] = conversation;
    },
    [token, conversationId] as [string, number],
  );
  await page.goto(`${BASE}/index.html`);
  // React has to have mounted before anything is delivered to it.
  await page.locator('[data-testid="composer"]').waitFor({ state: "visible" });
  return page;
}

/** Delivers a directive turn to the page, as the server would. */
async function deliver(
  page: Page,
  prompt: unknown,
  capabilities: Record<string, boolean> = {
    supportsSecureControl: true,
    secureContext: true,
    endpointReachable: true,
  },
): Promise<void> {
  await page.evaluate(
    ([sent, caps]) => {
      (
        window as unknown as { __askimateReceive: (turn: unknown) => void }
      ).__askimateReceive({ kind: "directive", directive: "request_secret", prompt: sent, capabilities: caps });
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

beforeAll(async () => {
  restoreConsole = captureOutput();
  runDir = await mkdtemp(join(tmpdir(), "aas-chat-"));
  clientDir = await mkdtemp(join(tmpdir(), "aas-client-"));
  await cp(
    join(import.meta.dirname, "..", "public", "index.html"),
    join(clientDir, "index.html"),
  );
  await buildChatClient(join(clientDir, "chat-client.js"));

  pool = await ownDatabase("aas_chat_e2e");
  db = drizzle(pool);
  await pool.query(SCHEMA_DDL);

  const user = await pool.query<{ id: number }>(
    "INSERT INTO askimate_users (email, password_hash, email_verified) VALUES ($1, $2, true) RETURNING id",
    ["student@example.test", "$2a$10$notarealhash"],
  );
  userId = user.rows[0]!.id;
  const conversation = await pool.query<{ id: number }>(
    "INSERT INTO askimate_conversations (user_id, is_guest, title) VALUES ($1, false, $2) RETURNING id",
    [userId, "Ulster application"],
  );
  conversationId = conversation.rows[0]!.id;

  store = new InMemorySecretStore();
  bindings = new DatabaseSecretBindingStore(db, () => NOW);

  const app = createChatApp({
    store,
    bindings,
    jwtSecret: JWT_SECRET,
    now: () => NOW,
    // The React client, built from the sources in the tree on every run. The
    // bundle is never committed: a checked-in build is a second copy of the
    // client that can go stale, and having two clients is the thing this phase
    // removed.
    publicDir: clientDir,
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
  await rm(runDir, { recursive: true, force: true });
  await rm(clientDir, { recursive: true, force: true });
  restoreConsole?.();
});

// ───────────────────────────────────────────────────────────────────────────
// The full lifecycle
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the complete lifecycle, through a real browser", () => {
  it("runs all ten steps and leaks the marker nowhere", async () => {
    const { requestId, prompt } = await openRequest();
    const page = await chatPage();

    // ── 1–2. The model requests; the chat renders a DEDICATED control ────
    await deliver(page, prompt);
    await page.locator('[data-testid="secure-control"]').waitFor({ state: "visible" });
    // A real password input, not a text box.
    expect(await page.locator('[data-testid="secure-password"]').getAttribute("type")).toBe("password");
    expect(await page.locator('[data-testid="secure-confirmation"]').getAttribute("type")).toBe("password");
    // Phase B: typing stays LIVE, only the send is inert. The composer is no
    // longer disabled, because a frozen composer is not a conversation — see
    // docs/composer-during-secure-turn.md §1. The property that still has to
    // hold is that nothing can be TRANSMITTED, which the next lines check.
    expect(await page.locator("#chat-input").isDisabled()).toBe(false);
    expect(await page.locator("#chat-send").isDisabled()).toBe(true);

    // ── 3. The student types it, and the confirmation ────────────────────
    await page.locator('[data-testid="secure-password"]').fill(MARKER);
    await page.locator('[data-testid="secure-confirmation"]').fill(MARKER);
    await page.locator('[data-testid="secure-submit"]').click();

    // ── 5–6. The endpoint mints a handle; the client learns only that ────
    //
    // Read from the TURN LIST rather than from a debug global. The harness set
    // `window.__askimateStatus`; the React client has no such variable, and
    // reading the turns is closer to the property anyway — what the model will
    // be given is built from exactly this list.
    await page.locator('[data-testid="status"]').waitFor({ state: "visible" });
    const settled = (await page.evaluate(
      () => (window as unknown as { __askimateTurns: () => unknown[] }).__askimateTurns(),
    )) as ConversationEvent[];
    // The wire model splits what the turn model collapsed: `secret_received`
    // is a KIND now, not a lifecycle field on a shared `secret_status` turn.
    // That split is what lets the log's CHECK constraint say "a handle exists
    // exactly on a receipt".
    const status = settled.find((event) => event.kind === "secret_received");
    if (status?.kind !== "secret_received") {
      expect.unreachable("a secret_received event should exist by now");
      return;
    }
    expect(status.handle).toMatch(/^sh_[0-9a-f]{32}$/);
    const handle = status.handle;

    // The card is GONE — unmounted, not merely hidden, which is stronger than
    // the harness could manage: there is no element left holding a value.
    expect(await page.locator('[data-testid="secure-control"]').count()).toBe(0);
    expect(await page.locator("#chat-input").isDisabled()).toBe(false);
    expect(await page.locator("#chat-send").isDisabled()).toBe(false);
    // Nothing anywhere in the live document holds what was typed.
    expect(await page.content()).not.toContain(MARKER);

    // ── 4. It never entered the model message stream ─────────────────────
    const turns = (await page.evaluate(
      () => (window as unknown as { __askimateTurns: () => unknown[] }).__askimateTurns(),
    )) as ConversationEvent[];
    expect(JSON.stringify(turns)).not.toContain(MARKER);
    // What the model actually gets, built by the one funnel.
    const modelRequest = buildModelRequest({ utterance: "ok, done", events: turns });
    expect(JSON.stringify(modelRequest)).not.toContain(MARKER);
    // And it does carry the word and the handle, so this is not passing by
    // sending the model nothing at all.
    expect(JSON.stringify(modelRequest)).toContain("secret_received");
    expect(JSON.stringify(modelRequest)).toContain(handle);

    // ── Nothing the page sent, except the one secure POST, carried it ────
    const carrying = requests.filter((request) => request.body.includes(MARKER));
    expect(carrying.map((request) => request.url)).toEqual([
      `${BASE}/api/askimate/secret/${requestId}`,
    ]);
    expect(carrying[0]?.method).toBe("POST");

    // ── 7–8. Spent through the sensitive capability, then destroyed ──────
    const consumed = await store.use(
      {
        handle: handle as SecretHandle,
        studentRef: `student-${String(userId)}` as never,
        purpose: "portal_account_creation",
        target: { host: PORTAL_HOST, caseRef: CASE_REF },
      },
      {
        name: "e2e_untraced_consumer" as never,
        confirmNoDiagnosticCapture: () => true,
      },
      (secret) => secret === MARKER,
      NOW,
    );
    expect(consumed.ok).toBe(true);
    if (consumed.ok) expect(consumed.result).toBe(true);
    expect(store.liveSecretCount).toBe(0);

    // ── 9. The handle cannot be reused ───────────────────────────────────
    const again = await store.use(
      {
        handle: handle as SecretHandle,
        studentRef: `student-${String(userId)}` as never,
        purpose: "portal_account_creation",
        target: { host: PORTAL_HOST, caseRef: CASE_REF },
      },
      { name: "e2e_untraced_consumer" as never, confirmNoDiagnosticCapture: () => true },
      () => true,
      NOW,
    );
    expect(again.ok).toBe(false);

    await page.close();
  }, 180_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The database
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("what reached PostgreSQL", () => {
  it("wrote rows at all, so an empty scan cannot pass by accident", async () => {
    const rows = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM askimate_secret_requests",
    );
    expect(Number(rows.rows[0]?.n ?? "0")).toBeGreaterThan(0);
  });

  it("has NO column, in any row, containing the marker", async () => {
    // Scanned column by column from `FREE_TEXT_COLUMNS`, so adding a text
    // column without thinking about it widens the scan rather than leaving a
    // blind spot.
    const leaked: string[] = [];
    for (const { table, column } of FREE_TEXT_COLUMNS) {
      const rows = await pool.query<{ value: string | null }>(
        `SELECT ${column}::text AS value FROM ${table}`,
      );
      if (rows.rows.some((row) => row.value?.includes(MARKER) === true)) {
        leaked.push(`${table}.${column}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it("scans EVERY text-ish column, not only the ones we listed", async () => {
    // The list above could go stale. This walks the live catalogue, so a column
    // added by a migration nobody told this test about is still scanned.
    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type IN ('text','character varying','json','jsonb')`,
    );
    expect(columns.rows.length).toBeGreaterThan(FREE_TEXT_COLUMNS.length - 1);

    const leaked: string[] = [];
    for (const { table_name, column_name } of columns.rows) {
      const rows = await pool.query<{ value: string | null }>(
        `SELECT "${column_name}"::text AS value FROM "${table_name}"`,
      );
      if (rows.rows.some((row) => row.value?.includes(MARKER) === true)) {
        leaked.push(`${table_name}.${column_name}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it("DOES persist the binding and the lifecycle word, which is the point", async () => {
    // A database with nothing in it would pass every scan above. This asserts
    // the row is real and says the true thing.
    const rows = await pool.query<{ lifecycle: string; handle: string | null }>(
      "SELECT lifecycle, handle FROM askimate_secret_requests ORDER BY id DESC LIMIT 1",
    );
    const row = rows.rows[0];
    expect(row?.lifecycle).toBe("secret_received");
    expect(row?.handle).toMatch(/^sh_[0-9a-f]{32}$/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Logs
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("what reached stdout and stderr", () => {
  /**
   * ── Why this test POSTs deliberately broken JSON ──────────────────────
   *
   * The first version of this section simply asserted the captured output did
   * not contain the marker, and it passed while capturing **zero bytes** — the
   * happy path logs nothing, so the scan was scanning an empty string. That is
   * the same vacuous-assertion failure this repository has already hit twice
   * (a trace scan that missed a zip, a store scan that could not see through a
   * private field), and it is not a test.
   *
   * So this drives the one path that DOES log, and it is also the path most
   * likely to leak. `express.json()` raises a `SyntaxError` whose message
   * embeds the offending input — "Unexpected token … in JSON at position 42" —
   * and `body-parser` attaches the whole raw body to the error as `err.body`.
   * The real AskiMate app has **no error-handling middleware at all**, so
   * Express's default handler runs, and outside production it sends the stack
   * to the client.
   *
   * A half-typed password in a malformed request is therefore a realistic way
   * for one to reach both a log line and an HTTP response body.
   */
  it("logs something when a request fails, and the marker is in none of it", async () => {
    const { requestId } = await openRequest();
    const token = jwt.sign(
      { id: userId, email: "student@example.test", emailVerified: true },
      JWT_SECRET,
    );

    const before = captured.length;
    const response = await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      // Malformed on purpose, with the marker inside it.
      body: `{"password": "${MARKER}", `,
    });
    const text = await response.text();

    // The error handler ran and logged. Without this the scan below is empty.
    expect(captured.length).toBeGreaterThan(before);
    const written = captured.slice(before).join("");
    expect(written.length).toBeGreaterThan(0);
    expect(written).toContain("SyntaxError");

    // And it named the error TYPE only.
    expect(written).not.toContain(MARKER);
    // The response, too — this is where Express's default handler would have
    // put the stack, and with it the body fragment.
    expect(text).not.toContain(MARKER);
    expect(response.status).toBe(400);
  }, 60_000);

  it("contains no trace of the marker in ANY captured output", () => {
    expect(captured.length).toBeGreaterThan(0);
    expect(captured.join("").includes(MARKER)).toBe(false);
  });

  it("measures where a parse error DOES carry the body — the actual finding", async () => {
    // ── What I expected, and what is actually true ────────────────────────
    //
    // I expected Express's default error handler to leak, because
    // `SyntaxError`'s message used to embed the offending input. Measured
    // against Express 5 + body-parser 2.3.0, it does not: the message names a
    // position, and the default handler sends the stack.
    //
    // The real finding is narrower and worse. `body-parser` attaches the raw
    // request body to the error as `err.body`, and `body` is an ENUMERABLE OWN
    // PROPERTY — so `JSON.stringify(err)` emits the password in full. That is
    // exactly what a structured logger does to a caught error.
    //
    // This test pins both halves. If Express ever starts leaking through the
    // message or the response, or stops attaching `body`, the report's finding
    // needs revising and this fails to say so.
    const captured: { fromStringify: string; fromMessage: string; fromResponse: string } =
      await new Promise((resolve) => {
        const bare = express();
        bare.use(express.json({ limit: "4kb" }));
        bare.post("/probe", (_req, res) => {
          res.json({ ok: true });
        });
        const handler: ErrorRequestHandler = (error, _req, res, _next) => {
          const asError = error as Error;
          res.status(400).end();
          resolve({
            fromStringify: stringifyError(error),
            fromMessage: `${asError.message}\n${asError.stack ?? ""}`,
            fromResponse: "",
          });
        };
        bare.use(handler);
        const probe = bare.listen(0, "127.0.0.1", () => {
          const address = probe.address();
          const port = typeof address === "object" && address !== null ? address.port : 0;
          void fetch(`http://127.0.0.1:${String(port)}/probe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: `{"password": "${MARKER}", `,
          }).finally(() => probe.close());
        });
      });

    // THE LEAK: serialising the error emits the whole raw body.
    expect(captured.fromStringify).toContain(MARKER);
    // NOT a leak: the message and the stack name a position, not the content.
    expect(captured.fromMessage).not.toContain(MARKER);
  }, 60_000);

  it("scrubs the body off the error, so a logger added later cannot emit it", () => {
    // The mitigation, tested on the real shape body-parser produces.
    const error = Object.assign(new SyntaxError("Expected double-quoted property name"), {
      body: `{"password": "${MARKER}", `,
      type: "entity.parse.failed",
      status: 400,
    });

    expect(JSON.stringify(error)).toContain(MARKER);
    scrubParseErrorBody(error);
    expect(JSON.stringify(error)).not.toContain(MARKER);
    expect(inspect(error, { depth: 5, showHidden: true })).not.toContain(MARKER);
    // The diagnosis survives. A scrub that destroyed the error would trade one
    // problem for another.
    expect(error.name).toBe("SyntaxError");
    expect((error as unknown as { type: string }).type).toBe("entity.parse.failed");
  });

  it("scrubs a FROZEN error too, rather than throwing inside the handler", () => {
    // A frozen error cannot have a property deleted. Throwing here would turn
    // a malformed request into a crash, so the fallback overwrites instead.
    const error = Object.freeze(
      Object.assign(new SyntaxError("frozen"), { body: `{"p":"${MARKER}"` }),
    );
    expect(() => scrubParseErrorBody(error)).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The chat transport
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the model funnel", () => {
  it("cannot copy a directive's contents into the prompt, because it has none", () => {
    const turns: ConversationEvent[] = [
      {
        kind: "message", ordinal: 1, createdAt: NOW.toISOString(),
        actor: "student", content: "I want to apply to Ulster",
      },
      {
        // The wire event carries the request, the channel and the expiry —
        // and NOT the title, the explanation or the portal host. Those are
        // text a model wrote about a password, and under ADR-0030 they never
        // reach this plane at all: the secure origin holds them and renders
        // them itself. There is nothing here to copy into a prompt.
        kind: "secret_requested", ordinal: 2, createdAt: NOW.toISOString(),
        requestId: "sr_00000000000000000000000000000000",
        channel: "secure_control",
        expiresAt: new Date(NOW.getTime() + 300_000).toISOString(),
      },
      {
        kind: "secret_received", ordinal: 3, createdAt: NOW.toISOString(),
        requestId: "sr_00000000000000000000000000000000",
        handle: "sh_00000000000000000000000000000abc",
      },
    ];
    const built = buildModelRequest({ utterance: "next", events: turns });
    expect(built.history.map((entry) => entry.content)).toEqual([
      "I want to apply to Ulster",
      "[A secure password box was shown to the student.]",
      "[secret_received · sh_00000000000000000000000000000abc]",
    ]);
  });

  it("refuses to persist a directive as message content", () => {
    // `askimate_messages.content` is text NOT NULL and everything in it is
    // replayed to the model on every later turn. A directive has nothing to
    // write, and rendering one into text would invent the very content this
    // design exists to avoid.
    expect(
      persistableContent({
        kind: "secret_received", ordinal: 1, createdAt: NOW.toISOString(),
        requestId: "sr_00000000000000000000000000000000", handle: "sh_00000000000000000000000000000000",
      }),
    ).toBeNull();
    expect(
      persistableContent({
        kind: "message", ordinal: 2, createdAt: NOW.toISOString(),
        actor: "student", content: "hello",
      }),
    ).toBe("hello");
  });
});
