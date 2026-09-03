/**
 * P7 — the first real end-to-end execution journey.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A student asks. AskiMate interviews them, decides an account is needed, asks
 * the Secure Plane to open a password box, learns a handle exists, and hands a
 * unit of work to an Automation Runner — which opens a browser, has the Secure
 * Plane's agent type the password into both boxes, creates the account on a
 * real portal, and reports back.
 *
 * Nothing in that sentence is simulated:
 *
 *   a real PostgreSQL       — two schemas, in the databases their planes own
 *   the real Conversation Service — the run driver, the catalogue, the log
 *   the real Secure Service — including the student's own submit endpoint
 *   the real fill agent     — over real HTTP, behind the real mTLS stand-in
 *   a real Chromium         — the runner's, reached by the agent over real CDP
 *   the real gated portal   — real cookies, real redirects, `timingSafeEqual`
 *   the real intake loop    — `runOneTurn`, over real HTTP, with the real
 *                             `createPortalAccount` performer
 *
 * It lives in `scripts/` beside `end-to-end.test.ts` for a boundary reason
 * rather than a stylistic one: this needs the Conversation Plane's model client
 * AND the Secure Plane's vault AND the runner's Playwright, and no APP may
 * depend on all three — `apps/secure-service` is forbidden `@askimate/aas-llm`,
 * and `apps/conversation-service` is forbidden `@askimate/aas-secrets`. Those
 * rules are the architecture; a harness that ships nothing is the right place
 * for the one thing that has to see across them.
 *
 * ── Where this stops, and why ─────────────────────────────────────────────
 *
 * At the account. Filling the application form is the orchestrator's `execute`
 * step, and `WORK_KINDS` deliberately does not carry it: a `FillPlan`'s
 * instructions hold `ConfirmedValue`s, which may only be minted inside
 * `packages/profile`, and the runner may not depend on that package (ADR-0004,
 * ADR-0045). Submission is further still and out of scope by ADR-0014 — which
 * the portal itself asserts at the end of this file.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createHash } from "node:crypto";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { chromium, type Browser } from "playwright";

import { PostgresCaseStore } from "@askimate/aas-case-store/postgres";
import { PostgresWorkflowRunStore } from "@askimate/aas-case-store/postgres-workflow";
import { MIGRATIONS_DIR as CASE_MIGRATIONS } from "@askimate/aas-case-store";
import { proposeValue, studentId as makeStudentId } from "@askimate/aas-domain";
import type { ConfirmedProfile, ProfileFieldKey, ProfileFieldType } from "@askimate/aas-profile";
import {
  applyConfirmation,
  confirmField,
  emptyProfile,
  isDeclined,
  toStoredEntry,
} from "@askimate/aas-profile";
import { DeterministicModelClient } from "@askimate/aas-llm";
import { checkUsable, planFill } from "@askimate/aas-mapping";
import { buildPreview } from "@askimate/aas-preparation";
import { caseId as makeCaseId } from "@askimate/aas-domain";
import {
  GATED_PORTAL_BLUEPRINT,
  GATED_PORTAL_MAPPING_SET,
} from "@askimate/aas-mapping/fixtures/gated";
import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import {
  EnvelopeVault,
  InMemoryEnvelopeCache,
  LocalDataKeyProvider,
} from "@askimate/aas-secrets";
import { SecureLogger } from "@askimate/aas-secure-logging";
import { startWorker } from "@askimate/aas-worker";
import { createFillAgentApp, httpUseAuthoriser } from "@askimate/aas-secure-filler";
import {
  createPortalAccount,
  fillApplication,
  httpWorkIntake,
  openSensitiveContext,
  PlaywrightPreparationSession,
  runOneTurn,
  startFixturePortal,
  type FixturePortal,
} from "@askimate/aas-browser-runner";
import type { BrowserContext, Page } from "playwright";
import {
  ApplicationBindingStore,
  ConversationEventStore,
  PostgresConfirmedProfileStore,
  RunDriver,
  StudentIdentityStore,
  WorkLeaseStore,
  createConversationApp,
  MIGRATIONS_DIR as CONVERSATION_MIGRATIONS,
  httpSecureRequestOpener,
  issueSession,
  type ApplicationCatalogue,
  type CatalogueEntry,
} from "@askimate/aas-conversation-service";
import {
  LifecycleOutbox,
  SecureRequestStore,
  createSecureApp,
  SECURE_SESSION_COOKIE,
  MIGRATIONS_DIR as SECURE_MIGRATIONS,
} from "@askimate/aas-secure-service";

const CONVERSATION_PORT = 4901;
const SECURE_PORT = 4902;
const AGENT_PORT = 4905;
const CDP_PORT = 4906;
const CONVERSATION_URL = `http://127.0.0.1:${String(CONVERSATION_PORT)}`;
const SECURE = `http://127.0.0.1:${String(SECURE_PORT)}`;
const AGENT = `http://127.0.0.1:${String(AGENT_PORT)}`;
const CONVERSATION_CERT = "conversation-service";
const AGENT_CERT = "secure-filler";
const RUNNER_CERT = "browser-runner";
const SECURE_CERT = "secure-service";
const CONVERSATION = "01JBXQ8Z9WKTQ6M4H2NPD00001";
const BLUEPRINT = "bp-gated-portal";
const EMAIL = "niloofar@example.test";
/** What the student types into the secure box. Nothing else in this file has it. */
const PASSWORD = "Journey-Tr0ub4dor-3-horses!";
const STATEMENT = "Please apply to the MSc for me.";
const SESSION_SECRET = "a-journey-session-secret-long-enough";

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("P7 — the first real end-to-end execution journey");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let conversationPool: pg.Pool;
let securePool: pg.Pool;
let conversationServer: Server;
let secureServer: Server;
let agentServer: Server;
let portal: FixturePortal;
let runnerBrowser: Browser;
let cdpEndpoint: string;
let cache: InMemoryEnvelopeCache;
let studentUuid: string;
let logLines: string[] = [];
let wire: { where: string; body: string }[] = [];
/**
 * The runner's context for this case, opened once and kept.
 *
 * Creating the account SIGNS THE STUDENT IN — the portal sets a session cookie
 * exactly as it would for a person — and the application form is unreachable
 * without it. A runner that opened a fresh context to fill would arrive logged
 * out with no way back, because the password was single-use and is gone.
 */
