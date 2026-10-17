/**
 * Tests for two-layer escalation (brief §2.5).
 */

import { describe, expect, it } from "vitest";

import type { HumanReviewRecord, ReviewFingerprints } from "./escalation.js";
import { MANDATORY_REVIEW_TRIGGERS, isMandatory, unclearedMandatoryTriggers } from "./escalation.js";

/** Each mandatory trigger raised with the fingerprint of the content that raised it. */
const RAISED: ReviewFingerprints = { financial_evidence: "sha256:funds-1", involves_minor: "sha256:dob-1" };

/**
 * A review that saw the content each trigger was raised for, unless told
 * otherwise; `null` records one with no fingerprint, as before P318 (a default
 * parameter would quietly turn `undefined` back into `RAISED`).
 */
function review(
  triggers: HumanReviewRecord["triggers"],
  outcome: HumanReviewRecord["outcome"] = "approved",
  covers: ReviewFingerprints | null = RAISED,
): HumanReviewRecord {
  return { reviewerId: "specialist_amara", reviewedAt: new Date("2026-08-26T11:00:00Z"), triggers, outcome, ...(covers === null ? {} : { covers }) };
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
    expect(unclearedMandatoryTriggers([], [], RAISED)).toEqual([]);
    expect(unclearedMandatoryTriggers(["low_confidence"], [], RAISED)).toEqual([]);
  });

  it("reports an unreviewed mandatory trigger as outstanding", () => {
    expect(unclearedMandatoryTriggers(["financial_evidence"], [], RAISED)).toEqual(["financial_evidence"]);
  });

  it("clears a trigger on an approving review", () => {
    expect(unclearedMandatoryTriggers(["financial_evidence"], [review(["financial_evidence"])], RAISED)).toEqual([]);
  });

  it("does not clear on a rejecting review", () => {
    expect(
      unclearedMandatoryTriggers(["financial_evidence"], [review(["financial_evidence"], "rejected")], RAISED),
    ).toEqual(["financial_evidence"]);
  });

  it("does not clear on a changes-requested review", () => {
    expect(
      unclearedMandatoryTriggers(["involves_minor"], [review(["involves_minor"], "changes_requested")], RAISED),
    ).toEqual(["involves_minor"]);
  });

  it("clears only the triggers a review actually covered", () => {
    expect(
      unclearedMandatoryTriggers(["financial_evidence", "involves_minor"], [review(["financial_evidence"])], RAISED),
    ).toEqual(["involves_minor"]);
  });

  it("accumulates clearance across several reviews", () => {
    expect(
      unclearedMandatoryTriggers(
        ["financial_evidence", "involves_minor"],
        [review(["financial_evidence"]), review(["involves_minor"])],
        RAISED,
      ),
    ).toEqual([]);
  });

  it("ignores discretionary triggers entirely", () => {
    // Layer one does not gate; only layer two does.
    expect(unclearedMandatoryTriggers(["low_confidence", "blueprint_drift"], [], RAISED)).toEqual([]);
  });

  it("is not satisfied by a later rejection following an approval", () => {
    // An approval clears; a subsequent rejection of a DIFFERENT trigger must
    // not un-clear the first.
    expect(
      unclearedMandatoryTriggers(
        ["financial_evidence"],
        [review(["financial_evidence"]), review(["low_confidence"], "rejected")],
        RAISED,
      ),
    ).toEqual([]);
  });
});

describe("a review covers only the content it reviewed (ADR-0161 §6, his D3 of 2026-10-17)", () => {
  // His words (docs/run-a/p318-his-answers-on-adr-0161-as-sent.txt): "D3:
  // approved." The rule they approve: an approval counts only while the
  // fingerprint of what it saw is the fingerprint of the content the trigger
  // was last raised for. Financial evidence and minors are reviewed every time;
  // a change after the review is a new time.

  it("does not clear a trigger raised again for changed content, though an earlier review approved it", () => {
    const changed: ReviewFingerprints = { ...RAISED, financial_evidence: "sha256:funds-2" };
    expect(unclearedMandatoryTriggers(["financial_evidence"], [review(["financial_evidence"])], changed)).toEqual(["financial_evidence"]);
  });

  it("clears it again once a review sees the changed content", () => {
    const changed: ReviewFingerprints = { ...RAISED, financial_evidence: "sha256:funds-2" };
    expect(
      unclearedMandatoryTriggers(["financial_evidence"], [review(["financial_evidence"]), review(["financial_evidence"], "approved", changed)], changed),
    ).toEqual([]);
  });

  it("does not let an approval recorded before this rule (no fingerprint) clear anything", () => {
    expect(unclearedMandatoryTriggers(["financial_evidence"], [review(["financial_evidence"], "approved", null)], RAISED)).toEqual(["financial_evidence"]);
  });

  it("does not let any approval clear a trigger raised with no fingerprint", () => {
    expect(unclearedMandatoryTriggers(["involves_minor"], [review(["involves_minor"])], { financial_evidence: "sha256:funds-1" })).toEqual(["involves_minor"]);
  });

  it("does not let an approval of one trigger's content clear the other's", () => {
    expect(
      unclearedMandatoryTriggers(["involves_minor"], [review(["involves_minor"], "approved", { involves_minor: "sha256:funds-1" })], RAISED),
    ).toEqual(["involves_minor"]);
  });

  it("does not let a rejection that saw the current content clear it", () => {
    expect(unclearedMandatoryTriggers(["financial_evidence"], [review(["financial_evidence"], "rejected")], RAISED)).toEqual(["financial_evidence"]);
  });
});
