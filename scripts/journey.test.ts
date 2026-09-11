/**
 * P7 — the first real end-to-end execution journey.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A student asks. AskiMate interviews them, shows them exactly what will be
 * sent and takes their yes (ADR-0101), decides an account is needed, asks
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
 *   the real student page   — built from the tree, served by the Conversation
 *                             Service, in a real Chromium; the password is
 *                             typed into the REAL cross-origin frame (ADR-0100)
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

import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

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
import { targetOf, type ReviewedTarget } from "@askimate/aas-catalogue";
import { checkUsable, planFill } from "@askimate/aas-mapping";
import { buildPreview } from "@askimate/aas-preparation";
import { caseId as makeCaseId } from "@askimate/aas-domain";
import {
  GATED_PORTAL_WITH_DOCUMENTS_BLUEPRINT,
  GATED_PORTAL_WITH_DOCUMENTS_MAPPING_SET,
} from "@askimate/aas-mapping/fixtures/gated";
import type { DocumentVault } from "@askimate/aas-documents";
import { parseConversationRun, parseRunPreview, SECURE_HOLD_CEILING_SECONDS } from "@askimate/aas-contracts";
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
  SessionHold,
  httpWorkIntake,
  runOneTurn,
  runnerPerformer,
  startFixturePortal,
  type FixturePortal,
} from "@askimate/aas-browser-runner";
import { b2Register } from "@askimate/aas-disclosure";
import type { BrowserContext, Page, Request as BrowserRequest } from "playwright";
import {
  ApplicationBindingStore,
  ConversationEventStore,
  PostgresConfirmedProfileStore,
  RunDriver,
  StudentIdentityStore,
  WorkLeaseStore,
  RunSessionStore,
  PostgresDocumentRecordStore,
  TransmissionStore,
  buildStudentClient,
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
  buildSecureControl,
  createSecureApp,
  internalAppend,
  MIGRATIONS_DIR as SECURE_MIGRATIONS,
} from "@askimate/aas-secure-service";
import { refusalText } from "@askimate/aas-conversation";

const CONVERSATION_PORT = 4901;
/** The vault stand-in: the passport's bytes, served to the runner on the URL the plane mints. */
const VAULT_PORT = 4907;
/**
 * The vault stand-in's address as the plane mints it and the runner sees it.
 * An `https` name, because the runner refuses a retrieval URL that is not one
 * (`parseWorkDocument`) and this journey does not loosen that: `recordingFetch`
 * carries a request for this host to the plain listener on `VAULT_PORT`, the
 * way a resolver would carry it to a bucket. The wire records the name.
 */
const VAULT_URL = "https://vault.journey.test";
const VAULT_LISTENER = `http://127.0.0.1:${String(VAULT_PORT)}`;
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
/**
 * The conversation, opened over HTTP in `beforeAll`.
 *
 * ADR-0060. It used to be a literal inserted with SQL — as every conversation
 * in this repository was, because `POST /v1/conversations` was published in the
 * contract and never implemented. A journey that begins with an `INSERT` is a
 * journey that begins somewhere a student cannot stand.
 */
let CONVERSATION = "";
const BLUEPRINT = "bp-gated-portal-documents";
const EMAIL = "niloofar@example.test";
/** What the student types into the secure box. Nothing else in this file has it. */
const PASSWORD = "Journey-Tr0ub4dor-3-horses!";
/** A synthetic passport. Its bytes exist here and on the vault stand-in, and its hash in the record. */
const PASSPORT_BYTES = Buffer.from("%PDF-1.7\n a synthetic passport for the journey, not a real one\n");
const PASSPORT_HASH = createHash("sha256").update(PASSPORT_BYTES).digest("hex");
const PASSPORT_ID = "01JQP74PASSPORT00000000001";
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
 * The runner, as deployed: the hold that keeps the signed-in context between
 * work items (ADR-0101 §2), the intake that declares it on every claim, and
 * the ONE performer `main.ts` runs.
 *
 * Creating the account SIGNS THE STUDENT IN — the portal sets a session cookie
 * exactly as it would for a person — and the application form is unreachable
 * without it. Until P71 this file kept a context of its own for that; now the
 * production `SessionHold` keeps it, in memory, for five minutes idle, and the
 * fill is performed by the same code a deployed runner performs it with.
 */
let journeyHold: SessionHold;
let journeyIntake: ReturnType<typeof httpWorkIntake>;
let journeyPerformer: ReturnType<typeof runnerPerformer>;
/** The profile as the interview confirmed it. The preview hashes this one. */
let journeyProfile: ConfirmedProfile;
let vaultServer: Server;
/**
 * The document vault, as the journey stands one in: the records the plane
 * reads are the real Postgres rows; the bytes the runner fetches come from a
 * local HTTP server on the URL `prepareRetrieval` mints. Nothing else of the
 * port is exercised here, and nothing else answers.
 */
let journeyVault: DocumentVault;
/** Held so a restarted instance can be rebuilt from the same reviewed inputs. */
/** The catalogue, and the directory Gate 1 (ADR-0058) offers targets from. */
let journeyCatalogue: ApplicationCatalogue & { targets(): readonly ReviewedTarget[] };

/**
 * The offer this journey's student accepted, made ONCE at the start.
 *
 * Every later call to `POST /runs` is a resume of the same request, so it names
 * the same offer. Re-offering would put a second `target_offered` in the log
 * and say the student was asked twice, which is not what happened.
 */
let journeyOffer = "";

/**
 * A fabricated content hash for the journey's compiled-in entry.
 *
 * The journey builds its catalogue entry in TypeScript rather than loading it
 * through P20's registry, so there is no real approval to carry. Named as
 * fabricated so nobody reads it as one — `scripts/p21-target-selection.test.ts`
 * exercises the real registry-backed path.
 */
const JOURNEY_CONTENT_HASH = `sha256:${"b".repeat(64)}`;
let journeySecureRequests: ReturnType<typeof httpSecureRequestOpener>;
/** The Secure Plane's outbox, drained in this file the way `background.ts` drains it. */
let secureOutbox: LifecycleOutbox;
/** The student page, built from the tree and served by the Conversation Service. */
let publicDir: string;
/** The secure control — `control.js` and `control.css` — built from the tree too. */
let secureAssetDir: string;

const recordingFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  if (typeof init?.body === "string") wire.push({ where: `→ ${url}`, body: init.body });
  const response = await globalThis.fetch(
    url.startsWith(`${VAULT_URL}/`) ? `${VAULT_LISTENER}${url.slice(VAULT_URL.length)}` : input,
    init,
  );
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
  secureOutbox = new LifecycleOutbox(securePool);
  secureAssetDir = await mkdtemp(`${tmpdir()}/aas-journey-secure-`);
  await buildSecureControl(secureAssetDir);
  const keys = new LocalDataKeyProvider();
  const submissionVault = new EnvelopeVault(keys, cache);
  const agentVault = new EnvelopeVault(keys, cache);

  const secureApp = createSecureApp({
    store: new SecureRequestStore(securePool),
    vault: submissionVault,
    outbox: secureOutbox,
    now: () => new Date(),
    selfOrigin: SECURE,
    parentOrigin: CONVERSATION_URL,
    logger: new SecureLogger((line) => logLines.push(line)),
    authoriseService: (req) =>
      req.header("x-service-cert") === CONVERSATION_CERT ||
      req.header("x-service-cert") === AGENT_CERT,
    // The control the frame runs, served from the secure origin under its
    // own `script-src 'self'`. Without it the document loads and the script
    // does not, and a frame that never says `ready` is what the student
    // would get — which is exactly what the first run of this test found.
    assetDir: secureAssetDir,
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
    // The three-page portal (P74): the account, the form, the course, and a
    // document — the passport the student holds, attached on page three.
    blueprint: GATED_PORTAL_WITH_DOCUMENTS_BLUEPRINT,
    mappingSet: GATED_PORTAL_WITH_DOCUMENTS_MAPPING_SET,
    requiredDocuments: ["passport"],
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
    targets: () => [
      targetOf({ entry, contentHash: JOURNEY_CONTENT_HASH, portalOrigin: portal.baseUrl }),
    ],
  };

  publicDir = await mkdtemp(`${tmpdir()}/aas-journey-`);
  await buildStudentClient(publicDir);

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
    // ADR-0101 §2, §3: who last reported the run's session live, and until
    // when — what makes the restart below a resume rather than a stall.
    sessions: new RunSessionStore(conversationPool),
    // ADR-0097, ADR-0099, ADR-0069 (P74): what the student holds, and the
    // vault the plane hands a document over from, after the gates.
    heldDocuments: new PostgresDocumentRecordStore(conversationPool),
    disclosure: { register: b2Register(new Date()), vault: journeyVault },
    transmissions: new TransmissionStore(conversationPool),
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
    // Gate 1: the same catalogue the driver executes against.
    targets: journeyCatalogue,
    secureRequests: journeySecureRequests,
    secureOrigin: SECURE,
    // The student's page, from the sources in the tree (ADR-0060), and the dev
    // session route that mints the `__Host-` cookie a browser will only hold
    // from a real `Set-Cookie`. Refused in production; `main.ts` mounts it
    // only outside it.
    publicDir,
    issueSessionFor: (req: { body?: unknown }): string | null => {
      const subject = (req.body as { subject?: unknown } | undefined)?.subject;
      return typeof subject === "string" ? subject : null;
    },
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

  // ── The passport the student holds (P74) ──────────────────────────────
  //
  // Its METADATA is the real row the plane reads (ADR-0094); its BYTES are on
  // the vault stand-in below, on the URL the plane mints for the runner. The
  // intake that would have put them there (P57–P62) is proved in its own
  // suites; this journey starts with the document held.
  await new PostgresDocumentRecordStore(conversationPool).insert(
    {
      documentId: PASSPORT_ID,
      studentId: studentUuid,
      documentType: "passport",
      purpose: "identity_verification",
      state: "uploaded",
      contentHash: PASSPORT_HASH,
      contentType: "application/pdf",
      sizeBytes: PASSPORT_BYTES.length,
      uploadedAt: new Date(),
      dates: {},
      retentionPolicyReference: "AAS-RET-B1-01",
      retentionTriggeredAt: null,
    },
    `documents/${studentUuid}/passport`,
  );
  vaultServer = await new Promise<Server>((resolve) => {
    const listening = createServer((request, response) => {
      if ((request.url ?? "").startsWith(`/objects/${PASSPORT_ID}`)) {
        response.writeHead(200, { "content-type": "application/pdf" }).end(PASSPORT_BYTES);
        return;
      }
      response.writeHead(404).end();
    }).listen(VAULT_PORT, "127.0.0.1", () => resolve(listening));
  });
  const records = new PostgresDocumentRecordStore(conversationPool);
  const notHere = (what: string) => (): Promise<never> =>
    Promise.reject(new Error(`${what} is not part of this journey`));
  journeyVault = {
    prepareUpload: notHere("prepareUpload"),
    confirmUpload: notHere("confirmUpload"),
    describe: (documentId) => records.get(documentId).then((held) => held?.record ?? null),
    prepareRetrieval: (documentId, now) =>
      Promise.resolve({
        url: `${VAULT_URL}/objects/${documentId}?until=${String(now.getTime() + 60_000)}`,
        method: "GET" as const,
        expiresAt: new Date(now.getTime() + 60_000),
      }),
    listForStudent: (studentId) => records.listForStudent(studentId),
    transition: notHere("transition"),
    startRetentionClock: notHere("startRetentionClock"),
    purgeContents: notHere("purgeContents"),
  };

  // The student's own session, minted by the service's own issuer rather than
  // by a cookie string assembled here — the format is `session.ts`'s to own.
  devCookie = (issueSession(studentUuid, SESSION_SECRET).split(";")[0] ?? "").trim();

  // ── The first step of the journey, taken the way a student takes it ────
  //
  // ADR-0060. Over HTTP, on the student's own session, against the running
  // service — not an INSERT. What comes back is the id every later request in
  // this file uses, so if the route were wrong nothing below would work.
  const opened = await recordingFetch(`${CONVERSATION_URL}/v1/conversations`, {
    method: "POST",
    headers: { "Idempotency-Key": "journey-opens-one-conversation", cookie: devCookie },
  });
  if (opened.status !== 201) throw new Error(`could not open a conversation: ${opened.status}`);
  CONVERSATION = ((await opened.json()) as { id: string }).id;
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(CONVERSATION)) {
    throw new Error(`the service returned an id the contract forbids: ${CONVERSATION}`);
  }

  runnerBrowser = await chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${String(CDP_PORT)}`, "--remote-debugging-address=127.0.0.1"],
  });
  const version = (await (
    await fetch(`http://127.0.0.1:${String(CDP_PORT)}/json/version`)
  ).json()) as { webSocketDebuggerUrl: string };
  cdpEndpoint = version.webSocketDebuggerUrl;
  journeyHold = new SessionHold({ browser: runnerBrowser, now: () => new Date() });
  journeyIntake = httpWorkIntake({
    baseUrl: CONVERSATION_URL,
    holder: "runner-journey",
    serviceToken: RUNNER_CERT,
    fetch: recordingFetch as unknown as typeof globalThis.fetch,
    sessions: () => journeyHold.held(),
  });
  journeyPerformer = runnerPerformer({
    browser: runnerBrowser,
    browserEndpoint: cdpEndpoint,
    agentBaseUrl: AGENT,
    agentServiceToken: RUNNER_CERT,
    intake: journeyIntake,
    hold: journeyHold,
    register: b2Register(new Date()),
    now: () => new Date(),
    fetch: recordingFetch as unknown as typeof globalThis.fetch,
  });

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
  // Two qualifications: the education page is filled once per item (P96).
  await confirmInto(
    profiles,
    "education.prior_qualifications",
    [
      { level: "Bachelor's degree", subject: "Industrial Engineering", institution: "Sharif University of Technology", countryCode: "IR", completionYear: 2021, grade: "17.2", gradeScale: "iran_20_point" },
      { level: "High school diploma", subject: "Mathematics and Physics", institution: "Farzanegan High School", countryCode: "IR", completionYear: 2017, grade: "19.1", gradeScale: "iran_20_point" },
    ],
    "as stated",
  );
  await confirmInto(
    profiles,
    "study.personal_statement",
    "Because it is the course I want.",
    "…",
  );
}, 300_000);

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  await journeyHold.closeAll();
  await runnerBrowser.close();
  await portal.stop();
  await new Promise<void>((resolve) => conversationServer.close(() => resolve()));
  await new Promise<void>((resolve) => vaultServer.close(() => resolve()));
  await new Promise<void>((resolve) => agentServer.close(() => resolve()));
  await new Promise<void>((resolve) => secureServer.close(() => resolve()));
  await conversationPool.end();
  await securePool.end();
  await rm(publicDir, { recursive: true, force: true });
  await rm(secureAssetDir, { recursive: true, force: true });
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

