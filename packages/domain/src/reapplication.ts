/**
 * Re-application (ADR-0006).
 *
 * Vahid's decision, 2026-08-26:
 *
 *   "The decision to re-apply belongs to the student. If a student has already
 *    been rejected or withdrawn, the system must not automatically create or
 *    submit another application for the same university, course and intake.
 *    However, the student may explicitly instruct AskiMate to make another
 *    application. AskiMate should recommend that the student consider waiting
 *    at least until the next intake or approximately six months before
 *    re-applying, depending on the circumstances, but this is a recommendation
 *    only. The student's explicit instruction is ultimately the decision."
 *
 * So:
 *   • an automatic retry NEVER creates a new application;
 *   • only an explicit student instruction may;
 *   • the instruction is recorded;
 *   • the wait recommendation is shown where appropriate;
 *   • the student may proceed despite it.
 *
 * The recommendation is advisory in EFFECT but mandatory in PRESENTATION: the
 * system must show it and must record that it did. `recommendationShown` is
 * therefore required, not optional.
 */

import type { CaseId } from "./ids.js";
import type { Intake } from "./ids.js";

/**
 * What the student says happened to their previous application.
 *
 * ── An honest limitation, made explicit in the type ──────────────────────
 *
 * MVP responsibility ends at submission confirmation and there is no journey
 * tracking (brief §2.8). **AAS therefore does not know of its own accord that a
 * prior application was rejected or withdrawn.** Only the student knows.
 *
 * So this is stored as a student-asserted CLAIM, with that provenance in the
 * type itself — never as a fact the system established. Recording "rejected" as
 * though we verified it would be precisely the kind of quiet invention the
 * whole design forbids.
 *
 * If a later phase adds journey tracking that can verify outcomes, `assertedBy`
 * gains a `"verified_by_system"` member and the rules below are unchanged.
 */
export interface PriorOutcomeAssertion {
  /** What the student says the outcome was. */
  readonly outcome: "rejected" | "withdrawn";
  /** Who says so. Currently only ever the student — see the note above. */
  readonly assertedBy: "student";
  readonly assertedAt: Date;
  /** The case the student is referring to, when AAS handled it. */
  readonly priorCaseId?: CaseId;
}

/** The wait recommendation shown to the student before their instruction is accepted. */
export interface WaitRecommendation {
  /**
   * What we advised.
   *
   *   next_intake  — wait until the following intake
   *   six_months   — wait roughly six months
   *   none         — circumstances did not warrant advising a wait
   */
  readonly advice: "next_intake" | "six_months" | "none";
  /** The intake we suggested instead, when `advice` is `next_intake`. */
  readonly suggestedIntake?: Intake;
  /** Plain-language reasoning shown to the student. */
  readonly rationale: string;
  readonly shownAt: Date;
}

/**
 * An explicit student instruction to make another application.
 *
 * This is the ONLY thing in the system that may increment `attemptOrdinal`.
 * It is deliberately verbose: every field here is something a case must be able
 * to answer months later, from stored data alone.
 */
export interface ReapplicationInstruction {
  /** What the student says happened last time. */
  readonly priorOutcome: PriorOutcomeAssertion;
  /**
   * The student's instruction in their own words, as captured by AskiMate.
   *
   * Not a boolean. When someone asks "why did you submit a second application
   * to Leeds?", the answer should be the student's actual sentence.
   */
  readonly studentStatement: string;
  readonly instructedAt: Date;
  /**
   * The recommendation that was shown. REQUIRED — the system must not accept an
   * instruction it never advised on. `advice: "none"` is the way to record that
   * no wait was warranted.
   */
  readonly recommendationShown: WaitRecommendation;
  /** Whether the student chose to proceed anyway. */
  readonly proceededDespiteRecommendation: boolean;
}

/** Why a re-application instruction was refused. */
export type ReapplicationRejection =
  | { readonly kind: "automatic_origin"; readonly detail: string }
  | { readonly kind: "prior_case_not_concluded"; readonly detail: string }
  | { readonly kind: "empty_student_statement"; readonly detail: string }
  | { readonly kind: "recommendation_not_shown"; readonly detail: string };

