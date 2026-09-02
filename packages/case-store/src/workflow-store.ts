/**
 * The workflow run store port — operational state, kept apart from business
 * truth.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27, approving a SEPARATE port: *"Creating a separate
 * WorkflowRunStore port rather than extending or weakening CaseStore."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is not part of `CaseStore` ───────────────────────────────────
 *
 * `CaseStore` is deliberately append-only:
 *
 *   *"There is deliberately no `update`, no `delete`, and no way to rewrite
 *   history. The only mutation is `append`."*
 *
 * A checkpoint is the opposite by nature: mutable, overwritten continuously,
 * and **disposable**. Forcing one into the case log would mean either making
 * every checkpoint a domain event — which puts transient execution detail into
 * the business record — or adding an update path to an append-only log, which
 * would destroy the guarantee `contract.ts` exists to protect.
 *
 * So there are two ports. They share a database, a migration mechanism and a
 * contract-suite discipline, and they share nothing else.
 *
 * ── The rule that keeps them apart, stated as a testable property ─────────
 *
 * **Deleting every checkpoint in this store must lose no business fact — only
 * the efficiency of not having to re-derive position.** If deleting a
 * checkpoint loses something a person would need, that something was a
 * business fact and belonged in the event log. `contract.ts` tests exactly
 * this, and it is the assertion that keeps the separation honest over time.
 */

import type {
  ActionIntent,
  CaseId,
  IntentOutcome,
  RunId,
  WorkflowCheckpoint,
  WorkflowRunRecord,
  WorkflowStatus,
} from "@askimate/aas-domain";

/** Raised when a run id is already taken. Runs are created once. */
export class RunAlreadyExistsError extends Error {
  public override readonly name = "RunAlreadyExistsError";
  public constructor(public readonly runId: RunId) {
    super(
      `Run ${runId} already exists. A run is one attempt to execute a case and is created once; ` +
        `resuming an existing run uses load(), and a fresh attempt needs a fresh runId.`,
    );
  }
}

export class RunNotFoundError extends Error {
  public override readonly name = "RunNotFoundError";
  public constructor(public readonly runId: RunId) {
    super(`No run ${runId}.`);
  }
}

/**
 * Raised when a concurrent writer already advanced the run.
 *
 * The same shape as `ConcurrencyConflictError` on the case store, and for the
 * same reason: two processes resuming one run must not both win. The caller
 * should re-load and decide again, never simply retry the save — the
 * checkpoint it holds describes a position that is no longer current.
 */
export class RunConcurrencyError extends Error {
  public override readonly name = "RunConcurrencyError";
  public constructor(
    public readonly runId: RunId,
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(
      `Concurrent modification of run ${runId}: expected revision ${expectedRevision}, store is ` +
        `at ${actualRevision}. Another process is resuming this run. Re-load and decide again.`,
    );
  }
}

/** Raised when a status move the domain forbids is attempted. */
export class RunStatusError extends Error {
  public override readonly name = "RunStatusError";
  public constructor(
    public readonly runId: RunId,
    public readonly from: WorkflowStatus,
    public readonly to: WorkflowStatus,
  ) {
    super(
      `Run ${runId} cannot go from ${from} to ${to}. In particular an uncertain run cannot become ` +
        `completed: "we do not know whether it happened" cannot become "it worked" without ` +
        `verification or a human.`,
    );
  }
}

/** What was found about an action after a restart. */
export interface IntentRecord {
  readonly intent: ActionIntent;
  /** Absent means started and never recorded as finished — the uncertain case. */
  readonly completed?: { readonly outcome: IntentOutcome; readonly completedAt: Date };
}

/**
 * Persistence for workflow runs.
 *
 * Note what is absent: no `deleteRun`, and no way to edit an `ActionIntent`
 * once written. An intent record whose completion could be forged, or a run
 * that could be deleted to make an awkward uncertainty disappear, would defeat
 * the point of writing it down.
 *
 * `discardCheckpoints` exists and is deliberately the ONLY destructive
 * operation — see the contract suite, which uses it to prove that losing every
 * checkpoint loses no business fact.
 */
export interface WorkflowRunStore {
  /** Creates a run. Fails if the id is taken. */
  start(run: Omit<WorkflowRunRecord, "revision" | "updatedAt">): Promise<WorkflowRunRecord>;

  /** Reads a run, or null. A checkpoint this build cannot read comes back reset. */
  load(runId: RunId): Promise<WorkflowRunRecord | null>;

  /**
   * Saves a checkpoint and, optionally, a status change.
   *
   * `expectedRevision` is optimistic concurrency, exactly as
   * `CaseStore.append`'s `expectedSequence` is. Returns the new revision.
   */
  saveCheckpoint(input: {
    readonly runId: RunId;
    readonly checkpoint: WorkflowCheckpoint;
    readonly expectedRevision: number;
    readonly status?: WorkflowStatus;
  }): Promise<number>;

  /** Records that a consequential action is ABOUT to happen. */
  recordIntent(runId: RunId, intent: ActionIntent): Promise<void>;

  /**
   * Re-opens a CLEANLY FAILED intent for a fresh attempt.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * ADR-0054. The ledger holds ONE row per (run, action, target) — its
   * primary key, and what `interventions.idempotency_key` pairs with — so a
   * second attempt at a target cannot be a second row. Since ADR-0054 the row
   * is written BEFORE the action, which means a retry needs the row to say
   * "in flight" again rather than to keep describing the attempt before it.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * **Only `failed_cleanly`, and that restriction is the safety property.**
   * ADR-0047 already decided what happens to each verdict: `already_done` +
   * `failed_cleanly` means *"nothing happened out there"* and the work is
   * offered again. `succeeded` is skipped and must NEVER be re-opened — doing
   * so would hand out an action that has already reached a real portal, which
   * is the duplicate account this whole mechanism exists to prevent. An
   * unfinished intent must not be re-opened either: that is the uncertainty
   * window, and it belongs to a specialist.
   *
   * Answers `false` when the intent is missing or is in any other state, so a
   * caller learns it may not proceed rather than discovering it did.
   */
  reopenIntent(
    runId: RunId,
    idempotencyKey: ActionIntent["idempotencyKey"],
    startedAt: Date,
  ): Promise<boolean>;

  /** Records that it finished. Idempotent for the same outcome. */
  completeIntent(
    runId: RunId,
    idempotencyKey: ActionIntent["idempotencyKey"],
    outcome: IntentOutcome,
    now: Date,
  ): Promise<void>;

  /** What is known about one action. `null` when it was never started. */
  findIntent(
    runId: RunId,
    idempotencyKey: ActionIntent["idempotencyKey"],
  ): Promise<IntentRecord | null>;

  /** Every run for a case, newest first. A case may be attempted more than once. */
  findByCase(caseId: CaseId): Promise<readonly WorkflowRunRecord[]>;

  /**
   * Throws away every checkpoint for a run, resetting it to its start.
   *
   * **This must never lose a business fact.** It exists so the contract suite
   * can prove that, and so a run whose checkpoint is unreadable or
   * contradicted by the event log can be made to re-derive its position rather
   * than trust a bad one.
   */
  discardCheckpoints(runId: RunId): Promise<void>;
}
