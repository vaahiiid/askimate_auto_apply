import { describe, expect, it } from "vitest";

import { proposeValue, studentId, unwrapConfirmed } from "@askimate/aas-domain";
import type { ConfirmedProfile, ProfileFieldKey, ProfileFieldType } from "@askimate/aas-profile";
import { applyConfirmation, confirmField, emptyProfile, isDeclined } from "@askimate/aas-profile";

import { checkUsable, constantsIn, formRefusalAttribution, isRequired, isRequiredToSave, unmappedRequiredFields } from "./mapping.js";
import type { MappingSet, UsableMappingSet } from "./mapping.js";
import type { ApplicationBlueprint, BlueprintField, BlueprintPage } from "@askimate/aas-blueprint";
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

  it("accepts a set signed off by its own author — whom that admits is the registry's record (ADR-0118)", () => {
    // Refused as `reviewed_by_author` until Vahid's decision of 2026-09-16:
    // "Drop it to one: I approve, and I am the only signature." The two
    // fields compared here are in one document; the approval registry
    // records that a single signature admits the signer's own account only.
    const check = checkUsable(
      { ...FIXTURE_MAPPING_SET, reviewedBy: FIXTURE_MAPPING_SET.authoredBy },
      FIXTURE_BLUEPRINT,
    );
    expect(check.usable).toBe(true);
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

  // ── ADR-0119: a box handed to the student is an own act on a page the runner fills ──
  it("transports a plan whose handed box is not a document slot — the runner fills the page and leaves the box (ADR-0119)", () => {
    // Until 2026-09-16 `toStoredPlan` refused this as `has_handoffs`. Vahid's
    // own-act mechanism: the box is the student's, the rest of the page is ours.
    const plan = planFill(FIXTURE_BLUEPRINT, usable(), COMPLETE_PROFILE);
    const stored = toStoredPlan(plan);
    expect(stored.ok).toBe(true);
    if (!stored.ok) expect.unreachable("transported");
    expect(stored.plan.instructions.map((i) => i.fieldRef)).not.toContain("declaration");
  });

  it("lists an optional box nobody mapped, under its page, apart from the handed ones (ADR-0119)", () => {
    // `preferred_name` is deliberately unmapped and optional. Not a blocker,
    // not a handoff: a gap nobody has looked at, and said so.
    const plan = planFill(FIXTURE_BLUEPRINT, usable(), COMPLETE_PROFILE);
    expect(plan.unmapped.map((f) => [f.fieldRef, f.pageTitle])).toEqual([["preferred_name", "Personal details"]]);
    expect(plan.handoffs.map((h) => h.fieldRef)).not.toContain("preferred_name");
    expect(plan.blockers.map((b) => b.fieldRef)).not.toContain("preferred_name");
  });

  it("reads a marker inside a section the portal says may be skipped as NOT required to save, and carries the portal's words (ADR-0119, P147)", () => {
    // Sheffield's language page saved with all seventeen marked boxes empty;
    // the summary then said the section need not be completed. Vahid: "that is
    // a property of the section, not something to fix by erasing marks."
    const words = "If you do not have this, you do not need to complete this section.";
    const first = FIXTURE_BLUEPRINT.pages[0];
    if (first === undefined) expect.unreachable("a page");
    const skippable: ApplicationBlueprint = {
      ...FIXTURE_BLUEPRINT,
      pages: [
        {
          ...first,
          sections: [
            ...first.sections,
            {
              sectionRef: "skippable",
              title: "A section you may skip",
              optional: { formSays: words },
              fields: [
                {
                  fieldRef: "starred_but_skippable",
                  label: "Starred box",
                  inputType: "text",
                  dataCategory: "ordinary",
                  locators: [{ strategy: "name", value: "starred_but_skippable" }],
                  validations: [{ kind: "required", source: "observed_marker" }],
                },
              ],
            },
          ],
        },
        ...FIXTURE_BLUEPRINT.pages.slice(1),
      ],
    };
    const field = skippable.pages[0]?.sections.at(-1)?.fields[0];
    if (field === undefined) expect.unreachable("the field");
    // The mark is kept and read as a mark; only "required to save" changes.
    expect(isRequired(field)).toBe(true);
    expect(isRequiredToSave(skippable, field)).toBe(false);
    expect(unmappedRequiredFields(skippable, FIXTURE_MAPPING_SET).map((f) => f.fieldRef)).not.toContain("starred_but_skippable");

    const check = checkUsable(FIXTURE_MAPPING_SET, skippable);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(skippable, check.mappingSet, COMPLETE_PROFILE);
    expect(plan.blockers.map((b) => b.fieldRef)).not.toContain("starred_but_skippable");
    expect(plan.unmapped.find((f) => f.fieldRef === "starred_but_skippable")).toEqual({
      fieldRef: "starred_but_skippable",
      label: "Starred box",
      pageRef: first.pageRef,
      pageTitle: first.title,
      formSays: words,
    });
    // A marker OUTSIDE such a section still blocks.
    const marked = { ...skippable, pages: skippable.pages.map((p, i) => (i === 0 ? { ...p, sections: p.sections.map((s) => (s.sectionRef === "skippable" ? { sectionRef: s.sectionRef, title: s.title, fields: s.fields } : s)) } : p)) };
    const blocked = planFill(marked, check.mappingSet, COMPLETE_PROFILE);
    expect(blocked.blockers.map((b) => [b.kind, b.fieldRef])).toContainEqual(["no_mapping", "starred_but_skippable"]);
  });

  it("STOPS by name when a list-valued field has more entries than the form has blocks (blocker 29, ADR-0119)", () => {
    // Two blocks mapped as entry 0 and entry 1 of a list; three entries given.
    // Vahid, 2026-09-16: *"A history that silently drops a period is the exact
    // class of error this system exists to refuse."*
    const blocks: ApplicationBlueprint = {
      ...FIXTURE_BLUEPRINT,
      pages: [
        ...FIXTURE_BLUEPRINT.pages,
        {
          pageRef: "page-residence",
          title: "Where you have lived",
          sections: [
            {
              sectionRef: "residence-blocks",
              title: "Where you have lived",
              fields: [0, 1].map((index) => ({
                fieldRef: `country_${String(index)}`,
                label: `Country ${String(index + 1)}`,
                inputType: "text" as const,
                dataCategory: "ordinary" as const,
                locators: [{ strategy: "name" as const, value: `country_${String(index)}` }],
                validations: [],
              })),
            },
          ],
          requiredDocuments: [],
          advanceControl: { strategy: "css" as const, value: "button.save" },
        },
      ],
    };
    const set: MappingSet = {
      ...FIXTURE_MAPPING_SET,
      mappings: [
        ...FIXTURE_MAPPING_SET.mappings,
        ...[0, 1].map((index) => ({
          fieldRef: `country_${String(index)}`,
          source: {
            kind: "profile_field" as const,
            fieldKey: "residence.history" as const,
            format: { kind: "part" as const, path: String(index), absent: "leave_empty" as const, then: { kind: "part" as const, path: "countryCode" } },
          },
        })),
      ],
    };
    const check = checkUsable(set, blocks);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const period = (code: string): unknown => ({ countryCode: code, from: { year: 2020, month: 1 }, to: { kind: "current" } });

    const fits = planFill(blocks, check.mappingSet, withConfirmed(COMPLETE_PROFILE, [["residence.history", [period("IR"), period("GB")]]]));
    expect(fits.blockers.map((b) => b.kind)).not.toContain("list_exceeds_form");
    expect(fits.instructions.filter((i) => i.fieldRef.startsWith("country_")).map((i) => textOf(i.value))).toEqual(["IR", "GB"]);

    const exceeds = planFill(blocks, check.mappingSet, withConfirmed(COMPLETE_PROFILE, [["residence.history", [period("IR"), period("GB"), period("DE")]]]));
    const blocker = exceeds.blockers.find((b) => b.kind === "list_exceeds_form");
    expect(blocker).toBeDefined();
    if (blocker?.kind !== "list_exceeds_form") expect.unreachable("narrowed");
    expect([blocker.fieldKey, blocker.held, blocker.blocks, blocker.label]).toEqual(["residence.history", 3, 2, "Where you have lived"]);
    expect(blocker.detail).toContain("room for 2 entries");
    expect(blocker.detail).toContain("you gave 3");
    expect(toStoredPlan(exceeds).ok).toBe(false);
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

  it("REFUSES an option map naming a value the field's captured options do not hold (ADR-0136)", () => {
    // ══════════════════════════════════════════════════════════════════
    // Attempt 8 on Sheffield, 2026-09-22. Eighteen of nineteen boxes took their
    // values; `startDateMonth` did not, because the set sent "Sep" and the
    // portal's list says "Sept" — as does the blueprint, on the same page, read
    // from a capture taken twelve days earlier. `Jun` and `Jul` would have
    // failed next, on the end and award dates.
    //
    // Nothing compared the map against the list. This is that comparison.
    // ══════════════════════════════════════════════════════════════════
    // The fixture already maps `nationality`; this bends THAT map rather than
    // adding a second one, because a duplicate is refused before this check.
    const bent: MappingSet = {
      ...FIXTURE_MAPPING_SET,
      blueprintVersion: BLUEPRINT.version,
      mappings: FIXTURE_MAPPING_SET.mappings
        .filter((mapping) => mapping.source.kind !== "student_handoff")
        .map((mapping) =>
          mapping.fieldRef === "nationality"
            ? {
                ...mapping,
                source: {
                  kind: "profile_field" as const,
                  fieldKey: "identity.nationality" as const,
                  format: { kind: "option" as const, options: { IR: "IRANIAN" } },
                },
              }
            : mapping,
        ),
    };
    const sent = refusalOf({ ...bent, mappings: [...bent.mappings, ...SENSITIVE_REFUSAL_MAPPINGS] });
    expect(sent.kind).toBe("option_map_not_offered");
    if (sent.kind !== "option_map_not_offered") expect.unreachable("kind checked above");
    expect(sent.fieldRefs).toContain("nationality");
    // The line names the value, because the reviewer's next act is to compare
    // it against the list they captured.
    expect(sent.detail).toContain('"IRANIAN"');
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
    // ADR-0106: and the marker a held file shows, from the slot's own declaration.
    expect(plan.uploads[0]?.recorded).toEqual({ strategy: "id", value: "passportHeld" });
    expect(rehydratePlan(stored.plan).uploads[0]?.recorded).toEqual({ strategy: "id", value: "passportHeld" });
  });
});

describe("a field whose options arrive after another is set (P94, gap 1)", () => {
  const BLUEPRINT = GATED_PORTAL_BLUEPRINT;
  const SET = GATED_PORTAL_MAPPING_SET;

  /** The blueprint with one field patched, wherever it sits. */
  const withField = (
    fieldRef: string,
    patch: (field: BlueprintField) => BlueprintField,
  ): ApplicationBlueprint => ({
    ...BLUEPRINT,
    pages: BLUEPRINT.pages.map((page) => ({
      ...page,
      sections: page.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => (field.fieldRef === fieldRef ? patch(field) : field)),
      })),
    })),
  });

  it("plans the dependent field AFTER the field it follows, and says which it follows", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, COMPLETE_PROFILE);
    const refs = plan.instructions.map((i) => i.fieldRef);
    expect(refs.indexOf("passport_country")).toBeGreaterThan(refs.indexOf("nationality"));
    const dependent = plan.instructions.find((i) => i.fieldRef === "passport_country");
    expect(dependent?.optionsAfter).toEqual({ fieldRef: "nationality" });
    expect(plan.instructions.find((i) => i.fieldRef === "nationality")?.optionsAfter).toBeUndefined();
  });

  it("REFUSES an order the fill could not follow: a field that precedes the one it depends on", () => {
    // P97: on a SELECT that is mapped, so that neither the "offers no options"
    // rule nor the "mapped by nothing" rule can refuse it in the order rule's
    // place — the audit's M4 removed the order rule and a text field was
    // still refused, for the wrong reason.
    const check = checkUsable(SET, withField("nationality", (f) => ({ ...f, optionsAfter: { fieldRef: "passport_country" } })));
    expect(check.usable).toBe(false);
    if (!check.usable) {
      expect(check.refusal.kind).toBe("options_after_invalid");
      expect(check.refusal.detail).toContain("nationality");
      expect(check.refusal.detail).toContain("comes after it");
    }
  });

  it("REFUSES a dependency on a field that is not on the blueprint, on another page, or itself", () => {
    for (const fieldRef of ["no_such_field", "personal_statement", "passport_country"]) {
      const check = checkUsable(SET, withField("passport_country", (f) => ({ ...f, optionsAfter: { fieldRef } })));
      expect(check.usable, fieldRef).toBe(false);
      if (!check.usable) expect(check.refusal.kind).toBe("options_after_invalid");
    }
  });

  it("REFUSES a dependent field that offers no options to wait for", () => {
    const check = checkUsable(SET, withField("family_name", (f) => ({ ...f, optionsAfter: { fieldRef: "given_name" } })));
    expect(check.usable).toBe(false);
    if (!check.usable) expect(check.refusal.kind).toBe("options_after_invalid");
  });

  it("REFUSES a mapped dependent whose earlier field nothing maps — the option could never arrive", () => {
    const withoutNationality: MappingSet = {
      ...SET,
      mappings: SET.mappings.filter((m) => m.fieldRef !== "nationality"),
    };
    const check = checkUsable(withoutNationality, BLUEPRINT);
    expect(check.usable).toBe(false);
    if (!check.usable) {
      expect(check.refusal.kind).toBe("options_after_invalid");
      expect(check.refusal.detail).toContain("nationality");
    }
  });

  it("carries the dependency through transport", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, COMPLETE_PROFILE);
    const stored = toStoredPlan(plan);
    if (!stored.ok) expect.unreachable(stored.refusal);
    const back = rehydratePlan(stored.plan);
    expect(back.instructions.find((i) => i.fieldRef === "passport_country")?.optionsAfter).toEqual({
      fieldRef: "nationality",
    });
    expect(back.instructions.find((i) => i.fieldRef === "nationality")?.optionsAfter).toBeUndefined();
  });
});

