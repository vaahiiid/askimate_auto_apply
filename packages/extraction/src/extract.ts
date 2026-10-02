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

import { checkGrounding, normaliseForComparison } from "./grounding.js";
import type { DocumentDateKind, ExtractionPlan, ExtractionTarget, PartSource, PartialReading } from "./plans.js";
import { planFor } from "./plans.js";
import type { DocumentText } from "./text.js";
import { sectionOf } from "./sections.js";
import { cutDocument } from "./segments.js";
import type { Cut } from "./segments.js";
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
  readonly source: PartSource;
  /**
   *   read        read, grounded and parsed — in `fields`;
   *   missing     the model found nothing; the interview asks (ADR-0149);
   *   unparsed    read and grounded, and the plan's parser refused the text; asked, never guessed;
   *   partial     read and grounded, not that value, but some of its components — a year
   *               without its month; the interview asks for what is lacking (P248);
   *   ungrounded  a span the document does not contain — the ENTRY is dropped (ADR-0016);
   *   skipped     not reached, the entry having been dropped;
   *   student     the student's to state: never asked of the document (ADR-0149);
   *   unreadable  grounded, but the entry's parts came back as the same words —
   *               the line, not its parts; nothing of it is taken, the
   *               interview asks the entry by hand (P266).
   */
  readonly status: "read" | "missing" | "unparsed" | "partial" | "ungrounded" | "skipped" | "student" | "unreadable";
  /** On `partial` only: the components the text gave, and the ones it lacks — in `partial` on the entry too. */
  readonly lacking?: readonly string[];
  /** The length of the span quoted, for a measurement, which must carry no line of the document. */
  readonly spanLength?: number;
  /** The span the model quoted and the document does not contain — on `ungrounded` only, for the report's `claimedSpan`. */
  readonly claimedSpan?: string;
  readonly reason?: string;
}

/** One entry of a list, as read: what the document gave, and what it did not. */
export interface ListEntryReading {
  /** One-based, as the report names it: `employment.history[2]`. */
  readonly index: number;
  readonly lines: number;
  readonly parts: readonly ListPartReading[];
  /** The parsed value of every `document` part that read — the entry as far as the document states it. Empty when dropped. */
  readonly fields: Readonly<Record<string, unknown>>;
  /** The span each read part — whole or in part — was read from, by part key: the student's own words for the playback, and for the narrowed question. Empty when dropped. */
  readonly spans: Readonly<Record<string, string>>;
  /** Every `document` part read IN PART: the components the document gave and the ones the interview asks (P248). Empty when dropped. */
  readonly partial: Readonly<Record<string, PartialReading>>;
  readonly lowestConfidence: number;
  /** Why the entry is not offered at all: an invented span, or two date ranges cut as one. `null` for an entry that stands. */
  readonly dropped: string | null;
  /**
   * The words most of the entry's parts came back as, when they did (P266):
   * the line, not its parts. Such an entry is offered with nothing taken from
   * it, to be asked by hand, its words shown. `null` for a reading.
   */
  readonly unreadable: string | null;
  /**
   * Why an entry was held back, when it was (P268, row 124): `two_ranges`, two
   * date ranges cut as one; `invented`, a part's span the document does not
   * hold. Held back is not dropped: the report carries the entry's lines and
   * the interview asks it by hand, saying why. `null` for an entry that stands.
   */
  readonly heldBack: "two_ranges" | "invented" | null;
}

/**
 * The words most of an entry's parts came back as, or `null` (P266).
 *
 * Vahid: *"Every part identical is a signature: a reading where N parts share
 * one span is not a reading."* The threshold is mine: one span shared by at
 * least three parts and by more than half of those that returned a span. A
 * real reading shares spans — the award title, the subject and the level read
 * from "BSc Computer Science", the start and the end from "2015 – 2019" — but
 * not most of its parts.
 */
export function sharedSpanOf(spans: readonly string[]): string | null {
  const counts = new Map<string, { words: string; count: number }>();
  for (const span of spans) {
    const key = normaliseForComparison(span);
    const held = counts.get(key);
    counts.set(key, { words: held?.words ?? span, count: (held?.count ?? 0) + 1 });
  }
  const most = [...counts.values()].reduce<{ words: string; count: number } | null>((best, next) => (best === null || next.count > best.count ? next : best), null);
  return most !== null && most.count >= 3 && most.count * 2 > spans.length ? most.words : null;
}

