/**
 * Running an extraction plan against a document.
 *
 * The shape of one reading:
 *
 *   plan target
 *     → model reads the document text, returns a value AND the span it read
 *     → the span is checked against the document          ← the guard
 *     → the value is parsed deterministically             ← done by the plan
 *     → a ProposedValue, which is NOT yet in the profile
 *     → the student confirms it, in AskiMate Chat         ← where it becomes real
 *
 * Nothing here writes to a profile. Extraction cannot: it produces
 * `ProposedValue`s, and only `applyConfirmation` in the profile package mints a
 * `ConfirmedValue` (ADR-0004). The route from a document to an application
 * field necessarily passes through the student.
 */

import type { DocumentType } from "@askimate/aas-domain";
import type { ProposedValue } from "@askimate/aas-domain";
import { proposeValue, unwrapProposed } from "@askimate/aas-domain";
import type { ModelClient } from "@askimate/aas-llm";
import { isNotUnderstood } from "@askimate/aas-llm";
import type { ProfileFieldKey } from "@askimate/aas-profile";

import { checkGrounding } from "./grounding.js";
import type { DocumentDateKind, ExtractionPlan, ExtractionTarget } from "./plans.js";
import { planFor } from "./plans.js";
import type { DocumentText } from "./text.js";
import { entriesOf, sectionOf } from "./sections.js";
import { fullText } from "./text.js";

/** What one target produced. */
export type ExtractionOutcome =
  /** Read, grounded, parsed. Awaiting the student's confirmation. */
  | {
      readonly kind: "extracted";
      readonly targetKey: string;
      readonly fieldKey?: ProfileFieldKey;
      readonly dateKind?: DocumentDateKind;
      readonly proposed: ProposedValue<unknown>;
      /** Page the span was found on. */
      readonly page: number;
    }
  /** The document does not appear to contain it. A normal outcome. */
  | {
      readonly kind: "not_found";
      readonly targetKey: string;
      readonly required: boolean;
      readonly reason: string;
    }
  /**
   * The model produced a value, and the span it quoted is NOT in the document.
   *
   * The reading is discarded. This is not a parse failure and must never be
   * reported as one — it is the model having invented something, and it is
   * worth surfacing distinctly so it can be counted rather than absorbed.
   */
  | {
      readonly kind: "rejected_ungrounded";
      readonly targetKey: string;
      readonly required: boolean;
      readonly claimedSpan: string;
      readonly reason: string;
    };

export interface ExtractionReport {
  readonly documentId: string;
  readonly documentType: DocumentType;
  readonly outcomes: readonly ExtractionOutcome[];
}

/** The key a target is reported under. */
/** What happened to one part of one entry of a list, for the report and for a measurement. */
export interface ListPartReading {
  readonly partKey: string;
  readonly required: boolean;
  /** `read` and grounded; `missing` — the model found nothing; `ungrounded` — a span the document does not contain; `skipped` — not reached, an earlier required part having failed. */
  readonly status: "read" | "missing" | "ungrounded" | "skipped";
  /** The length of the span quoted, for a measurement, which must carry no line of the document. */
  readonly spanLength?: number;
  /** The span the model quoted and the document does not contain — on `ungrounded` only, for the report's `claimedSpan`. */
  readonly claimedSpan?: string;
  readonly reason?: string;
}

/** One entry of a list, as read. */
export interface ListEntryReading {
  /** One-based, as the report names it: `employment.history[2]`. */
  readonly index: number;
  readonly lines: number;
  readonly parts: readonly ListPartReading[];
  /** The assembled item, or `null` where a required part was missing or ungrounded, or the parts did not assemble. */
  readonly item: unknown;
  readonly spans: readonly string[];
  readonly lowestConfidence: number;
}

/** A list target read against a document: what was found before anything was accepted. */
export interface ListReading {
  readonly fieldKey: string;
  /** The heading the section was found under, or `null` for none. */
  readonly sectionLines: number;
  readonly entries: readonly ListEntryReading[];
}

