/**
 * Phase 3: a run that survives the process that started it.
 *
 * ── The test that matters ─────────────────────────────────────────────────
 *
 * `"a run started in one process resumes in a NEW one"`, against a real
 * PostgreSQL, with genuinely separate connection pools. Vahid: *"Do not claim
 * recovery works merely because unit tests pass. There must be an end-to-end
 * restart scenario against the real persistence adapter."*
 *
 * The others cover the reconciliation rule — the event log wins, always — and
 * the purity constraint that shapes the whole design.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  blueprintVersion,
  caseId as makeCaseId,
  courseId,
  eventId,
  externalRef,
  institutionId,
  intake,
  openCase,
  runId as makeRunId,
  stamp,
  studentId,
} from "@askimate/aas-domain";
import type { CaseEvent, RequestEvidence, SubmissionIdentity } from "@askimate/aas-domain";
import { InMemoryCaseStore, InMemoryWorkflowRunStore } from "@askimate/aas-case-store";
import { PostgresCaseStore } from "@askimate/aas-case-store/postgres";
import { PostgresWorkflowRunStore } from "@askimate/aas-case-store/postgres-workflow";
import { migrate } from "@askimate/aas-migrate";
import { MIGRATIONS_DIR } from "@askimate/aas-case-store";

import {
  checkpointAfter,
  deriveCheckpoint,
  mayContinue,
  phaseFor,
  resumeRun,
  startRun,
} from "./durable.js";
import type { DurableStores } from "./durable.js";
import type { RunStep } from "./run.js";

const DATABASE_URL =
  process.env["AAS_TEST_DATABASE_URL"] ?? "postgresql://postgres@localhost:55432/postgres";
const DATABASE_REQUIRED = process.env["AAS_REQUIRE_DATABASE"] === "1";

const NOW = new Date("2026-08-27T10:00:00Z");
const LATER = new Date("2026-08-27T11:00:00Z");
const VERSION = blueprintVersion("ulster-msc-ib-v3");
const OTHER_VERSION = blueprintVersion("ulster-msc-ib-v4");
const STUDENT = studentId("stu_001");
const CASE = makeCaseId("case_durable");

const IDENTITY: SubmissionIdentity = {
  studentId: STUDENT,
  institutionId: institutionId("inst_ulster"),
  courseId: courseId("crs_msc_ib"),
  intake: intake("2026-09"),
  attemptOrdinal: 1,
};
const EVIDENCE: RequestEvidence = {
  requestedAt: NOW,
  channel: "askimate_chat",
  studentStatement: "Yes, please apply to Ulster for me.",
};

function opening(): readonly CaseEvent[] {
  return stamp({
    caseId: CASE,
    fromSequence: 0,
    payloads: [openCase({ submissionIdentity: IDENTITY, requestEvidence: EVIDENCE })],
    actor: { kind: "askimate", externalRef: externalRef("askimate:user:1") },
    now: NOW,
    nextEventId: () => eventId("evt_1"),
  });
}

const EXECUTE_STEP = { kind: "execute", plan: {} } as unknown as RunStep;
const AUTHORISE_STEP = { kind: "authorise" } as unknown as RunStep;

// ───────────────────────────────────────────────────────────────────────────
// Pure parts — no database needed
// ───────────────────────────────────────────────────────────────────────────

describe("mapping a decision to a phase", () => {
  it("covers every RunStep kind", () => {
    // Exhaustive by construction — `phaseFor`'s switch has no default, so a
    // new RunStep kind fails to compile until someone decides where it sits
    // rather than silently checkpointing as something else.
    const kinds: RunStep["kind"][] = [
      "interview",
      "specialist",
      "fix_content",
      "request_secret",
      "create_account",
      "student_handoff",
      "authorise",
      "execute",
      "ready_to_submit",
      "hand_over_account",
    ];
    for (const kind of kinds) {
      expect(phaseFor({ kind } as unknown as RunStep)).toBeTruthy();
    }
  });

  it("puts filling behind authorisation, as the workflow does", () => {
    expect(phaseFor(AUTHORISE_STEP)).toBe("awaiting_authorisation");
    expect(phaseFor(EXECUTE_STEP)).toBe("filling");
  });
});

describe("deriving a checkpoint from a decision", () => {
  const previous = {
    schemaVersion: 1 as const,
    phase: "interviewing" as const,
    fieldsCompleted: ["given_name"],
    blueprintVersion: VERSION,
    detail: {},
    capturedAt: NOW,
  };

  it("advances the phase and keeps progress", () => {
    const next = deriveCheckpoint({ previous, step: EXECUTE_STEP, now: LATER });
    expect(next.phase).toBe("filling");
    expect(next.fieldsCompleted).toEqual(["given_name"]);
    expect(next.capturedAt).toBe(LATER);
  });

  it("copies NOTHING from the step but its kind", () => {
    // A contentHash is tempting — short, and it identifies what was authorised
    // — and it is a business fact that already lives in AuthorisationCaptured.
    // Two copies is two sources of truth.
    const step = {
      kind: "ready_to_submit",
      contentHash: "sha256:abcdef",
    } as unknown as RunStep;
    const next = deriveCheckpoint({ previous, step, now: LATER });
    expect(JSON.stringify(next)).not.toContain("abcdef");
    expect(next.detail).toEqual({});
  });
});

describe("whether a resumed run may continue", () => {
  const record = (status: "running" | "suspended" | "uncertain" | "escalated") =>
    ({ status }) as never;

  it("continues a running or suspended run", () => {
    expect(mayContinue(record("running"))).toBe(true);
    expect(mayContinue(record("suspended"))).toBe(true);
  });

  it("STOPS an uncertain or escalated run", () => {
    // A run that may have created a portal account is not something to carry
    // on with because the code path happens to be open.
    expect(mayContinue(record("uncertain"))).toBe(false);
    expect(mayContinue(record("escalated"))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Reconciliation — the event log wins
// ───────────────────────────────────────────────────────────────────────────

describe("resuming, in memory", () => {
  async function stores(): Promise<DurableStores> {
    const cases = new InMemoryCaseStore();
    await cases.append(CASE, 0, opening());
    return { cases, runs: new InMemoryWorkflowRunStore() };
  }

  it("returns null for a run nobody started", async () => {
    const resumed = await resumeRun({
      stores: await stores(),
      runId: makeRunId("run_never"),
      expectedBlueprintVersion: VERSION,
      now: LATER,
    });
    expect(resumed).toBeNull();
  });

  it("resumes a run at the position it reached", async () => {
    const durable = await stores();
    const record = await startRun({
      stores: durable,
      runId: makeRunId("run_a"),
      caseId: CASE,
      studentRef: STUDENT,
      blueprintVersion: VERSION,
      now: NOW,
    });
    await checkpointAfter({ stores: durable, record, step: AUTHORISE_STEP, now: NOW });

    const resumed = await resumeRun({
      stores: durable,
      runId: makeRunId("run_a"),
      expectedBlueprintVersion: VERSION,
      now: LATER,
    });
    expect(resumed?.record.checkpoint.phase).toBe("awaiting_authorisation");
    expect(resumed?.concerns).toEqual([]);
  });

  it("DISCARDS a checkpoint written against a different blueprint", async () => {
    // A page position from one revision means nothing in another.
    const durable = await stores();
    const record = await startRun({
      stores: durable,
      runId: makeRunId("run_b"),
      caseId: CASE,
      studentRef: STUDENT,
      blueprintVersion: VERSION,
      now: NOW,
    });
    await checkpointAfter({ stores: durable, record, step: AUTHORISE_STEP, now: NOW });

    const resumed = await resumeRun({
      stores: durable,
      runId: makeRunId("run_b"),
      expectedBlueprintVersion: OTHER_VERSION,
      now: LATER,
    });
    expect(resumed?.concerns.map((concern) => concern.kind)).toContain("blueprint_changed");
    expect(resumed?.record.checkpoint.phase).toBe("preparing_inputs");
  });

  it("DISCARDS a checkpoint claiming it filled without an authorisation in the log", async () => {
    // The reconciliation rule, at its sharpest. Nothing may be filled before
    // the student authorises the exact content, so a checkpoint saying
    // "filling" with no AuthorisationCaptured describes a position that never
    // legitimately existed.
    const durable = await stores();
    const record = await startRun({
      stores: durable,
      runId: makeRunId("run_c"),
      caseId: CASE,
      studentRef: STUDENT,
      blueprintVersion: VERSION,
      now: NOW,
    });
    await checkpointAfter({ stores: durable, record, step: EXECUTE_STEP, now: NOW });

    const resumed = await resumeRun({
      stores: durable,
      runId: makeRunId("run_c"),
      expectedBlueprintVersion: VERSION,
      now: LATER,
    });
    expect(resumed?.concerns.map((concern) => concern.kind)).toContain("checkpoint_discarded");
    expect(resumed?.record.checkpoint.phase).toBe("preparing_inputs");
    const detail = resumed?.concerns[0]?.detail ?? "";
    expect(detail).toContain("AuthorisationCaptured");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A genuine process restart, against the real adapter
// ───────────────────────────────────────────────────────────────────────────

async function reachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2_000 });
  try {
    await probe.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

const HAVE_DATABASE = await reachable();
if (!HAVE_DATABASE) {
  const banner =
    `\n${"█".repeat(78)}\n` +
    `██  NOT CHECKED: end-to-end workflow recovery across a process restart\n` +
    `██\n` +
    `██  No PostgreSQL at ${DATABASE_URL}\n` +
    `██  This is THE test that demonstrates recovery. It did NOT run.\n` +
    `██\n` +
    `██  To run it:   pnpm run verify:integration\n` +
    `${"█".repeat(78)}\n`;
  if (DATABASE_REQUIRED) throw new Error(banner);
  console.warn(banner);
}

const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let admin: pg.Pool;

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const root = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await root.query("DROP DATABASE IF EXISTS aas_durable_run WITH (FORCE)");
    await root.query("CREATE DATABASE aas_durable_run");
  } finally {
    await root.end();
  }
  const url = new URL(DATABASE_URL);
  url.pathname = "/aas_durable_run";
  admin = new pg.Pool({ connectionString: url.toString() });
  await migrate(admin, MIGRATIONS_DIR);
}, 120_000);

afterAll(async () => {
  if (HAVE_DATABASE) await admin.end();
});

/** A completely fresh set of connections — what a new process would open. */
function newProcess(): { pool: pg.Pool; stores: DurableStores } {
  const url = new URL(DATABASE_URL);
  url.pathname = "/aas_durable_run";
  const pool = new pg.Pool({ connectionString: url.toString() });
  return {
    pool,
    stores: { cases: new PostgresCaseStore(pool), runs: new PostgresWorkflowRunStore(pool) },
  };
}