describe("a typeahead (P95, gap 2)", () => {
  const BLUEPRINT = GATED_PORTAL_BLUEPRINT;
  const SET = GATED_PORTAL_MAPPING_SET;
  const withField = (
    fieldRef: string,
    patch: (field: BlueprintField) => BlueprintField,
  ): ApplicationBlueprint => ({
    ...BLUEPRINT,
    pages: BLUEPRINT.pages.map((page) => ({
      ...page,
      sections: page.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => (field.fieldRef === fieldRef ? patch(field) : field)),
      })),
    })),
  });

  it("plans the typeahead with where its entries are found, and the text to type", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, COMPLETE_PROFILE);
    const course = plan.instructions.find((i) => i.fieldRef === "course");
    expect(course?.inputType).toBe("typeahead");
    // ADR-0109 (P118): the instruction names the VALUE; the text to type is
    // the one the reviewer recorded for it, carried beside the entries.
    expect(course?.typeahead).toEqual({
      optionLocator: { strategy: "css", value: "#courseOptions [role=option]" },
      text: "MSc Example Studies",
      escapeValue: "Not in list",
    });
    expect(course === undefined ? "" : textOf(course.value)).toBe("PG-EX-2026");
    expect(plan.instructions.find((i) => i.fieldRef === "personal_statement")?.typeahead).toBeUndefined();
  });

  it("REFUSES a typeahead that does not say where its entries are, and entries on a field that is not one", () => {
    const bare = checkUsable(SET, withField("course", ({ typeahead: _dropped, ...field }) => field));
    expect(bare.usable).toBe(false);
    if (!bare.usable) expect(bare.refusal.kind).toBe("typeahead_invalid");

    const misplaced = checkUsable(
      SET,
      withField("personal_statement", (f) => ({ ...f, typeahead: { optionLocator: { strategy: "css", value: "li" } } })),
    );
    expect(misplaced.usable).toBe(false);
    if (!misplaced.usable) expect(misplaced.refusal.kind).toBe("typeahead_invalid");
  });

  it("ADMITS a typeahead whose entries follow another field, and plans it after that field (P102)", () => {
    // The first real form's institution search carries the chosen country in
    // its request: the entries follow the country, and the wait for them is
    // the typeahead's own. A typeahead offers no list to wait for, but it does
    // offer entries — after the earlier field is set.
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, COMPLETE_PROFILE);
    const refs = plan.instructions.map((i) => i.fieldRef);
    expect(refs.indexOf("study_level")).toBeLessThan(refs.indexOf("course"));
    expect(plan.instructions.find((i) => i.fieldRef === "course")?.optionsAfter).toEqual({ fieldRef: "study_level" });
    // The order rules still hold for it: a field that comes after it is refused.
    const after = checkUsable(SET, withField("course", (f) => ({ ...f, optionsAfter: { fieldRef: "start_date" } })));
    expect(after.usable).toBe(false);
    if (!after.usable) expect(after.refusal.kind).toBe("options_after_invalid");
  });

  it("carries the entries' locator through transport", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, COMPLETE_PROFILE);
    const stored = toStoredPlan(plan);
    if (!stored.ok) expect.unreachable(stored.refusal);
    const back = rehydratePlan(stored.plan);
    expect(back.instructions.find((i) => i.fieldRef === "course")?.typeahead).toEqual({
      optionLocator: { strategy: "css", value: "#courseOptions [role=option]" },
      text: "MSc Example Studies",
      escapeValue: "Not in list",
    });
  });
});

