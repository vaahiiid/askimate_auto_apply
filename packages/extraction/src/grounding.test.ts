import { describe, expect, it } from "vitest";

import { MIN_EXCERPT_LENGTH, checkGrounding, normaliseForComparison } from "./grounding.js";
import { PASSPORT_TEXT } from "./fixtures/documents.js";
import type { DocumentText } from "./text.js";

const passport: DocumentText = {
  documentId: "doc-1",
  documentType: "passport",
  pages: [PASSPORT_TEXT],
  source: "embedded_text",
};

describe("the grounding check", () => {
  it("accepts a span the document actually contains", () => {
    const result = checkGrounding(passport, "Passport No: K12345678");
    expect(result).toEqual({ kind: "grounded", page: 1 });
  });

  it("REJECTS a plausible span the document does not contain", () => {
    // The shape is right, the format is right, the document has a passport
    // number line — and this is not what it says. Exactly the failure a student
    // skim-reading a confirmation would not catch.
    const result = checkGrounding(passport, "Passport No: K98765432");
    expect(result.kind).toBe("not_found");
  });

  it("does not care about typography the text layer introduced", () => {
    // Non-breaking space, and a line break where the page had a space.
    expect(checkGrounding(passport, "Surname: HOSSEINI").kind).toBe("grounded");
    expect(checkGrounding(passport, "Date of birth:\n02 APR 1999").kind).toBe("grounded");
  });

  it("does not care about case", () => {
    expect(checkGrounding(passport, "surname: hosseini").kind).toBe("grounded");
  });

  it("refuses a span too short to prove anything", () => {
    const result = checkGrounding(passport, "F");
    expect(result.kind).toBe("excerpt_too_short");
    expect(MIN_EXCERPT_LENGTH).toBeGreaterThan(1);
  });

  it("does not let a value match across separators", () => {
    // "1 2 3 4 5 6 7 8" must not be treated as "12345678". Normalisation that
    // lenient would start letting invented values through.
    expect(checkGrounding(passport, "K 1 2 3 4 5 6 7 8").kind).toBe("not_found");
  });

  it("finds a span on the page it is on, in a multi-page document", () => {
    const twoPages: DocumentText = {
      documentId: "doc-2",
      documentType: "academic_transcript",
      pages: ["cover page", PASSPORT_TEXT],
      source: "embedded_text",
    };
    expect(checkGrounding(twoPages, "Nationality: IRANIAN")).toEqual({ kind: "grounded", page: 2 });
  });

  it("finds a span that straddles a page break", () => {
    const split: DocumentText = {
      documentId: "doc-3",
      documentType: "passport",
      pages: ["Date of expiry:", "13 JUN 2031"],
      source: "embedded_text",
    };
    expect(checkGrounding(split, "Date of expiry: 13 JUN 2031").kind).toBe("grounded");
  });
});

describe("normalisation", () => {
  it("keeps punctuation, which is load-bearing in identifiers", () => {
    expect(normaliseForComparison("A-1/2")).toBe("a-1/2");
  });

  it("unifies dashes and quotes without unifying anything else", () => {
    expect(normaliseForComparison("2026–2027")).toBe("2026-2027");
    expect(normaliseForComparison("“QA”")).toBe('"qa"');
  });
});