/**
 * A list of entries, each read part by part and grounded (stage two).
 *
 * The document is cut by code (`sections.ts`) into the section under the
 * target's headings and into entries at the first part's labels. Each part
 * of each entry is read out of THAT ENTRY'S lines through the same model
 * contract every other target uses, and its span is checked against the
 * WHOLE document — a span from anywhere in the document is real, a span from
 * nowhere is invented. Exported as a reading so that a measurement against a
 * real document (P240) can say, part by part, what was read, what was
 * missing and what was rejected, without carrying a line of the document.
 */
export async function readListEntries(
  target: Extract<ExtractionTarget, { kind: "list" }>,
  text: DocumentText,
  model: ModelClient,
): Promise<ListReading> {
  const targetKey = target.fieldKey;
  const first = target.parts[0];
  const section = sectionOf(text, target.headings);
  const entries = first === undefined ? [] : entriesOf(section, first.labels);
  const readings: ListEntryReading[] = [];
  for (const [index, entry] of entries.entries()) {
    const block = entry.join("\n");
    const values = new Map<string, string>();
    const spans: string[] = [];
    const parts: ListPartReading[] = [];
    let lowestConfidence = 1;
    let failed = false;
    for (const part of target.parts) {
      if (failed) {
        parts.push({ partKey: part.partKey, required: part.required, status: "skipped" });
        continue;
      }
      const read = await model.extractFromDocument({
        documentId: text.documentId,
        documentType: text.documentType,
        fieldKey: `${targetKey}.${part.partKey}`,
        documentText: block,
        hint: part.hint,
        labels: part.labels,
        expectedShape: part.expectedShape,
        parse: (raw) => (raw.trim().length > 0 ? raw.trim() : null),
        requireVerbatimSpan: true,
      });
      if (isNotUnderstood(read)) {
        parts.push({ partKey: part.partKey, required: part.required, status: "missing", reason: read.reason });
        if (part.required) failed = true;
        continue;
      }
      const fields = unwrapProposed(read);
      const grounding = checkGrounding(text, fields.verbatim);
      if (grounding.kind !== "grounded") {
        parts.push({ partKey: part.partKey, required: part.required, status: "ungrounded", spanLength: fields.verbatim.length, claimedSpan: fields.verbatim, reason: grounding.reason });
        failed = true;
        continue;
      }
      parts.push({ partKey: part.partKey, required: part.required, status: "read", spanLength: fields.verbatim.length });
      values.set(part.partKey, fields.value);
      spans.push(fields.verbatim);
      lowestConfidence = Math.min(lowestConfidence, fields.confidence);
    }
    const item = failed ? null : (target.assemble(values) ?? null);
    readings.push({ index: index + 1, lines: entry.length, parts, item, spans, lowestConfidence });
  }
  return { fieldKey: targetKey, sectionLines: section.length, entries: readings };
}

/**
 * The outcomes of a list target: the entries that read whole as one
 * proposal; each dropped entry reported by its position and why; none is
 * `not_found` and not required, because a CV may list none.
 */