describe("a page filled once per item of a list (P96, gap 3)", () => {
  const BLUEPRINT = GATED_PORTAL_BLUEPRINT;
  const SET = GATED_PORTAL_MAPPING_SET;
  const QUALIFICATIONS = [
    { level: "Bachelor's degree", subject: "Industrial Engineering", institution: "Sharif University of Technology", countryCode: "IR", start: { year: 2017, month: 9 }, end: { kind: "completed", date: { year: 2021, month: 6 } }, grade: "17.2", gradeScale: "iran_20_point" },
    { level: "High school diploma", subject: "Mathematics and Physics", institution: "Farzanegan High School", countryCode: "IR", start: { year: 2013, month: 9 }, end: { kind: "completed", date: { year: 2017, month: 6 } }, grade: "19.1", gradeScale: "iran_20_point" },
  ];
  const WITH_QUALIFICATIONS = withConfirmed(COMPLETE_PROFILE, [["education.prior_qualifications", QUALIFICATIONS]]);
  const educationPage = (blueprint: ApplicationBlueprint) => {
    const page = blueprint.pages.find((p) => p.pageRef === "page-education");
    if (page === undefined) expect.unreachable("the fixture has an education page");
    return page;
  };
  const withEducation = (patch: (page: BlueprintPage) => BlueprintPage): ApplicationBlueprint => ({
    ...BLUEPRINT,
    pages: BLUEPRINT.pages.map((page) => (page.pageRef === "page-education" ? patch(page) : page)),
  });

  it("judges a required unmapped box the form shows only for some entries PER ENTRY (P148)", () => {
    // Sheffield's unlisted-degree box appears only when the qualification select
    // says "Not in list". Nobody maps it; the map never names that value; so
    // the box is never shown, and it is not a gap. When the controlling value
    // DOES show it for an entry, the gap is real and said once.
    const withOtherLevel = withEducation((page) => ({
      ...page,
      sections: page.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              fields: [
                ...section.fields,
                {
                  fieldRef: "qualification_other_level",
                  label: "Describe the qualification",
                  inputType: "text",
                  dataCategory: "ordinary",
                  locators: [{ strategy: "id", value: "qualificationOtherLevel" }],
                  validations: [{ kind: "required", source: "observed_marker" }],
                  visibleWhen: { whenFieldRef: "qualification_level", operator: "equals", value: "High school diploma" },
                },
              ],
            }
          : section,
      ),
    }));
    const check = checkUsable(SET, withOtherLevel);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    // Only the bachelor's: the box is shown for no entry, and nothing blocks.
    const bachelorOnly = withConfirmed(COMPLETE_PROFILE, [["education.prior_qualifications", QUALIFICATIONS.slice(0, 1)]]);
    const quiet = planFill(withOtherLevel, check.mappingSet, bachelorOnly);
    expect(quiet.blockers.map((b) => b.fieldRef)).not.toContain("qualification_other_level");
    expect(quiet.hidden.map((h) => [h.fieldRef, h.item?.index])).toContainEqual(["qualification_other_level", 0]);
    // None at all: nothing is shown, nothing blocks.
    const none = planFill(withOtherLevel, check.mappingSet, withConfirmed(COMPLETE_PROFILE, [["education.prior_qualifications", []]]));
    expect(none.blockers.map((b) => b.fieldRef)).not.toContain("qualification_other_level");
    // The school diploma shows it for entry 2: a real gap, said once.
    const loud = planFill(withOtherLevel, check.mappingSet, WITH_QUALIFICATIONS);
    expect(loud.blockers.filter((b) => b.fieldRef === "qualification_other_level").map((b) => b.kind)).toEqual(["no_mapping"]);
  });

  it("plans the page's fields once per item, in item order, each from its own item", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, WITH_QUALIFICATIONS);
    const onPage = plan.instructions.filter((i) => i.fieldRef.startsWith("qualification_"));
    expect(onPage.map((i) => [i.fieldRef, i.item?.index, i.item?.count, textOf(i.value)])).toEqual([
      ["qualification_level", 0, 2, "Bachelor's degree"],
      ["qualification_subject", 0, 2, "Industrial Engineering"],
      ["qualification_institution", 0, 2, "Sharif University of Technology"],
      ["qualification_year", 0, 2, "2021"],
      // ADR-0107: the certificate is the student's own act; the portal is told
      // it is coming later — once per entry.
      ["qualification_certificate_status", 0, 2, "later"],
      ["qualification_level", 1, 2, "High school diploma"],
      ["qualification_subject", 1, 2, "Mathematics and Physics"],
      ["qualification_institution", 1, 2, "Farzanegan High School"],
      ["qualification_year", 1, 2, "2017"],
      // Shown for the school diploma only (ADR-0104): the condition is answered per item.
      ["qualification_grade_note", 1, 2, "19.1"],
      ["qualification_certificate_status", 1, 2, "later"],
    ]);
    expect(plan.blockers).toEqual([]);
    expect(plan.repeats).toEqual([
      { pageRef: "page-education", title: "Your qualifications", fieldKey: "education.prior_qualifications", count: 2 },
    ]);
    // Fields off the page carry no item.
    expect(plan.instructions.find((i) => i.fieldRef === "given_name")?.item).toBeUndefined();
  });

  it("fills an optional block ZERO times when the list is not confirmed, and asks for nothing", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, COMPLETE_PROFILE);
    expect(plan.instructions.some((i) => i.fieldRef.startsWith("qualification_"))).toBe(false);
    expect(plan.blockers).toEqual([]);
    expect(plan.repeats).toEqual([
      { pageRef: "page-education", title: "Your qualifications", fieldKey: "education.prior_qualifications", count: 0 },
    ]);
  });

  it("ASKS when a required field on the block has no list to draw from", () => {
    const required = withEducation((page) => ({
      ...page,
      sections: page.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) =>
          field.fieldRef === "qualification_level"
            ? { ...field, validations: [{ kind: "required", source: "dom_attribute" }] }
            : field,
        ),
      })),
    }));
    const check = checkUsable(SET, required);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(required, check.mappingSet, COMPLETE_PROFILE);
    expect(plan.blockers.map((b) => [b.kind, b.fieldRef])).toEqual([["value_unavailable", "qualification_level"]]);
    const blocker = plan.blockers[0];
    if (blocker?.kind !== "value_unavailable") expect.unreachable("asked");
    expect(blocker.fieldKey).toBe("education.prior_qualifications");
  });

  it("REFUSES a mapping on the block that draws from anything but the list it repeats over", () => {
    const elsewhere: MappingSet = {
      ...SET,
      mappings: SET.mappings.map((m) =>
        m.fieldRef === "qualification_subject"
          ? { ...m, source: { kind: "profile_field", fieldKey: "identity.given_name", format: { kind: "text" } } }
          : m,
      ),
    };
    const check = checkUsable(elsewhere, BLUEPRINT);
    expect(check.usable).toBe(false);
    if (!check.usable) {
      expect(check.refusal.kind).toBe("repeat_mapping_invalid");
      expect(check.refusal.detail).toContain("qualification_subject");
    }
  });

  it("leaves a repeating page's document slots to the student, once per item, and says so (ADR-0104)", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, WITH_QUALIFICATIONS);
    const certificates = plan.handoffs.filter((h) => h.fieldRef === "qualification_certificate");
    expect(certificates.map((h) => h.item)).toEqual([
      { index: 0, count: 2 },
      { index: 1, count: 2 },
    ]);
    expect(certificates[0]?.inputType).toBe("file");
    expect(plan.blockers).toEqual([]);
    // The runner still gets the page: a document slot left to the student does
    // not refuse transport. Since ADR-0119 neither does any other handed box:
    // it is the student's own act on a page the runner still fills.
    const stored = toStoredPlan(plan);
    expect(stored.ok).toBe(true);
    const ticked: MappingSet = {
      ...SET,
      mappings: SET.mappings.map((m) =>
        m.fieldRef === "qualification_year" ? { ...m, source: { kind: "student_handoff", reason: "x" } } : m,
      ),
    };
    const c = checkUsable(ticked, BLUEPRINT);
    expect(c.usable, "a handed box on a repeating page is the student's own act per entry (ADR-0119)").toBe(true);
    if (!c.usable) expect.unreachable("usable");
    const handedYears = planFill(BLUEPRINT, c.mappingSet, WITH_QUALIFICATIONS).handoffs.filter((h) => h.fieldRef === "qualification_year");
    expect(handedYears.map((h) => [h.item?.index, h.inputType])).toEqual([[0, "text"], [1, "text"]]);
  });

  it("answers a condition inside a repeat PER ITEM: shown for the qualification it applies to, hidden for the other (ADR-0104)", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, WITH_QUALIFICATIONS);
    const notes = plan.instructions.filter((i) => i.fieldRef === "qualification_grade_note");
    // The second qualification is the school diploma: its grade note is typed;
    // the bachelor's is hidden, and recorded as hidden for THAT item.
    expect(notes.map((i) => [i.item?.index, textOf(i.value)])).toEqual([[1, "19.1"]]);
    expect(plan.hidden).toEqual([
      { fieldRef: "qualification_grade_note", label: "Grade, as on the certificate", whenFieldRef: "qualification_level", item: { index: 0, count: 2 } },
    ]);
    expect(plan.repeats[0]?.count).toBe(2);
  });

  // ── ADR-0138: a slot the form asks only SOME entries for ────────────────

  /** The certificate slot asked only while the qualification has not ended. */
  const askedWhileStudying = (part: readonly string[] = ["end", "kind"]): ApplicationBlueprint =>
    withEducation((page) => ({
      ...page,
      requiredDocuments: page.requiredDocuments.map((document) =>
        document.fieldRef === "qualification_certificate"
          ? {
              ...document,
              askedWhen: {
                part,
                is: ["expected"],
                because: "the page asks for proof of registration only while the qualification is still running",
              },
            }
          : document,
      ),
    }));
  const STILL_STUDYING = [
    { ...QUALIFICATIONS[0], end: { kind: "expected", date: { year: 2027, month: 6 } } },
    QUALIFICATIONS[1],
  ];

  it("does not plan, preview or set a slot the form does not ask THIS entry for — nor its companion (ADR-0138)", () => {
    // Run A, attempt 9: `certificateStatus` refused twice on Sheffield's
    // education page. The control is inside a block the page shows only while
    // the qualification has not ended, and the student's qualification was
    // finished — so the runner was typing into a control that was not there.
    // The condition is the STUDENT'S fact, on the slot, answered per entry.
    const blueprint = askedWhileStudying();
    const check = checkUsable(SET, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(blueprint, check.mappingSet, withConfirmed(COMPLETE_PROFILE, [["education.prior_qualifications", STILL_STUDYING]]));

    // Entry 0 is still running: the slot and its companion are both planned.
    expect(plan.handoffs.filter((h) => h.fieldRef === "qualification_certificate").map((h) => h.item?.index)).toEqual([0]);
    const statuses = plan.instructions.filter((i) => i.fieldRef === "qualification_certificate_status");
    expect(statuses.map((i) => [i.item?.index, textOf(i.value)])).toEqual([[0, "later"]]);

    // Entry 1 has finished: neither is planned, and BOTH are recorded as not
    // asked for, with the entry's own answer that decided it.
    expect(plan.hidden.filter((h) => h.item?.index === 1)).toEqual([
      { fieldRef: "qualification_certificate", label: "Certificate", whenEntrySays: { part: "end.kind", holds: "completed" }, item: { index: 1, count: 2 } },
      { fieldRef: "qualification_certificate_status", label: "Certificate status", whenEntrySays: { part: "end.kind", holds: "completed" }, item: { index: 1, count: 2 } },
    ]);
    expect(plan.blockers).toEqual([]);
  });

  it("asks for the slot for EVERY entry when the slot carries no condition, as it always did (ADR-0138)", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, withConfirmed(COMPLETE_PROFILE, [["education.prior_qualifications", STILL_STUDYING]]));
    expect(plan.handoffs.filter((h) => h.fieldRef === "qualification_certificate").map((h) => h.item?.index)).toEqual([0, 1]);
    expect(plan.instructions.filter((i) => i.fieldRef === "qualification_certificate_status").map((i) => i.item?.index)).toEqual([0, 1]);
    expect(plan.hidden.some((h) => h.fieldRef === "qualification_certificate")).toBe(false);
  });

  it("STOPS when the entry does not answer the fact the slot is keyed to, rather than guessing either way (ADR-0138)", () => {
    const blueprint = askedWhileStudying(["finished"]);
    const check = checkUsable(SET, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(blueprint, check.mappingSet, WITH_QUALIFICATIONS);
    expect(plan.blockers.map((b) => [b.kind, b.fieldRef])).toEqual([
      ["render_refused", "qualification_certificate"],
      ["render_refused", "qualification_certificate"],
    ]);
    const blocker = plan.blockers[0];
    if (blocker?.kind !== "render_refused") expect.unreachable("asked");
    expect(blocker.refusal.kind).toBe("no_such_part");
  });

  it("REFUSES a document or a condition off the page on a repeating page, and a list that is not one", () => {
    // Until ADR-0119 a handoff on a non-document field of a repeating page
    // was refused here too; it is now the student's own act per entry, tested
    // above.

    // A document is mapped to a held type, not to an item: "the certificate for
    // the second qualification" has no way to be said, so it is refused here.
    const attaching: MappingSet = {
      ...SET,
      mappings: SET.mappings.map((m) =>
        m.fieldRef === "qualification_year" ? { ...m, source: { kind: "document", documentRef: "passport" } } : m,
      ),
    };
    const c1b = checkUsable(attaching, BLUEPRINT);
    expect(c1b.usable).toBe(false);
    if (!c1b.usable) expect(c1b.refusal.kind).toBe("repeat_mapping_invalid");

    // ADR-0104: a condition inside a repeat is answered per item, so one on
    // the page is allowed; one that looks OFF the page has no item to be
    // answered by and is refused.
    const conditioned = withEducation((page) => ({
      ...page,
      sections: page.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) =>
          field.fieldRef === "qualification_year"
            ? { ...field, visibleWhen: { whenFieldRef: "nationality", operator: "is_not_empty" } }
            : field,
        ),
      })),
    }));
    const c2 = checkUsable(SET, conditioned);
    expect(c2.usable).toBe(false);
    if (!c2.usable) expect(c2.refusal.kind).toBe("repeat_mapping_invalid");
    expect(checkUsable(SET, BLUEPRINT).usable, "the fixture's own on-page condition is allowed").toBe(true);

    const notAList = withEducation((page) => ({ ...page, repeats: { fieldKey: "identity.given_name" } }));
    const c3 = checkUsable(SET, notAList);
    expect(c3.usable).toBe(false);
    if (!c3.usable) expect(c3.refusal.kind).toBe("repeat_mapping_invalid");
  });

  it("carries the item through transport", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, WITH_QUALIFICATIONS);
    const stored = toStoredPlan(plan);
    if (!stored.ok) expect.unreachable(stored.refusal);
    const back = rehydratePlan(stored.plan);
    expect(back.instructions.filter((i) => i.fieldRef === "qualification_level").map((i) => i.item)).toEqual([
      { index: 0, count: 2 },
      { index: 1, count: 2 },
    ]);
    expect(educationPage(BLUEPRINT).repeats?.fieldKey).toBe("education.prior_qualifications");
  });
});

