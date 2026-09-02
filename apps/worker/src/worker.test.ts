/**
 * The Background Worker's own properties (ADR-0052).
 *
 * Two kinds of test, and the split is deliberate:
 *
 *   - the SCHEDULING properties — leasing, batching, one-run-fails-others-do-
 *     not, no overlapping tick, crash recovery — against a driver this file
 *     controls, because they are about the loop and a real driver would make
 *     them slower without making them stronger;
 *   - `dueForWorker`, against a REAL PostgreSQL, because "which runs are live
 *     and unheld" is answered by a SQL join and a fake would be re-implementing
 *     the thing under test.
 *
 * The end-to-end property Vahid's decision 3 asks for — *"closing the browser
 * must never prevent the system from progressing"* — is proved in
 * `scripts/journey.test.ts`, where four real planes and real HTTP already
 * exist. It cannot be proved here, and a version of it against a fake driver
 * would look like proof and be none.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import { MIGRATIONS_DIR as CASE_MIGRATIONS } from "@askimate/aas-case-store";
import {
  MIGRATIONS_DIR as CONVERSATION_MIGRATIONS,
  WorkLeaseStore,
  WorkerLeaseStore,
} from "@askimate/aas-conversation-service";

import { advancePass, startWorker } from "./worker.js";
import type { WorkerDriver } from "./worker.js";

const NOW = new Date("2026-09-02T11:00:00Z");

/** A driver whose every answer this test decides. */
function fakeDriver(
  input: {
    readonly due?: readonly { readonly runId: string; readonly conversationId: string }[];
    readonly advance?: (runId: string) => Promise<{ ok: boolean }>;
    readonly announced?: number;
  } = {},
): WorkerDriver & { readonly advanced: string[]; readonly announcements: number[] } {
  const advanced: string[] = [];
  const announcements: number[] = [];
  return {
    advanced,
    announcements,
    dueRuns: (): Promise<readonly { readonly runId: string; readonly conversationId: string }[]> =>
      Promise.resolve(input.due ?? []),
    advance: async ({ runId }): Promise<{ ok: boolean }> => {
      advanced.push(runId);
      return input.advance === undefined ? { ok: true } : await input.advance(runId);
    },
    announcePending: (): Promise<{ announced: number }> => {
      announcements.push(input.announced ?? 0);
      return Promise.resolve({ announced: input.announced ?? 0 });
    },
  };
}

describe("one advance pass", () => {
  const due = [
    { runId: "run-1", conversationId: "conv-1" },
    { runId: "run-2", conversationId: "conv-2" },
    { runId: "run-3", conversationId: "conv-3" },
  ];

  it("advances every run in the batch, not just the first", async () => {
    const driver = fakeDriver({ due });
    const outcome = await advancePass({ driver, batch: 25 });

    expect(driver.advanced).toEqual(["run-1", "run-2", "run-3"]);
    expect(outcome).toEqual({ looked: 3, moved: 3, failed: 0 });
  });

  it("keeps going when ONE run throws", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The alternative is that one broken case stops every other case in the
    // system, which is a far worse failure than the one it protects against.
    // ═══════════════════════════════════════════════════════════════════
    const driver = fakeDriver({
      due,
      advance: (runId) =>
        runId === "run-2"
          ? Promise.reject(new Error("this one is broken"))
          : Promise.resolve({ ok: true }),
    });
    const outcome = await advancePass({ driver, batch: 25 });

    expect(driver.advanced, "all three were attempted").toEqual(["run-1", "run-2", "run-3"]);
    expect(outcome).toEqual({ looked: 3, moved: 2, failed: 1 });
  });

  it("distinguishes 'looked at and did not move' from 'moved'", async () => {
    // A refused advance is not a failure — `#decideOnce` leaves the case where
    // it is and writes nothing. But "twenty runs were looked at and none moved"
    // and "twenty runs moved" are very different operational pictures, and one
    // number cannot tell them apart.
    const driver = fakeDriver({ due, advance: () => Promise.resolve({ ok: false }) });
    const outcome = await advancePass({ driver, batch: 25 });

    expect(outcome).toEqual({ looked: 3, moved: 0, failed: 0 });
  });

  it("does nothing, and says so, when nothing is due", async () => {
    const outcome = await advancePass({ driver: fakeDriver(), batch: 25 });
    expect(outcome).toEqual({ looked: 0, moved: 0, failed: 0 });
  });
});

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the Background Worker against a real database");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let pool: pg.Pool;

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query("DROP DATABASE IF EXISTS aas_worker WITH (FORCE)");
    await admin.query("CREATE DATABASE aas_worker");
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = "/aas_worker";
  pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
  await migrate(pool, CASE_MIGRATIONS);
  await migrate(pool, CONVERSATION_MIGRATIONS);
}, 180_000);

