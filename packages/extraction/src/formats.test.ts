import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DOCX_CONTENT_TYPE, DocxTextExtractor, PDF_CONTENT_TYPE, PdfTextExtractor, textExtractorFor } from "./formats.js";
import { fullText } from "./text.js";

// Synthetic CVs, generated for this repository (a fixture name the tests
// already use; nobody's real details). The PDF is a one-page text layer; the
// Word file is three parts in a zip. Neither was written by a word processor,
// which is the point: they are the shapes, not somebody's document.
const PDF = new Uint8Array(readFileSync(new URL("./fixtures/cv.pdf", import.meta.url)));
const DOCX = new Uint8Array(readFileSync(new URL("./fixtures/cv.docx", import.meta.url)));

describe("a CV's text, out of the bytes it arrived as (ADR-0148 §1, stage two)", () => {
  it("reads a PDF's text layer, one entry per page, through a real PDF library", async () => {
    const text = await new PdfTextExtractor().textOf({ documentId: "doc_cv_pdf", documentType: "cv", contents: PDF });
    expect(text.source).toBe("embedded_text");
    expect(text.pages).toHaveLength(1);
    const lines = fullText(text).split("\n");
    expect(lines).toContain("Position: Data analyst");
    expect(lines).toContain("Employer: Nikan Software");
    expect(lines).toContain("Institution: University of Tehran");
  });

  it("reads a Word file's paragraphs, one line each, through a real .docx library", async () => {
    const text = await new DocxTextExtractor().textOf({ documentId: "doc_cv_docx", documentType: "cv", contents: DOCX });
    expect(text.source).toBe("embedded_text");
    const lines = fullText(text).split("\n");
    expect(lines).toContain("Position: Junior developer");
    expect(lines).toContain("Grade scale: 20-point");
    expect(lines.filter((line) => line.trim() === ""), "no blank lines between paragraphs").toHaveLength(0);
  });

  it("leaves the caller's bytes intact and readable again — reading a document does not destroy it", async () => {
    // pdf.js transfers the buffer it is handed to its worker, which detaches
    // it; a second read of the same bytes then fails with a DataCloneError.
    // Found in P239 when two tests read one fixture. The extractor copies.
    const bytes = new Uint8Array(PDF);
    const extractor = new PdfTextExtractor();
    const first = await extractor.textOf({ documentId: "doc_twice", documentType: "cv", contents: bytes });
    expect(bytes.byteLength, "not detached").toBe(PDF.byteLength);
    const second = await extractor.textOf({ documentId: "doc_twice", documentType: "cv", contents: bytes });
    expect(fullText(second)).toBe(fullText(first));
  });

  it("chooses the extractor by content type, and none for a type nothing reads", () => {
    expect(textExtractorFor(PDF_CONTENT_TYPE)).toBeInstanceOf(PdfTextExtractor);
    expect(textExtractorFor(`${DOCX_CONTENT_TYPE}; charset=binary`)).toBeInstanceOf(DocxTextExtractor);
    expect(textExtractorFor("image/jpeg")).toBeUndefined();
    expect(textExtractorFor("text/plain")).toBeUndefined();
  });

  it("gives an empty page, not an error, for a PDF with no text layer — a scan reads as nothing to find", async () => {
    // A PDF with one empty content stream: valid, and silent.
    const empty = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n",
    );
    const text = await new PdfTextExtractor().textOf({ documentId: "doc_scan", documentType: "cv", contents: empty });
    expect(text.pages.length).toBeGreaterThanOrEqual(1);
    expect(fullText(text).trim()).toBe("");
  });
});
