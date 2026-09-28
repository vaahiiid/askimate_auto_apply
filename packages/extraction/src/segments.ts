/**
 * The cut, held by structure (ADR-0148 §9, stage three).
 *
 * The model — or the stand-in — cuts a document into the entries of a list
 * as LINE RANGES (`ModelClient.segmentDocument`). A span check catches
 * invention and nothing else; a merged pair of jobs and a job split in two
 * are both real text. So the cut is held by different things, none a span:
 *
 *   1. line ranges, never text — an entry can only be a contiguous run of
 *      the document's own lines; a range outside the document is refused;
 *   2. exclusive coverage — no line in two entries, and every line of the
 *      section left out is counted, so a merge cannot hide a line and a
 *      split cannot share one;
 *   3. a date-range count per entry, the MERGE detector — an entry holding
 *      two start–end pairs is two jobs until a person says otherwise;
 *   4. the part reading inside the range, the SPLIT detector — half a job has
 *      no employer or no dates, and is dropped and named (`extract.ts`);
 *   5. the student's confirmation, entry by entry (ADR-0148 §6–§7).
 *
 * And one failure named rather than discovered: a cover letter's lines inside
 * a job's range. Vahid, 2026-09-28: *"A CV sent for a job application often
 * has a letter attached, as mine does … that is a specific failure worth
 * naming rather than discovering as 'the ranges looked odd'."*
 */
import type { ModelClient, NotUnderstood, Segmentation } from "@askimate/aas-llm";
import { isNotUnderstood } from "@askimate/aas-llm";

import type { ListTarget } from "./plans.js";
import { sectionRangeOf } from "./sections.js";
import { fullText } from "./text.js";
import type { DocumentText } from "./text.js";

export interface LineRange {
  readonly from: number;
  readonly to: number;
}

/** What the checks found about a cut. Counts and ranges only: nothing of the document. */
export interface CutChecks {
  /** Ranges the model named that are not contiguous runs inside the document; refused. */
  readonly outsideDocument: readonly LineRange[];
  /** Pairs of entries that share a line; both refused. */
  readonly overlapping: readonly (readonly [number, number])[];
  /** The section found by heading, or `null`. */
  readonly section: LineRange | null;
  /** Lines of the section assigned to no entry. */
  readonly unassignedSectionLines: number;
  /** Lines assigned to an entry that lie outside the section (0 where no section was found). */
  readonly linesOutsideSection: number;
  /** The cover letter found by its opening and its closing, or `null`. */
  readonly letter: LineRange | null;
}

export interface CutEntry extends LineRange {
  readonly index: number;
  readonly lines: readonly string[];
  /** The merge detector: how many date ranges the entry carries. Two is two jobs until a person says otherwise. */
  readonly dateRanges: number;
  /** The named failure: how many of the entry's lines lie inside the cover letter. */
  readonly letterLines: number;
}

export interface Cut {
  readonly fieldKey: string;
  readonly kind: "jobs" | "qualifications";
  /** The model said the document lists none, and why; the entries are then empty. */
  readonly none: string | null;
  readonly entries: readonly CutEntry[];
  readonly checks: CutChecks;
}

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const POINT = `(?:${MONTH}\\s+)?(?:19|20)\\d{2}|(?:0?[1-9]|1[0-2])[/.](?:19|20)\\d{2}`;
const DATE_RANGE = new RegExp(
  `\\b(?:${POINT})\\s*(?:[-–—]|to|until|till)\\s*(?:(?:${POINT})|present|current|now|date|ongoing|today)\\b`,
  "gi",
);

/** How many date ranges the lines carry between them — the merge detector. */
export function dateRangeCount(lines: readonly string[]): number {
  return lines.reduce((count, line) => count + (line.match(DATE_RANGE) ?? []).length, 0);
}

const LETTER_OPENS = /^\s*(dear\b|to whom it may concern|hiring manager|dear sir|dear madam)/i;
const LETTER_CLOSES = /^\s*(yours (sincerely|faithfully|truly)|kind regards|best regards|warm regards|regards|sincerely|best wishes|respectfully)\b/i;