/**
 * The student's browser, on the student's page.
 *
 * A context of its own on the one browser this file launches — the runner's
 * context is a different jar, and the two must never share a cookie. Every
 * request the context makes, from the page or from the frame inside it, is
 * recorded into `wire` exactly as the service-to-service calls are, so the
 * password scan at the end of this file sees the browser's wires too. The
 * secure plane's POST is the one line that may carry it.
 *
 * `init` runs before any script of the page's, which is how a test states a
 * capability the page would otherwise observe for itself.
 */
async function studentPage(init?: () => void): Promise<{ page: Page; context: BrowserContext }> {
  const context = await runnerBrowser.newContext();
  context.on("request", (request: BrowserRequest) => {
    const body = request.postData();
    if (body !== null) wire.push({ where: `→ ${request.url()}`, body });
  });
  context.on("response", (response) => {
    void response
      .text()
      .then((body) => wire.push({ where: `← ${response.url()} ${String(response.status())}`, body }))
      .catch(() => undefined);
  });
  if (init !== undefined) await context.addInitScript(init);
  const minted = await context.request.post(`${CONVERSATION_URL}/dev/session`, {
    data: { subject: studentUuid },
    headers: { "Content-Type": "application/json" },
  });
  expect(minted.status(), "the session route must mint a cookie").toBe(204);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`[page threw] ${String(error)}`));
  await page.goto(CONVERSATION_URL, { waitUntil: "domcontentloaded" });
  return { page, context };
}

/** The frame tokens the Secure Plane has minted for one request. */
async function frameTokensMinted(requestId: string): Promise<number> {
  const counted = await securePool.query<{ n: string }>(
    "SELECT count(*) AS n FROM frame_tokens WHERE request_id = $1",
    [requestId],
  );
  return Number(counted.rows[0]?.n ?? 0);
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
async function restartedInstance(clock: () => Date = () => new Date()): Promise<{
  readonly baseUrl: string;
  readonly intake: ReturnType<typeof httpWorkIntake>;
  readonly performer: ReturnType<typeof runnerPerformer>;
  readonly held: () => Promise<readonly string[]>;
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
    identities: new StudentIdentityStore(pool),
    leases: new WorkLeaseStore(pool),
    sessions: new RunSessionStore(pool),
    heldDocuments: new PostgresDocumentRecordStore(pool),
    disclosure: { register: b2Register(new Date()), vault: journeyVault },
    transmissions: new TransmissionStore(pool),
    now: clock,
  });
  const app = createConversationApp({
    store,
    sessionSecret: SESSION_SECRET,
    authorise: () => Promise.resolve(true),
    authoriseService: (req) => req.header("x-service-cert") === RUNNER_CERT,
    now: clock,
    runs: driver,
    targets: journeyCatalogue,
    secureRequests: journeySecureRequests,
    secureOrigin: SECURE,
  });
  const port = CONVERSATION_PORT + 20;
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(port, "127.0.0.1", () => resolve(listening));
  });

  // A restarted runner holds NOTHING: the old context's cookie is gone with
  // the process that held it, and the password that made it was single-use
  // and is gone. Until P72 this file signed the new context in with the
  // password it happened to know; now the way back in is the resume path
  // (ADR-0101 §3), driven below through the real secure box and the real
  // performer. The hold starts empty.
  const hold = new SessionHold({ browser: runnerBrowser, now: () => new Date() });

  const intake = httpWorkIntake({
    baseUrl: `http://127.0.0.1:${String(port)}`,
    holder: "runner-restarted",
    serviceToken: RUNNER_CERT,
    fetch: recordingFetch as unknown as typeof globalThis.fetch,
    sessions: () => hold.held(),
  });
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    held: () => hold.held(),
    intake,
    performer: runnerPerformer({
      browser: runnerBrowser,
      browserEndpoint: cdpEndpoint,
      agentBaseUrl: AGENT,
      agentServiceToken: RUNNER_CERT,
      intake,
      hold,
      register: b2Register(new Date()),
      now: () => new Date(),
      fetch: recordingFetch as unknown as typeof globalThis.fetch,
    }),
    close: async () => {
      await hold.closeAll();
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
  const usable = checkUsable(GATED_PORTAL_WITH_DOCUMENTS_MAPPING_SET, GATED_PORTAL_WITH_DOCUMENTS_BLUEPRINT);
  if (!usable.usable) expect.unreachable("the gated mapping set is reviewed");
  const plan = planFill(GATED_PORTAL_WITH_DOCUMENTS_BLUEPRINT, usable.mappingSet, journeyProfile);
  const preview = buildPreview(
    GATED_PORTAL_WITH_DOCUMENTS_BLUEPRINT,
    plan,
    new Map([["passport", { documentId: PASSPORT_ID, describedAs: "passport", contentHash: PASSPORT_HASH }]]),
    // The fixture portal, not `gated.portal.test`: the entry names it as the
    // deployment, and the preview names where the passport actually goes.
    { portalHost: portal.host },
  );
  if (!preview.built) expect.unreachable(`preview refused: ${preview.refusal.kind}`);
  return { contentHash: preview.preview.contentHash };
}

