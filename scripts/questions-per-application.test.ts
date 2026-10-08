import { describe, expect, it } from "vitest";

import type { ApplicationBlueprint, BlueprintField } from "@askimate/aas-blueprint";
import { proposeValue, studentId } from "@askimate/aas-domain";
import type { MappingSet } from "@askimate/aas-mapping";
import { FIXTURE_BLUEPRINT, FIXTURE_MAPPING_SET } from "@askimate/aas-mapping/fixtures";
import type { ConfirmedProfile, ProfileFieldKey, ProfileFieldType } from "@askimate/aas-profile";
import { applyConfirmation, confirmField, emptyProfile, isDeclined } from "@askimate/aas-profile";

import { NO_STANDING_RULES, questionsProposed, questionsToday } from "./questions-per-application.js";

// P292. The measure, on small shapes whose answers are known, so the numbers it
// gives on his run rest on a counter that has been seen to count.

const NOW = new Date("2026-10-08T12:00:00Z");
const STUDENT = studentId("student-1");
const ESCAPE = "Not in list";

function confirmed(entries: readonly [ProfileFieldKey, unknown][]): ConfirmedProfile {
  let next = emptyProfile(STUDENT, NOW);
  for (const [key, value] of entries) {
    const result = applyConfirmation({
      key,
      proposed: proposeValue({ value: value as ProfileFieldType<ProfileFieldKey>, origin: "conversation", verbatim: "as stated", confidence: 0.9 }),
      confirmation: { studentRef: STUDENT, presentedText: "…", respondedAt: NOW, response: { kind: "accepted" } },
    });
    if (isDeclined(result)) expect.unreachable("accepted");
    next = confirmField(next, result, NOW);
  }
  return next;
}

const profileWith = (nationality: string): ConfirmedProfile =>
  confirmed([
    ["identity.given_name", "Niloofar"],
    ["identity.family_name", "Hosseini"],
    ["identity.date_of_birth", new Date("1999-04-02T00:00:00Z")],
    ["identity.nationality", nationality],
    ["contact.email", "niloofar.hosseini@example.com"],
    ["study.personal_statement", "A".repeat(60)],
  ]);

const box = (maxlength?: string): BlueprintField => ({
  fieldRef: "nationality_unlisted",
  label: "If not listed",
  inputType: "text",
  dataCategory: "ordinary",
  locators: [{ strategy: "id", value: "nationalityUnlisted" }],
  validations: maxlength === undefined ? [] : [{ kind: "maxlength", value: maxlength, source: "dom_attribute" }],
  visibleWhen: { whenFieldRef: "nationality", operator: "equals", value: ESCAPE },
});

function entryWith(patch: Partial<BlueprintField>, unlisted: BlueprintField = box()): { blueprint: ApplicationBlueprint; mappingSet: MappingSet } {
  return {
    blueprint: {
      ...FIXTURE_BLUEPRINT,
      pages: FIXTURE_BLUEPRINT.pages.map((page) => ({
        ...page,
        sections: page.sections.map((section) => ({
          ...section,
          fields: section.fields.flatMap((field): BlueprintField[] =>
            field.fieldRef === "nationality"
              ? [{ ...field, options: [...(field.options ?? []), { value: ESCAPE, label: "Not in list" }], escapeValue: ESCAPE, ...patch }, unlisted]
              : [field],
          ),
        })),
      })),
    },
    mappingSet: {
      ...FIXTURE_MAPPING_SET,
      mappings: [...FIXTURE_MAPPING_SET.mappings, { fieldRef: "nationality_unlisted", source: { kind: "profile_field", fieldKey: "identity.nationality", format: { kind: "text" } } }],
    },
  };
}

describe("questions per application (P292, ADR-0156 proposed)", () => {
  it("counts nothing where the rules map everything", () => {
    const entry = entryWith({});
    expect(questionsToday(entry, profileWith("Iranian"))).toEqual([]);
    expect(questionsProposed(entry, profileWith("Iranian"), NO_STANDING_RULES).perApplication).toEqual([]);
  });

  it("today: a list on file is one choice mid-run; proposed: a question before the run, or none with the standing rule", () => {
    const entry = entryWith({});
    const today = questionsToday(entry, profileWith("Persian"));
    expect(today.map((q) => `${q.field}:${q.kind}`)).toEqual(["nationality:choice"]);
    expect(today[0]?.reason).toBe('offered mid-run: 3 entries and "Not in list" for "Persian"');
    const bare = questionsProposed(entry, profileWith("Persian"), NO_STANDING_RULES);
    expect(bare.perApplication.map((q) => q.field)).toEqual(["nationality"]);
    expect(bare.atIntake).toEqual(["escape when not listed"]);
    const ruled = questionsProposed(entry, profileWith("Persian"), { escapeWhenNotListed: true, shortForms: {} });
    expect(ruled.perApplication).toEqual([]);
    expect(ruled.settled.map((q) => q.how)).toEqual(["the standing rule from intake: the escape with their own words, shown in the preview"]);
  });

  it("proposed: a search that returned only the escape is one option, so no question even without a standing rule", () => {
    const entry = entryWith({ inputType: "typeahead", typeahead: { optionLocator: { strategy: "css", value: "li" }, escapeValue: ESCAPE }, searches: [{ word: "Persian", entries: [] }] });
    expect(questionsToday(entry, profileWith("Persian")).map((q) => q.field)).toEqual(["nationality"]);
    const bare = questionsProposed(entry, profileWith("Persian"), NO_STANDING_RULES);
    expect(bare.perApplication).toEqual([]);
    expect(bare.atIntake).toEqual([]);
  });

  it("a dead-end escape is a stop for a person today, and still a question under the proposal — before the run", () => {
    const entry = entryWith({ escapeLeadsNowhere: "Nothing the form asks next can be answered." });
    expect(questionsToday(entry, profileWith("Persian")).map((q) => `${q.field}:${q.kind}`)).toEqual(["nationality:person"]);
    const proposed = questionsProposed(entry, profileWith("Persian"), { escapeWhenNotListed: true, shortForms: {} });
    expect(proposed.perApplication.map((q) => `${q.field}:${q.kind}`)).toEqual(["nationality:choice"]);
    expect(proposed.perApplication[0]?.reason).toContain("asked before the run starts");
  });

  it("words too long for the escape's box: a refusal today; a standing short form settles it, and no short form leaves a question", () => {
    const entry = entryWith({}, box("5"));
    expect(questionsToday(entry, profileWith("Persian")).map((q) => `${q.field}:${q.kind}`)).toEqual(["nationality:choice", "nationality_unlisted:fix"]);
    // The box's mapping types the whole field, not a part, so no short form can be keyed to it.
    const none = questionsProposed(entry, profileWith("Persian"), { escapeWhenNotListed: true, shortForms: {} });
    expect(none.perApplication.map((q) => `${q.field}:${q.kind}`)).toEqual(["nationality_unlisted:fix"]);
  });
});
