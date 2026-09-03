/**
 * P16 — the runner supervisor, against a real plane.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `apps/browser-runner/src/supervisor.test.ts` proves the LOOP: one turn at a
 * time, prompt after work, patient after idle, and a `stop` that waits for a
 * browser mid-action. Every one of those runs against a `WorkIntake` fake,
 * which is the right shape for a scheduler — and cannot answer the three
 * questions this phase was actually asked:
 *
 *   5. does it advance a run when NO CLIENT IS CONNECTED?
 *   7. does leasing stop two runners doing the same thing, and let a crashed
 *      one's work be recovered?
 *   9. how does it behave under restart, duplicate polling, and competing
 *      workers?
 *
 * None of those is a property of the loop. They are properties of the loop
 * PLUS `claimWork`, `reportWork`, `work_leases` and the intent ledger, over
 * real HTTP against a real PostgreSQL — so that is what this file builds.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why `scripts/` ────────────────────────────────────────────────────────
 *
 * The same boundary reason `journey.test.ts` is here. This needs
 * `@askimate/aas-browser-runner` AND `@askimate/aas-conversation-service` in
 * one process, and `apps/browser-runner` is forbidden `@askimate/aas-case-store`
 * — the rule that keeps the process executing untrusted page content away from
 * the primary database (brief §8, ADR-0037). A harness that ships nothing is
 * the right place for the one thing that has to see across that line.
 *
 * ── What is real here, and what is not ────────────────────────────────────
 *
 *   real  PostgreSQL, both schemas, in the database the plane owns
 *   real  Conversation Service over real HTTP, service-authenticated
 *   real  RunDriver — `claimWork`, `reportWork`, the leases, the ledger
 *   real  `httpWorkIntake` and `startRunnerSupervisor`, unmodified
 *   fake  the PERFORMER. Deliberately: what a browser does on a portal is
 *         `journey.test.ts`'s subject, and a Chromium per assertion would make
 *         the timing questions this file asks unanswerable.
 */

import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { PostgresCaseStore } from "@askimate/aas-case-store/postgres";
import { PostgresWorkflowRunStore } from "@askimate/aas-case-store/postgres-workflow";
import { PostgresInterventionStore } from "@askimate/aas-case-store/postgres-interventions";
import { MIGRATIONS_DIR as CASE_MIGRATIONS } from "@askimate/aas-case-store";
import { proposeValue, studentId as makeStudentId } from "@askimate/aas-domain";
import type { ProfileFieldKey, ProfileFieldType } from "@askimate/aas-profile";
import {
  applyConfirmation,
  confirmField,
  emptyProfile,
  isDeclined,
  toStoredEntry,
} from "@askimate/aas-profile";
import { DeterministicModelClient } from "@askimate/aas-llm";
import {
  GATED_PORTAL_BLUEPRINT,
  GATED_PORTAL_MAPPING_SET,
} from "@askimate/aas-mapping/fixtures/gated";
import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import type { ClaimedWork } from "@askimate/aas-contracts";
import {
  httpWorkIntake,
  startRunnerSupervisor,
  type PerformOutcome,
  type RunningSupervisor,
  type TurnResult,
} from "@askimate/aas-browser-runner";
import {
  ApplicationBindingStore,
  ConversationEventStore,
  PostgresConfirmedProfileStore,
  RunDriver,
  StudentIdentityStore,
  WorkLeaseStore,
  createConversationApp,
  MIGRATIONS_DIR as CONVERSATION_MIGRATIONS,
  type ApplicationCatalogue,
  type CatalogueEntry,
  type SecureRequestOpener,
} from "@askimate/aas-conversation-service";

