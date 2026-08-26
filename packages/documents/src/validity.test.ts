/**
 * Tests for the deterministic validity engine (brief §2.4).
 *
 * "Silently reusing a stale bank statement is the exact failure this system
 *  exists to prevent."
 *
 * The UK Student visa 31-day financial-evidence window is the canonical case,
 * so it gets the most attention here — including the boundary days, where an
 * off-by-one is the difference between a granted and a refused visa.
 */

import { describe, expect, it } from "vitest";

import type { VerifiedRequirement } from "@askimate/aas-domain";

import type { DocumentDates, ValidityRule } from "./validity.js";
import {
  assessAll,
  assessValidity,
  failures,
  isValid,
  ruleFromRequirement,
  validUntil,
} from "./validity.js";

/**
 * A corroborated requirement, as `@askimate/aas-domain` would mint it: both the
 * human-reviewed KB and the official UKVI source, agreeing and fresh.
 *
 * The 31 comes from HERE — a verified requirement — never from the engine.
 */
const VERIFIED_31_DAY = {
  requirementId: "req_financial_recency",
  key: "financial_evidence.recency_days",
  criticality: "critical",
  revalidateBy: new Date("2026-09-30T00:00:00Z"),
  curated: {
    channel: "curated",
    reviewerId: "specialist_amara",
    reviewedAt: new Date("2026-08-10T09:00:00Z"),
    citedSource: "UKVI Student route guidance — financial evidence",
    statedValue: "31 days",
  },
  official: {
    channel: "official",
    sourceUrl: "https://www.gov.uk/student-visa/money",
    retrievedAt: new Date("2026-08-25T06:00:00Z"),
    evidenceExcerpt: "Your bank statement must be dated no more than 31 days before you apply.",
    excerptHash: "sha256:aaa",
    extractedValue: "31 days",
    confidence: 0.96,
  },
} as unknown as VerifiedRequirement;

const THIRTY_ONE_DAY_RULE: ValidityRule = ruleFromRequirement({
  requirement: VERIFIED_31_DAY,
  kind: "recency_window",
  value: 31,
  statement: "Financial evidence must be dated within 31 days of the application.",
});

const APPLY_ON = new Date("2026-09-01T00:00:00Z");

function statement(coversTo: string): DocumentDates {
  return { coversFrom: new Date("2026-07-01T00:00:00Z"), coversTo: new Date(coversTo) };
}

