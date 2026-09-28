/**
 * The sections of a CV, and the entries in one, found by code (stage two).
 *
 * A CV lists things — jobs, qualifications — under headings. The model
 * contract this package has (`extractFromDocument`) reads ONE value out of a
 * text by its label, so the text has to be cut into entries first, and this
 * is the cut: a heading line opens a section, the next heading line closes
 * it, and inside a section an entry begins at each line that carries the
 * entry's first label.
 *
 * Deterministic and said so. It reads the shapes the fixtures have and the
 * shape a text layer or a Word file yields (one line per paragraph, blank
 * lines not relied on: a PDF's text layer drops them). A CV laid out any
 * other way — tables, columns, prose with no labels — is not cut by this,
 * and the reading that follows finds nothing in it. That is the limit a
 * model's own segmentation would have to lift, and nothing here claims it.
 */
import { fullText } from "./text.js";
import type { DocumentText } from "./text.js";

/** The words a CV puts over its sections, lower-cased. A line that is one of these, and nothing else, is a heading. */
const KNOWN_HEADINGS: readonly string[] = [
  "employment",
  "employment history",
  "work experience",
  "work history",
  "experience",
  "professional experience",
  "career",
  "career history",
  "education",
  "education and qualifications",
  "qualifications",
  "academic history",
  "academic qualifications",
  "academic background",
  "skills",
  "languages",
  "references",
  "referees",
  "summary",
  "profile",
  "personal profile",
  "personal details",
  "contact",
  "interests",
  "projects",
  "publications",
  "awards",
  "certifications",
  "training",
  "volunteering",
];

function headingOf(line: string): string | null {
  const bare = line
    .trim()
    .replace(/[:\-–—]+$/, "")
    .trim()
    .toLowerCase();
  if (bare.length === 0 || bare.length > 40 || bare.includes(":")) return null;
  return KNOWN_HEADINGS.includes(bare) ? bare : null;
}

const LETTER_OPENS = /^\s*(dear\b|to whom it may concern|hiring manager|dear sir|dear madam)/i;
const LETTER_CLOSES = /^\s*(yours (sincerely|faithfully|truly)|kind regards|best regards|warm regards|regards|sincerely|best wishes|respectfully)\b/i;

/**
 * The cover letter, by its opening ("Dear …") and its closing ("Yours
 * sincerely" and the like), as a one-based inclusive line range, or `null`
 * when either is missing. BOTH are required: a line that merely begins
 * "Dear" is not a letter, and nothing below treats it as one. An opening the
 * finder does not know ("To the admissions team,") is not found, and the
 * report says "none found" rather than a wrong range — a wrong label is
 * worse than none.
 */
export function letterRangeOf(lines: readonly string[]): { readonly from: number; readonly to: number } | null {
  const from = lines.findIndex((line) => LETTER_OPENS.test(line));
  if (from < 0) return null;
  const closeAt = lines.slice(from).findIndex((line) => LETTER_CLOSES.test(line));
  if (closeAt < 0) return null;
  // The line after the closing carries the name; take it in when it is short.
  const to = from + closeAt + (lines[from + closeAt + 1] !== undefined && (lines[from + closeAt + 1] ?? "").trim().length <= 60 ? 1 : 0);
  return { from: from + 1, to: to + 1 };
}

/** What closed a section: the next heading, the cover letter's opening, or the end of the document. */
export type SectionEnd = "heading" | "letter" | "document_end";

export interface SectionBounds {
  /** One-based, inclusive, over the whole document's lines. */
  readonly from: number;
  readonly to: number;
  readonly endedAt: SectionEnd;
}

/**
 * Where the section under the first heading that is one of `headings` is,
 * or `null` for none.
 *
 * A heading opens a section and the next heading closes it. P245, from
 * Vahid's live run: a cover letter that FOLLOWS the last section has no
 * heading, so the section ran over the letter — 19 of 22 "education" lines
 * were letter — and the cut had to work around it. So a section also ends
 * at the letter's opening, and only then, under the guards he asked for
 * (*"Make sure clipping at the letter cannot clip a real section short"*):
 *
 *   • the letter must be found by BOTH its opening and its closing; an
 *     opening alone clips nothing;
 *   • the opening must lie INSIDE the section it would end — a letter before
 *     the sections, or after a later heading, touches nothing;
 *   • a section that would be left with no line is reported as none, the
 *     same as a heading with nothing under it, never as a clipped stub.
 *
 * A CV with no letter, or a letter the finder does not know, keeps its last
 * section to the end of the document, and `endedAt` says so.
 */
export function sectionBoundsOf(text: DocumentText, headings: readonly string[]): SectionBounds | null {
  const wanted = new Set(headings.map((heading) => heading.toLowerCase()));
  const lines = fullText(text).split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const heading = headingOf(line);
    return heading !== null && wanted.has(heading);
  });
  if (start < 0) return null;
  let end = lines.length;
  let endedAt: SectionEnd = "document_end";
  for (let index = start + 1; index < lines.length; index += 1) {
    if (headingOf(lines[index] ?? "") !== null) {
      end = index;
      endedAt = "heading";
      break;
    }
  }
  const letter = letterRangeOf(lines);
  // `end` is exclusive and zero-based; the letter's `from` is one-based, so
  // the letter opens inside the section when start + 1 < from - 1 < end.
  if (letter !== null && letter.from - 1 > start + 1 && letter.from - 1 < end) {
    end = letter.from - 1;
    endedAt = "letter";
  }
  return end <= start + 1 ? null : { from: start + 2, to: end, endedAt };
}

/**
 * The non-blank lines of the section under the first heading that is one of
 * `headings`. Empty when no such heading is on the document.
 */
export function sectionOf(text: DocumentText, headings: readonly string[]): readonly string[] {
  const bounds = sectionBoundsOf(text, headings);
  if (bounds === null) return [];
  return fullText(text)
    .split(/\r?\n/)
    .slice(bounds.from - 1, bounds.to)
    .filter((line) => line.trim().length > 0);
}

/**
 * The section as a one-based inclusive line range over the WHOLE document's
 * lines (the numbers a cut names), or `null` for none. Blank lines inside the
 * section count; the range is where the section is, not what it holds.
 */
export function sectionRangeOf(text: DocumentText, headings: readonly string[]): { readonly from: number; readonly to: number } | null {
  const bounds = sectionBoundsOf(text, headings);
  return bounds === null ? null : { from: bounds.from, to: bounds.to };
}

/** The entries of a section, each beginning at a line labelled with one of the entry's first labels. */
export function entriesOf(section: readonly string[], firstLabels: readonly string[]): readonly (readonly string[])[] {
  const opens = (line: string): boolean =>
    firstLabels.some((label) => new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:/]`, "i").test(line));
  const entries: string[][] = [];
  for (const line of section) {
    if (opens(line) || entries.length === 0) {
      if (opens(line)) entries.push([line]);
      // A line before the first label belongs to no entry.
      continue;
    }
    entries[entries.length - 1]?.push(line);
  }
  return entries;
}