describe("a slot's companion handed with the slot, and a control pressed to load options (P100, ADR-0105)", () => {
  const BLUEPRINT = GATED_PORTAL_BLUEPRINT;
  const SET = GATED_PORTAL_MAPPING_SET;
  const QUALIFICATIONS = [
    { level: "Bachelor's degree", subject: "Industrial Engineering", institution: "Sharif University of Technology", countryCode: "IR", start: { year: 2017, month: 9 }, end: { kind: "completed", date: { year: 2021, month: 6 } }, grade: "17.2", gradeScale: "iran_20_point" },
  ];
  const WITH_ONE = withConfirmed(COMPLETE_PROFILE, [["education.prior_qualifications", QUALIFICATIONS]]);
  const remapped = (fieldRef: string, source: MappingSet["mappings"][number]["source"]): MappingSet => ({
    ...SET,
    mappings: SET.mappings.map((m) => (m.fieldRef === fieldRef ? { ...m, source } : m)),
  });

  // ── ADR-0107 (blocker 23, A): a handed slot's companion says "later" ──

  /** The fixture blueprint with the certificate slot's companion values changed. */
  const withCompanion = (companion: Record<string, string> | undefined): ApplicationBlueprint => ({
    ...BLUEPRINT,
    pages: BLUEPRINT.pages.map((page) => ({
      ...page,
      requiredDocuments: page.requiredDocuments.map((document) =>
        document.fieldRef !== "qualification_certificate"
          ? document
          : companion === undefined
            ? { ...document, companion: { fieldRef: "qualification_certificate_status", whenAttached: "now" } }
            : { ...document, companion: { fieldRef: "qualification_certificate_status", whenAttached: "now", ...companion } },
      ),
    })),
  });

  it("sets a handed slot's companion to the reviewer-named DEFER value, once per item, as a statement about when — and says so on the slot's handoff", () => {
    // Vahid, 2026-09-12: *"'I will upload this later' is not a claim about the
    // document, it is a statement about when. We are not saying the student
    // has a certificate, or does not, or will not send one. We are saying
    // nothing is being sent in this act."*
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, WITH_ONE);
    const status = plan.instructions.find((i) => i.fieldRef === "qualification_certificate_status");
    expect(status?.item).toEqual({ index: 0, count: 1 });
    expect(status === undefined ? "" : textOf(status.value)).toBe("later");
    expect(status?.defers).toBe("qualification_certificate");
    // The slot is still the student's own act, and its handoff names what the portal is told.
    const slot = plan.handoffs.find((h) => h.fieldRef === "qualification_certificate");
    expect(slot?.deferred).toEqual({ fieldRef: "qualification_certificate_status", label: "Certificate status", text: "later", displayText: "I will send it later" });
    // The companion is not a handoff any more: the student attaches; we say when.
    expect(plan.handoffs.some((h) => h.fieldRef === "qualification_certificate_status")).toBe(false);
    expect(toStoredPlan(plan).ok).toBe(true);
  });

  it("REFUSES a companion mapped by anything — handed, or set to the refusal-style value, which is never ours to say", () => {
    // ADR-0105's admission is withdrawn: the companion follows the slot, and
    // for a handed slot it says "later" from the blueprint, not from a mapping.
    const handed = checkUsable(
      { ...SET, mappings: [...SET.mappings, { fieldRef: "qualification_certificate_status", source: { kind: "student_handoff", reason: "x" } }] },
      BLUEPRINT,
    );
    expect(handed.usable).toBe(false);
    if (!handed.usable) expect(handed.refusal.kind).toBe("document_companion_invalid");
    // *"'I will not be providing this document' is a claim about the student's
    // intent and is not ours to say, ever, on any portal."*
    const refusing = checkUsable(
      {
        ...SET,
        mappings: [
          ...SET.mappings,
          {
            fieldRef: "qualification_certificate_status",
            source: { kind: "constant", value: "none", classification: "application_metadata", rationale: "x" },
          },
        ],
      },
      BLUEPRINT,
    );
    expect(refusing.usable).toBe(false);
    if (!refusing.usable) {
      expect(refusing.refusal.kind).toBe("document_companion_invalid");
      expect(refusing.refusal.detail).toContain("not ours to say");
    }
    // A radio that is nobody's companion may be handed (ADR-0119): the
    // student's own act per entry, not a companion's licence.
    const level = checkUsable(remapped("qualification_level", { kind: "student_handoff", reason: "x" }), BLUEPRINT);
    expect(level.usable).toBe(true);
  });

  it("REFUSES a handed slot whose companion names no defer value on a page the runner fills — the page waits for the student, or it is not option A", () => {
    // *"If a portal offers only 'now' or 'not providing' with nothing in
    // between, that is not option A and the page waits for the student."*
    const onlyNowOrNever = checkUsable(SET, withCompanion({ whenNotProviding: "none" }));
    expect(onlyNowOrNever.usable).toBe(false);
    if (!onlyNowOrNever.usable) {
      expect(onlyNowOrNever.refusal.kind).toBe("document_companion_invalid");
      expect(onlyNowOrNever.refusal.detail).toContain("waits for the student");
    }
    // The defer value must be one the form offers, and never the refusal one.
    const notOffered = checkUsable(SET, withCompanion({ whenDeferred: "someday" }));
    expect(notOffered.usable).toBe(false);
    const sameAsRefusal = checkUsable(SET, withCompanion({ whenDeferred: "none", whenNotProviding: "none" }));
    expect(sameAsRefusal.usable).toBe(false);
    // The page waiting for the student: nothing on it filled by the plan — the
    // slot stays the student's act and the other fields are mapped by nothing.
    const waiting: MappingSet = {
      ...SET,
      mappings: SET.mappings.filter(
        (m) => !["qualification_level", "qualification_subject", "qualification_institution", "qualification_year", "qualification_grade_note"].includes(m.fieldRef),
      ),
    };
    const waits = checkUsable(waiting, withCompanion(undefined));
    expect(waits.usable, waits.usable ? "" : waits.refusal.detail).toBe(true);
    if (waits.usable) {
      const plan = planFill(withCompanion(undefined), waits.mappingSet, WITH_ONE);
      expect(plan.instructions.some((i) => i.fieldRef === "qualification_certificate_status")).toBe(false);
    }
  });

  it("plans the control to press before waiting for the options", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, COMPLETE_PROFILE);
    const start = plan.instructions.find((i) => i.fieldRef === "start_date");
    expect(start?.optionsAfter).toEqual({ fieldRef: "course", press: { strategy: "id", value: "showStartDatesBtn" } });
    const stored = toStoredPlan(plan);
    if (!stored.ok) expect.unreachable(stored.refusal);
    expect(rehydratePlan(stored.plan).instructions.find((i) => i.fieldRef === "start_date")?.optionsAfter?.press).toEqual({
      strategy: "id",
      value: "showStartDatesBtn",
    });
  });

  it("REFUSES a press that is the page's advance control, its add-another, or the submission control", () => {
    const withPress = (press: { strategy: "id" | "role"; value: string }): ApplicationBlueprint => ({
      ...BLUEPRINT,
      pages: BLUEPRINT.pages.map((page) => ({
        ...page,
        sections: page.sections.map((section) => ({
          ...section,
          fields: section.fields.map((field) =>
            field.fieldRef === "start_date" ? { ...field, optionsAfter: { fieldRef: "course", press } } : field,
          ),
        })),
      })),
    });
    const advance = checkUsable(SET, withPress({ strategy: "role", value: "button:Save and continue" }));
    expect(advance.usable).toBe(false);
    if (!advance.usable) expect(advance.refusal.kind).toBe("options_after_invalid");
    const another = checkUsable(SET, withPress({ strategy: "id", value: "addQualificationBtn" }));
    expect(another.usable).toBe(false);
    if (!another.usable) expect(another.refusal.kind).toBe("options_after_invalid");
    const submit = BLUEPRINT.submission?.submitControl;
    if (submit === undefined) expect.unreachable("the fixture records its submit control");
    const submitting = checkUsable(SET, withPress({ strategy: submit.strategy as "id", value: submit.value }));
    expect(submitting.usable).toBe(false);
    if (!submitting.usable) expect(submitting.refusal.kind).toBe("options_after_invalid");
  });
});

