/**
 * Tests for the learning loop (ADR-0008).
 *
 * The load-bearing test in this file is the promotion gate. Vahid:
 *
 *   "Do not interpret 'learning' as allowing the AI to automatically change its
 *    own production behaviour without controls."
 *
 * So: capture is automatic, use is not. Nothing influences production behaviour
 * until a human has validated AND published it.
 */

import { describe, expect, it } from "vitest";

import { blueprintVersion, caseId, courseId, institutionId, interventionId } from "./ids.js";
import type { InterventionLifecycle, InterventionRecord } from "./learning.js";
import { asReusable, canTransitionLifecycle, failurePointOf, reusableOnly } from "./learning.js";
import type { ExecutionCheckpoint } from "./recovery.js";

const CHECKPOINT: ExecutionCheckpoint = {
  blueprintVersion: blueprintVersion("leeds-direct-v3"),
  action: "advance_portal_page",
  target: "funding",
  page: "funding",
  phase: "filling",
  pagesCompleted: ["personal-details", "previous-education", "english-language"],
  capturedAt: new Date("2026-08-26T14:00:00Z"),
};

function record(overrides: Partial<InterventionRecord> = {}): InterventionRecord {
  return {
    interventionId: interventionId("iv_001"),
    caseId: caseId("case_001"),
    escalation: {
      reason: "unfamiliar_validation_error",
      priority: "high",
      encountered: 'Portal rejected the funding amount with "Value must match declared currency".',
      expected: "The blueprint expected a plain numeric field with no currency constraint.",
      checkpoint: CHECKPOINT,
      raisedAt: new Date("2026-08-26T14:00:00Z"),
    },
    resolution: {
      specialistId: "specialist_amara",
      actionsTaken: "Selected GBP in the currency dropdown before entering the amount.",
      resolution:
        "The funding amount field requires the currency dropdown to be set first; " +
        "setting it afterwards silently clears the amount.",
      resolvedAt: new Date("2026-08-26T14:25:00Z"),
      outcome: "resume",
    },
    context: {
      institutionId: institutionId("inst_leeds"),
      portal: "leeds-direct",
      courseId: courseId("crs_msc_data_science"),
      blueprintVersion: blueprintVersion("leeds-direct-v3"),
      page: "funding",
    },
    reusability: {
      scope: "this_institution",
      kind: "blueprint_correction",
      signature: "leeds-direct:funding:currency-before-amount",
    },
    lifecycle: "captured",
    ...overrides,
  };
}

describe("the promotion gate — capture is automatic, use is not", () => {
  it("refuses a freshly captured intervention", () => {
    // THE control. An intervention is recorded the moment it happens, but it
    // cannot influence anything until a human has been through it.
    expect(asReusable(record({ lifecycle: "captured" }))).toBeNull();
  });

  it("refuses one that is still under review", () => {
    expect(asReusable(record({ lifecycle: "under_review" }))).toBeNull();
  });

  it("refuses one that is validated but not yet published", () => {
    // The deliberate gap between "this is correct" and "this is live".
    // Publication is an explicit act, not a side effect of approval.
    expect(asReusable(record({ lifecycle: "validated" }))).toBeNull();
  });

  it("refuses a rejected one", () => {
    expect(asReusable(record({ lifecycle: "rejected" }))).toBeNull();
  });

  it("refuses a superseded one", () => {
    expect(asReusable(record({ lifecycle: "superseded" }))).toBeNull();
  });

  it("allows only a published one", () => {
    const published = record({ lifecycle: "published" });
    expect(asReusable(published)).not.toBeNull();
  });

  it.each<InterventionLifecycle>(["captured", "under_review", "validated", "rejected", "superseded"])(
    "refuses lifecycle %s even with a perfect resolution",
    (lifecycle) => {
      // A well-written, obviously-correct resolution is still not usable until
      // it has been published. Quality is not a substitute for the control.
      expect(asReusable(record({ lifecycle }))).toBeNull();
    },
  );

  it("refuses a published resolution the specialist judged one-off", () => {
    // Over-generalising a fix is how a learning system starts making things
    // worse. `this_case_only` never becomes a general rule, however approved.
    const oneOff = record({
      lifecycle: "published",
      reusability: { scope: "this_case_only", kind: "guidance", signature: "sig" },
    });
    expect(asReusable(oneOff)).toBeNull();
  });
});