let caseContext: BrowserContext;
let casePage: Page;
/** The profile as the interview confirmed it. The preview hashes this one. */
let journeyProfile: ConfirmedProfile;
/** Held so a restarted instance can be rebuilt from the same reviewed inputs. */
let journeyCatalogue: ApplicationCatalogue;
let journeySecureRequests: ReturnType<typeof httpSecureRequestOpener>;

const recordingFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  if (typeof init?.body === "string") wire.push({ where: `→ ${url}`, body: init.body });
  const response = await globalThis.fetch(input, init);
  wire.push({ where: `← ${url} ${String(response.status)}`, body: await response.clone().text() });
  return response;
};

async function ownDatabase(name: string): Promise<pg.Pool> {
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  return new pg.Pool({ connectionString: url.toString(), max: 8 });
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;

  // ── TWO databases, with separate credentials in production (ADR-0037) ────
  conversationPool = await ownDatabase("aas_journey_conversation");
  securePool = await ownDatabase("aas_journey_secure");
  await migrate(conversationPool, CASE_MIGRATIONS);
  await migrate(conversationPool, CONVERSATION_MIGRATIONS);
  await migrate(securePool, SECURE_MIGRATIONS);

  portal = await startFixturePortal();

  cache = new InMemoryEnvelopeCache();
  const keys = new LocalDataKeyProvider();
  const submissionVault = new EnvelopeVault(keys, cache);
  const agentVault = new EnvelopeVault(keys, cache);

  const secureApp = createSecureApp({
    store: new SecureRequestStore(securePool),
    vault: submissionVault,
    outbox: new LifecycleOutbox(securePool),
    now: () => new Date(),
    selfOrigin: SECURE,
    parentOrigin: CONVERSATION_URL,
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
      fetch: ((input: string, init?: RequestInit) =>
        recordingFetch(input, {
          ...init,
          headers: {
            ...(init?.headers as Record<string, string>),
            "x-service-cert": AGENT_CERT,
          },
        })) as unknown as typeof globalThis.fetch,
    }),
    connect: (endpoint: string) => chromium.connectOverCDP(endpoint),
    now: () => new Date(),
    logger: new SecureLogger((line) => logLines.push(line)),
    authoriseService: (req) => req.header("x-aas-service") === RUNNER_CERT,
  });
  agentServer = await new Promise<Server>((resolve) => {
    const listening = agentApp.listen(AGENT_PORT, "127.0.0.1", () => resolve(listening));
  });

  // ── The catalogue: the reviewed blueprint, at the deployment's origin ────
  const entry: CatalogueEntry = {
    blueprint: GATED_PORTAL_BLUEPRINT,
    mappingSet: GATED_PORTAL_MAPPING_SET,
    requiredDocuments: [],
    institutionRef: "inst-gated",
    courseRef: "course-msc-controlled",
    intakeRef: "2026-09",
    // The portal listens on an ephemeral port, so this is where its real
    // location is stated. The reviewed blueprint is not rewritten.
    portalOrigin: portal.baseUrl,
    portalAuthentication: {
      portalHost: portal.host,
      discoveryRunId: "run-gated-1",
      observedAt: new Date("2026-08-30T09:00:00Z"),
      applicantChoosesPassword: true,
      portalIssuesCredential: false,
      passwordlessAvailable: false,
      emailVerificationRequired: false,
      mfaOrOtpRequired: false,
      captchaPresent: false,
      passwordResetAvailable: true,
      credentialsCanBeHandedBack: true,
    },
    // The deliberate choice to use the Secure Plane. Absent would mean the
    // student opens the portal themselves and AskiMate never holds a password.
    passwordDelivery: "askimate_secure_channel",
  };
  journeyCatalogue = {
    find: (id) => Promise.resolve(id === BLUEPRINT ? entry : null),
  };

  const store = new ConversationEventStore(conversationPool);
  journeySecureRequests = httpSecureRequestOpener({
    baseUrl: SECURE,
    serviceToken: CONVERSATION_CERT,
    fetch: recordingFetch as unknown as typeof globalThis.fetch,
  });
  const driver = new RunDriver({
    stores: {
      cases: new PostgresCaseStore(conversationPool),
      runs: new PostgresWorkflowRunStore(conversationPool),
    },
    bindings: new ApplicationBindingStore(conversationPool),
    catalogue: journeyCatalogue,
    model: new DeterministicModelClient(),
    profiles: new PostgresConfirmedProfileStore(conversationPool),
    conversations: store,
    secureRequests: journeySecureRequests,
    identities: new StudentIdentityStore(conversationPool),
    leases: new WorkLeaseStore(conversationPool),
    now: () => new Date(),
  });
  const conversationApp = createConversationApp({
    store,
    sessionSecret: SESSION_SECRET,
    authorise: () => Promise.resolve(true),
    // Two certificates, each for its own endpoints (ADR-0037, ADR-0045): the
    // Secure Interaction Service's for the internal append, and the Automation
    // Runner's for claim and report. Written as one predicate here because the
    // per-endpoint split is the deployment's (a mesh policy), not this app's.
    authoriseService: (req) =>
      req.header("x-service-cert") === SECURE_CERT ||
      req.header("x-service-cert") === RUNNER_CERT,
    now: () => new Date(),
    runs: driver,
    secureRequests: journeySecureRequests,
    secureOrigin: SECURE,
  });
  conversationServer = await new Promise<Server>((resolve) => {
    const listening = conversationApp.listen(CONVERSATION_PORT, "127.0.0.1", () =>
      resolve(listening),
    );
  });

  const student = await conversationPool.query<{ id: string }>(
    "INSERT INTO students (subject, email_verified) VALUES ('oidc-journey', true) RETURNING id",
  );
  studentUuid = student.rows[0]!.id;
  await conversationPool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
    CONVERSATION,
    studentUuid,
  ]);

  // The student's own session, minted by the service's own issuer rather than
  // by a cookie string assembled here — the format is `session.ts`'s to own.
  devCookie = (issueSession(studentUuid, SESSION_SECRET).split(";")[0] ?? "").trim();

  runnerBrowser = await chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${String(CDP_PORT)}`, "--remote-debugging-address=127.0.0.1"],
  });
  const version = (await (
    await fetch(`http://127.0.0.1:${String(CDP_PORT)}/json/version`)
  ).json()) as { webSocketDebuggerUrl: string };
  cdpEndpoint = version.webSocketDebuggerUrl;
  caseContext = await openSensitiveContext(runnerBrowser, { userAgent: "AskiMate-Runner/1.0" });
  casePage = await caseContext.newPage();

  // ── The interview, answered ─────────────────────────────────────────────
  //
  // Through `applyConfirmation` and the real store, which is the path the
  // interview surface takes. Written here rather than driven through the chat
  // endpoint because the journey under test starts at "the student has
  // answered" — the interview has its own suites and its own model.
  journeyProfile = emptyProfile(makeStudentId(studentUuid), new Date());
  const profiles = new PostgresConfirmedProfileStore(conversationPool);
  await confirmInto(profiles, "identity.given_name", "Niloofar", "Niloofar");
  await confirmInto(profiles, "identity.family_name", "Hosseini", "Hosseini");
  await confirmInto(
    profiles,
    "identity.date_of_birth",
    new Date("1999-04-02T00:00:00Z"),
    "2 April 1999",
  );
  await confirmInto(profiles, "identity.nationality", "Iranian", "Iranian");
  await confirmInto(profiles, "contact.email", EMAIL, EMAIL);
  await confirmInto(
    profiles,
    "study.personal_statement",
    "Because it is the course I want.",
    "…",
  );
}, 300_000);

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  await caseContext.close().catch(() => undefined);
  await runnerBrowser.close();
  await portal.stop();
  await new Promise<void>((resolve) => conversationServer.close(() => resolve()));
  await new Promise<void>((resolve) => agentServer.close(() => resolve()));
  await new Promise<void>((resolve) => secureServer.close(() => resolve()));
  await conversationPool.end();
  await securePool.end();
});

