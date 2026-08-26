/**
 * Confirmation — the ONE place in the system that mints a `ConfirmedValue`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EVERY VALUE THAT EVER REACHES A UNIVERSITY FORM FIELD PASSES THROUGH THIS
 * FILE. Nothing else in the codebase may construct a ConfirmedValue.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ADR-0004 promised that model-generated text cannot reach a form field, and
 * that the only constructor lives in the profile package. This is that
 * constructor. It is deliberately small, deliberately boring, and deliberately
 * the only one — the guarantee is worth exactly as much as this file's
 * discipline.
 *
 * The flow (brief §2.3, ADR-0007):
 *
 *   agent interprets what the student said, or what a document showed
 *     → ProposedValue
 *   agent plays that interpretation back in the student's own terms
 *     → StudentConfirmation
 *   student accepts, corrects, or rejects it
 *     → ConfirmedValue, or nothing at all
 *
 * There is no path from ProposedValue to ConfirmedValue that does not run
 * through `applyConfirmation`, and `applyConfirmation` cannot be called without
 * a confirmation record naming the student and what they were shown.
 */

import type { ConfirmationProvenance, ConfirmedValue, ProposedValue } from "@askimate/aas-domain";
import { unwrapProposed } from "@askimate/aas-domain";

import type { ProfileFieldKey, ProfileFieldType } from "./fields.js";

/**
 * What the student did when shown the agent's interpretation.
 *
 * A closed union because "did they agree?" cannot be a boolean: correcting a
 * value and rejecting the question are different outcomes with different
 * consequences, and collapsing them loses the difference.
 */
export type ConfirmationResponse<T> =
  /** "Yes, that's right." */
  | { readonly kind: "accepted" }
  /** "Close, but it's actually…" — the student supplies the real value. */
  | { readonly kind: "corrected"; readonly correctedValue: T }
  /** "I don't know" / "I'd rather not" / "that question doesn't apply." */
  | { readonly kind: "rejected"; readonly reason: string };

/**
 * The record of asking, and of the answer.
 *
 * `presentedText` is what the student actually saw. Storing it means the case
 * can answer, months later, not just "did they confirm?" but "what exactly were
 * they confirming?" — which is the question that matters if a submitted value
 * is ever disputed.
 */
export interface StudentConfirmation<T> {
  readonly studentRef: string;
  readonly presentedText: string;
  readonly respondedAt: Date;
  readonly response: ConfirmationResponse<T>;
}

/** A confirmed field, ready to enter the profile. */
export interface ConfirmedField<K extends ProfileFieldKey> {
  readonly key: K;
  readonly value: ConfirmedValue<ProfileFieldType<K>>;
}

/** Why a confirmation produced no confirmed value. */
export interface ConfirmationDeclined {
  readonly kind: "declined";
  readonly reason: string;
}

export type ConfirmationResult<K extends ProfileFieldKey> = ConfirmedField<K> | ConfirmationDeclined;

export function isDeclined<K extends ProfileFieldKey>(
  result: ConfirmationResult<K>,
): result is ConfirmationDeclined {
  return (result as { kind?: unknown }).kind === "declined";
}

/**
 * Mints a `ConfirmedValue` from a proposal the student has confirmed.
 *
 * ── The only double assertion in the system ──────────────────────────────
 *
 * The `as unknown as ConfirmedValue<…>` below is the single sanctioned cast
 * that creates confirmed data. It is legitimate here and nowhere else, because
 * it is unreachable without a `StudentConfirmation` — the type system makes the
 * confirmation record a precondition of construction, not a convention someone
 * has to remember.
 *
 * If you are reading this because you want a ConfirmedValue somewhere else:
 * you want to call this function, or you want `FieldUnavailable`. There is no
 * third option, and adding one would silently remove the guarantee the whole
 * design rests on.
 */
export function applyConfirmation<K extends ProfileFieldKey>(input: {
  readonly key: K;
  readonly proposed: ProposedValue<ProfileFieldType<K>>;
  readonly confirmation: StudentConfirmation<ProfileFieldType<K>>;
}): ConfirmationResult<K> {
  const { key, proposed, confirmation } = input;
  const proposal = unwrapProposed(proposed);

  if (confirmation.response.kind === "rejected") {
    // Not an error. The student declining to answer is a legitimate outcome,
    // and the correct next step is to ask differently or escalate — never to
    // fall back on what the agent guessed.
    return { kind: "declined", reason: confirmation.response.reason };
  }

  const accepted = confirmation.response.kind === "accepted";
  const value = accepted ? proposal.value : confirmation.response.correctedValue;

  const provenance: ConfirmationProvenance = {
    // Where it came from AND whether the agent got it right first time. A
    // correction is materially different evidence from an acceptance, and the
    // learning loop (ADR-0008) cares about the difference.
    source: accepted
      ? proposal.origin === "conversation"
        ? "student_stated"
        : "document_extracted"
      : "student_corrected",
    confirmedAt: confirmation.respondedAt,
    // The student's own words, stored in the profile — never in the audit log,
    // which carries IDs rather than personal data (brief §8).
    ...(proposal.origin === "conversation" ? { sourceExcerpt: proposal.verbatim } : {}),
    ...(proposal.documentId !== undefined ? { documentId: proposal.documentId } : {}),
  };

  return {
    key,
    value: { value, provenance } as unknown as ConfirmedValue<ProfileFieldType<K>>,
  };
}

/**
 * Renders a proposal for the student to confirm.
 *
 * Returns plain text, not `ModelText`. The agent may of course phrase the
 * surrounding conversation however it likes — but what the student is asked to
 * confirm must be a faithful rendering of the structured value about to be
 * stored, not a model's paraphrase of it. Otherwise the student confirms one
 * thing and a different thing gets saved.
 */
export function renderForConfirmation<K extends ProfileFieldKey>(
  key: K,
  proposed: ProposedValue<ProfileFieldType<K>>,
  label: string,
): string {
  const proposal = unwrapProposed(proposed);
  const rendered = formatValue(proposal.value);
  const heard =
    proposal.origin === "conversation"
      ? `You said: "${proposal.verbatim}"`
      : `From your document: "${proposal.verbatim}"`;

  return `${heard}\n\nI've recorded your ${label.toLowerCase()} as: ${rendered}\n\nIs that right?`;
}

/** Formats a value for display. Deterministic — never model-written. */
function formatValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join("; ");
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([field, item]) => `${field}: ${formatValue(item)}`)
      .join(", ");
  }
  return String(value);
}
