/**
 * Tests for the confirmation flow — the ONE place ConfirmedValue is minted.
 *
 * Every value that ever reaches a university form field is created here, so
 * these tests are guarding the system's central promise (ADR-0004, ADR-0007).
 */

import { describe, expect, it } from "vitest";

import type { ConfirmedValue, ModelText } from "@askimate/aas-domain";
import { modelText, provenanceOf, proposeValue, unwrapConfirmed } from "@askimate/aas-domain";

import { applyConfirmation, isDeclined, renderForConfirmation } from "./confirmation.js";
import type { StudentConfirmation } from "./confirmation.js";

const RESPONDED_AT = new Date("2026-08-26T12:00:00Z");

function heard(value: string, verbatim: string) {
  return proposeValue({ value, origin: "conversation" as const, verbatim, confidence: 0.93 });
}

function accepted(presented: string): StudentConfirmation<string> {
  return { studentRef: "stu_001", presentedText: presented, respondedAt: RESPONDED_AT, response: { kind: "accepted" } };
}

describe("minting a confirmed value", () => {
  it("produces a confirmed value when the student accepts", () => {
    const result = applyConfirmation({
      key: "identity.given_name",
      proposed: heard("Reza", "My name is Reza"),
      confirmation: accepted("I've recorded your first name as: Reza. Is that right?"),
    });

    expect(isDeclined(result)).toBe(false);
    if (!isDeclined(result)) {
      expect(unwrapConfirmed(result.value)).toBe("Reza");
      expect(provenanceOf(result.value).source).toBe("student_stated");
    }
  });

  it("stores the student's own words alongside the value", () => {
    // So a case can answer "what did the student actually say?" months later.
    const result = applyConfirmation({
      key: "education.highest_qualification" as "identity.given_name",
      proposed: heard("BSc Computer Science", "I did my bachelor's in computer science"),
      confirmation: accepted("..."),
    });

    if (!isDeclined(result)) {
      expect(provenanceOf(result.value).sourceExcerpt).toBe("I did my bachelor's in computer science");
    }
  });

  it("uses the student's value, not the agent's, when corrected", () => {
    // The agent misheard. What gets stored is what the student said it is.
    const result = applyConfirmation({
      key: "identity.given_name",
      proposed: heard("Rezza", "My name is Reza"),
      confirmation: {
        studentRef: "stu_001",
        presentedText: "I've recorded your first name as: Rezza. Is that right?",
        respondedAt: RESPONDED_AT,
        response: { kind: "corrected", correctedValue: "Reza" },
      },
    });

    if (!isDeclined(result)) {
      expect(unwrapConfirmed(result.value)).toBe("Reza");
      // A correction is materially different evidence from an acceptance, and
      // the learning loop cares about the difference.
      expect(provenanceOf(result.value).source).toBe("student_corrected");
    }
  });

  it("produces NOTHING when the student declines", () => {
    // Declining is a legitimate outcome. The correct next step is to ask
    // differently or escalate — never to fall back on the agent's guess.
    const result = applyConfirmation({
      key: "finance.available_funds" as "identity.given_name",
      proposed: heard("My uncle", "I think my uncle might help"),
      confirmation: {
        studentRef: "stu_001",
        presentedText: "...",
        respondedAt: RESPONDED_AT,
        response: { kind: "rejected", reason: "The student is not sure yet." },
      },
    });

    expect(isDeclined(result)).toBe(true);
    if (isDeclined(result)) expect(result.reason).toContain("not sure");
  });

  it("marks a document extraction as document_extracted", () => {
    const result = applyConfirmation({
      key: "identity.passport" as "identity.given_name",
      proposed: proposeValue({
        value: "P1234567",
        origin: "document",
        verbatim: "Passport No. P1234567",
        confidence: 0.99,
        documentId: "doc_passport_1",
      }),
      confirmation: accepted("..."),
    });

    if (!isDeclined(result)) {
      const provenance = provenanceOf(result.value);
      expect(provenance.source).toBe("document_extracted");
      // Document ID only — never contents (brief §8).
      expect(provenance.documentId).toBe("doc_passport_1");
      expect(provenance.sourceExcerpt).toBeUndefined();
    }
  });
});

