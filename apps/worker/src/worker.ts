/**
 * The Background Worker — the fifth deployable (ADR-0052).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SCHEDULER THAT WAS THE STUDENT'S BROWSER.
 *
 * Before P14 a case only moved while somebody was posting to it. `#decide` was
 * reachable from `start` and `advance`; `advance` had no route; so the sole
 * production trigger was the client re-POSTing `/v1/conversations/{id}/runs`.
 * A student who closed the tab after being asked to verify their email address
 * was never told anything again — no handoff raised, no announcement, no
 * outgrown authorisation voided, no escalation, no conclusion.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this file is, and deliberately is not ────────────────────────────
 *
 * It is a SCHEDULER and nothing else: intervals, leases, and the discipline
 * that a tick cannot overlap itself. Every decision about what the work IS
 * belongs to `RunDriver` — `dueRuns` derives which runs are live, `advance`
 * decides, `announcePending` composes the student's message. A worker that
 * composed its own message or wrote its own candidate query would be a second
 * implementation of a conversation decision, which ADR-0041 exists to prevent.
 *
 * ── The plane it belongs to ───────────────────────────────────────────────
 *
 * The Conversation Plane, and only that (ADR-0052 §13.0, Vahid's decision).
 * This process holds **no secure-database credential, no KMS grant and no route
 * to the vault's cache**. Draining the lifecycle outbox and expiring secure
 * requests are the Secure Service's own in-process loops, because ADR-0037's
 * separation says no process holds both planes' credentials — and a worker that
 * held both would be the single process whose compromise yields both databases.
 *
 * `pnpm run boundaries` fails the build if this app names a vault, a secret
 * store or a resolver.
 *
 * ── Why it is safe to restart, scale out, and scale to zero ───────────────
 *
 * It holds no state. Work is derived from the records that already own it, and
 * every job is idempotent, so crash recovery is the ABSENCE of a mechanism: a
 * worker that dies stops re-claiming, its lease lapses within sixty seconds,
 * and another worker re-derives exactly the same work (ADR-0052 §10).
 */

import type { Pool } from "pg";

import { WorkerLeaseStore } from "@askimate/aas-conversation-service";
import type { WorkerJob } from "@askimate/aas-conversation-service";

/**
 * The half of `RunDriver` this worker needs.
 *
 * Narrower than the driver on purpose, and for the reason `RunCoordinator` in
 * the routes is narrower: the worker advances runs and announces
 * interventions. It has no business starting a run, recording a student's
 * decision, or handing work to a runner.
 */
export interface WorkerDriver {
  dueRuns(limit?: number): Promise<readonly { readonly runId: string; readonly conversationId: string }[]>;
  advance(input: {
    readonly runId: string;
    readonly conversationId: string;
  }): Promise<{ readonly ok: boolean }>;
  announcePending(limit?: number): Promise<{ readonly announced: number }>;
}

/**
 * How often each job runs (ADR-0052 §13.1).
 *
 * `advance` at five seconds: the case a student can feel is one where they have
 * just acted, and their own request already advances their run synchronously
 * (§8). This interval is what an ABSENT student's run waits, where seconds do
 * not matter — and an advance is a much heavier operation than an outbox drain.
 *
 * `announce` at ten seconds: the intervention is durable and discoverable the
 * moment it is raised; this only decides when the student is told.
 */
export const DEFAULT_ADVANCE_MS = 5_000;
export const DEFAULT_ANNOUNCE_MS = 10_000;

/** How many runs one advance pass looks at. Bounded, like every batch here. */
export const DEFAULT_BATCH = 25;

export interface WorkerOptions {
  readonly pool: Pool;
  readonly driver: WorkerDriver;
  /**
   * Which worker this is.
   *
   * For an operator reading `worker_leases` during an incident. Never a
   * credential and never used for authorisation — the service certificate does
   * that (ADR-0037).
   */
  readonly holder: string;
  /** Injected, like every clock in this repository. */
  readonly now: () => Date;
  readonly advanceIntervalMs?: number;
  readonly announceIntervalMs?: number;
  readonly batch?: number;
  /**
   * Where a thrown error goes.
   *
   * A loop that throws must not take the process down and must not be silent.
   * Takes the job's NAME rather than the error: this worker holds
   * conversation-plane credentials, and a thrown database error can carry a
   * query, its parameters and a fragment of a row.
   */
  readonly onFailure?: (job: WorkerJob) => void;
}

export interface RunningWorker {
  /** Stops every timer and gives back the leases. Safe to call twice. */
  readonly stop: () => Promise<void>;
  /**
   * One pass of every job, run to completion, ignoring the timers.
   *
   * For a test that wants determinism rather than a race with an interval.
   */
  readonly runOnce: () => Promise<{
    readonly moved: number;
    readonly looked: number;
    readonly announced: number;
  }>;
}