describeIfDatabase("a genuine process restart", () => {
  it("a run started in ONE process resumes in a NEW one, at the right point", async () => {
    // ── The end-to-end recovery demonstration ──────────────────────────
    //
    // Process A: opens a case, starts a run, authorises, begins filling, and
    // records two fields — then dies. Its pool is closed, which is the closest
    // thing to a kill this test can do without spawning a subprocess: every
    // socket and every server-side session goes.
    //
    // Process B: opens its own pool, knowing only the runId, and resumes.
    await admin.query("TRUNCATE workflow_action_intents, workflow_runs, case_events");

    const id = makeRunId("run_restart_1");
    const processA = newProcess();
    try {
      await processA.stores.cases.append(CASE, 0, opening());
      const record = await startRun({
        stores: processA.stores,
        runId: id,
        caseId: CASE,
        studentRef: STUDENT,
        blueprintVersion: VERSION,
        now: NOW,
      });

      // The student authorises — a BUSINESS fact, so it goes in the event log.
      const authorisation = stamp({
        caseId: CASE,
        fromSequence: 1,
        payloads: [
          {
            type: "AuthorisationCaptured",
            contentHash: "sha256:deadbeef",
            hashAlgorithm: "sha256",
            authorisedAt: NOW,
          },
        ],
        actor: { kind: "student", externalRef: externalRef("askimate:user:1") },
        now: NOW,
        nextEventId: () => eventId("evt_auth"),
      });
      await processA.stores.cases.append(CASE, 1, authorisation);

      // And it starts filling — POSITION, so it goes in the checkpoint.
      const revision = await checkpointAfter({
        stores: processA.stores,
        record,
        step: EXECUTE_STEP,
        fieldsCompleted: ["given_name", "family_name"],
        now: NOW,
      });
      expect(revision).toBe(1);
    } finally {
      await processA.pool.end(); // ← the process dies here
    }

    // ── A NEW process ──────────────────────────────────────────────────
    const processB = newProcess();
    try {
      const resumed = await resumeRun({
        stores: processB.stores,
        runId: id,
        expectedBlueprintVersion: VERSION,
        now: LATER,
      });

      expect(resumed).not.toBeNull();
      expect(resumed?.concerns).toEqual([]);
      // It knows exactly where it was.
      expect(resumed?.record.checkpoint.phase).toBe("filling");
      expect(resumed?.record.checkpoint.fieldsCompleted).toEqual(["given_name", "family_name"]);
      // And it may carry on.
      expect(mayContinue(resumed!.record)).toBe(true);
      // The business facts came back from the LOG, not the checkpoint.
      expect(resumed?.events).toHaveLength(2);
      const authorised = resumed?.events.some((event) => event.type === "AuthorisationCaptured");
      expect(authorised).toBe(true);
      // Dates survived the round trip.
      expect(resumed?.record.checkpoint.capturedAt).toBeInstanceOf(Date);
    } finally {
      await processB.pool.end();
    }
  }, 120_000);

  it("a restart WITHOUT the authorisation in the log refuses to resume into filling", async () => {
    // The same restart, with the business fact missing. The checkpoint says
    // "filling"; the log does not agree; the log wins.
    await admin.query("TRUNCATE workflow_action_intents, workflow_runs, case_events");

    const id = makeRunId("run_restart_2");
    const processA = newProcess();
    try {
      await processA.stores.cases.append(CASE, 0, opening());
      const record = await startRun({
        stores: processA.stores,
        runId: id,
        caseId: CASE,
        studentRef: STUDENT,
        blueprintVersion: VERSION,
        now: NOW,
      });
      await checkpointAfter({
        stores: processA.stores,
        record,
        step: EXECUTE_STEP,
        fieldsCompleted: ["given_name"],
        now: NOW,
      });
    } finally {
      await processA.pool.end();
    }

    const processB = newProcess();
    try {
      const resumed = await resumeRun({
        stores: processB.stores,
        runId: id,
        expectedBlueprintVersion: VERSION,
        now: LATER,
      });
      expect(resumed?.concerns.map((concern) => concern.kind)).toContain("checkpoint_discarded");
      expect(resumed?.record.checkpoint.phase).toBe("preparing_inputs");
      expect(resumed?.record.checkpoint.fieldsCompleted).toEqual([]);
    } finally {
      await processB.pool.end();
    }
  }, 120_000);

  it("losing every checkpoint loses no business fact, across a restart", async () => {
    // Rule 3, demonstrated end to end rather than only in the store contract.
    await admin.query("TRUNCATE workflow_action_intents, workflow_runs, case_events");

    const id = makeRunId("run_restart_3");
    const first = newProcess();
    try {
      await first.stores.cases.append(CASE, 0, opening());
      const record = await startRun({
        stores: first.stores,
        runId: id,
        caseId: CASE,
        studentRef: STUDENT,
        blueprintVersion: VERSION,
        now: NOW,
      });
      await checkpointAfter({
        stores: first.stores,
        record,
        step: AUTHORISE_STEP,
        now: NOW,
      });
      // Every checkpoint, gone.
      await first.stores.runs.discardCheckpoints(id);
    } finally {
      await first.pool.end();
    }

    const second = newProcess();
    try {
      const resumed = await resumeRun({
        stores: second.stores,
        runId: id,
        expectedBlueprintVersion: VERSION,
        now: LATER,
      });
      // Position lost — that is the cost, and it is only a re-derivation.
      expect(resumed?.record.checkpoint.phase).toBe("preparing_inputs");
      // Every business fact intact.
      expect(resumed?.record.caseId).toBe(CASE);
      expect(resumed?.record.studentRef).toBe(STUDENT);
      expect(resumed?.events).toHaveLength(1);
      expect(resumed?.events[0]?.type).toBe("CaseOpened");
    } finally {
      await second.pool.end();
    }
  }, 120_000);
});
