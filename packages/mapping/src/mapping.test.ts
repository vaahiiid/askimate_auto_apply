import { describe, expect, it } from "vitest";

import { proposeValue, studentId, unwrapConfirmed } from "@askimate/aas-domain";
import type { ConfirmedProfile, ProfileFieldKey, ProfileFieldType } from "@askimate/aas-profile";
import { applyConfirmation, confirmField, emptyProfile, isDeclined } from "@askimate/aas-profile";

import { checkUsable, constantsIn, formRefusalAttribution, unmappedRequiredFields } from "./mapping.js";
import type { MappingSet, UsableMappingSet } from "./mapping.js";
import type { ApplicationBlueprint } from "@askimate/aas-blueprint";
import { fieldsToCollect, isComplete, planFill, textOf } from "./plan.js";
import { FIXTURE_BLUEPRINT, FIXTURE_MAPPING_SET } from "./fixtures/portal.js";
import {
  GATED_PORTAL_BLUEPRINT,
  GATED_PORTAL_MAPPING_SET,
} from "./fixtures/gated-portal.js";

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

// ───────────────────────────────────────────────────────────────────────────
// ADR-0043 — a credential field is mapped to the Secure Plane, not to data
// ───────────────────────────────────────────────────────────────────────────

describe("credential fields and credential sources, both ways", () => {
  it("accepts a password field mapped to the Secure Plane", () => {
    const check = checkUsable(GATED_PORTAL_MAPPING_SET, GATED_PORTAL_BLUEPRINT);
    expect(check.usable, JSON.stringify(check)).toBe(true);
  });

  it("REFUSES a password field mapped to a profile field", () => {
    // The one route from a profile to a credential field that ADR-0026 exists
    // to prevent — refused at review time, not discovered at fill time.
    const mismapped: MappingSet = {
      ...GATED_PORTAL_MAPPING_SET,
      mappings: GATED_PORTAL_MAPPING_SET.mappings.map((mapping) =>
        mapping.fieldRef === "account_password"
          ? {
              fieldRef: "account_password",
              source: {
                kind: "profile_field" as const,
                fieldKey: "contact.email" as ProfileFieldKey,
                format: { kind: "text" as const },
              },
            }
          : mapping,
      ),
    };
    const check = checkUsable(mismapped, GATED_PORTAL_BLUEPRINT);
    expect(check.usable).toBe(false);
    if (check.usable) expect.unreachable("a mismapped credential field must not be usable");
    expect(check.refusal.kind).toBe("credential_field_mismapped");
    expect(check.refusal.detail).toContain("account_password");
  });

  it("REFUSES a password field with no mapping at all", () => {
    // An absent mapping is not the safe choice. `planFill` would report a
    // `no_mapping` blocker for a required field and stop the run for a
    // specialist who has nothing to decide.
    const unmapped: MappingSet = {
      ...GATED_PORTAL_MAPPING_SET,
      mappings: GATED_PORTAL_MAPPING_SET.mappings.filter(
        (mapping) => mapping.fieldRef !== "account_password",
      ),
    };
    const check = checkUsable(unmapped, GATED_PORTAL_BLUEPRINT);
    // Usable — an absent mapping is not a mapping-set error — but the PLAN
    // refuses, which is the behaviour that made ADR-0043 necessary.
    expect(check.usable).toBe(true);
    if (!check.usable) expect.unreachable("an absent mapping is not a usability failure");
    const plan = planFill(GATED_PORTAL_BLUEPRINT, check.mappingSet, emptyProfile(STUDENT, NOW));
    expect(plan.blockers.some((blocker) => blocker.kind === "no_mapping")).toBe(true);
  });

  it("REFUSES `secure_credential` on a field that is not a credential field", () => {
    // Otherwise the marker becomes a way to say "the Secure Plane fills this"
    // about a name box — a password typed somewhere it can be read.
    const misused: MappingSet = {
      ...GATED_PORTAL_MAPPING_SET,
      mappings: GATED_PORTAL_MAPPING_SET.mappings.map((mapping) =>
        mapping.fieldRef === "given_name"
          ? {
              fieldRef: "given_name",
              source: { kind: "secure_credential" as const, purpose: "portal_account_creation" as const },
            }
          : mapping,
      ),
    };
    const check = checkUsable(misused, GATED_PORTAL_BLUEPRINT);
    expect(check.usable).toBe(false);
    if (check.usable) expect.unreachable("a misused credential source must not be usable");
    expect(check.refusal.kind).toBe("credential_source_misused");
    expect(check.refusal.detail).toContain("given_name");
  });

  it("routes credentials AWAY from the instructions the preview reads", () => {
    const check = checkUsable(GATED_PORTAL_MAPPING_SET, GATED_PORTAL_BLUEPRINT);
    if (!check.usable) expect.unreachable("the gated mapping set should be usable");
    const plan = planFill(GATED_PORTAL_BLUEPRINT, check.mappingSet, emptyProfile(STUDENT, NOW));

    expect(plan.credentials.map((credential) => credential.fieldRef)).toEqual([
      "account_password",
      "account_password_confirm",
    ]);
    // The list every existing consumer reads must not have gained them: a
    // `FillInstruction` carries a `FillValue`, and there is no `FillValue` that
    // could hold a credential.
    const instructed = plan.instructions.map((instruction) => instruction.fieldRef);
    expect(instructed).not.toContain("account_password");
    expect(instructed).not.toContain("account_password_confirm");
    // And a credential requirement has no field that could carry a value.
    for (const credential of plan.credentials) {
      expect(Object.keys(credential).sort()).toEqual(["fieldRef", "label", "locators", "purpose"]);
    }
  });

  it("no longer blocks the plan on the required password field", () => {
    // The contradiction ADR-0043 resolved, asserted directly.
    const check = checkUsable(GATED_PORTAL_MAPPING_SET, GATED_PORTAL_BLUEPRINT);
    if (!check.usable) expect.unreachable("the gated mapping set should be usable");
    const plan = planFill(GATED_PORTAL_BLUEPRINT, check.mappingSet, emptyProfile(STUDENT, NOW));
    const unmapped = plan.blockers.filter((blocker) => blocker.kind === "no_mapping");
    expect(unmapped).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ADR-0102 — a special-category field takes the refusal the form offers, or
// the plan stops. Refused at the mapping boundary, never checked at fill.
// ───────────────────────────────────────────────────────────────────────────

import { SENSITIVE_REFUSAL_MAPPINGS, withSensitivePage } from "./fixtures/sensitive-page.js";
import { rehydratePlan, toStoredPlan } from "./plan-transport.js";

describe("ADR-0102 — use the refusal the form offers", () => {
  const BLUEPRINT = withSensitivePage(FIXTURE_BLUEPRINT);
  // The fixture set carries a student handoff (a CAPTCHA), which refuses
  // transport by itself; these tests are about the refusals, so it is left out.
  const withMappings = (mappings: readonly MappingSet["mappings"][number][]): MappingSet => ({
    ...FIXTURE_MAPPING_SET,
    blueprintVersion: BLUEPRINT.version,
    mappings: [
      ...FIXTURE_MAPPING_SET.mappings.filter((mapping) => mapping.source.kind !== "student_handoff"),
      ...mappings,
    ],
  });
  const refusalOf = (set: MappingSet) => {
    const check = checkUsable(set, BLUEPRINT);
    if (check.usable) expect.unreachable("expected the mapping set to be refused");
    return check.refusal;
  };

  it("accepts the refusals the form offers, and plans them as refusals, not answers", () => {
    const check = checkUsable(withMappings(SENSITIVE_REFUSAL_MAPPINGS), BLUEPRINT);
    // The text box is unmapped, so the set is usable and the PLAN blocks —
    // that is the next test. Here: the two mapped refusals plan as refusals.
    expect(check.usable).toBe(true);
    if (!check.usable) expect.unreachable("a set of offered refusals must be usable");
    const plan = planFill(BLUEPRINT, check.mappingSet, COMPLETE_PROFILE);
    const refusals = plan.instructions.filter((i) => i.value.kind === "form_refusal");
    expect(refusals.map((i) => i.fieldRef).sort()).toEqual(["disability_prefer_not_to_say", "ethnic_origin"]);
    expect(refusals.map((i) => textOf(i.value)).sort()).toEqual(["998", "true"]);
  });

  it("STOPS on a special-category field with no refusal mapped, required or not", () => {
    // The general rule: a portal with no equivalent opt-out stops the fill
    // rather than picking something. `support_needs` is optional on the
    // page and has no refusal to offer; an ordinary optional field would be
    // passed over in silence. This one is a structural blocker.
    const check = checkUsable(withMappings(SENSITIVE_REFUSAL_MAPPINGS), BLUEPRINT);
    if (!check.usable) expect.unreachable("usable");
    const plan = planFill(BLUEPRINT, check.mappingSet, COMPLETE_PROFILE);
    const blocker = plan.blockers.find((b) => b.kind === "special_category_unhandled");
    expect(blocker).toBeDefined();
    expect(blocker?.fieldRef).toBe("support_needs");
    expect(toStoredPlan(plan).ok).toBe(false);
  });

  it("REFUSES a blueprint with any unclassified field — absent is not ordinary", () => {
    // ADR-0077's own rule: the state that looks decided is the dangerous one.
    // One reviewer's omission must not turn a health question into an
    // ordinary field with nothing to notice.
    const unclassified: ApplicationBlueprint = {
      ...BLUEPRINT,
      pages: BLUEPRINT.pages.map((page) => ({
        ...page,
        sections: page.sections.map((section) => ({
          ...section,
          fields: section.fields.map((field) => {
            if (field.fieldRef !== "ethnic_origin") return field;
            const { dataCategory: _omitted, ...unclassifiedField } = field;
            return unclassifiedField;
          }),
        })),
      })),
    };
    const check = checkUsable(withMappings(SENSITIVE_REFUSAL_MAPPINGS), unclassified);
    expect(check.usable).toBe(false);
    if (check.usable) expect.unreachable("an unclassified field must refuse the whole entry");
    expect(check.refusal.kind).toBe("unclassified_fields");
    if (check.refusal.kind === "unclassified_fields") expect(check.refusal.fieldRefs).toEqual(["ethnic_origin"]);
  });

  it("REFUSES any other source on a special-category field: constant, profile field, handoff", () => {
    const others: MappingSet["mappings"][number]["source"][] = [
      { kind: "constant", value: "998", classification: "application_metadata", rationale: "a default" },
      { kind: "profile_field", fieldKey: "identity.nationality", format: { kind: "text" } },
      { kind: "student_handoff", reason: "the student answers this" },
    ];
    for (const source of others) {
      const refusal = refusalOf(withMappings([SENSITIVE_REFUSAL_MAPPINGS[0]!, { fieldRef: "ethnic_origin", source }]));
      expect(refusal.kind, source.kind).toBe("special_category_mismapped");
    }
  });

  it("REFUSES a form refusal on a field that is not special-category", () => {
    const refusal = refusalOf(
      withMappings([
        ...SENSITIVE_REFUSAL_MAPPINGS,
        { fieldRef: "preferred_name", source: { kind: "form_refusal", value: "x", rationale: "no" } },
      ]),
    );
    expect(refusal.kind).toBe("form_refusal_misused");
  });

  it("REFUSES a refusal the form does not offer: a value not in the options, or a text box", () => {
    const notAnOption = refusalOf(
      withMappings([
        SENSITIVE_REFUSAL_MAPPINGS[0]!,
        { fieldRef: "ethnic_origin", source: { kind: "form_refusal", value: "999", rationale: "made up" } },
      ]),
    );
    expect(notAnOption.kind).toBe("form_refusal_not_offered");

    const textBox = refusalOf(
      withMappings([
        ...SENSITIVE_REFUSAL_MAPPINGS,
        { fieldRef: "support_needs", source: { kind: "form_refusal", value: "N/A", rationale: "typed" } },
      ]),
    );
    expect(textBox.kind).toBe("form_refusal_not_offered");
  });

  it("REFUSES a 'the form says' line the form does not say — quote or omit, never compose", () => {
    const refusal = refusalOf(
      withMappings([
        {
          fieldRef: "disability_prefer_not_to_say",
          source: {
            kind: "form_refusal",
            value: "true",
            rationale: "health",
            formSays: "the university will ask you again after registration",
          },
        },
        SENSITIVE_REFUSAL_MAPPINGS[1]!,
      ]),
    );
    expect(refusal.kind).toBe("form_refusal_composed");
  });

  it("lets one refusal COVER the other controls of the same question, and plans nothing for them", () => {
    // Sheffield's disability question is twelve checkboxes; "Prefer not to
    // say" is one of them. Ticking it answers the question, and the other
    // eleven are neither answered nor blockers — they are covered.
    const check = checkUsable(withMappings(SENSITIVE_REFUSAL_MAPPINGS), BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, COMPLETE_PROFILE);
    const blocked = plan.blockers.filter((b) => b.kind === "special_category_unhandled").map((b) => b.fieldRef);
    expect(blocked).toEqual(["support_needs"]);
    expect(plan.instructions.map((i) => i.fieldRef)).not.toContain("disability_dyslexia");
  });

  it("REFUSES a cover that is not special-category, not in the blueprint, or itself mapped", () => {
    const refusalWith = (covers: readonly string[]) => ({
      fieldRef: "disability_prefer_not_to_say",
      source: { ...SENSITIVE_REFUSAL_MAPPINGS[0]!.source, covers } as MappingSet["mappings"][number]["source"],
    });
    expect(refusalOf(withMappings([refusalWith(["preferred_name"]), SENSITIVE_REFUSAL_MAPPINGS[1]!])).kind).toBe(
      "form_refusal_cover_invalid",
    );
    expect(refusalOf(withMappings([refusalWith(["no_such_field"]), SENSITIVE_REFUSAL_MAPPINGS[1]!])).kind).toBe(
      "form_refusal_cover_invalid",
    );
    // Covering the ethnic-origin field, which has its own refusal mapped.
    expect(refusalOf(withMappings([refusalWith(["ethnic_origin"]), SENSITIVE_REFUSAL_MAPPINGS[1]!])).kind).toBe(
      "form_refusal_cover_invalid",
    );
  });

  it("carries a refusal through transport as a refusal, with the form's words", () => {
    const check = checkUsable(withMappings([...SENSITIVE_REFUSAL_MAPPINGS, { fieldRef: "support_needs", source: { kind: "student_handoff", reason: "x" } }]), BLUEPRINT);
    // (student_handoff on support_needs is itself refused — mismapped — so
    // build the transportable plan from a blueprint without the text box.)
    expect(check.usable).toBe(false);
    // Also without the fixture's handed-off field: with its handoff mapping
    // left out (above) it would be a required field with no mapping.
    const handedOff = new Set(
      FIXTURE_MAPPING_SET.mappings
        .filter((mapping) => mapping.source.kind === "student_handoff")
        .map((mapping) => mapping.fieldRef),
    );
    const withoutTextBox: ApplicationBlueprint = {
      ...BLUEPRINT,
      pages: BLUEPRINT.pages.map((page) => ({
        ...page,
        sections: page.sections.map((section) => ({
          ...section,
          fields: section.fields.filter(
            (field) => field.fieldRef !== "support_needs" && !handedOff.has(field.fieldRef),
          ),
        })),
      })),
    };
    const usableCheck = checkUsable(withMappings(SENSITIVE_REFUSAL_MAPPINGS), withoutTextBox);
    if (!usableCheck.usable) expect.unreachable(usableCheck.refusal.kind);
    const plan = planFill(withoutTextBox, usableCheck.mappingSet, COMPLETE_PROFILE);
    const stored = toStoredPlan(plan);
    if (!stored.ok) expect.unreachable(stored.refusal);
    const back = rehydratePlan(stored.plan);
    const refusal = back.instructions.find((i) => i.fieldRef === "disability_prefer_not_to_say");
    expect(refusal?.value.kind).toBe("form_refusal");
    if (refusal?.value.kind !== "form_refusal") expect.unreachable("kind");
    expect(textOf(refusal.value)).toBe("true");
    expect(formRefusalAttribution(refusal.value.refusal).covers).toEqual(["disability_dyslexia", "disability_other"]);
  });
});



// ───────────────────────────────────────────────────────────────────────────
// P93 — gap 4: a document slot's companion field follows the attach.
// ───────────────────────────────────────────────────────────────────────────

import { GATED_PORTAL_WITH_DOCUMENTS_BLUEPRINT, GATED_PORTAL_WITH_DOCUMENTS_MAPPING_SET } from "./fixtures/gated-portal.js";

describe("a document slot's companion (P93, gap 4)", () => {
  const BLUEPRINT = GATED_PORTAL_WITH_DOCUMENTS_BLUEPRINT;
  const SET = GATED_PORTAL_WITH_DOCUMENTS_MAPPING_SET;

  it("plans the companion after the attach, from the blueprint, with the value the slot names", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, COMPLETE_PROFILE);
    const upload = plan.uploads.find((u) => u.fieldRef === "passport_upload");
    expect(upload?.companion).toEqual({
      fieldRef: "passport_status",
      label: "Passport status",
      locators: [{ strategy: "name", value: "passportStatus" }],
      text: "now",
    });
    // Neither an instruction nor a blocker: it is the attach's second act.
    expect(plan.instructions.map((i) => i.fieldRef)).not.toContain("passport_status");
    expect(plan.blockers.map((b) => b.fieldRef)).not.toContain("passport_status");
  });

  it("REFUSES a companion that is mapped as well, not offered, or not on the blueprint", () => {
    const mapped: MappingSet = {
      ...SET,
      mappings: [...SET.mappings, { fieldRef: "passport_status", source: { kind: "constant", value: "now", classification: "application_metadata", rationale: "x" } }],
    };
    const c1 = checkUsable(mapped, BLUEPRINT);
    expect(c1.usable).toBe(false);
    if (!c1.usable) expect(c1.refusal.kind).toBe("document_companion_invalid");

    const withCompanion = (companion: { fieldRef: string; whenAttached: string }): ApplicationBlueprint => ({
      ...BLUEPRINT,
      pages: BLUEPRINT.pages.map((page) =>
        page.pageRef === "page-documents"
          ? { ...page, requiredDocuments: page.requiredDocuments.map((d) => ({ ...d, companion })) }
          : page,
      ),
    });
    const c2 = checkUsable(SET, withCompanion({ fieldRef: "passport_status", whenAttached: "soon" }));
    expect(c2.usable).toBe(false);
    if (!c2.usable) expect(c2.refusal.kind).toBe("document_companion_invalid");
    const c3 = checkUsable(SET, withCompanion({ fieldRef: "no_such_field", whenAttached: "now" }));
    expect(c3.usable).toBe(false);
    if (!c3.usable) expect(c3.refusal.kind).toBe("document_companion_invalid");
  });

  it("carries the companion through transport", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, COMPLETE_PROFILE);
    const stored = toStoredPlan(plan);
    if (!stored.ok) expect.unreachable(stored.refusal);
    expect(rehydratePlan(stored.plan).uploads[0]?.companion?.text).toBe("now");
  });
});
