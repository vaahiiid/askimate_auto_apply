import { describe, expect, it } from "vitest";

import type { ApplicationBlueprint, BlueprintField } from "@askimate/aas-blueprint";
import { proposeValue, studentId } from "@askimate/aas-domain";
import type { MappingSet, StudentChoice } from "@askimate/aas-mapping";
import { checkUsable, planFill } from "@askimate/aas-mapping";
import { FIXTURE_BLUEPRINT, FIXTURE_MAPPING_SET } from "@askimate/aas-mapping/fixtures";
import type { ConfirmedProfile, ProfileFieldKey, ProfileFieldType } from "@askimate/aas-profile";
import { applyConfirmation, confirmField, emptyProfile, isDeclined } from "@askimate/aas-profile";

import { entryChoiceMessage, entryChoiceOffer, entryChosenMessage, ESCAPE_ID } from "./entry-choice-offer.js";

// P290, ADR-0155. The message of 2026-10-05, 15:02 UTC, which speaks of Vahid
// in the third person: *"The system never pre-selects, never orders by
// similarity, and never says "did you mean". The entries are shown as the
// portal returned them."* *"The escape is always offered alongside, not as a
// last resort after they have been shown near-misses."*

const NOW = new Date("2026-10-05T12:00:00Z");
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

const PROFILE = confirmed([
  ["identity.given_name", "Niloofar"],
  ["identity.family_name", "Hosseini"],
  ["identity.date_of_birth", new Date("1999-04-02T00:00:00Z")],
  ["identity.nationality", "Persian (Tehran)"],
  ["contact.email", "niloofar.hosseini@example.com"],
  ["study.personal_statement", "A".repeat(60)],
]);

const UNLISTED: BlueprintField = {
  fieldRef: "nationality_unlisted",
  label: "If not listed, your nationality:",
  inputType: "text",
  dataCategory: "ordinary",
  locators: [{ strategy: "id", value: "nationalityUnlisted" }],
  validations: [],
  visibleWhen: { whenFieldRef: "nationality", operator: "equals", value: ESCAPE },
};

/** A change to a field: a key given as `undefined` is REMOVED, so a test can take the escape away. */
type FieldPatch = { readonly [K in keyof BlueprintField]?: BlueprintField[K] | undefined };

function patched(field: BlueprintField, patch: FieldPatch): BlueprintField {
  const merged: Record<string, unknown> = { ...field, ...patch };
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete merged[key];
  return merged as unknown as BlueprintField;
}

/** The fixture's nationality select, reshaped, with the box its escape opens after it. */
function blueprintWith(patch: FieldPatch, extra: readonly BlueprintField[] = [UNLISTED]): ApplicationBlueprint {
  return {
    ...FIXTURE_BLUEPRINT,
    pages: FIXTURE_BLUEPRINT.pages.map((page) => ({
      ...page,
      sections: page.sections.map((section) => ({
        ...section,
        fields: section.fields.flatMap((field): BlueprintField[] =>
          field.fieldRef === "nationality"
            ? [patched({ ...field, options: [...(field.options ?? []), { value: ESCAPE, label: "Not in list" }], escapeValue: ESCAPE }, patch), ...extra]
            : [field],
        ),
      })),
    })),
  };
}

/** The fixture's three nationalities, which its mapping names — so every reshaped list keeps them. */
const THREE = [
  { value: "IR", label: "Iran (Islamic Republic of)" },
  { value: "IQ", label: "Iraq" },
  { value: "GB", label: "United Kingdom" },
] as const;

const OWN_WORDS = { fieldRef: "nationality_unlisted", source: { kind: "profile_field" as const, fieldKey: "identity.nationality" as const, format: { kind: "text" as const } } };

function offerOn(blueprint: ApplicationBlueprint, extra: MappingSet["mappings"] = [OWN_WORDS], choices: readonly StudentChoice[] = []) {
  const check = checkUsable({ ...FIXTURE_MAPPING_SET, mappings: [...FIXTURE_MAPPING_SET.mappings, ...extra] }, blueprint);
  if (!check.usable) expect.unreachable(check.refusal.detail);
  const set = check.mappingSet;
  return entryChoiceOffer(blueprint, planFill(blueprint, set, PROFILE, choices), (choice) => planFill(blueprint, set, PROFILE, [...choices, choice]));
}

