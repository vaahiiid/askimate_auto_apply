/**
 * Tests for two-layer escalation (brief §2.5).
 */

import { describe, expect, it } from "vitest";

import type { HumanReviewRecord } from "./escalation.js";
import { MANDATORY_REVIEW_TRIGGERS, isMandatory, unclearedMandatoryTriggers } from "./escalation.js";

function review(
  triggers: HumanReviewRecord["triggers"],
  outcome: HumanReviewRecord["outcome"] = "approved",
): HumanReviewRecord {
  return { reviewerId: "specialist_amara", reviewedAt: new Date("2026-08-26T11:00:00Z"), triggers, outcome };
}

describe("which triggers are mandatory", () => {
  it("treats financial evidence and minors as mandatory", () => {
    expect(isMandatory("financial_evidence")).toBe(true);
    expect(isMandatory("involves_minor")).toBe(true);
  });

  it("treats confidence-based triggers as discretionary", () => {
    expect(isMandatory("low_confidence")).toBe(false);
    expect(isMandatory("conflicting_information")).toBe(false);
    expect(isMandatory("stale_requirement_data")).toBe(false);
    expect(isMandatory("blueprint_drift")).toBe(false);
    expect(isMandatory("unexpected_portal_behaviour")).toBe(false);
  });

  it("lists exactly the two mandatory triggers the brief names", () => {
    expect([...MANDATORY_REVIEW_TRIGGERS].sort()).toEqual(["financial_evidence", "involves_minor"]);
  });
});

describe("clearing mandatory triggers", () => {
  it("reports nothing outstanding when none are active", () => {
    expect(unclearedMandatoryTriggers([], [])).toEqual([]);
    expect(unclearedMandatoryTriggers(["low_confidence"], [])).toEqual([]);
  });

  it("reports an unreviewed mandatory trigger as outstanding", () => {
    expect(unclearedMandatoryTriggers(["financial_evidence"], [])).toEqual(["financial_evidence"]);
  });

  it("clears a trigger on an approving review", () => {
    expect(unclearedMandatoryTriggers(["financial_evidence"], [review(["financial_evidence"])])).toEqual([]);
  });

  it("does not clear on a rejecting review", () => {
    expect(
      unclearedMandatoryTriggers(["financial_evidence"], [review(["financial_evidence"], "rejected")]),
    ).toEqual(["financial_evidence"]);
  });

  it("does not clear on a changes-requested review", () => {
    expect(
      unclearedMandatoryTriggers(["involves_minor"], [review(["involves_minor"], "changes_requested")]),
    ).toEqual(["involves_minor"]);
  });

  it("clears only the triggers a review actually covered", () => {
    expect(
      unclearedMandatoryTriggers(["financial_evidence", "involves_minor"], [review(["financial_evidence"])]),
    ).toEqual(["involves_minor"]);
  });

  it("accumulates clearance across several reviews", () => {
    expect(
      unclearedMandatoryTriggers(
        ["financial_evidence", "involves_minor"],
        [review(["financial_evidence"]), review(["involves_minor"])],
      ),
    ).toEqual([]);
  });

  it("ignores discretionary triggers entirely", () => {
    // Layer one does not gate; only layer two does.
    expect(unclearedMandatoryTriggers(["low_confidence", "blueprint_drift"], [])).toEqual([]);
  });

  it("is not satisfied by a later rejection following an approval", () => {
    // An approval clears; a subsequent rejection of a DIFFERENT trigger must
    // not un-clear the first.
    expect(
      unclearedMandatoryTriggers(
        ["financial_evidence"],
        [review(["financial_evidence"]), review(["low_confidence"], "rejected")],
      ),
    ).toEqual([]);
  });
});
