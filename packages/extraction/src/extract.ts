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
  target: Exclude<ExtractionTarget, { kind: "composite" }>,
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