/** A list target read against a document: what was found before anything was accepted. */
export interface ListReading {
  readonly fieldKey: string;
  /** How many lines the section found by heading holds, 0 for none. */
  readonly sectionLines: number;
  /** The cut the entries were read within, with its checks (stage three). */
  readonly cut: Cut;
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
  /** The cut to read within; when absent, the document is cut through the model first (`segments.ts`). */
  given?: Cut,
): Promise<ListReading> {
  const targetKey = target.fieldKey;
  const cut = given ?? (await cutDocument(target, text, model));
  const section = sectionOf(text, target.headings);
  const readings: ListEntryReading[] = [];
  for (const cutEntry of cut.entries) {
    const entry = cutEntry.lines;
    const block = entry.join("\n");
    const fields: Record<string, unknown> = {};
    const spans: Record<string, string> = {};
    const partial: Record<string, PartialReading> = {};
    const parts: ListPartReading[] = [];
    /** Every grounded span, whatever became of it: the signature is in the spans, not the values. */
    const returned: { readonly partKey: string; readonly span: string }[] = [];
    let lowestConfidence = 1;
    // The merge detector first (segments.ts): two date ranges in one entry is
    // two jobs until a person says otherwise — held back, named, never read
    // as one and never offered as one.
    let heldBack: "two_ranges" | "invented" | null = cutEntry.dateRanges > 1 ? "two_ranges" : null;
    let dropped: string | null =
      cutEntry.dateRanges > 1
        ? `Held back: the entry carries ${String(cutEntry.dateRanges)} date ranges, which reads as ${String(cutEntry.dateRanges)} entries cut as one.`
        : null;
    for (const part of target.parts) {
      if (dropped !== null) {
        parts.push({ partKey: part.partKey, source: part.source, status: "skipped" });
        continue;
      }
      // ADR-0149: the student's to state. No request is built for it, so the
      // model is never in a position to derive it from something real.
      if (part.source === "student") {
        parts.push({ partKey: part.partKey, source: "student", status: "student" });
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
        // A normal outcome: the document does not state it, and the interview asks.
        parts.push({ partKey: part.partKey, source: "document", status: "missing", reason: read.reason });
        continue;
      }
      const grounded = unwrapProposed(read);
      const grounding = checkGrounding(text, grounded.verbatim);
      if (grounding.kind !== "grounded") {
        // ADR-0016: a model that invents a span invents nothing here — and an
        // entry it invented for is not offered at all.
        parts.push({ partKey: part.partKey, source: "document", status: "ungrounded", spanLength: grounded.verbatim.length, claimedSpan: grounded.verbatim, reason: grounding.reason });
        dropped = `Part "${part.partKey}" was discarded. ${grounding.reason}`.trim();
        heldBack = "invented";
        continue;
      }
      returned.push({ partKey: part.partKey, span: grounded.verbatim });
      const value = part.parse(grounded.value);
      if (value === null || value === undefined) {
        // Real text, not this value — but perhaps some of it: "2019" is not a
        // month and a year, and it is a year (P248). The components it gave
        // are kept with their words, and the interview asks for the rest.
        const inPart = part.components?.(grounded.value) ?? null;
        if (inPart !== null) {
          parts.push({ partKey: part.partKey, source: "document", status: "partial", spanLength: grounded.verbatim.length, lacking: inPart.lacking, reason: `The text read gives ${Object.keys(inPart.have).join(", ")} and not ${inPart.lacking.join(", ")}.` });
          partial[part.partKey] = inPart;
          spans[part.partKey] = grounded.verbatim;
          lowestConfidence = Math.min(lowestConfidence, grounded.confidence);
          continue;
        }
        // "BSc" is not a level. Asked, never guessed.
        parts.push({ partKey: part.partKey, source: "document", status: "unparsed", spanLength: grounded.verbatim.length, reason: `The text read is not ${part.expectedShape}.` });
        continue;
      }
      parts.push({ partKey: part.partKey, source: "document", status: "read", spanLength: grounded.verbatim.length });
      fields[part.partKey] = value;
      spans[part.partKey] = grounded.verbatim;
      lowestConfidence = Math.min(lowestConfidence, grounded.confidence);
    }
    // P266: the parts came back as the line. Nothing of it is taken — not
    // even the parts that parsed, since an institution that is a sentence
    // parses as an institution — and the entry is asked by hand.
    const unreadable = dropped === null ? sharedSpanOf(returned.map((each) => each.span)) : null;
    if (unreadable !== null) {
      const shared = normaliseForComparison(unreadable);
      const same = returned.filter((each) => normaliseForComparison(each.span) === shared).length;
      const reason = `${String(same)} of the entry's ${String(returned.length)} parts came back as the same words: the line, not its parts.`;
      for (const [at, reading] of parts.entries()) {
        if (reading.status === "read" || reading.status === "partial" || reading.status === "unparsed") {
          const { lacking: _lacking, ...rest } = reading;
          parts[at] = { ...rest, status: "unreadable", reason };
        }
      }
    }
    const offered = dropped === null && unreadable === null;
    readings.push({
      index: cutEntry.index,
      lines: entry.length,
      parts,
      fields: offered ? fields : {},
      spans: offered ? spans : {},
      partial: offered ? partial : {},
      lowestConfidence,
      dropped,
      unreadable,
      heldBack,
    });
  }
  return { fieldKey: targetKey, sectionLines: section.length, cut, entries: readings };
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
    // A list is read by `readListEntries`, entry by entry, into the interview's
    // walk (ADR-0148 §9, ADR-0149): its entries arrive with what the document
    // gave and the interview asks for the rest, which is not an outcome this
    // report can carry. Nothing here reads one.
    if (target.kind === "list") continue;
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
