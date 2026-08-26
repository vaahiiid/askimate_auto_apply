/**
 * Tests for the confirmed/model-text separation (ADR-0004, brief §3.1).
 *
 * The most important assertions in this file are the `@ts-expect-error` ones.
 * They are compile-time tests: if someone ever adds a conversion path from
 * `ModelText` to `ConfirmedValue`, the `@ts-expect-error` stops being an error,
 * TypeScript reports "unused @ts-expect-error directive", and the build fails.
 *
 * That is the guarantee working. A runtime test cannot check "this code does
 * not compile" — only the compiler can, so we make the compiler part of the
 * test suite.
 */

import { describe, expect, it } from "vitest";

import type {
  ConfirmationProvenance,
  ConfirmedValue,
  FieldResolution,
  ModelText,
  ProposedValue,
} from "./values.js";
import {
  fieldUnavailable,
  isConfirmed,
  isFieldUnavailable,
  modelText,
  proposeValue,
  provenanceOf,
  unwrapConfirmed,
  unwrapProposed,
} from "./values.js";

/**
 * Stands in for `@askimate/aas-profile`, which does not exist until Phase 2.
 *
 * The double assertion here is exactly what the real profile package will do —
 * and it is the ONE place in the system that does it. It is legitimate there
 * because it happens only against a stored confirmation record. Reproducing it
 * in a test is fine; reproducing it in application code would defeat the
 * control.
 */
function mintConfirmed<T>(value: T, provenance: ConfirmationProvenance): ConfirmedValue<T> {
  return { value, provenance } as unknown as ConfirmedValue<T>;
}

const PROVENANCE: ConfirmationProvenance = {
  source: "student_entered",
  confirmedAt: new Date("2026-08-01T10:00:00Z"),
};

describe("the wall between model output and form fields", () => {
  it("does not allow ModelText to be used as a ConfirmedValue", () => {
    const generated: ModelText = modelText("Bachelor of Science, First Class");

    // @ts-expect-error — ModelText must never satisfy ConfirmedValue<string>.
    // This is THE guarantee. If this line ever compiles, the system has lost
    // the property that the AI cannot source a form field value.
    const smuggled: ConfirmedValue<string> = generated;

    // Referenced so the binding is not merely unused.
    expect(typeof smuggled).toBe("string");
  });

  it("does not allow a bare string to be used as a ConfirmedValue", () => {
    // @ts-expect-error — plausible-looking data is still not confirmed data.
    const smuggled: ConfirmedValue<string> = "2:1 Honours";
    expect(typeof smuggled).toBe("string");
  });

  it("does not allow a ConfirmedValue to be used where ModelText is expected", () => {
    const confirmed = mintConfirmed("Leeds", PROVENANCE);
    // @ts-expect-error — the brands are mutually exclusive in both directions.
    const asModel: ModelText = confirmed;
    expect(asModel).toBeDefined();
  });

  it("reads the underlying value only through unwrapConfirmed", () => {
    const confirmed = mintConfirmed("MSc Data Science", PROVENANCE);
    expect(unwrapConfirmed(confirmed)).toBe("MSc Data Science");
  });

  it("carries provenance through to the reader", () => {
    const confirmed = mintConfirmed(42, {
      source: "document_extracted",
      confirmedAt: new Date("2026-08-02T09:30:00Z"),
      documentId: "doc_abc123",
    });

    const provenance = provenanceOf(confirmed);
    expect(provenance.source).toBe("document_extracted");
    // Brief §8: audit references document IDs, never contents.
    expect(provenance.documentId).toBe("doc_abc123");
  });

  it("preserves non-string value types", () => {
    const dob = mintConfirmed(new Date("1999-04-02T00:00:00Z"), PROVENANCE);
    expect(unwrapConfirmed(dob).getUTCFullYear()).toBe(1999);
  });
});

describe("the wall holds at a form-fill boundary", () => {
  /**
   * Stands in for the Phase 5 adapter signature:
   *
   *   fillSection(case, section, values: ReadonlyMap<FieldRef, ConfirmedValue<unknown>>)
   *
   * Every `@ts-expect-error` below is a route an engineer under deadline
   * pressure might actually try. If ANY of them ever compiles, that directive
   * becomes unused, TypeScript reports it, and the build fails — so this test
   * cannot rot silently.
   */
  function fillField(_field: string, _value: ConfirmedValue<string>): void {
    /* no-op: the signature is the test */
  }

  it("blocks every route from model output into a form field", () => {
    const aiGuess: ModelText = modelText("2:1 Honours, University of Leeds");

    // @ts-expect-error — 1. passing model output directly
    fillField("qualification", aiGuess);

    // @ts-expect-error — 2. coercing with String()
    fillField("qualification", String(aiGuess));

    // @ts-expect-error — 3. laundering through a template literal
    fillField("qualification", `${aiGuess}`);

    // @ts-expect-error — 4. laundering through a string method
    fillField("qualification", aiGuess.trim());

    // @ts-expect-error — 5. hand-building the ConfirmedValue shape
    fillField("qualification", { value: aiGuess, provenance: PROVENANCE });

    expect(true).toBe(true);
  });

  it("accepts a properly minted confirmed value", () => {
    // The positive case, so the test above is proving a real restriction
    // rather than a signature nothing could ever satisfy.
    expect(() => fillField("institution", mintConfirmed("Leeds", PROVENANCE))).not.toThrow();
  });
});