async function runList(
  target: Extract<ExtractionTarget, { kind: "list" }>,
  text: DocumentText,
  model: ModelClient,
): Promise<readonly ExtractionOutcome[]> {
  const targetKey = target.fieldKey;
  const first = target.parts[0];
  if (first === undefined) return [{ kind: "not_found", targetKey, required: false, reason: "The plan names no parts." }];
  const reading = await readListEntries(target, text, model);
  if (reading.entries.length === 0) {
    return [
      {
        kind: "not_found",
        targetKey,
        required: false,
        reason:
          reading.sectionLines === 0
            ? `No section headed ${target.headings.map((h) => `"${h}"`).join(", ")} on this ${text.documentType}.`
            : `A section, but no entry in it opens with ${first.labels.map((l) => `"${l}"`).join(" or ")}.`,
      },
    ];
  }

  const items: unknown[] = [];
  const spans: string[] = [];
  const dropped: ExtractionOutcome[] = [];
  let lowestConfidence = 1;
  for (const entry of reading.entries) {
    const position = `${targetKey}[${String(entry.index)}]`;
    const ungrounded = entry.parts.find((part) => part.status === "ungrounded");
    const missing = entry.parts.find((part) => part.status === "missing" && part.required);
    if (ungrounded !== undefined) {
      dropped.push({
        kind: "rejected_ungrounded",
        targetKey: position,
        required: false,
        claimedSpan: ungrounded.claimedSpan ?? "",
        reason: `Part "${ungrounded.partKey}" was discarded. ${ungrounded.reason ?? ""}`.trim(),
      });
      continue;
    }
    if (missing !== undefined) {
      dropped.push({ kind: "not_found", targetKey: position, required: false, reason: `Could not read "${missing.partKey}": ${missing.reason ?? ""}`.trim() });
      continue;
    }
    if (entry.item === null) {
      dropped.push({ kind: "not_found", targetKey: position, required: false, reason: `Read the parts but could not assemble a complete entry from them.` });
      continue;
    }
    items.push(entry.item);
    spans.push(...entry.spans);
    lowestConfidence = Math.min(lowestConfidence, entry.lowestConfidence);
  }

  const whole: ExtractionOutcome =
    items.length === 0
      ? { kind: "not_found", targetKey, required: false, reason: `${String(reading.entries.length)} ${reading.entries.length === 1 ? "entry" : "entries"} found and none read whole.` }
      : {
          kind: "extracted",
          targetKey,
          fieldKey: target.fieldKey,
          proposed: proposeValue({
            value: items,
            origin: "document",
            verbatim: spans.join("\n"),
            confidence: lowestConfidence,
            documentId: text.documentId,
          }),
          page: 1,
        };
  return [whole, ...dropped];
}

export function targetKeyOf(target: ExtractionTarget): string {
  return target.kind === "document_date" ? `document.${target.dateKind}` : target.fieldKey;
}

/**
 * Runs the plan for this document type.
 *
 * Returns `null` when there is no plan — which the caller must treat as "a
 * human must read this", never as "nothing was found". The two are opposite
 * conclusions and conflating them is how a required document quietly
 * contributes nothing.
 */
export async function extractDocument(
  text: DocumentText,
  model: ModelClient,
): Promise<ExtractionReport | null> {
  const plan = planFor(text.documentType);
  if (plan === undefined) return null;
  return runPlan(plan, text, model);
}

async function runPlan(
  plan: ExtractionPlan,
  text: DocumentText,
  model: ModelClient,
): Promise<ExtractionReport> {
  const outcomes: ExtractionOutcome[] = [];

  for (const target of plan.targets) {
    if (target.kind === "list") {
      outcomes.push(...(await runList(target, text, model)));
      continue;
    }
    outcomes.push(
      target.kind === "composite"
        ? await runComposite(target, text, model)
        : await runSimple(target, text, model),
    );
  }

  return { documentId: text.documentId, documentType: text.documentType, outcomes };
}

/** One span, one value. */
async function runSimple(
  target: Exclude<ExtractionTarget, { kind: "composite" } | { kind: "list" }>,
  text: DocumentText,
  model: ModelClient,
): Promise<ExtractionOutcome> {
  const targetKey = targetKeyOf(target);

  const read = await model.extractFromDocument({
    documentId: text.documentId,
    documentType: text.documentType,
    fieldKey: targetKey,
    documentText: fullText(text),
    hint: target.hint,
    labels: target.labels,
    expectedShape: target.expectedShape,
    parse: (raw) => target.parse(raw) ?? null,
    requireVerbatimSpan: true,
  });

  if (isNotUnderstood(read)) {
    return { kind: "not_found", targetKey, required: target.required, reason: read.reason };
  }

  const fields = unwrapProposed(read);
  const grounding = checkGrounding(text, fields.verbatim);
  if (grounding.kind !== "grounded") {
    return {
      kind: "rejected_ungrounded",
      targetKey,
      required: target.required,
      claimedSpan: fields.verbatim,
      reason: grounding.reason,
    };
  }

  return {
    kind: "extracted",
    targetKey,
    ...(target.kind === "scalar" ? { fieldKey: target.fieldKey } : { dateKind: target.dateKind }),
    proposed: read,
    page: grounding.page,
  };
}

/**
 * Several spans, assembled by code.
 *
 * Each part is read and grounded on its own, so every component fact traces to
 * a line of the document. A single missing or ungrounded REQUIRED part fails
 * the whole target: a qualification assembled from four real facts and one
 * invented one is not four-fifths correct, it is wrong.
 */
