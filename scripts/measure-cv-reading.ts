/**
 * Does the stage-two CV reading work on a REAL document? A measurement (P240).
 *
 *   pnpm run measure-cv -- --live ~/cv-measure/my-cv.pdf ~/cv-measure/other.docx
 *   pnpm run measure-cv -- ~/cv-measure/my-cv.pdf              (the deterministic stand-in, for contrast)
 *   pnpm run measure-cv -- --live --out ~/cv-measure/report.json <files…>
 *
 * Vahid, 2026-09-27: *"Run the existing stage-two pipeline against them,
 * through the real model, and tell me what comes out: how many entries were
 * found, how many parts per entry, what was dropped and why, and where the
 * grounding rejected something. Not to fix anything. To find out whether the
 * thing stage three depends on works at all on real documents."*
 *
 * ── What this carries, and what it never does ─────────────────────────────
 *
 * The documents are real people's. The report carries STRUCTURE and nothing
 * else: counts, part names, statuses, reasons in the reader's own words, and
 * the LENGTH of a quoted span — never a value, never a span, never a line of
 * the document. `--out` writes the same structure as JSON. Nothing here
 * writes the document's text anywhere, and nothing is kept between runs.
 *
 * `--live` sends each entry's lines to Bedrock, once per part, under the
 * account in the environment (`AAS_BEDROCK_REGION` and the four
 * `AAS_BEDROCK_MODEL_*` variables; `pnpm run verify-bedrock` lists what the
 * account can use). That is his spend and his act: this script is run by
 * him, on his machine, on documents he chose.
 *
 * A test driver, not a product surface (ADR-0015).
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import type { ModelClient } from "@askimate/aas-llm";
import type { DocumentText, ListReading } from "@askimate/aas-extraction";
import { cutDocument, fullText, planFor, readListEntries, sectionOf, textExtractorFor, DOCX_CONTENT_TYPE, PDF_CONTENT_TYPE } from "@askimate/aas-extraction";

import { demoModel, destinationLine, usageLine } from "./model-for-demo.js";

/** One document, measured. Structure only. */
export interface DocumentMeasurement {
  readonly name: string;
  readonly contentType: string;
  readonly pages: number;
  readonly lines: number;
  readonly characters: number;
  readonly lists: readonly ListMeasurement[];
}

export interface ListMeasurement {
  readonly fieldKey: string;
  readonly headings: readonly string[];
  readonly sectionFound: boolean;
  readonly sectionLines: number;
  /** The section as a line range, for him to check against his own document. */
  readonly section: { readonly from: number; readonly to: number } | null;
  /** What closed the section: the next heading, the cover letter's opening (P245), or the document's end. */
  readonly sectionEndedAt: "heading" | "letter" | "document_end" | null;
  /** The model said the document lists none, in its words. */
  readonly none: string | null;
  /** The cut, held to its checks (stage three). Line numbers only. */
  readonly cut: {
    readonly outsideDocument: number;
    readonly overlapping: number;
    readonly unassignedSectionLines: number;
    readonly linesOutsideSection: number;
    /** The cover letter as a line range, or null for none found. */
    readonly letter: { readonly from: number; readonly to: number } | null;
  };
  readonly entriesFound: number;
  /** Entries that stand with every document part read: nothing for the interview to ask but the student's own parts. */
  readonly entriesComplete: number;
  readonly entries: readonly {
    readonly index: number;
    readonly from: number;
    readonly to: number;
    readonly lines: number;
    /** The merge detector: two is two jobs cut as one. */
    readonly dateRanges: number;
    /** The named failure: cover-letter lines inside this entry. */
    readonly letterLines: number;
    /** Every document part read; the entry stands. */
    readonly complete: boolean;
    readonly read: readonly string[];
    /** Document parts the model found nothing for: the interview asks (ADR-0149). */
    readonly missing: readonly string[];
    /** Document parts read as real text the plan's parser refused — "BSc" for a level: asked, never guessed. */
    readonly unparsed: readonly string[];
    /** Document parts read IN PART — a year without its month: the components it gave and the ones the interview asks (P248). Never a value. */
    readonly partial: readonly { readonly partKey: string; readonly have: readonly string[]; readonly lacking: readonly string[] }[];
    /** The student's to state: never asked of the document (ADR-0149). */
    readonly student: readonly string[];
    readonly ungrounded: readonly { readonly partKey: string; readonly spanLength: number; readonly reason: string }[];
    readonly skipped: readonly string[];
    /** What the interview would ask for this entry, in the plan's order: missing, unparsed and the student's own. */
    readonly wouldAsk: readonly string[];
    readonly droppedBecause: string | null;
  }[];
}

