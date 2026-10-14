import { describe, expect, it } from "vitest";

import { closedPart, namedPlace, placesHolding, placesSaying, placesToCorrect, readCorrectionRequest, refusedPart } from "./correction-requests.js";

// P288, ADR-0154. Vahid: *"a confirmed value should be correctable by asking,
// the same way a deletion is asked for."* The reader finds both halves; the
// driver finds the answer by its own words and plays the correction back.
describe("a correction to a confirmed answer, read from the student's words (P288)", () => {
  it("reads both halves in the ways a person says it", () => {
    const cases: readonly [string, string, string][] = [
      ["my Master's institution is Islamic Azad University, not Azad University", "Azad University", "Islamic Azad University"],
      ["It's Islamic Azad University, not Azad University.", "Azad University", "Islamic Azad University"],
      ["This is wrong: my institution is Islamic Azad University, not Azad University", "Azad University", "Islamic Azad University"],
      ["not Azad University but Islamic Azad University", "Azad University", "Islamic Azad University"],
      ["Not Azad University, it's Islamic Azad University", "Azad University", "Islamic Azad University"],
      ["change my institution from Azad University to Islamic Azad University", "Azad University", "Islamic Azad University"],
      ["Please change \"Azad University\" to \"Islamic Azad University\"", "Azad University", "Islamic Azad University"],
      ["replace Azad University with Islamic Azad University please", "Azad University", "Islamic Azad University"],
      ["my subject should be International Business, not Business", "Business", "International Business"],
    ];
    for (const [said, from, to] of cases) {
      const read = readCorrectionRequest(said);
      expect(read.kind, said).toBe("request");
      if (read.kind !== "request") continue;
      expect(read.from, said).toBe(from);
      expect(read.to, said).toBe(to);
    }
  });

  it("keeps the words before the correction, which name which entry is meant", () => {
    const read = readCorrectionRequest("my Master's institution is Islamic Azad University, not Azad University");
    expect(read.kind === "request" ? read.context : null).toBe("my Master's institution");
  });

  it("asks back, never guesses, when a correction is asked for without both halves", () => {
    for (const said of ["my institution is wrong", "I made a mistake in my answers", "I mistyped my subject", "can I change my institution?", "I need to correct one of my answers"]) {
      expect(readCorrectionRequest(said).kind, said).toBe("unclear");
    }
  });

  it("reads nothing into an answer, a negation, or the same words twice", () => {
    for (const said of [
      "Islamic Azad University",
      "2019 to 2021",
      "nothing is wrong",
      "that's not wrong",
      "don't change anything",
      "it is X, not X",
      "University of Notre Dame",
    ]) {
      expect(readCorrectionRequest(said).kind, said).toBe("not_a_request");
    }
  });
});

describe("the confirmed answer a correction names, found by its own words (P288)", () => {
  const education = [
    { level: "Doctorate", institution: "HHE", awardTitle: "Doctorate of Business Administration", subject: "International Business" },
    { level: "Master's degree", institution: "Azad University", awardTitle: "Master's in International Business", subject: "International Business" },
  ];
  const confirmed = new Map<string, unknown>([
    ["identity.legalName", { given: "Sam", family: "Doe" }],
    ["education.prior_qualifications", education],
    ["contact.email", "sam@example.test"],
  ]);

  it("finds a part of a list's entry, a part of a composite, and a plain field", () => {
    expect(placesHolding(confirmed, "azad  university")).toEqual([{ fieldKey: "education.prior_qualifications", item: 1, part: "institution" }]);
    expect(placesHolding(confirmed, "Sam")).toEqual([{ fieldKey: "identity.legalName", part: "given" }]);
    expect(placesHolding(confirmed, "sam@example.test")).toEqual([{ fieldKey: "contact.email" }]);
    expect(placesHolding(confirmed, "Islamic Azad University"), "words no answer holds are found nowhere").toEqual([]);
  });

  // P297: a grade scale that is not exactly one of the table's phrases is
  // kept in the student's own words, which a correction may change. Since
  // P311 a token of the set, or a country, is corrected too, read into the set.
  it("lets a grade scale held in the student's words be corrected, and knows a token of the set from the student's own words (P297, P311)", () => {
    const held = new Map<string, unknown>([
      ["education.prior_qualifications", [
        { institution: "University of Delhi", countryCode: "IN", grade: "8.2", gradeScale: "CGPA out of 10" },
        { institution: "Islamic Azad University", countryCode: "IR", grade: "19.5", gradeScale: "twenty_point" },
      ]],
      ["identity.nationality", "IN"],
    ]);
    expect(placesSaying(held, "cgpa out of 10")).toEqual([{ fieldKey: "education.prior_qualifications", item: 0, part: "gradeScale" }]);
    const scale = closedPart("education.prior_qualifications", "gradeScale");
    expect(scale?.shown("CGPA out of 10"), "the student's own words are not a choice of the set").toBeNull();
    expect(scale?.shown("twenty_point")).toBe("20-point");
    expect(closedPart("education.prior_qualifications", "countryCode")).not.toBeNull();
    expect(closedPart("identity.nationality", undefined)).not.toBeNull();
    expect(closedPart("education.prior_qualifications", "institution"), "free words").toBeNull();
  });

  it("chooses between entries holding the same words only by what the sentence names, and never by a guess", () => {
    const places = placesHolding(confirmed, "International Business");
    expect(places).toHaveLength(2);
    const words = (): readonly string[] => [];
    expect(namedPlace(places, confirmed, "my Master's subject", words)).toEqual({ fieldKey: "education.prior_qualifications", item: 1, part: "subject" });
    expect(namedPlace(places, confirmed, "my doctorate subject", words)).toEqual({ fieldKey: "education.prior_qualifications", item: 0, part: "subject" });
    expect(namedPlace(places, confirmed, "my subject", words), "named equally: asked, not chosen").toBeNull();
  });
});