async function confirmInto<K extends ProfileFieldKey>(
  store: PostgresConfirmedProfileStore,
  key: K,
  value: ProfileFieldType<K>,
  verbatim: string,
): Promise<void> {
  const result = applyConfirmation({
    key,
    proposed: proposeValue({ value, origin: "conversation", verbatim, confidence: 1 }),
    confirmation: {
      studentRef: makeStudentId(studentUuid),
      presentedText: "Is that right?",
      response: { kind: "accepted" },
      respondedAt: new Date(),
    },
  });
  if (isDeclined(result)) expect.unreachable(`${key} should have been accepted`);
  const now = new Date();
  journeyProfile = confirmField(journeyProfile, result, now);
  const entry = journeyProfile.entries.get(key);
  if (entry === undefined) expect.unreachable(`${key} should be in the profile`);
  await store.save(studentUuid, toStoredEntry(key, entry));
}

/** The student's half of the secure step, in their browser, on the secure origin. */
async function typeThePassword(requestId: string): Promise<void> {
  // The frame token comes from the CONVERSATION plane's bootstrap endpoint —
  // the page asks its own origin, and its own origin asks the secure service.
  const bootstrap = await recordingFetch(
    `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/secure-requests/${requestId}/bootstrap`,
    { headers: { cookie: devCookie } },
  );
  expect(bootstrap.status, await bootstrap.clone().text()).toBe(200);
  const { frameToken } = (await bootstrap.json()) as { frameToken: string };

  const established = await recordingFetch(`${SECURE}/v1/frame-sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: SECURE,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ requestId, frameToken }),
  });
  expect(established.status).toBe(204);
  const cookieValue = /__Host-secure_session=([^;]+)/.exec(
    established.headers.get("set-cookie") ?? "",
  )?.[1];
  if (cookieValue === undefined) expect.unreachable("a secure session should have been set");

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
  expect(submitted.status, await submitted.clone().text()).toBe(200);
  const { handle } = (await submitted.json()) as { handle: string };

  // The secure service pushes the transition to the conversation plane's own
  // log. In production the outbox does this; here the same internal endpoint is
  // called directly, which is the same message over the same wire.
  const pushed = await recordingFetch(
    `${CONVERSATION_URL}/internal/v1/conversations/${CONVERSATION}/events`,
    {
      method: "POST",
      // The SECURE service's certificate. It is the plane that knows a secret
      // was received, and the runner has no business asserting it.
      headers: { "Content-Type": "application/json", "x-service-cert": SECURE_CERT },
      body: JSON.stringify({ kind: "secret_received", requestId, handle }),
    },
  );
  expect(pushed.status, await pushed.clone().text()).toBe(201);
}

/** The student's session cookie, minted by the service's own issuer. */
let devCookie = "";

/**
 * Everything a runner needs, rebuilt from nothing but the database and the
 * portal's address.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A RESTART, not a second call on the same objects. A new pool, a new driver, a
 * new server on a new port, a new browser context — so a run that resumes on
 * the right page does so because the intent ledger said which pages were done,
 * not because something was still in memory.
 *
 * The browser context is new too, and it signs in again with the credentials
 * the portal already has. That is what a real restarted runner would do: the
 * account exists, and the student's password is gone, so it uses the session
 * the portal will give it — which is why `credentialsWork` mattering earlier
 * matters again here.
 * ═══════════════════════════════════════════════════════════════════════════
 */
async function restartedInstance(): Promise<{
  readonly intake: ReturnType<typeof httpWorkIntake>;
  readonly page: Page;
  readonly close: () => Promise<void>;
}> {
  const pool = new pg.Pool({ connectionString: conversationPool.options.connectionString ?? "", max: 4 });
  const store = new ConversationEventStore(pool);
  const driver = new RunDriver({
    stores: {
      cases: new PostgresCaseStore(pool),
      runs: new PostgresWorkflowRunStore(pool),
    },
    bindings: new ApplicationBindingStore(pool),
    catalogue: journeyCatalogue,
    model: new DeterministicModelClient(),
    profiles: new PostgresConfirmedProfileStore(pool),
    conversations: store,
    secureRequests: journeySecureRequests,
    leases: new WorkLeaseStore(pool),
    now: () => new Date(),
  });
  const app = createConversationApp({
    store,
    sessionSecret: SESSION_SECRET,
    authorise: () => Promise.resolve(true),
    authoriseService: (req) => req.header("x-service-cert") === RUNNER_CERT,
    now: () => new Date(),
    runs: driver,
    secureRequests: journeySecureRequests,
    secureOrigin: SECURE,
  });
  const port = CONVERSATION_PORT + 20;
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(port, "127.0.0.1", () => resolve(listening));
  });

  // A NEW context: the old one's cookie is gone with the process that held it.
  const context = await openSensitiveContext(runnerBrowser, { userAgent: "AskiMate-Runner/1.0" });
  const page = await context.newPage();
  await page.goto(`${portal.baseUrl}/login`);
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  return {
    intake: httpWorkIntake({
      baseUrl: `http://127.0.0.1:${String(port)}`,
      holder: "runner-restarted",
      serviceToken: RUNNER_CERT,
      fetch: recordingFetch as unknown as typeof globalThis.fetch,
    }),
    page,
    close: async () => {
      await context.close().catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
    },
  };
}