/**
 * Well clear of everything else, and that is not fussiness.
 *
 * `run-driver.test.ts` derives its servers from `PORT = 4903` as far as
 * `PORT + 60`, and `journey.test.ts` from 4901 as far as `+ 20` — so 4901-4963
 * is effectively reserved even though no file says so in one place. This suite
 * first took 4907, which is `run-driver.test.ts`'s `PORT + 4`, and when the two
 * files ran together one of its tests reached THIS service instead of its own
 * and got a 401 where it expected a 404: a failure that appeared and vanished
 * with the file scheduling, in a suite that is otherwise deterministic.
 */
const PORT = 4980;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const DATABASE = "aas_supervisor";
const SESSION_SECRET = "a-supervisor-session-secret-long-enough";
const RUNNER_CERT = "browser-runner";
const BLUEPRINT = "bp-gated-portal";
const STATEMENT = "Please apply to the MSc for me.";
/** When the interview happened. The RUN's clock is real; this is just a past. */
const CONFIRMED_AT = new Date("2026-08-31T10:00:00Z");

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("P16 — the runner supervisor, against a real plane");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

const ENTRY: CatalogueEntry = {
  blueprint: GATED_PORTAL_BLUEPRINT,
  mappingSet: GATED_PORTAL_MAPPING_SET,
  requiredDocuments: [],
  institutionRef: "inst-gated",
  courseRef: "course-msc-controlled",
  intakeRef: "2026-09",
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
  passwordDelivery: "askimate_secure_channel",
};

const CATALOGUE: ApplicationCatalogue = {
  find: (id) => Promise.resolve(id === BLUEPRINT ? ENTRY : null),
};

let pool: pg.Pool;
let server: Server;
let driver: RunDriver;
let events: ConversationEventStore;
let studentUuid: string;

/**
 * Every HTTP request the runners made, by path and status.
 *
 * This is how "duplicate polling" is measured rather than asserted: a claim
 * that found nothing and a claim that won look identical from the outside, and
 * the interesting number is how many of the former surrounded the one of the
 * latter.
 */
let wire: { path: string; status: number }[] = [];

/** The run whose runner is killed mid-action, shared across the P17 group. */
let crashedRunId = "";
let crashed: { supervisor: RunningSupervisor; turns: TurnResult[] };

const recordingFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  const response = await globalThis.fetch(input, init);
  wire.push({ path: new URL(String(input)).pathname, status: response.status });
  return response;
};

