/**
 * Tests for requirement provenance and verification (ADR-0009).
 *
 * "The system must know where a requirement came from and whether it has been
 *  verified before using it in an application decision."
 */

import { describe, expect, it } from "vitest";

import type { CuratedEvidence, OfficialEvidence, Requirement } from "./requirements.js";
import {
  assessUsability,
  blocksApplication,
  channelsAgree,
  inScope,
  officialSourceChanged,
  usableOnly,
  verificationStatusOf,
  verifiedRequirement,
} from "./requirements.js";

const NOW = new Date("2026-08-26T12:00:00Z");
const FRESH = new Date("2026-09-30T00:00:00Z");
const EXPIRED = new Date("2026-08-01T00:00:00Z");

const CURATED: CuratedEvidence = {
  channel: "curated",
  reviewerId: "specialist_amara",
  reviewedAt: new Date("2026-08-10T09:00:00Z"),
  citedSource: "UKVI Student route guidance, section on financial evidence",
  statedValue: "31 days",
};

const OFFICIAL: OfficialEvidence = {
  channel: "official",
  sourceUrl: "https://www.gov.uk/student-visa/money",
  retrievedAt: new Date("2026-08-25T06:00:00Z"),
  evidenceExcerpt: "Your bank statement must be dated no more than 31 days before you apply.",
  excerptHash: "sha256:aaa",
  extractedValue: "31 days",
  confidence: 0.96,
};

function req(overrides: Partial<Requirement> = {}): Requirement {
  return {
    requirementId: "req_001",
    key: "financial_evidence.recency_days",
    criticality: "critical",
    // A visa rule, not a university-application rule — the very distinction
    // ADR-0021 exists to make explicit.
    scope: "student_visa",
    revalidateBy: FRESH,
    ...overrides,
  };
}

describe("verification status", () => {
  it("is unverified with no evidence at all", () => {
    expect(verificationStatusOf(req(), NOW)).toBe("unverified");
  });

  it("is curated_only with just a human-reviewed entry", () => {
    expect(verificationStatusOf(req({ curated: CURATED }), NOW)).toBe("curated_only");
  });

  it("is official_only with just an official-source reading", () => {
    expect(verificationStatusOf(req({ official: OFFICIAL }), NOW)).toBe("official_only");
  });

  it("is corroborated when both channels agree", () => {
    expect(verificationStatusOf(req({ curated: CURATED, official: OFFICIAL }), NOW)).toBe("corroborated");
  });

  it("is conflicted when the channels disagree", () => {
    const disagreeing = req({
      curated: CURATED,
      official: { ...OFFICIAL, extractedValue: "28 days" },
    });
    expect(verificationStatusOf(disagreeing, NOW)).toBe("conflicted");
  });

  it("is stale past the revalidate-by date", () => {
    expect(verificationStatusOf(req({ curated: CURATED, revalidateBy: EXPIRED }), NOW)).toBe("stale");
  });

  it("does not treat two STALE agreeing sources as corroboration", () => {
    // Two out-of-date answers that happen to match is not verification.
    const staleBoth = req({ curated: CURATED, official: OFFICIAL, revalidateBy: EXPIRED });
    expect(verificationStatusOf(staleBoth, NOW)).toBe("stale");
  });
});

describe("agreement between channels", () => {
  it("ignores whitespace and case differences", () => {
    expect(channelsAgree(CURATED, { ...OFFICIAL, extractedValue: "  31 DAYS  " })).toBe(true);
  });

  it("treats a different value as disagreement", () => {
    expect(channelsAgree(CURATED, { ...OFFICIAL, extractedValue: "28 days" })).toBe(false);
  });

  it("does not fuzzy-match near-misses", () => {
    // A "close enough" comparison would be the system deciding two different
    // answers are the same answer. That is the failure this design prevents.
    expect(channelsAgree(CURATED, { ...OFFICIAL, extractedValue: "31 calendar days" })).toBe(false);
    expect(channelsAgree(CURATED, { ...OFFICIAL, extractedValue: "about 31 days" })).toBe(false);
  });
});

