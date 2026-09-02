/**
 * Who is holding a run's browser work, and until when.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0045. The Automation Runner pulls work; this is the state that makes
 * "one run, one runner" true, and it is true because of the table's PRIMARY
 * KEY rather than because of anything written here.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Three races, and how each resolves ────────────────────────────────────
 *
 *   two runners claim the same UNLEASED run
 *       both INSERT; one gets 23505 and reads it as "somebody else has it".
 *
 *   two runners take over the same EXPIRED lease
 *       both UPDATE with `expires_at <= $now` in the WHERE; one updates a row,
 *       the other updates none and moves on to the next candidate.
 *
 *   a superseded runner reports work it no longer holds
 *       the DELETE carries the lease id; it matches nothing, and the report is
 *       refused. This is why the lease id is regenerated on every takeover: a
 *       runner that was slow, not dead, must not be able to close out work the
 *       new holder is in the middle of.
 *
 * ── Why there is no `release` that does not check the id ──────────────────
 *
 * Because the only reason to want one is to clean up after a runner that has
 * gone, and that is what expiry is for. A release that trusted the caller would
 * be a way for any holder of a service certificate to hand a student's live run
 * to somebody else mid-action.
 */

import type pg from "pg";

import type { WorkKind } from "@askimate/aas-contracts";

export interface WorkLease {
  readonly runId: string;
  readonly leaseId: string;
  readonly kind: WorkKind;
  readonly holder: string;
  /**
   * Which page this lease is for, when the work is a fill. ADR-0047.
   *
   * The lease says which page a runner is HOLDING; `workflow_action_intents`
   * says which pages are DONE. They answer different questions, and this one
   * exists so a report — which arrives with a lease id and nothing else — keys
   * the right intent without re-deriving the plan.
   */
  readonly pageRef?: string;
  /**
   * The CONTENT version of that page, when the work is a fill (ADR-0051 §6).
   *
   * Beside the page rather than folded into it: `pageRef` means "which page",
   * and the intent's target is rebuilt from the pair. 0007 already gave the
   * reason it cannot be re-derived at report time, and named this case — "a
   * plan that had changed in between — a corrected answer …".
   */
  readonly pageVersion?: string;
  readonly claimedAt: Date;
  readonly expiresAt: Date;
}

/** A run that might have browser work, before the orchestrator has been asked. */
export interface WorkCandidate {
  readonly runId: string;
  readonly caseId: string;
  readonly studentRef: string;
}

export class WorkLeaseStore {
  readonly #pool: pg.Pool;