describe("the option a companion does not name (P108) — a fourth value is chosen by nothing", () => {
  // Sheffield's Documentary Evidence radios, read by Vahid from the live page
  // on 2026-09-12: four options per group — Uploaded, UploadLater, NotSending,
  // NotRequired. The blueprint names three. His instruction on the fourth:
  // *"Whatever the blueprint does with it, we never choose it. Check that
  // naming only whenDeferred and whenNotProviding leaves a third value
  // reachable, and if it does, close that."* The fixture's fourth option is
  // "english" — the same shape as *My certificate is in English*.
  const BLUEPRINT = GATED_PORTAL_BLUEPRINT;
  const SET = GATED_PORTAL_MAPPING_SET;
  const FOURTH = "english";
  const QUALIFICATIONS = [
    { level: "Bachelor's degree", subject: "Industrial Engineering", institution: "Sharif University of Technology", countryCode: "IR", start: { year: 2017, month: 9 }, end: { kind: "completed", date: { year: 2021, month: 6 } }, grade: "17.2", gradeScale: "iran_20_point" },
  ];
  const WITH_ONE = withConfirmed(COMPLETE_PROFILE, [["education.prior_qualifications", QUALIFICATIONS]]);
  const everyText = (plan: ReturnType<typeof planFill>): string =>
    JSON.stringify([plan.instructions, plan.handoffs, plan.blockers, plan.uploads]);

  it("REFUSES the fourth value mapped as a constant on the companion — any mapping of a companion is refused, and this one is not the 'not providing' one", () => {
    const fourth = checkUsable(
      {
        ...SET,
        mappings: [
          ...SET.mappings,
          { fieldRef: "qualification_certificate_status", source: { kind: "constant", value: FOURTH, classification: "application_metadata", rationale: "x" } },
        ],
      },
      BLUEPRINT,
    );
    expect(fourth.usable).toBe(false);
    if (!fourth.usable) {
      expect(fourth.refusal.kind).toBe("document_companion_invalid");
      expect(fourth.refusal.detail).toContain("a companion follows its slot");
    }
  });

  it("plans the handed slot's companion as the DEFER value and nothing else — the fourth value appears nowhere in the plan", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(BLUEPRINT, check.mappingSet, WITH_ONE);
    const onCompanion = plan.instructions.filter((i) => i.fieldRef === "qualification_certificate_status");
    expect(onCompanion.map((i) => textOf(i.value))).toEqual(["later"]);
    expect(everyText(plan)).not.toContain(FOURTH);
  });

  it("plans the attached slot's companion as the ATTACH value and nothing else — the fourth value appears nowhere in the plan", () => {
    const check = checkUsable(GATED_PORTAL_WITH_DOCUMENTS_MAPPING_SET, GATED_PORTAL_WITH_DOCUMENTS_BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(GATED_PORTAL_WITH_DOCUMENTS_BLUEPRINT, check.mappingSet, WITH_ONE);
    expect(plan.uploads.map((u) => u.companion?.text)).toEqual(["now"]);
    expect(plan.instructions.some((i) => i.fieldRef === "passport_status")).toBe(false);
    expect(everyText(plan)).not.toContain(FOURTH);
  });

  it("does NOT block on a REQUIRED companion the deferral fills — the plan sets it, so it is not a field with no mapping", () => {
    // Sheffield's radios are required in effect: P105 showed that an entry
    // saved with two of them unanswered is dropped without an error. A
    // reviewer who marks them so must not turn a handed slot into a blocker
    // that only a mapping could answer — and a mapping of a companion is
    // refused. The only honest answer to that blocker would be the one thing
    // the rules forbid, so the blocker must not be raised.
    const required: ApplicationBlueprint = {
      ...BLUEPRINT,
      pages: BLUEPRINT.pages.map((page) => ({
        ...page,
        sections: page.sections.map((section) => ({
          ...section,
          fields: section.fields.map((field) =>
            field.fieldRef === "qualification_certificate_status"
              ? { ...field, validations: [{ kind: "required" as const, source: "dom_attribute" as const }] }
              : field,
          ),
        })),
      })),
    };
    const check = checkUsable(SET, required);
    expect(check.usable, check.usable ? "" : check.refusal.detail).toBe(true);
    if (!check.usable) expect.unreachable("usable");
    const plan = planFill(required, check.mappingSet, WITH_ONE);
    expect(plan.blockers.filter((b) => b.fieldRef === "qualification_certificate_status")).toEqual([]);
    expect(plan.instructions.filter((i) => i.fieldRef === "qualification_certificate_status").map((i) => textOf(i.value))).toEqual(["later"]);
    expect(everyText(plan)).not.toContain(FOURTH);
  });
});

