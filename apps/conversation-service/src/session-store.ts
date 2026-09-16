/**
 * What the plane knows about a run's signed-in browser session — ADR-0101 §2
 * and §3 (P72).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The runner holds the session, in memory, for one sitting; this holds a
 * NAME and an INSTANT. From each runner report that could only have come from
 * a signed-in browser — an account created, a sign-in done, a page saved —
 * the plane records who and until when: the report's time plus the one
 * ceiling the runner also sweeps by. "No runner holds a session" is then a
 * question this table answers, and it is the condition for the one second
 * ask a student ever gets (§3).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * No cookie, no token, no credential: nothing here can sign in. Migration 0019.
 */

import type pg from "pg";

import { SECURE_HOLD_CEILING_SECONDS } from "@askimate/aas-contracts";

export class RunSessionStore {
  readonly #pool: pg.Pool;

  public constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  /**
   * A runner has just reported from a signed-in session. The record is
   * replaced, not extended: the holder may be a different runner after a
   * sign-in, and the instant counts from this report.
   */
  public async record(input: {
    readonly runId: string;
    readonly holder: string;
    readonly now: Date;
  }): Promise<void> {
    const heldUntil = new Date(input.now.getTime() + SECURE_HOLD_CEILING_SECONDS * 1000);
    await this.#pool.query(
      `INSERT INTO run_sessions (run_id, holder, held_until, recorded_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (run_id) DO UPDATE
         SET holder = EXCLUDED.holder,
             held_until = EXCLUDED.held_until,
             recorded_at = EXCLUDED.recorded_at`,
      [input.runId, input.holder, heldUntil, input.now],
    );
    // A live session ends the count (ADR-0120): a later loss is a new episode
    // of two, not the third attempt of an old one.
    await this.#pool.query("DELETE FROM run_sign_in_failures WHERE run_id = $1", [input.runId]);
  }

  /**
   * A sign-in the runner reported as not done (ADR-0120). Counts an attempt
   * only when one was made — a hand-out the runner could not use reached no
   * portal (ADR-0114's rule) — and names the handle the report was handed, so
   * it is offered to nobody whatever the Secure Plane's outbox has delivered.
   */
  public async signInFailed(input: {
    readonly runId: string;
    readonly attempted: boolean;
    readonly failure: string | null;
    readonly spentSecretRequestId: string | null;
    readonly now: Date;
  }): Promise<void> {
    await this.#pool.query(
      `INSERT INTO run_sign_in_failures (run_id, attempts, spent_secret_request_id, last_failure, failed_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (run_id) DO UPDATE
         SET attempts = run_sign_in_failures.attempts + EXCLUDED.attempts,
             spent_secret_request_id = EXCLUDED.spent_secret_request_id,
             last_failure = EXCLUDED.last_failure,
             failed_at = EXCLUDED.failed_at`,
      [input.runId, input.attempted ? 1 : 0, input.spentSecretRequestId, input.failure, input.now],
    );
  }

  /** The run's sign-in failures since its last live session, or `null` when there are none. */
  public async signInFailure(runId: string): Promise<{
    readonly attempts: number;
    readonly spentSecretRequestId?: string;
    readonly failure: string | null;
  } | null> {
    const rows = await this.#pool.query<{
      attempts: number;
      spent_secret_request_id: string | null;
      last_failure: string | null;
    }>("SELECT attempts, spent_secret_request_id, last_failure FROM run_sign_in_failures WHERE run_id = $1", [runId]);
    const row = rows.rows[0];
    if (row === undefined) return null;
    return {
      attempts: row.attempts,
      ...(row.spent_secret_request_id === null ? {} : { spentSecretRequestId: row.spent_secret_request_id }),
      failure: row.last_failure,
    };
  }

  /** The runner said the session is gone — bounced to a login page, or let go. */
  public async lost(runId: string): Promise<void> {
    await this.#pool.query("DELETE FROM run_sessions WHERE run_id = $1", [runId]);
  }

  /**
   * Whether a signed-in session can still exist for this run at `now`.
   *
   * `true` only inside the ceiling of the last report. A record past it is as
   * good as none: the runner has swept the context by the same number, and
   * the answer must not depend on a sweep having run.
   */
  public async signedIn(runId: string, now: Date): Promise<boolean> {
    const rows = await this.#pool.query(
      "SELECT 1 FROM run_sessions WHERE run_id = $1 AND held_until > $2",
      [runId, now],
    );
    return rows.rowCount === 1;
  }

  /** The holder on record, for a test and an operator; `null` past the ceiling. */
  public async holderOf(runId: string, now: Date): Promise<string | null> {
    const rows = await this.#pool.query<{ holder: string }>(
      "SELECT holder FROM run_sessions WHERE run_id = $1 AND held_until > $2",
      [runId, now],
    );
    return rows.rows[0]?.holder ?? null;
  }
}
