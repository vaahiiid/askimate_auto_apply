/**
 * Bytes → text for the two shapes a CV arrives in (ADR-0148 §1, stage two).
 *
 * Two infrastructure ports behind the one `DocumentTextExtractor` interface
 * `text.ts` declares: a PDF's own text layer through `pdf-parse`, and a Word
 * file's paragraphs through `mammoth`. Neither performs OCR: a scanned CV
 * with no text layer yields an empty page, and the reading downstream finds
 * nothing rather than guessing — which the report says.
 *
 * What these prove and do not: that text came out of THESE bytes. Whether
 * the text is what the person wrote is the student's to confirm, as with
 * every extracted value (`text.ts`, "the limitation, stated plainly").
 */
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

import type { DocumentType } from "@askimate/aas-domain";

import type { DocumentText, DocumentTextExtractor } from "./text.js";

export const PDF_CONTENT_TYPE = "application/pdf";
export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A PDF's embedded text, one entry per page. */
export class PdfTextExtractor implements DocumentTextExtractor {
  public async textOf(input: {
    readonly documentId: string;
    readonly documentType: DocumentType;
    readonly contents: Uint8Array;
  }): Promise<DocumentText> {
    // A COPY: pdf.js transfers the buffer it is handed to its worker, which
    // detaches the caller's bytes. Reading a document must not destroy it —
    // the same rule as a cleanup that runs on the failure path — and the
    // vault's bytes are read again for every target and every retry.
    const parser = new PDFParse({ data: new Uint8Array(input.contents) });
    try {
      const result = await parser.getText();
      return {
        documentId: input.documentId,
        documentType: input.documentType,
        pages: result.pages.map((page) => page.text),
        source: "embedded_text",
      };
    } finally {
      await parser.destroy();
    }
  }
}

/** A Word file's paragraphs, as one page: a .docx has no pages until it is laid out. */
export class DocxTextExtractor implements DocumentTextExtractor {
  public async textOf(input: {
    readonly documentId: string;
    readonly documentType: DocumentType;
    readonly contents: Uint8Array;
  }): Promise<DocumentText> {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(input.contents) });
    // mammoth ends every paragraph with a blank line; one line per paragraph
    // is what the readers expect, and what a PDF's text layer gives.
    const text = result.value.replace(/\n{2,}/g, "\n").trim();
    return {
      documentId: input.documentId,
      documentType: input.documentType,
      pages: [text],
      source: "embedded_text",
    };
  }
}

/** The extractor for a stored document's content type, or `undefined` for a type nothing here reads. */
export function textExtractorFor(contentType: string): DocumentTextExtractor | undefined {
  const bare = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (bare === PDF_CONTENT_TYPE) return new PdfTextExtractor();
  if (bare === DOCX_CONTENT_TYPE) return new DocxTextExtractor();
  return undefined;
}