function connectionString(): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${DATABASE}`;
  return url.toString();
}

/** A Secure Interaction Service that answers, and is never otherwise used. */
function opener(): SecureRequestOpener {
  let n = 0;
  return {
    open: () => {
      n += 1;
      return Promise.resolve({
        requestId: `sr_${String(n).padStart(32, "0")}`,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        frameToken: `ft_${String(n)}`,
      });
    },
    mintFrameToken: (requestId) => Promise.resolve(`ft_fresh_${requestId}`),
  };
}

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
      respondedAt: CONFIRMED_AT,
    },
  });
  if (isDeclined(result)) expect.unreachable(`${key} should have been accepted`);
  const profile = confirmField(emptyProfile(makeStudentId(studentUuid), CONFIRMED_AT), result, CONFIRMED_AT);
  const entry = profile.entries.get(key);
  if (entry === undefined) expect.unreachable(`${key} should be in the profile`);
  await store.save(studentUuid, toStoredEntry(key, entry));
}

let seeded = 0;

/**
 * A run standing at `create_account`, waiting for a browser.
 *
 * Through the real path — the interview is confirmed, the run is started, the
 * Secure Plane's `secret_received` is appended the way the secure service
 * appends it, and the run is advanced once. A test that forced the checkpoint
 * would prove the claim query works and nothing about whether a run can get
 * there.
 *
 * This is SEEDING, and it is the last thing in each test that touches the
 * driver directly. Everything after it happens over HTTP, from a runner.
 */
async function seedRun(): Promise<{ runId: string; conversationId: string }> {
  seeded += 1;
  const conversationId = `01JBXQ8Z9WKTQ6M4H2NPS${String(seeded).padStart(5, "0")}`;
  await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
    conversationId,
    studentUuid,
  ]);
  const started = await driver.start({
    conversationId,
    blueprintId: BLUEPRINT,
    studentStatement: STATEMENT,
  });
  if (!started.ok) expect.unreachable(`start refused: ${started.refusal.kind}`);
  expect(started.position.step).toBe("request_secret");

  await events.append({
    conversationId,
    event: {
      kind: "secret_received",
      requestId: `sr_${seeded.toString(16).padStart(32, "0")}`,
      handle: `sh_${seeded.toString(16).padStart(32, "a")}`,
    },
  });

  const next = await driver.advance({ runId: started.position.runId, conversationId });
  if (!next.ok) expect.unreachable(`advance refused: ${next.refusal.kind}`);
  expect(next.position.step).toBe("create_account");
  return { runId: started.position.runId, conversationId };
}

/** A runner, built the way a deployed one would be: HTTP intake, real loop. */
function runner(
  holder: string,
  perform: (work: ClaimedWork) => Promise<PerformOutcome>,
  turns: TurnResult[] = [],
): { supervisor: RunningSupervisor; turns: TurnResult[] } {
  const supervisor = startRunnerSupervisor({
    intake: httpWorkIntake({
      baseUrl: BASE,
      holder,
      serviceToken: RUNNER_CERT,
      // Short, so the crash test can age a lease past it without waiting.
      leaseSeconds: 20,
      fetch: recordingFetch as unknown as typeof globalThis.fetch,
    }),
    perform,
    // Fast on both, because every question here is about ORDERING rather than
    // about the production intervals — which `supervisor.test.ts` asserts.
    idleIntervalMs: 15,
    busyIntervalMs: 15,
    onTurn: (result) => turns.push(result),
  });
  return { supervisor, turns };
}

/** Waits for a condition, or fails saying what it was still waiting for. */
async function until(what: string, condition: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect.unreachable(`timed out waiting for: ${what}`);
}

/** Lets the loops run on, so "it did it once" can become "and not again". */
async function keepPolling(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function intentsFor(runId: string): Promise<{ action: string; outcome: string | null }[]> {
  const rows = await pool.query<{ action: string; outcome: string | null }>(
    "SELECT action, outcome FROM workflow_action_intents WHERE run_id = $1",
    [runId],
  );
  return rows.rows;
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
  pool = new pg.Pool({ connectionString: connectionString(), max: 12 });
  await migrate(pool, CASE_MIGRATIONS);
  await migrate(pool, CONVERSATION_MIGRATIONS);

  const student = await pool.query<{ id: string }>(
    "INSERT INTO students (subject, email_verified) VALUES ('oidc-supervisor', true) RETURNING id",
  );
  studentUuid = student.rows[0]!.id;

  events = new ConversationEventStore(pool);
  const secureRequests = opener();
  driver = new RunDriver({
    stores: {
      cases: new PostgresCaseStore(pool),
      runs: new PostgresWorkflowRunStore(pool),
    },
    bindings: new ApplicationBindingStore(pool),
    catalogue: CATALOGUE,
    model: new DeterministicModelClient(),
    profiles: new PostgresConfirmedProfileStore(pool),
    conversations: events,
    secureRequests,
    identities: new StudentIdentityStore(pool),
    leases: new WorkLeaseStore(pool),
    interventions: new PostgresInterventionStore(pool),
    // A REAL clock. Every question in this file is about time — a lease that
    // lapses, a turn that overlaps another — and a frozen one would answer
    // them all by construction.
    now: () => new Date(),
  });

  const app = createConversationApp({
    store: events,
    sessionSecret: SESSION_SECRET,
    authorise: () => Promise.resolve(true),
    // ADR-0045: the runner's certificate, and only for claim and report.
    authoriseService: (req) => req.header("x-service-cert") === RUNNER_CERT,
    now: () => new Date(),
    runs: driver,
    secureRequests,
    secureOrigin: "https://secure.test",
  });
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(PORT, "127.0.0.1", () => resolve(listening));
  });

  const profiles = new PostgresConfirmedProfileStore(pool);
  await confirmInto(profiles, "identity.given_name", "Niloofar", "Niloofar");
  await confirmInto(profiles, "identity.family_name", "Hosseini", "Hosseini");
  await confirmInto(profiles, "identity.date_of_birth", new Date("1999-04-02T00:00:00Z"), "2 April 1999");
  await confirmInto(profiles, "identity.nationality", "Iranian", "Iranian");
  await confirmInto(profiles, "contact.email", "niloofar@example.test", "niloofar@example.test");
  await confirmInto(profiles, "study.personal_statement", "Because it is the course I want.", "…");
}, 180_000);

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describeIfDatabase("P16 — the supervisor advances a run with nobody watching", () => {
  it("does the work with no client connected and no advance called", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Requirement 5, and the whole point of the phase. Before this, a run
    // standing at `create_account` waited for somebody to run `runOneTurn`
    // by hand — which in production was nobody, because nothing looped it.
    //
    // After `seedRun` returns, this test touches the driver no further. There
    // is no browser, no session cookie, no `/runs` POST and no `advance`. The
    // only thing that happens is a runner process polling.
    // ═══════════════════════════════════════════════════════════════════
    const { runId } = await seedRun();
    wire = [];

    const performed: ClaimedWork[] = [];
    const { supervisor, turns } = runner("runner-alone", (work) => {
      performed.push(work);
      return Promise.resolve({ kind: "succeeded" } as const);
    });

    try {
      await until("the runner to do the work", () => turns.some((t) => t.kind === "worked"));
    } finally {
      await supervisor.stop();
    }

    expect(performed.map((w) => w.runId)).toEqual([runId]);
    expect(performed[0]?.kind).toBe("create_account");

    // The evidence is where evidence goes, written by the plane and not by
    // the runner (ADR-0008, ADR-0045 §4).
    expect(await intentsFor(runId)).toEqual([
      { action: "create_portal_account", outcome: "succeeded" },
    ]);

    // And every request on the wire was the runner's own. A `/v1/…` request
    // here would mean a client had been involved after all.
    expect(new Set(wire.map((r) => r.path.replace(/\/[^/]+\/report$/, "/report")))).toEqual(
      new Set(["/internal/v1/work/claims", "/internal/v1/work/report"]),
    );
  }, 120_000);

  it("stops being offered the work once it is done, without being told", async () => {
    // The other half of "nobody is watching": a loop that finished the work
    // and kept being handed it would create a second account on a real portal
    // every fifteen milliseconds. Nothing marks the run done — `reportWork`
    // deliberately does not move it — so this is the intent ledger and
    // `#situation` answering, over and over, that there is nothing to do.
    const { runId } = await seedRun();
    const { supervisor, turns } = runner("runner-once", () =>
      Promise.resolve({ kind: "succeeded" } as const),
    );
    try {
      await until("the work to be done", () => turns.some((t) => t.kind === "worked"));
      await keepPolling(400);
    } finally {
      await supervisor.stop();
    }

    expect(turns.filter((t) => t.kind === "worked")).toHaveLength(1);
    expect(await intentsFor(runId)).toHaveLength(1);
    // Many polls, one of them work. That ratio IS the property.
    expect(turns.filter((t) => t.kind === "idle").length).toBeGreaterThan(5);
  }, 120_000);
});