// P311. Vahid, 2026-10-14: *"a correction to a fixed-choice part (grade scale,
// and any other closed list) must work. Match the words the student is shown
// ("UK honours"), never only the internal token, and when the new value is a
// fixed choice, take it only if it is one of the set."*
describe("a correction to a fixed-choice part: found by the words the student was shown, read into the set (P311)", () => {
  const held = new Map<string, unknown>([
    ["education.prior_qualifications", [
      { level: "Doctorate", institution: "HHE", countryCode: "IR", gradeScale: "uk_honours" },
      { level: "Master's degree", institution: "Islamic Azad University", countryCode: "IR", gradeScale: "uk_honours" },
    ]],
    ["identity.nationality", "IR"],
    ["employment.history", [{ employer: "Acme", basis: "full_time" }]],
    ["finance.funding", { known: true, source: "loan", stage: "applied", details: "Bank Melli" }],
    ["identity.passport", { kind: "none" }],
  ]);
  const scales = [
    { fieldKey: "education.prior_qualifications", item: 0, part: "gradeScale" },
    { fieldKey: "education.prior_qualifications", item: 1, part: "gradeScale" },
  ];

  it("finds a fixed choice by the words the playback shows, or the interview's words for it — and still by the token", () => {
    expect(placesSaying(held, "UK honours")).toEqual(scales);
    expect(placesSaying(held, "uk honours scale")).toEqual(scales);
    expect(placesSaying(held, "uk_honours")).toEqual(scales);
    const iran = [
      { fieldKey: "education.prior_qualifications", item: 0, part: "countryCode" },
      { fieldKey: "education.prior_qualifications", item: 1, part: "countryCode" },
      { fieldKey: "identity.nationality" },
    ];
    expect(placesSaying(held, "Iran")).toEqual(iran);
    expect(placesSaying(held, "Iran (IR)")).toEqual(iran);
    expect(placesSaying(held, "full-time")).toEqual([{ fieldKey: "employment.history", item: 0, part: "basis" }]);
    expect(placesSaying(held, "full time")).toEqual([{ fieldKey: "employment.history", item: 0, part: "basis" }]);
    expect(placesSaying(held, "a loan")).toEqual([{ fieldKey: "finance.funding", part: "source" }]);
    expect(placesSaying(held, "masters degree")).toEqual([{ fieldKey: "education.prior_qualifications", item: 1, part: "level" }]);
    // Free words are found by their own words alone, as since P288.
    expect(placesSaying(held, "Islamic Azad University")).toEqual([{ fieldKey: "education.prior_qualifications", item: 1, part: "institution" }]);
    expect(placesSaying(held, "Bank"), "never by a part of the words").toEqual([]);
    // The finder the row-134 stop uses is unchanged: the stored words only.
    expect(placesHolding(held, "UK honours")).toEqual([]);
  });

  it("reads a new value into the set by the interview's own reader, and nothing outside it", () => {
    const scale = closedPart("education.prior_qualifications", "gradeScale");
    expect(scale?.read("20-point")).toBe("twenty_point");
    expect(scale?.read("UK honours")).toBe("uk_honours");
    expect(scale?.read("twenty_point"), "the token itself, if a student types it").toBe("twenty_point");
    const level = closedPart("education.prior_qualifications", "level");
    expect(level?.read("doctorate")).toBe("Doctorate");
    expect(level?.read("Masters"), "not one of the set").toBeNull();
    expect(level?.shown("Master's degree")).toBe("Master's degree");
    expect(level?.choices).toEqual(["Bachelor's degree", "Master's degree", "Doctorate", "Diploma", "Certificate", "High school diploma"]);
    const country = closedPart("education.prior_qualifications", "countryCode");
    expect(country?.read("Afghanistan")).toBe("AF");
    expect(country?.read("Iran (IR)")).toBe("IR");
    expect(country?.read("Iran (GB)"), "a name and a code that disagree").toBeNull();
    expect(country?.read("Narnia")).toBeNull();
    expect(country?.shown("IR")).toBe("Iran (IR)");
    expect(country?.choices, "too many to list").toBeNull();
    expect(closedPart("identity.nationality", undefined)?.read("Iran")).toBe("IR");
    expect(closedPart("employment.history", "basis")?.read("part-time")).toBe("part_time");
    expect(closedPart("employment.history", "basis")?.choices).toEqual(["full-time", "part-time"]);
    expect(closedPart("immigration.uk_study", "highestLevel")?.read("study abroad or exchange")).toBe("study_abroad_or_exchange");
    // The shown words read back even where the question's words differ.
    expect(closedPart("finance.funding", "source")?.read("a scholarship")).toBe("scholarship");
    expect(closedPart("education.prior_qualifications", "institution")).toBeNull();
  });

  it("refuses a choice in a financial answer, and a part that decides what else an answer holds", () => {
    expect(refusedPart({ fieldKey: "finance.funding", part: "source" })).toBe("financial");
    expect(refusedPart({ fieldKey: "finance.funding", part: "stage" })).toBe("financial");
    expect(refusedPart({ fieldKey: "finance.funding", part: "details" }), "free words, as since P288").toBeNull();
    expect(refusedPart({ fieldKey: "identity.passport", part: "kind" })).toBe("decides_the_shape");
    expect(refusedPart({ fieldKey: "immigration.uk_study", part: "kind" })).toBe("decides_the_shape");
    expect(refusedPart({ fieldKey: "education.prior_qualifications", item: 1, part: "gradeScale" })).toBeNull();
    expect(refusedPart({ fieldKey: "identity.nationality" })).toBeNull();
  });
});