describe("the evidence bar — consequence, not confidence", () => {
  it("requires corroboration for a critical requirement", () => {
    // THE rule. The 31-day financial window is the canonical example: being
    // wrong costs a student their visa.
    const curatedOnly = assessUsability(req({ criticality: "critical", curated: CURATED }), NOW);
    expect(curatedOnly.usable).toBe(false);
    if (!curatedOnly.usable) {
      expect(curatedOnly.reason).toBe("insufficient_corroboration");
      expect(curatedOnly.detail).toContain("BOTH");
    }

    const officialOnly = assessUsability(req({ criticality: "critical", official: OFFICIAL }), NOW);
    expect(officialOnly.usable).toBe(false);

    const both = assessUsability(req({ criticality: "critical", curated: CURATED, official: OFFICIAL }), NOW);
    expect(both.usable).toBe(true);
  });

  it("does not let high extraction confidence substitute for corroboration", () => {
    // Confidence is a layer-one escalation signal, never a promotion mechanism.
    const certain = assessUsability(
      req({ criticality: "critical", official: { ...OFFICIAL, confidence: 1 } }),
      NOW,
    );
    expect(certain.usable).toBe(false);
    if (!certain.usable) {
      expect(certain.detail).toContain("Confidence does not substitute");
    }
  });

  it("accepts a single verified channel for a material requirement", () => {
    expect(assessUsability(req({ criticality: "material", curated: CURATED }), NOW).usable).toBe(true);
    expect(assessUsability(req({ criticality: "material", official: OFFICIAL }), NOW).usable).toBe(true);
  });

  it("accepts a single channel for a procedural requirement", () => {
    expect(assessUsability(req({ criticality: "procedural", official: OFFICIAL }), NOW).usable).toBe(true);
  });

  it("never accepts a requirement with no evidence, at any criticality", () => {
    for (const criticality of ["critical", "material", "procedural"] as const) {
      const assessment = assessUsability(req({ criticality }), NOW);
      expect(assessment.usable).toBe(false);
      if (!assessment.usable) expect(assessment.reason).toBe("no_evidence");
    }
  });

  it("never accepts stale evidence, at any criticality", () => {
    for (const criticality of ["critical", "material", "procedural"] as const) {
      const assessment = assessUsability(
        req({ criticality, curated: CURATED, official: OFFICIAL, revalidateBy: EXPIRED }),
        NOW,
      );
      expect(assessment.usable).toBe(false);
      if (!assessment.usable) expect(assessment.reason).toBe("stale");
    }
  });
});

describe("conflict is never resolved automatically", () => {
  const conflicted = (criticality: Requirement["criticality"]): Requirement =>
    req({ criticality, curated: CURATED, official: { ...OFFICIAL, extractedValue: "28 days" } });

  it("refuses a conflicted requirement at EVERY criticality", () => {
    // Vahid: "Where the sources conflict or the information is ambiguous, the
    // system should not guess. It should escalate for human review."
    for (const criticality of ["critical", "material", "procedural"] as const) {
      const assessment = assessUsability(conflicted(criticality), NOW);
      expect(assessment.usable).toBe(false);
      if (!assessment.usable) expect(assessment.reason).toBe("conflicting_sources");
    }
  });

  it("does not prefer the fresher source", () => {
    // The official reading is 15 days newer than the curated one. It still
    // does not win — freshness is not correctness.
    const assessment = assessUsability(conflicted("material"), NOW);
    expect(assessment.usable).toBe(false);
  });

  it("reports both values so a specialist can adjudicate", () => {
    const assessment = assessUsability(conflicted("critical"), NOW);
    if (!assessment.usable) {
      expect(assessment.detail).toContain("31 days");
      expect(assessment.detail).toContain("28 days");
      expect(assessment.detail).toContain("human specialist");
    }
  });
});