describeIfDatabase("P16 — two runners, one unit of work", () => {
  it("hands it to exactly ONE of them, however hard both poll", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Requirements 7 and 9. Two supervisors, two HTTP clients, one run, both
    // polling every 15ms at a service that decides claims with
    // `INSERT … ON CONFLICT (run_id) DO UPDATE … WHERE expires_at <= now`.
    //
    // The performer takes 150ms, which is what makes this a real race rather
    // than two turns that happened not to overlap: for that whole window the
    // second runner is polling a run the first is holding.
    // ═══════════════════════════════════════════════════════════════════
    const { runId } = await seedRun();
    wire = [];

    const performed: string[] = [];
    const slow = async (work: ClaimedWork): Promise<PerformOutcome> => {
      performed.push(work.runId);
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { kind: "succeeded" };
    };

    const a = runner("runner-a", slow);
    const b = runner("runner-b", slow);
    try {
      await until(
        "one of them to finish",
        () => [...a.turns, ...b.turns].some((t) => t.kind === "worked"),
      );
      // Both keep polling well past the finish, because "exactly one" has to
      // survive the moment AFTER the lease is released.
      await keepPolling(400);
    } finally {
      await Promise.all([a.supervisor.stop(), b.supervisor.stop()]);
    }

    expect(performed, "one browser opened, not two").toEqual([runId]);
    expect(await intentsFor(runId)).toEqual([
      { action: "create_portal_account", outcome: "succeeded" },
    ]);

    // Duplicate polling, measured rather than assumed: many claims, one 200.
    const claims = wire.filter((r) => r.path === "/internal/v1/work/claims");
    expect(claims.length, "both runners really did poll repeatedly").toBeGreaterThan(10);
    expect(claims.filter((r) => r.status === 200), "exactly one claim won").toHaveLength(1);
    expect(
      claims.filter((r) => r.status === 204).length,
      "and every other poll was told, plainly, that there was nothing",
    ).toBeGreaterThan(5);
  }, 120_000);
});

