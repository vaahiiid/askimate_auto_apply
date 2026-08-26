/**
 * Case states.
 *
 * Approved by Vahid on 2026-08-26 as the current version, explicitly not
 * immutable: if implementation reveals a genuine need to change the model, the
 * change is documented and brought back for approval before being made.
 *
 * The state of a case is *derived* from its append-only event log, never
 * written directly. See `machine.ts`.
 */

/** Every state a case can be in. */
export const CASE_STATES = [
  // ── Preparation ──────────────────────────────────────────────────────────
  /** Case opened from an explicit student request. Nothing gathered yet. */
  "INTAKE",
  /** Waiting on the student for one or more canonical profile fields. */
  "PROFILE_INCOMPLETE",
  /** Waiting on the student for one or more required documents. */
  "DOCUMENTS_PENDING",
  /** Resolving what this institution/course actually requires. */
  "REQUIREMENTS_RESOLUTION",
  /** Checking the student against those requirements, with reasoning recorded. */
  "ELIGIBILITY_REVIEW",
  /** No blueprint exists for this target and route; discovery must run first. */
  "BLUEPRINT_REQUIRED",
  /** Everything needed is present and confirmed. Ready to fill. */
  "READY_TO_PREPARE",

  // ── Execution ────────────────────────────────────────────────────────────
  /** Actively filling the application against the blueprint. */
  "PREPARING",
  /** The portal rejected something. Recoverable; needs correction. */
  "VALIDATION_FAILED",
  /**
   * Paused for something only the student can do: identity verification, MFA,
   * OTP, CAPTCHA, payment, a legal declaration.
   *
   * This is a NORMAL state, not an error (brief §6). Any adapter may return
   * `HandoffRequired` at any point and the orchestrator must treat it as an
   * expected outcome.
   */
  "AWAITING_HANDOFF",
  /**
   * Paused for a human specialist.
   *
   * Reachable two ways, and the second does not depend on confidence at all:
   *   1. confidence-based escalation (layer one), and
   *   2. MANDATORY escalation (layer two) — financial evidence, or anything
   *      involving a minor, every time, regardless of confidence (brief §2.5).
   *
   * Layer two is enforced as a hard gate in `transitions.ts`, not as an
   * advisory flag.
   */
  "AWAITING_HUMAN_REVIEW",
  /**
   * The AI hit something it could not safely resolve. The case is PAUSED AT THE
   * EXACT POINT OF FAILURE with everything already done preserved, a
   * high-priority escalation is raised, and a specialist has been alerted
   * (ADR-0008).
   *
   * Distinct from AWAITING_HUMAN_REVIEW, and the distinction drives alerting:
   *   AWAITING_HUMAN_REVIEW      — "check my work before I proceed"
   *   AWAITING_SPECIALIST_RECOVERY — "I am stuck and cannot proceed"
   *
   * The specialist unblocks the specific problem; the case then RESUMES from
   * its checkpoint. It does not restart, and the specialist does not take over
   * the application.
   */
  "AWAITING_SPECIALIST_RECOVERY",
  /**
   * The exact content that will be submitted has been rendered and shown to
   * the student. Waiting for explicit authorisation (brief §7).
   */
  "AWAITING_STUDENT_AUTHORISATION",
  /**
   * The student authorised submission. A hash of exactly what they approved is
   * in the authorisation ledger.
   *
   * If the content changes after this point the authorisation is void and the
   * case returns to `AWAITING_STUDENT_AUTHORISATION`.
   */
  "AUTHORISED",

  // ── Submission ───────────────────────────────────────────────────────────
  /** Submission in flight. Guarded by the submission key (ADR-0006). */
  "SUBMITTING",
  /** Submitted; a receipt was captured. */
  "SUBMITTED",
  /**
   * Confirmation captured. TERMINAL.
   *
   * MVP responsibility ends here (brief §2.8). What happens to the application
   * afterwards — offer, rejection, deferral — is not tracked in this phase.
   */
  "CONFIRMED",

  // ── Off-ramps ────────────────────────────────────────────────────────────
  /**
   * Switching route entirely, to `AssistedManualAdapter`, which is always
   * available and never removed (brief §6).
   *
   * LAST RESORT (ADR-0008). The first response to a failure is
   * AWAITING_SPECIALIST_RECOVERY — pause, alert, unblock, resume. This state is
   * only reached when a specialist has judged that the automated route cannot
   * work for this case at all.
   */
  "ROUTE_FALLBACK",
  /** The student stopped it. TERMINAL. */
  "CANCELLED",
  /** Unrecoverable. TERMINAL. */
  "FAILED_PERMANENT",
] as const;

export type CaseState = (typeof CASE_STATES)[number];

/** States from which no transition is possible. */
export const TERMINAL_STATES = ["CONFIRMED", "CANCELLED", "FAILED_PERMANENT"] as const satisfies readonly CaseState[];

export type TerminalState = (typeof TERMINAL_STATES)[number];

const TERMINAL_SET: ReadonlySet<CaseState> = new Set<CaseState>(TERMINAL_STATES);

/** True when the case can never transition again. */
export function isTerminal(state: CaseState): state is TerminalState {
  return TERMINAL_SET.has(state);
}

/**
 * States in which the case is waiting on a human rather than on the system.
 *
 * Used for operational reporting — "what is actually blocked on us?" — and to
 * make sure a case waiting on a student is never counted as system throughput.
 */
export const BLOCKED_STATES = [
  "PROFILE_INCOMPLETE",
  "DOCUMENTS_PENDING",
  "AWAITING_HANDOFF",
  "AWAITING_HUMAN_REVIEW",
  "AWAITING_SPECIALIST_RECOVERY",
  "AWAITING_STUDENT_AUTHORISATION",
] as const satisfies readonly CaseState[];

const BLOCKED_SET: ReadonlySet<CaseState> = new Set<CaseState>(BLOCKED_STATES);

/** True when the case is waiting on a person, not on the system. */
export function isBlockedOnHuman(state: CaseState): boolean {
  return BLOCKED_SET.has(state);
}

/** True once a submission has been attempted, whatever the result. */
export function hasAttemptedSubmission(state: CaseState): boolean {
  return state === "SUBMITTING" || state === "SUBMITTED" || state === "CONFIRMED";
}