export function contentTypeOf(path: string): string | undefined {
  const extension = extname(path).toLowerCase();
  if (extension === ".pdf") return PDF_CONTENT_TYPE;
  if (extension === ".docx") return DOCX_CONTENT_TYPE;
  return undefined;
}

/** Reads one document through the stage-two pipeline and measures what came out. */
export async function measureDocument(
  input: { readonly name: string; readonly contentType: string; readonly contents: Uint8Array },
  model: ModelClient,
): Promise<DocumentMeasurement> {
  const extractor = textExtractorFor(input.contentType);
  if (extractor === undefined) throw new Error(`${input.name}: nothing reads ${input.contentType}; a PDF with a text layer or a .docx`);
  const text: DocumentText = await extractor.textOf({ documentId: `measure_${input.name}`, documentType: "cv", contents: input.contents });
  return measureText(input.name, input.contentType, text, model);
}

/** The measurement of a document already read into text. */
export async function measureText(name: string, contentType: string, text: DocumentText, model: ModelClient): Promise<DocumentMeasurement> {
  const whole = fullText(text);
  const plan = planFor("cv");
  if (plan === undefined) throw new Error("no plan for a CV");
  const lists: ListMeasurement[] = [];
  for (const target of plan.targets) {
    if (target.kind !== "list") continue;
    const section = sectionOf(text, target.headings);
    const cut = await cutDocument(target, text, model);
    const reading: ListReading = await readListEntries(target, text, model, cut);
    lists.push({
      fieldKey: target.fieldKey,
      headings: target.headings,
      sectionFound: section.length > 0,
      sectionLines: section.length,
      section: cut.checks.section,
      sectionEndedAt: cut.checks.sectionEndedAt,
      none: cut.none,
      cut: {
        outsideDocument: cut.checks.outsideDocument.length,
        overlapping: cut.checks.overlapping.length,
        unassignedSectionLines: cut.checks.unassignedSectionLines,
        linesOutsideSection: cut.checks.linesOutsideSection,
        letter: cut.checks.letter,
      },
      entriesFound: reading.entries.length,
      entriesComplete: reading.entries.filter((entry) => entry.dropped === null && entry.parts.every((part) => part.status === "read" || part.status === "student")).length,
      entries: reading.entries.map((entry) => {
        const cutEntry = cut.entries[entry.index - 1];
        const keys = (status: string): string[] => entry.parts.filter((part) => part.status === status).map((part) => part.partKey);
        return {
          index: entry.index,
          from: cutEntry?.from ?? 0,
          to: cutEntry?.to ?? 0,
          lines: entry.lines,
          dateRanges: cutEntry?.dateRanges ?? 0,
          letterLines: cutEntry?.letterLines ?? 0,
          complete: entry.dropped === null && entry.parts.every((part) => part.status === "read" || part.status === "student"),
          read: keys("read"),
          missing: keys("missing"),
          unparsed: keys("unparsed"),
          partial: Object.entries(entry.partial).map(([partKey, inPart]) => ({ partKey, have: Object.keys(inPart.have), lacking: [...inPart.lacking] })),
          student: keys("student"),
          ungrounded: entry.parts
            .filter((part) => part.status === "ungrounded")
            .map((part) => ({ partKey: part.partKey, spanLength: part.spanLength ?? 0, reason: part.reason ?? "" })),
          skipped: keys("skipped"),
          wouldAsk: entry.dropped === null ? entry.parts.filter((part) => part.status === "missing" || part.status === "unparsed" || part.status === "partial" || part.status === "student").map((part) => part.partKey) : [],
          droppedBecause: entry.dropped,
        };
      }),
    });
  }
  return {
    name,
    contentType,
    pages: text.pages.length,
    lines: whole.split("\n").filter((line) => line.trim().length > 0).length,
    characters: whole.length,
    lists,
  };
}

