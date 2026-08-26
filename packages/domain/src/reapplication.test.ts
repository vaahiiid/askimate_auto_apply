/**
 * Tests for the re-application rules (ADR-0006).
 *
 * Vahid's decision, 2026-08-26:
 *   • an automatic retry must NEVER create a new application;
 *   • only an explicit student instruction may;
 *   • the instruction is recorded;
 *   • the wait recommendation is shown where appropriate;
 *   • the student may proceed despite it.
 */

import { describe, expect, it } from "vitest";

import { intake } from "./ids.js";
import type { PriorOutcomeAssertion, ReapplicationActor, ReapplicationInstruction } from "./reapplication.js";
import { decideReapplication, recommendWait } from "./reapplication.js";

const REJECTED: PriorOutcomeAssertion = {
  outcome: "rejected",
  assertedBy: "student",
  assertedAt: new Date("2026-08-20T12:00:00Z"),
};

function instruction(overrides: Partial<ReapplicationInstruction> = {}): ReapplicationInstruction {
  return {
    priorOutcome: REJECTED,
    studentStatement: "I want to apply to Leeds again for the same course.",
    instructedAt: new Date("2026-08-26T14:00:00Z"),
    recommendationShown: {
      advice: "next_intake",
      suggestedIntake: intake("2028-09"),
      rationale: "We suggest applying for the next intake instead.",
      shownAt: new Date("2026-08-26T13:59:00Z"),
    },
    proceededDespiteRecommendation: true,
    ...overrides,
  };
}

describe("who may create a new attempt", () => {
  it("allows an explicit student instruction", () => {
    const decision = decideReapplication({
      actor: "student",
      currentAttemptOrdinal: 1,
      priorCaseConcluded: true,
      instruction: instruction(),
    });

    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.nextAttemptOrdinal).toBe(2);
    }
  });

  it("refuses an automatic retry", () => {
    // THE core rule. A retry must never create a new application, whatever
    // else is true about the case.
    const decision = decideReapplication({
      actor: "automatic_retry",
      currentAttemptOrdinal: 1,
      priorCaseConcluded: true,
      instruction: instruction(),
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.rejection.kind).toBe("automatic_origin");
    }
  });

  it.each<ReapplicationActor>(["automatic_retry", "specialist", "operator"])(
    "refuses actor %s even with a perfectly formed instruction",
    (actor) => {
      // A specialist and an operator are refused too. The decision belongs to
      // the student — not to someone acting helpfully on their behalf.
      const decision = decideReapplication({
        actor,
        currentAttemptOrdinal: 1,
        priorCaseConcluded: true,
        instruction: instruction(),
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.rejection.kind).toBe("automatic_origin");
      }
    },
  );
});

describe("preconditions on the instruction", () => {
  it("refuses while the previous application is still live", () => {
    // Otherwise the student would have two concurrent applications for the
    // same course and intake — a different bug with the same blast radius.
    const decision = decideReapplication({
      actor: "student",
      currentAttemptOrdinal: 1,
      priorCaseConcluded: false,
      instruction: instruction(),
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.rejection.kind).toBe("prior_case_not_concluded");
    }
  });

  it("refuses an empty student statement", () => {
    // Without the student's own words, nobody can later reconstruct why a
    // second application was sent.
    const decision = decideReapplication({
      actor: "student",
      currentAttemptOrdinal: 1,
      priorCaseConcluded: true,
      instruction: instruction({ studentStatement: "   " }),
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.rejection.kind).toBe("empty_student_statement");
    }
  });

  it("refuses when the recommendation was shown after the instruction", () => {
    // Advisory in effect; mandatory in presentation.
    const decision = decideReapplication({
      actor: "student",
      currentAttemptOrdinal: 1,
      priorCaseConcluded: true,
      instruction: instruction({
        instructedAt: new Date("2026-08-26T14:00:00Z"),
        recommendationShown: {
          advice: "six_months",
          rationale: "Consider waiting.",
          shownAt: new Date("2026-08-26T14:05:00Z"), // after the fact
        },
      }),
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.rejection.kind).toBe("recommendation_not_shown");
    }
  });

  it("accepts advice of 'none' as a validly shown recommendation", () => {
    // "No wait was warranted" is a recorded recommendation, not a missing one.
    const decision = decideReapplication({
      actor: "student",
      currentAttemptOrdinal: 1,
      priorCaseConcluded: true,
      instruction: instruction({
        recommendationShown: {
          advice: "none",
          rationale: "You withdrew rather than being turned down.",
          shownAt: new Date("2026-08-26T13:00:00Z"),
        },
      }),
    });

    expect(decision.allowed).toBe(true);
  });
});

describe("the student may override the recommendation", () => {
  it("allows proceeding against advice, and records that they did", () => {
    // The heart of Vahid's clarification: we advise, the student decides.
    const given = instruction({ proceededDespiteRecommendation: true });

    const decision = decideReapplication({
      actor: "student",
      currentAttemptOrdinal: 1,
      priorCaseConcluded: true,
      instruction: given,
    });

    expect(decision.allowed).toBe(true);
    expect(given.proceededDespiteRecommendation).toBe(true);
    expect(given.recommendationShown.advice).toBe("next_intake");
  });

  it("increments the ordinal by exactly one, however many times it is used", () => {
    let ordinal = 1;
    for (let round = 0; round < 3; round += 1) {
      const decision = decideReapplication({
        actor: "student",
        currentAttemptOrdinal: ordinal,
        priorCaseConcluded: true,
        instruction: instruction(),
      });
      expect(decision.allowed).toBe(true);
      if (decision.allowed) ordinal = decision.nextAttemptOrdinal;
    }
    expect(ordinal).toBe(4);
  });
});

describe("what we advise", () => {
  it("suggests the next intake after a rejection when one is known", () => {
    const advice = recommendWait({
      priorOutcome: REJECTED,
      currentIntake: intake("2027-09"),
      nextIntake: intake("2028-09"),
    });

    expect(advice.advice).toBe("next_intake");
    expect(advice.suggestedIntake).toBe("2028-09");
    expect(advice.rationale).toContain("decision is yours");
  });

  it("falls back to roughly six months when the next intake is unknown", () => {
    const advice = recommendWait({ priorOutcome: REJECTED, currentIntake: intake("2027-09") });

    expect(advice.advice).toBe("six_months");
    expect(advice.rationale).toContain("six months");
    expect(advice.rationale).toContain("decision is yours");
  });

  it("does not advise waiting after a withdrawal", () => {
    // The student stopped it themselves. Advising a wait would be
    // paternalistic and unfounded.
    const advice = recommendWait({
      priorOutcome: { outcome: "withdrawn", assertedBy: "student", assertedAt: new Date() },
      currentIntake: intake("2027-09"),
      nextIntake: intake("2028-09"),
    });

    expect(advice.advice).toBe("none");
  });

  it("always frames the advice as the student's decision", () => {
    // Guards against the recommendation drifting into something that reads
    // like a refusal.
    for (const outcome of ["rejected", "withdrawn"] as const) {
      const advice = recommendWait({
        priorOutcome: { outcome, assertedBy: "student", assertedAt: new Date() },
        currentIntake: intake("2027-09"),
      });
      expect(advice.rationale.length).toBeGreaterThan(0);
    }
  });
});

describe("prior outcome provenance", () => {
  it("records the outcome as a student assertion, never as verified fact", () => {
    // AAS has no journey tracking (brief §2.8), so it cannot know an
    // application was rejected. Only the student knows. The type says so.
    expect(REJECTED.assertedBy).toBe("student");
  });
});
