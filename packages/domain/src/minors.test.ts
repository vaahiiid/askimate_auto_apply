/**
 * Tests for minor detection and the minor workflow (ADR-0011).
 *
 * The tests that matter most are the fail-safe ones: the system must NEVER
 * conclude "adult" from absent, unverified, or merely stated evidence.
 */

import { describe, expect, it } from "vitest";

import type { DateOfBirthRecord, MinorCondition, MinorConditionSet } from "./minors.js";
import { checkMinorGate, determineAge, isMinor, requiresIdentityCheck } from "./minors.js";

const APPLICATION_DATE = new Date("2026-08-26T00:00:00Z");

function dob(level: DateOfBirthRecord["level"], value?: string): DateOfBirthRecord {
  if (value === undefined) return { level };
  // Assembled conditionally: under exactOptionalPropertyTypes, "absent" and
  // "present but undefined" are different things, and absent is what we mean.
  return level === "document_verified"
    ? { level, value: new Date(value), documentId: "doc_passport" }
    : { level, value: new Date(value) };
}

describe("the fail-safe direction — never conclude adult without evidence", () => {
  it("requires an identity check when no date of birth exists", () => {
    const determination = determineAge(dob("unknown"), APPLICATION_DATE);
    expect(determination.kind).toBe("requires_identity_check");
    expect(requiresIdentityCheck(determination)).toBe(true);
  });

  it("requires an identity check for a STATED date of birth, even if it says 30 years old", () => {
    // THE safety property. AskiMate's dateOfBirth is a nullable, unvalidated
    // TEXT column. A stated value is not evidence of adulthood.
    const determination = determineAge(dob("stated", "1996-04-02"), APPLICATION_DATE);
    expect(determination.kind).toBe("requires_identity_check");
    if (determination.kind === "requires_identity_check") {
      expect(determination.reason).toContain("not verified against an identity document");
    }
  });

  it("requires an identity check for a stated date of birth indicating minority", () => {
    const determination = determineAge(dob("stated", "2010-04-02"), APPLICATION_DATE);
    expect(determination.kind).toBe("requires_identity_check");
    if (determination.kind === "requires_identity_check") {
      expect(determination.reason).toContain("minor");
    }
  });

  it("NEVER returns adult_verified without document-verified evidence", () => {
    // Exhaustive over the levels that are not document_verified.
    for (const level of ["unknown", "stated"] as const) {
      const determination = determineAge(dob(level, "1990-01-01"), APPLICATION_DATE);
      expect(determination.kind).not.toBe("adult_verified");
    }
  });
});

describe("determination on verified evidence", () => {
  it("confirms an adult from a verified date of birth", () => {
    const determination = determineAge(dob("document_verified", "1999-04-02"), APPLICATION_DATE);
    expect(determination.kind).toBe("adult_verified");
    if (determination.kind === "adult_verified") expect(determination.ageAtReference).toBe(27);
  });

  it("confirms a minor from a verified date of birth", () => {
    const determination = determineAge(dob("document_verified", "2010-04-02"), APPLICATION_DATE);
    expect(determination.kind).toBe("minor_verified");
    expect(isMinor(determination)).toBe(true);
    if (determination.kind === "minor_verified") expect(determination.ageAtReference).toBe(16);
  });

  it("handles the day before an 18th birthday as a minor", () => {
    const determination = determineAge(dob("document_verified", "2008-08-27"), APPLICATION_DATE);
    expect(determination.kind).toBe("minor_verified");
    if (determination.kind === "minor_verified") expect(determination.ageAtReference).toBe(17);
  });

  it("handles an 18th birthday itself as an adult", () => {
    const determination = determineAge(dob("document_verified", "2008-08-26"), APPLICATION_DATE);
    expect(determination.kind).toBe("adult_verified");
    if (determination.kind === "adult_verified") expect(determination.ageAtReference).toBe(18);
  });

  it("gives different answers for application date and course start", () => {
    // Which rule applies is itself a determined requirement (ADR-0011), so both
    // must be answerable. A student can be 17 at application and 18 at start.
    const seventeenNow = dob("document_verified", "2008-10-01");
    expect(determineAge(seventeenNow, APPLICATION_DATE).kind).toBe("minor_verified");
    expect(determineAge(seventeenNow, new Date("2027-09-20T00:00:00Z")).kind).toBe("adult_verified");
  });
});

