/**
 * P6 — an account is really created on a portal, with a password nobody in this
 * system has ever seen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * This is the first consequential action the system performs on somebody
 * else's website, and it is performed here for real:
 *
 *   a real PostgreSQL           — the lifecycle, the use ledger, the outbox
 *   the real Secure Service     — including the student's own submit endpoint
 *   the real fill agent         — over real HTTP, behind the real mTLS stand-in
 *   a real Chromium             — owned by the runner, reached over real CDP
 *   the real GATED portal       — `startFixturePortal`: real cookies, real
 *                                 redirects, real `timingSafeEqual` password
 *                                 comparison, and a form that is unreachable
 *                                 without an account
 *   the real runner performer   — `createPortalAccount`, unchanged
 *
 * ── The assertion that matters ────────────────────────────────────────────
 *
 * `credentialsWork(email, password)` — asked of the PORTAL. Nothing in this
 * repository renders a password back, so the only way to establish that the
 * right characters reached the right box is to ask the site whether they let
 * you in. That is what a student would do, and it is the only check that could
 * not pass for the wrong reason.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { chromium, type Browser } from "playwright";
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
import {
  createPortalAccount,
  startFixturePortal,
  type FixturePortal,
} from "@askimate/aas-browser-runner";
import type { ClaimedWork } from "@askimate/aas-contracts";

import { LifecycleOutbox } from "./lifecycle-outbox.js";
import { MIGRATIONS_DIR } from "./index.js";
import { SECURE_SESSION_COOKIE } from "./routes.js";
import { SecureRequestStore } from "./requests.js";
import { createSecureApp } from "./app.js";

const SECURE_PORT = 4895;
const AGENT_PORT = 4896;
const CDP_PORT = 4897;
const SECURE = `http://127.0.0.1:${String(SECURE_PORT)}`;
const AGENT = `http://127.0.0.1:${String(AGENT_PORT)}`;
const PARENT = "http://127.0.0.1:4839";
const CONVERSATION_CERT = "conversation-service";
const AGENT_CERT = "secure-filler";
const RUNNER_CERT = "browser-runner";
const CONVERSATION = "01JBXQ8Z9WKTQ6M4H2NPB00060";
const STUDENT = "student-p6";
const CASE = "case-p6";
const EMAIL = "niloofar@example.test";
/** What the student types. It exists in this file, in the vault, and nowhere else. */
const PASSWORD = "P6-Tr0ub4dor-and-3-horses!";

/** The gated portal's registration form, served by a server that never answers it. */
const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Register</title></head>
<body><form method="post" action="/register">
  <label for="email">Email address</label>
  <input type="email" id="email" name="email" required>
  <label for="password">Password</label>
  <input type="password" id="password" name="password" required minlength="8">
  <label for="passwordConfirm">Confirm password</label>
  <input type="password" id="passwordConfirm" name="password_confirm" required minlength="8">
  <button type="submit" id="createAccount">Create account</button>
</form></body></html>`;

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("P6 — creating a real account on a gated portal");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let pool: pg.Pool;
let cache: InMemoryEnvelopeCache;
let secureServer: Server;
let agentServer: Server;
let portal: FixturePortal;
let runnerBrowser: Browser;
let cdpEndpoint: string;
let logLines: string[] = [];
let wire: { where: string; body: string }[] = [];

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
    await admin.query("DROP DATABASE IF EXISTS aas_account_e2e WITH (FORCE)");
    await admin.query("CREATE DATABASE aas_account_e2e");
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = "/aas_account_e2e";
  pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
  await migrate(pool, MIGRATIONS_DIR);

  cache = new InMemoryEnvelopeCache();
  const keys = new LocalDataKeyProvider();
  const submissionVault = new EnvelopeVault(keys, cache);
  const agentVault = new EnvelopeVault(keys, cache);

  portal = await startFixturePortal();

  const secureApp = createSecureApp({
    store: new SecureRequestStore(pool),
    vault: submissionVault,
    outbox: new LifecycleOutbox(pool),
    now: () => new Date(),
    selfOrigin: SECURE,
    parentOrigin: PARENT,
    logger: new SecureLogger((line) => logLines.push(line)),
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
        const headers = {
          ...(init?.headers as Record<string, string>),
          "x-service-cert": AGENT_CERT,
        };
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
  await portal.stop();
  await new Promise<void>((resolve) => agentServer.close(() => resolve()));
  await new Promise<void>((resolve) => secureServer.close(() => resolve()));
  await pool.end();
});

/** The conversation plane's half: open the request. No secret exists yet. */
async function open(targetHost: string): Promise<{ requestId: string; frameToken: string }> {
  const response = await recordingFetch(`${SECURE}/internal/v1/secret-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-service-cert": CONVERSATION_CERT },
    body: JSON.stringify({
      studentRef: STUDENT,
      conversationId: CONVERSATION,
      caseRef: CASE,
      purpose: "portal_account_creation",
      targetHost,
      title: "Choose a password for the university portal",
      explanation: "AskiMate types it once and cannot read it back.",
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
    headers: {
      "Content-Type": "application/json",
      Origin: SECURE,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ requestId, frameToken }),
  });
  expect(bootstrapped.status).toBe(204);
  const cookieValue = /__Host-secure_session=([^;]+)/.exec(
    bootstrapped.headers.get("set-cookie") ?? "",
  )?.[1];
  if (cookieValue === undefined) expect.unreachable("a session cookie should have been set");

  const submitted = await recordingFetch(`${SECURE}/v1/secret-requests/${requestId}/secret`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: SECURE,
      "Sec-Fetch-Site": "same-origin",
      Cookie: `${SECURE_SESSION_COOKIE}=${cookieValue}`,
    },
    body: JSON.stringify({
      secret: PASSWORD,
      confirmation: PASSWORD,
      conversationId: CONVERSATION,
    }),
  });
  const text = await submitted.text();
  expect(submitted.status, text).toBe(200);
  return (JSON.parse(text) as { handle: string }).handle;
}

