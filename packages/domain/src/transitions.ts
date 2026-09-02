/**
 * The transition table and its guards.
 *
 * Two things live here, and the separation matters:
 *
 *   1. ALLOWED — the shape of the state machine. Which moves exist at all.
 *   2. GUARDS  — preconditions that must hold even for an allowed move.
 *
 * The mandatory-escalation rule (brief §2.5) is a GUARD, not a convention. A
 * case carrying financial evidence or involving a minor cannot reach
 * `AWAITING_STUDENT_AUTHORISATION` without a recorded, approving human review,
 * and there is no confidence score, configuration flag, or override parameter
 * that changes that. The check lives in the machine rather than in application
 * code specifically so that it cannot be forgotten at a call site.
 */

import type { HumanReviewRecord, ReviewTrigger } from "./escalation.js";
import { unclearedMandatoryTriggers } from "./escalation.js";
import type { CaseState } from "./state.js";
import { isTerminal } from "./state.js";

/**
 * Every legal transition.
 *
 * Read as: from this state, the case may move to any of these. Terminal states
 * map to an empty list. `satisfies` forces exhaustiveness — adding a state to
 * `CASE_STATES` without adding it here is a compile error, so the table can
 * never silently fall behind the state list.
 */
export const ALLOWED_TRANSITIONS = {
  INTAKE: ["PROFILE_INCOMPLETE", "DOCUMENTS_PENDING", "REQUIREMENTS_RESOLUTION", "WINDING_DOWN", "FAILED_PERMANENT"],

  PROFILE_INCOMPLETE: ["PROFILE_INCOMPLETE", "DOCUMENTS_PENDING", "REQUIREMENTS_RESOLUTION", "WINDING_DOWN", "FAILED_PERMANENT"],

  DOCUMENTS_PENDING: ["PROFILE_INCOMPLETE", "DOCUMENTS_PENDING", "REQUIREMENTS_RESOLUTION", "AWAITING_HUMAN_REVIEW", "WINDING_DOWN", "FAILED_PERMANENT"],

  REQUIREMENTS_RESOLUTION: ["ELIGIBILITY_REVIEW", "PROFILE_INCOMPLETE", "DOCUMENTS_PENDING", "AWAITING_HUMAN_REVIEW", "AWAITING_SPECIALIST_RECOVERY", "WINDING_DOWN", "FAILED_PERMANENT"],

  ELIGIBILITY_REVIEW: ["BLUEPRINT_REQUIRED", "READY_TO_PREPARE", "PROFILE_INCOMPLETE", "DOCUMENTS_PENDING", "AWAITING_HUMAN_REVIEW", "WINDING_DOWN", "FAILED_PERMANENT"],

  BLUEPRINT_REQUIRED: ["READY_TO_PREPARE", "ROUTE_FALLBACK", "AWAITING_HUMAN_REVIEW", "AWAITING_SPECIALIST_RECOVERY", "WINDING_DOWN", "FAILED_PERMANENT"],

  READY_TO_PREPARE: ["PREPARING", "PROFILE_INCOMPLETE", "DOCUMENTS_PENDING", "AWAITING_HUMAN_REVIEW", "WINDING_DOWN", "FAILED_PERMANENT"],

  PREPARING: [
    "VALIDATION_FAILED",
    "AWAITING_HANDOFF",
    "AWAITING_HUMAN_REVIEW",
    // The primary failure path (ADR-0008): pause here, do not unwind.
    "AWAITING_SPECIALIST_RECOVERY",
    "AWAITING_STUDENT_AUTHORISATION",
    // A missing or newly-expired document can send preparation back for input.
    "PROFILE_INCOMPLETE",
    "DOCUMENTS_PENDING",
    "ROUTE_FALLBACK",
    "WINDING_DOWN",
    "FAILED_PERMANENT",
  ],

  VALIDATION_FAILED: ["PREPARING", "PROFILE_INCOMPLETE", "DOCUMENTS_PENDING", "AWAITING_HUMAN_REVIEW", "AWAITING_SPECIALIST_RECOVERY", "ROUTE_FALLBACK", "WINDING_DOWN", "FAILED_PERMANENT"],

  // A handoff can resume into preparation or straight into submission — the
  // final-submission handoff is the latter.
  AWAITING_HANDOFF: ["PREPARING", "SUBMITTING", "AWAITING_HUMAN_REVIEW", "AWAITING_SPECIALIST_RECOVERY", "ROUTE_FALLBACK", "WINDING_DOWN", "FAILED_PERMANENT"],

  AWAITING_HUMAN_REVIEW: ["PREPARING", "READY_TO_PREPARE", "AWAITING_STUDENT_AUTHORISATION", "PROFILE_INCOMPLETE", "DOCUMENTS_PENDING", "AWAITING_SPECIALIST_RECOVERY", "ROUTE_FALLBACK", "WINDING_DOWN", "FAILED_PERMANENT"],

  // Recovery resumes the case rather than restarting it (ADR-0008). It can
  // return to any execution state, because the checkpoint says where the AI
  // actually stopped. ROUTE_FALLBACK remains available as the last resort when
  // the specialist judges the automated route unworkable for this case.
  AWAITING_SPECIALIST_RECOVERY: [
    "PREPARING",
    "READY_TO_PREPARE",
    "REQUIREMENTS_RESOLUTION",
    "VALIDATION_FAILED",
    "AWAITING_HANDOFF",
    "AWAITING_HUMAN_REVIEW",
    "AWAITING_STUDENT_AUTHORISATION",
    "SUBMITTING",
    "PROFILE_INCOMPLETE",
    "DOCUMENTS_PENDING",
    "ROUTE_FALLBACK",
    "WINDING_DOWN",
    "FAILED_PERMANENT",
  ],

  AWAITING_STUDENT_AUTHORISATION: ["AUTHORISED", "PREPARING", "AWAITING_HUMAN_REVIEW", "AWAITING_SPECIALIST_RECOVERY", "WINDING_DOWN", "FAILED_PERMANENT"],

  // Authorisation is void the moment content changes, which returns the case to
  // PREPARING or back to the authorisation step. Both are legal from here.
  AUTHORISED: ["SUBMITTING", "AWAITING_HANDOFF", "AWAITING_STUDENT_AUTHORISATION", "AWAITING_SPECIALIST_RECOVERY", "PREPARING", "WINDING_DOWN", "FAILED_PERMANENT"],

  SUBMITTING: ["SUBMITTED", "AWAITING_HANDOFF", "VALIDATION_FAILED", "AWAITING_SPECIALIST_RECOVERY", "ROUTE_FALLBACK", "FAILED_PERMANENT"],

  SUBMITTED: ["CONFIRMED", "FAILED_PERMANENT"],

  ROUTE_FALLBACK: ["PREPARING", "AWAITING_HANDOFF", "AWAITING_HUMAN_REVIEW", "AWAITING_SPECIALIST_RECOVERY", "AWAITING_STUDENT_AUTHORISATION", "WINDING_DOWN", "FAILED_PERMANENT"],

  // ── Cancellation, in two acts (ADR-0053 §1) ──────────────────────────
  //
  // Every non-terminal state above reaches WINDING_DOWN rather than CANCELLED
  // directly, and that substitution IS the decision. A case that could jump
  // straight to a terminal state would skip the guard below, and `decide`
  // refuses every intent on a terminal case except `instruct_reapplication` —
  // so `complete_handoff` would be refused and the student's account, created
  // in their name on a real portal, could never be handed back. That would
  // defeat ADR-0050 while reporting success.
  WINDING_DOWN: ["CANCELLED"],

  // Terminal.
  CONFIRMED: [],
  CANCELLED: [],
  FAILED_PERMANENT: [],
} as const satisfies Readonly<Record<CaseState, readonly CaseState[]>>;

