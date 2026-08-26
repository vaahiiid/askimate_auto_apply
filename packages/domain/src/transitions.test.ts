/**
 * Tests for the transition table and its guards.
 *
 * The mandatory-escalation tests are the ones that matter most: brief §2.5
 * requires that financial evidence and anything involving a minor are escalated
 * for human review EVERY time, regardless of confidence.
 */

import { describe, expect, it } from "vitest";

import type { HumanReviewRecord } from "./escalation.js";
import { CASE_STATES, TERMINAL_STATES, type CaseState } from "./state.js";
import type { GuardContext } from "./transitions.js";
import { ALLOWED_TRANSITIONS, checkTransition, isTransitionAllowed, nextStates } from "./transitions.js";

const EMPTY_CONTEXT: GuardContext = { activeTriggers: [], completedReviews: [] };

function approvedReview(triggers: HumanReviewRecord["triggers"]): HumanReviewRecord {
  return {
    reviewerId: "specialist_amara",
    reviewedAt: new Date("2026-08-26T11:00:00Z"),
    triggers,
    outcome: "approved",
  };
}

describe("the transition table", () => {
  it("covers every state", () => {
    // `satisfies` enforces this at compile time; asserting it at runtime too
    // means a future refactor cannot quietly weaken the type.
    for (const state of CASE_STATES) {
      expect(ALLOWED_TRANSITIONS[state]).toBeDefined();
    }
  });

  it("lets no terminal state transition anywhere", () => {
    for (const state of TERMINAL_STATES) {
      expect(nextStates(state)).toHaveLength(0);
    }
  });

  it("refuses every transition out of a terminal state", () => {
    for (const from of TERMINAL_STATES) {
      for (const to of CASE_STATES) {
        const check = checkTransition(from, to, EMPTY_CONTEXT);
        expect(check.permitted).toBe(false);
        if (!check.permitted) {
          expect(check.refusal.kind).toBe("terminal_state");
        }
      }
    }
  });

  it("names only real states as targets", () => {
    const valid = new Set<CaseState>(CASE_STATES);
    for (const from of CASE_STATES) {
      for (const to of nextStates(from)) {
        expect(valid.has(to)).toBe(true);
      }
    }
  });

  it("makes every non-terminal state able to reach a terminal one", () => {
    // A state with no path to termination would strand cases forever.
    const terminal = new Set<CaseState>(TERMINAL_STATES);
    for (const state of CASE_STATES) {
      if (terminal.has(state)) continue;
      const reachable = nextStates(state);
      expect(reachable.some((next) => terminal.has(next))).toBe(true);
    }
  });

  it("makes every state reachable from INTAKE", () => {
    // Breadth-first from the opening state. An unreachable state is dead code
    // pretending to be a requirement.
    const seen = new Set<CaseState>(["INTAKE"]);
    const queue: CaseState[] = ["INTAKE"];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const next of nextStates(current)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    for (const state of CASE_STATES) {
      expect(seen.has(state)).toBe(true);
    }
  });

  it("refuses a transition that is not in the table", () => {
    // You cannot leap from intake straight to submitting.
    expect(isTransitionAllowed("INTAKE", "SUBMITTING")).toBe(false);
    const check = checkTransition("INTAKE", "SUBMITTING", EMPTY_CONTEXT);
    expect(check.permitted).toBe(false);
    if (!check.permitted) expect(check.refusal.kind).toBe("not_allowed");
  });

  it("allows a handoff to resume straight into submission", () => {
    // The final-submission handoff resumes into SUBMITTING, not PREPARING.
    expect(isTransitionAllowed("AWAITING_HANDOFF", "SUBMITTING")).toBe(true);
  });

  it("allows preparation to fall back to a manual route", () => {
    // AssistedManualAdapter is the permanent fallback (brief §6).
    expect(isTransitionAllowed("PREPARING", "ROUTE_FALLBACK")).toBe(true);
    expect(isTransitionAllowed("VALIDATION_FAILED", "ROUTE_FALLBACK")).toBe(true);
    expect(isTransitionAllowed("SUBMITTING", "ROUTE_FALLBACK")).toBe(true);
  });
});

