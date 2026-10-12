/**
 * Turning a model's structured answer into a proposal, or refusing.
 *
 * Pure, and separate from the Bedrock client on purpose: this is where the
 * decisions live, and decisions should be testable without an AWS account. A
 * rule that can only be exercised by calling a paid API is a rule nobody
 * exercises.
 */

import type { ProposedValue } from "@askimate/aas-domain";
import { proposeValue } from "@askimate/aas-domain";

import type { NotUnderstood } from "./client.js";

/** What the model returns through the strict-schema tool. */
export interface ReadingToolInput {
  readonly understood: boolean;
  readonly value?: string | null;
  readonly verbatim?: string | null;
  readonly confidence?: number | null;
  readonly reason?: string | null;
}

/**
 * Keeps confidence inside 0–1.
 *
 * A model reporting 1.4 is not more certain than one reporting 1.0, and
 * `proposeValue` throws on an out-of-range value. Clamping keeps a malformed
 * confidence from failing an entire extraction — the figure is advisory, and
 * no value of it promotes anything.
 */
export function clampConfidence(raw: number | null | undefined): number {
  if (raw === null || raw === undefined || Number.isNaN(raw)) return 0.5;
  return Math.min(1, Math.max(0, raw));
}

/**
 * Turns a structured reading into a `ProposedValue`, or refuses.
 *
 * ── Two independent ways to refuse, and the second is the important one ───
 *
 *   the model said it could not read it   → not_understood, with its reason
 *   the caller's parser rejected the text → not_understood, WHATEVER the
 *                                           model's confidence was
 *
 * The second catches a confident misreading, which is the failure mode that
 * matters. `02/04/1999` is a perfectly confident reading of an ambiguous date,
 * and the field's deterministic parser refuses it because April 2nd and
 * February 4th are different days and date of birth drives minor detection
 * (ADR-0011).
 *
 * The model's confidence is never consulted in either branch. It travels with
 * the proposal for layer-one escalation and cannot promote anything.
 */
export function toProposal<T>(input: {
  readonly reading: ReadingToolInput;
  readonly parse: (raw: string) => T | null;
  readonly origin: "conversation" | "document";
  /** Used only when the model returned no span of its own. */
  readonly fallbackVerbatim: string;
  readonly documentId?: string;
}): ProposedValue<T> | NotUnderstood {
  const { reading, parse, origin, fallbackVerbatim, documentId } = input;

  if (!reading.understood || reading.value === undefined || reading.value === null) {
    return {
      kind: "not_understood",
      reason: reading.reason ?? "The model could not read a usable value.",
    };
  }

  // A part read AS STATED (P297, the grade scale) keeps the student's words,
  // so a model's words are not theirs: "GPA" answered, "GPA out of 4" read,
  // would put a maximum in their mouth. In a conversation the student's words
  // are the utterance; a document's span is held to its text by grounding,
  // after this, by the extractor.
  const asStated = origin === "conversation" && (parse as { readonly asStated?: boolean }).asStated === true;
  if (asStated && !isQuotedIn(fallbackVerbatim, reading.value)) {
    return {
      kind: "not_understood",
      reason:
        `Read "${reading.value}", which is not in what was said. This part is kept in the ` +
        `student's own words, so it was refused rather than reworded.`,
    };
  }

  const parsed = parse(reading.value);
  if (parsed === null) {
    return {
      kind: "not_understood",
      reason:
        `Read "${reading.value}", which is not a usable value for this field. ` +
        `It was refused rather than approximated.`,
    };
  }

  return proposeValue({
    value: parsed,
    origin,
    // The span the model claims to have read. For documents this is what the
    // grounding check tests, so a fabricated one is caught upstream (ADR-0016).
    // An as-stated part is credited with what the student said, not with the
    // span the model chose: the playback's "you said" is their whole answer.
    verbatim: asStated
      ? fallbackVerbatim
      : reading.verbatim !== undefined && reading.verbatim !== null && reading.verbatim.length > 0
        ? reading.verbatim
        : fallbackVerbatim,
    confidence: clampConfidence(reading.confidence),
    ...(documentId !== undefined ? { documentId } : {}),
  });
}

/**
 * Whether `value` is quoted whole in `source` (P297): compared without case
 * or runs of space, and only where it starts and ends at a boundary, so a
 * quote that stops inside a word or a number is not one — "out of 4" is not
 * in "out of 4.5", and "GPA" is not in "CGPA".
 */
export function isQuotedIn(source: string, value: string): boolean {
  const flat = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();
  const haystack = flat(source);
  const needle = flat(value);
  if (needle.length === 0) return false;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack.slice(0, at);
    const after = haystack.slice(at + needle.length);
    const startsClean = !/[\p{L}\p{N}]$/u.test(before) || !/^[\p{L}\p{N}]/u.test(needle);
    const endsClean = !/[\p{L}\p{N}]$/u.test(needle) || !/^(?:[\p{L}\p{N}]|[.,]\p{N})/u.test(after);
    if (startsClean && endsClean) return true;
  }
  return false;
}