/** True when the transition exists in the table, ignoring guards. */
export function isTransitionAllowed(from: CaseState, to: CaseState): boolean {
  const allowed: readonly CaseState[] = ALLOWED_TRANSITIONS[from];
  return allowed.includes(to);
}

/** Every state reachable in one step. */
export function nextStates(from: CaseState): readonly CaseState[] {
  return ALLOWED_TRANSITIONS[from];
}

// ───────────────────────────────────────────────────────────────────────────
// Guards
// ───────────────────────────────────────────────────────────────────────────

/** What a guard needs to know about the case. */
export interface GuardContext {
  /** Review triggers currently active on the case. */
  readonly activeTriggers: readonly ReviewTrigger[];
  /** Every completed human review, in order. */
  readonly completedReviews: readonly HumanReviewRecord[];
  /** Hash of the content the student authorised, if any. */
  readonly authorisedContentHash?: string;
  /** Hash of the content as currently prepared. */
  readonly preparedContentHash?: string;
  /**
   * What this case still owes the student, if anything (ADR-0053 §1).
   *
   * Supplied by the caller, exactly as `authorisedContentHash` is, and for the
   * same reason: the account stage is DERIVED from the case log and the intent
   * ledger (ADR-0050) and cannot be computed from the case alone, so this
   * module cannot fetch it. The run driver establishes it with
   * `mayConcludeCase` and passes it in.
   *
   * Absent means "not asked" and is treated as nothing outstanding — which is
   * safe here because the only guard that reads it, WINDING_DOWN → CANCELLED,
   * is the sole way to reach that state and the driver is its only caller.
   */
  readonly outstandingObligations?: readonly string[];
}