describeIfDatabase("P17 — a runner dies holding the work", () => {
  /**
   * Death, not shutdown.
   *
   * `stop()` is the orderly case and waits for the turn — `supervisor.test.ts`
   * proves that. This is the other one: the process is gone mid-action, so
   * nothing is reported, nothing is released, and the loop simply never
   * schedules again. Modelled by a performer that never resolves, which leaves
   * the supervisor in exactly the state a SIGKILL leaves it in from the
   * plane's point of view: a lease with no one behind it.
   *
   * ── What P17 changed, and why this group was rewritten ────────────────
   *
   * It used to assert that an heir RECOVERED the work once the lease lapsed,
   * and it passed — because the ledger was written on report, so a runner that
   * died mid-action left no trace and the run looked untouched. P16's audit
   * recorded that as the gap this system had, and left an assertion in this
   * file saying so. Vahid took the decision (option A) and ADR-0054 moved the
   * write to the claim.
   *
   * So the property under test is now the opposite one, and it is the reason
   * the phase exists: **a second runner must not repeat an account creation
   * that a crashed runner may already have performed.**
   */
  let release: () => void = () => undefined;

  it("records that it was about to act BEFORE it acts", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0054, asserted at the only instant that matters: a runner is inside
    // a real portal action right now. Before P17 this row did not exist until
    // the runner came back, and a runner that never came back left nothing.
    // ═══════════════════════════════════════════════════════════════════
    const { runId } = await seedRun();
    crashedRunId = runId;

    const claimed: string[] = [];
    crashed = runner("runner-dead", (work) => {
      claimed.push(work.runId);
      return new Promise<PerformOutcome>((resolve) => {
        release = () => resolve({ kind: "succeeded" });
      });
    });
    await until("the doomed runner to claim", () => claimed.length === 1);

    const ledger = await intentsFor(runId);
    expect(ledger, "the attempt is durable while the browser is still in it").toEqual([
      { action: "create_portal_account", outcome: null },
    ]);
  }, 120_000);

  it("refuses to hand the SAME work to a second runner once the lease lapses", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The point of the phase. The dead runner may or may not have created an
    // account on a real portal in this student's name; nobody here can tell.
    // `assessIntent` has no "retry it" branch, and this is where that absence
    // does its work — through `#unfinishedAction`, the guard that already
    // existed, with nothing new added beside it.
    // ═══════════════════════════════════════════════════════════════════
    const runId = crashedRunId;

    // While the lease is live, nobody else may have it either — for the
    // ordinary reason, which is worth separating from the one under test.
    const early = runner("runner-early", () => Promise.resolve({ kind: "succeeded" } as const));
    await keepPolling(200);
    expect(early.turns.every((t) => t.kind === "idle"), "a leased run is nobody else's").toBe(true);
    await early.supervisor.stop();

    // ── The lease lapses ────────────────────────────────────────────────
    //
    // Aged rather than waited out. Both timestamps move, because
    // `expires_at > claimed_at` is a CHECK and a lease cannot be written
    // already spent.
    const aged = await pool.query(
      "UPDATE work_leases SET claimed_at = $1, expires_at = $2 WHERE run_id = $3",
      [new Date(Date.now() - 600_000), new Date(Date.now() - 1_000), runId],
    );
    expect(aged.rowCount, "the dead runner's lease should still be there").toBe(1);

    const reached: string[] = [];
    const heir = runner("runner-heir", (work) => {
      reached.push(work.runId);
      return Promise.resolve({ kind: "succeeded" } as const);
    });
    try {
      await keepPolling(500);
    } finally {
      await heir.supervisor.stop();
    }

    expect(reached, "no second account is created for this student").toEqual([]);
    expect(heir.turns.length, "and it really did keep polling").toBeGreaterThan(5);
    expect(heir.turns.every((t) => t.kind === "idle")).toBe(true);
    expect(await intentsFor(runId), "still one attempt, still unfinished").toEqual([
      { action: "create_portal_account", outcome: null },
    ]);
  }, 120_000);

  it("stops the run and asks a person to look, through the mechanism that already existed", async () => {
    // No new guard. `#unfinishedAction` → `#pause` → an intervention and a
    // message to the student is the P10/ADR-0048 path, unchanged since before
    // this phase; all P17 did was make it reachable by a crash.
    const runId = crashedRunId;
    const raised = await pool.query<{ reason: string; lifecycle: string }>(
      "SELECT reason, lifecycle FROM interventions WHERE run_id = $1",
      [runId],
    );
    expect(raised.rows, "one stuck action is one case, however many polls").toHaveLength(1);

    const status = await pool.query<{ status: string }>(
      "SELECT status FROM workflow_runs WHERE run_id = $1",
      [runId],
    );
    expect(status.rows[0]?.status, "the run is not quietly still running").toBe("uncertain");
  }, 120_000);

  it("refuses the corpse's report, and its arrival changes nothing", async () => {
    // The dead runner comes back — a paused VM, a machine that was not as dead
    // as it looked — and reports against a lease that lapsed under it. Refused,
    // because a runner that lost its lease must not be able to settle work the
    // plane has already escalated to a person.
    const runId = crashedRunId;
    release();
    await until("the revenant to report", () => crashed.turns.length > 0);
    expect(crashed.turns[0], "its lease is gone").toEqual({ kind: "report_refused", runId });
    await crashed.supervisor.stop();

    expect(
      await intentsFor(runId),
      "the uncertainty window stays open for the specialist",
    ).toEqual([{ action: "create_portal_account", outcome: null }]);
  }, 120_000);
});

