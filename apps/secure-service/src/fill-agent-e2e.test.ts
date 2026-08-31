/**
 * Student submission → vault → fill agent → a real field, with nothing that
 * could carry a value on any wire in between.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-30, on what this phase had to prove:
 *
 *   *"real integration coverage from secure submission through single-use
 *   consumption"* and *"deliberate regression tests proving plaintext cannot
 *   accidentally cross the HTTP/service boundary"*.
 *
 * So this runs the whole path with nothing faked that could make it easy:
 *
 *   a real PostgreSQL          — the lifecycle, the use ledger and the outbox
 *   the real Secure Service    — including the student-facing submit endpoint,
 *                                reached through the real frame bootstrap
 *   the real fill agent        — over real HTTP, with the real mTLS stand-in
 *   a real Chromium            — owned by something else, reached over real CDP
 *   the real runner client     — `fillSecret`, from apps/browser-runner
 *
 * It lives in this app rather than in the agent's own because the assertions
 * need SQL, and `apps/secure-filler` is forbidden a database driver — the agent
 * settles a lifecycle by ASKING this service, and a `pg` in its tree, even a
 * dev one, would be a template for it writing to a plane it does not own.
 *
 * ── Every byte on every wire is recorded ──────────────────────────────────
 *
 * `wire` captures the body of every HTTP message between the runner, the agent
 * and the secure service, in both directions. The last test asserts that the
 * password appears in NONE of them. That is the claim this whole phase exists
 * to support, and it is checked against traffic rather than against the shape
 * of a type.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer } from "node:http";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import {
  EnvelopeVault,
  InMemoryEnvelopeCache,
  LocalDataKeyProvider,
} from "@askimate/aas-secrets";
import { SecureLogger } from "@askimate/aas-secure-logging";
import { createFillAgentApp, httpUseAuthoriser } from "@askimate/aas-secure-filler";
import { fillSecret, openSensitiveContext } from "@askimate/aas-browser-runner";

import { LifecycleOutbox } from "./lifecycle-outbox.js";
import { MIGRATIONS_DIR } from "./index.js";
import { SECURE_SESSION_COOKIE } from "./routes.js";
import { SecureRequestStore } from "./requests.js";
import { createSecureApp } from "./app.js";

const SECURE_PORT = 4891;
const AGENT_PORT = 4892;
const PAGE_PORT = 4893;
const CDP_PORT = 4894;
const SECURE = `http://127.0.0.1:${String(SECURE_PORT)}`;
const AGENT = `http://127.0.0.1:${String(AGENT_PORT)}`;
const PARENT = "http://127.0.0.1:4839";
const PAGE_HOST = `127.0.0.1:${String(PAGE_PORT)}`;
const CONVERSATION_CERT = "conversation-service";
const AGENT_CERT = "secure-filler";
const RUNNER_CERT = "browser-runner";
const CONVERSATION = "01JBXQ8Z9WKTQ6M4H2NPB00042";
const MARKER = "END-TO-END-PASSWORD-MARKER-99!";

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the Secure Plane fill agent, end to end");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Register</title></head>
<body><label for="pw">Password</label><input id="pw" name="pw" type="password"></body></html>`;

let pool: pg.Pool;
let cache: InMemoryEnvelopeCache;
let secureServer: Server;
let agentServer: Server;
let pageServer: Server;
let runnerBrowser: Browser;
let cdpEndpoint: string;
let logLines: string[] = [];
/** Every HTTP body that crossed a service boundary, in both directions. */
let wire: { where: string; body: string }[] = [];

/**
 * `fetch`, with both halves of every exchange recorded.
 *
 * Wrapping rather than sniffing the socket: the bodies are what a mis-designed
 * contract would leak, and a recorded body is something an assertion can read.
 */
const recordingFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  if (typeof init?.body === "string") wire.push({ where: `→ ${url}`, body: init.body });
  const response = await globalThis.fetch(input, init);
  wire.push({
    where: `← ${url} ${String(response.status)}`,
    body: await response.clone().text(),
  });
  return response;
};

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query("DROP DATABASE IF EXISTS aas_filler_e2e WITH (FORCE)");
    await admin.query("CREATE DATABASE aas_filler_e2e");
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = "/aas_filler_e2e";
  pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
  await migrate(pool, MIGRATIONS_DIR);

  // ── One cache, one key provider, TWO vaults ─────────────────────────────
  //
  // In production these are one Valkey and one KMS key, reached by two ECS
  // tasks. The secure service only ever calls `put`; the agent only ever calls
  // `use`. Nothing passes a value between them.
  cache = new InMemoryEnvelopeCache();
  const keys = new LocalDataKeyProvider();
  const submissionVault = new EnvelopeVault(keys, cache);
  const agentVault = new EnvelopeVault(keys, cache);

  const store = new SecureRequestStore(pool);
  const secureApp = createSecureApp({
    store,
    vault: submissionVault,
    outbox: new LifecycleOutbox(pool),
    now: () => new Date(),
    selfOrigin: SECURE,
    parentOrigin: PARENT,
    logger: new SecureLogger((line) => logLines.push(line)),
    // The certificate that may settle a use belongs to the AGENT. The runner's
    // does not appear here at all, which is the deployment half of ADR-0042.
    authoriseService: (req) =>
      req.header("x-service-cert") === CONVERSATION_CERT ||
      req.header("x-service-cert") === AGENT_CERT,
  });
  secureServer = await new Promise<Server>((resolve) => {
    const listening = secureApp.listen(SECURE_PORT, "127.0.0.1", () => resolve(listening));
  });

  const agentApp = createFillAgentApp({
    vault: agentVault,
    authorise: httpUseAuthoriser({
      baseUrl: SECURE,
      serviceToken: AGENT_CERT,
      fetch: ((input: string, init?: RequestInit) => {
        // The agent presents its own certificate, not the runner's.
        const headers = { ...(init?.headers as Record<string, string>), "x-service-cert": AGENT_CERT };
        return recordingFetch(input, { ...init, headers });
      }) as unknown as typeof globalThis.fetch,
    }),
    connect: (endpoint: string) => chromium.connectOverCDP(endpoint),
    now: () => new Date(),
    logger: new SecureLogger((line) => logLines.push(line)),
    authoriseService: (req) => req.header("x-aas-service") === RUNNER_CERT,
  });
  agentServer = await new Promise<Server>((resolve) => {
    const listening = agentApp.listen(AGENT_PORT, "127.0.0.1", () => resolve(listening));
  });

  pageServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  });
  await new Promise<void>((resolve) => pageServer.listen(PAGE_PORT, "127.0.0.1", resolve));

  runnerBrowser = await chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${String(CDP_PORT)}`, "--remote-debugging-address=127.0.0.1"],
  });
  const version = (await (
    await fetch(`http://127.0.0.1:${String(CDP_PORT)}/json/version`)
  ).json()) as { webSocketDebuggerUrl: string };
  cdpEndpoint = version.webSocketDebuggerUrl;
}, 180_000);

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  await runnerBrowser.close();
  await new Promise<void>((resolve) => pageServer.close(() => resolve()));
  await new Promise<void>((resolve) => agentServer.close(() => resolve()));
  await new Promise<void>((resolve) => secureServer.close(() => resolve()));
  await pool.end();
});

/** The conversation service's half: open a request. No secret exists yet. */
async function open(): Promise<{ requestId: string; frameToken: string }> {
  const response = await recordingFetch(`${SECURE}/internal/v1/secret-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-service-cert": CONVERSATION_CERT },
    body: JSON.stringify({
      studentRef: "student-1",
      conversationId: CONVERSATION,
      caseRef: "case-1",
      purpose: "portal_account_creation",
      targetHost: PAGE_HOST,
      title: "Choose a password for the university portal",
      explanation: "AskiMate will use it once and cannot read it back.",
      ttlSeconds: 300,
    }),
  });
  const text = await response.text();
  expect(response.status, text).toBe(201);
  return JSON.parse(text) as { requestId: string; frameToken: string };
}

/** The student's half: bootstrap the frame session, then submit the password. */
async function submitSecret(requestId: string, frameToken: string): Promise<string> {
  const bootstrapped = await recordingFetch(`${SECURE}/v1/frame-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SECURE, "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ requestId, frameToken }),
  });
  expect(bootstrapped.status).toBe(204);
  const cookieValue = /__Host-secure_session=([^;]+)/.exec(
    bootstrapped.headers.get("set-cookie") ?? "",
  )?.[1];
  if (cookieValue === undefined) expect.unreachable("a session cookie should have been set");
  const cookie = `${SECURE_SESSION_COOKIE}=${cookieValue}`;

  const submitted = await recordingFetch(`${SECURE}/v1/secret-requests/${requestId}/secret`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: SECURE,
      "Sec-Fetch-Site": "same-origin",
      Cookie: cookie,
    },
    body: JSON.stringify({ secret: MARKER, confirmation: MARKER, conversationId: CONVERSATION }),
  });
  const text = await submitted.text();
  expect(submitted.status, text).toBe(200);
  return (JSON.parse(text) as { handle: string }).handle;
}

/** The runner's page, opened the way the runner opens one. */
async function runnerPage(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await openSensitiveContext(runnerBrowser, { userAgent: "test" });
  const page = await context.newPage();
  await page.goto(`http://${PAGE_HOST}/register`);
  return { context, page };
}