describe("agent-interpreted answers cannot reach a form field either (ADR-0007)", () => {
  function fillField(_field: string, _value: ConfirmedValue<string>): void {
    /* no-op: the signature is the test */
  }

  /**
   * The realistic scenario under agent-led intake. The student says something
   * in their own words; the agent turns it into a structured field. That
   * mapping is a model inference and must be confirmed before it is stored.
   */
  const heard: ProposedValue<string> = proposeValue({
    value: "BSc Computer Science",
    origin: "conversation",
    verbatim: "I finished my bachelor's in computer science at Tehran Polytechnic in 2023",
    confidence: 0.93,
  });

  it("blocks an unconfirmed interpretation from being submitted", () => {
    // @ts-expect-error — what the agent *understood* is not what the student
    // *confirmed*. High confidence does not change that.
    fillField("qualification", heard);

    // @ts-expect-error — nor does reaching inside for the value.
    fillField("qualification", unwrapProposed(heard).value);

    expect(true).toBe(true);
  });

  it("blocks a 100%-confidence interpretation just the same", () => {
    // There is no threshold above which the student's confirmation is skipped.
    const certain = proposeValue({
      value: "BSc Computer Science",
      origin: "conversation",
      verbatim: "I have a BSc in Computer Science",
      confidence: 1,
    });

    // @ts-expect-error — confidence is a layer-one escalation signal, never a
    // promotion mechanism.
    fillField("qualification", certain);
    expect(true).toBe(true);
  });

  it("blocks a document extraction that has not been confirmed", () => {
    const extracted = proposeValue({
      value: "P1234567",
      origin: "document",
      verbatim: "Passport No. P1234567",
      confidence: 0.99,
      documentId: "doc_passport_1",
    });

    // @ts-expect-error — same rule for documents as for conversation.
    fillField("passport_number", extracted);
    expect(true).toBe(true);
  });

  it("keeps the three kinds of value mutually incompatible", () => {
    const written: ModelText = modelText("something the model composed");

    // @ts-expect-error — model-written text is not an interpretation of a human.
    const asProposed: ProposedValue<string> = written;
    expect(asProposed).toBeDefined();

    // @ts-expect-error — and an interpretation is not confirmed data.
    const asConfirmed: ConfirmedValue<string> = heard;
    expect(asConfirmed).toBeDefined();
  });

  it("lets the agent read the interpretation back to the student", () => {
    // Reading is exactly what the confirmation step needs: show the student
    // what was understood, alongside what they actually said.
    const read = unwrapProposed(heard);
    expect(read.value).toBe("BSc Computer Science");
    expect(read.origin).toBe("conversation");
    expect(read.verbatim).toContain("Tehran Polytechnic");
    expect(read.confidence).toBeCloseTo(0.93);
  });

  it("rejects a confidence outside 0-1", () => {
    const bad = { value: "x", origin: "conversation", verbatim: "x" } as const;
    expect(() => proposeValue({ ...bad, confidence: 1.5 })).toThrow(RangeError);
    expect(() => proposeValue({ ...bad, confidence: -0.1 })).toThrow(RangeError);
    expect(() => proposeValue({ ...bad, confidence: Number.NaN })).toThrow(RangeError);
  });

  it("accepts a value confirmed from conversation", () => {
    // The positive case: once the student confirms the play-back, it is
    // ordinary confirmed data and submits like any other.
    const confirmed = mintConfirmed("BSc Computer Science", {
      source: "student_stated",
      confirmedAt: new Date("2026-08-26T12:00:00Z"),
      sourceExcerpt: "I finished my bachelor's in computer science",
    });

    expect(() => fillField("qualification", confirmed)).not.toThrow();
    expect(provenanceOf(confirmed).source).toBe("student_stated");
  });
});

describe("the stop-and-ask branch", () => {
  it("narrows an unavailable field", () => {
    const resolution: FieldResolution<string> = fieldUnavailable("highest_qualification", "not_collected");

    expect(isFieldUnavailable(resolution)).toBe(true);
    expect(isConfirmed(resolution)).toBe(false);

    if (isFieldUnavailable(resolution)) {
      expect(resolution.field).toBe("highest_qualification");
      expect(resolution.reason).toBe("not_collected");
    }
  });

  it("narrows a confirmed field", () => {
    const resolution: FieldResolution<string> = mintConfirmed("Leeds", PROVENANCE);

    expect(isConfirmed(resolution)).toBe(true);
    expect(isFieldUnavailable(resolution)).toBe(false);

    if (isConfirmed(resolution)) {
      expect(unwrapConfirmed(resolution)).toBe("Leeds");
    }
  });

  it("carries a model-written explanation without that making it submittable", () => {
    // A model may explain the gap to a human. That explanation is ModelText and
    // stays ModelText — it is shown to a person, never sent to a university.
    const resolution = fieldUnavailable(
      "proof_of_funds",
      "source_expired",
      modelText("Your bank statement is from 12 June and is now outside the 31-day window."),
    );

    expect(resolution.explanation).toContain("31-day window");

    // @ts-expect-error — the explanation is still not a confirmed value.
    const smuggled: ConfirmedValue<string> = resolution.explanation;
    expect(smuggled).toBeDefined();
  });

  it("distinguishes every unavailability reason", () => {
    // Each reason routes to a different task kind, so they must stay distinct.
    const reasons = [
      "not_collected",
      "awaiting_confirmation",
      "source_expired",
      "conflicting_sources",
    ] as const;

    const resolutions = reasons.map((reason) => fieldUnavailable("field", reason));
    expect(new Set(resolutions.map((r) => r.reason)).size).toBe(4);
  });

  it("omits the explanation property entirely when none is given", () => {
    // Under exactOptionalPropertyTypes, "absent" and "present but undefined"
    // are different things. Absent is what we mean.
    const resolution = fieldUnavailable("field", "not_collected");
    expect("explanation" in resolution).toBe(false);
  });
});
