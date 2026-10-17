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
  | "unexpected_portal_behaviour"
  /**
   * The agent interviewed the student and still cannot obtain something the
   * application requires (ADR-0007).
   *
   * This is the correct end of the road for agent-led intake: the agent asked,
   * progressively and more than once, and the information genuinely is not
   * available. A specialist looks at it.
   *
   * It is emphatically NOT a licence to guess. "The student must never fill in
   * a form" does not become "so fill it in for them" — it becomes "ask, and if
   * asking fails, escalate".
   */
  | "information_unobtainable";

export type ReviewTrigger = MandatoryReviewTrigger | DiscretionaryReviewTrigger;

/**
 * Every review trigger, mandatory and discretionary.
 *
 * Exists so a wire parser can refuse an invented one. `satisfies` forces it to
 * stay complete: adding a trigger without adding it here is a compile error,
 * and a parser silently rejecting a real trigger would be a review nobody could
 * record.
 */
export const REVIEW_TRIGGERS = [
  "financial_evidence",
  "involves_minor",
  "low_confidence",
  "conflicting_information",
  "stale_requirement_data",
  "blueprint_drift",
  "unexpected_portal_behaviour",
  "information_unobtainable",
] as const satisfies readonly ReviewTrigger[];

/** Type guard for a trigger arriving from a network. */
export function isReviewTrigger(value: unknown): value is ReviewTrigger {
  return typeof value === "string" && (REVIEW_TRIGGERS as readonly string[]).includes(value);
}

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
  /**
   * What this review saw, per mandatory trigger: the fingerprint of the content
   * that raised it, computed by the service from the student's profile at the
   * moment the review is recorded, never typed by the reviewer (ADR-0161 §6,
   * approved by Vahid on 2026-10-17: "D3: approved.").
   *
   * An approval clears a mandatory trigger only while this matches the
   * fingerprint the trigger was last raised with. Absent on every review
   * recorded before P318, and absent covers nothing: such an approval saw
   * content nobody can now name, so it cannot stand for content that may have
   * changed since.
   */
  readonly covers?: ReviewFingerprints;
}

/**
 * The fingerprint of the content each mandatory trigger was raised for (ADR-0161 §6).
 *
 * Opaque strings, compared for equality only. The service builds them from
 * each answer's revision and the moment it was confirmed, never from the
 * answer's value, so the case log that carries them holds nothing of what the
 * student said (a date of birth hashed alone could be recovered by trying
 * every date).
 */
export type ReviewFingerprints = Readonly<Partial<Record<MandatoryReviewTrigger, string>>>;

/**
 * Returns the mandatory triggers that have not yet been cleared by a completed,
 * approving human review of the content they were last raised for.
 *
 * A non-empty result means the case may NOT advance to student authorisation,
 * whatever its confidence score. Called from the transition guard rather than
 * from application code, so it cannot be forgotten at a call site.
 *
 * `raised` is the fingerprint each mandatory trigger was last raised with
 * (ADR-0161 §6). Until P318 any approval ever recorded cleared a trigger for
 * good, so a financial answer changed after its review was never reviewed again
 * (row 189 (1)). Now an approval clears a trigger only when it saw that very
 * content; a trigger raised with no fingerprint cannot be cleared by any
 * approval, and is raised again with one.
 */
export function unclearedMandatoryTriggers(
  active: readonly ReviewTrigger[],
  reviews: readonly HumanReviewRecord[],
  raised: ReviewFingerprints,
): readonly MandatoryReviewTrigger[] {
  const mandatory = active.filter(isMandatory);
  if (mandatory.length === 0) return [];

  return mandatory.filter((trigger) => {
    const fingerprint = raised[trigger];
    if (fingerprint === undefined) return true;
    // Only an approving review clears a trigger. "changes_requested" and
    // "rejected" leave it standing — the work goes back round.
    return !reviews.some(
      (review) => review.outcome === "approved" && review.triggers.includes(trigger) && review.covers?.[trigger] === fingerprint,
    );
  });
}
