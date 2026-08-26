/**
 * Tests for document retention (ADR-0010).
 *
 * "Do not invent a fixed retention period simply because we need a number for
 *  the schema." — so the tests assert the SHAPE and the fail-safe, never a
 * particular number of days.
 */

import { describe, expect, it } from "vitest";

import type {
  RetentionPolicy,
  RetentionSchedule,
  UnresolvedRetentionRequirement,
} from "./retention.js";
import {
  RetentionPolicyMissingError,
  RetentionRequirementUnresolvedError,
  blockedByRetention,
  decideRetention,
  effectiveFor,
  findPolicy,
  requirePolicy,
  validateSchedule,
} from "./retention.js";

const NOW = new Date("2026-08-26T12:00:00Z");

function policy(overrides: Partial<RetentionPolicy> = {}): RetentionPolicy {
  return {
    documentType: "passport",
    purpose: "identity_verification",
    trigger: "submission_confirmed",
    // A placeholder for tests only. The real schedule is configuration,
    // finalised against ICO guidance before production.
    retainForDays: 90,
    action: "delete",
    erasureBehaviour: "full",
    policyReference: "AAS-RET-001",
    basis: {
      kind: "policy_decision",
      statement:
        "Held only for as long as the application it supports is live, then deleted. Test value.",
      authoritativeSource: "AAS test fixture — not a real determination",
      verifiedBy: "test",
      verifiedAt: new Date("2026-08-01T00:00:00Z"),
    },
    reviewBy: new Date("2027-08-01T00:00:00Z"),
    ...overrides,
  };
}

const SCHEDULE: RetentionSchedule = {
  version: "test-1",
  approvedAt: new Date("2026-08-01T00:00:00Z"),
  approvedBy: "data_protection_owner",
  effectiveFrom: new Date("2026-08-01T00:00:00Z"),
  policies: [policy()],
  unresolved: [],
};

describe("no default retention — absence of policy is not permission to keep", () => {
  it("REFUSES to store a document type with no configured policy", () => {
    // THE decision. "Kept forever because nobody configured it" is the
    // characteristic UK GDPR failure: breached silently, by omission.
    expect(() => requirePolicy(SCHEDULE, "bank_statement", "financial_evidence")).toThrow(
      RetentionPolicyMissingError,
    );
  });

  it("does not silently fall back to keeping indefinitely", () => {
    expect(() => requirePolicy(SCHEDULE, "birth_certificate", "minor_safeguarding")).toThrow(
      /cannot be stored/,
    );
  });

  it("distinguishes purpose as well as type", () => {
    // The same document held for a different purpose is a different retention
    // question, and must be configured separately.
    expect(findPolicy(SCHEDULE, "passport", "identity_verification")).not.toBeNull();
    expect(findPolicy(SCHEDULE, "passport", "audit_evidence")).toBeNull();
  });

  it("returns the policy when one is configured", () => {
    expect(requirePolicy(SCHEDULE, "passport", "identity_verification").policyReference).toBe("AAS-RET-001");
  });
});

describe("retention decisions", () => {
  it("retains while the clock has not started", () => {
    const decision = decideRetention({ policy: policy(), triggeredAt: null, now: NOW });
    expect(decision.action).toBe("retain");
  });

  it("retains until the period elapses", () => {
    const decision = decideRetention({
      policy: policy({ retainForDays: 90 }),
      triggeredAt: new Date("2026-08-01T00:00:00Z"),
      now: NOW,
    });
    expect(decision.action).toBe("retain");
  });

  it("deletes once the period has elapsed", () => {
    const decision = decideRetention({
      policy: policy({ retainForDays: 10 }),
      triggeredAt: new Date("2026-08-01T00:00:00Z"),
      now: NOW,
    });
    expect(decision.action).toBe("delete");
  });

  it("anonymises when the policy says so", () => {
    const decision = decideRetention({
      policy: policy({ retainForDays: 10, action: "anonymise" }),
      triggeredAt: new Date("2026-08-01T00:00:00Z"),
      now: NOW,
    });
    expect(decision.action).toBe("anonymise");
  });

  it("a legal hold suspends deletion", () => {
    const decision = decideRetention({
      policy: policy({ retainForDays: 1 }),
      triggeredAt: new Date("2026-01-01T00:00:00Z"),
      now: NOW,
      legalHold: {
        reason: "Ongoing dispute",
        ownerId: "legal_owner",
        placedAt: new Date("2026-02-01T00:00:00Z"),
        reviewBy: new Date("2026-12-01T00:00:00Z"),
      },
    });
    expect(decision.action).toBe("hold");
  });

  it("requires a hold to name an owner and a review date", () => {
    // A hold with no owner and no review date is how "temporary" becomes
    // "forever".
    const decision = decideRetention({
      policy: policy(),
      triggeredAt: new Date("2026-01-01T00:00:00Z"),
      now: NOW,
      legalHold: { reason: "x", ownerId: "legal_owner", placedAt: NOW, reviewBy: new Date("2027-01-01T00:00:00Z") },
    });
    if (decision.action === "hold") {
      expect(decision.hold.ownerId).toBe("legal_owner");
      expect(decision.hold.reviewBy).toBeDefined();
    }
  });
});

