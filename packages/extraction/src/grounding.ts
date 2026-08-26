/**
 * The grounding check.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A MODEL MAY ONLY REPORT WHAT THE DOCUMENT ACTUALLY SAYS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Brief §2.9: the system must never invent qualifications, grades, documents or
 * student information. For conversation that rule is easy to hold — the student
 * is right there and confirms what was understood. For documents it is harder,
 * because a hallucinated passport number looks exactly like a real one, and a
 * student skim-reading a confirmation will very reasonably say "yes, that's my
 * passport number" without checking it digit by digit.
 *
 * So extraction asks the model for TWO things:
 *
 *   verbatim  — the span of the document it read, copied exactly
 *   value     — its interpretation of that span
 *
 * The verbatim span is then checked against the document text. If it is not
 * there, the reading is REJECTED — regardless of how plausible the value is,
 * and regardless of the model's confidence. A model that invents a value must
 * also invent the line it came from, and that invention is deterministically
 * detectable.
 *
 * This is a real guarantee and a narrow one. It proves the value came from the
 * text. It does not prove the text is a faithful reading of the paper (see
 * ./text.ts), and it does not prove the INTERPRETATION of the span is right —
 * a model can quote a real line and misread it. Both of those remain the
 * student's confirmation to catch. This closes the one failure mode the student
 * realistically cannot catch.
 */

import type { DocumentText } from "./text.js";
import { fullText } from "./text.js";

/**
 * The shortest span accepted.
 *
 * A one- or two-character excerpt would match almost any document by accident,
 * which would make the check decorative. Extraction plans therefore ask the
 * model for the whole line containing the value, not the bare value.
 */
export const MIN_EXCERPT_LENGTH = 4;

export type GroundingResult =
  | {
      readonly kind: "grounded";
      /** 1-based page the span was found on. */
      readonly page: number;
    }
  | {
      readonly kind: "not_found";
      readonly reason: string;
    }
  | {
      readonly kind: "excerpt_too_short";
      readonly reason: string;
    };

/**
 * Normalises text for comparison.
 *
 * Deliberately conservative. PDF text layers and OCR output routinely differ
 * from what a model echoes back in ways that carry no meaning — non-breaking
 * spaces, ligatures, curly quotes, en-dashes, a line break where the page had a
 * space — and rejecting a correct reading over a typographic dash would make
 * the check a nuisance rather than a safeguard.
 *
 * What it does NOT do is strip punctuation or digits' separators. Being lenient
 * enough that "1234" matches "1 2 3 4" would start letting invented values
 * through, which is the whole thing being prevented.
 */
export function normaliseForComparison(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Is this span actually in the document? */
export function checkGrounding(text: DocumentText, verbatim: string): GroundingResult {
  const needle = normaliseForComparison(verbatim);

  if (needle.length < MIN_EXCERPT_LENGTH) {
    return {
      kind: "excerpt_too_short",
      reason:
        `The quoted span "${verbatim}" is shorter than ${String(MIN_EXCERPT_LENGTH)} characters, ` +
        `which is too short to establish that it came from the document.`,
    };
  }

  for (const [index, page] of text.pages.entries()) {
    if (normaliseForComparison(page).includes(needle)) {
      return { kind: "grounded", page: index + 1 };
    }
  }

  // A span can legitimately straddle a page break in the joined text; checking
  // the whole document catches that without weakening the per-page answer.
  if (normaliseForComparison(fullText(text)).includes(needle)) {
    return { kind: "grounded", page: 1 };
  }

  return {
    kind: "not_found",
    reason:
      `The model quoted "${verbatim}" as coming from document ${text.documentId}, but that text ` +
      `does not appear in the document. The reading was discarded.`,
  };
}

export function isGrounded(result: GroundingResult): result is { kind: "grounded"; page: number } {
  return result.kind === "grounded";
}