describe("filtering a set for use", () => {
  it("returns only publishable records", () => {
    const records = [
      record({ interventionId: interventionId("iv_1"), lifecycle: "captured" }),
      record({ interventionId: interventionId("iv_2"), lifecycle: "validated" }),
      record({ interventionId: interventionId("iv_3"), lifecycle: "published" }),
      record({ interventionId: interventionId("iv_4"), lifecycle: "rejected" }),
      record({ interventionId: interventionId("iv_5"), lifecycle: "published" }),
    ];

    const usable = reusableOnly(records);
    expect(usable).toHaveLength(2);
    expect(usable.map((r) => r.interventionId)).toEqual(["iv_3", "iv_5"]);
  });

  it("returns nothing when nothing has been published", () => {
    expect(reusableOnly([record({ lifecycle: "captured" }), record({ lifecycle: "validated" })])).toEqual([]);
  });

  it("returns nothing for an empty set", () => {
    expect(reusableOnly([])).toEqual([]);
  });
});

describe("the lifecycle itself", () => {
  it("requires review before validation", () => {
    // No path from captured straight to validated or published.
    expect(canTransitionLifecycle("captured", "under_review")).toBe(true);
    expect(canTransitionLifecycle("captured", "validated")).toBe(false);
    expect(canTransitionLifecycle("captured", "published")).toBe(false);
  });

  it("requires validation before publication", () => {
    expect(canTransitionLifecycle("under_review", "validated")).toBe(true);
    expect(canTransitionLifecycle("under_review", "published")).toBe(false);
    expect(canTransitionLifecycle("validated", "published")).toBe(true);
  });

  it("allows rejection at every pre-published stage", () => {
    expect(canTransitionLifecycle("captured", "rejected")).toBe(true);
    expect(canTransitionLifecycle("under_review", "rejected")).toBe(true);
    expect(canTransitionLifecycle("validated", "rejected")).toBe(true);
  });

  it("allows a published record to be withdrawn if it turns out to be wrong", () => {
    expect(canTransitionLifecycle("published", "rejected")).toBe(true);
    expect(canTransitionLifecycle("published", "superseded")).toBe(true);
  });

  it("treats rejected and superseded as final", () => {
    // Kept, never deleted — knowing what did not work is worth having.
    expect(canTransitionLifecycle("rejected", "published")).toBe(false);
    expect(canTransitionLifecycle("rejected", "under_review")).toBe(false);
    expect(canTransitionLifecycle("superseded", "published")).toBe(false);
  });

  it("has no path that reaches published without passing through validated", () => {
    // Exhaustive: whatever the route, publication is preceded by validation.
    const states: readonly InterventionLifecycle[] = [
      "captured",
      "under_review",
      "validated",
      "published",
      "rejected",
      "superseded",
    ];
    for (const from of states) {
      if (canTransitionLifecycle(from, "published")) {
        expect(from).toBe("validated");
      }
    }
  });
});

describe("what a record captures", () => {
  it("carries everything the requirement lists", () => {
    const r = record();

    // what the AI encountered / expected / where it failed
    expect(r.escalation.encountered).toContain("Value must match declared currency");
    expect(r.escalation.expected).toContain("plain numeric field");
    expect(failurePointOf(r).target).toBe("funding");
    expect(failurePointOf(r).action).toBe("advance_portal_page");

    // what the specialist did / what worked
    expect(r.resolution.actionsTaken).toContain("currency dropdown");
    expect(r.resolution.resolution).toContain("silently clears the amount");

    // which university / portal / course / step
    expect(r.context.institutionId).toBe("inst_leeds");
    expect(r.context.portal).toBe("leeds-direct");
    expect(r.context.courseId).toBe("crs_msc_data_science");
    expect(r.context.page).toBe("funding");

    // whether it is reusable
    expect(r.reusability.scope).toBe("this_institution");
    expect(r.reusability.kind).toBe("blueprint_correction");
  });

  it("preserves what the AI had already completed", () => {
    // "Everything the AI had already completed must remain available and
    // auditable" — the checkpoint is where that lives.
    expect(failurePointOf(record()).pagesCompleted).toEqual([
      "personal-details",
      "previous-education",
      "english-language",
    ]);
  });

  it("attributes the resolution to a named specialist", () => {
    // Never a shared account. The existing admin auth uses one shared
    // credential pair, which cannot attribute a decision to a person.
    expect(record().resolution.specialistId).toBe("specialist_amara");
  });
});