describe("the 31-day financial evidence window", () => {
  it("accepts a statement dated today", () => {
    const assessment = assessValidity(statement("2026-09-01T00:00:00Z"), THIRTY_ONE_DAY_RULE, APPLY_ON);
    expect(assessment.valid).toBe(true);
  });

  it("accepts a statement exactly 31 days old — the last valid day", () => {
    // Boundary. 1 August to 1 September is 31 days.
    const assessment = assessValidity(statement("2026-08-01T00:00:00Z"), THIRTY_ONE_DAY_RULE, APPLY_ON);
    expect(assessment.valid).toBe(true);
  });

  it("REJECTS a statement 32 days old — one day past", () => {
    // The failure the system exists to prevent. One day either side of this
    // boundary is the difference between a granted and a refused visa.
    const assessment = assessValidity(statement("2026-07-31T00:00:00Z"), THIRTY_ONE_DAY_RULE, APPLY_ON);

    expect(assessment.valid).toBe(false);
    if (!assessment.valid) {
      expect(assessment.reason).toBe("outside_recency_window");
      expect(assessment.detail).toContain("32 days");
      expect(assessment.detail).toContain("more recent document is needed");
    }
  });

  it("rejects a badly stale statement", () => {
    const assessment = assessValidity(statement("2026-01-15T00:00:00Z"), THIRTY_ONE_DAY_RULE, APPLY_ON);
    expect(assessment.valid).toBe(false);
  });

  it("measures from the END of the covered period, not the start", () => {
    // A statement covering January to late August is fresh; measuring from
    // January would wrongly reject it.
    const assessment = assessValidity(
      { coversFrom: new Date("2026-01-01T00:00:00Z"), coversTo: new Date("2026-08-25T00:00:00Z") },
      THIRTY_ONE_DAY_RULE,
      APPLY_ON,
    );
    expect(assessment.valid).toBe(true);
  });

  it("falls back to the issue date when there is no covered period", () => {
    const assessment = assessValidity(
      { issuedAt: new Date("2026-08-20T00:00:00Z") },
      THIRTY_ONE_DAY_RULE,
      APPLY_ON,
    );
    expect(assessment.valid).toBe(true);
  });

  it("REJECTS a future-dated document rather than treating it as very fresh", () => {
    // A mis-read date must not sail through as "extremely recent".
    const assessment = assessValidity(statement("2026-12-01T00:00:00Z"), THIRTY_ONE_DAY_RULE, APPLY_ON);
    expect(assessment.valid).toBe(false);
    if (!assessment.valid) expect(assessment.detail).toContain("in the future");
  });

  it("REJECTS a document with no date at all", () => {
    // The safe direction is "we cannot confirm this is valid", never "we found
    // no reason to doubt it".
    const assessment = assessValidity({}, THIRTY_ONE_DAY_RULE, APPLY_ON);
    expect(assessment.valid).toBe(false);
    if (!assessment.valid) expect(assessment.reason).toBe("required_date_missing");
  });

  it("reports when the document stops being valid, so we can ask in advance", () => {
    const assessment = assessValidity(statement("2026-08-25T00:00:00Z"), THIRTY_ONE_DAY_RULE, APPLY_ON);
    if (assessment.valid) {
      expect(assessment.validUntil).toEqual(new Date("2026-09-25T00:00:00Z"));
    }
  });

  it("is deterministic — same inputs, same answer, every time", () => {
    // No model call, no confidence, no heuristic. This is the property that
    // makes the check trustworthy where it matters most.
    const dates = statement("2026-08-05T00:00:00Z");
    const first = assessValidity(dates, THIRTY_ONE_DAY_RULE, APPLY_ON);
    for (let i = 0; i < 50; i += 1) {
      expect(assessValidity(dates, THIRTY_ONE_DAY_RULE, APPLY_ON)).toEqual(first);
    }
  });

  it("goes stale as the application date moves, with the document unchanged", () => {
    // The same document, valid in September, invalid in October. Nothing about
    // the document changed — which is exactly why reuse cannot be automatic.
    const dates = statement("2026-08-25T00:00:00Z");
    expect(assessValidity(dates, THIRTY_ONE_DAY_RULE, APPLY_ON).valid).toBe(true);
    expect(assessValidity(dates, THIRTY_ONE_DAY_RULE, new Date("2026-10-01T00:00:00Z")).valid).toBe(false);
  });
});

describe("the rule must come from a verified requirement", () => {
  it("carries the requirement it came from", () => {
    // A rule with no citation is not a rule. The engine is deterministic; the
    // number it is deterministic about is sourced and verified elsewhere.
    expect(THIRTY_ONE_DAY_RULE.requirementId).toBe("req_financial_recency");
  });

  it("refuses a non-positive value", () => {
    expect(() =>
      ruleFromRequirement({ requirement: VERIFIED_31_DAY, kind: "recency_window", value: 0, statement: "x" }),
    ).toThrow(RangeError);
    expect(() =>
      ruleFromRequirement({ requirement: VERIFIED_31_DAY, kind: "recency_window", value: -5, statement: "x" }),
    ).toThrow(RangeError);
  });

  it("contains no hardcoded window anywhere", () => {
    // The engine does not know what 31 means. It is handed the number.
    const fourteenDay = ruleFromRequirement({
      requirement: VERIFIED_31_DAY,
      kind: "recency_window",
      value: 14,
      statement: "This university requires evidence dated within 14 days.",
    });

    // A 20-day-old statement passes the 31-day rule and fails the 14-day one.
    const dates = statement("2026-08-12T00:00:00Z");
    expect(assessValidity(dates, THIRTY_ONE_DAY_RULE, APPLY_ON).valid).toBe(true);
    expect(assessValidity(dates, fourteenDay, APPLY_ON).valid).toBe(false);
  });
});

describe("expiry dates", () => {
  const passportRule: ValidityRule = ruleFromRequirement({
    requirement: VERIFIED_31_DAY,
    kind: "expiry_date",
    value: 1,
    statement: "Your passport must be valid.",
  });

  it("accepts an unexpired document", () => {
    expect(assessValidity({ expiresAt: new Date("2030-01-01T00:00:00Z") }, passportRule, APPLY_ON).valid).toBe(true);
  });

  it("rejects an expired document", () => {
    const assessment = assessValidity({ expiresAt: new Date("2026-01-01T00:00:00Z") }, passportRule, APPLY_ON);
    expect(assessment.valid).toBe(false);
    if (!assessment.valid) expect(assessment.reason).toBe("expired");
  });

  it("rejects a document expiring exactly today", () => {
    // Same-day expiry is not valid for an application submitted today.
    expect(assessValidity({ expiresAt: APPLY_ON }, passportRule, APPLY_ON).valid).toBe(false);
  });

  it("rejects a document with no expiry recorded", () => {
    expect(assessValidity({}, passportRule, APPLY_ON).valid).toBe(false);
  });
});