export type ReapplicationDecision =
  | { readonly allowed: true; readonly nextAttemptOrdinal: number }
  | { readonly allowed: false; readonly rejection: ReapplicationRejection };

/**
 * Who is asking for the new attempt.
 *
 * Modelled as a closed union rather than a boolean so that adding a future
 * actor forces a decision here rather than silently defaulting to "allowed".
 * Only `"student"` can ever succeed.
 */
export type ReapplicationActor = "student" | "automatic_retry" | "specialist" | "operator";

/**
 * Decides whether a new attempt may be created.
 *
 * The single gate. `machine.ts` calls this; nothing else may increment an
 * attempt ordinal.
 */
export function decideReapplication(input: {
  readonly actor: ReapplicationActor;
  readonly currentAttemptOrdinal: number;
  readonly priorCaseConcluded: boolean;
  readonly instruction: ReapplicationInstruction;
}): ReapplicationDecision {
  // 1. An automatic retry must never create a new application. This is checked
  //    first and unconditionally — no later branch can rescue it.
  if (input.actor !== "student") {
    return {
      allowed: false,
      rejection: {
        kind: "automatic_origin",
        detail:
          `A new application attempt may only be created by an explicit student instruction. ` +
          `Actor was "${input.actor}". A retry must reuse the existing submission identity.`,
      },
    };
  }

  // 2. The prior application must actually be over. Re-applying while an
  //    application is still live would create two concurrent applications for
  //    the same course and intake — a different bug with the same blast radius.
  if (!input.priorCaseConcluded) {
    return {
      allowed: false,
      rejection: {
        kind: "prior_case_not_concluded",
        detail:
          "The previous application for this course and intake has not concluded. " +
          "A new attempt cannot be created while it is still in progress.",
      },
    };
  }

  // 3. The student's instruction must be real. An empty statement means nobody
  //    can later reconstruct why a second application was sent.
  if (input.instruction.studentStatement.trim().length === 0) {
    return {
      allowed: false,
      rejection: {
        kind: "empty_student_statement",
        detail: "The student's instruction must be recorded in their own words.",
      },
    };
  }

  // 4. The recommendation must have been shown before the instruction was
  //    given. Advisory in effect; mandatory in presentation.
  if (input.instruction.recommendationShown.shownAt > input.instruction.instructedAt) {
    return {
      allowed: false,
      rejection: {
        kind: "recommendation_not_shown",
        detail:
          "The wait recommendation must be shown to the student before their instruction is accepted.",
      },
    };
  }

  return { allowed: true, nextAttemptOrdinal: input.currentAttemptOrdinal + 1 };
}

/**
 * Suggests what to advise a student considering re-application.
 *
 * Deliberately conservative and deliberately dumb: it applies the rule Vahid
 * stated and nothing more. It does NOT weigh the student's chances, and it must
 * never grow into something that does — that would be the system inventing an
 * assessment it has no basis for.
 */
export function recommendWait(input: {
  readonly priorOutcome: PriorOutcomeAssertion;
  readonly currentIntake: Intake;
  readonly nextIntake?: Intake;
}): Omit<WaitRecommendation, "shownAt"> {
  if (input.priorOutcome.outcome === "rejected") {
    return input.nextIntake === undefined
      ? {
          advice: "six_months",
          rationale:
            "Applications are usually stronger after a gap. We suggest waiting around six months " +
            "before applying to the same course again, so there is time for anything that led to " +
            "the earlier decision to change. This is a suggestion — the decision is yours.",
        }
      : {
          advice: "next_intake",
          suggestedIntake: input.nextIntake,
          rationale:
            `Universities rarely reconsider the same application within one intake. We suggest ` +
            `applying for the ${input.nextIntake} intake instead, which gives time to strengthen ` +
            `the application. This is a suggestion — the decision is yours.`,
        };
  }

  // Withdrawn: the student stopped it themselves, so there is usually no reason
  // to advise a wait. Advising one anyway would be paternalistic and unfounded.
  return {
    advice: "none",
    rationale:
      "You withdrew the previous application rather than being turned down, so there is no " +
      "particular reason to wait before applying again.",
  };
}