/**
 * The preview the orchestrator would build for this run, for its content hash.
 *
 * Built from the same blueprint, the same reviewed mapping set and the same
 * confirmed profile the run uses — because an authorisation whose hash does not
 * match the plan is an authorisation for something else, and `assess` compares
 * the two before anything is typed.
 */
function previewForThisRun(): { contentHash: string } {
  const usable = checkUsable(GATED_PORTAL_MAPPING_SET, GATED_PORTAL_BLUEPRINT);
  if (!usable.usable) expect.unreachable("the gated mapping set is reviewed");
  const plan = planFill(GATED_PORTAL_BLUEPRINT, usable.mappingSet, journeyProfile);
  const preview = buildPreview(GATED_PORTAL_BLUEPRINT, plan, new Map());
  if (!preview.built) expect.unreachable(`preview refused: ${preview.refusal.kind}`);
  return { contentHash: preview.preview.contentHash };
}

describeIfDatabase("a student asks, and ends up with an account they own", () => {
  let runId = "";

  it("starts a run, and the run asks for a password", async () => {
    wire = [];
    logLines = [];


    const started = await recordingFetch(`${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: devCookie },
      body: JSON.stringify({ blueprintId: BLUEPRINT, studentStatement: STATEMENT }),
    });
    expect(started.status, await started.clone().text()).toBe(201);
    const run = (await started.json()) as { runId: string; step: string; phase: string };
    runId = run.runId;

    // The gated portal needs an account, and the account needs a password.
    expect(run.step).toBe("request_secret");
    expect(run.phase).toBe("awaiting_secret");

    // And the conversation's own log says so, authoritatively.
    const events = await conversationPool.query<{ kind: string; request_id: string | null }>(
      "SELECT kind, request_id FROM conversation_events WHERE conversation_id = $1 ORDER BY ordinal",
      [CONVERSATION],
    );
    expect(events.rows.map((row) => row.kind)).toEqual(["secret_requested"]);
    expect(events.rows[0]?.request_id).toMatch(/^sr_[0-9a-f]{32}$/);
  }, 300_000);

  it("takes the student's password without the conversation plane seeing it", async () => {
    const open = await conversationPool.query<{ request_id: string }>(
      "SELECT request_id FROM conversation_events WHERE conversation_id = $1 AND kind = 'secret_requested'",
      [CONVERSATION],
    );
    const requestId = open.rows[0]!.request_id;
    await typeThePassword(requestId);

    // The conversation plane learned a HANDLE. Every row of its log, scanned.
    const rows = await conversationPool.query<{ row: string }>(
      "SELECT e::text AS row FROM conversation_events e WHERE e.conversation_id = $1",
      [CONVERSATION],
    );
    for (const { row } of rows.rows as readonly { row: string }[]) {
      expect(row, "the conversation plane may not hold the password").not.toContain(PASSWORD);
      expect(row.toLowerCase()).not.toContain("password");
    }
    const kinds = rows.rows.length;
    expect(kinds).toBe(2);
  }, 300_000);

  it("advances to account creation, and offers it to a runner as work", async () => {
    const advanced = await recordingFetch(
      `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: devCookie },
        body: JSON.stringify({ blueprintId: BLUEPRINT, studentStatement: STATEMENT }),
      },
    );
    expect(advanced.status).toBe(200);
    const run = (await advanced.json()) as { step: string; phase: string };
    expect(run.step).toBe("create_account");
    expect(run.phase).toBe("creating_account");
  }, 300_000);

  it("the RUNNER claims it, creates the account, and reports back", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The real loop. `runOneTurn` claims over real HTTP, performs with a real
    // browser against a real portal, and reports over real HTTP.
    // ═══════════════════════════════════════════════════════════════════
    const intake = httpWorkIntake({
      baseUrl: CONVERSATION_URL,
      holder: "runner-journey",
      serviceToken: RUNNER_CERT,
      fetch: recordingFetch as unknown as typeof globalThis.fetch,
    });

    const turn = await runOneTurn(intake, (work) =>
      createPortalAccount(work, {
        browser: runnerBrowser,
        browserEndpoint: cdpEndpoint,
        agentBaseUrl: AGENT,
        serviceToken: RUNNER_CERT,
        fetch: recordingFetch as unknown as typeof globalThis.fetch,
        // Kept open: the cookie it is about to hold is the run's only session.
        context: caseContext,
      }),
    );
    expect(turn).toEqual({
      kind: "worked",
      runId,
      report: { leaseId: expect.any(String), outcome: "succeeded" },
    });

    // ── Asked of the PORTAL ───────────────────────────────────────────────
    expect(portal.accounts()).toEqual([EMAIL]);
    expect(
      portal.credentialsWork(EMAIL, PASSWORD),
      "the account has the password the student typed, and only that",
    ).toBe(true);

    // The handle is spent, exactly once, and the lease is given back.
    expect(cache.rawEntries()).toHaveLength(0);
    const leases = await conversationPool.query("SELECT 1 FROM work_leases");
    expect(leases.rowCount).toBe(0);

    // The durable evidence that it happened (ADR-0008).
    const intents = await conversationPool.query<{ action: string; outcome: string | null }>(
      "SELECT action, outcome FROM workflow_action_intents WHERE run_id = $1",
      [runId],
    );
    expect(intents.rows).toEqual([{ action: "create_portal_account", outcome: "succeeded" }]);
  }, 300_000);

  it("asks the student to authorise before ANYTHING is typed", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Product rule 1, at the point it costs something. The account exists and
    // the plan is ready, and the run STOPS: nothing is typed into a university's
    // form until the student has seen exactly what will be sent and said yes.
    // ═══════════════════════════════════════════════════════════════════
    const advanced = await recordingFetch(
      `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: devCookie },
        body: JSON.stringify({ blueprintId: BLUEPRINT, studentStatement: STATEMENT }),
      },
    );
    expect(advanced.status).toBe(200);
    const run = (await advanced.json()) as { step: string; phase: string };
    expect(run.step).toBe("authorise");
    expect(run.phase).toBe("awaiting_authorisation");

    // And no work is offered while it waits. A runner cannot get ahead of the
    // student's approval, which is the whole point of the step.
    const intake = httpWorkIntake({
      baseUrl: CONVERSATION_URL,
      holder: "runner-journey",
      serviceToken: RUNNER_CERT,
      fetch: recordingFetch as unknown as typeof globalThis.fetch,
    });
    expect(await intake.claim(), "nothing to do until the student approves").toBeNull();
    expect(portal.application(EMAIL), "and nothing typed").toBeNull();
  }, 300_000);

  it("the student approves, over the real decision route, and the run becomes work", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0049. Until P11 this test APPENDED `AuthorisationCaptured` itself —
    // the test giving the student's approval on their behalf, because no
    // production path could. That is now a real request on the student's own
    // session, and it is the difference between a journey that proves the
    // system works and one that proves it works if somebody forges the one
    // event the whole safety design rests on.
    // ═══════════════════════════════════════════════════════════════════
    const cases = new PostgresCaseStore(conversationPool);
    const caseRef = makeCaseId(`case_${CONVERSATION.toLowerCase()}`);

    // The hash of exactly what will be sent. Taken from the preview the
    // orchestrator built, never invented here: an authorisation whose hash did
    // not match the plan is an authorisation for something else.
    const preview = previewForThisRun();

    const decided = await recordingFetch(
      `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs/${runId}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: devCookie },
        body: JSON.stringify({ kind: "authorise", contentHash: preview.contentHash }),
      },
    );
    expect(decided.status, "the student's own session, not a service credential").toBe(204);

    // It landed where business facts land, through the domain's own intent —
    // not written here.
    const logged = await cases.read(caseRef);
    expect(
      logged.some((event) => event.type === "AuthorisationCaptured"),
      "captured in the case log by the service",
    ).toBe(true);
    expect(
      logged.some((event) => event.type === "CaseStateChanged" && event.to === "AUTHORISED"),
      "and the case machine moved with it (ADR-0049)",
    ).toBe(true);

    const advanced = await recordingFetch(
      `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: devCookie },
        body: JSON.stringify({ blueprintId: BLUEPRINT, studentStatement: STATEMENT }),
      },
    );
    const run = (await advanced.json()) as { step: string; phase: string };
    expect(run.step, "approved; now it is work").toBe("execute");
    expect(run.phase).toBe("filling");
  }, 300_000);

  it("the RUNNER claims the FILL, and types the student's own answers", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0046. The plan crossed as text plus the provenance the student's
    // confirmation produced, and was reassembled on this side through the one
    // mint. What runs is `executePlan` — the same function the in-process demo
    // has always run, on the same plan the Application Plane built.
    // ═══════════════════════════════════════════════════════════════════
    const intake = httpWorkIntake({
      baseUrl: CONVERSATION_URL,
      holder: "runner-journey",
      serviceToken: RUNNER_CERT,
      fetch: recordingFetch as unknown as typeof globalThis.fetch,
    });

    let received: NonNullable<Parameters<typeof fillApplication>[0]["plan"]> | undefined;
    const turn = await runOneTurn(intake, (work) => {
      received = work.plan;
      const advance = work.advanceLocator;
      if (advance === undefined) expect.unreachable("execute work carries its save control");
      return fillApplication(work, {
        now: () => new Date(),
        // The REAL session, attached to the page the account was created in.
        // Not a hand-rolled adapter: the first version of this test wrote one
        // and lost the option check, the checkbox handling and the read-back
        // that catches a portal silently truncating a personal statement — and
        // typed "IR" into a `<select>`.
        session: PlaywrightPreparationSession.attach(casePage, {
          capability: "fillable",
          runId: "run-journey",
          allowedHosts: [portal.host.split(":")[0] ?? "127.0.0.1"],
          // EXACTLY the control the plane sent, and nothing else. The guard
          // is a whitelist, so the submit button is unreachable however the
          // blueprint changes — structural rather than a promise (ADR-0014).
          clickableControls: [advance],
        }),
      });
    });
    expect(turn.kind, JSON.stringify(turn)).toBe("worked");
    if (turn.kind !== "worked") expect.unreachable("the fill should have been reported");
    expect(turn.report.outcome).toBe("succeeded");

    // ── What crossed, and what came with it ────────────────────────────
    if (received === undefined) expect.unreachable("an execute item carries a plan");
    const name = received.instructions.find(
      (instruction) => instruction.fieldRef === "given_name",
    );
    if (name?.value.kind !== "confirmed") expect.unreachable("the name is a confirmed value");
    expect(name.value.text).toBe("Niloofar");
    // The confirmation behind it, not just the text. Without this the runner
    // would be typing a value nobody could say the student had agreed to.
    expect(name.value.provenance.source).toBe("student_stated");
    expect(name.value.provenance.confirmedAt).toMatch(/^\d{4}-/);

    // ── Asked of the PORTAL ────────────────────────────────────────────
    const application = portal.application(EMAIL);
    if (application === null) expect.unreachable("the portal should hold the application");
    expect(application.givenName).toBe("Niloofar");
    expect(application.familyName).toBe("Hosseini");
    expect(application.nationality).toBe("IR");

    // PAGE ONE only. The second page has not been filled yet, and the portal
    // is what says so — a run that had typed everything into one page would
    // have this populated too.
    expect(application.personalStatement, "page two is not done yet").toBe("");

    // ── And the ledger records that page, AND what was on it ───────────
    //
    // ADR-0047 keyed an intent on the page. ADR-0051 §6 keys it on the page AND
    // the content, because the page alone cannot answer "was the CORRECTED
    // value written?" — and a student who fixes a typo after the portal is
    // filled would otherwise be told their application is ready with the
    // correction never typed.
    //
    // The page is asserted by name and the version by shape: the hash is a
    // fact about the plan, and pinning its digits here would make this test
    // fail whenever a fixture answer changed, for no property.
    const intents = await conversationPool.query<{ target: string; outcome: string | null }>(
      "SELECT target, outcome FROM workflow_action_intents WHERE run_id = $1 AND action = 'advance_portal_page'",
      [runId],
    );
    expect(intents.rows).toHaveLength(1);
    expect(intents.rows[0]?.outcome).toBe("succeeded");
    expect(intents.rows[0]?.target).toMatch(/^page-application@sha256:[0-9a-f]{64}$/);

    // Still nothing submitted. Filling is not submitting (ADR-0014).
    expect(portal.submissions()).toEqual([]);
  }, 300_000);

  it("RESUMES on the second page after a restart, and does not re-do the first", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The whole point of ADR-0047. Everything in memory is thrown away — a new
    // driver, a new pool, a new browser context — and the run picks up on page
    // two because the intent ledger says page one is saved.
    //
    // A run that had lost that would either re-type page one (pressing "Save
    // and continue" a second time on a real portal) or stall entirely.
    // ═══════════════════════════════════════════════════════════════════
    const restarted = await restartedInstance();
    try {
      const claimed = await restarted.intake.claim();
      if (claimed === null) expect.unreachable("page two is still to do");
      expect(claimed.kind).toBe("execute");
      expect(claimed.formUrl, "the SECOND page").toBe(`${portal.baseUrl}/study`);
      expect(
        claimed.plan?.instructions.map((instruction) => instruction.fieldRef),
        "and only the fields on it",
      ).toEqual(["personal_statement"]);

      const outcome = await fillApplication(claimed, {
        now: () => new Date(),
        session: PlaywrightPreparationSession.attach(restarted.page, {
          capability: "fillable",
          runId: "run-journey-2",
          allowedHosts: [portal.host.split(":")[0] ?? "127.0.0.1"],
          clickableControls: [claimed.advanceLocator!],
        }),
      });
      expect(outcome).toEqual({ kind: "succeeded" });
      expect(
        await restarted.intake.report(claimed.runId, {
          leaseId: claimed.leaseId,
          outcome: "succeeded",
        }),
      ).toBe(true);

      // ── Both pages, and page one was NOT filled again ─────────────────
      const application = portal.application(EMAIL);
      expect(application?.personalStatement).toBe("Because it is the course I want.");
      expect(application?.givenName, "page one survived untouched").toBe("Niloofar");

      const posts = portal.requests.filter(
        (entry) => entry.method === "POST" && entry.path === "/apply",
      );
      expect(posts, "page one was saved exactly once").toHaveLength(1);

      const intents = await conversationPool.query<{ target: string; outcome: string | null }>(
        `SELECT target, outcome FROM workflow_action_intents
          WHERE run_id = $1 AND action = 'advance_portal_page' ORDER BY target`,
        [runId],
      );
      expect(intents.rows.map((row) => row.outcome)).toEqual(["succeeded", "succeeded"]);
      expect(intents.rows[0]?.target).toMatch(/^page-application@sha256:[0-9a-f]{64}$/);
      expect(intents.rows[1]?.target).toMatch(/^page-study@sha256:[0-9a-f]{64}$/);
    } finally {
      await restarted.close();
    }
  }, 300_000);

  it("asks for the account back once every page is saved", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0050. This used to expect `ready_to_submit` — the application done
    // and the account still ours, reported as finished. Handing it back is not
    // a courtesy after the work; it is part of the work, and until P12 nothing
    // in the system could do it: no account had ever left `active`.
    // ═══════════════════════════════════════════════════════════════════
    const restarted = await restartedInstance();
    try {
      expect(await restarted.intake.claim(), "no page remains").toBeNull();

      const advanced = await recordingFetch(
        `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie: devCookie },
          body: JSON.stringify({ blueprintId: BLUEPRINT, studentStatement: STATEMENT }),
        },
      );
      const run = (await advanced.json()) as { step: string; phase: string };
      expect(run.step, "filled, and the account is still ours").toBe("hand_over_account");
      expect(portal.submissions(), "and it is still not submitted").toEqual([]);

      // And the student was TOLD, in the log that holds what they were told.
      const told = await conversationPool.query<{ content: string }>(
        `SELECT mb.content FROM conversation_events e
           JOIN message_bodies mb ON mb.id = e.body_id
          WHERE e.conversation_id = $1 ORDER BY e.ordinal DESC LIMIT 1`,
        [CONVERSATION],
      );
      // Asserted as a string before it is searched. A regression that stopped
      // raising the handover entirely left this `undefined`, and `toContain`
      // then failed on the ARGUMENT TYPE rather than on the property — a
      // detection that says "invalid combination of arguments" tells a reader
      // nothing about what broke.
      const last = told.rows[0]?.content ?? "";
      expect(last, "the student was told something").not.toBe("");
      expect(last, "the handover message reached them").toContain(
        GATED_PORTAL_BLUEPRINT.institutionName,
      );
    } finally {
      await restarted.close();
    }
  }, 300_000);

  it("the student takes the account back, and only then is the run finished", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The end of the whole journey, and the first time `mayConcludeCase` has
    // ever been able to answer `true` — it takes the accounts on a case, and
    // until P12 no account could reach `handed_over` because nothing moved an
    // account's stage at all.
    //
    // Two confirmations, not one, because two INDEPENDENT facts are being
    // established: this portal never verified the address, so the student
    // proves they receive at it through the portal's own reset (ADR-0050), and
    // separately says they can sign in. One confirmation covering both would
    // record a reset they never did.
    // ═══════════════════════════════════════════════════════════════════
    const cases = new PostgresCaseStore(conversationPool);
    const caseRef = makeCaseId(`case_${CONVERSATION.toLowerCase()}`);

    /**
     * The hash of the message the student is looking at.
     *
     * Taken over the text the SERVICE appended to the conversation, which is
     * what a real client has: it renders the message it received and hashes
     * that. The service compares it against what it would render now, so a
     * client that hashed something else is refused rather than believed.
     */
    const hashOfLastMessage = async (): Promise<string> => {
      const said = await conversationPool.query<{ content: string }>(
        `SELECT mb.content FROM conversation_events e
           JOIN message_bodies mb ON mb.id = e.body_id
          WHERE e.conversation_id = $1 ORDER BY e.ordinal DESC LIMIT 1`,
        [CONVERSATION],
      );
      const content = said.rows[0]?.content ?? "";
      expect(content, "there is a message to confirm").not.toBe("");
      return `sha256:${createHash("sha256").update(content).digest("hex")}`;
    };

    const confirm = async (): Promise<number> => {
      const response = await recordingFetch(
        `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs/${runId}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie: devCookie },
          body: JSON.stringify({
            kind: "confirm_handoff",
            contentHash: await hashOfLastMessage(),
          }),
        },
      );
      return response.status;
    };

    const advance = async (): Promise<{ step: string }> => {
      const response = await recordingFetch(
        `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie: devCookie },
          body: JSON.stringify({ blueprintId: BLUEPRINT, studentStatement: STATEMENT }),
        },
      );
      return (await response.json()) as { step: string };
    };

    // 1 — the reset, which is how they prove they receive mail at the address
    //     on a portal that never verified it.
    expect(await confirm(), "the student's own session").toBe(204);
    expect((await advance()).step, "one down, one to go").toBe("hand_over_account");

    // 2 — and that they are actually in.
    expect(await confirm()).toBe(204);

    const logged = await cases.read(caseRef);
    const completed = logged.filter((event) => event.type === "HandoffCompleted");
    expect(completed, "both, recorded by the domain").toHaveLength(2);

    expect((await advance()).step, "handed back; now it is finished").toBe("ready_to_submit");
    expect(portal.submissions(), "and STILL not submitted — ADR-0014").toEqual([]);

    // ── The rule that made handover non-optional, finally asked ─────────
    //
    // `mayConcludeCase` has existed since the account model was written and
    // nothing had ever called it, because no account could reach `handed_over`
    // — nothing moved an account's stage at all. This is it answering `true`
    // for the first time, about an account derived from the real run.
    const pool = new pg.Pool({
      connectionString: conversationPool.options.connectionString ?? "",
      max: 2,
    });
    const driver = new RunDriver({
      stores: { cases: new PostgresCaseStore(pool), runs: new PostgresWorkflowRunStore(pool) },
      bindings: new ApplicationBindingStore(pool),
      catalogue: journeyCatalogue,
      model: new DeterministicModelClient(),
      profiles: new PostgresConfirmedProfileStore(pool),
      conversations: new ConversationEventStore(pool),
      secureRequests: journeySecureRequests,
      leases: new WorkLeaseStore(pool),
      now: () => new Date(),
    });
    try {
      expect(await driver.mayConclude(runId, CONVERSATION)).toEqual({
        may: true,
        outstanding: [],
      });

      // ═══════════════════════════════════════════════════════════════════
      // THE STUDENT CLOSES THE TAB, AND THE SYSTEM STILL MOVES.
      //
      // Vahid, 2026-09-02: *"the client must no longer be required to advance
      // a case for the workflow to progress … closing the browser must never
      // prevent the system from progressing."*
      //
      // Every advance in this journey until now was a POST from the student's
      // client, because before P14 that was the ONLY thing that moved a case:
      // `#decide` was reachable from `start` and `advance`, `advance` had no
      // route, and so the student's browser was the scheduler.
      //
      // This pass is the Background Worker alone — its own clock and the
      // conversation-plane database. No fetch, no cookie, no session. The
      // assertion that matters is the second one: not one HTTP request was
      // made on the student's behalf to achieve it.
      // ═══════════════════════════════════════════════════════════════════
      const requestsBefore = wire.length;
      const worker = startWorker({
        pool,
        driver,
        holder: "journey-worker",
        now: () => new Date(),
      });
      try {
        const pass = await worker.runOnce();
        expect(pass.looked, "the worker found this run on its own").toBeGreaterThan(0);
      } finally {
        await worker.stop();
      }

      expect(
        wire.length,
        "and it made no HTTP request on the student's behalf to do it",
      ).toBe(requestsBefore);

      // The run is where it was — it had nowhere left to go — and that is the
      // point: the worker reached a finished run, decided, and wrote nothing.
      // A worker that could only be shown to work by MOVING something would be
      // untestable at the end of a journey.
      const after = await new PostgresWorkflowRunStore(pool).findByCase(makeCaseId(caseRef));
      expect(after[0]?.checkpoint.phase, "still finished, still not submitted").toBe(
        "ready_to_submit",
      );
      expect(portal.submissions(), "and the worker submitted nothing — ADR-0014").toEqual([]);
    } finally {
      await pool.end();
    }
  }, 300_000);

  it("does NOT create a second account for a student who has one", async () => {
    // The loop this run would otherwise be in. `state.account` is memory; the
    // intent ledger is not.
    const again = await recordingFetch(`${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: devCookie },
      body: JSON.stringify({ blueprintId: BLUEPRINT, studentStatement: STATEMENT }),
    });
    expect(again.status).toBe(200);
    const run = (await again.json()) as { step: string };
    expect(run.step, "the account exists; do not make another").not.toBe("create_account");

    const intake = httpWorkIntake({
      baseUrl: CONVERSATION_URL,
      holder: "runner-journey",
      serviceToken: RUNNER_CERT,
      fetch: recordingFetch as unknown as typeof globalThis.fetch,
    });
    expect(await intake.claim(), "and there is no browser work left").toBeNull();
    expect(portal.accounts(), "still exactly one account").toEqual([EMAIL]);
  }, 300_000);

  it("put the password on exactly ONE wire, and in no log line", () => {
    const carrying = wire.filter((entry) => entry.body.includes(PASSWORD));
    expect(carrying, "the recording must have caught the submission").toHaveLength(1);
    expect(carrying[0]?.where).toMatch(
      new RegExp(`^→ ${SECURE}/v1/secret-requests/sr_[0-9a-f]{32}/secret$`),
    );

    const log = logLines.join("\n");
    for (let at = 0; at + 6 <= PASSWORD.length; at += 1) {
      expect(log).not.toContain(PASSWORD.slice(at, at + 6));
    }
  });

  it("submitted NOTHING, and the portal is the one saying so", () => {
    // ADR-0014. The form is filled and saved; the submit control is never
    // pressed, and the portal's own record of submissions is what says so.
    expect(portal.submissions()).toEqual([]);
    expect(portal.application(EMAIL), "filled, and not submitted").not.toBeNull();
  });
});
