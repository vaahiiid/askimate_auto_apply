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

/**
 * The lines under the first heading that is one of `headings`, up to the next
 * heading of any kind. Empty when no such heading is on the document.
 */
export function sectionOf(text: DocumentText, headings: readonly string[]): readonly string[] {
  const wanted = new Set(headings.map((heading) => heading.toLowerCase()));
  const lines = fullText(text).split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const heading = headingOf(line);
    return heading !== null && wanted.has(heading);
  });
  if (start < 0) return [];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (headingOf(line) !== null) break;
    if (line.trim().length > 0) body.push(line);
  }
  return body;
}

/**
 * The section under the first heading that is one of `headings`, as a
 * one-based inclusive line range over the WHOLE document's lines (the numbers
 * a cut names), or `null` for none. Blank lines inside the section count;
 * the range is where the section is, not what it holds.
 */
export function sectionRangeOf(text: DocumentText, headings: readonly string[]): { readonly from: number; readonly to: number } | null {
  const wanted = new Set(headings.map((heading) => heading.toLowerCase()));
  const lines = fullText(text).split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const heading = headingOf(line);
    return heading !== null && wanted.has(heading);
  });
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (headingOf(lines[index] ?? "") !== null) {
      end = index;
      break;
    }
  }
  return end <= start + 1 ? null : { from: start + 2, to: end };
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