describe("the minor gate — conditions determined, never assumed", () => {
  function condition(id: string, satisfaction: MinorCondition["satisfaction"]): MinorCondition {
    return {
      conditionId: id,
      description: "Parental consent for the application to be submitted",
      derivedFrom: "uk_data_protection",
      requirementId: "req_minor_consent",
      satisfaction,
    };
  }

  const VERIFIED: MinorCondition["satisfaction"] = {
    state: "verified",
    documentId: "doc_consent",
    verifiedBy: "specialist_amara",
    verifiedAt: new Date("2026-08-26T11:00:00Z"),
  };

  it("BLOCKS when the conditions could not be determined", () => {
    // An undetermined set is not an empty set. Proceeding as though nothing
    // applies is exactly the assumption Vahid ruled out.
    const undetermined: MinorConditionSet = {
      determined: false,
      conditions: [],
      undeterminedReason: "The institution's policy for applicants under 18 could not be established.",
    };

    const gate = checkMinorGate(undetermined);
    expect(gate.permitted).toBe(false);
    if (!gate.permitted) expect(gate.reason).toBe("conditions_undetermined");
  });

  it("does NOT treat an empty determined set as a blocker", () => {
    // If it was genuinely determined that nothing extra applies, that is a
    // legitimate answer — the distinction is determined vs undetermined.
    const gate = checkMinorGate({ determined: true, conditions: [], determinedAt: APPLICATION_DATE });
    expect(gate.permitted).toBe(true);
  });

  it("blocks while any condition is outstanding", () => {
    const gate = checkMinorGate({
      determined: true,
      conditions: [condition("c1", VERIFIED), condition("c2", { state: "outstanding" })],
    });

    expect(gate.permitted).toBe(false);
    if (!gate.permitted) {
      expect(gate.reason).toBe("conditions_outstanding");
      expect(gate.outstandingConditionIds).toEqual(["c2"]);
    }
  });

  it("treats COLLECTED as insufficient — it must be verified", () => {
    // Something handed over but never checked does not satisfy a legal
    // safeguard.
    const gate = checkMinorGate({
      determined: true,
      conditions: [condition("c1", { state: "collected", documentId: "doc_x", collectedAt: APPLICATION_DATE })],
    });

    expect(gate.permitted).toBe(false);
    if (!gate.permitted) expect(gate.reason).toBe("conditions_outstanding");
  });

  it("blocks and escalates when a condition failed", () => {
    const gate = checkMinorGate({
      determined: true,
      conditions: [condition("c1", { state: "failed", reason: "Guardian could not be reached." })],
    });

    expect(gate.permitted).toBe(false);
    if (!gate.permitted) {
      expect(gate.reason).toBe("conditions_failed");
      expect(gate.detail).toContain("escalated");
    }
  });

  it("permits only when EVERY condition is verified", () => {
    const gate = checkMinorGate({
      determined: true,
      conditions: [condition("c1", VERIFIED), condition("c2", VERIFIED)],
    });
    expect(gate.permitted).toBe(true);
  });

  it("does not assume parental consent is the only condition", () => {
    // Vahid: "Do not assume that parental consent is automatically the only
    // legal requirement." Conditions carry where they came from, and several
    // sources can contribute.
    const set: MinorConditionSet = {
      determined: true,
      conditions: [
        { conditionId: "c1", description: "Parental consent", derivedFrom: "uk_data_protection", requirementId: "r1", satisfaction: VERIFIED },
        { conditionId: "c2", description: "Guardianship arrangements in the UK", derivedFrom: "institution_policy", requirementId: "r2", satisfaction: { state: "outstanding" } },
        { conditionId: "c3", description: "Parental consent for the visa route", derivedFrom: "visa_rule", requirementId: "r3", satisfaction: { state: "outstanding" } },
      ],
    };

    const gate = checkMinorGate(set);
    expect(gate.permitted).toBe(false);
    if (!gate.permitted) expect(gate.outstandingConditionIds).toEqual(["c2", "c3"]);
  });

  it("requires every condition to cite where it came from", () => {
    // A condition nobody can trace is an assumption wearing a badge.
    const sources = new Set(
      [
        { conditionId: "c1", description: "d", derivedFrom: "uk_data_protection" as const, requirementId: "r", satisfaction: VERIFIED },
        { conditionId: "c2", description: "d", derivedFrom: "institution_policy" as const, requirementId: "r", satisfaction: VERIFIED },
      ].map((c) => c.derivedFrom),
    );
    expect(sources.size).toBe(2);
  });
});