describe("the wall still holds through the profile package", () => {
  it("does not let model text be confirmed without a proposal", () => {
    const written: ModelText = modelText("Bachelor of Science, First Class");

    // @ts-expect-error — ModelText is not a ProposedValue. The agent composing
    // an answer is not the student having said one.
    applyConfirmation({ key: "identity.given_name", proposed: written, confirmation: accepted("...") });

    expect(true).toBe(true);
  });

  it("does not let a bare value be confirmed", () => {
    // @ts-expect-error — there is no path that skips the proposal step.
    applyConfirmation({ key: "identity.given_name", proposed: "Reza", confirmation: accepted("...") });
    expect(true).toBe(true);
  });

  it("keeps the minted value assignable only where confirmed data is wanted", () => {
    function fillField(_value: ConfirmedValue<string>): void {}
    const result = applyConfirmation({
      key: "identity.given_name",
      proposed: heard("Reza", "My name is Reza"),
      confirmation: accepted("..."),
    });

    if (!isDeclined(result)) {
      expect(() => fillField(result.value)).not.toThrow();
    }
  });
});

describe("what the student is shown", () => {
  it("plays back both what they said and what was understood", () => {
    // The student must be able to see the gap between the two, which is the
    // entire point of extract-then-confirm.
    const rendered = renderForConfirmation(
      "identity.given_name",
      heard("Reza", "My name is Reza Hosseini"),
      "First name",
    );

    expect(rendered).toContain("My name is Reza Hosseini");
    expect(rendered).toContain("Reza");
    expect(rendered).toContain("Is that right?");
  });

  it("renders an EMPTY list as 'none', and a list of entries numbered (ADR-0113, P211)", () => {
    // A student confirming an empty employment history must see the word,
    // not a blank after "as:". And three jobs must read as three.
    const none = renderForConfirmation(
      "employment.history",
      proposeValue({ value: [], origin: "conversation", verbatim: "any: no", confidence: 0.9 }),
      "Employment history",
    );
    expect(none).toContain("as: none");

    const two = renderForConfirmation(
      "residence.history",
      proposeValue({
        value: [
          { countryCode: "IR", from: { year: 2015, month: 9 }, to: { kind: "ended", date: { year: 2022, month: 8 } } },
          { countryCode: "GB", from: { year: 2022, month: 9 }, to: { kind: "current" } },
        ],
        origin: "conversation",
        verbatim: "item0.countryCode: Iran; …",
        confidence: 0.9,
      }),
      "Where you have lived",
    );
    // By the parts' names, and the country as a country (P228, row 92).
    expect(two).toContain("1) Country: Iran (IR)");
    expect(two).toContain("2) Country: United Kingdom (GB)");
  });

  it("renders a date deterministically, not as a model paraphrase", () => {
    const rendered = renderForConfirmation(
      "identity.date_of_birth",
      proposeValue({
        value: new Date("2008-04-02T00:00:00Z"),
        origin: "document",
        verbatim: "02 APR 2008",
        confidence: 0.98,
      }),
      "Date of birth",
    );

    expect(rendered).toContain("2008-04-02");
    expect(rendered).toContain("02 APR 2008");
  });
});

describe("a country is confirmed by its name, not only by its code (P199)", () => {
  // The student typed "Iran". Storing `IR` is right — the reviewed mapping set
  // is keyed by the code — but asking them to confirm `IR` asks them to agree
  // to something they did not say. The preview already solved this tension the
  // other way round (`Nationality: Iran  (sent as "IR")`); the confirmation
  // now reads the same way, from the same reviewed table.
  it("plays back the table's name with the code beside it", () => {
    const playback = renderForConfirmation(
      "identity.nationality",
      heard("IR", "Iran"),
      "Nationality",
    );
    expect(playback).toContain("Iran (IR)");
  });

  it("does the same for the other two country fields", () => {
    for (const key of ["identity.country_of_birth", "residence.country"] as const) {
      expect(renderForConfirmation(key, heard("GB", "United Kingdom"), "Country")).toContain(
        "United Kingdom (GB)",
      );
    }
  });

  it("leaves every other field's value exactly as it was", () => {
    // `IR` is not a country here — it is whatever the student said — and a
    // field that is not country-typed must not be reinterpreted as one.
    expect(renderForConfirmation("identity.sex", heard("IR", "IR"), "Sex")).toContain(": IR");
    expect(renderForConfirmation("identity.sex", heard("IR", "IR"), "Sex")).not.toContain("(IR)");
  });
});