afterAll(async () => {
  if (HAVE_DATABASE) await pool.end();
});

describeIfDatabase("which runs the worker is offered", () => {
  let student = "";

  /** A run in a given status, bound to its own conversation. */
  async function seedRun(runId: string, status: string): Promise<string> {
    const conversation = `01JBXQ8Z9WKTQ6M4H2NPW${runId.slice(-5).toUpperCase()}`;
    const caseId = `case_${runId}`;
    // The case first: `conversations.case_id` is a COMPOSITE foreign key on
    // (student_id, case_id), so a conversation cannot claim a case that does
    // not exist or belongs to somebody else. Seeding the conversation alone
    // was refused by that constraint doing exactly its job.
    await pool.query("INSERT INTO cases (case_id, student_id) VALUES ($1, $2)", [caseId, student]);
    await pool.query("INSERT INTO conversations (id, student_id, case_id) VALUES ($1, $2, $3)", [
      conversation,
      student,
      caseId,
    ]);
    await pool.query(
      `INSERT INTO workflow_runs
         (run_id, case_id, student_ref, status, revision, checkpoint, started_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, $5::jsonb, $6, $6)`,
      [
        runId,
        caseId,
        student,
        status,
        JSON.stringify({ blueprintVersion: "1.0.0", phase: "interviewing", capturedAt: NOW }),
        NOW,
      ],
    );
    return conversation;
  }

  beforeAll(async () => {
    const created = await pool.query<{ id: string }>(
      "INSERT INTO students (subject, email_verified) VALUES ('oidc-worker', true) RETURNING id",
    );
    student = created.rows[0]!.id;
    await seedRun("run-aaaaa", "running");
    await seedRun("run-bbbbb", "suspended");
    await seedRun("run-ccccc", "uncertain");
    await seedRun("run-ddddd", "escalated");
    await seedRun("run-eeeee", "completed");
    await seedRun("run-fffff", "abandoned");
  }, 120_000);

  it("offers RUNNING and SUSPENDED, and nothing else", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The exact set `WorkLeaseStore.candidates` selects for runner work
    // (ADR-0052 §13.5). The worker must not hold a second opinion about which
    // runs are live — two answers to that question is the failure ADR-0041
    // exists to prevent.
    //
    // `uncertain` and `escalated` are waiting for a PERSON by design.
    // Advancing one would be the blind retry `assessIntent` refuses: a
    // create_portal_account that was started and never completed may have
    // created an account on a real portal.
    // ═══════════════════════════════════════════════════════════════════
    const due = await new WorkLeaseStore(pool).dueForWorker({ now: NOW, limit: 25 });

    expect([...due.map((row) => row.runId)].sort()).toEqual(["run-aaaaa", "run-bbbbb"]);
  });

  it("names the CONVERSATION, because advance is keyed on the pair", async () => {
    const due = await new WorkLeaseStore(pool).dueForWorker({ now: NOW, limit: 25 });
    for (const row of due) {
      expect(row.conversationId, row.runId).toMatch(/^01JBXQ8Z9WKTQ6M4H2NPW/);
    }
  });

  it("does NOT offer a run a RUNNER is holding", async () => {
    // The runner is mid-operation against a real portal. Deciding underneath it
    // would decide from a position that is about to change.
    const leases = new WorkLeaseStore(pool);
    const taken = await leases.claim({
      runId: "run-aaaaa",
      leaseId: "wl_runner_1",
      kind: "create_account",
      holder: "runner-1",
      now: NOW,
      leaseSeconds: 120,
    });
    expect(taken, "the runner took it").not.toBeNull();

    const due = await leases.dueForWorker({ now: NOW, limit: 25 });
    expect(due.map((row) => row.runId)).toEqual(["run-bbbbb"]);

    // …and once that lease lapses, the worker is offered it again.
    const later = new Date(NOW.getTime() + 300_000);
    const after = await leases.dueForWorker({ now: later, limit: 25 });
    expect([...after.map((row) => row.runId)].sort()).toEqual(["run-aaaaa", "run-bbbbb"]);
  });

  it("respects the batch limit", async () => {
    const due = await new WorkLeaseStore(pool).dueForWorker({ now: NOW, limit: 1 });
    expect(due).toHaveLength(1);
  });
});