/** The measurement as a person reads it. Structure only. */
export function renderMeasurement(measured: DocumentMeasurement): string {
  const out: string[] = [];
  out.push(`## ${measured.name}`);
  out.push(`${measured.contentType} · ${String(measured.pages)} page(s) · ${String(measured.lines)} lines · ${String(measured.characters)} characters`);
  for (const list of measured.lists) {
    out.push("");
    out.push(`### ${list.fieldKey}`);
    out.push(
      list.section === null
        ? `section: NOT FOUND under ${list.headings.map((h) => `"${h}"`).join(", ")} — the cut ran over the whole document`
        : `section: lines ${String(list.section.from)}–${String(list.section.to)} (${String(list.sectionLines)} non-blank) — ended at ${
            list.sectionEndedAt === "letter" ? "the cover letter's opening" : list.sectionEndedAt === "heading" ? "the next heading" : "the end of the document"
          }`,
    );
    if (list.none !== null) out.push(`cut: NONE — ${list.none}`);
    out.push(
      `cut: ${String(list.entriesFound)} entries · ${String(list.entriesComplete)} complete from the document · ` +
        `${String(list.cut.unassignedSectionLines)} section lines unassigned · ${String(list.cut.linesOutsideSection)} entry lines outside the section · ` +
        `${String(list.cut.overlapping)} overlapping pairs refused · ${String(list.cut.outsideDocument)} ranges outside the document refused`,
    );
    out.push(list.cut.letter === null ? "cover letter: none found" : `cover letter: lines ${String(list.cut.letter.from)}–${String(list.cut.letter.to)}`);
    for (const entry of list.entries) {
      out.push(
        `- entry ${String(entry.index)} lines ${String(entry.from)}–${String(entry.to)} (${String(entry.lines)}): ${entry.droppedBecause !== null ? "DROPPED" : entry.complete ? "COMPLETE" : "INCOMPLETE — the interview asks"}` +
          ` · date ranges: ${String(entry.dateRanges)}${entry.dateRanges > 1 ? " — TWO ENTRIES CUT AS ONE?" : ""}` +
          (entry.letterLines > 0 ? ` · LETTER TEXT INSIDE THE ENTRY: ${String(entry.letterLines)} line(s)` : ""),
      );
      out.push(`  read: ${entry.read.length === 0 ? "none" : entry.read.join(", ")}`);
      if (entry.missing.length > 0) out.push(`  missing from the document: ${entry.missing.join(", ")}`);
      if (entry.unparsed.length > 0) out.push(`  read but not that value: ${entry.unparsed.join(", ")}`);
      if (entry.partial.length > 0) out.push(`  read in part: ${entry.partial.map((inPart) => `${inPart.partKey} (gives ${inPart.have.join(", ")}; would ask ${inPart.lacking.join(", ")})`).join(", ")}`);
      if (entry.student.length > 0) out.push(`  the student's to state (never asked of the document): ${entry.student.join(", ")}`);
      if (entry.droppedBecause === null) out.push(`  would ask: ${entry.wouldAsk.length === 0 ? "nothing" : entry.wouldAsk.join(", ")}`);
      for (const bad of entry.ungrounded) out.push(`  ungrounded: ${bad.partKey} (span of ${String(bad.spanLength)} characters) — ${bad.reason}`);
      if (entry.skipped.length > 0) out.push(`  not reached: ${entry.skipped.join(", ")}`);
      if (entry.droppedBecause !== null) out.push(`  dropped because ${entry.droppedBecause}`);
    }
  }
  return out.join("\n");
}

async function main(argv: readonly string[], now: () => Date): Promise<void> {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const outIndex = args.indexOf("--out");
  const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const files = args.filter((arg, index) => !arg.startsWith("--") && !(outIndex >= 0 && index === outIndex + 1));
  if (files.length === 0) {
    console.error("usage: pnpm run measure-cv -- [--live] [--out report.json] <cv.pdf|cv.docx> …");
    process.exitCode = 2;
    return;
  }
  const model = demoModel(argv);
  console.log(model.description);
  console.log("");
  const measurements: DocumentMeasurement[] = [];
  try {
    for (const path of files) {
      const contentType = contentTypeOf(path);
      if (contentType === undefined) {
        console.error(`${path}: only a .pdf with a text layer or a .docx is read; skipped`);
        continue;
      }
      const contents = new Uint8Array(await readFile(path));
      const measured = await measureDocument({ name: basename(path), contentType, contents }, model.client);
      measurements.push(measured);
      console.log(renderMeasurement(measured));
      console.log("");
    }
  } finally {
    // On the failure path as well: where the request went is the evidence a
    // failed call leaves, and a cleanup that swallowed it would destroy it (P243).
    console.log(`called: ${destinationLine(model)}`);
    console.log(`usage: ${usageLine(model)}`);
  }
  if (outPath !== undefined) {
    await writeFile(outPath, `${JSON.stringify({ live: model.live, measuredAt: now().toISOString(), documents: measurements }, null, 2)}\n`);
    console.log(`\nwritten: ${outPath} (structure only — no value, no span, no line of any document)`);
  }
}

const invokedDirectly = process.argv[1] !== undefined && /measure-cv-reading\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  // The one ambient read a script may make: the wall clock, at its entry point, for a stamp.
  // eslint-disable-next-line no-restricted-syntax
  main(process.argv, () => new Date()).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