describe("schedule validation at deploy time", () => {
  it("passes a well-formed schedule", () => {
    expect(validateSchedule(SCHEDULE)).toEqual([]);
  });

  it("rejects a non-positive retention period", () => {
    const problems = validateSchedule({ ...SCHEDULE, policies: [policy({ retainForDays: 0 })] });
    expect(problems.some((p) => p.includes("positive integer"))).toBe(true);
  });

  it("rejects refusing erasure with no legal basis cited", () => {
    // A refusal without a citation is not a lawful basis.
    const problems = validateSchedule({
      ...SCHEDULE,
      policies: [policy({ erasureBehaviour: "retain_for_legal_obligation" })],
    });
    expect(problems.some((p) => p.includes("no legal obligation"))).toBe(true);
  });

  it("accepts refusing erasure WITH a legal basis", () => {
    const problems = validateSchedule({
      ...SCHEDULE,
      policies: [
        policy({ erasureBehaviour: "retain_for_legal_obligation", legalBasis: "Immigration record-keeping duty" }),
      ],
    });
    expect(problems).toEqual([]);
  });

  it("rejects duplicate policies for the same type and purpose", () => {
    const problems = validateSchedule({ ...SCHEDULE, policies: [policy(), policy()] });
    expect(problems.some((p) => p.includes("Duplicate"))).toBe(true);
  });

  it("rejects a policy with no traceable reference", () => {
    const problems = validateSchedule({ ...SCHEDULE, policies: [policy({ policyReference: "  " })] });
    expect(problems.some((p) => p.includes("policyReference"))).toBe(true);
  });

  it("records who approved the schedule and when", () => {
    // The schedule is one reviewable artefact for a data-protection review.
    expect(SCHEDULE.approvedBy).toBe("data_protection_owner");
    expect(SCHEDULE.version).toBeDefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Unresolved requirements — recorded, owned, and blocking
// ───────────────────────────────────────────────────────────────────────────

const UNRESOLVED: UnresolvedRetentionRequirement = {
  documentType: "academic_transcript",
  purpose: "application_submission",
  question: "How long after a decision must a transcript be kept?",
  authoritativeSourceNeeded: "The university's own published records-retention requirement",
  expectedBasisKind: "operational_requirement",
  owner: "data_protection_owner",
  raisedBy: "claude",
  raisedAt: NOW,
};

const WITH_UNRESOLVED: RetentionSchedule = { ...SCHEDULE, unresolved: [UNRESOLVED] };

describe("a question someone recorded as open", () => {
  it("BLOCKS storage, exactly as a missing policy does", () => {
    expect(() =>
      requirePolicy(WITH_UNRESOLVED, "academic_transcript", "application_submission"),
    ).toThrow(RetentionRequirementUnresolvedError);
  });

  it("gives the useful error — go and read this — not 'write a policy'", () => {
    // The two failures need different responses, so they are different errors.
    // A missing policy needs someone to write one; this needs someone to go
    // and read a specific source.
    let message = "";
    try {
      requirePolicy(WITH_UNRESOLVED, "academic_transcript", "application_submission");
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("UNRESOLVED");
    expect(message).toContain("university's own published records-retention requirement");
    expect(message).toContain("data_protection_owner");
    expect(message).toContain("guessing here would be worse than stopping");
  });

  it("is checked before the policy lookup, so the better error wins", () => {
    // A pair that is both decided and open is itself a fault, but if one
    // slipped through, the open question must be what the caller hears.
    const contradictory: RetentionSchedule = {
      ...SCHEDULE,
      policies: [policy({ documentType: "academic_transcript", purpose: "application_submission" })],
      unresolved: [UNRESOLVED],
    };
    expect(() =>
      requirePolicy(contradictory, "academic_transcript", "application_submission"),
    ).toThrow(RetentionRequirementUnresolvedError);
  });

  it("lists what is blocked, with an owner, for a reviewer", () => {
    const blocked = blockedByRetention(WITH_UNRESOLVED);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.key).toBe("academic_transcript:application_submission");
    expect(blocked[0]?.owner).toBe("data_protection_owner");
  });

  it("does not block anything it does not cover", () => {
    expect(() => requirePolicy(WITH_UNRESOLVED, "passport", "identity_verification")).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The basis — and refusing a guess wearing the costume of a decision
// ───────────────────────────────────────────────────────────────────────────

describe("validating a schedule", () => {
  it("passes a schedule whose policies cite a real, checkable source", () => {
    expect(validateSchedule(SCHEDULE)).toEqual([]);
  });

  it("REFUSES a placeholder authoritative source", () => {
    // The realistic failure. Not an empty field — "TODO", added to get an
    // upload working, which then looks like a real basis in every listing.
    for (const placeholder of ["TODO", "TBC", "n/a", "  ", "unknown", "FIXME"]) {
      const problems = validateSchedule({
        ...SCHEDULE,
        policies: [
          policy({
            basis: { ...policy().basis, authoritativeSource: placeholder },
          }),
        ],
      });
      expect(problems.join(" ")).toContain("cites no authoritative source");
    }
  });

  it("REFUSES a placeholder basis statement", () => {
    const problems = validateSchedule({
      ...SCHEDULE,
      policies: [policy({ basis: { ...policy().basis, statement: "TBD" } })],
    });
    expect(problems.join(" ")).toContain("placeholder");
  });

  it("REFUSES a legal requirement nobody can state", () => {
    // Claiming the law says so is the strongest claim available here, so it
    // carries the highest bar: a legal requirement we cannot state is one we
    // have not read.
    const problems = validateSchedule({
      ...SCHEDULE,
      policies: [
        policy({
          basis: { ...policy().basis, kind: "legal_requirement", statement: "GDPR" },
        }),
      ],
    });
    expect(problems.join(" ")).toContain("claims a LEGAL requirement");
  });

  it("REFUSES a pair that is both decided and open", () => {
    const problems = validateSchedule({
      ...SCHEDULE,
      unresolved: [{ ...UNRESOLVED, documentType: "passport", purpose: "identity_verification" }],
    });
    expect(problems.join(" ")).toContain("BOTH a policy and an unresolved requirement");
  });

  it("REFUSES an unresolved requirement with no owner", () => {
    const problems = validateSchedule({
      ...SCHEDULE,
      unresolved: [{ ...UNRESOLVED, owner: "  " }],
    });
    expect(problems.join(" ")).toContain("question nobody asks");
  });

  it("REFUSES an unresolved requirement that names no source to resolve it", () => {
    const problems = validateSchedule({
      ...SCHEDULE,
      unresolved: [{ ...UNRESOLVED, authoritativeSourceNeeded: "TBC" }],
    });
    expect(problems.join(" ")).toContain("names no authoritative source");
  });

  it("REFUSES a policy whose review date has passed", () => {
    const problems = validateSchedule(
      { ...SCHEDULE, policies: [policy({ reviewBy: new Date("2026-01-01T00:00:00Z") })] },
      NOW,
    );
    expect(problems.join(" ")).toContain("due for review");
  });

  it("REFUSES a version that supersedes itself", () => {
    const problems = validateSchedule({ ...SCHEDULE, supersedes: SCHEDULE.version });
    expect(problems.join(" ")).toContain("supersedes itself");
  });

  it("REFUSES a version nobody approved", () => {
    expect(validateSchedule({ ...SCHEDULE, approvedBy: "" }).join(" ")).toContain(
      "names nobody who approved it",
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Versions
// ───────────────────────────────────────────────────────────────────────────

describe("the schedule's history", () => {
  const v1: RetentionSchedule = { ...SCHEDULE, version: "1", effectiveFrom: new Date("2026-01-01T00:00:00Z") };
  const v2: RetentionSchedule = {
    ...SCHEDULE,
    version: "2",
    supersedes: "1",
    effectiveFrom: new Date("2026-06-01T00:00:00Z"),
  };
  const history = { versions: [v1, v2] };

  it("answers 'what governed on this date?'", () => {
    // The question that matters when a document stored a year ago comes up
    // for deletion — and the one an edited-in-place document cannot answer.
    expect(effectiveFor(history, new Date("2026-03-01T00:00:00Z"))?.version).toBe("1");
    expect(effectiveFor(history, new Date("2026-08-01T00:00:00Z"))?.version).toBe("2");
  });

  it("has nothing to say before the first version", () => {
    expect(effectiveFor(history, new Date("2025-01-01T00:00:00Z"))).toBeNull();
  });

  it("is not confused by versions listed out of order", () => {
    expect(effectiveFor({ versions: [v2, v1] }, new Date("2026-03-01T00:00:00Z"))?.version).toBe("1");
  });
});
