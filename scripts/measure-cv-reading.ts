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
import { fullText, planFor, readListEntries, sectionOf, textExtractorFor, DOCX_CONTENT_TYPE, PDF_CONTENT_TYPE } from "@askimate/aas-extraction";

import { demoModel, usageLine } from "./model-for-demo.js";

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
  readonly entriesFound: number;
  readonly entriesReadWhole: number;
  readonly entries: readonly {
    readonly index: number;
    readonly lines: number;
    readonly readWhole: boolean;
    readonly read: readonly string[];
    readonly missing: readonly string[];
    readonly ungrounded: readonly { readonly partKey: string; readonly spanLength: number; readonly reason: string }[];
    readonly skipped: readonly string[];
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
  const whole = fullText(text);
  const plan = planFor("cv");
  if (plan === undefined) throw new Error("no plan for a CV");
  const lists: ListMeasurement[] = [];
  for (const target of plan.targets) {
    if (target.kind !== "list") continue;
    const section = sectionOf(text, target.headings);
    const reading: ListReading = await readListEntries(target, text, model);
    lists.push({
      fieldKey: target.fieldKey,
      headings: target.headings,
      sectionFound: section.length > 0,
      sectionLines: section.length,
      entriesFound: reading.entries.length,
      entriesReadWhole: reading.entries.filter((entry) => entry.item !== null).length,
      entries: reading.entries.map((entry) => {
        const missingRequired = entry.parts.find((part) => part.status === "missing" && part.required);
        const ungrounded = entry.parts.find((part) => part.status === "ungrounded");
        return {
          index: entry.index,
          lines: entry.lines,
          readWhole: entry.item !== null,
          read: entry.parts.filter((part) => part.status === "read").map((part) => part.partKey),
          missing: entry.parts.filter((part) => part.status === "missing").map((part) => part.partKey),
          ungrounded: entry.parts
            .filter((part) => part.status === "ungrounded")
            .map((part) => ({ partKey: part.partKey, spanLength: part.spanLength ?? 0, reason: part.reason ?? "" })),
          skipped: entry.parts.filter((part) => part.status === "skipped").map((part) => part.partKey),
          droppedBecause:
            entry.item !== null
              ? null
              : ungrounded !== undefined
                ? `the span quoted for "${ungrounded.partKey}" is not in the document`
                : missingRequired !== undefined
                  ? `"${missingRequired.partKey}" was not found: ${missingRequired.reason ?? ""}`.trim()
                  : "the parts were read but did not assemble into a complete entry",
        };
      }),
    });
  }
  return {
    name: input.name,
    contentType: input.contentType,
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
      list.sectionFound
        ? `section: found (${String(list.sectionLines)} lines) · entries: ${String(list.entriesFound)} found, ${String(list.entriesReadWhole)} read whole`
        : `section: NOT FOUND under ${list.headings.map((h) => `"${h}"`).join(", ")} — nothing was read`,
    );
    for (const entry of list.entries) {
      out.push(`- entry ${String(entry.index)} (${String(entry.lines)} lines): ${entry.readWhole ? "READ WHOLE" : "DROPPED"}`);
      out.push(`  read: ${entry.read.length === 0 ? "none" : entry.read.join(", ")}`);
      if (entry.missing.length > 0) out.push(`  missing: ${entry.missing.join(", ")}`);
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
  console.log(usageLine(model));
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
