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
    verbatim:
      reading.verbatim !== undefined && reading.verbatim !== null && reading.verbatim.length > 0
        ? reading.verbatim
        : fallbackVerbatim,
    confidence: clampConfidence(reading.confidence),
    ...(documentId !== undefined ? { documentId } : {}),
  });
}