  public constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  /**
   * Runs whose durable checkpoint says they may need a browser.
   *
   * CANDIDATES, not work. The phase narrows the set cheaply — deriving
   * `nextStep` for every run in the database would mean loading a blueprint, a
   * mapping set and a profile per row — and then the orchestrator decides, which
   * is the only place that decision is ever made (ADR-0041).
   *
   * A run already leased by a live holder is excluded here rather than filtered
   * by the caller, so a busy pool does not make the claim path walk the same
   * held runs on every poll.
   */
  public async candidates(input: {
    readonly phases: readonly string[];
    readonly now: Date;
    readonly limit: number;
  }): Promise<readonly WorkCandidate[]> {
    const rows = await this.#pool.query<{
      run_id: string;
      case_id: string;
      student_ref: string;
    }>(
      `SELECT r.run_id, r.case_id, r.student_ref
         FROM workflow_runs r
         LEFT JOIN work_leases l
           ON l.run_id = r.run_id AND l.expires_at > $2
        WHERE r.status IN ('running', 'suspended')
          AND r.checkpoint ->> 'phase' = ANY($1::text[])
          AND l.run_id IS NULL
        ORDER BY r.updated_at ASC
        LIMIT $3`,
      [input.phases, input.now, input.limit],
    );
    return rows.rows.map((row) => ({
      runId: row.run_id,
      caseId: row.case_id,
      studentRef: row.student_ref,
    }));
  }

  /**
   * The runs the Background Worker should advance, oldest first (ADR-0052 §6).
   *
   * The sibling of `candidates`, and deliberately beside it: both answer "which
   * runs are live and unheld", and two implementations of that question in
   * different files would be free to drift. The differences are exactly two —
   * this one does not filter by phase, because the worker advances a case
   * wherever it is rather than looking for browser work, and it returns the
   * conversation because `advance` is keyed on the pair.
   *
   * `running` and `suspended` only. `uncertain` and `escalated` are waiting for
   * a person by design; `completed` and `abandoned` are terminal.
   *
   * A run leased to a runner is excluded: the runner is mid-operation against a
   * real portal, and deciding underneath it would decide from a position that
   * is about to change.
   *
   * `ORDER BY updated_at ASC` for the reason `candidates` uses it, and it is
   * also what keeps the batch fair: an advance that changes anything writes a
   * checkpoint, `saveCheckpoint` sets `updated_at`, and the run rotates to the
   * back by construction (ADR-0052 §13.4).
   */
  public async dueForWorker(input: {
    readonly now: Date;
    readonly limit: number;
  }): Promise<readonly { readonly runId: string; readonly conversationId: string }[]> {
    const rows = await this.#pool.query<{ run_id: string; conversation_id: string }>(
      `SELECT r.run_id, c.id AS conversation_id
         FROM workflow_runs r
         JOIN conversations c ON c.case_id = r.case_id
         LEFT JOIN work_leases l
           ON l.run_id = r.run_id AND l.expires_at > $1
        WHERE r.status IN ('running', 'suspended')
          AND l.run_id IS NULL
        ORDER BY r.updated_at ASC
        LIMIT $2`,
      [input.now, input.limit],
    );
    return rows.rows.map((row) => ({ runId: row.run_id, conversationId: row.conversation_id }));
  }

  /**
   * Takes the lease on a run, or answers `null` because somebody else holds it.
   *
   * One statement, because two would be a race with itself: an existence check
   * followed by an insert is exactly the pattern that lets two callers both see
   * "free" and both write. `ON CONFLICT … DO UPDATE … WHERE` makes the
   * database decide, and the `WHERE` is what limits a takeover to a lease that
   * has actually lapsed.
   */
  public async claim(input: {
    readonly runId: string;
    readonly leaseId: string;
    readonly kind: WorkKind;
    readonly holder: string;
    readonly pageRef?: string;
    readonly pageVersion?: string;
    readonly now: Date;
    readonly leaseSeconds: number;
  }): Promise<WorkLease | null> {
    const expiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1000);
    const rows = await this.#pool.query<{ claimed_at: Date; expires_at: Date }>(
      `INSERT INTO work_leases (run_id, lease_id, kind, holder, claimed_at, expires_at, page_ref,
                                page_version)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (run_id) DO UPDATE
              SET lease_id = EXCLUDED.lease_id,
                  kind = EXCLUDED.kind,
                  holder = EXCLUDED.holder,
                  claimed_at = EXCLUDED.claimed_at,
                  expires_at = EXCLUDED.expires_at,
                  page_ref = EXCLUDED.page_ref,
                  page_version = EXCLUDED.page_version
            WHERE work_leases.expires_at <= $5
        RETURNING claimed_at, expires_at`,
      [
        input.runId,
        input.leaseId,
        input.kind,
        input.holder,
        input.now,
        expiresAt,
        input.pageRef ?? null,
        input.pageVersion ?? null,
      ],
    );
    const row = rows.rows[0];
    if (row === undefined) return null;
    return {
      runId: input.runId,
      leaseId: input.leaseId,
      kind: input.kind,
      holder: input.holder,
      ...(input.pageRef === undefined ? {} : { pageRef: input.pageRef }),
      claimedAt: row.claimed_at,
      expiresAt: row.expires_at,
    };
  }

  /** The live lease on a run, or `null`. An expired one is not a lease. */
  public async held(runId: string, now: Date): Promise<WorkLease | null> {
    const rows = await this.#pool.query<{
      lease_id: string;
      kind: string;
      holder: string;
      page_ref: string | null;
      page_version: string | null;
      claimed_at: Date;
      expires_at: Date;
    }>(
      `SELECT lease_id, kind, holder, page_ref, page_version, claimed_at, expires_at
         FROM work_leases WHERE run_id = $1 AND expires_at > $2`,
      [runId, now],
    );
    const row = rows.rows[0];
    if (row === undefined) return null;
    return {
      runId,
      leaseId: row.lease_id,
      kind: row.kind as WorkKind,
      holder: row.holder,
      ...(row.page_ref === null ? {} : { pageRef: row.page_ref }),
      ...(row.page_version === null ? {} : { pageVersion: row.page_version }),
      claimedAt: row.claimed_at,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Gives the lease back, if the caller is the one holding it.
   *
   * `true` means this caller held the lease and it is now gone. `false` means
   * they did not — expired and taken over, or already reported — and their
   * report must be refused rather than applied to a run somebody else is
   * currently working.
   */
  public async release(input: {
    readonly runId: string;
    readonly leaseId: string;
    readonly now: Date;
  }): Promise<boolean> {
    const result = await this.#pool.query(
      "DELETE FROM work_leases WHERE run_id = $1 AND lease_id = $2 AND expires_at > $3",
      [input.runId, input.leaseId, input.now],
    );
    return result.rowCount === 1;
  }
}