/**
 * The work item, exactly as `RunDriver.claimWork` builds it from the reviewed
 * blueprint — with the fixture portal's real origin swapped in, which is what
 * `CatalogueEntry.portalOrigin` does in the service.
 */
/** The registration targets, as `RunDriver.claimWork` derives them. */
function targets(): NonNullable<ClaimedWork["registration"]> {
  return {
    url: `${portal.baseUrl}/register`,
    emailLocator: { strategy: "label", value: "Email address" },
    // From the gated blueprint, by NAME rather than by label — `getByLabel`
    // is non-exact, so "Password" also matches "Confirm password".
    passwordLocators: [
      { strategy: "name", value: "password" },
      { strategy: "name", value: "password_confirm" },
    ],
    submitLocator: { strategy: "role", value: "button:Create account" },
  };
}

function work(handle: string, over: Partial<ClaimedWork> = {}): ClaimedWork {
  return {
    leaseId: "wl_p6",
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    runId: "run_p6_1",
    caseId: CASE,
    studentRef: STUDENT,
    kind: "create_account",
    portalHost: portal.host,
    email: EMAIL,
    approach: "student_chosen",
    secretHandle: handle,
    registration: targets(),
    ...over,
  };
}

function deps(): Parameters<typeof createPortalAccount>[1] {
  return {
    browser: runnerBrowser,
    browserEndpoint: cdpEndpoint,
    agentBaseUrl: AGENT,
    serviceToken: RUNNER_CERT,
    fetch: recordingFetch as unknown as typeof globalThis.fetch,
  };
}

