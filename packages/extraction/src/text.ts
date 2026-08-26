/**
 * The text layer of a document.
 *
 * Extraction happens in two steps, and keeping them apart matters:
 *
 *   1. bytes → TEXT      a PDF text layer, or OCR of a photograph
 *   2. text  → VALUES    a model reads fields out of that text
 *
 * Step 2 is what the rest of this package guards. Step 1 is a port, because it
 * is an infrastructure choice (Textract, Tesseract, a PDF library) that should
 * not be able to change how the guard behaves.
 *
 * ── The limitation, stated plainly ────────────────────────────────────────
 *
 * Everything downstream can prove is that a value was read FROM THIS TEXT. It
 * cannot prove the text is a correct reading of the paper. If OCR turns a `0`
 * into an `O`, the grounding check happily confirms the model read the `O`
 * faithfully.
 *
 * That is not a hole in the design; it is the reason the student still confirms
 * every extracted value (brief §2.3). Grounding removes one failure mode — the
 * model inventing a plausible value the document never contained — and does not
 * pretend to remove the other.
 */

import type { DocumentType } from "@askimate/aas-domain";

/** How the text was obtained. Recorded because it bounds how much to trust it. */
export type TextSource =
  /** A PDF's own text layer. Exact, when it exists. */
  | "embedded_text"
  /** Optical character recognition of an image or a scanned page. Lossy. */
  | "ocr";

/** The text of one document. */
export interface DocumentText {
  readonly documentId: string;
  readonly documentType: DocumentType;
  /** One entry per page, in order. */
  readonly pages: readonly string[];
  readonly source: TextSource;
  /**
   * The OCR engine's own confidence, 0–1, when the source is OCR.
   *
   * Advisory only. It is an input to escalation, never a substitute for the
   * student's confirmation — as with every other confidence figure in this
   * system, no value of it skips a step.
   */
  readonly ocrConfidence?: number;
}

/** Turns stored bytes into text. An infrastructure port. */
export interface DocumentTextExtractor {
  textOf(input: {
    readonly documentId: string;
    readonly documentType: DocumentType;
    readonly contents: Uint8Array;
  }): Promise<DocumentText>;
}

/**
 * Reads UTF-8 text documents.
 *
 * Enough for fixtures and for genuinely-textual uploads. Real PDFs and
 * photographs need a real extractor; this one does not pretend otherwise and
 * will simply produce mojibake rather than silently guessing at a format.
 */
export class PlainTextExtractor implements DocumentTextExtractor {
  public textOf(input: {
    readonly documentId: string;
    readonly documentType: DocumentType;
    readonly contents: Uint8Array;
  }): Promise<DocumentText> {
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(input.contents);
    // A form feed is the conventional page separator in extracted text.
    const pages = decoded.split("\f");
    return Promise.resolve({
      documentId: input.documentId,
      documentType: input.documentType,
      pages,
      source: "embedded_text",
    });
  }
}

/** The whole document as one string. Convenient for search; page numbers are lost. */
export function fullText(text: DocumentText): string {
  return text.pages.join("\n");
}
