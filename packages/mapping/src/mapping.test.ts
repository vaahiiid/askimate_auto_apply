import { describe, expect, it } from "vitest";

import { proposeValue, studentId, unwrapConfirmed } from "@askimate/aas-domain";
import type { ConfirmedProfile, ProfileFieldKey, ProfileFieldType } from "@askimate/aas-profile";
import { applyConfirmation, confirmField, emptyProfile, isDeclined } from "@askimate/aas-profile";

import { checkUsable, constantsIn, unmappedRequiredFields } from "./mapping.js";
import type { MappingSet, UsableMappingSet } from "./mapping.js";
import { fieldsToCollect, isComplete, planFill, textOf } from "./plan.js";
import { FIXTURE_BLUEPRINT, FIXTURE_MAPPING_SET } from "./fixtures/portal.js";

const NOW = new Date("2026-08-26T10:00:00Z");
const STUDENT = studentId("student-1");

function withConfirmed(
  profile: ConfirmedProfile,
  entries: readonly [ProfileFieldKey, unknown][],
): ConfirmedProfile {
  let next = profile;
  for (const [key, value] of entries) {
    const result = applyConfirmation({
      key,
      proposed: proposeValue({
        value: value as ProfileFieldType<ProfileFieldKey>,
        origin: "conversation",
        verbatim: "as stated",
        confidence: 0.9,
      }),
      confirmation: {
        studentRef: STUDENT,
        presentedText: "…",
        respondedAt: NOW,
        response: { kind: "accepted" },
      },
    });
    if (isDeclined(result)) expect.unreachable("the student accepted");
    next = confirmField(next, result, NOW);
  }
  return next;
}

const COMPLETE_PROFILE = withConfirmed(emptyProfile(STUDENT, NOW), [
  ["identity.given_name", "Niloofar"],
  ["identity.family_name", "Hosseini"],
  ["identity.date_of_birth", new Date("1999-04-02T00:00:00Z")],
  ["identity.nationality", "Iranian"],
  ["contact.email", "niloofar.hosseini@example.com"],
  [
    "study.personal_statement",
    "I want to study this course because it builds directly on my industrial engineering degree " +
      "and the operations work I did afterwards.",
  ],
]);

function usable(mappingSet: MappingSet = FIXTURE_MAPPING_SET): UsableMappingSet {
  const check = checkUsable(mappingSet, FIXTURE_BLUEPRINT);
  if (!check.usable) expect.unreachable(`expected a usable mapping set: ${check.refusal.kind}`);
  return check.mappingSet;
}

describe("the gate on a mapping set", () => {
  it("accepts a reviewed set pinned to the blueprint in hand", () => {
    expect(checkUsable(FIXTURE_MAPPING_SET, FIXTURE_BLUEPRINT).usable).toBe(true);
  });

  it("refuses a draft", () => {
    const check = checkUsable({ ...FIXTURE_MAPPING_SET, status: "draft" }, FIXTURE_BLUEPRINT);
    if (check.usable) expect.unreachable("a draft is not usable");
    expect(check.refusal.kind).toBe("not_reviewed");
  });

  it("refuses a set signed off by its own author", () => {
    const check = checkUsable(
      { ...FIXTURE_MAPPING_SET, reviewedBy: FIXTURE_MAPPING_SET.authoredBy },
      FIXTURE_BLUEPRINT,
    );
    if (check.usable) expect.unreachable("self-review is not review");
    expect(check.refusal.kind).toBe("reviewed_by_author");
  });

  it("refuses a set reviewed against a different blueprint version", () => {
    // The portal changed and field refs were renumbered. The old mapping is not
    // stale — it is confident instructions to type real data into wrong boxes.
    const check = checkUsable(FIXTURE_MAPPING_SET, { ...FIXTURE_BLUEPRINT, version: "2.0.0" });
    if (check.usable) expect.unreachable("versions must match");
    expect(check.refusal.kind).toBe("blueprint_mismatch");
  });

  it("refuses a set naming fields the blueprint does not have", () => {
    const check = checkUsable(
      {
        ...FIXTURE_MAPPING_SET,
        mappings: [
          ...FIXTURE_MAPPING_SET.mappings,
          {
            fieldRef: "middle_name",
            source: { kind: "profile_field", fieldKey: "identity.given_name", format: { kind: "text" } },
          },
        ],
      },
      FIXTURE_BLUEPRINT,
    );
    if (check.usable) expect.unreachable("unknown field refs must refuse");
    expect(check.refusal.kind).toBe("unknown_field_refs");
  });

  it("refuses two mappings for the same field", () => {
    const check = checkUsable(
      {
        ...FIXTURE_MAPPING_SET,
        mappings: [
          ...FIXTURE_MAPPING_SET.mappings,
          {
            fieldRef: "given_name",
            source: { kind: "profile_field", fieldKey: "identity.family_name", format: { kind: "text" } },
          },
        ],
      },
      FIXTURE_BLUEPRINT,
    );
    if (check.usable) expect.unreachable("duplicates must refuse");
    expect(check.refusal.kind).toBe("duplicate_mappings");
  });

  it("reports required fields nobody mapped", () => {
    const incomplete: MappingSet = {
      ...FIXTURE_MAPPING_SET,
      mappings: FIXTURE_MAPPING_SET.mappings.filter((m) => m.fieldRef !== "email"),
    };
    expect(unmappedRequiredFields(FIXTURE_BLUEPRINT, incomplete).map((f) => f.fieldRef)).toEqual([
      "email",
    ]);
  });

  it("does not count an optional unmapped field as a gap", () => {
    // `preferred_name` is unmapped on purpose. Leaving an optional field blank
    // is correct behaviour, not an omission to be filled.
    expect(unmappedRequiredFields(FIXTURE_BLUEPRINT, FIXTURE_MAPPING_SET)).toHaveLength(0);
  });
});