// P311's review: the stored words first, and an open question keeps its answer.
describe("the places a correction may be about, before one is named (P311)", () => {
  const wordsFor = (target: { readonly fieldKey: string; readonly part?: string }): readonly string[] => [
    target.fieldKey === "identity.nationality" ? "Nationality" : target.fieldKey === "contact.address" ? "Home address" : "Answer",
    ...(target.part === undefined ? [] : [target.part === "countryCode" ? "country" : target.part === "city" ? "town" : target.part]),
  ];
  const held = new Map<string, unknown>([
    ["identity.nationality", "IR"],
    ["contact.address", { line1: "1 Orchard Road", city: "Singapore", countryCode: "SG" }],
  ]);

  it("prefers an answer that holds the words over a country the same word names", () => {
    expect(placesToCorrect({ confirmed: held, from: "Singapore", context: "my city", answering: false, wordsFor })).toEqual([
      { fieldKey: "contact.address", part: "city" },
    ]);
    expect(placesToCorrect({ confirmed: held, from: "Iran", context: "my", answering: false, wordsFor })).toEqual([{ fieldKey: "identity.nationality" }]);
  });

  it("while a question is open, takes a place found only by its shown words when the sentence names it", () => {
    // "It's Iraq, not Iran", answering "Which country were you born in?"
    expect(placesToCorrect({ confirmed: held, from: "Iran", context: "", answering: true, wordsFor }), "the answer to the open question").toEqual([]);
    expect(placesToCorrect({ confirmed: held, from: "Iran", context: "my nationality", answering: true, wordsFor })).toEqual([{ fieldKey: "identity.nationality" }]);
    // The stored words are a correction while a question is open, as since P288.
    expect(placesToCorrect({ confirmed: held, from: "IR", context: "", answering: true, wordsFor })).toEqual([{ fieldKey: "identity.nationality" }]);
  });
});