describeIfDatabase("a student asks, and ends up with an account they own", () => {
  let runId = "";

  it("starts a run, and the run asks the student to AUTHORISE before anything else", async () => {
    wire = [];
    logLines = [];

    // ══════════════════════════════════════════════════════════════════
    // GATE 1 (ADR-0058). Before anything can be started, the server resolves
    // the chosen reviewed target and puts it to the student. Nothing here is
    // consequential — no case, no run — and the hash it returns is the only
    // thing the request below can name.
    // ══════════════════════════════════════════════════════════════════
    const offered = await recordingFetch(
      `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/target-offers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: devCookie },
        body: JSON.stringify({ blueprintId: BLUEPRINT }),
      },
    );
    expect(offered.status, await offered.clone().text()).toBe(201);
    const offer = (await offered.json()) as { offerHash: string; rendered: string };
    journeyOffer = offer.offerHash;
    expect(journeyOffer).toMatch(/^sha256:[0-9a-f]{64}$/);
    // What the student read, deterministic and model-free: the institution,
    // the course, the intake and the portal it will actually be applied
    // through. "What exactly did I agree to?" has an answer.
    expect(offer.rendered).toContain("Course: MSc Controlled Studies");
    expect(offer.rendered).toContain(portal.host);

    // Nothing was opened by being offered something.
    const noCase = await conversationPool.query<{ case_id: string | null }>(
      "SELECT case_id FROM conversations WHERE id = $1",
      [CONVERSATION],
    );
    expect(noCase.rows[0]?.case_id ?? null, "an offer is not a case").toBeNull();

    const started = await recordingFetch(`${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: devCookie },
      body: JSON.stringify({ offerHash: journeyOffer, studentStatement: STATEMENT }),
    });
    expect(started.status, await started.clone().text()).toBe(201);
    const run = (await started.json()) as { runId: string; step: string; phase: string };
    runId = run.runId;

    // ══════════════════════════════════════════════════════════════════
    // ADR-0101 — the yes first. The gated portal needs an account and the
    // account needs a password, and neither is asked for until the student
    // has read exactly what will be sent and said yes to it. Vahid: *"today
    // we ask a student for their university password for an account they
    // have not yet agreed to have created, to submit an application they
    // have not yet seen. That order is wrong even if it cost us nothing to
    // keep."*
    // ══════════════════════════════════════════════════════════════════
    expect(run.step).toBe("authorise");
    expect(run.phase).toBe("awaiting_authorisation");

    // And the conversation's own log says so, authoritatively.
    const events = await conversationPool.query<{ kind: string; request_id: string | null }>(
      "SELECT kind, request_id FROM conversation_events WHERE conversation_id = $1 ORDER BY ordinal",
      [CONVERSATION],
    );
    // The whole progression, in order, in one log: the server offered, the
    // student read it, the student asked for THAT offer, and the run told
    // them there is something to approve (P22). No secure step has opened.
    // ADR-0058's journey, as evidence rather than as prose.
    expect(events.rows.map((row) => row.kind)).toEqual([
      "target_offered",
      "message",
      "target_requested",
      "message",
    ]);

    // And no work is offered while it waits, and nothing has been typed. A
    // runner cannot get ahead of the student's approval — nor, now, can an
    // account be created ahead of it.
    const intake = httpWorkIntake({
      baseUrl: CONVERSATION_URL,
      holder: "runner-journey",
      serviceToken: RUNNER_CERT,
      fetch: recordingFetch as unknown as typeof globalThis.fetch,
    });
    expect(await intake.claim(), "nothing to do until the student approves").toBeNull();
    expect(portal.accounts(), "and no account exists").toEqual([]);
    expect(portal.application(EMAIL), "and nothing typed").toBeNull();
  }, 300_000);

  it("the student approves, over the real decision route, and only then is asked for a password", async () => {
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

    // ══════════════════════════════════════════════════════════════════
    // ADR-0059. Until P22 this test obtained the hash by REBUILDING the
    // preview in-process — `checkUsable` + `planFill` + `buildPreview` over the
    // blueprint, the mapping set and the plan. A browser holds none of those
    // and must not, so the authorisation gate was passable by this suite and by
    // nothing else. It now asks the way a client has to.
    // ══════════════════════════════════════════════════════════════════
    // ── Where a returning client starts: a READ, not an action ────────
    //
    // ADR-0060. This is the request a page makes on load. It carries no offer
    // hash and no run id — the client kept neither — and it is what tells the
    // student their application is waiting for them.
    const standing = await recordingFetch(
      `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs`,
      { headers: { cookie: devCookie } },
    );
    expect(standing.status).toBe(200);
    const position = parseConversationRun(((await standing.json()) as { run: unknown }).run);
    if (position === null) expect.unreachable("the run read did not match the published contract");
    expect(position.runId, "the client did not have to remember this").toBe(runId);
    expect(position.step).toBe("authorise");

    const shown = await recordingFetch(
      `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs/${position.runId}/preview`,
      { headers: { cookie: devCookie } },
    );
    expect(shown.status, await shown.clone().text()).toBe(200);
    expect(shown.headers.get("cache-control"), "not cached, not stored").toBe("no-store");
    const preview = parseRunPreview(await shown.json());
    if (preview === null) expect.unreachable("the preview did not match the published contract");

    // What the student actually reads: this university, this course, and the
    // values that will be typed — ending in the reference their approval names.
    expect(preview.presentedText).toContain("Gated University");
    expect(preview.presentedText).toContain("This is exactly what will be submitted.");
    expect(preview.presentedText).toContain(`Reference: ${preview.contentHash}`);
    // ADR-0104, in Vahid's words: under each qualification the student can
    // see which documents they attach themselves and which we filled.
    expect(preview.presentedText.match(/ {2}You attach yourself: Certificate/g)).toHaveLength(2);
    // The destination the student reads is the one the bytes go to — the
    // fixture portal this entry is deployed against — and not the host the
    // reviewed blueprint observed (ADR-0098 as amended in P74). The runner's
    // transmission gate is asked about exactly this host later.
    expect(preview.presentedText).toContain(`Portal: ${portal.host}`);
    expect(preview.presentedText).toContain(`going to: Gated University (${portal.host})`);
    expect(preview.presentedText).not.toContain("gated.portal.test");

    // And it is the SAME content the orchestrator would fill from. Re-derived
    // independently here — the old path — purely to prove the route did not
    // hand the student a different application from the one that gets typed.
    expect(preview.contentHash, "read and filled are one rendering").toBe(
      previewForThisRun().contentHash,
    );

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

    // Only NOW is the password asked for (ADR-0101).
    const advanced = await recordingFetch(
      `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: devCookie },
        body: JSON.stringify({ offerHash: journeyOffer, studentStatement: STATEMENT }),
      },
    );
    expect(advanced.status).toBe(200);
    const run = (await advanced.json()) as { step: string; phase: string };
    expect(run.step, "approved; now the account, and first its password").toBe("request_secret");
    expect(run.phase).toBe("awaiting_secret");

    const events = await conversationPool.query<{ kind: string; request_id: string | null }>(
      "SELECT kind, request_id FROM conversation_events WHERE conversation_id = $1 ORDER BY ordinal",
      [CONVERSATION],
    );
    expect(events.rows.map((row) => row.kind).at(-1)).toBe("secret_requested");
    expect(events.rows.at(-1)?.request_id).toMatch(/^sr_[0-9a-f]{32}$/);
  }, 300_000);

  it("REFUSES to open the password box on an insecure page, and mints NOTHING", async () => {
    // ══════════════════════════════════════════════════════════════════
    // ADR-0100. The page decides whether it can show the step BEFORE it asks
    // for the bootstrap, because the bootstrap is the mint. A page that is
    // not a secure context is told so in a fixed sentence, mounts no frame,
    // and — the property — leaves the Secure Plane's `frame_tokens` exactly
    // as it found them. The request stays open: this page holds nothing that
    // could cancel it, and should not.
    //
    // `isSecureContext` is the browser's own word; loopback is one, so the
    // page is told otherwise before any of its script runs.
    // ══════════════════════════════════════════════════════════════════
    const open = await conversationPool.query<{ request_id: string }>(
      "SELECT request_id FROM conversation_events WHERE conversation_id = $1 AND kind = 'secret_requested'",
      [CONVERSATION],
    );
    const requestId = open.rows[0]!.request_id;
    const before = await frameTokensMinted(requestId);
    const bootstraps = (): number =>
      wire.filter((entry) => entry.where.includes(`/secure-requests/${requestId}/bootstrap`)).length;
    const seenBefore = bootstraps();

    // `scripts/` compiles without the DOM library; in the browser `globalThis`
    // is `window`, and the shapes are stated where they are used.
    const { page, context } = await studentPage(() => {
      Object.defineProperty(globalThis, "isSecureContext", { value: false, configurable: true });
    });
    await page.locator("#secure-refusal").waitFor({ timeout: 20_000 });
    expect(await page.locator("#secure-refusal").getAttribute("data-reason")).toBe(
      "insecure_context",
    );
    // The sentence is the fixed one for that code — chosen from a table, never
    // assembled — and it tells the student not to type it into the chat.
    expect(await page.locator("#secure-refusal").textContent()).toBe(
      refusalText("insecure_context"),
    );
    expect(await page.locator("#secure iframe").count(), "no frame was mounted").toBe(0);
    expect(await page.content()).not.toContain('type="password"');
    // The composer is shut, because the log still shows the step open.
    expect(await page.locator("#composer button").isDisabled()).toBe(true);

    // Nothing was asked for, so nothing was minted. Measured on BOTH sides of
    // the boundary: no bootstrap request left the browser, and the Secure
    // Plane's table did not grow.
    await page.waitForTimeout(500);
    expect(bootstraps(), "the page fetched a capability it could not use").toBe(seenBefore);
    expect(
      await frameTokensMinted(requestId),
      "a token was minted for a frame that never mounted",
    ).toBe(before);
    await context.close();
  }, 120_000);

  it("takes the student's password through the REAL frame, and no postMessage carries it", async () => {
    const open = await conversationPool.query<{ request_id: string }>(
      "SELECT request_id FROM conversation_events WHERE conversation_id = $1 AND kind = 'secret_requested'",
      [CONVERSATION],
    );
    const requestId = open.rows[0]!.request_id;

    // ══════════════════════════════════════════════════════════════════
    // The student's page, in a real browser, mounting the real frame from the
    // real secure origin — and every message the page receives across that
    // boundary, captured BEFORE any listener of the page's could see it. What
    // appears in this list is what the Secure Plane chose to send.
    // ══════════════════════════════════════════════════════════════════
    const { page, context } = await studentPage(() => {
      const seen: unknown[] = [];
      const w = globalThis as unknown as {
        __frameMessages: unknown[];
        addEventListener(
          type: string,
          listener: (event: { readonly data: unknown }) => void,
          capture: boolean,
        ): void;
      };
      w.__frameMessages = seen;
      w.addEventListener("message", (event) => seen.push(event.data), true);
    });
    const frame = page.frameLocator("#secure iframe");
    await frame.locator("#secure-form").waitFor({ state: "visible", timeout: 20_000 });
    await frame.locator("#secure-password").fill(PASSWORD);
    await frame.locator("#secure-confirmation").fill(PASSWORD);
    await frame.locator("#secure-submit").click();
    // The frame's own word — `#state` is the element the control writes to
    // (`data-testid="secure-state"` is its name for a test, not its id).
    await expect
      .poll(async () => await frame.locator("#state").textContent(), { timeout: 20_000 })
      .toContain("received");

    // The Secure Plane tells the Conversation Plane through its OUTBOX — the
    // same `internalAppend` `background.ts` drains with, called once here
    // rather than on a timer. It is the only way the transition reaches the
    // log: the page cannot write it, and does not try.
    const drained = await secureOutbox.publish(
      internalAppend({
        baseUrl: CONVERSATION_URL,
        serviceCertificate: SECURE_CERT,
        fetch: recordingFetch as unknown as typeof globalThis.fetch,
      }),
      { now: new Date() },
    );
    expect(drained.delivered, "the receipt reached the conversation plane").toBeGreaterThan(0);
    expect(drained.failed).toBe(0);

    // The page re-reads on the event, finds the step settled, and the frame
    // is gone — a fact it learned from the log, not from the frame.
    await expect
      .poll(async () => await page.locator("#secure iframe").count(), { timeout: 20_000 })
      .toBe(0);

    const messages = await page.evaluate(() =>
      JSON.stringify((globalThis as unknown as { __frameMessages: unknown[] }).__frameMessages),
    );
    expect(messages, "a postMessage carried the credential").not.toContain(PASSWORD);
    // And it DID carry the lifecycle, so the scan is not passing on an empty
    // list — the classic way a leak scan quietly stops looking.
    expect(messages).toContain('"ready"');
    expect(messages).toContain("secret_received");
    expect(messages).toContain(requestId);
    await context.close();

    // The conversation plane learned a HANDLE. Every row of its log, scanned.
    const rows = await conversationPool.query<{ row: string }>(
      "SELECT e::text AS row FROM conversation_events e WHERE e.conversation_id = $1",
      [CONVERSATION],
    );
    for (const { row } of rows.rows as readonly { row: string }[]) {
      expect(row, "the conversation plane may not hold the password").not.toContain(PASSWORD);
      expect(row.toLowerCase()).not.toContain("password");
    }
    // target_offered · message (the rendered offer) · target_requested ·
    // message (something to approve) · secret_requested · secret_received.
    const kinds = rows.rows.length;
    expect(kinds).toBe(6);
  }, 300_000);

  it("advances to account creation, and offers it to a runner as work", async () => {
    const advanced = await recordingFetch(
      `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: devCookie },
        body: JSON.stringify({ offerHash: journeyOffer, studentStatement: STATEMENT }),
      },
    );
    expect(advanced.status).toBe(200);
    const run = (await advanced.json()) as { step: string; phase: string };
    expect(run.step).toBe("create_account");
    expect(run.phase).toBe("creating_account");
  }, 300_000);

  it("the RUNNER claims it, creates the account, and reports back", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The real loop. `runOneTurn` claims over real HTTP, performs with the
    // PRODUCTION performer in a real browser against a real portal, and
    // reports over real HTTP. The context the account is created in is the
    // hold's, and it is what the fill below is performed in (ADR-0101 §2).
    // ═══════════════════════════════════════════════════════════════════
    expect(await journeyHold.held(), "nothing held before the account exists").toEqual([]);
    const turn = await runOneTurn(journeyIntake, journeyPerformer);
    expect(turn).toEqual({
      kind: "worked",
      runId,
      report: { leaseId: expect.any(String), outcome: "succeeded" },
    });
    expect(await journeyHold.held(), "the signed-in session, kept for the fill").toEqual([runId]);

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

  it("advances to the FILL, and offers it to a runner as work", async () => {
    // The account exists and the yes was given before it (ADR-0101), so the
    // next thing is the form itself.
    const advanced = await recordingFetch(
      `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: devCookie },
        body: JSON.stringify({ offerHash: journeyOffer, studentStatement: STATEMENT }),
      },
    );
    expect(advanced.status).toBe(200);
    const run = (await advanced.json()) as { step: string; phase: string };
    expect(run.step, "authorised and signed in; now it is work").toBe("execute");
    expect(run.phase).toBe("filling");
  }, 300_000);

  it("the RUNNER claims the FILL, and types the student's own answers", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0046. The plan crossed as text plus the provenance the student's
    // confirmation produced, and was reassembled on this side through the one
    // mint. What runs is `executePlan` — the same function the in-process demo
    // has always run, on the same plan the Application Plane built.
    // ═══════════════════════════════════════════════════════════════════
    // The PRODUCTION performer, in the context the hold kept from the
    // account's creation (ADR-0101 §2): the real session, the real document
    // source under the lease (ADR-0099 — this plan references no upload, so
    // the plane is not asked), and the challenge probe on the real page
    // (ADR-0101 §6). Not a performer of this file's own: the first version of
    // this test wrote one and lost the option check, the checkbox handling
    // and the read-back that catches a portal silently truncating a personal
    // statement — and typed "IR" into a `<select>`.
    let received: ReturnType<typeof journeyPerformer> extends Promise<unknown>
      ? Parameters<typeof journeyPerformer>[0]["plan"]
      : never;
    const turn = await runOneTurn(journeyIntake, (work) => {
      received = work.plan;
      return journeyPerformer(work);
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

  it("RESUMES on the second page after a restart — signed back in by the resume path — and does not re-do the first", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0047 and ADR-0101 §3 together. Everything in memory is thrown away
    // — a new driver, a new pool, an EMPTY session hold — and the plane is
    // looked at from five minutes later, which is what a runner that died
    // looks like to it: the session it recorded from the last report is past
    // the ceiling. So the run does the one thing that ever asks a student
    // for their password twice: it says why, opens the same secure box, a
    // runner signs in with what they typed, and page two is filled — not
    // page one again, because the intent ledger says page one is saved.
    // ═══════════════════════════════════════════════════════════════════
    const afterTheCeiling = (): Date =>
      new Date(Date.now() + (SECURE_HOLD_CEILING_SECONDS + 1) * 1000);
    const restarted = await restartedInstance(afterTheCeiling);
    try {
      // The Secure Plane settled the creation's handle when the fill agent
      // spent it, and tells this plane through its outbox — drained by the
      // worker's loop in a deployment, and here by hand, as every other
      // lifecycle word in this file reaches the log. Without it the log still
      // says the first password is "received", and the run would rightly not
      // open a second box while a first is unsettled.
      const consumed = await secureOutbox.publish(
        internalAppend({
          baseUrl: CONVERSATION_URL,
          serviceCertificate: SECURE_CERT,
          fetch: recordingFetch as unknown as typeof globalThis.fetch,
        }),
        { now: new Date() },
      );
      expect(consumed.failed).toBe(0);

      // ── Nothing to claim: the fill waits for a session nobody holds ────
      expect(await restarted.intake.claim(), "no runner holds the session").toBeNull();

      // ── The run asks, once more, and says why ─────────────────────────
      const asked = await recordingFetch(`${restarted.baseUrl}/v1/conversations/${CONVERSATION}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: devCookie },
        body: JSON.stringify({ offerHash: journeyOffer, studentStatement: STATEMENT }),
      });
      expect(asked.status).toBe(200);
      const asking = (await asked.json()) as { step: string; phase: string };
      expect(asking.step).toBe("request_secret");
      expect(asking.phase).toBe("awaiting_secret");

      const requests = await conversationPool.query<{ request_id: string }>(
        "SELECT request_id FROM conversation_events WHERE conversation_id = $1 AND kind = 'secret_requested' ORDER BY ordinal",
        [CONVERSATION],
      );
      expect(requests.rows, "the creation's ask, and now the resume path's").toHaveLength(2);
      const resumeRequest = requests.rows[1]!.request_id;
      const purpose = await securePool.query<{ purpose: string; requires_confirmation: boolean }>(
        "SELECT purpose, requires_confirmation FROM secret_requests WHERE request_id = $1",
        [resumeRequest],
      );
      expect(purpose.rows[0]).toEqual({ purpose: "portal_sign_in", requires_confirmation: false });

      // ── The student types it again, into the REAL frame — once ─────────
      //
      // And reads WHY there, on the secure origin: the explanation is stored
      // by the Secure Plane and rendered inside the frame, so no text about a
      // password crosses into the conversation log.
      const { page, context } = await studentPage();
      const frame = page.frameLocator("#secure iframe");
      await frame.locator("#secure-form").waitFor({ state: "visible", timeout: 20_000 });
      expect(await frame.locator("#secure-title").textContent()).toBe(
        `Enter your password for ${GATED_PORTAL_WITH_DOCUMENTS_BLUEPRINT.institutionName}`,
      );
      const why = await frame.locator("#secure-explanation").textContent();
      expect(why).toContain("signed out of your account");
      expect(why).toContain("only reason I would ever ask for it a second time");
      expect(
        await frame.locator("#secure-confirmation").isVisible(),
        "typed once on a sign-in: the portal is the check",
      ).toBe(false);
      await frame.locator("#secure-password").fill(PASSWORD);
      await frame.locator("#secure-submit").click();
      await expect
        .poll(async () => await frame.locator("#state").textContent(), { timeout: 20_000 })
        .toContain("received");
      await context.close();
      const drained = await secureOutbox.publish(
        internalAppend({
          baseUrl: CONVERSATION_URL,
          serviceCertificate: SECURE_CERT,
          fetch: recordingFetch as unknown as typeof globalThis.fetch,
        }),
        { now: new Date() },
      );
      expect(drained.failed).toBe(0);

      // ── The run's next step is the sign-in, and it is work for any runner ─
      const typed = await recordingFetch(`${restarted.baseUrl}/v1/conversations/${CONVERSATION}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: devCookie },
        body: JSON.stringify({ offerHash: journeyOffer, studentStatement: STATEMENT }),
      });
      const signingIn = (await typed.json()) as { step: string; phase: string };
      expect(signingIn.step).toBe("sign_in");
      expect(signingIn.phase).toBe("filling");

      const signIn = await restarted.intake.claim();
      if (signIn === null) expect.unreachable("the sign-in is work");
      expect(signIn.kind).toBe("sign_in");
      expect(signIn.login?.url).toBe(`${portal.baseUrl}/login`);
      expect(signIn.secretHandle).toMatch(/^sh_[0-9a-f]{32}$/);
      expect(await restarted.held(), "held nothing yet").toEqual([]);
      expect(await restarted.performer(signIn)).toEqual({ kind: "succeeded" });
      expect(await restarted.held(), "and now the session, for the fill").toEqual([runId]);
      expect(
        await restarted.intake.report(signIn.runId, { leaseId: signIn.leaseId, outcome: "succeeded" }),
      ).toBe(true);
      // The plane's own record of who is signed in, and the handle gone.
      const session = await conversationPool.query<{ holder: string }>(
        "SELECT holder FROM run_sessions WHERE run_id = $1",
        [runId],
      );
      expect(session.rows[0]?.holder).toBe("runner-restarted");
      const settled = await secureOutbox.publish(
        internalAppend({
          baseUrl: CONVERSATION_URL,
          serviceCertificate: SECURE_CERT,
          fetch: recordingFetch as unknown as typeof globalThis.fetch,
        }),
        { now: new Date() },
      );
      expect(settled.failed).toBe(0);
      const lifecycle = await conversationPool.query<{ kind: string }>(
        "SELECT kind FROM conversation_events WHERE conversation_id = $1 AND request_id = $2 ORDER BY ordinal",
        [CONVERSATION, resumeRequest],
      );
      expect(lifecycle.rows.map((row) => row.kind)).toEqual([
        "secret_requested",
        "secret_received",
        "secret_consumed",
      ]);

      // ── The qualifications page, once per qualification (P96) ─────────
      //
      // ADR-0103 gap 3. The same page is handed out twice, each time for one
      // item, each its own target in the ledger; the runner comes back to
      // the page's URL, presses "Add a qualification", fills the form and
      // saves that one; the portal holds both, in the student's order.
      for (const index of [0, 1]) {
        const entry = await restarted.intake.claim();
        if (entry === null) expect.unreachable(`qualification ${String(index + 1)} is still to add`);
        expect(entry.kind).toBe("execute");
        expect(entry.formUrl, `qualification ${String(index + 1)}: the same page`).toBe(`${portal.baseUrl}/education`);
        expect(entry.repeat).toEqual({
          index,
          count: 2,
          addAnother: { strategy: "id", value: "addQualificationBtn" },
        });
        expect(entry.plan?.instructions.map((instruction) => instruction.fieldRef)).toEqual([
          "qualification_level",
          "qualification_subject",
          "qualification_institution",
          "qualification_year",
          // ADR-0104: the grade box is shown for the school diploma only, and
          // the condition is answered per item — typed for the second entry,
          // not the first.
          ...(index === 1 ? ["qualification_grade_note"] : []),
        ]);
        expect(entry.plan?.instructions.every((instruction) => instruction.item?.index === index)).toBe(true);
        expect(await restarted.performer(entry)).toEqual({ kind: "succeeded" });
        expect(
          await restarted.intake.report(entry.runId, { leaseId: entry.leaseId, outcome: "succeeded" }),
        ).toBe(true);
      }
      expect(portal.application(EMAIL)?.qualifications.map((q) => [q.level, q.institution, q.year, q.gradeNote])).toEqual([
        ["Bachelor's degree", "Sharif University of Technology", "2021", ""],
        ["High school diploma", "Farzanegan High School", "2017", "19.1"],
      ]);
      // The certificates are the student's own act (ADR-0104): nothing was attached by the runner.
      expect(portal.application(EMAIL)?.qualifications.map((q) => q.certificate)).toEqual([null, null]);

      // ── Page two, in the session the sign-in gave this runner ─────────
      const claimed = await restarted.intake.claim();
      if (claimed === null) expect.unreachable("page two is still to do");
      expect(claimed.kind).toBe("execute");
      expect(claimed.formUrl, "the SECOND page").toBe(`${portal.baseUrl}/study`);
      expect(
        claimed.plan?.instructions.map((instruction) => instruction.fieldRef),
        "and only the fields on it",
      ).toEqual(["course", "personal_statement"]);

      // The production performer again, on the restarted instance's own hold.
      const outcome = await restarted.performer(claimed);
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
      expect(intents.rows.map((row) => row.outcome)).toEqual(["succeeded", "succeeded", "succeeded", "succeeded"]);
      expect(intents.rows[0]?.target).toMatch(/^page-application@sha256:[0-9a-f]{64}$/);
      // One target per qualification (P96): two saved items, two rows.
      expect(intents.rows[1]?.target).toMatch(/^page-education@sha256:[0-9a-f]{64}$/);
      expect(intents.rows[2]?.target).toMatch(/^page-education@sha256:[0-9a-f]{64}$/);
      expect(intents.rows[1]?.target).not.toBe(intents.rows[2]?.target);
      expect(intents.rows[3]?.target).toMatch(/^page-study@sha256:[0-9a-f]{64}$/);

      // ═══════════════════════════════════════════════════════════════════
      // Page three: the passport (P74 — ADR-0069, ADR-0099). In the session
      // the sign-in gave this runner, still. The plane hands the document
      // over under the lease after the gates, as a reference; the runner
      // fetches the bytes from the vault, hashes them against what the
      // student authorised, attaches them into the labelled box, saves; and
      // reports what left. The plane settles the attachment's own intent and
      // writes the audit row.
      // ═══════════════════════════════════════════════════════════════════
      const documents = await restarted.intake.claim();
      if (documents === null) expect.unreachable("page three is still to do");
      expect(documents.kind).toBe("execute");
      expect(documents.formUrl, "the THIRD page").toBe(`${portal.baseUrl}/documents`);
      expect(documents.plan?.instructions, "nothing to type on it").toEqual([]);
      expect(documents.plan?.uploads.map((upload) => upload.documentRef)).toEqual(["passport"]);
      const attachIntent = await conversationPool.query<{ target: string; outcome: string | null }>(
        "SELECT target, outcome FROM workflow_action_intents WHERE run_id = $1 AND action = 'attach_document'",
        [runId],
      );
      expect(attachIntent.rows, "opened at the claim, naming the document").toEqual([
        { target: `page-documents/passport_upload=${PASSPORT_ID}@${PASSPORT_HASH}`, outcome: null },
      ]);

      const attached = await restarted.performer(documents);
      expect(attached.kind).toBe("succeeded");
      if (attached.kind !== "succeeded") expect.unreachable("checked above");
      expect(attached.transmissions?.map((t) => [t.fieldRef, t.documentId, t.contentHash, t.toHost])).toEqual([
        ["passport_upload", PASSPORT_ID, PASSPORT_HASH, portal.host],
      ]);
      expect(
        await restarted.intake.report(documents.runId, {
          leaseId: documents.leaseId,
          outcome: "succeeded",
          ...(attached.transmissions === undefined ? {} : { transmissions: attached.transmissions }),
        }),
      ).toBe(true);

      // ── The portal has the file, byte for byte ─────────────────────────
      const received = portal.application(EMAIL)?.passport;
      expect(received?.sha256, "what the portal received is what the student authorised").toBe(PASSPORT_HASH);
      expect(received?.sizeBytes).toBe(PASSPORT_BYTES.length);
      // The bytes crossed one wire the runner's side recorded — from the
      // vault stand-in — and never a service-to-service body.
      expect(
        wire.filter((entry) => entry.where.startsWith(`← ${VAULT_URL}/objects/`)).length,
        "fetched from the vault, once",
      ).toBe(1);

      // ── The plane: the intent settled, the audit row written ──────────
      const attachSettled = await conversationPool.query<{ outcome: string | null }>(
        "SELECT outcome FROM workflow_action_intents WHERE run_id = $1 AND action = 'attach_document'",
        [runId],
      );
      expect(attachSettled.rows).toEqual([{ outcome: "succeeded" }]);
      const caseRow = await conversationPool.query<{ case_id: string }>(
        "SELECT case_id FROM workflow_runs WHERE run_id = $1",
        [runId],
      );
      const left = await new TransmissionStore(conversationPool).forCase(caseRow.rows[0]!.case_id);
      expect(left).toHaveLength(1);
      expect(left[0]).toMatchObject({
        runId,
        documentId: PASSPORT_ID,
        contentHash: PASSPORT_HASH,
        toHost: portal.host,
        institutionName: GATED_PORTAL_WITH_DOCUMENTS_BLUEPRINT.institutionName,
      });
      expect(portal.submissions(), "and still nothing was submitted").toEqual([]);
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
          body: JSON.stringify({ offerHash: journeyOffer, studentStatement: STATEMENT }),
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
        GATED_PORTAL_WITH_DOCUMENTS_BLUEPRINT.institutionName,
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
     * What the run is waiting for, read from the service.
     *
     * ══════════════════════════════════════════════════════════════════
     * ADR-0061. This used to hash the last message in the conversation
     * itself. That worked here and would not work in a client: the hash is
     * over a message the ORCHESTRATOR renders, so a client would have to
     * re-implement that rendering AND be right about which message it was —
     * and "the last one" stopped being right the moment the authorisation
     * announcement (ADR-0059) became an assistant message too.
     * ══════════════════════════════════════════════════════════════════
     */
    const waitingFor = async (): Promise<{ decision: string; contentHash: string }> => {
      const response = await recordingFetch(
        `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs`,
        { headers: { cookie: devCookie } },
      );
      expect(response.status).toBe(200);
      const pending = ((await response.json()) as {
        pending: { decision: string; contentHash: string } | null;
      }).pending;
      if (pending === null) expect.unreachable("the run should be waiting for the student");
      return pending;
    };

    const confirm = async (): Promise<number> => {
      const asked = await waitingFor();
      expect(asked.decision, "the service names the decision, not the client").toBe(
        "confirm_handoff",
      );
      const response = await recordingFetch(
        `${CONVERSATION_URL}/v1/conversations/${CONVERSATION}/runs/${runId}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie: devCookie },
          body: JSON.stringify({
            kind: "confirm_handoff",
            contentHash: asked.contentHash,
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
          body: JSON.stringify({ offerHash: journeyOffer, studentStatement: STATEMENT }),
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
      body: JSON.stringify({ offerHash: journeyOffer, studentStatement: STATEMENT }),
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

  it("put the password on exactly TWO wires — the student's two submissions — and in no log line", () => {
    // Two, since P72: the student typed it once to create the account and once
    // more on the resume path (ADR-0101 §3), each time into the secure box and
    // towards the one endpoint designed to take it, under two different
    // requests. Every other body that crossed a boundary — the agent asking
    // for authority, the service answering, the runner reporting, the sign-in
    // — carries nothing.
    const carrying = wire.filter((entry) => entry.body.includes(PASSWORD));
    expect(carrying, "the recording must have caught both submissions").toHaveLength(2);
    const submission = new RegExp(`^→ ${SECURE}/v1/secret-requests/(sr_[0-9a-f]{32})/secret$`);
    const requests = carrying.map((entry) => submission.exec(entry.where)?.[1]);
    expect(requests[0]).toMatch(/^sr_/);
    expect(requests[1]).toMatch(/^sr_/);
    expect(requests[0], "two asks, two requests").not.toBe(requests[1]);

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
