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
      key: "finance.sponsor_name" as "identity.given_name",
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
      key: "identity.passport_number" as "identity.given_name",
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