/**
 * One pass of `advance_runs`.
 *
 * Exported so a test can drive it without a timer, and so the shape of the pass
 * is readable on its own.
 *
 * ── One run's failure does not stop the batch ────────────────────────────
 *
 * A run whose advance throws is counted and the loop continues. The
 * alternative is that one broken case stops every other case in the system,
 * which is a far worse failure than the one it would be protecting against.
 * Nothing is read from the error, for the reason in `onFailure` above.
 */
export async function advancePass(input: {
  readonly driver: WorkerDriver;
  readonly batch: number;
}): Promise<{ readonly looked: number; readonly moved: number; readonly failed: number }> {
  const due = await input.driver.dueRuns(input.batch);
  let moved = 0;
  let failed = 0;
  for (const run of due) {
    try {
      const outcome = await input.driver.advance({
        runId: run.runId,
        conversationId: run.conversationId,
      });
      if (outcome.ok) moved += 1;
    } catch {
      failed += 1;
    }
  }
  // "Twenty runs were looked at and none moved" and "twenty runs moved" are
  // very different operational pictures, and one number cannot tell them apart.
  return { looked: due.length, moved, failed };
}

/**
 * Starts the worker.
 *
 * ── Why a tick cannot overlap itself ──────────────────────────────────────
 *
 * An advance pass that takes longer than its interval would otherwise start
 * again underneath itself. It would be SAFE — the lease and the jobs'
 * idempotency both hold — but it would multiply database connections without
 * bound under exactly the condition (a slow database) where that is worst. So
 * each loop holds a flag and skips its tick while the previous one runs.
 */
export function startWorker(options: WorkerOptions): RunningWorker {
  const leases = new WorkerLeaseStore(options.pool);
  const batch = options.batch ?? DEFAULT_BATCH;

  // The lease this worker currently holds for each job, so the next tick can
  // extend its OWN lease rather than waiting for it to lapse. This is the whole
  // of "no renewal mechanism" (ADR-0052 §13.2): re-claiming IS the renewal, and
  // it happens as a side effect of doing the work.
  const holding = new Map<WorkerJob, string>();
  let advancing = false;
  let announcing = false;
  let stopped = false;

  /**
   * Runs `task` while holding the job's lease, or does nothing.
   *
   * The lease is an efficiency and an operational signal, never the correctness
   * argument (ADR-0052 §9): a job whose correctness depended on holding it
   * would already be wrong, because a lease can always lapse under a slow
   * query. What it buys is that two workers do not do the same work at once.
   */
  const underLease = async <T>(job: WorkerJob, task: () => Promise<T>): Promise<T | null> => {
    const lease = await leases.claim({
      job,
      holder: options.holder,
      now: options.now(),
      ...(holding.has(job) ? { holding: holding.get(job) ?? "" } : {}),
    });
    if (lease === null) return null;
    holding.set(job, lease.leaseId);
    return await task();
  };

  const advanceOnce = async (): Promise<{ looked: number; moved: number }> => {
    const outcome = await underLease("advance_runs", async () =>
      await advancePass({ driver: options.driver, batch }),
    );
    return outcome === null ? { looked: 0, moved: 0 } : outcome;
  };

  const announceOnce = async (): Promise<number> => {
    const outcome = await underLease(
      "announce_interventions",
      async () => await options.driver.announcePending(batch),
    );
    return outcome?.announced ?? 0;
  };

  const advanceTimer = setInterval(() => {
    if (advancing || stopped) return;
    advancing = true;
    void advanceOnce()
      .catch(() => {
        options.onFailure?.("advance_runs");
      })
      .finally(() => {
        advancing = false;
      });
  }, options.advanceIntervalMs ?? DEFAULT_ADVANCE_MS);

  const announceTimer = setInterval(() => {
    if (announcing || stopped) return;
    announcing = true;
    void announceOnce()
      .catch(() => {
        options.onFailure?.("announce_interventions");
      })
      .finally(() => {
        announcing = false;
      });
  }, options.announceIntervalMs ?? DEFAULT_ANNOUNCE_MS);

  advanceTimer.unref();
  announceTimer.unref();

  return {
    stop: async (): Promise<void> => {
      stopped = true;
      clearInterval(advanceTimer);
      clearInterval(announceTimer);
      // Giving the leases back is not required for correctness — an abandoned
      // lease lapses on its own, which is what makes crash recovery the absence
      // of a mechanism. It exists so an ORDERLY shutdown does not make the next
      // worker wait a full lease period for work it could start now.
      for (const [job, leaseId] of holding) {
        await leases.release(job, leaseId).catch(() => undefined);
      }
      holding.clear();
    },
    runOnce: async (): Promise<{ moved: number; looked: number; announced: number }> => {
      // Announce FIRST, then advance: an advance can raise a new intervention,
      // and announcing before it means one `runOnce` does not half-report a
      // thing it created in the same pass. The next pass tells that student.
      const announced = await announceOnce();
      const { looked, moved } = await advanceOnce();
      return { moved, looked, announced };
    },
  };
}