async function runComposite(
  target: Extract<ExtractionTarget, { kind: "composite" }>,
  text: DocumentText,
  model: ModelClient,
): Promise<ExtractionOutcome> {
  const targetKey = target.fieldKey;
  const values = new Map<string, string>();
  const spans: string[] = [];
  let lowestConfidence = 1;

  for (const part of target.parts) {
    const read = await model.extractFromDocument({
      documentId: text.documentId,
      documentType: text.documentType,
      fieldKey: `${targetKey}.${part.partKey}`,
      documentText: fullText(text),
      hint: part.hint,
      labels: part.labels,
      expectedShape: part.expectedShape,
      // Parts are read as text and assembled by the plan, so the structure of
      // the field is decided by code rather than by the model.
      parse: (raw) => (raw.trim().length > 0 ? raw.trim() : null),
      requireVerbatimSpan: true,
    });

    if (isNotUnderstood(read)) {
      if (part.required) {
        return {
          kind: "not_found",
          targetKey,
          required: target.required,
          reason: `Could not read "${part.partKey}": ${read.reason}`,
        };
      }
      continue;
    }

    const fields = unwrapProposed(read);
    const grounding = checkGrounding(text, fields.verbatim);
    if (grounding.kind !== "grounded") {
      return {
        kind: "rejected_ungrounded",
        targetKey,
        required: target.required,
        claimedSpan: fields.verbatim,
        reason: `Part "${part.partKey}" was discarded. ${grounding.reason}`,
      };
    }

    values.set(part.partKey, fields.value);
    spans.push(fields.verbatim);
    lowestConfidence = Math.min(lowestConfidence, fields.confidence);
  }

  const assembled = target.assemble(values);
  if (assembled === null || assembled === undefined) {
    return {
      kind: "not_found",
      targetKey,
      required: target.required,
      reason: `Read the parts but could not assemble a complete ${targetKey} from them.`,
    };
  }

  return {
    kind: "extracted",
    targetKey,
    fieldKey: target.fieldKey,
    // The confidence of the whole is the confidence of its weakest part, not
    // the average — averaging lets six certain facts hide one shaky one.
    proposed: proposeValue({
      value: assembled,
      origin: "document",
      verbatim: spans.join("\n"),
      confidence: lowestConfidence,
      documentId: text.documentId,
    }),
    page: 1,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Reading a report
// ───────────────────────────────────────────────────────────────────────────

export function extracted(report: ExtractionReport): readonly Extract<
  ExtractionOutcome,
  { kind: "extracted" }
>[] {
  return report.outcomes.filter(
    (outcome): outcome is Extract<ExtractionOutcome, { kind: "extracted" }> =>
      outcome.kind === "extracted",
  );
}

/** Required targets the document did not yield. The agent must ask for these. */
export function missingRequired(report: ExtractionReport): readonly string[] {
  return report.outcomes
    .filter((outcome) => outcome.kind !== "extracted" && outcome.required)
    .map((outcome) => outcome.targetKey);
}

/**
 * Readings discarded because the model quoted text the document does not have.
 *
 * Surfaced separately because the count is a signal about the model or the text
 * layer, not about the student — and a rising count is something a human should
 * see rather than something to be absorbed as "the document was unclear".
 */
export function ungrounded(report: ExtractionReport): readonly Extract<
  ExtractionOutcome,
  { kind: "rejected_ungrounded" }
>[] {
  return report.outcomes.filter(
    (outcome): outcome is Extract<ExtractionOutcome, { kind: "rejected_ungrounded" }> =>
      outcome.kind === "rejected_ungrounded",
  );
}

/** Proposed profile fields, ready to be put to the student for confirmation. */
export function proposedFields(
  report: ExtractionReport,
): readonly { readonly fieldKey: ProfileFieldKey; readonly proposed: ProposedValue<unknown> }[] {
  return extracted(report)
    .filter((outcome) => outcome.fieldKey !== undefined)
    .map((outcome) => ({
      fieldKey: outcome.fieldKey as ProfileFieldKey,
      proposed: outcome.proposed,
    }));
}