describe("the usability gate", () => {
  it("mints a verified requirement only when the bar is met", () => {
    expect(verifiedRequirement(req({ curated: CURATED, official: OFFICIAL }), NOW)).not.toBeNull();
    expect(verifiedRequirement(req({ curated: CURATED }), NOW)).toBeNull();
  });

  it("filters a set down to what is safe to act on", () => {
    const requirements = [
      req({ requirementId: "r1", criticality: "critical", curated: CURATED, official: OFFICIAL }),
      req({ requirementId: "r2", criticality: "critical", curated: CURATED }),
      req({ requirementId: "r3", criticality: "material", official: OFFICIAL }),
      req({ requirementId: "r4", criticality: "material", curated: CURATED, official: { ...OFFICIAL, extractedValue: "x" } }),
    ];

    expect(usableOnly(requirements, NOW).map((r) => r.requirementId)).toEqual(["r1", "r3"]);
  });
});

describe("change detection", () => {
  it("flags a changed source even when the value looks the same", () => {
    // A university rewording a page in a way that changes meaning without
    // changing the number is otherwise invisible.
    const before = OFFICIAL;
    const after = {
      ...OFFICIAL,
      evidenceExcerpt: "Your bank statement must be dated no more than 31 days before your CAS is issued.",
      excerptHash: "sha256:bbb",
      extractedValue: "31 days",
    };

    expect(after.extractedValue).toBe(before.extractedValue);
    expect(officialSourceChanged(before, after)).toBe(true);
  });

  it("does not flag an unchanged source", () => {
    expect(officialSourceChanged(OFFICIAL, { ...OFFICIAL, retrievedAt: NOW })).toBe(false);
  });
});

describe("provenance is preserved", () => {
  it("records who reviewed the curated entry and what they cited", () => {
    const r = req({ curated: CURATED });
    expect(r.curated?.reviewerId).toBe("specialist_amara");
    expect(r.curated?.citedSource).toContain("UKVI");
  });

  it("records the official URL, retrieval time and the excerpt read", () => {
    const r = req({ official: OFFICIAL });
    expect(r.official?.sourceUrl).toContain("gov.uk");
    expect(r.official?.retrievedAt).toEqual(new Date("2026-08-25T06:00:00Z"));
    expect(r.official?.evidenceExcerpt).toContain("31 days");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Scope — a university application requirement is not a visa requirement
// ───────────────────────────────────────────────────────────────────────────

describe("what a requirement actually blocks", () => {
  it("does not let a VISA requirement block a university application", () => {
    // Financial evidence is genuinely critical — being wrong about the 31-day
    // window costs a visa — and a UK university does not ask for it before
    // considering an application. Blocking on it would stop a perfectly valid
    // application for a rule that does not apply yet.
    const financialEvidence = req({ scope: "student_visa", criticality: "critical" });
    expect(blocksApplication(financialEvidence)).toBe(false);
  });

  it("lets an application requirement block, whatever its criticality", () => {
    expect(blocksApplication(req({ scope: "university_application", criticality: "procedural" })))
      .toBe(true);
    expect(blocksApplication(req({ scope: "university_application", criticality: "critical" })))
      .toBe(true);
  });

  it("lets an institution-compliance requirement block", () => {
    // ATAS, right-to-study checks. The institution cannot proceed without them
    // either, so they are not the student's problem to defer.
    expect(blocksApplication(req({ scope: "institution_compliance" }))).toBe(true);
  });

  it("leaves the evidence bar completely untouched", () => {
    // The whole point of separating the axes. A visa requirement is out of
    // scope for the application AND still needs corroboration when it is in
    // scope for the visa. Scope decides WHEN; criticality decides HOW MUCH.
    const curatedOnly = req({
      scope: "student_visa",
      criticality: "critical",
      curated: CURATED,
    });

    const usability = assessUsability(curatedOnly, NOW);
    expect(usability.usable).toBe(false);
    if (usability.usable) expect.unreachable("critical needs both channels");
    expect(usability.reason).toBe("insufficient_corroboration");
  });

  it("separates the two sets", () => {
    const requirements = [
      req({ requirementId: "a", scope: "university_application" }),
      req({ requirementId: "b", scope: "student_visa" }),
      req({ requirementId: "c", scope: "university_application" }),
    ];
    expect(inScope(requirements, "university_application").map((r) => r.requirementId)).toEqual([
      "a",
      "c",
    ]);
    expect(inScope(requirements, "student_visa").map((r) => r.requirementId)).toEqual(["b"]);
  });
});
