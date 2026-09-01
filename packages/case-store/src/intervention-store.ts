/**
 * The intervention store port — who adjudicated a stuck run, and what they
 * found (ADR-0048).
 *
 * ── Why this is a third port, not a column somewhere ──────────────────────
 *
 * `WorkflowRunStore` answers *where has this run got to* and, through the
 * intent ledger, *did this action happen*. Neither can say *who decided, on
 * what evidence, and does the fix generalise* — and ADR-0008's learning loop
 * needs all three. Putting the adjudication on the run record would put a
 * specialist's prose in a table whose whole justification is that it holds no
 * business facts, only position.
 *
 * ── The rule that keeps the ports honest ──────────────────────────────────
 *
 * **A resolution recorded here never says whether the action happened.**
 * Completing the intent says that, in `workflow_action_intents`, and that is
 * the only place that says it. The two cannot disagree because they answer
 * different questions — which is what stops this becoming the second source of
 * truth ADR-0041 forbids.
 *
 * And there is no position on any type in this file. Where a run resumes is
 * derived from the intent ledger (ADR-0047); a stored cursor is one refactor
 * from being honoured. Vahid rejected storing one, 2026-09-01.
 */

import type {
  CaseId,
  InterventionContext,
  InterventionId,
  InterventionLifecycle,
  RecoveryEscalation,
  RecoveryResolution,
  ReusabilityAssessment,
  RunId,
} from "@askimate/aas-domain";
import type { ActionIntent } from "@askimate/aas-domain";

/** Raised when a resolution names an intervention that does not exist. */
export class InterventionNotFoundError extends Error {
  public override readonly name = "InterventionNotFoundError";
  public constructor(public readonly interventionId: InterventionId) {
    super(`No intervention ${interventionId}.`);
  }
}

/**
 * Raised when an intervention already carries a resolution.
 *
 * NOT an "already done, carry on" — a second resolution is a second person's
 * adjudication of a question the first one answered, and silently discarding it
 * would lose the disagreement. The caller decides what to do about it.
 */
export class InterventionAlreadyResolvedError extends Error {
  public override readonly name = "InterventionAlreadyResolvedError";
  public constructor(
    public readonly interventionId: InterventionId,
    public readonly resolvedBy: string,
    public readonly resolvedAt: Date,
  ) {
    super(
      `Intervention ${interventionId} was already resolved by ${resolvedBy} at ` +
        `${resolvedAt.toISOString()}. Resolving it again would replace one specialist's ` +
        `adjudication with another's without recording that they disagreed.`,
    );
  }
}

/**
 * Raised for an outcome the system does not implement.
 *
 * `route_fallback` is the only member: ADR-0048 §4 rejects it explicitly rather
 * than implementing it partly, because a half-honoured route change is worse
 * than a refusal. A future route change needs its own ADR.
 */
export class ResolutionOutcomeNotImplementedError extends Error {
  public override readonly name = "ResolutionOutcomeNotImplementedError";
  public constructor(public readonly outcome: string) {
    super(
      `Resolution outcome "${outcome}" is not implemented. ADR-0048 rejects it explicitly rather ` +
        `than partially: switching route mid-case needs its own decision and its own machinery. ` +
        `Use "abandon" if the application cannot proceed, or resolve the blocker and use "resume".`,
    );
  }
}

/** One intervention as stored, resolved or not. */
export interface StoredIntervention {
  readonly interventionId: InterventionId;
  readonly runId: RunId;
  /** The intent this adjudicates. */
  readonly idempotencyKey: ActionIntent["idempotencyKey"];
  readonly caseId: CaseId;
  readonly studentRef: string;
  readonly escalation: RecoveryEscalation;
  readonly context: InterventionContext;
  readonly lifecycle: InterventionLifecycle;
  /** When the student was told. Absent means they have not been. */
  readonly announcedAt?: Date;
  /** Absent while it is open. */
  readonly resolution?: RecoveryResolution;
  readonly reusability?: ReusabilityAssessment;
}

/** What raising an intervention did. */
export interface RaisedIntervention {
  readonly interventionId: InterventionId;
  /**
   * `false` when one was already open for this action.
   *
   * The caller needs this: it is the difference between "tell the student" and
   * "the student was already told", and it is what makes raising the same stuck
   * action twice a no-op rather than a second case in the queue.
   */
  readonly created: boolean;
}

export interface RaiseInput {
  readonly interventionId: InterventionId;
  readonly runId: RunId;
  readonly idempotencyKey: ActionIntent["idempotencyKey"];
  readonly caseId: CaseId;
  readonly studentRef: string;
  readonly escalation: RecoveryEscalation;
  readonly context: InterventionContext;
}

export interface ResolveInput {
  readonly interventionId: InterventionId;
  readonly resolution: RecoveryResolution;
  readonly reusability: ReusabilityAssessment;
}

/**
 * Persistence for interventions.
 *
 * Note what is absent: no `delete`, and no way to replace a resolution once
 * written. An adjudication that could be edited away is not an audit trail.
 */
export interface InterventionStore {
  /**
   * Records that a run stopped and needs a specialist.
   *
   * **Idempotent per (runId, idempotencyKey).** A second raise for the same
   * stuck action returns the existing intervention with `created: false` — a
   * run polled repeatedly must not fill the queue with copies of one problem.
   */
  raise(input: RaiseInput): Promise<RaisedIntervention>;

  /** Every unresolved intervention, oldest first. */
  open(): Promise<readonly StoredIntervention[]>;

  find(interventionId: InterventionId): Promise<StoredIntervention | null>;

  /** The open intervention for one stuck action, if there is one. */
  findForAction(
    runId: RunId,
    idempotencyKey: ActionIntent["idempotencyKey"],
  ): Promise<StoredIntervention | null>;

  /** Marks the student as having been told, once. */
  markAnnounced(interventionId: InterventionId, now: Date): Promise<void>;

  /**
   * Records the adjudication.
   *
   * Throws `InterventionAlreadyResolvedError` rather than overwriting, and
   * `ResolutionOutcomeNotImplementedError` for `route_fallback`.
   */
  resolve(input: ResolveInput): Promise<StoredIntervention>;
}