describe("a typeahead mapping names the value the form submits (P118, ADR-0109)", () => {
  // Vahid, 2026-09-13: *"Name the value. The duplicates are SCH40484 and
  // SHE0512, distinguishable only by value."* His two conditions: the
  // mapping names the value AND the reviewer records the text it reads as,
  // and both must match at the fill; the preview shows the student the text,
  // never the code. The fixture's course box carries its entries as
  // `options` (value = what the form submits, label = what is shown) and
  // names its escape by value.
  const BLUEPRINT = GATED_PORTAL_BLUEPRINT;
  const SET = GATED_PORTAL_MAPPING_SET;
  const courseAs = (source: MappingSet["mappings"][number]["source"]): MappingSet => ({
    ...SET,
    mappings: SET.mappings.map((m) => (m.fieldRef === "course" ? { ...m, source } : m)),
  });
  const constant = (value: string): MappingSet["mappings"][number]["source"] => ({
    kind: "constant",
    value,
    classification: "application_metadata",
    rationale: "x",
  });

  it("plans the VALUE, and carries the text the reviewer recorded for it — the runner needs both", () => {
    const check = checkUsable(SET, BLUEPRINT);
    if (!check.usable) expect.unreachable(check.refusal.detail);
    const plan = planFill(BLUEPRINT, check.mappingSet, COMPLETE_PROFILE);
    const course = plan.instructions.find((i) => i.fieldRef === "course");
    expect(course === undefined ? "" : textOf(course.value)).toBe("PG-EX-2026");
    expect(course?.typeahead).toEqual({
      optionLocator: { strategy: "css", value: "#courseOptions [role=option]" },
      text: "MSc Example Studies",
      escapeValue: "Not in list",
    });
    const stored = toStoredPlan(plan);
    if (!stored.ok) expect.unreachable(stored.refusal);
    expect(rehydratePlan(stored.plan).instructions.find((i) => i.fieldRef === "course")?.typeahead?.text).toBe("MSc Example Studies");
  });

  it("REFUSES a typeahead mapping that names a value the field's entries do not hold — the text is not the value", () => {
    // The text the applicant reads, named as the value: not offered.
    const byText = checkUsable(courseAs(constant("MSc Example Studies")), BLUEPRINT);
    expect(byText.usable).toBe(false);
    if (!byText.usable) {
      expect(byText.refusal.kind).toBe("typeahead_invalid");
      expect(byText.refusal.detail).toContain("MSc Example Studies");
    }
    const unknown = checkUsable(courseAs(constant("PG-NOPE")), BLUEPRINT);
    expect(unknown.usable).toBe(false);
  });

  it("REFUSES the ESCAPE, named by value — even where the escape's value is its own label", () => {
    // Sheffield's list ends with "Not in list", whose value IS "Not in list"
    // (Vahid, 2026-09-13). *"A value equal to its own label is not the clean
    // sentinel 9004 would have been."* The guard compares values, so it holds.
    const escape = checkUsable(courseAs(constant("Not in list")), BLUEPRINT);
    expect(escape.usable).toBe(false);
    if (!escape.usable) {
      expect(escape.refusal.kind).toBe("typeahead_invalid");
      expect(escape.refusal.detail).toContain("escape");
    }
  });

  it("REFUSES a typeahead mapped from a profile field without an option rule onto the entries — free text is never the value", () => {
    const text = checkUsable(
      courseAs({ kind: "profile_field", fieldKey: "study.personal_statement", format: { kind: "text" } }),
      BLUEPRINT,
    );
    expect(text.usable).toBe(false);
    if (!text.usable) expect(text.refusal.kind).toBe("typeahead_invalid");
    // An option rule whose every target is an entry: accepted. One target
    // that is the escape: refused.
    const onto = checkUsable(
      courseAs({
        kind: "profile_field",
        fieldKey: "study.personal_statement",
        format: { kind: "option", options: { "Because it is the course I want.": "PG-EX-2026" } },
      }),
      BLUEPRINT,
    );
    expect(onto.usable, onto.usable ? "" : onto.refusal.detail).toBe(true);
    const ontoEscape = checkUsable(
      courseAs({
        kind: "profile_field",
        fieldKey: "study.personal_statement",
        format: { kind: "option", options: { "Because it is the course I want.": "Not in list" } },
      }),
      BLUEPRINT,
    );
    expect(ontoEscape.usable).toBe(false);
  });

  it("REFUSES a mapped typeahead that records no entries at all", () => {
    const withoutOptions: ApplicationBlueprint = {
      ...BLUEPRINT,
      pages: BLUEPRINT.pages.map((page) => ({
        ...page,
        sections: page.sections.map((section) => ({
          ...section,
          fields: section.fields.map((field) => {
            if (field.fieldRef !== "course") return field;
            const { options: _options, ...rest } = field;
            return rest;
          }),
        })),
      })),
    };
    const check = checkUsable(SET, withoutOptions);
    expect(check.usable).toBe(false);
    if (!check.usable) expect(check.refusal.kind).toBe("typeahead_invalid");
  });
});