describe("what the student is offered when the form's list does not hold their value (P290, ADR-0155)", () => {
  it("a list shown whole: every entry in the form's order, the escape apart — and what choosing it would type, read from the plan", () => {
    const offer = offerOn(blueprintWith({}));
    if (offer === null) expect.unreachable("an offer");
    expect(offer.fieldRef).toBe("nationality");
    expect(offer.studentValue).toBe("Persian (Tehran)");
    expect(offer.why).toBe("not_listed");
    expect(offer.source).toEqual({ kind: "whole" });
    expect(offer.entries).toEqual([
      { id: "e1", value: "IR", label: "Iran (Islamic Republic of)" },
      { id: "e2", value: "IQ", label: "Iraq" },
      { id: "e3", value: "GB", label: "United Kingdom" },
    ]);
    expect(offer.escape).toEqual({ id: ESCAPE_ID, value: ESCAPE, label: "Not in list" });
    expect(offer.ownWordsBox).toEqual({ label: "If not listed, your nationality:", text: "Persian (Tehran)" });
    expect(offer.offerHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("says what it offers, promises only what the plan does, and never chooses", () => {
    const offer = offerOn(blueprintWith({}));
    if (offer === null) expect.unreachable("an offer");
    expect(entryChoiceMessage("Example University", offer)).toBe(
      'Their form asks you to choose your nationality from its own list, and it does not hold "Persian (Tehran)", which is what you told me. ' +
        "It holds the 3 entries below, in its own order. If one of them is yours, choose it. " +
        'If none is, choose "Not in list": that is the form\'s own option for exactly this, and I will type your own words, "Persian (Tehran)", into the box it opens. ' +
        "Whichever you choose is your answer and is recorded as yours. I will not choose for you, and nothing is chosen until you press one.",
    );
    // No box mapped for the escape's words: nothing is promised about one.
    const bare = offerOn(blueprintWith({}), []);
    if (bare === null) expect.unreachable("an offer");
    expect(bare.ownWordsBox).toBeUndefined();
    expect(entryChoiceMessage("Example University", bare)).toContain(`choose "Not in list": that is the form's own option for exactly this. Whichever`);
    expect(entryChosenMessage(offer, offer.escape)).toBe('You chose "Not in list" for your nationality, where you told me "Persian (Tehran)". That is recorded as your answer.');
    expect(entryChosenMessage(offer, offer.entries[0]!)).toBe(
      'You chose "Iran (Islamic Republic of)" on their list for your nationality, where you told me "Persian (Tehran)". That is recorded as your answer.',
    );
  });

  it("a searched list offers what the search RETURNED, chosen by the word in the student's own words — and nothing when no search's word is", () => {
    const searched = (searches: BlueprintField["searches"]) =>
      blueprintWith({ inputType: "typeahead", escapeValue: undefined, typeahead: { optionLocator: { strategy: "css", value: "li" }, escapeValue: ESCAPE }, searches });
    const offer = offerOn(searched([{ word: "Iraq", entries: ["IQ"] }, { word: "tehran", entries: ["IR", "GB"] }]));
    if (offer === null) expect.unreachable("an offer");
    expect(offer.source).toEqual({ kind: "search", word: "tehran" });
    // As returned, in the search's order — not the field's, and not by likeness.
    expect(offer.entries.map((entry) => entry.value)).toEqual(["IR", "GB"]);
    expect(entryChoiceMessage("Example University", offer)).toContain('Searched for "tehran", it offers the 2 entries below, in its own order.');
    // No search read for these words: no offer, and the value goes to a person.
    expect(offerOn(searched([{ word: "Iraq", entries: ["IQ"] }]))).toBeNull();
    // Two searched words in theirs: nothing they said chooses the list, so neither is offered.
    expect(offerOn(searched([{ word: "persian", entries: ["IR"] }, { word: "tehran", entries: ["IR", "GB"] }]))).toBeNull();
    expect(offerOn(searched(undefined))).toBeNull();
    // A search that returned only the escape is still an offer: the escape alone, said as that.
    const empty = offerOn(searched([{ word: "Persian", entries: [] }]));
    if (empty === null) expect.unreachable("an offer of the escape");
    expect(empty.entries).toEqual([]);
    expect(entryChoiceMessage("Example University", empty)).toContain('Searched for "Persian", it offers no entry apart from its own option for one that is not on it.');
    expect(entryChoiceMessage("Example University", empty)).not.toContain("If one of them is yours");
  });

  it("promises nothing for a box too short for the student's words — says so, and does not shorten them (P291)", () => {
    // Sheffield's award-title box takes 28 characters; "Doctorate of
    // Business Administration" is 36.
    const short = { ...UNLISTED, validations: [{ kind: "maxlength" as const, value: "10", source: "dom_attribute" as const }] };
    const offer = offerOn(blueprintWith({}, [short]));
    if (offer === null) expect.unreachable("an offer");
    expect(offer.ownWordsBox).toEqual({ label: UNLISTED.label, text: "Persian (Tehran)", tooLong: { max: 10, length: 16 } });
    const said = entryChoiceMessage("Example University", offer);
    expect(said).toContain('choose "Not in list": that is the form\'s own option for exactly this. The box it opens takes at most 10 characters, and your words, "Persian (Tehran)", are 16, so they will not go in as they are; I will not shorten them for you.');
    expect(said).not.toContain("I will type");
  });

  it("a whole list's own prompt is not offered as an entry (P291)", () => {
    // Sheffield's award title opens on "Select qualification...", whose value
    // is that text: read 6 printed it first.
    const offer = offerOn(blueprintWith({ options: [{ value: "Select nationality...", label: "Select nationality..." }, ...THREE, { value: ESCAPE, label: "Not in list" }], prompt: "Select nationality..." }));
    expect(offer?.entries.map((entry) => entry.value)).toEqual(["IR", "IQ", "GB"]);
  });

  it("an escape read to lead nowhere is not offered — not as a way through, and not at all (P291)", () => {
    // Vahid, 2026-10-06, of Sheffield's grading system: *"the offer must not
    // present that escape as a way through."*
    expect(offerOn(blueprintWith({ escapeLeadsNowhere: "With it chosen, the grade list holds one empty option and no box opens." }))).toBeNull();
  });

  it("no escape on record, no offer: the student would have no honest answer if none of the list is theirs", () => {
    expect(offerOn(blueprintWith({ escapeValue: undefined, options: THREE }, []), [])).toBeNull();
  });

  it("a list the form loads after an earlier box is read for THAT box's value — so it is offered only after the student's choice there", () => {
    const DETAIL: BlueprintField = {
      fieldRef: "nationality_detail",
      label: "Nationality detail",
      inputType: "select",
      dataCategory: "ordinary",
      locators: [{ strategy: "id", value: "nationalityDetail" }],
      validations: [],
      options: [{ value: "N1", label: "Other (Asia)" }, { value: "N2", label: "Other (Europe)" }, { value: "NONE", label: "None of these" }],
      escapeValue: "NONE",
      optionsAfter: { fieldRef: "nationality" },
      listsAfter: [{ fieldRef: "nationality", value: ESCAPE, entries: ["N1", "N2"] }],
    };
    const blueprint = blueprintWith({}, [UNLISTED, DETAIL]);
    const detail = { fieldRef: "nationality_detail", source: { kind: "profile_field" as const, fieldKey: "identity.nationality" as const, format: { kind: "option" as const, options: { Iranian: "N1" } } } };
    // First the nationality itself — the detail's list is not known yet.
    const first = offerOn(blueprint, [OWN_WORDS, detail]);
    expect(first?.fieldRef).toBe("nationality");
    // After the student chose the escape there, the detail's list read for it.
    const escaped: StudentChoice = { fieldRef: "nationality", studentValue: "Persian (Tehran)", value: ESCAPE, label: "Not in list", escape: true };
    const next = offerOn(blueprint, [OWN_WORDS, detail], [escaped]);
    if (next === null) expect.unreachable("the detail offered");
    expect(next.fieldRef).toBe("nationality_detail");
    expect(next.source).toEqual({ kind: "after", fieldRef: "nationality", fieldLabel: "Nationality", value: ESCAPE, valueLabel: "Not in list" });
    expect(next.entries.map((entry) => entry.label)).toEqual(["Other (Asia)", "Other (Europe)"]);
    expect(next.escape).toEqual({ id: ESCAPE_ID, value: "NONE", label: "None of these" });
    expect(entryChoiceMessage("Example University", next)).toContain('With "Not in list" as the nationality, it offers the 2 entries below, in its own order.');
    // A value the list was not read for: no offer.
    const elsewhere: StudentChoice = { ...escaped, value: "IQ", label: "Iraq", escape: false };
    expect(offerOn(blueprint, [OWN_WORDS, detail], [elsewhere])).toBeNull();
  });

  it("a read that records what it was made under is offered only to an entry the plan sets the same way (P294)", () => {
    // Vahid, 2026-10-09: *"Record the country a read was made under in the
    // reads record itself"*. A search read with the country set to Iran is
    // not what the form shows a student whose country it sets to France.
    const COUNTRY: BlueprintField = {
      fieldRef: "residence_country",
      label: "Country",
      inputType: "select",
      dataCategory: "ordinary",
      locators: [{ strategy: "id", value: "residenceCountry" }],
      validations: [],
      options: [{ value: "IRAN", label: "Iran" }, { value: "FRANCE", label: "France" }],
    };
    const blueprint = (under: readonly { fieldRef: string; value: string }[]): ApplicationBlueprint => ({
      ...FIXTURE_BLUEPRINT,
      pages: FIXTURE_BLUEPRINT.pages.map((page) => ({
        ...page,
        sections: page.sections.map((section) => ({
          ...section,
          fields: section.fields.flatMap((field): BlueprintField[] =>
            field.fieldRef === "nationality"
              ? [
                  COUNTRY,
                  patched(
                    // Entries no row of the fixture names: a row that sent one would have to be keyed on the country (P294).
                    { ...field, options: [...(field.options ?? []), { value: "TEH", label: "Tehrani" }, { value: "PER", label: "Persian (other)" }, { value: ESCAPE, label: "Not in list" }] },
                    {
                      inputType: "typeahead",
                      typeahead: { optionLocator: { strategy: "css", value: "li" }, escapeValue: ESCAPE },
                      optionsAfter: { fieldRef: "residence_country" },
                      searches: [{ word: "tehran", entries: ["TEH", "PER"], under }],
                    },
                  ),
                  UNLISTED,
                ]
              : [field],
          ),
        })),
      })),
    });
    const country = (value: string) => ({ fieldRef: "residence_country", source: { kind: "constant" as const, value, classification: "application_metadata" as const, rationale: "The country this test sets." } });
    const UNDER_IRAN = [{ fieldRef: "residence_country", value: "IRAN" }];
    const iran = offerOn(blueprint(UNDER_IRAN), [OWN_WORDS, country("IRAN")]);
    if (iran === null) expect.unreachable("offered where the plan sets Iran");
    expect(iran.source).toEqual({ kind: "search", word: "tehran" });
    // Set to France: the search read under Iran is not offered; a person looks.
    expect(offerOn(blueprint(UNDER_IRAN), [OWN_WORDS, country("FRANCE")])).toBeNull();
    // The same of a list read after an earlier box: after the escape there,
    // the detail's list read under Iran is offered only where the plan sets Iran.
    const DETAIL: BlueprintField = {
      fieldRef: "nationality_detail",
      label: "Nationality detail",
      inputType: "select",
      dataCategory: "ordinary",
      locators: [{ strategy: "id", value: "nationalityDetail" }],
      validations: [],
      options: [{ value: "N1", label: "Other (Asia)" }, { value: "N2", label: "Other (Europe)" }, { value: "NONE", label: "None of these" }],
      escapeValue: "NONE",
      optionsAfter: { fieldRef: "nationality" },
      listsAfter: [{ fieldRef: "nationality", value: ESCAPE, entries: ["N1", "N2"], under: UNDER_IRAN }],
    };
    const withDetail = (): ApplicationBlueprint => {
      const base = blueprint(UNDER_IRAN);
      return { ...base, pages: base.pages.map((page) => ({ ...page, sections: page.sections.map((section) => ({ ...section, fields: section.fields.flatMap((field) => (field.fieldRef === "nationality_unlisted" ? [field, DETAIL] : [field])) })) })) };
    };
    const detail = { fieldRef: "nationality_detail", source: { kind: "profile_field" as const, fieldKey: "identity.nationality" as const, format: { kind: "option" as const, options: { Iranian: "N1" } } } };
    const escaped: StudentChoice = { fieldRef: "nationality", studentValue: "Persian (Tehran)", value: ESCAPE, label: "Not in list", escape: true, searchedWith: "tehran" };
    expect(offerOn(withDetail(), [OWN_WORDS, detail, country("IRAN")], [escaped])?.fieldRef).toBe("nationality_detail");
    expect(offerOn(withDetail(), [OWN_WORDS, detail, country("FRANCE")], [escaped])).toBeNull();
  });

  it("the hash moves with what is shown: another entry, another order, another escape", () => {
    const base = offerOn(blueprintWith({}))?.offerHash;
    const [ir, iq, gb] = THREE;
    expect(offerOn(blueprintWith({ options: [iq, ir, gb, { value: ESCAPE, label: "Not in list" }] }))?.offerHash).not.toBe(base);
    expect(offerOn(blueprintWith({ options: [...THREE, { value: ESCAPE, label: "Not listed" }] }))?.offerHash).not.toBe(base);
    expect(offerOn(blueprintWith({}))?.offerHash).toBe(base);
  });
});