describeIfDatabase("submission to consumption, across three processes", () => {
  it("fills the field, settles the lifecycle, and spends the handle exactly once", async () => {
    wire = [];
    logLines = [];
    const { requestId, frameToken } = await open();
    const handle = await submitSecret(requestId, frameToken);

    const { context, page } = await runnerPage();
    try {
      const outcome = await fillSecret({
        page,
        claim: {
          handle,
          studentRef: "student-1",
          caseRef: "case-1",
          purpose: "portal_account_creation",
          targetHost: PAGE_HOST,
        },
        locators: [{ strategy: "css", value: "#pw" }],
        agentBaseUrl: AGENT,
        browserEndpoint: cdpEndpoint,
        serviceToken: RUNNER_CERT,
        fetch: recordingFetch as unknown as typeof globalThis.fetch,
      });
      expect(outcome).toEqual({ ok: true, handleSpent: true });

      // The characters are in the portal's field.
      expect(await page.locator("#pw").inputValue()).toBe(MARKER);

      // The secure plane's own record says the request is settled.
      const settled = await pool.query<{ lifecycle: string }>(
        "SELECT lifecycle FROM secret_requests WHERE request_id = $1",
        [requestId],
      );
      expect(settled.rows[0]?.lifecycle).toBe("secret_consumed");

      // Exactly one use, recorded as used, by the agent's consumer label.
      const uses = await pool.query<{ outcome: string; consumer: string }>(
        "SELECT outcome, consumer FROM secret_uses WHERE request_id = $1",
        [requestId],
      );
      expect(uses.rows.map((row) => row.outcome)).toEqual(["used"]);

      // And the conversation plane is told, through the outbox — one row per
      // transition, both of them, and NOTHING else. `secret_received` was
      // enqueued when the student submitted; `secret_consumed` when the agent
      // spent it. Two words, no value, and the unique constraint on
      // (request_id, kind) is what stops a retry writing a third.
      const outbox = await pool.query<{ kind: string }>(
        "SELECT kind FROM lifecycle_outbox WHERE request_id = $1 ORDER BY id",
        [requestId],
      );
      expect(outbox.rows.map((row) => row.kind)).toEqual([
        "secret_received",
        "secret_consumed",
      ]);

      // ── Single use, through the whole stack ─────────────────────────────
      await page.locator("#pw").fill("");
      const second = await fillSecret({
        page,
        claim: {
          handle,
          studentRef: "student-1",
          caseRef: "case-1",
          purpose: "portal_account_creation",
          targetHost: PAGE_HOST,
        },
        locators: [{ strategy: "css", value: "#pw" }],
        agentBaseUrl: AGENT,
        browserEndpoint: cdpEndpoint,
        serviceToken: RUNNER_CERT,
        fetch: recordingFetch as unknown as typeof globalThis.fetch,
      });
      expect(second.ok).toBe(false);
      expect(second.reason).toBe("not_authorised");
      expect(await page.locator("#pw").inputValue()).toBe("");
    } finally {
      await context.close();
    }
  }, 180_000);

  it("puts the password on NO wire between any two processes", () => {
    // The regression this phase exists to make impossible. It reads the bodies
    // actually exchanged in the test above — a request or response shape that
    // grew a value-bearing field would fail here even if every type still
    // compiled.
    //
    // Non-vacuous by construction: the traffic must be substantial, and the
    // password must appear EXACTLY ONCE. A scan finding zero occurrences would
    // mean the recording was broken, and would pass for the wrong reason.
    expect(wire.length).toBeGreaterThan(6);
    const carrying = wire.filter((message) => message.body.includes(MARKER));
    expect(carrying).toHaveLength(1);

    // The one that carries it is the student's own submission, travelling
    // TOWARDS the one endpoint in AskiMate designed to receive a password.
    const only = carrying[0];
    if (only === undefined) expect.unreachable("one message should carry it");
    expect(only.where.startsWith("\u2192 ")).toBe(true);
    expect(only.where.endsWith("/secret")).toBe(true);
    expect(only.where).toContain(SECURE);

    // No RESPONSE, anywhere, in either direction, from either service.
    for (const message of wire.filter((m) => m.where.startsWith("\u2190"))) {
      expect(message.body, `${message.where} carries the secret`).not.toContain(MARKER);
    }
    // And nothing at all on the two boundaries this phase created.
    for (const message of wire) {
      if (message.where.includes("/secret-fills") || message.where.includes("/secret-uses")) {
        expect(message.body, `${message.where} carries the secret`).not.toContain(MARKER);
      }
    }
    // Both of those boundaries were actually exercised, so the loop above is
    // not iterating over an empty list.
    expect(wire.some((m) => m.where.includes("/secret-fills"))).toBe(true);
    expect(wire.some((m) => m.where.includes("/secret-uses"))).toBe(true);
  });

  it("puts the password in NO log line either service wrote", () => {
    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.join("\n")).not.toContain(MARKER);
    // The lines are still saying something — otherwise this passes vacuously.
    expect(logLines.join("\n")).toContain("secret_spent");
  });

  it("puts the password in NO column of the secure plane's database", async () => {
    // Read from information_schema rather than from a list of tables someone
    // remembered to update: a table added later is scanned automatically.
    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, column_name`,
    );
    expect(columns.rowCount).toBeGreaterThan(0);
    for (const { table_name, column_name } of columns.rows) {
      const found = await pool.query<{ hit: string }>(
        `SELECT CAST("${column_name}" AS TEXT) AS hit FROM "${table_name}"
          WHERE CAST("${column_name}" AS TEXT) LIKE $1`,
        [`%${MARKER}%`],
      );
      expect(found.rowCount, `${table_name}.${column_name} holds the secret`).toBe(0);
    }
  });
});
