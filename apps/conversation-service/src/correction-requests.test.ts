import { describe, expect, it } from "vitest";

import { namedPlace, placesHolding, readCorrectionRequest } from "./correction-requests.js";

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

  it("chooses between entries holding the same words only by what the sentence names, and never by a guess", () => {
    const places = placesHolding(confirmed, "International Business");
    expect(places).toHaveLength(2);
    const words = (): readonly string[] => [];
    expect(namedPlace(places, confirmed, "my Master's subject", words)).toEqual({ fieldKey: "education.prior_qualifications", item: 1, part: "subject" });
    expect(namedPlace(places, confirmed, "my doctorate subject", words)).toEqual({ fieldKey: "education.prior_qualifications", item: 0, part: "subject" });
    expect(namedPlace(places, confirmed, "my subject", words), "named equally: asked, not chosen").toBeNull();
  });
});
