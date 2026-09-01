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

import type { ConsequentialAction } from "./workflow.js";
import type { BlueprintVersion } from "./ids.js";

// ───────────────────────────────────────────────────────────────────────────
// Where the AI got to
// ───────────────────────────────────────────────────────────────────────────

/**
 * Where in the application flow the AI had reached.
 *
 * ── DIAGNOSTIC, never executable (ADR-0048 §5) ───────────────────────────
 *
 * This is what a specialist reads to know where to look. It is **not** read by
 * the code that decides what runs next: the run's position is derived from the
 * intent ledger (ADR-0047), and a second position that something might honour
 * is exactly the duplicate source of truth ADR-0041 forbids.
 * `interventions.test.ts` asserts that absence by enumeration.
 *
 * ── Refined 2026-09-01, and why ──────────────────────────────────────────
 *
 * Written in an early phase as pure modelling, before the execution vocabulary
 * existed, this asked for a `section` and a zero-based `step` that nothing in
 * this system knows. Filling them with placeholders would be inventing a
 * position — which is the thing this repository refuses to do with a student's
 * data and should not do with its own. The fields below are the ones a stop can
 * state truthfully.
 */
export interface ExecutionCheckpoint {
  readonly blueprintVersion: BlueprintVersion;
  /** The consequential action that was in flight, e.g. `create_portal_account`. */
  readonly action: ConsequentialAction;
  /** What it acted on: a portal host, a page reference. Never a value. */
  readonly target: string;
  /** The blueprint page the run was on, when the stop was on a page. */
  readonly page?: string;
  /** The run's phase at the stop, e.g. `filling`. */
  readonly phase: string;
  /**
   * Pages already completed and accepted by the portal.
   *
   * Everything already done stays available (ADR-0008), so a specialist can see
   * what is done rather than re-deriving it.
   */
  readonly pagesCompleted: readonly string[];
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
  | "information_unobtainable"
  /**
   * A consequential action was started and never recorded as finished.
   *
   * Added 2026-09-01 with P10, because none of the reasons above says it. The
   * others describe something the portal did; this one describes something
   * nobody knows — the uncertainty window of `assessIntent`, where an intent
   * exists with no completion and the process cannot tell a crash before the
   * action from a crash after it. It is the reason a run stops rather than
   * retrying, so it needs its own word.
   */
  | "unverified_consequential_action";

/** Resolution outcomes as a closed set, so a wire parser cannot invent one. */
export const RESOLUTION_OUTCOMES = ["resume", "route_fallback", "abandon"] as const;
export type ResolutionOutcome = (typeof RESOLUTION_OUTCOMES)[number];

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
  "unverified_consequential_action",
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
 * ── There is deliberately no position on this record (ADR-0048 §5) ────────
 *
 * An earlier draft carried `resumeFrom: ExecutionCheckpoint`, stored but never
 * read. Vahid rejected it, 2026-09-01: *"I do not approve storing an executable
 * field that the system deliberately ignores."* He is right — a typed
 * checkpoint on a resolution is indistinguishable, to anyone reading later,
 * from a cursor something honours; the comment saying otherwise is one refactor
 * from being wrong, and the field is one `??` from being load-bearing.
 *
 * Where a specialist advanced the application by hand, that is recorded by
 * completing the corresponding page intents — the same fact, in the one place
 * that already means it and that the resume logic already reads.
 */
export interface RecoveryResolution {
  /**
   * The named individual who resolved it. Never a shared account.
   *
   * ── ASSERTED, not authenticated — and only while one operator exists ────
   *
   * P10 admits a resolution through the internal service credential
   * (ADR-0048 §3), so this records who *claimed* to resolve it. Vahid approved
   * that for the current single-operator model and named what ends it:
   *
   *   *"The moment we introduce multiple specialists, authenticated individual
   *   identity becomes a required architectural capability, not a deferred
   *   cosmetic improvement."*
   *
   * The condition is a second specialist existing at all — not a date. Until
   * then every guarantee resting on this field is a fact because only one
   * person can write it; after then it is a claim, which is why authenticating
   * it is a release blocker rather than a nice-to-have.
   */
  readonly specialistId: string;
  /** What the specialist actually did. */
  readonly actionsTaken: string;
  /** What worked, phrased so it could be applied again. */
  readonly resolution: string;
  readonly resolvedAt: Date;
  /**
   * The specialist's judgement on whether the automated route can continue.
   *
   *   resume        — unblocked; the run carries on from the position its
   *                   intent ledger implies (ADR-0047), not from anything on
   *                   this record
   *   route_fallback — this route cannot work for this case; switch route
   *   abandon       — the application cannot proceed at all
   *
   * `route_fallback` is the last resort (ADR-0008), not the default.
   */
  readonly outcome: ResolutionOutcome;
}

// ───────────────────────────────────────────────────────────────────────────
// A resolution holds no position — enforced by the compiler (ADR-0048 §5)
// ───────────────────────────────────────────────────────────────────────────

/**
 * A CONSTRAINT, not a computation.
 *
 * `AssertNever<T extends never>` fails to compile the moment `T` is inhabited.
 * Here `T` is every field of a resolution that is object-shaped — which is what
 * a position would have to be. Adding `resumeFrom`, or any other checkpoint,
 * cursor or "where to pick up" record to `RecoveryResolution` makes this line
 * red, with the reason in its name.
 *
 * Written as a type rather than a runtime test on purpose: a runtime test can
 * only inspect a value someone constructed, and the field would already be in
 * the type by then. This catches it at the point it is added.
 */
type AssertNever<T extends never> = T;
export type A_RESOLUTION_CARRIES_NO_POSITION = AssertNever<
  Extract<RecoveryResolution[keyof RecoveryResolution], ExecutionCheckpoint>
>;

/** Default priority for a reason. Centralised so alerting cannot drift. */
export function priorityFor(reason: RecoveryReason): EscalationPriority {
  // Authentication failure blocks everything downstream and often has a
  // time-limited session behind it, so it goes straight to critical.
  //
  // An unverified consequential action is critical for a different reason: the
  // ambiguity COMPOUNDS. Every hour it sits, the portal's own state is more
  // likely to have been changed by someone else, and the question "did we
  // create this account?" gets harder to answer rather than easier. It is also
  // the one class where guessing wrong writes a duplicate into a real
  // admissions system with a real person's name on it.
  return reason === "authentication_failure" || reason === "unverified_consequential_action"
    ? "critical"
    : "high";
}