describe("planning a fill", () => {
  it("produces one instruction per mapped field, with the portal's notation", () => {
    const plan = planFill(FIXTURE_BLUEPRINT, usable(), COMPLETE_PROFILE);

    const byRef = new Map(plan.instructions.map((i) => [i.fieldRef, textOf(i.value)]));
    expect(byRef.get("given_name")).toBe("Niloofar");
    expect(byRef.get("dob")).toBe("02/04/1999");
    expect(byRef.get("nationality")).toBe("IR");
    expect(byRef.get("course_code")).toBe("PG-EX-2026");
  });

  it("is complete when the profile has everything", () => {
    const plan = planFill(FIXTURE_BLUEPRINT, usable(), COMPLETE_PROFILE);
    expect(plan.blockers).toEqual([]);
    expect(isComplete(plan)).toBe(true);
  });

  it("routes the declaration to the student and never fills it", () => {
    const plan = planFill(FIXTURE_BLUEPRINT, usable(), COMPLETE_PROFILE);

    expect(plan.handoffs.map((h) => h.fieldRef)).toEqual(["declaration"]);
    expect(plan.instructions.map((i) => i.fieldRef)).not.toContain("declaration");
  });

  it("routes the passport to an upload rather than typing anything", () => {
    const plan = planFill(FIXTURE_BLUEPRINT, usable(), COMPLETE_PROFILE);
    expect(plan.uploads.map((u) => u.documentRef)).toEqual(["passport"]);
  });

  it("carries the student's confirmed provenance on their own data", () => {
    const plan = planFill(FIXTURE_BLUEPRINT, usable(), COMPLETE_PROFILE);
    const dob = plan.instructions.find((i) => i.fieldRef === "dob");
    if (dob?.value.kind !== "confirmed") expect.unreachable("a date of birth is student data");
    expect(unwrapConfirmed(dob.value.value)).toBe("02/04/1999");
    expect(dob.value.fieldKey).toBe("identity.date_of_birth");
  });

  it("keeps a reviewed constant distinguishable from student data", () => {
    const plan = planFill(FIXTURE_BLUEPRINT, usable(), COMPLETE_PROFILE);
    const courseCode = plan.instructions.find((i) => i.fieldRef === "course_code");

    // Not dressed up as something the student confirmed. Anything reading this
    // plan — the preview above all — can tell the two apart.
    expect(courseCode?.value.kind).toBe("reviewed_constant");
  });

  it("lists every constant in one place for a reviewer", () => {
    const constants = constantsIn(FIXTURE_MAPPING_SET);
    expect(constants).toHaveLength(1);
    expect(constants[0]?.rationale).toContain("identical for every applicant");
  });
});

describe("when the student has not supplied something", () => {
  const partial = withConfirmed(emptyProfile(STUDENT, NOW), [
    ["identity.given_name", "Niloofar"],
    ["identity.family_name", "Hosseini"],
  ]);

  it("blocks rather than leaving a required field blank", () => {
    const plan = planFill(FIXTURE_BLUEPRINT, usable(), partial);
    expect(isComplete(plan)).toBe(false);
    expect(plan.blockers.every((b) => b.kind === "value_unavailable")).toBe(true);
  });

  it("says exactly which canonical fields the interview should ask about", () => {
    const plan = planFill(FIXTURE_BLUEPRINT, usable(), partial);
    expect(fieldsToCollect(plan)).toEqual([
      "identity.date_of_birth",
      "identity.nationality",
      "contact.email",
      "study.personal_statement",
    ]);
  });

  it("still fills what it can, so the plan shows real progress", () => {
    const plan = planFill(FIXTURE_BLUEPRINT, usable(), partial);
    expect(plan.instructions.map((i) => i.fieldRef)).toContain("given_name");
  });
});

describe("when a value cannot be written in the portal's vocabulary", () => {
  it("blocks instead of choosing the nearest dropdown option", () => {
    const unusualNationality = withConfirmed(emptyProfile(STUDENT, NOW), [
      ["identity.given_name", "Niloofar"],
      ["identity.family_name", "Hosseini"],
      ["identity.date_of_birth", new Date("1999-04-02T00:00:00Z")],
      // Confirmed by the student, and not one of the three options this portal
      // offers. The system does not pick the closest.
      ["identity.nationality", "Kurdish"],
      ["contact.email", "niloofar.hosseini@example.com"],
      ["study.personal_statement", "A".repeat(60)],
    ]);

    const plan = planFill(FIXTURE_BLUEPRINT, usable(), unusualNationality);
    const blocker = plan.blockers.find((b) => b.fieldRef === "nationality");

    if (blocker?.kind !== "render_refused") expect.unreachable("expected a render refusal");
    expect(blocker.refusal.kind).toBe("no_matching_option");
    expect(plan.instructions.map((i) => i.fieldRef)).not.toContain("nationality");
  });
});

describe("what planFill will not accept", () => {
  it("cannot be called with an unreviewed mapping set", () => {
    const draft: MappingSet = { ...FIXTURE_MAPPING_SET, status: "draft" };
    // The signature takes UsableMappingSet, which only checkUsable produces.
    // @ts-expect-error a MappingSet is not a UsableMappingSet
    planFill(FIXTURE_BLUEPRINT, draft, COMPLETE_PROFILE);
  });
});
