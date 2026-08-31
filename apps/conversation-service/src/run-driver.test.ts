/**
 * P1 — the run exists, and it survives the process that started it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-31: *"This phase is specifically about proving that the run is
 * real … The implementation must prove that a process restart does not reset
 * the run to an earlier business state. Use PostgreSQL-backed tests. An
 * in-memory test alone is insufficient."*
 *
 * So every assertion here is against a real PostgreSQL, and the restart is a
 * real one: the first app is CLOSED, its pool is ENDED, and a second app is
 * built from nothing but a fresh connection to the same database. Nothing is
 * carried over in a variable.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What the four groups prove ────────────────────────────────────────────
 *
 *   schema   the binding is the database's rule, not a handler's
 *   driver   the orchestrator is genuinely the one deciding
 *   route    a student can start a run, and cannot start someone else's
 *   restart  the case, the run, the checkpoint and the binding all survive
 */

import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { PostgresCaseStore } from "@askimate/aas-case-store/postgres";
import { PostgresWorkflowRunStore } from "@askimate/aas-case-store/postgres-workflow";
import { MIGRATIONS_DIR as CASE_MIGRATIONS } from "@askimate/aas-case-store";
import {
  caseId as makeCaseId,
  proposeValue,
  provenanceOf,
  runId as makeRunId,
  studentId,
  unwrapConfirmed,
} from "@askimate/aas-domain";
import type { ProfileFieldKey, ProfileFieldType } from "@askimate/aas-profile";
import {
  applyConfirmation,
  confirmField,
  emptyProfile,
  isDeclined,
  resolveField,
  toStoredEntry,
} from "@askimate/aas-profile";
import { DeterministicModelClient } from "@askimate/aas-llm";
import { FIXTURE_BLUEPRINT, FIXTURE_MAPPING_SET } from "@askimate/aas-mapping/fixtures";
import {
  GATED_PORTAL_BLUEPRINT,
  GATED_PORTAL_MAPPING_SET,
} from "@askimate/aas-mapping/fixtures/gated";
import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import { parseClaimedWork, parseConversationRun } from "@askimate/aas-contracts";

import { createConversationApp } from "./app.js";
import { ApplicationBindingStore } from "./application-store.js";
import { ConversationEventStore } from "./event-store.js";
import { MIGRATIONS_DIR } from "./index.js";
import { PostgresConfirmedProfileStore } from "./profile-store.js";
import { WorkLeaseStore } from "./work-store.js";
import { RunDriver } from "./run-driver.js";
import type { SecureRequestInput, SecureRequestOpener } from "./secure-requests.js";
import type { ApplicationCatalogue, CatalogueEntry } from "./run-driver.js";
import { issueSession } from "./session.js";

const PORT = 4903;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const SECRET = "a-test-session-secret-that-is-long-enough";
const DATABASE = "aas_conversation_runs";
const NOW = new Date("2026-08-31T10:00:00Z");
const CONVERSATION = "01JBXQ8Z9WKTQ6M4H2NPC00001";
const OTHER_CONVERSATION = "01JBXQ8Z9WKTQ6M4H2NPC00002";
const BLUEPRINT = "bp-fixture-pg";
const STATEMENT = "Please apply to the MSc for me.";

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("P1 — the run exists, and survives a restart");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

/** The reviewed blueprint and its reviewed mapping set. A port, not a table. */
const ENTRY: CatalogueEntry = {
  blueprint: FIXTURE_BLUEPRINT,
  mappingSet: FIXTURE_MAPPING_SET,
  requiredDocuments: [],
  institutionRef: "inst-example",
  courseRef: "course-msc-example",
  // The blueprint's own `intake` is the label "September 2026". The domain's
  // `Intake` is a branded YYYY-MM, because it goes into the submission key.
  // The catalogue states it rather than parsing the label — see CatalogueEntry.
  intakeRef: "2026-09",
};

/**
 * The GATED portal — the one that actually requires an account (P2).
 *
 * Separate from `ENTRY` on purpose: `FIXTURE_BLUEPRINT` has no login and
 * requires a passport upload, so a run against it stops at the preview for want
 * of a document. This one is the path towards the secure step.
 */
const GATED_ENTRY: CatalogueEntry = {
  blueprint: GATED_PORTAL_BLUEPRINT,
  mappingSet: GATED_PORTAL_MAPPING_SET,
  requiredDocuments: [],
  institutionRef: "inst-gated",
  courseRef: "course-msc-controlled",
  intakeRef: "2026-09",
  // What discovery observed about the controlled portal, reviewed. Without it
  // `accountStepFor` answers `specialist` — correctly, because "how does this
  // portal's sign-in work?" is not a question to guess at with a form open.
  portalAuthentication: {
    portalHost: "gated.portal.test",
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

const GATED_BLUEPRINT = "bp-gated-portal";

const CATALOGUE: ApplicationCatalogue = {
  find: (id) =>
    Promise.resolve(id === BLUEPRINT ? ENTRY : id === GATED_BLUEPRINT ? GATED_ENTRY : null),
};

let pool: pg.Pool;
let server: Server;
let studentId_: string;
let otherStudentId: string;

function cookieFor(subject: string): string {
  return (issueSession(subject, SECRET).split(";")[0] ?? "").trim();
}

/**
 * Everything a Conversation Service instance needs, built from a connection
 * string and nothing else.
 *
 * Written as a factory precisely so the restart test can call it twice. An
 * instance that reused an object from the first would not be a restart.
 */
function buildInstance(
  connectionString: string,
  secureRequests: SecureRequestOpener | null = null,
  /** Overridden only where a test needs a differently-deployed blueprint. */
  catalogue: ApplicationCatalogue = CATALOGUE,
): {
  readonly pool: pg.Pool;
  readonly driver: RunDriver;
  readonly app: ReturnType<typeof createConversationApp>;
} {
  const instancePool = new pg.Pool({ connectionString, max: 8 });
  const store = new ConversationEventStore(instancePool);
  const driver = new RunDriver({
    stores: {
      cases: new PostgresCaseStore(instancePool),
      runs: new PostgresWorkflowRunStore(instancePool),
    },
    bindings: new ApplicationBindingStore(instancePool),
    catalogue,
    model: new DeterministicModelClient(),
    // ADR-0044: the profile comes from the database, so a new instance resumes
    // an interview where the last one left it.
    profiles: new PostgresConfirmedProfileStore(instancePool),
    conversations: store,
    ...(secureRequests === null ? {} : { secureRequests }),
    // ADR-0045. Present in every instance, because the claim path answering
    // "nothing to do" and the claim path not existing must not look alike.
    leases: new WorkLeaseStore(instancePool),
    now: () => NOW,
  });
  const app = createConversationApp({
    store,
    sessionSecret: SECRET,
    authorise: async (subject, conversation) => {
      const owned = await instancePool.query(
        "SELECT 1 FROM conversations WHERE id = $1 AND student_id = $2",
        [conversation, subject],
      );
      return owned.rowCount === 1;
    },
    now: () => NOW,
    runs: driver,
    // P4: one client for the secure plane. The driver opens requests through
    // it and the bootstrap endpoint mints frame tokens through it, so a test
    // cannot accidentally prove the wiring against two different services.
    ...(secureRequests === null ? {} : { secureRequests }),
    secureOrigin: "https://secure.test",
  });
  return { pool: instancePool, driver, app };
}

function connectionString(): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${DATABASE}`;
  return url.toString();
}

/**
 * Confirms one field the way the interview does, and stores it.
 *
 * At module scope because two groups need it: E proves the profile survives a
 * restart, and F needs a run that has got PAST the interview before it can
 * reach the secure step at all.
 */
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
      studentRef: studentId(studentId_),
      presentedText: "Is that right?",
      response: { kind: "accepted" },
      respondedAt: NOW,
    },
  });
  if (isDeclined(result)) expect.unreachable(`${key} should have been accepted`);
  const profile = confirmField(emptyProfile(studentId(studentId_), NOW), result, NOW);
  const entry = profile.entries.get(key);
  if (entry === undefined) expect.unreachable(`${key} should be in the profile`);
  await store.save(studentId_, toStoredEntry(key, entry));
}

/** The six answers the gated run needs before it can ask for a password. */
async function confirmTheInterview(store: PostgresConfirmedProfileStore): Promise<void> {
  await confirmInto(store, "identity.given_name", "Niloofar", "Niloofar");
  await confirmInto(store, "identity.family_name", "Hosseini", "Hosseini");
  await confirmInto(store, "identity.date_of_birth", new Date("1999-04-02T00:00:00Z"), "2 April 1999");
  await confirmInto(store, "identity.nationality", "Iranian", "Iranian");
  await confirmInto(store, "contact.email", "niloofar@example.test", "niloofar@example.test");
  await confirmInto(store, "study.personal_statement", "Because it is the course I want.", "…");
}

/**
 * A stand-in Secure Interaction Service that records what it was asked.
 *
 * At module scope because EVERY run against the gated portal now needs one: a
 * run that reaches `request_secret` with no way to ask refuses rather than
 * carrying on, which is the point of the P4 refusal and is asserted below.
 */
function opener(delayMs = 0): SecureRequestOpener & {
  readonly opens: SecureRequestInput[];
  readonly tokens: string[];
} {
  const opens: SecureRequestInput[] = [];
  const tokens: string[] = [];
  let n = 0;
  return {
    opens,
    tokens,
    open: async (input) => {
      // `opens` is recorded on ENTRY, and the answer is delayed on request.
      // The delay is what makes the racing test deterministic: it holds the
      // winner inside `open` long enough that a second caller would certainly
      // have read the log — and found no request in it — before the winner's
      // event was appended. Without it the race resolves by luck and the test
      // passes whether or not the ordering below is right.
      opens.push(input);
      n += 1;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        requestId: `sr_${String(n).padStart(32, "0")}`,
        expiresAt: new Date(NOW.getTime() + 300_000).toISOString(),
        frameToken: `ft_${String(n)}`,
      };
    },
    mintFrameToken: (requestId) => {
      tokens.push(requestId);
      return Promise.resolve(`ft_fresh_${requestId}`);
    },
  };
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DATABASE}`);
  } finally {
    await admin.end();
  }
  pool = new pg.Pool({ connectionString: connectionString(), max: 8 });

  // BOTH schemas, into the one database the Application Plane's service owns.
  // The registry is keyed by filename, so `0001_conversation_log` and
  // `0001_case_events` are different rows rather than a collision.
  await migrate(pool, CASE_MIGRATIONS);
  await migrate(pool, MIGRATIONS_DIR);

  const student = await pool.query<{ id: string }>(
    "INSERT INTO students (subject, email_verified) VALUES ('oidc-runs', true) RETURNING id",
  );
  studentId_ = student.rows[0]!.id;
  const other = await pool.query<{ id: string }>(
    "INSERT INTO students (subject, email_verified) VALUES ('oidc-runs-other', true) RETURNING id",
  );
  otherStudentId = other.rows[0]!.id;

  await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
    CONVERSATION,
    studentId_,
  ]);
  await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
    OTHER_CONVERSATION,
    otherStudentId,
  ]);

  const instance = buildInstance(connectionString());
  server = await new Promise<Server>((resolve) => {
    const listening = instance.app.listen(PORT, "127.0.0.1", () => resolve(listening));
  });
}, 180_000);

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