describeIfDatabase("the worker holds a job while it works", () => {
  it("a SECOND worker does nothing while the first holds the lease", async () => {
    const first = fakeDriver({ due: [{ runId: "run-aaaaa", conversationId: "conv-1" }] });
    const second = fakeDriver({ due: [{ runId: "run-aaaaa", conversationId: "conv-1" }] });

    const workerA = startWorker({ pool, driver: first, holder: "worker-a", now: () => NOW });
    const workerB = startWorker({ pool, driver: second, holder: "worker-b", now: () => NOW });
    try {
      await workerA.runOnce();
      await workerB.runOnce();

      expect(first.advanced.length, "the holder did the work").toBeGreaterThan(0);
      expect(second.advanced, "the other did none of it").toHaveLength(0);
    } finally {
      await workerA.stop();
      await workerB.stop();
    }
  }, 60_000);

  it("the SAME worker keeps working on its next tick", async () => {
    // Re-claiming IS the renewal (ADR-0052 §13.2). Without the holder's own
    // lease id in the claim's WHERE, a worker's second tick would find its own
    // lease in the way and it would do nothing until the lease lapsed.
    const driver = fakeDriver({ due: [{ runId: "run-bbbbb", conversationId: "conv-2" }] });
    const worker = startWorker({ pool, driver, holder: "worker-c", now: () => NOW });
    try {
      await worker.runOnce();
      await worker.runOnce();
      await worker.runOnce();
      expect(driver.advanced, "three ticks, three passes").toHaveLength(3);
    } finally {
      await worker.stop();
    }
  }, 60_000);

  it("RECOVERS the job after a worker dies without releasing", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Crash recovery is the ABSENCE of a mechanism (ADR-0052 §10). A worker
    // that dies stops re-claiming; nothing marks it dead, nothing heartbeats,
    // nothing has to notice. Its lease simply lapses and the next worker
    // re-derives exactly the same work.
    //
    // Simulated by never calling `stop` — which is precisely what a killed
    // process does.
    // ═══════════════════════════════════════════════════════════════════
    const clock = { now: NOW };
    const dead = fakeDriver({ due: [{ runId: "run-aaaaa", conversationId: "conv-1" }] });
    const dying = startWorker({ pool, driver: dead, holder: "worker-dead", now: () => clock.now });
    await dying.runOnce();
    expect(dead.advanced.length).toBeGreaterThan(0);
    // No `stop()`. The process is gone; the lease is still in the table.

    const survivor = fakeDriver({ due: [{ runId: "run-aaaaa", conversationId: "conv-1" }] });
    const immediate = startWorker({
      pool,
      driver: survivor,
      holder: "worker-live",
      now: () => clock.now,
    });
    try {
      await immediate.runOnce();
      expect(survivor.advanced, "too soon — the dead worker's lease is still live").toHaveLength(0);

      // Past the lease, with nobody having released anything.
      clock.now = new Date(NOW.getTime() + 120_000);
      await immediate.runOnce();
      expect(survivor.advanced.length, "picked up, with no intervention").toBeGreaterThan(0);
    } finally {
      await immediate.stop();
    }
  }, 60_000);

  it("gives the lease back on an orderly stop", async () => {
    // Not required for correctness — an abandoned lease lapses on its own. It
    // exists so a rolling deploy does not make the next worker wait a full
    // lease period for work it could start immediately.
    const driver = fakeDriver({ due: [] });
    const worker = startWorker({ pool, driver, holder: "worker-tidy", now: () => NOW });
    await worker.runOnce();
    expect(await new WorkerLeaseStore(pool).held("advance_runs", NOW)).not.toBeNull();

    await worker.stop();
    expect(await new WorkerLeaseStore(pool).held("advance_runs", NOW)).toBeNull();
  }, 60_000);

  it("stop() is idempotent", async () => {
    const worker = startWorker({
      pool,
      driver: fakeDriver(),
      holder: "worker-x",
      now: () => NOW,
    });
    await worker.stop();
    await expect(worker.stop()).resolves.toBeUndefined();
  }, 60_000);

  it("ANNOUNCES before it advances, so one pass does not half-report its own work", async () => {
    const driver = fakeDriver({ due: [], announced: 2 });
    const worker = startWorker({ pool, driver, holder: "worker-ann", now: () => NOW });
    try {
      const outcome = await worker.runOnce();
      expect(outcome.announced).toBe(2);
    } finally {
      await worker.stop();
    }
  }, 60_000);
});
