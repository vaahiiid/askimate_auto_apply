/**
 * Two-layer escalation (brief §2.5).
 *
 *   Layer one — confidence-based. The system is unsure, so a human looks.
 *
 *   Layer two — DOES NOT DEPEND ON CONFIDENCE AT ALL. Financial evidence, and
 *   anything involving a minor, are escalated for mandatory human review every
 *   single time, no matter how confident the system is.
 *
 * The existing AskiMate implements something close to layer two as a keyword
 * list that appends a "speak to a mentor" sentence to the answer. That is an
 * advisory nudge, not a gate. Here it is a hard precondition enforced in the
 * transition table: a case carrying a mandatory trigger cannot reach
 * `AWAITING_STUDENT_AUTHORISATION` without a recorded human review, and there
 * is no confidence score high enough to bypass it.
 */

/** A reason a case MUST be reviewed by a human, independent of confidence. */
export type MandatoryReviewTrigger =
  /**
   * The case involves financial evidence — bank statements, proof of funds,
   * sponsorship letters, financial guarantees.
   *
   * This is the category where the 31-day UK recency window lives, and where
   * silently reusing a stale document is the exact failure the system exists
   * to prevent.
   */
  | "financial_evidence"
  /**
   * The applicant is a minor, or the case otherwise involves one.
   *
   * Detected from a confirmed date of birth. Never inferred, and never assumed
   * absent: if date of birth is missing or cannot be parsed unambiguously, the
   * system does NOT conclude the student is an adult — it asks.
   */
  | "involves_minor";

export const MANDATORY_REVIEW_TRIGGERS = [
  "financial_evidence",
  "involves_minor",
] as const satisfies readonly MandatoryReviewTrigger[];

/** Layer one: why the system decided, on its own, that a human should look. */
export type DiscretionaryReviewTrigger =
  | "low_confidence"
  | "conflicting_information"
  | "stale_requirement_data"
  | "blueprint_drift"
  | "unexpected_portal_behaviour";

export type ReviewTrigger = MandatoryReviewTrigger | DiscretionaryReviewTrigger;

const MANDATORY_SET: ReadonlySet<ReviewTrigger> = new Set<ReviewTrigger>(MANDATORY_REVIEW_TRIGGERS);

/** True for a trigger that no confidence score can override. */
export function isMandatory(trigger: ReviewTrigger): trigger is MandatoryReviewTrigger {
  return MANDATORY_SET.has(trigger);
}

/** A completed human review, recorded in the event log. */
export interface HumanReviewRecord {
  /**
   * The specialist who performed the review.
   *
   * A named individual, never a shared account. The existing admin auth uses a
   * single shared credential pair, which cannot attribute a decision to a
   * person — Phase 5 replaces it for exactly this reason.
   */
  readonly reviewerId: string;
  readonly reviewedAt: Date;
  readonly triggers: readonly ReviewTrigger[];
  readonly outcome: "approved" | "rejected" | "changes_requested";
  readonly notes?: string;
}

/**
 * Returns the mandatory triggers that have not yet been cleared by a completed,
 * approving human review.
 *
 * A non-empty result means the case may NOT advance to student authorisation,
 * whatever its confidence score. Called from the transition guard rather than
 * from application code, so it cannot be forgotten at a call site.
 */
export function unclearedMandatoryTriggers(
  active: readonly ReviewTrigger[],
  reviews: readonly HumanReviewRecord[],
): readonly MandatoryReviewTrigger[] {
  const mandatory = active.filter(isMandatory);
  if (mandatory.length === 0) return [];

  const cleared = new Set<ReviewTrigger>();
  for (const review of reviews) {
    // Only an approving review clears a trigger. "changes_requested" and
    // "rejected" leave it standing — the work goes back round.
    if (review.outcome !== "approved") continue;
    for (const trigger of review.triggers) cleared.add(trigger);
  }

  return mandatory.filter((trigger) => !cleared.has(trigger));
}