/**
 * The cover letter, by its opening ("Dear …") and its closing ("Yours
 * sincerely" and the like), as a line range; `null` where either is absent.
 * Deterministic and narrow on purpose: a letter it does not recognise is not
 * flagged, and a job it mistakes for a letter would need both an opening and
 * a closing, which a job does not have.
 */
export function letterRangeOf(lines: readonly string[]): LineRange | null {
  const from = lines.findIndex((line) => LETTER_OPENS.test(line));
  if (from < 0) return null;
  const closeAt = lines.slice(from).findIndex((line) => LETTER_CLOSES.test(line));
  if (closeAt < 0) return null;
  // The line after the closing carries the name; take it in when it is short.
  const to = from + closeAt + (lines[from + closeAt + 1] !== undefined && (lines[from + closeAt + 1] ?? "").trim().length <= 60 ? 1 : 0);
  return { from: from + 1, to: to + 1 };
}

function overlapOf(a: LineRange, b: LineRange): number {
  return Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from) + 1);
}

/** The document's lines as the cut names them: one entry per line of the whole text. */
export function linesOf(text: DocumentText): readonly string[] {
  return fullText(text).split(/\r?\n/);
}

/**
 * Cuts the document for one list target through the model, and holds the
 * cut to the checks. A range outside the document or overlapping another is
 * refused, never kept; the rest are the entries, in document order.
 */
export async function cutDocument(target: ListTarget, text: DocumentText, model: ModelClient): Promise<Cut> {
  const lines = linesOf(text);
  const kind: "jobs" | "qualifications" = target.fieldKey === "employment.history" ? "jobs" : "qualifications";
  const section = sectionRangeOf(text, target.headings);
  const first = target.parts[0];
  const request = {
    documentId: text.documentId,
    documentType: text.documentType,
    kind,
    lines,
    ...(section === null ? {} : { section }),
    entryLabels: first === undefined ? [] : first.labels,
  };
  const answer: Segmentation | NotUnderstood = await model.segmentDocument(request);
  const letter = letterRangeOf(lines);
  if (isNotUnderstood(answer)) {
    return {
      fieldKey: target.fieldKey,
      kind,
      none: answer.reason,
      entries: [],
      checks: {
        outsideDocument: [],
        overlapping: [],
        section,
        unassignedSectionLines: section === null ? 0 : lines.slice(section.from - 1, section.to).filter((line) => line.trim().length > 0).length,
        linesOutsideSection: 0,
        letter,
      },
    };
  }

  const outsideDocument = answer.entries.filter((range) => !(Number.isInteger(range.from) && Number.isInteger(range.to) && range.from >= 1 && range.to <= lines.length && range.from <= range.to));
  const inside = answer.entries.filter((range) => !outsideDocument.includes(range)).map((range, index) => ({ ...range, index: index + 1 }));
  const overlapping: (readonly [number, number])[] = [];
  const refused = new Set<number>();
  for (const a of inside) {
    for (const b of inside) {
      if (a.index < b.index && overlapOf(a, b) > 0) {
        overlapping.push([a.index, b.index]);
        refused.add(a.index);
        refused.add(b.index);
      }
    }
  }
  const kept = inside.filter((range) => !refused.has(range.index)).sort((a, b) => a.from - b.from);
  const entries: CutEntry[] = kept.map((range, position) => {
    const own = lines.slice(range.from - 1, range.to);
    return {
      index: position + 1,
      from: range.from,
      to: range.to,
      lines: own,
      dateRanges: dateRangeCount(own),
      letterLines: letter === null ? 0 : overlapOf(range, letter),
    };
  });
  const assigned = new Set<number>();
  for (const entry of entries) for (let number = entry.from; number <= entry.to; number += 1) assigned.add(number);
  const unassignedSectionLines =
    section === null ? 0 : Array.from({ length: section.to - section.from + 1 }, (_, i) => section.from + i).filter((n) => !assigned.has(n) && (lines[n - 1] ?? "").trim().length > 0).length;
  const linesOutsideSection = section === null ? 0 : [...assigned].filter((n) => n < section.from || n > section.to).length;
  return {
    fieldKey: target.fieldKey,
    kind,
    none: null,
    entries,
    checks: { outsideDocument, overlapping, section, unassignedSectionLines, linesOutsideSection, letter },
  };
}