describeIfDatabase("P17 — a clean failure may be tried again", () => {
  it("re-opens the ledger row rather than colliding with the attempt before it", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0047 decided that `already_done` + `failed_cleanly` means nothing
    // happened out there, so the work is offered again. ADR-0054 moved the
    // ledger write to the claim — which would have broken that retry outright
    // if the row were simply left as it was: the second claim would hit the
    // primary key, and a second report would ask `completeIntent` to turn a
    // `failed_cleanly` into a `succeeded`, which it refuses.
    //
    // Worth stating plainly: the SECOND of those two was already broken before
    // P17. `reportWork` skipped recording when a row existed and then called
    // `completeIntent` anyway, so a run that failed cleanly and then succeeded
    // threw — the account existed on the portal and the ledger said
    // `failed_cleanly` for ever. Nothing tested the path, because no test ever
    // drove a full second attempt. This one does.
    // ═══════════════════════════════════════════════════════════════════
    const { runId } = await seedRun();

    let attempts = 0;
    const flaky = (): Promise<PerformOutcome> => {
      attempts += 1;
      // The first attempt fails PROVABLY locally — `portal_refused` is a claim
      // that the portal turned us away, which is what licenses a retry at all.
      return Promise.resolve(
        attempts === 1
          ? ({ kind: "failed", failure: "portal_refused" } as const)
          : ({ kind: "succeeded" } as const),
      );
    };

    const first = runner("runner-flaky-1", flaky);
    try {
      await until("the first attempt to fail", () => first.turns.some((t) => t.kind === "worked"));
    } finally {
      await first.supervisor.stop();
    }
    expect(await intentsFor(runId), "recorded as a clean failure").toEqual([
      { action: "create_portal_account", outcome: "failed_cleanly" },
    ]);

    // A different runner entirely, as it would be after a deploy.
    const second = runner("runner-flaky-2", flaky);
    try {
      await until("the second attempt to land", () => second.turns.some((t) => t.kind === "worked"));
    } finally {
      await second.supervisor.stop();
    }

    expect(attempts, "two attempts, not one and not three").toBe(2);
    expect(await intentsFor(runId), "ONE row, re-opened and then completed").toEqual([
      { action: "create_portal_account", outcome: "succeeded" },
    ]);
    // And the second report was accepted, rather than refused by a throw
    // inside the plane that the runner would have read as `report_refused`.
    expect(second.turns.filter((t) => t.kind === "worked")).toHaveLength(1);
  }, 120_000);
});