describeIfDatabase("the student gets an account, and only they know the password", () => {
  it("creates one on a REAL gated portal, with both boxes filled from ONE handle", async () => {
    wire = [];
    logLines = [];
    const { requestId, frameToken } = await open(portal.host);
    const handle = await submitSecret(requestId, frameToken);

    const outcome = await createPortalAccount(work(handle), deps());
    expect(outcome).toEqual({ kind: "succeeded" });

    // ── Asked of the PORTAL, which is the only source that could say no ──
    expect(portal.accounts()).toEqual([EMAIL]);
    expect(
      portal.credentialsWork(EMAIL, PASSWORD),
      "the password the student typed is the password the account has",
    ).toBe(true);
    expect(portal.credentialsWork(EMAIL, "something-else"), "and nothing else works").toBe(false);

    // The portal's own confirmation check passed, which is only possible if
    // BOTH boxes got the same characters — from one handle, spent once.
    expect(cache.rawEntries(), "the handle is gone").toHaveLength(0);

    // Nothing was submitted. ADR-0014, and the portal is the one asserting it.
    expect(portal.submissions()).toEqual([]);
  }, 180_000);

  it("puts the password on NO wire between any two processes", () => {
    // Every HTTP body that crossed a service boundary during the run above, in
    // both directions. The student's own submission is the ONE place it
    // legitimately appears, travelling towards the endpoint designed to take
    // it — "exactly one" rather than "none", because a scan finding zero would
    // mean the recording was broken and would pass for the wrong reason.
    const carrying = wire.filter((entry) => entry.body.includes(PASSWORD));
    expect(carrying, "the recording must have caught the submission").toHaveLength(1);
    expect(carrying[0]?.where).toMatch(
      new RegExp(`^→ ${SECURE}/v1/secret-requests/sr_[0-9a-f]{32}/secret$`),
    );

    // And the run that FOLLOWED the submission — the agent asking for authority,
    // the service answering, the runner being told it worked — carries nothing.
    const afterSubmission = wire.slice(wire.indexOf(carrying[0]!) + 2);
    expect(afterSubmission.filter((entry) => entry.body.includes(PASSWORD))).toEqual([]);
  });

  it("writes the password into NO log line", () => {
    const log = logLines.join("\n");
    expect(log).not.toContain(PASSWORD);

    // No FRAGMENT of it either. A whole-string search would miss a log line
    // that truncated, and truncation is exactly what a well-meaning "log the
    // first few characters for debugging" change looks like.
    for (let at = 0; at + 6 <= PASSWORD.length; at += 1) {
      expect(log, `no run of the password may appear`).not.toContain(PASSWORD.slice(at, at + 6));
    }

    // And no field that would state a fact ABOUT it. Checked as key names
    // rather than as a value: `String(PASSWORD.length)` is "26", which occurs
    // inside any hex request id — an assertion that fails for that reason
    // teaches nothing and gets deleted.
    for (const line of logLines) {
      for (const forbidden of ["length=", "size=", "strength=", "chars=", "secret="]) {
        expect(line, `a log line may not state ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("reports UNCERTAIN when the portal stops answering mid-submit", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Written after a deliberate regression was NOT detected: changing this
    // outcome from `uncertain` to `failed` broke nothing, because no test ever
    // reached a click that did not land.
    //
    // It is the most consequential distinction in the whole mechanism. The
    // click may have reached the portal and the account may exist; this process
    // simply stopped being able to tell. `failed` asserts that nothing happened
    // on a university's system — a claim about somebody else's database that
    // nobody here is entitled to make. `uncertain` leaves the Application
    // Plane's uncertainty window open, which is what ADR-0008 built it for.
    // ═══════════════════════════════════════════════════════════════════
    //
    // A portal that serves the form and then never answers the POST. Not a
    // contrived failure: it is what a portal under load, or behind a proxy
    // that drops the connection, looks like from here.
    const registration = await new Promise<{ url: string; host: string; close: () => void }>(
      (resolve) => {
        const hanging = createServer((request, response) => {
          if (request.method === "POST") return; // never answers, never closes
          response.writeHead(200, { "content-type": "text/html" }).end(FORM);
        });
        hanging.listen(0, "127.0.0.1", () => {
          const address = hanging.address();
          if (address === null || typeof address === "string") throw new Error("no port");
          resolve({
            url: `http://127.0.0.1:${String(address.port)}/register`,
            host: `127.0.0.1:${String(address.port)}`,
            close: () => hanging.closeAllConnections(),
          });
        });
      },
    );

    const { requestId, frameToken } = await open(registration.host);
    const handle = await submitSecret(requestId, frameToken);
    try {
      const outcome = await createPortalAccount(
        work(handle, {
          portalHost: registration.host,
          registration: { ...targets(), url: registration.url },
        }),
        deps(),
      );
      expect(outcome).toEqual({ kind: "uncertain", failure: "runner_fault" });

      // The password WAS typed and the handle IS spent — which is exactly why
      // the answer has to be "we do not know" rather than "nothing happened".
      // Asked of the vault by lookup, because an envelope does not carry the
      // handle it is filed under.
      const spent = await new EnvelopeVault(new LocalDataKeyProvider(), cache).use(
        handle,
        () => Promise.resolve(true),
        new Date(),
      );
      expect(spent.ok, "a spent handle cannot be used again").toBe(false);
    } finally {
      registration.close();
    }
  }, 180_000);

  it("REFUSES a registration URL that is not on the bound host", async () => {
    // The plane checks this too. This check is the one made by the process that
    // is about to navigate — so it is about the thing that actually happens.
    const { requestId, frameToken } = await open(portal.host);
    const handle = await submitSecret(requestId, frameToken);
    const before = portal.requests.length;

    const outcome = await createPortalAccount(
      work(handle, {
        registration: { ...targets(), url: "http://127.0.0.1:1/register" },
      }),
      deps(),
    );
    expect(outcome).toEqual({ kind: "failed", failure: "portal_drift" });
    // No browser was opened at it, and the handle was never spent.
    expect(portal.requests.length).toBe(before);
    expect(cache.rawEntries(), "a refused target must not cost a password").toHaveLength(1);
  }, 120_000);

  it("does NOT create an account when the password cannot be typed", async () => {
    // A drifted password selector. The account must not be created without one:
    // an account with no password is an account the student cannot sign in to,
    // and the portal would still hold their email address.
    const { requestId, frameToken } = await open(portal.host);
    const handle = await submitSecret(requestId, frameToken);
    const other = "someone.else@example.test";

    const outcome = await createPortalAccount(
      work(handle, {
        email: other,
        registration: { ...targets(), passwordLocators: [{ strategy: "name", value: "not_a_field" }] },
      }),
      deps(),
    );
    expect(outcome).toEqual({ kind: "failed", failure: "portal_drift" });
    expect(portal.accounts(), "no account for a run that could not set a password").not.toContain(
      other,
    );
    // And the student is not asked again: the handle was never spent.
    expect(cache.rawEntries()).toHaveLength(2);
  }, 120_000);

  it("reports a portal that REFUSES, without carrying what it said", async () => {
    // The same email twice. The portal answers 409 and re-renders the form with
    // its own error text — text this plane must never carry, because a site we
    // do not control writes it.
    const { requestId, frameToken } = await open(portal.host);
    const handle = await submitSecret(requestId, frameToken);

    const outcome = await createPortalAccount(work(handle), deps());
    expect(outcome).toEqual({ kind: "failed", failure: "portal_refused" });
    // A closed-set word and nothing else. There is no field on the outcome that
    // could hold the portal's sentence, which is why.
    expect(Object.keys(outcome).sort()).toEqual(["failure", "kind"]);
    expect(portal.accounts()).toEqual([EMAIL]);
  }, 120_000);
});