describe("minimum coverage and issue windows", () => {
  const coverage28: ValidityRule = ruleFromRequirement({
    requirement: VERIFIED_31_DAY,
    kind: "minimum_coverage",
    value: 28,
    statement: "Funds must be held for a consecutive 28-day period.",
  });

  it("accepts a statement covering enough days", () => {
    expect(
      assessValidity(
        { coversFrom: new Date("2026-08-01T00:00:00Z"), coversTo: new Date("2026-08-29T00:00:00Z") },
        coverage28,
        APPLY_ON,
      ).valid,
    ).toBe(true);
  });

  it("rejects a statement covering too few days", () => {
    const assessment = assessValidity(
      { coversFrom: new Date("2026-08-20T00:00:00Z"), coversTo: new Date("2026-08-29T00:00:00Z") },
      coverage28,
      APPLY_ON,
    );
    expect(assessment.valid).toBe(false);
    if (!assessment.valid) expect(assessment.reason).toBe("insufficient_coverage");
  });

  it("rejects a document issued too long ago", () => {
    const issuedWithin6Months: ValidityRule = ruleFromRequirement({
      requirement: VERIFIED_31_DAY,
      kind: "issued_within",
      value: 6,
      statement: "Transcripts must be issued within the last 6 months.",
    });

    expect(assessValidity({ issuedAt: new Date("2026-07-01T00:00:00Z") }, issuedWithin6Months, APPLY_ON).valid).toBe(true);
    expect(assessValidity({ issuedAt: new Date("2025-01-01T00:00:00Z") }, issuedWithin6Months, APPLY_ON).valid).toBe(false);
  });
});

describe("assessing several rules at once", () => {
  const coverage28: ValidityRule = ruleFromRequirement({
    requirement: VERIFIED_31_DAY,
    kind: "minimum_coverage",
    value: 28,
    statement: "Funds must be held for 28 consecutive days.",
  });

  it("is valid only when EVERY rule passes", () => {
    // No weighting, no majority. One failing rule is enough.
    const good = assessAll(
      { coversFrom: new Date("2026-08-01T00:00:00Z"), coversTo: new Date("2026-08-29T00:00:00Z") },
      [THIRTY_ONE_DAY_RULE, coverage28],
      APPLY_ON,
    );
    expect(isValid(good)).toBe(true);

    // Fresh enough, but only 9 days of coverage.
    const short = assessAll(
      { coversFrom: new Date("2026-08-20T00:00:00Z"), coversTo: new Date("2026-08-29T00:00:00Z") },
      [THIRTY_ONE_DAY_RULE, coverage28],
      APPLY_ON,
    );
    expect(isValid(short)).toBe(false);
    expect(failures(short)).toHaveLength(1);
  });

  it("explains every failure, so the student is told all of it at once", () => {
    // Being told "and also…" after fixing the first problem is a bad
    // experience and an avoidable round trip.
    const bad = assessAll(
      { coversFrom: new Date("2026-01-01T00:00:00Z"), coversTo: new Date("2026-01-05T00:00:00Z") },
      [THIRTY_ONE_DAY_RULE, coverage28],
      APPLY_ON,
    );
    expect(failures(bad)).toHaveLength(2);
  });

  it("reports the earliest date anything goes stale", () => {
    const assessments = assessAll(
      { coversFrom: new Date("2026-08-01T00:00:00Z"), coversTo: new Date("2026-08-29T00:00:00Z"), expiresAt: new Date("2026-09-10T00:00:00Z") },
      [
        THIRTY_ONE_DAY_RULE,
        ruleFromRequirement({ requirement: VERIFIED_31_DAY, kind: "expiry_date", value: 1, statement: "Must be valid." }),
      ],
      APPLY_ON,
    );
    // The recency window runs to 29 September; the expiry is 10 September.
    expect(validUntil(assessments)).toEqual(new Date("2026-09-10T00:00:00Z"));
  });

  it("returns null when nothing expires", () => {
    const coverageOnly = assessAll(
      { coversFrom: new Date("2026-08-01T00:00:00Z"), coversTo: new Date("2026-08-29T00:00:00Z") },
      [coverage28],
      APPLY_ON,
    );
    expect(validUntil(coverageOnly)).toBeNull();
  });
});