describeIfDatabase("P16 — the supervisor inherits every stop condition", () => {
  it("is offered nothing the moment the student stops the case", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Requirement 6. The supervisor holds no opinion about what may be worked
    // on — that is the argument in its own header, and this is the proof of
    // it end to end: the same loop that was about to create an account is
    // handed nothing at all, from the instant `cancel_case` commits, with no
    // change to the runner and nothing telling it anything happened.
    //
    // Cancellation is the case chosen because it is the newest and the most
    // consequential (ADR-0053). `uncertain`, `escalated` and an unfinished
    // action are refused by the same `claimWork`, one narrowing earlier.
    // ═══════════════════════════════════════════════════════════════════
    const { runId, conversationId } = await seedRun();

    // A control first: this run really is in the pool. Without it, a test that
    // asserted "nothing was offered" would pass against a run that was never
    // offerable for some other reason entirely.
    const control = runner("runner-control", () =>
      Promise.resolve({ kind: "failed", failure: "portal_refused" } as const),
    );
    await until("the run to be offered at all", () =>
      control.turns.some((t) => t.kind === "worked"),
    );
    await control.supervisor.stop();

    const stopped = await driver.recordDecision({
      conversationId,
      runId,
      decision: { kind: "cancel" },
    });
    expect(stopped).toEqual({ ok: true });

    // Recorded rather than `expect.unreachable`: a performer that throws is
    // caught by `runOneTurn` and turned into an `uncertain` report, so an
    // assertion in here would never reach the test. What the browser was asked
    // to do has to be carried back out and checked from the outside.
    const reached: string[] = [];
    const after = runner("runner-after", (work) => {
      reached.push(work.runId);
      return Promise.resolve({ kind: "succeeded" } as const);
    });
    try {
      await keepPolling(400);
    } finally {
      await after.supervisor.stop();
    }

    expect(reached, "a stopped case reaches no browser").toEqual([]);
    expect(after.turns.length, "it really did keep polling").toBeGreaterThan(5);
    expect(after.turns.every((t) => t.kind === "idle")).toBe(true);
    // The failed attempt from the control is the only thing that ever
    // happened to this run.
    expect(await intentsFor(runId)).toEqual([
      { action: "create_portal_account", outcome: "failed_cleanly" },
    ]);
  }, 120_000);
});