describe("a control fronted by another is neither mapped nor left empty (P153)", () => {
  // Found reading Run A's preview for the signature: the two hidden selects
  // behind Sheffield's country and institution boxes were listed as "left
  // empty" — "Nothing you told us goes into these boxes" — when the boxes set
  // them. A blueprint fact says so now: `frontedBy` names the control that
  // sets this one. The plan lists a fronted field nowhere; a mapping to it is
  // refused (the box is what is mapped); and the fronting control must be a
  // field on the same page.
  const BLUEPRINT = GATED_PORTAL_BLUEPRINT;
  const SET = GATED_PORTAL_MAPPING_SET;
  const withHidden = (frontedBy: string): ApplicationBlueprint => ({
    ...BLUEPRINT,
    pages: BLUEPRINT.pages.map((page) =>
      page.sections.some((section) => section.fields.some((field) => field.fieldRef === "course"))
        ? {
            ...page,
            sections: page.sections.map((section, index) =>
              index === 0
                ? {
                    ...section,
                    fields: [
                      ...section.fields,
                      {
                        fieldRef: "course_code",
                        label: "course_code",
                        inputType: "select" as const,
                        dataCategory: "ordinary" as const,
                        locators: [{ strategy: "name" as const, value: "course_code" }],
                        validations: [],
                        options: [{ value: "", label: "" }, { value: "PG-EX-2026", label: "PG-EX-2026" }],
                        frontedBy,
                      },
                    ],
                  }
                : section,
            ),
          }
        : page,
    ),
  });

  it("plans the page without the hidden select: not typed, not a blocker, not left empty", () => {
    const check = checkUsable(SET, withHidden("course"));
    if (!check.usable) expect.unreachable(check.refusal.detail);
    const plan = planFill(withHidden("course"), check.mappingSet, COMPLETE_PROFILE);
    expect(plan.instructions.some((i) => i.fieldRef === "course_code")).toBe(false);
    expect(plan.blockers.some((b) => b.fieldRef === "course_code")).toBe(false);
    expect(plan.unmapped.some((u) => u.fieldRef === "course_code")).toBe(false);
    expect(plan.instructions.some((i) => i.fieldRef === "course"), "the box is what is filled").toBe(true);
  });

  it("REFUSES a mapping to a fronted control — the box that fronts it is what is mapped", () => {
    const mapped: MappingSet = {
      ...SET,
      mappings: [
        ...SET.mappings,
        { fieldRef: "course_code", source: { kind: "constant", value: "PG-EX-2026", classification: "application_metadata", rationale: "x" } },
      ],
    };
    const check = checkUsable(mapped, withHidden("course"));
    expect(check.usable).toBe(false);
    if (!check.usable) {
      expect(check.refusal.kind).toBe("fronted_field_invalid");
      expect(check.refusal.detail).toContain("course_code");
    }
  });

  it("REFUSES a frontedBy that names a field not on the same page, or itself", () => {
    for (const bad of ["account_email", "course_code", "nowhere"]) {
      const check = checkUsable(SET, withHidden(bad));
      expect(check.usable, bad).toBe(false);
      if (!check.usable) expect(check.refusal.kind, bad).toBe("fronted_field_invalid");
    }
  });
});