describe("mandatory human review — the hard gate (brief §2.5)", () => {
  it("blocks authorisation while financial evidence is unreviewed", () => {
    const check = checkTransition("PREPARING", "AWAITING_STUDENT_AUTHORISATION", {
      activeTriggers: ["financial_evidence"],
      completedReviews: [],
    });

    expect(check.permitted).toBe(false);
    if (!check.permitted) {
      expect(check.refusal.kind).toBe("mandatory_review_outstanding");
      expect(check.refusal.detail).toContain("Confidence does not override");
    }
  });

  it("blocks authorisation while a minor is involved and unreviewed", () => {
    const check = checkTransition("PREPARING", "AWAITING_STUDENT_AUTHORISATION", {
      activeTriggers: ["involves_minor"],
      completedReviews: [],
    });

    expect(check.permitted).toBe(false);
    if (!check.permitted) expect(check.refusal.kind).toBe("mandatory_review_outstanding");
  });

  it("blocks on BOTH triggers and reports both", () => {
    const check = checkTransition("PREPARING", "AWAITING_STUDENT_AUTHORISATION", {
      activeTriggers: ["financial_evidence", "involves_minor"],
      completedReviews: [],
    });

    expect(check.permitted).toBe(false);
    if (!check.permitted && check.refusal.kind === "mandatory_review_outstanding") {
      expect(check.refusal.triggers).toHaveLength(2);
    }
  });

  it("still blocks when only one of two mandatory triggers was reviewed", () => {
    // A partial review must not open the gate.
    const check = checkTransition("PREPARING", "AWAITING_STUDENT_AUTHORISATION", {
      activeTriggers: ["financial_evidence", "involves_minor"],
      completedReviews: [approvedReview(["financial_evidence"])],
    });

    expect(check.permitted).toBe(false);
    if (!check.permitted && check.refusal.kind === "mandatory_review_outstanding") {
      expect(check.refusal.triggers).toEqual(["involves_minor"]);
    }
  });

  it("allows authorisation once every mandatory trigger is approved", () => {
    const check = checkTransition("PREPARING", "AWAITING_STUDENT_AUTHORISATION", {
      activeTriggers: ["financial_evidence", "involves_minor"],
      completedReviews: [approvedReview(["financial_evidence", "involves_minor"])],
    });

    expect(check.permitted).toBe(true);
  });

  it("does not treat a rejected review as clearing the trigger", () => {
    const check = checkTransition("PREPARING", "AWAITING_STUDENT_AUTHORISATION", {
      activeTriggers: ["financial_evidence"],
      completedReviews: [
        { reviewerId: "specialist_amara", reviewedAt: new Date(), triggers: ["financial_evidence"], outcome: "rejected" },
      ],
    });

    expect(check.permitted).toBe(false);
  });

  it("does not treat 'changes requested' as clearing the trigger", () => {
    const check = checkTransition("PREPARING", "AWAITING_STUDENT_AUTHORISATION", {
      activeTriggers: ["financial_evidence"],
      completedReviews: [
        { reviewerId: "specialist_amara", reviewedAt: new Date(), triggers: ["financial_evidence"], outcome: "changes_requested" },
      ],
    });

    expect(check.permitted).toBe(false);
  });

  it("does not block on a discretionary trigger alone", () => {
    // Layer one is confidence-based and can be resolved without a human.
    const check = checkTransition("PREPARING", "AWAITING_STUDENT_AUTHORISATION", {
      activeTriggers: ["low_confidence"],
      completedReviews: [],
    });

    expect(check.permitted).toBe(true);
  });
});

describe("authorisation guards (brief §7)", () => {
  it("refuses submission with no captured authorisation", () => {
    const check = checkTransition("AUTHORISED", "SUBMITTING", EMPTY_CONTEXT);
    expect(check.permitted).toBe(false);
    if (!check.permitted) expect(check.refusal.kind).toBe("authorisation_missing");
  });

  it("allows submission when the authorised hash matches what is prepared", () => {
    const check = checkTransition("AUTHORISED", "SUBMITTING", {
      ...EMPTY_CONTEXT,
      authorisedContentHash: "sha256:abc",
      preparedContentHash: "sha256:abc",
    });
    expect(check.permitted).toBe(true);
  });

  it("refuses submission when the content changed after authorisation", () => {
    // "If the content changes after authorisation, the authorisation is void
    //  and must be obtained again." — brief §7
    const check = checkTransition("AUTHORISED", "SUBMITTING", {
      ...EMPTY_CONTEXT,
      authorisedContentHash: "sha256:abc",
      preparedContentHash: "sha256:CHANGED",
    });

    expect(check.permitted).toBe(false);
    if (!check.permitted) {
      expect(check.refusal.kind).toBe("authorisation_stale");
      expect(check.refusal.detail).toContain("void");
    }
  });
});