// ───────────────────────────────────────────────────────────────────────────
// A. The schema
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the conversation ↔ case binding is the database's rule", () => {
  it("applies migration 0002, and records it as forward-only", async () => {
    const applied = await pool.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    const versions = applied.rows.map((row) => row.version);
    expect(versions).toContain("0002_application_runs");
    // Both schemas in one database, with no collision between their 0001s.
    expect(versions).toContain("0001_conversation_log");
    expect(versions).toContain("0001_case_events");

    // Re-running is a no-op, and a CHANGED file would throw. That is the
    // forward-only rule, exercised rather than described.
    const again = await migrate(pool, MIGRATIONS_DIR);
    expect(again).toEqual([]);
  });

  it("binds a conversation to a case its own student owns", async () => {
    const bindings = new ApplicationBindingStore(pool);
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      "01JBXQ8Z9WKTQ6M4H2NPC00010",
      studentId_,
    ]);
    const bound = await bindings.withBinding(
      {
        conversationId: "01JBXQ8Z9WKTQ6M4H2NPC00010",
        caseId: "case-bindable",
        blueprintId: BLUEPRINT,
        now: NOW,
      },
      (boundCase, created) => Promise.resolve({ boundCase, created }),
    );
    expect(bound.created).toBe(true);
    expect(bound.boundCase).toEqual({
      caseId: "case-bindable",
      studentId: studentId_,
      blueprintId: BLUEPRINT,
    });

    // Idempotent: the same question, the same answer, no second case.
    const again = await bindings.withBinding(
      {
        conversationId: "01JBXQ8Z9WKTQ6M4H2NPC00010",
        caseId: "case-something-else",
        blueprintId: BLUEPRINT,
        now: NOW,
      },
      (boundCase, created) => Promise.resolve({ boundCase, created }),
    );
    expect(again.created).toBe(false);
    expect(again.boundCase.caseId).toBe("case-bindable");
  });

  it("REFUSES, in the database, a case belonging to a different student", async () => {
    // The composite foreign key over (student_id, case_id). A plain reference
    // to `cases (case_id)` would accept this row: the case would exist and the
    // ownership would be wrong.
    await pool.query("INSERT INTO cases (case_id, student_id) VALUES ($1, $2)", [
      "case-of-another-student",
      otherStudentId,
    ]);
    await expect(
      pool.query("UPDATE conversations SET case_id = $1 WHERE id = $2", [
        "case-of-another-student",
        CONVERSATION,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("REFUSES a case that does not exist at all", async () => {
    await expect(
      pool.query("UPDATE conversations SET case_id = $1 WHERE id = $2", [
        "case-never-created",
        CONVERSATION,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("REFUSES a second conversation claiming one case", async () => {
    // "Which conversation authorised this?" must have one answer, and that
    // question is the whole reason the binding exists.
    await pool.query("INSERT INTO cases (case_id, student_id) VALUES ($1, $2)", [
      "case-contested",
      studentId_,
    ]);
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      "01JBXQ8Z9WKTQ6M4H2NPC00011",
      studentId_,
    ]);
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      "01JBXQ8Z9WKTQ6M4H2NPC00012",
      studentId_,
    ]);
    await pool.query("UPDATE conversations SET case_id = $1 WHERE id = $2", [
      "case-contested",
      "01JBXQ8Z9WKTQ6M4H2NPC00011",
    ]);
    await expect(
      pool.query("UPDATE conversations SET case_id = $1 WHERE id = $2", [
        "case-contested",
        "01JBXQ8Z9WKTQ6M4H2NPC00012",
      ]),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("lets a conversation exist with no case at all", async () => {
    // MATCH SIMPLE: a NULL case_id satisfies the composite key, so a
    // conversation that has not started an application is the normal case
    // rather than an exception the schema has to tolerate.
    const none = await pool.query(
      "SELECT case_id FROM conversations WHERE id = $1",
      [OTHER_CONVERSATION],
    );
    expect(none.rows[0]).toEqual({ case_id: null });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// B. The Run Driver
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the Run Driver coordinates, and the orchestrator decides", () => {
  const conversation = "01JBXQ8Z9WKTQ6M4H2NPC00020";

  it("starts a run, and the ORCHESTRATOR chose the step", async () => {
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      conversation,
      studentId_,
    ]);
    const { driver, pool: instancePool } = buildInstance(connectionString());
    try {
      const outcome = await driver.start({
        conversationId: conversation,
        blueprintId: BLUEPRINT,
        studentStatement: STATEMENT,
      });
      if (!outcome.ok) expect.unreachable(`start refused: ${outcome.refusal.kind}`);

      // `interview` is not a word this service chose. `nextStep` reached it by
      // finding the fill plan blocked on an empty profile — the assertion is
      // therefore that the orchestrator ran, not merely that a field was set.
      expect(outcome.position.step).toBe("interview");
      expect(outcome.position.phase).toBe("interviewing");
      expect(outcome.position.status).toBe("running");
      expect(outcome.position.resumed).toBe(false);
      expect(outcome.position.caseId).toBe(`case_${conversation.toLowerCase()}`);
    } finally {
      await instancePool.end();
    }
  });

  it("writes the case's first event, with the student's own sentence", async () => {
    // `openCase` refuses to build without request evidence. This is where
    // "the student asked" stops being an assumption.
    const events = await pool.query<{ event: { type: string; requestEvidence?: { studentStatement?: string } } }>(
      `SELECT event FROM case_events WHERE case_id = $1 ORDER BY "sequence"`,
      [`case_${conversation.toLowerCase()}`],
    );
    expect(events.rows.map((row) => row.event.type)).toEqual(["CaseOpened"]);
    expect(events.rows[0]?.event.requestEvidence?.studentStatement).toBe(STATEMENT);
  });

  it("checkpoints the decision durably", async () => {
    const runs = await pool.query<{ run_id: string; checkpoint: { phase: string }; revision: number }>(
      "SELECT run_id, checkpoint, revision FROM workflow_runs WHERE case_id = $1",
      [`case_${conversation.toLowerCase()}`],
    );
    expect(runs.rowCount).toBe(1);
    expect(runs.rows[0]?.checkpoint.phase).toBe("interviewing");
    // Advanced past its start, so the checkpoint was actually written rather
    // than merely created with the run.
    expect(runs.rows[0]?.revision).toBeGreaterThan(0);
  });

  it("RESUMES rather than restarting, and creates no second run", async () => {
    const { driver, pool: instancePool } = buildInstance(connectionString());
    try {
      const again = await driver.start({
        conversationId: conversation,
        blueprintId: BLUEPRINT,
        studentStatement: "Any second thoughts are still the same request.",
      });
      if (!again.ok) expect.unreachable(`resume refused: ${again.refusal.kind}`);
      expect(again.position.resumed).toBe(true);

      const runs = await pool.query("SELECT run_id FROM workflow_runs WHERE case_id = $1", [
        `case_${conversation.toLowerCase()}`,
      ]);
      expect(runs.rowCount, "a second run would give one case two positions").toBe(1);

      // And the case log did not gain a second CaseOpened.
      const events = await pool.query(`SELECT 1 FROM case_events WHERE case_id = $1`, [
        `case_${conversation.toLowerCase()}`,
      ]);
      expect(events.rowCount).toBe(1);
    } finally {
      await instancePool.end();
    }
  });

  it("refuses a blueprint the catalogue does not have", async () => {
    const { driver, pool: instancePool } = buildInstance(connectionString());
    try {
      const outcome = await driver.start({
        conversationId: OTHER_CONVERSATION,
        blueprintId: "bp-not-reviewed",
        studentStatement: STATEMENT,
      });
      expect(outcome).toEqual({ ok: false, refusal: { kind: "unknown_blueprint" } });
      // Nothing was bound: a refused start must not leave a case behind.
      const bound = await pool.query("SELECT case_id FROM conversations WHERE id = $1", [
        OTHER_CONVERSATION,
      ]);
      expect(bound.rows[0]).toEqual({ case_id: null });
    } finally {
      await instancePool.end();
    }
  });

  it("refuses to advance a run that belongs to another conversation", async () => {
    const { driver, pool: instancePool } = buildInstance(connectionString());
    try {
      const runs = await pool.query<{ run_id: string }>(
        "SELECT run_id FROM workflow_runs WHERE case_id = $1",
        [`case_${conversation.toLowerCase()}`],
      );
      const runId = runs.rows[0]!.run_id;
      const outcome = await driver.advance({ runId, conversationId: OTHER_CONVERSATION });
      expect(outcome).toEqual({ ok: false, refusal: { kind: "unknown_conversation" } });
    } finally {
      await instancePool.end();
    }
  });

  it("does not create two cases when two starts race", async () => {
    // `bind` takes a row lock. Without it both callers read case_id = NULL and
    // both insert, and one gets a unique violation the student sees as a 500.
    const racing = "01JBXQ8Z9WKTQ6M4H2NPC00021";
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      racing,
      studentId_,
    ]);
    const a = buildInstance(connectionString());
    const b = buildInstance(connectionString());
    try {
      const [first, second] = await Promise.all([
        a.driver.start({ conversationId: racing, blueprintId: BLUEPRINT, studentStatement: STATEMENT }),
        b.driver.start({ conversationId: racing, blueprintId: BLUEPRINT, studentStatement: STATEMENT }),
      ]);
      expect(first.ok && second.ok, "both starts should succeed").toBe(true);
      const cases = await pool.query("SELECT 1 FROM cases WHERE case_id = $1", [
        `case_${racing.toLowerCase()}`,
      ]);
      expect(cases.rowCount).toBe(1);
      const runs = await pool.query("SELECT 1 FROM workflow_runs WHERE case_id = $1", [
        `case_${racing.toLowerCase()}`,
      ]);
      expect(runs.rowCount, "one conversation, one case, one live run").toBe(1);
    } finally {
      await a.pool.end();
      await b.pool.end();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// C. The route
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("POST /v1/conversations/{id}/runs", () => {
  async function startRun(
    conversationId: string,
    subject: string,
    body: Record<string, unknown> = { blueprintId: BLUEPRINT, studentStatement: STATEMENT },
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${BASE}/v1/conversations/${conversationId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieFor(subject) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  it("starts a run for the authenticated student, in the published shape", async () => {
    const { status, body } = await startRun(CONVERSATION, studentId_);
    expect(status).toBe(201);

    // Parsed by the CONTRACT's own parser, not by an ad-hoc cast. A response
    // that drifted from `conversation.v1.yaml` fails here.
    const run = parseConversationRun(body);
    if (run === null) expect.unreachable(`the response is not a ConversationRun: ${JSON.stringify(body)}`);
    expect(run.conversationId).toBe(CONVERSATION);
    expect(run.step).toBe("interview");
    expect(run.resumed).toBe(false);

    // And it is durable, not merely returned.
    const bound = await pool.query<{ case_id: string | null }>(
      "SELECT case_id FROM conversations WHERE id = $1",
      [CONVERSATION],
    );
    expect(bound.rows[0]?.case_id).toBe(run.caseId);
    const runs = await pool.query("SELECT run_id FROM workflow_runs WHERE run_id = $1", [run.runId]);
    expect(runs.rowCount).toBe(1);
  });

  it("answers 200 and resumed:true on a retry, without a second run", async () => {
    const { status, body } = await startRun(CONVERSATION, studentId_);
    expect(status).toBe(200);
    expect(parseConversationRun(body)?.resumed).toBe(true);
    const runs = await pool.query("SELECT 1 FROM workflow_runs WHERE case_id = (SELECT case_id FROM conversations WHERE id = $1)", [CONVERSATION]);
    expect(runs.rowCount).toBe(1);
  });

  it("REFUSES another student's conversation, with 404 rather than 403", async () => {
    // A 403 confirms the conversation exists, which is a fact about another
    // student. The same rule every other route on this service follows.
    const { status, body } = await startRun(CONVERSATION, otherStudentId);
    expect(status).toBe(404);
    expect(body).toMatchObject({ code: "not_found" });

    // And nothing was started for them.
    const theirs = await pool.query("SELECT case_id FROM conversations WHERE id = $1", [
      OTHER_CONVERSATION,
    ]);
    expect(theirs.rows[0]).toEqual({ case_id: null });
  });

  it("REFUSES an unauthenticated caller", async () => {
    const response = await fetch(`${BASE}/v1/conversations/${CONVERSATION}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blueprintId: BLUEPRINT, studentStatement: STATEMENT }),
    });
    expect(response.status).toBe(401);
  });

  it("REFUSES a start with no student statement", async () => {
    // A case cannot be opened without request evidence: explicit request before
    // consequential action, and silence is not consent.
    const { status, body } = await startRun(CONVERSATION, studentId_, {
      blueprintId: BLUEPRINT,
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ code: "validation_failed", pointers: ["/studentStatement"] });
  });

  it("REFUSES a start with no blueprint", async () => {
    const { status, body } = await startRun(CONVERSATION, studentId_, {
      studentStatement: STATEMENT,
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ code: "validation_failed", pointers: ["/blueprintId"] });
  });

  it("carries no free text at all in the response", async () => {
    // The type-level assertion in @askimate/aas-contracts says this, and this
    // is the same claim made against a real body: a `say`, a `detail` or a
    // preview added later shows up here.
    const { body } = await startRun(CONVERSATION, studentId_);
    expect(Object.keys(body as object).sort()).toEqual([
      "caseId",
      "conversationId",
      "phase",
      "resumed",
      "revision",
      "runId",
      "status",
      "step",
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// D. The restart
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("a run survives the process that started it", () => {
  const conversation = "01JBXQ8Z9WKTQ6M4H2NPC00040";

  it("resumes the SAME case and the SAME run, from a wholly new instance", async () => {
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      conversation,
      studentId_,
    ]);

    // ── Instance one ────────────────────────────────────────────────────
    const first = buildInstance(connectionString());
    const firstServer = await new Promise<Server>((resolve) => {
      const listening = first.app.listen(PORT + 1, "127.0.0.1", () => resolve(listening));
    });
    const started = await fetch(`http://127.0.0.1:${String(PORT + 1)}/v1/conversations/${conversation}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieFor(studentId_) },
      body: JSON.stringify({ blueprintId: BLUEPRINT, studentStatement: STATEMENT }),
    });
    expect(started.status).toBe(201);
    const before = parseConversationRun(await started.json());
    if (before === null) expect.unreachable("the first instance should have started a run");

    // ── The interruption ────────────────────────────────────────────────
    //
    // The server is closed and the pool is ENDED. Nothing from the first
    // instance survives into the second except what is in PostgreSQL — which is
    // the whole claim being tested.
    await new Promise<void>((resolve) => firstServer.close(() => resolve()));
    await first.pool.end();

    // ── Instance two, built from a connection string ─────────────────────
    const second = buildInstance(connectionString());
    try {
      const resumed = await second.driver.advance({
        runId: before.runId,
        conversationId: conversation,
      });
      if (!resumed.ok) expect.unreachable(`resume refused: ${resumed.refusal.kind}`);

      expect(resumed.position.runId, "the same run").toBe(before.runId);
      expect(resumed.position.caseId, "the same case").toBe(before.caseId);
      expect(resumed.position.conversationId, "still bound to the conversation").toBe(conversation);
      expect(resumed.position.resumed).toBe(true);

      // ── The run did NOT restart from zero ─────────────────────────────
      //
      // `beginCheckpoint` starts a run at `preparing_inputs`. A run that had
      // been recreated would report that. This one reports where the
      // orchestrator had already put it.
      expect(resumed.position.phase).not.toBe("preparing_inputs");
      expect(resumed.position.phase).toBe(before.phase);
      expect(resumed.position.step).toBe(before.step);

      // The revision moved forward rather than resetting: the durable
      // checkpoint has a history, not a fresh start.
      expect(resumed.position.revision).toBeGreaterThan(before.revision);

      // One case, one run, one CaseOpened. A restart that re-opened the case
      // would show a second event or a second run here.
      const cases = await pool.query("SELECT 1 FROM cases WHERE case_id = $1", [before.caseId]);
      expect(cases.rowCount).toBe(1);
      const runs = await pool.query("SELECT 1 FROM workflow_runs WHERE case_id = $1", [before.caseId]);
      expect(runs.rowCount).toBe(1);
      const events = await pool.query(`SELECT 1 FROM case_events WHERE case_id = $1`, [before.caseId]);
      expect(events.rowCount).toBe(1);
    } finally {
      await second.pool.end();
    }
  }, 120_000);

  it("keeps the business fact the log holds, not the checkpoint", async () => {
    // Rule 3 of the approved architecture: dropping every checkpoint must lose
    // no business fact. Proved here against the real database — the case's
    // request evidence is still there after the position is thrown away.
    const bound = await pool.query<{ case_id: string }>(
      "SELECT case_id FROM conversations WHERE id = $1",
      [conversation],
    );
    const caseRef = makeCaseId(bound.rows[0]!.case_id);
    const runs = await pool.query<{ run_id: string }>(
      "SELECT run_id FROM workflow_runs WHERE case_id = $1",
      [caseRef],
    );

    const instance = buildInstance(connectionString());
    try {
      const store = new PostgresWorkflowRunStore(instance.pool);
      await store.discardCheckpoints(makeRunId(runs.rows[0]!.run_id));

      const cases = new PostgresCaseStore(instance.pool);
      const events = await cases.read(caseRef);
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("CaseOpened");

      // And the run re-derives a position rather than losing the case.
      const again = await instance.driver.advance({
        runId: runs.rows[0]!.run_id,
        conversationId: conversation,
      });
      if (!again.ok) expect.unreachable("a discarded checkpoint must not lose the run");
      expect(again.position.caseId).toBe(caseRef);
    } finally {
      await instance.pool.end();
    }
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// E. The confirmed profile survives too — ADR-0044
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the confirmed profile is reconstructed from its own store", () => {
  const conversation = "01JBXQ8Z9WKTQ6M4H2NPC00050";

  it("moves a run OFF interviewing once every answer is stored", async () => {
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      conversation,
      studentId_,
    ]);

    // ── Instance one: start the run, and answer the interview ───────────
    const first = buildInstance(connectionString(), opener());
    let before: string;
    try {
      const started = await first.driver.start({
        conversationId: conversation,
        blueprintId: GATED_BLUEPRINT,
        studentStatement: STATEMENT,
      });
      if (!started.ok) expect.unreachable(`start refused: ${started.refusal.kind}`);
      // Nothing is confirmed yet, so the orchestrator wants the interview.
      expect(started.position.phase).toBe("interviewing");
      before = started.position.runId;

      await confirmTheInterview(new PostgresConfirmedProfileStore(first.pool));
    } finally {
      await first.pool.end();
    }

    // ── Instance two: nothing carried over but the database ─────────────
    const second = buildInstance(connectionString(), opener());
    try {
      const resumed = await second.driver.advance({ runId: before, conversationId: conversation });
      if (!resumed.ok) expect.unreachable(`resume refused: ${resumed.refusal.kind}`);

      // THE assertion. Before ADR-0044 the driver called `emptyProfile` on
      // every request, so this run could never leave `interviewing` — each
      // call re-derived a profile with nothing in it and `planFill` reported
      // the same blockers as the call before.
      expect(
        resumed.position.phase,
        "a resumed run with a complete profile must move past the interview",
      ).not.toBe("interviewing");
      expect(resumed.position.runId).toBe(before);

      // The gated portal needs an account, so this is where it goes next.
      expect(resumed.position.phase).toBe("awaiting_secret");
      expect(resumed.position.step).toBe("request_secret");
    } finally {
      await second.pool.end();
    }
  }, 120_000);

  it("keeps the value AND its provenance across the restart", async () => {
    const instance = buildInstance(connectionString());
    try {
      const store = new PostgresConfirmedProfileStore(instance.pool);
      const profile = await store.load(studentId_, NOW);

      const name = resolveField(profile, "identity.given_name");
      expect(unwrapConfirmed(name as never)).toBe("Niloofar");
      // The half a careless store loses. Without it the value is one nobody
      // confirmed, which is what ADR-0004 exists to prevent.
      expect(provenanceOf(name as never).source).toBe("student_stated");

      // And a Date is still a Date, not the string a plain JSON round-trip
      // would have left — the minor-detection safeguard calls `.getTime()`.
      const dob = unwrapConfirmed(resolveField(profile, "identity.date_of_birth") as never);
      expect(dob).toBeInstanceOf(Date);
    } finally {
      await instance.pool.end();
    }
  }, 60_000);

  it("does not hand one student another student's profile", async () => {
    const instance = buildInstance(connectionString());
    try {
      const store = new PostgresConfirmedProfileStore(instance.pool);
      const theirs = await store.load(otherStudentId, NOW);
      expect(theirs.entries.size).toBe(0);
      expect(resolveField(theirs, "identity.given_name")).toMatchObject({
        kind: "field_unavailable",
      });
    } finally {
      await instance.pool.end();
    }
  }, 60_000);

  it("survives the checkpoint being thrown away", async () => {
    // Rule 3 of the approved architecture: discarding every checkpoint must
    // lose no business fact. A confirmed profile IS a business fact, so it is
    // not a checkpoint and is never discarded with one.
    const instance = buildInstance(connectionString());
    try {
      const runs = await pool.query<{ run_id: string }>(
        "SELECT run_id FROM workflow_runs WHERE case_id = (SELECT case_id FROM conversations WHERE id = $1)",
        [conversation],
      );
      const runs_ = new PostgresWorkflowRunStore(instance.pool);
      await runs_.discardCheckpoints(makeRunId(runs.rows[0]!.run_id));

      const store = new PostgresConfirmedProfileStore(instance.pool);
      const profile = await store.load(studentId_, NOW);
      expect(profile.entries.size).toBe(6);
    } finally {
      await instance.pool.end();
    }
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// F. P4 — the Conversation Service opens the secure step
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("opening a secure step, and recording it authoritatively", () => {
  const conversation = "01JBXQ8Z9WKTQ6M4H2NPC00060";

  /** Drives a run to the point where it wants a password. */
  async function toTheSecureStep(
    secure: SecureRequestOpener,
  ): Promise<{ runId: string }> {
    const instance = buildInstance(connectionString(), secure);
    try {
      const started = await instance.driver.start({
        conversationId: conversation,
        blueprintId: GATED_BLUEPRINT,
        studentStatement: STATEMENT,
      });
      if (!started.ok) expect.unreachable(`start refused: ${started.refusal.kind}`);
      return { runId: started.position.runId };
    } finally {
      await instance.pool.end();
    }
  }

  it("asks the Secure Plane, and appends the authoritative event", async () => {
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      conversation,
      studentId_,
    ]);
    // The profile the gated run needs, stored the way the interview stores it.
    const seeding = buildInstance(connectionString());
    try {
      await confirmTheInterview(new PostgresConfirmedProfileStore(seeding.pool));
    } finally {
      await seeding.pool.end();
    }

    const secure = opener();
    await toTheSecureStep(secure);

    // ── What crossed to the Secure Plane ───────────────────────────────
    expect(secure.opens).toHaveLength(1);
    const asked = secure.opens[0];
    if (asked === undefined) expect.unreachable("a request should have been opened");
    expect(asked.conversationId).toBe(conversation);
    expect(asked.studentRef).toBe(studentId_);
    // From the case and the blueprint, never from model output.
    expect(asked.purpose).toBe("portal_account_creation");
    expect(asked.targetHost).toBe("gated.portal.test");
    expect(asked.ttlSeconds).toBeLessThanOrEqual(300);

    // ── What the conversation log now holds ────────────────────────────
    const events = await pool.query<{ kind: string; request_id: string | null }>(
      `SELECT kind, request_id FROM conversation_events WHERE conversation_id = $1 ORDER BY ordinal`,
      [conversation],
    );
    expect(events.rows.map((row) => row.kind)).toEqual(["secret_requested"]);
    // The id in the log is the one the Secure Plane minted, not one this plane
    // invented: a request the secure service has never heard of would settle
    // nothing, and the composer would stay locked forever.
    expect(events.rows[0]?.request_id).toBe(`sr_${"0".repeat(31)}1`);
  }, 120_000);

  it("mints the frame capability through the SAME port that opened the request", async () => {
    // The endpoint has existed since the cross-origin phase with no production
    // wiring behind it. This is that wiring, exercised over real HTTP: the page
    // asks its own origin, its own origin asks the secure plane, and the
    // capability comes back in a body rather than in a URL.
    const secure = opener();
    const instance = buildInstance(connectionString(), secure);
    const port = PORT + 3;
    const listening = await new Promise<Server>((resolve) => {
      const s_ = instance.app.listen(port, "127.0.0.1", () => resolve(s_));
    });
    try {
      const requestId = `sr_${"0".repeat(31)}1`;
      const response = await fetch(
        `http://127.0.0.1:${String(port)}/v1/conversations/${conversation}/secure-requests/${requestId}/bootstrap`,
        { headers: { cookie: cookieFor(studentId_) } },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;

      // It came from the opener, not from anywhere in this plane.
      expect(secure.tokens).toEqual([requestId]);
      expect(body["frameToken"]).toBe(`ft_fresh_${requestId}`);
      expect(body["secureOrigin"]).toBe("https://secure.test");

      // A capability in a cache outlives the page that asked for it.
      expect(response.headers.get("cache-control")).toBe("no-store");

      // And nothing resembling a secret came back with it.
      expect(Object.keys(body).sort()).toEqual([
        "expiresAt",
        "frameToken",
        "requestId",
        "secureOrigin",
      ]);
    } finally {
      await new Promise<void>((resolve) => listening.close(() => resolve()));
      await instance.pool.end();
    }
  }, 120_000);

  it("refuses a bootstrap for a request that is NOT open in this conversation", async () => {
    // Without this check a student could ask for a bootstrap into someone
    // else's secure step simply by naming its id.
    const secure = opener();
    const instance = buildInstance(connectionString(), secure);
    const port = PORT + 4;
    const listening = await new Promise<Server>((resolve) => {
      const s_ = instance.app.listen(port, "127.0.0.1", () => resolve(s_));
    });
    try {
      const response = await fetch(
        `http://127.0.0.1:${String(port)}/v1/conversations/${conversation}/secure-requests/sr_${"c".repeat(32)}/bootstrap`,
        { headers: { cookie: cookieFor(studentId_) } },
      );
      expect(response.status).toBe(404);
      // The secure plane was never even asked. The conversation's own log is
      // the authority on which request belongs to it.
      expect(secure.tokens).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => listening.close(() => resolve()));
      await instance.pool.end();
    }
  }, 120_000);

  it("puts NO text about a password in the conversation's durable log", async () => {
    // The contract stores the title and explanation on the secure origin and
    // does not return them, so this plane has nothing to hold. Asserted against
    // the database rather than against the shape of a type.
    const bodies = await pool.query<{ n: string }>(
      `SELECT count(*) AS n
         FROM conversation_events e
         LEFT JOIN message_bodies mb ON mb.id = e.body_id
        WHERE e.conversation_id = $1 AND mb.content IS NOT NULL`,
      [conversation],
    );
    expect(Number(bodies.rows[0]!.n)).toBe(0);

    // And a scan of the rows themselves, not just of the bodies table. The
    // title this plane composed ("Choose a password for …") and the model's
    // explanation both crossed to the secure service; neither may be here.
    const rows = await pool.query<{ row: string }>(
      "SELECT e::text AS row FROM conversation_events e WHERE e.conversation_id = $1",
      [conversation],
    );
    expect(rows.rows).not.toHaveLength(0);
    for (const { row } of rows.rows) {
      expect(row.toLowerCase(), "no text about a password may reach this log").not.toContain(
        "password",
      );
    }
  }, 60_000);

  it("does NOT open a second request while the first is live", async () => {
    // `secretStepFor` refuses to ask twice, and `latestSecretRequest` is how the
    // driver knows. Asking again would replace a box the student may be typing
    // into — the failure the orchestrator's own comment names.
    const secure = opener();
    const instance = buildInstance(connectionString(), secure);
    try {
      const again = await instance.driver.start({
        conversationId: conversation,
        blueprintId: GATED_BLUEPRINT,
        studentStatement: STATEMENT,
      });
      if (!again.ok) expect.unreachable(`resume refused: ${again.refusal.kind}`);
      expect(again.position.step).toBe("request_secret");
      expect(secure.opens, "a live request must not be re-opened").toHaveLength(0);
    } finally {
      await instance.pool.end();
    }

    const events = await pool.query<{ kind: string }>(
      `SELECT kind FROM conversation_events WHERE conversation_id = $1`,
      [conversation],
    );
    expect(events.rows.map((row) => row.kind)).toEqual(["secret_requested"]);
  }, 120_000);

  it("opens ONE request when two starts race for the same conversation", async () => {
    // The checkpoint is the run's optimistic lock, and the secure request is
    // opened after it is won — so the same lock that stops two cases being
    // created stops two password prompts being opened. Without that order both
    // racers read a log with no live request and both ask.
    const racing = "01JBXQ8Z9WKTQ6M4H2NPC00063";
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      racing,
      studentId_,
    ]);
    const shared = opener(150);
    const a = buildInstance(connectionString(), shared);
    const b = buildInstance(connectionString(), shared);
    try {
      const [first, second] = await Promise.all([
        a.driver.start({
          conversationId: racing,
          blueprintId: GATED_BLUEPRINT,
          studentStatement: STATEMENT,
        }),
        b.driver.start({
          conversationId: racing,
          blueprintId: GATED_BLUEPRINT,
          studentStatement: STATEMENT,
        }),
      ]);
      expect(first.ok && second.ok, "both starts should succeed").toBe(true);
      expect(shared.opens, "a student must be asked for a password once").toHaveLength(1);

      const events = await pool.query<{ kind: string }>(
        "SELECT kind FROM conversation_events WHERE conversation_id = $1",
        [racing],
      );
      expect(events.rows.map((row) => row.kind)).toEqual(["secret_requested"]);
    } finally {
      await a.pool.end();
      await b.pool.end();
    }
  }, 120_000);

  it("REFUSES rather than skipping when the plane is unreachable", async () => {
    // A run that carried on past a password it could not ask for would create an
    // account nobody can sign in to.
    const other = "01JBXQ8Z9WKTQ6M4H2NPC00061";
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      other,
      studentId_,
    ]);
    const instance = buildInstance(connectionString(), null);
    try {
      const outcome = await instance.driver.start({
        conversationId: other,
        blueprintId: GATED_BLUEPRINT,
        studentStatement: STATEMENT,
      });
      expect(outcome).toEqual({ ok: false, refusal: { kind: "secure_plane_unavailable" } });
    } finally {
      await instance.pool.end();
    }
  }, 120_000);

  it("REFUSES when the Secure Plane cannot open the request", async () => {
    const refusing: SecureRequestOpener = {
      open: () => Promise.resolve(null),
      mintFrameToken: () => Promise.resolve(null),
    };
    const another = "01JBXQ8Z9WKTQ6M4H2NPC00062";
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      another,
      studentId_,
    ]);
    const instance = buildInstance(connectionString(), refusing);
    try {
      const outcome = await instance.driver.start({
        conversationId: another,
        blueprintId: GATED_BLUEPRINT,
        studentStatement: STATEMENT,
      });
      expect(outcome).toEqual({ ok: false, refusal: { kind: "secure_plane_unavailable" } });
      // And nothing was written to the log for a request that does not exist.
      const events = await pool.query(
        "SELECT 1 FROM conversation_events WHERE conversation_id = $1",
        [another],
      );
      expect(events.rowCount).toBe(0);
    } finally {
      await instance.pool.end();
    }
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// G. P5 — the work the Automation Runner pulls (ADR-0045)
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("leasing browser work to a runner", () => {
  const conversation = "01JBXQ8Z9WKTQ6M4H2NPC00070";
  let runId: string;

  /**
   * Drives a run all the way to `creating_account`.
   *
   * Through the REAL path, not by writing a checkpoint: the interview is
   * answered, the secure step is opened, and the Secure Plane's `secret_received`
   * is appended the way the secure service appends it. A test that forced the
   * phase would prove the claim query works and nothing about whether a run can
   * actually get there.
   */
  async function driveToAccountCreation(): Promise<void> {
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      conversation,
      studentId_,
    ]);
    const secure = opener();
    const instance = buildInstance(connectionString(), secure);
    try {
      await confirmTheInterview(new PostgresConfirmedProfileStore(instance.pool));
      const started = await instance.driver.start({
        conversationId: conversation,
        blueprintId: GATED_BLUEPRINT,
        studentStatement: STATEMENT,
      });
      if (!started.ok) expect.unreachable(`start refused: ${started.refusal.kind}`);
      expect(started.position.step).toBe("request_secret");
      runId = started.position.runId;

      // The student types a password into the secure control. The Secure Plane
      // reports it; this plane learns a handle exists and never more than that.
      const requested = secure.opens[0];
      if (requested === undefined) expect.unreachable("a request should have been opened");
      await new ConversationEventStore(instance.pool).append({
        conversationId: conversation,
        event: {
          kind: "secret_received",
          requestId: `sr_${"0".repeat(31)}1`,
          handle: `sh_${"a".repeat(32)}`,
        },
      });

      const next = await instance.driver.advance({ runId, conversationId: conversation });
      if (!next.ok) expect.unreachable(`advance refused: ${next.refusal.kind}`);
      expect(next.position.step).toBe("create_account");
      expect(next.position.phase).toBe("creating_account");
    } finally {
      await instance.pool.end();
    }
  }

  it("hands a runner exactly the facts it needs, and nothing else", async () => {
    await driveToAccountCreation();

    const instance = buildInstance(connectionString());
    try {
      const work = await instance.driver.claimWork({ holder: "runner-1", leaseSeconds: 120 });
      if (work === null) expect.unreachable("there should be work to claim");

      expect(work.kind).toBe("create_account");
      expect(work.runId).toBe(runId);
      expect(work.studentRef).toBe(studentId_);
      // From the blueprint's observed authentication, not from model output.
      expect(work.portalHost).toBe("gated.portal.test");
      expect(work.email).toBe("niloofar@example.test");
      expect(work.approach).toBe("student_chosen");
      // Opaque, and the only route from it to a password is a vault this app
      // has no dependency on, no KMS grant for and no certificate to reach.
      expect(work.secretHandle).toBe(`sh_${"a".repeat(32)}`);

      // ── What is NOT on the wire ────────────────────────────────────────
      //
      // Scanned rather than type-checked: a type says what a field is declared
      // to be, and this says what actually crossed. The student's confirmed
      // answers are in this plane's database and none of them is here.
      const wire = JSON.stringify(work);
      for (const secret of ["Niloofar", "Hosseini", "Iranian", "Because it is the course"]) {
        expect(wire, `${secret} must not reach the runner`).not.toContain(secret);
      }
      expect(Object.keys(work).sort()).toEqual([
        "approach",
        "caseId",
        "email",
        "expiresAt",
        "kind",
        "leaseId",
        "portalHost",
        "registration",
        "runId",
        "secretHandle",
        "studentRef",
      ]);
      expect(parseClaimedWork(JSON.parse(wire))).toEqual(work);

      // ── The registration targets come from the REVIEWED blueprint ──────
      //
      // Not from a copy in the runner, and not from anything a model wrote.
      // Both password boxes are here, by NAME rather than by label: the
      // blueprint fixture records why — `getByLabel` is non-exact, so
      // "Password" also matches "Confirm password", and on this one field an
      // ambiguous locator is the bug that types a credential into the wrong box.
      const registration = work.registration;
      if (registration === undefined) expect.unreachable("account work carries its targets");
      expect(registration.url).toBe("https://gated.portal.test/register");
      expect(registration.emailLocator).toEqual({
        strategy: "label",
        value: "Email address",
      });
      expect(registration.passwordLocators).toEqual([
        { strategy: "name", value: "password" },
        { strategy: "name", value: "password_confirm" },
      ]);
      expect(registration.submitLocator).toEqual({
        strategy: "role",
        value: "button:Create account",
      });
    } finally {
      await instance.pool.end();
    }
  }, 180_000);

  it("does NOT hand the same run to a second runner", async () => {
    const a = buildInstance(connectionString());
    const b = buildInstance(connectionString());
    try {
      // The first claim is still live from the test above — the lease outlives
      // the process that took it, which is the point of storing it.
      const second = await b.driver.claimWork({ holder: "runner-2", leaseSeconds: 120 });
      expect(second, "a leased run is not claimable").toBeNull();
      void a;
    } finally {
      await a.pool.end();
      await b.pool.end();
    }
  }, 60_000);

  it("hands it to somebody else once the lease has LAPSED", async () => {
    // Not by sleeping. The lease's expiry is a timestamp in a row, so the test
    // ages the row rather than waiting on the clock — a test that waited two
    // minutes for a two-minute lease would be a test nobody runs.
    //
    // BOTH timestamps move, because `expires_at > claimed_at` is a CHECK: a
    // lease cannot be written already spent, and the first attempt at this test
    // moved only the expiry and was refused by the database. That refusal is
    // the constraint working, so the test was changed rather than the schema.
    await pool.query(
      "UPDATE work_leases SET claimed_at = $1, expires_at = $2 WHERE run_id = $3",
      [new Date(NOW.getTime() - 600_000), new Date(NOW.getTime() - 1000), runId],
    );
    const instance = buildInstance(connectionString());
    try {
      const work = await instance.driver.claimWork({ holder: "runner-3", leaseSeconds: 120 });
      if (work === null) expect.unreachable("a lapsed lease must return the run to the pool");
      expect(work.runId).toBe(runId);

      const leases = await pool.query<{ holder: string; lease_id: string }>(
        "SELECT holder, lease_id FROM work_leases WHERE run_id = $1",
        [runId],
      );
      expect(leases.rows).toHaveLength(1);
      expect(leases.rows[0]?.holder).toBe("runner-3");
      // A NEW lease id, so the runner that was superseded cannot close out work
      // the new holder is in the middle of.
      expect(leases.rows[0]?.lease_id).toBe(work.leaseId);
    } finally {
      await instance.pool.end();
    }
  }, 60_000);

  it("REFUSES a report from a runner that no longer holds the lease", async () => {
    const instance = buildInstance(connectionString());
    try {
      const accepted = await instance.driver.reportWork({
        runId,
        report: { leaseId: "wl_someone_elses_lease", outcome: "succeeded" },
      });
      expect(accepted, "only the holder may report").toBe(false);

      // And nothing was written about an action nobody is holding.
      const intents = await pool.query("SELECT 1 FROM workflow_action_intents WHERE run_id = $1", [
        runId,
      ]);
      expect(intents.rowCount).toBe(0);
    } finally {
      await instance.pool.end();
    }
  }, 60_000);

  it("records the outcome as evidence, and gives the lease back", async () => {
    const held = await pool.query<{ lease_id: string }>(
      "SELECT lease_id FROM work_leases WHERE run_id = $1",
      [runId],
    );
    const leaseId = held.rows[0]?.lease_id;
    if (leaseId === undefined) expect.unreachable("the run should still be leased");

    const instance = buildInstance(connectionString());
    try {
      expect(await instance.driver.reportWork({ runId, report: { leaseId, outcome: "succeeded" } }))
        .toBe(true);

      const intents = await pool.query<{ action: string; outcome: string | null }>(
        "SELECT action, outcome FROM workflow_action_intents WHERE run_id = $1",
        [runId],
      );
      expect(intents.rows).toHaveLength(1);
      // The domain's word for it, not the wire's — creating a real account on a
      // real university portal is `create_portal_account` everywhere else.
      expect(intents.rows[0]?.action).toBe("create_portal_account");
      expect(intents.rows[0]?.outcome).toBe("succeeded");

      const leases = await pool.query("SELECT 1 FROM work_leases WHERE run_id = $1", [runId]);
      expect(leases.rowCount, "a reported lease is given back").toBe(0);
    } finally {
      await instance.pool.end();
    }
  }, 60_000);

  it("does NOT ask for the account to be created a second time", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The loop this closes: `state.account` lives in memory, this process holds
    // none between requests, and `accountStepFor` answers `create_account`
    // whenever it is absent. Without the intent ledger being read, a run whose
    // account was created a second ago is told to create it again — on a real
    // university portal, for a student who already has one.
    // ═══════════════════════════════════════════════════════════════════
    const instance = buildInstance(connectionString(), opener());
    try {
      const advanced = await instance.driver.advance({ runId, conversationId: conversation });
      if (!advanced.ok) expect.unreachable(`advance refused: ${advanced.refusal.kind}`);
      expect(advanced.position.step, "the account exists; do not make another").not.toBe(
        "create_account",
      );
      expect(advanced.position.phase).not.toBe("creating_account");

      // And there is no work to claim, because there is nothing left to do in a
      // browser — which is the same fact, read through the other door.
      await pool.query("DELETE FROM work_leases");
      expect(await instance.driver.claimWork({ holder: "runner-again", leaseSeconds: 120 })).toBeNull();
    } finally {
      await instance.pool.end();
    }
  }, 180_000);

  it("does NOT offer work again for an action that may already have happened", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Written after five P7 regressions went undetected, because the journey
    // only ever walks the happy path.
    //
    // `assessIntent` has NO branch that returns "retry it", and that absence is
    // the safety property. An intent with a `started_at` and no completion means
    // an account may exist on a real portal; offering the work again would
    // create a second one for a student who already has one. The verdict is
    // `verify_first` — look before acting — and nothing here can look yet, so
    // the run stops, visibly, for a specialist.
    // ═══════════════════════════════════════════════════════════════════
    await pool.query("DELETE FROM work_leases");
    await pool.query("DELETE FROM workflow_action_intents WHERE run_id = $1", [runId]);
    await pool.query(
      `INSERT INTO workflow_action_intents (run_id, idempotency_key, action, target, started_at)
            VALUES ($1, $2, 'create_portal_account', $1, $3)`,
      [runId, `${runId}:create_portal_account:${runId}`, NOW],
    );
    await pool.query(
      "UPDATE workflow_runs SET checkpoint = jsonb_set(checkpoint, '{phase}', '\"creating_account\"') WHERE run_id = $1",
      [runId],
    );

    const instance = buildInstance(connectionString(), opener());
    try {
      expect(
        await instance.driver.claimWork({ holder: "runner-unfinished", leaseSeconds: 120 }),
        "an unfinished consequential action is not work",
      ).toBeNull();
      const leases = await pool.query("SELECT 1 FROM work_leases");
      expect(leases.rowCount, "and no lease is taken on the way to refusing").toBe(0);

      // The run has not silently acquired an account either — nothing here
      // knows whether one exists, and pretending otherwise is the other half of
      // the same mistake.
      const advanced = await instance.driver.advance({ runId, conversationId: conversation });
      if (!advanced.ok) expect.unreachable(`advance refused: ${advanced.refusal.kind}`);
      expect(advanced.position.step).toBe("create_account");
    } finally {
      await instance.pool.end();
    }
  }, 180_000);

  it("does NOT treat a cleanly FAILED creation as an account", async () => {
    // `failed_cleanly` is a claim that nothing happened out there. The run may
    // try again — but it must not carry on as though an account existed, which
    // would send it to fill a form it cannot reach.
    await pool.query("DELETE FROM work_leases");
    await pool.query(
      "UPDATE workflow_action_intents SET outcome = 'failed_cleanly', completed_at = $2 WHERE run_id = $1",
      [runId, NOW],
    );

    const instance = buildInstance(connectionString(), opener());
    try {
      const advanced = await instance.driver.advance({ runId, conversationId: conversation });
      if (!advanced.ok) expect.unreachable(`advance refused: ${advanced.refusal.kind}`);
      expect(advanced.position.step, "a failed creation is not an account").toBe("create_account");
    } finally {
      await instance.pool.end();
    }
    await pool.query("DELETE FROM workflow_action_intents WHERE run_id = $1", [runId]);
  }, 180_000);

  it("leaves the uncertainty window OPEN when the runner could not tell", async () => {
    // The property `workflow_action_intents` exists for. An intent with a
    // `started_at` and no completion is the recoverable record of "somebody
    // acted and nobody knows what happened"; collapsing it into `failed_cleanly`
    // would assert that nothing happened out there, which is a claim about a
    // university's database that this system is not entitled to make.
    const other = "01JBXQ8Z9WKTQ6M4H2NPC00071";
    await pool.query("DELETE FROM workflow_action_intents WHERE run_id = $1", [runId]);
    await pool.query("UPDATE workflow_runs SET checkpoint = jsonb_set(checkpoint, '{phase}', '\"creating_account\"') WHERE run_id = $1", [runId]);
    void other;

    const instance = buildInstance(connectionString());
    try {
      const work = await instance.driver.claimWork({ holder: "runner-4", leaseSeconds: 120 });
      if (work === null) expect.unreachable("the run should be claimable again");

      expect(
        await instance.driver.reportWork({
          runId,
          report: { leaseId: work.leaseId, outcome: "uncertain", failure: "runner_fault" },
        }),
      ).toBe(true);

      const intents = await pool.query<{ outcome: string | null; completed_at: Date | null }>(
        "SELECT outcome, completed_at FROM workflow_action_intents WHERE run_id = $1",
        [runId],
      );
      expect(intents.rows).toHaveLength(1);
      expect(intents.rows[0]?.outcome, "uncertain completes nothing").toBeNull();
      expect(intents.rows[0]?.completed_at).toBeNull();

      // And the lease is still given back — the runner is gone either way.
      const leases = await pool.query("SELECT 1 FROM work_leases WHERE run_id = $1", [runId]);
      expect(leases.rowCount).toBe(0);
    } finally {
      await instance.pool.end();
    }
    // Cleaned up deliberately: this test LEAVES an unfinished consequential
    // action, and a run in that state is correctly never offered as work again.
    // Later tests in this file want claimable work, so the state that makes
    // them meaningful is restored here rather than assumed.
    await pool.query("DELETE FROM workflow_action_intents WHERE run_id = $1", [runId]);
  }, 60_000);

  it("refuses a SECOND claim on a live lease, in the store itself", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Written after a deliberate regression was NOT detected. Removing the
    // `expires_at <= $now` predicate from the upsert changed nothing that any
    // test could see, because the candidate query already filters leased runs
    // out and no test reached the store's own guarantee.
    //
    // That filter is an optimisation — it stops a busy pool walking the same
    // held runs on every poll. The GUARANTEE is here, and it is the one that
    // holds when two claimers pass the filter at the same instant, which is
    // precisely when it matters.
    // ═══════════════════════════════════════════════════════════════════
    await pool.query("DELETE FROM work_leases");
    const instance = buildInstance(connectionString());
    try {
      const store = new WorkLeaseStore(instance.pool);
      const first = await store.claim({
        runId,
        leaseId: "wl_first",
        kind: "create_account",
        holder: "runner-a",
        now: NOW,
        leaseSeconds: 120,
      });
      expect(first).not.toBeNull();

      const second = await store.claim({
        runId,
        leaseId: "wl_second",
        kind: "create_account",
        holder: "runner-b",
        now: NOW,
        leaseSeconds: 120,
      });
      expect(second, "a live lease is not takeable").toBeNull();

      const rows = await pool.query<{ lease_id: string; holder: string }>(
        "SELECT lease_id, holder FROM work_leases WHERE run_id = $1",
        [runId],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.lease_id, "the first holder keeps it").toBe("wl_first");
      expect(rows.rows[0]?.holder).toBe("runner-a");
      await pool.query("DELETE FROM work_leases");
    } finally {
      await instance.pool.end();
    }
  }, 60_000);

  it("offers nothing when the CHECKPOINT says browser work but the orchestrator does not", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Also written after a regression was not detected. Every earlier test
    // reached "no work" through the candidate query, so nothing proved that the
    // ORCHESTRATOR is the authority — a claim path that trusted the phase would
    // have passed all of them.
    //
    // A checkpoint is a cache of position and the log wins every disagreement
    // (rule 3, and `resumeRun`'s whole purpose). So a stale one saying
    // `creating_account` about a run whose interview is unfinished is not a
    // contrived state: it is the state the reconciliation exists for.
    // ═══════════════════════════════════════════════════════════════════
    const stale = "01JBXQ8Z9WKTQ6M4H2NPC00072";
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      stale,
      otherStudentId,
    ]);
    await pool.query("DELETE FROM work_leases");
    // The run from the tests above is still sitting in `creating_account` and
    // is genuinely claimable. Moved out of the way, so that "no work" below
    // means "no work for the stale run" rather than "the poll found the other
    // one first" — which is what the first version of this test measured.
    await pool.query(
      "UPDATE workflow_runs SET checkpoint = jsonb_set(checkpoint, '{phase}', '\"ready_to_submit\"') WHERE run_id = $1",
      [runId],
    );

    const secure = opener();
    const instance = buildInstance(connectionString(), secure);
    try {
      // This student has confirmed nothing, so `nextStep` says `interview`.
      const started = await instance.driver.start({
        conversationId: stale,
        blueprintId: GATED_BLUEPRINT,
        studentStatement: STATEMENT,
      });
      if (!started.ok) expect.unreachable(`start refused: ${started.refusal.kind}`);
      expect(started.position.step).toBe("interview");

      // The checkpoint is made to lie. Nothing else changes.
      await pool.query(
        "UPDATE workflow_runs SET checkpoint = jsonb_set(checkpoint, '{phase}', '\"creating_account\"') WHERE run_id = $1",
        [started.position.runId],
      );

      const work = await instance.driver.claimWork({ holder: "runner-stale", leaseSeconds: 120 });
      expect(work, "the orchestrator decides, not the checkpoint").toBeNull();
      const leases = await pool.query("SELECT 1 FROM work_leases");
      expect(leases.rowCount, "and no lease is taken on the way to finding out").toBe(0);
    } finally {
      await instance.pool.end();
    }
  }, 180_000);

  it("points a reviewed blueprint at the DEPLOYMENT's origin, keeping its paths", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The same reviewed blueprint runs against a university's sandbox before it
    // ever runs against production. Rewriting the blueprint to point at the
    // sandbox would mean running a blueprint nobody reviewed — so the ORIGIN is
    // a deployment fact and the PATHS stay in the reviewed artefact.
    //
    // And it moves EVERY use of the portal's location together. Moving only the
    // form would bind the handle to the blueprint's host and type into the
    // sandbox, which the fill agent refuses as `host_mismatch` — correctly, and
    // a long way from the configuration that caused it.
    // ═══════════════════════════════════════════════════════════════════
    await pool.query("DELETE FROM work_leases");
    await pool.query("DELETE FROM workflow_action_intents WHERE run_id = $1", [runId]);
    await pool.query(
      "UPDATE workflow_runs SET checkpoint = jsonb_set(checkpoint, '{phase}', '\"creating_account\"') WHERE run_id = $1",
      [runId],
    );
    const sandbox: ApplicationCatalogue = {
      find: (id) =>
        Promise.resolve(
          id === GATED_BLUEPRINT ? { ...GATED_ENTRY, portalOrigin: "http://127.0.0.1:45999" } : null,
        ),
    };
    const instance = buildInstance(connectionString(), null, sandbox);
    try {
      const work = await instance.driver.claimWork({ holder: "runner-sandbox", leaseSeconds: 120 });
      if (work === null) expect.unreachable("a sandboxed blueprint is still claimable work");
      expect(work.registration?.url).toBe("http://127.0.0.1:45999/register");
      expect(work.portalHost, "the bound host moves with the form").toBe("127.0.0.1:45999");
      // The reviewed locators are untouched. Only the origin moved.
      expect(work.registration?.passwordLocators).toEqual([
        { strategy: "name", value: "password" },
        { strategy: "name", value: "password_confirm" },
      ]);
    } finally {
      await instance.pool.end();
    }
    await pool.query("DELETE FROM work_leases");
  }, 180_000);

  it("REFUSES a blueprint whose form is on a different host from its sign-in", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Written after a deliberate regression was NOT detected. Dropping the
    // "the form must be on the bound host" check broke nothing any test could
    // see, because every blueprint in the suite has both on one host.
    //
    // `portalHost` is what the secure request binds the handle to and what the
    // fill agent checks the live page against. A registration page somewhere
    // else means a run that would open a browser at host A holding a handle
    // bound to host B — refused by the agent, correctly, and a long way from
    // the blueprint that caused it. It is a portal fact a specialist should
    // have looked at, so the run stops here instead.
    // ═══════════════════════════════════════════════════════════════════
    await pool.query("DELETE FROM work_leases");
    await pool.query("DELETE FROM workflow_action_intents WHERE run_id = $1", [runId]);
    await pool.query(
      "UPDATE workflow_runs SET checkpoint = jsonb_set(checkpoint, '{phase}', '\"creating_account\"') WHERE run_id = $1",
      [runId],
    );

    const elsewhere: ApplicationCatalogue = {
      find: (id) =>
        Promise.resolve(
          id !== GATED_BLUEPRINT
            ? null
            : {
                ...GATED_ENTRY,
                blueprint: {
                  ...GATED_PORTAL_BLUEPRINT,
                  pages: GATED_PORTAL_BLUEPRINT.pages.map((page) =>
                    page.pageRef === "page-register"
                      ? { ...page, url: "https://someone-elses.portal.test/register" }
                      : page,
                  ),
                },
              },
        ),
    };
    const instance = buildInstance(connectionString(), null, elsewhere);
    try {
      const work = await instance.driver.claimWork({ holder: "runner-x", leaseSeconds: 120 });
      expect(work, "a form on another host is not work").toBeNull();
      const leases = await pool.query("SELECT 1 FROM work_leases");
      expect(leases.rowCount, "and no lease is taken on the way to refusing").toBe(0);
    } finally {
      await instance.pool.end();
    }
  }, 180_000);

  it("REFUSES a claim from a caller with no service certificate", async () => {
    // ADR-0045's intake is internal, behind mutual TLS on a private subnet. The
    // predicate DENIES WHEN ABSENT — `options.authoriseService?.(req) !== true`
    // — so a deployment that forgot to configure it refuses every runner rather
    // than accepting every caller.
    await pool.query("DELETE FROM work_leases");
    const instance = buildInstance(connectionString());
    const port = PORT + 5;
    const app = createConversationApp({
      store: new ConversationEventStore(instance.pool),
      sessionSecret: SECRET,
      authorise: () => Promise.resolve(true),
      now: () => NOW,
      runs: instance.driver,
      // No `authoriseService` at all. This is the deployment that forgot.
    });
    const listening = await new Promise<Server>((resolve) => {
      const s_ = app.listen(port, "127.0.0.1", () => resolve(s_));
    });
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/internal/v1/work/claims`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ holder: "an-unauthenticated-runner" }),
      });
      expect(response.status).toBe(403);
      const leases = await pool.query("SELECT 1 FROM work_leases");
      expect(leases.rowCount, "a refused claim must take no lease").toBe(0);
    } finally {
      await new Promise<void>((resolve) => listening.close(() => resolve()));
      await instance.pool.end();
    }
  }, 120_000);

  it("hands work out and takes a report back, over real HTTP", async () => {
    // The whole round trip through the routes rather than through the driver:
    // a poll that finds nothing answers 204 with no body, a poll that finds
    // work answers 200 with a parseable item, and a report answers 204.
    await pool.query("DELETE FROM work_leases");
    await pool.query("DELETE FROM workflow_action_intents WHERE run_id = $1", [runId]);
    await pool.query(
      "UPDATE workflow_runs SET checkpoint = jsonb_set(checkpoint, '{phase}', '\"creating_account\"') WHERE run_id = $1",
      [runId],
    );

    const instance = buildInstance(connectionString());
    const port = PORT + 6;
    const app = createConversationApp({
      store: new ConversationEventStore(instance.pool),
      sessionSecret: SECRET,
      authorise: () => Promise.resolve(true),
      authoriseService: (req) => req.header("x-service-cert") === "runner",
      now: () => NOW,
      runs: instance.driver,
    });
    const listening = await new Promise<Server>((resolve) => {
      const s_ = app.listen(port, "127.0.0.1", () => resolve(s_));
    });
    const base = `http://127.0.0.1:${String(port)}`;
    const headers = { "content-type": "application/json", "x-service-cert": "runner" };
    try {
      const claimed = await fetch(`${base}/internal/v1/work/claims`, {
        method: "POST",
        headers,
        body: JSON.stringify({ holder: "runner-http", leaseSeconds: 120 }),
      });
      expect(claimed.status).toBe(200);
      expect(claimed.headers.get("cache-control")).toBe("no-store");
      const work = parseClaimedWork(await claimed.json());
      if (work === null) expect.unreachable("the claim must be a legal work item");
      expect(work.runId).toBe(runId);

      // A report from a lease nobody holds is refused, over HTTP too.
      const wrong = await fetch(`${base}/internal/v1/work/${runId}/report`, {
        method: "POST",
        headers,
        body: JSON.stringify({ leaseId: "wl_not_yours", outcome: "succeeded" }),
      });
      expect(wrong.status).toBe(403);

      const reported = await fetch(`${base}/internal/v1/work/${runId}/report`, {
        method: "POST",
        headers,
        body: JSON.stringify({ leaseId: work.leaseId, outcome: "failed", failure: "portal_drift" }),
      });
      expect(reported.status).toBe(204);

      // And a half-written report — a failure with no reason — is refused
      // rather than stored as more certainty than the runner reported.
      const half = await fetch(`${base}/internal/v1/work/${runId}/report`, {
        method: "POST",
        headers,
        body: JSON.stringify({ leaseId: work.leaseId, outcome: "failed" }),
      });
      expect(half.status).toBe(400);

      const leases = await pool.query("SELECT 1 FROM work_leases WHERE run_id = $1", [runId]);
      expect(leases.rowCount).toBe(0);
    } finally {
      await new Promise<void>((resolve) => listening.close(() => resolve()));
      await instance.pool.end();
    }
  }, 120_000);

  it("offers nothing for a run that is not waiting on a browser", async () => {
    // The run whose interview is unfinished, from group B. `nextStep` says
    // `interview`; `browserWorkFor` says null; no lease is taken.
    const instance = buildInstance(connectionString());
    try {
      await pool.query("DELETE FROM work_leases");
      await pool.query(
        "UPDATE workflow_runs SET checkpoint = jsonb_set(checkpoint, '{phase}', '\"interviewing\"') WHERE run_id = $1",
        [runId],
      );
      const work = await instance.driver.claimWork({ holder: "runner-5", leaseSeconds: 120 });
      expect(work, "a run that needs no browser is not work").toBeNull();
      const leases = await pool.query("SELECT 1 FROM work_leases");
      expect(leases.rowCount, "a poll that finds nothing must leave no lease").toBe(0);
    } finally {
      await instance.pool.end();
    }
  }, 60_000);
});