export type TransitionRefusal =
  | { readonly kind: "not_allowed"; readonly detail: string }
  | { readonly kind: "terminal_state"; readonly detail: string }
  | { readonly kind: "mandatory_review_outstanding"; readonly detail: string; readonly triggers: readonly ReviewTrigger[] }
  | { readonly kind: "authorisation_missing"; readonly detail: string }
  | { readonly kind: "authorisation_stale"; readonly detail: string }
  | {
      readonly kind: "obligations_outstanding";
      readonly detail: string;
      readonly outstanding: readonly string[];
    };

export type TransitionCheck =
  | { readonly permitted: true }
  | { readonly permitted: false; readonly refusal: TransitionRefusal };

const PERMITTED: TransitionCheck = { permitted: true };

/**
 * Checks a transition against the table AND the guards.
 *
 * This is the only sanctioned way to move a case. `machine.ts` calls it; no
 * other code should construct a `CaseStateChanged` event without going through
 * here.
 */
export function checkTransition(from: CaseState, to: CaseState, context: GuardContext): TransitionCheck {
  if (isTerminal(from)) {
    return {
      permitted: false,
      refusal: {
        kind: "terminal_state",
        detail: `${from} is terminal; a case in this state can never transition again.`,
      },
    };
  }

  if (!isTransitionAllowed(from, to)) {
    return {
      permitted: false,
      refusal: {
        kind: "not_allowed",
        detail: `No transition exists from ${from} to ${to}.`,
      },
    };
  }

  // ── Guard: mandatory human review (brief §2.5) ─────────────────────────
  //
  // Financial evidence, and anything involving a minor, must be reviewed by a
  // human EVERY TIME regardless of confidence. Enforced at the gate into
  // student authorisation, because that is the last point before the student is
  // asked to approve real content.
  if (to === "AWAITING_STUDENT_AUTHORISATION") {
    const outstanding = unclearedMandatoryTriggers(context.activeTriggers, context.completedReviews);
    if (outstanding.length > 0) {
      return {
        permitted: false,
        refusal: {
          kind: "mandatory_review_outstanding",
          detail:
            `This case requires mandatory human review before the student may be asked to ` +
            `authorise it. Outstanding: ${outstanding.join(", ")}. ` +
            `Confidence does not override this.`,
          triggers: outstanding,
        },
      };
    }
  }

  // ── Guard: a cancellation concludes only once nothing is owed ─────────
  //
  // ADR-0053 §1, and it is the whole reason cancellation is two acts rather
  // than one. The student may stop instantly — entering WINDING_DOWN is
  // unguarded — but CANCELLED is TERMINAL, and `decide` refuses every intent on
  // a terminal case except `instruct_reapplication`. Concluding while an
  // account is still outstanding would therefore make `complete_handoff`
  // permanently refusable, stranding an account created in the student's name
  // on a real portal and defeating the rule ADR-0050 exists to enforce.
  //
  // In the machine rather than in the driver, deliberately. The alternative is
  // that "a cancelled case cannot conclude while it owes the student an
  // account" is a rule one caller remembers, and this repository has already
  // learned what happens to rules that live in a caller.
  if (to === "CANCELLED") {
    const outstanding = context.outstandingObligations ?? [];
    if (outstanding.length > 0) {
      return {
        permitted: false,
        refusal: {
          kind: "obligations_outstanding",
          detail:
            `The student stopped this application, but it still owes them: ` +
            `${outstanding.join("; ")}. Cancelling now would make those unfinishable, ` +
            `because no intent may be recorded against a concluded case.`,
          outstanding,
        },
      };
    }
  }

  // ── Guard: authorisation must exist and still match (brief §7) ─────────
  if (to === "SUBMITTING") {
    if (context.authorisedContentHash === undefined) {
      return {
        permitted: false,
        refusal: {
          kind: "authorisation_missing",
          detail: "A case cannot be submitted without a captured student authorisation.",
        },
      };
    }
    if (
      context.preparedContentHash !== undefined &&
      context.preparedContentHash !== context.authorisedContentHash
    ) {
      return {
        permitted: false,
        refusal: {
          kind: "authorisation_stale",
          detail:
            "The prepared content no longer matches what the student authorised. " +
            "The authorisation is void and must be obtained again.",
        },
      };
    }
  }

  return PERMITTED;
}
