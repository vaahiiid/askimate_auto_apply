/**
 * Confirmed values, model text, and the wall between them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS FILE IMPLEMENTS THE MOST IMPORTANT RULE IN THE SYSTEM.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * From the master brief, §3.1:
 *
 *   "The AI must never be the source of a value that goes into a form field.
 *    Every value written into an application originates from the student's
 *    confirmed profile or a confirmed document. If a required field has no
 *    confirmed source, the system stops and asks the student. It does not
 *    infer, estimate, or fill a plausible answer.
 *
 *    Enforce this structurally, not by instruction. Make it impossible for
 *    model-generated text to reach a form field by construction."
 *
 * The mechanism (ADR-0004):
 *
 *   • `ConfirmedValue<T>` — carries provenance proving a human confirmed it.
 *     Minted ONLY by the profile package, ONLY from a stored confirmation
 *     record. This is the only type an adapter will accept for a form field.
 *
 *   • `ModelText` — anything a language model produced. There is NO function
 *     anywhere in this codebase that converts `ModelText` into a
 *     `ConfirmedValue`. Not a cast helper, not an escape hatch, not a
 *     `force()`. Passing model output to a fill operation does not fail a
 *     review; it fails the build.
 *
 * The AI remains free to reason about NAVIGATION — which control advances the
 * page, what an unexpected validation error means, how to recover from a
 * changed layout. That reasoning produces `ModelText` and control decisions,
 * never field values. That is exactly the separation the brief draws.
 *
 * If a required field has no confirmed source, the resolver returns
 * `FieldUnavailable` and the orchestrator raises a task for the student. There
 * is deliberately no type the system could construct in order to guess.
 */

import type { Brand } from "./brand.js";

// ───────────────────────────────────────────────────────────────────────────
// Provenance
// ───────────────────────────────────────────────────────────────────────────

/** Where a confirmed value came from, and how it earned that status. */
export interface ConfirmationProvenance {
  /**
   * How the value reached the profile.
   *
   *   student_entered    — the student typed it and confirmed it
   *   document_extracted — extracted from a document, then shown to the
   *                        student and confirmed by them (brief §2.3)
   *   student_corrected  — extraction was wrong; the student fixed it
   */
  readonly source: "student_entered" | "document_extracted" | "student_corrected";
  /** When the student confirmed it. */
  readonly confirmedAt: Date;
  /**
   * The document this was extracted from, when `source` is
   * `document_extracted` or `student_corrected`. Document ID only — never
   * document contents (brief §8: audit records may reference document IDs, not
   * document contents).
   */
  readonly documentId?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// The two branded types
// ───────────────────────────────────────────────────────────────────────────

/**
 * A value confirmed by the student. Safe to write into an application.
 *
 * Constructed only by `@askimate/aas-profile`, and only against a stored
 * confirmation record. There is no constructor for it in this module — that is
 * intentional, and it is the whole point.
 */
export type ConfirmedValue<T> = Brand<{ readonly value: T; readonly provenance: ConfirmationProvenance }, "ConfirmedValue">;

/**
 * Text produced by a language model. NEVER safe to write into an application.
 *
 * Returned by `@askimate/aas-llm`, the only package permitted to import a model
 * SDK. Use it for navigation reasoning and explanations shown to humans.
 */
export type ModelText = Brand<string, "ModelText">;

/**
 * Mints `ModelText`. Exported because the llm package must be able to wrap
 * model output — and because widening a string into `ModelText` is always safe.
 * The reverse direction is what does not exist.
 */
export function modelText(raw: string): ModelText {
  return raw as ModelText;
}

/**
 * Reads a confirmed value.
 *
 * Named to be conspicuous at call sites. Reading is fine — the guarantee is
 * about what may be *constructed*, not about what may be inspected. An adapter
 * calls this at the last moment before typing into a field.
 */
export function unwrapConfirmed<T>(confirmed: ConfirmedValue<T>): T {
  return (confirmed as unknown as { readonly value: T }).value;
}

/** Reads the provenance of a confirmed value, for audit and preview rendering. */
export function provenanceOf(confirmed: ConfirmedValue<unknown>): ConfirmationProvenance {
  return (confirmed as unknown as { readonly provenance: ConfirmationProvenance }).provenance;
}

// ───────────────────────────────────────────────────────────────────────────
// The "stop and ask" branch
// ───────────────────────────────────────────────────────────────────────────

/** Why a field could not be resolved from confirmed data. */
export type UnavailableReason =
  /** Nothing has ever been captured for this field. */
  | "not_collected"
  /** Captured, but the student has not confirmed it yet (brief §2.3). */
  | "awaiting_confirmation"
  /** Confirmed once, but the source document is no longer valid (brief §2.4). */
  | "source_expired"
  /** Two confirmed sources disagree; a human must resolve it. */
  | "conflicting_sources";

/**
 * The result of asking for a field the system cannot answer from confirmed
 * data. The orchestrator turns this into a task for the student.
 *
 * This is a *normal* outcome, not an error. A system that never returns it is
 * a system that is guessing.
 */
export interface FieldUnavailable {
  readonly kind: "field_unavailable";
  readonly field: string;
  readonly reason: UnavailableReason;
  /**
   * A human-readable explanation. May be model-written — it is shown to a
   * person, never submitted to a university.
   */
  readonly explanation?: ModelText;
}

/** The result of resolving a single field. */
export type FieldResolution<T> = ConfirmedValue<T> | FieldUnavailable;

/** Narrows a `FieldResolution` to the unavailable branch. */
export function isFieldUnavailable(resolution: FieldResolution<unknown>): resolution is FieldUnavailable {
  // A ConfirmedValue has no `kind` property, so this discriminates cleanly.
  // No defensive null/typeof check: both members of the union are object types,
  // and anything arriving from outside must be validated at its parse boundary
  // rather than smuggled past the type system to here.
  return (resolution as { readonly kind?: unknown }).kind === "field_unavailable";
}

/** Narrows a `FieldResolution` to the confirmed branch. */
export function isConfirmed<T>(resolution: FieldResolution<T>): resolution is ConfirmedValue<T> {
  return !isFieldUnavailable(resolution);
}

/** Builds a `FieldUnavailable`. */
export function fieldUnavailable(
  field: string,
  reason: UnavailableReason,
  explanation?: ModelText,
): FieldUnavailable {
  return explanation === undefined
    ? { kind: "field_unavailable", field, reason }
    : { kind: "field_unavailable", field, reason, explanation };
}
