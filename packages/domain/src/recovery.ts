/**
 * Recovery escalation (ADR-0008).
 *
 * When the AI cannot safely proceed, the case does NOT fail and does NOT unwind.
 * It pauses at the exact point of failure, raises a high-priority escalation,
 * and waits for a specialist to unblock it — after which it resumes from where
 * it stopped.
 *
 * The specialist is a recovery layer, not the primary operator. Their job is to
 * resolve the specific blocker, not to take over the application.
 *
 * This file is pure domain modelling. The alerting transport and the specialist
 * console are Phases 3–7; what is here is the shape they must fit.
 */

import type { BlueprintVersion } from "./ids.js";

// ───────────────────────────────────────────────────────────────────────────
// Where the AI got to
// ───────────────────────────────────────────────────────────────────────────

/**
 * Where in the application flow the AI had reached.
 *
 * This is what makes "the specialist should not need to restart the entire
 * application" a property of the system rather than an aspiration. Without it,
 * "resume" has nowhere to resume to.
 */
export interface ExecutionCheckpoint {
  readonly blueprintVersion: BlueprintVersion;
  /** The blueprint page the AI was on, e.g. `personal-details`. */
  readonly page: string;
  /** The section within that page, e.g. `previous-education`. */
  readonly section: string;
  /** Zero-based step within the section. */
  readonly step: number;
  /**
   * Sections already completed and accepted by the portal.
   *
   * Everything the AI had already done stays available (ADR-0008), so a
   * specialist can see what is done rather than re-deriving it.
   */
  readonly completedSections: readonly string[];
  readonly capturedAt: Date;
}

// ───────────────────────────────────────────────────────────────────────────
// Why the AI stopped
// ───────────────────────────────────────────────────────────────────────────

/**
 * What the AI hit that it could not safely resolve.
 *
 * The first six are Vahid's own list, kept in his words so the mapping between
 * the product decision and the code stays obvious.
 */
export type RecoveryReason =
  /** A field the blueprint did not describe. */
  | "unexpected_field"
  /** The page is laid out differently from the blueprint. */
  | "page_structure_changed"
  /** The portal rejected input for a reason the AI does not recognise. */
  | "unfamiliar_validation_error"
  /** The portal did something the blueprint does not account for. */
  | "new_portal_behaviour"
  /** More than one canonical field could plausibly map to a portal field. */
  | "ambiguous_mapping"
  /** Execution diverged from the blueprint's expected flow. */
  | "workflow_deviation"
  /** Could not authenticate, and it is not a handoff the student can complete. */
  | "authentication_failure"
  /** Retries are exhausted and the portal is still not responding usefully. */
  | "timeout_exhausted"
  /** The agent interviewed the student and still cannot obtain what is required. */
  | "information_unobtainable";

export const RECOVERY_REASONS = [
  "unexpected_field",
  "page_structure_changed",
  "unfamiliar_validation_error",
  "new_portal_behaviour",
  "ambiguous_mapping",
  "workflow_deviation",
  "authentication_failure",
  "timeout_exhausted",
  "information_unobtainable",
] as const satisfies readonly RecoveryReason[];

/**
 * How urgently a specialist must be alerted.
 *
 * Recovery escalations are `high` by default: a paused application is
 * consuming a deadline, and university deadlines do not move. `critical` is
 * for a case whose deadline is imminent.
 *
 * Deliberately NOT a free-text field — alerting routes off this, and a routing
 * decision made from free text is a routing decision waiting to fail.
 */
export type EscalationPriority = "high" | "critical";

/**
 * A raised, unresolved recovery escalation.
 *
 * Carries what the AI encountered AND what it expected. Both are needed: the
 * gap between them is the thing the specialist has to close, and it is also the
 * raw material for the learning loop.
 */
export interface RecoveryEscalation {
  readonly reason: RecoveryReason;
  readonly priority: EscalationPriority;
  /** What the AI actually met, in terms a specialist can act on. */
  readonly encountered: string;
  /** What the blueprint led it to expect. */
  readonly expected: string;
  /** Exactly where it stopped, so work is not lost. */
  readonly checkpoint: ExecutionCheckpoint;
  readonly raisedAt: Date;
}

/**
 * How a specialist resolved it.
 *
 * `resumeFrom` is normally the original checkpoint. It differs when the
 * specialist advanced the application manually while unblocking it — in which
 * case the case resumes from further on, not from where it broke.
 */
export interface RecoveryResolution {
  /** The named individual who resolved it. Never a shared account. */
  readonly specialistId: string;
  /** What the specialist actually did. */
  readonly actionsTaken: string;
  /** What worked, phrased so it could be applied again. */
  readonly resolution: string;
  readonly resolvedAt: Date;
  readonly resumeFrom: ExecutionCheckpoint;
  /**
   * The specialist's judgement on whether the automated route can continue.
   *
   *   resume        — unblocked; the AI carries on from `resumeFrom`
   *   route_fallback — this route cannot work for this case; switch route
   *   abandon       — the application cannot proceed at all
   *
   * `route_fallback` is the last resort (ADR-0008), not the default.
   */
  readonly outcome: "resume" | "route_fallback" | "abandon";
}

/** Default priority for a reason. Centralised so alerting cannot drift. */
export function priorityFor(reason: RecoveryReason): EscalationPriority {
  // Authentication failure blocks everything downstream and often has a
  // time-limited session behind it, so it goes straight to critical.
  return reason === "authentication_failure" ? "critical" : "high";
}