describe("a confirmation shows BOTH what was said and what will be stored (P201, blocker 68)", () => {
  // Vahid's condition on taking the model-proposes option, 2026-09-23:
  //
  //   *"the student's confirmation must show both — what they said and what
  //   will be stored. 'Iranian → Iran (IR)'. A confirmation that shows only
  //   the result is a confirmation of our guess, not of their answer."*
  //
  // The shape already did this — `You said: "…"` above the stored value — and
  // P201 measured that before recording otherwise. What it did NOT have was
  // anything holding it, which is why a condition he stated is now a test
  // rather than a property that happens to be true.
  it("keeps the student's own words beside the country the table resolved", () => {
    const playback = renderForConfirmation(
      "identity.nationality",
      heard("IR", "Iranian"),
      "Nationality",
    );
    expect(playback, "what they said").toContain('"Iranian"');
    expect(playback, "what will be stored").toContain("Iran (IR)");
  });

  it("does the same when a DOCUMENT was read and nobody was there to confirm at the time", () => {
    // The passport says IRANIAN; the model reads Iran; the table gives IR; and
    // the student still meets both before it is theirs. This is the case he
    // called the better test of the design.
    const fromPassport = proposeValue({
      value: "IR",
      origin: "document" as const,
      verbatim: "Nationality  IRANIAN",
      confidence: 0.95,
    });
    const playback = renderForConfirmation("identity.nationality", fromPassport, "Nationality");
    expect(playback).toContain("From your document:");
    expect(playback, "the document's own words").toContain("IRANIAN");
    expect(playback, "what will be stored").toContain("Iran (IR)");
  });

  it("shows the words even when they are a whole sentence rather than a country", () => {
    const playback = renderForConfirmation(
      "residence.country",
      heard("IR", "I'm Iranian, living in Tehran"),
      "Country of residence",
    );
    expect(playback).toContain("I'm Iranian, living in Tehran");
    expect(playback).toContain("Iran (IR)");
  });
});

describe("a value with parts is played back by the parts' names (P228, row 92)", () => {
  // Vahid read `line1: …; postalCode: …; countryCode: IR` on his own page.
  // The names are PART_LABELS', the table the interview asks with.
  it("reads an address as street, town, postcode and country, with the country as a country", () => {
    const address = proposeValue({
      value: { line1: "12 Valiasr Street", city: "Tehran", postalCode: "1966733411", countryCode: "IR" },
      origin: "conversation" as const,
      verbatim: "IR",
      confidence: 1,
    });
    const playback = renderForConfirmation("contact.address", address, "Home address");
    expect(playback).toContain("Street: 12 Valiasr Street, Town: Tehran, Postcode: 1966733411, Country: Iran (IR)");
    expect(playback).not.toMatch(/line1|postalCode|countryCode/);
  });

  it("reads a list of entries by the same names, and a nested object it has no names for as words", () => {
    const history = proposeValue({
      value: [{ countryCode: "IR", from: { year: 2010, month: 9 }, to: { kind: "current" as const } }],
      origin: "conversation" as const,
      verbatim: "yes",
      confidence: 1,
    });
    const playback = renderForConfirmation("residence.history", history, "Where you have lived");
    expect(playback).toContain("1) Country: Iran (IR), When you moved there: Year: 2010, Month: 9, When you left: Kind: current");
    expect(playback).not.toMatch(/countryCode/);
  });
});
