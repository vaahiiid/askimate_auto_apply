/**
 * Which background worker is running which job kind, right now.
 *
 * ADR-0052 §3, §13.2. Migration `0010_worker_leases.sql` carries the full
 * argument; the two sentences worth repeating here, because this is the file
 * somebody will read before adding a job:
 *
 *   1. **A row holds no business fact.** Drop the table and nothing about any
 *      case, run, request, intervention or student is lost. Every job derives
 *      its work from the record that already owns it, so the next worker
 *      rediscovers exactly the same work.
 *
 *   2. **The lease is an efficiency, never the correctness argument.** A job
 *      whose correctness depended on holding its lease would already be wrong,
 *      because a lease can always lapse under a slow query. Correctness comes
 *      from the jobs being idempotent; this stops two workers doing the same
 *      thing at once.
 *
 * Deliberately NOT a queue, and deliberately not `work_leases` — that table's
 * primary key is `run_id` and a background job is not about a run.
 */

import { randomBytes } from "node:crypto";

import type { Pool } from "pg";

/**
 * The jobs a worker runs.
 *
 * A closed set here and a CHECK constraint in the migration, so a typo is a
 * failed insert rather than a lease nobody notices is orphaned.
 */
export const WORKER_JOBS = ["advance_runs", "announce_interventions"] as const;
export type WorkerJob = (typeof WORKER_JOBS)[number];

/**
 * How long a worker holds a job before another may take it.
 *
 * ADR-0052 §13.2. Sixty seconds, re-claimed on each tick, and no renewal
 * mechanism — renewal exists only to keep holding something correctness does
 * not depend on. Shorter than the runner's `DEFAULT_LEASE_SECONDS` of 120
 * because a runner's lease covers a browser driving a real portal and a worker
 * job is a handful of queries; long enough that a slow tick never loses it.
 */
export const DEFAULT_WORKER_LEASE_SECONDS = 60;

export interface WorkerLease {
  readonly job: WorkerJob;
  readonly leaseId: string;
  readonly holder: string;
  readonly claimedAt: Date;
  readonly expiresAt: Date;
}

export class WorkerLeaseStore {
  readonly #pool: Pool;

  public constructor(pool: Pool) {
    this.#pool = pool;
  }

  /**
   * Takes the lease on a job, or answers `null` because somebody else holds it.
   *
   * ONE statement, because two would be a race with itself: an existence check
   * followed by an insert is exactly the pattern that lets two callers both see
   * "free" and both write. `ON CONFLICT … DO UPDATE … WHERE` makes the database
   * decide, and the `WHERE` limits a takeover to a lease that has actually
   * lapsed. The same shape as `WorkLeaseStore.claim`, for the same reason.
   *
   * A worker calls this every tick. On the tick after its own claim its lease
   * has NOT lapsed, so `ON CONFLICT … WHERE expires_at <= now` alone would
   * refuse it and the worker would go idle until its own lease expired. The
   * `OR worker_leases.lease_id = $6` is what lets a holder extend its own
   * lease, and it is why `claim` takes the previous lease id. That is the whole
   * of "no renewal mechanism" (ADR-0052 §13.2): re-claiming IS the renewal.
   */
  public async claim(input: {
    readonly job: WorkerJob;
    readonly holder: string;
    readonly now: Date;
    readonly leaseSeconds?: number;
    /**
     * The lease this worker already holds for this job, if any.
     *
     * Present on every tick after the first. It is what lets a worker extend
     * its OWN lease without waiting for it to lapse, while still refusing a
     * worker that is not the holder. Absent on a cold start, where the only way
     * in is a free or lapsed lease.
     */
    readonly holding?: string;
  }): Promise<WorkerLease | null> {
    const seconds = input.leaseSeconds ?? DEFAULT_WORKER_LEASE_SECONDS;
    const expiresAt = new Date(input.now.getTime() + seconds * 1000);
    const leaseId = `wl_${randomBytes(16).toString("hex")}`;

    const rows = await this.#pool.query<{ claimed_at: Date; expires_at: Date }>(
      `INSERT INTO worker_leases (job_kind, lease_id, holder, claimed_at, expires_at)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (job_kind) DO UPDATE
              SET lease_id = EXCLUDED.lease_id,
                  holder = EXCLUDED.holder,
                  claimed_at = EXCLUDED.claimed_at,
                  expires_at = EXCLUDED.expires_at
            WHERE worker_leases.expires_at <= $4
               OR worker_leases.lease_id = $6
        RETURNING claimed_at, expires_at`,
      [input.job, leaseId, input.holder, input.now, expiresAt, input.holding ?? ""],
    );

    const row = rows.rows[0];
    if (row === undefined) return null;
    return {
      job: input.job,
      leaseId,
      holder: input.holder,
      claimedAt: row.claimed_at,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Gives a lease back before it lapses.
   *
   * Not required for correctness — a lease that is simply left alone expires on
   * its own, which is what makes crash recovery the absence of a mechanism
   * (ADR-0052 §10). It exists so an orderly shutdown does not make the next
   * worker wait a full lease period for work it could start immediately.
   *
   * Scoped by `lease_id`, so a worker that was superseded while it ran cannot
   * release the lease its successor now holds.
   */
  public async release(job: WorkerJob, leaseId: string): Promise<void> {
    await this.#pool.query("DELETE FROM worker_leases WHERE job_kind = $1 AND lease_id = $2", [
      job,
      leaseId,
    ]);
  }

  /** The live lease on a job, or `null`. An expired one is not a lease. */
  public async held(job: WorkerJob, now: Date): Promise<WorkerLease | null> {
    const rows = await this.#pool.query<{
      lease_id: string;
      holder: string;
      claimed_at: Date;
      expires_at: Date;
    }>(
      `SELECT lease_id, holder, claimed_at, expires_at
         FROM worker_leases WHERE job_kind = $1 AND expires_at > $2`,
      [job, now],
    );
    const row = rows.rows[0];
    if (row === undefined) return null;
    return {
      job,
      leaseId: row.lease_id,
      holder: row.holder,
      claimedAt: row.claimed_at,
      expiresAt: row.expires_at,
    };
  }
}
