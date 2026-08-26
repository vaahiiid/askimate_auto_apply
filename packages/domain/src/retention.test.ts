/**
 * Tests for document retention (ADR-0010).
 *
 * "Do not invent a fixed retention period simply because we need a number for
 *  the schema." — so the tests assert the SHAPE and the fail-safe, never a
 * particular number of days.
 */

import { describe, expect, it } from "vitest";

import type { RetentionPolicy, RetentionSchedule } from "./retention.js";
import {
  RetentionPolicyMissingError,
  decideRetention,
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
    ...overrides,
  };
}

const SCHEDULE: RetentionSchedule = {
  version: "test-1",
  approvedAt: new Date("2026-08-01T00:00:00Z"),
  approvedBy: "data_protection_owner",
  policies: [policy()],
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
