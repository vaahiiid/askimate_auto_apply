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
   *   student_stated     — the student said it in conversation with the agent,
   *                        the agent interpreted it into a structured field,
   *                        played that interpretation back, and the student
   *                        confirmed it (ADR-0007)
   *   student_entered    — the student typed it directly and confirmed it
   *   document_extracted — extracted from a document, then shown to the
   *                        student and confirmed by them (brief §2.3)
   *   student_corrected  — extraction or interpretation was wrong; the student
   *                        corrected it
   *
   * Every one of these ends in the student confirming. That is the only way a
   * value becomes confirmed — there is no source that bypasses it.
   */
  readonly source: "student_stated" | "student_entered" | "document_extracted" | "student_corrected";
  /** When the student confirmed it. */
  readonly confirmedAt: Date;
  /**
   * The student's own words, when the value came from conversation.
   *
   * Stored in the profile so a case can answer "what did the student actually
   * say?" months later (brief §4). NOT written to the audit log, which carries
   * IDs rather than personal data (brief §8).
   */
  readonly sourceExcerpt?: string;
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

// ───────────────────────────────────────────────────────────────────────────
// The third side of the wall: model INTERPRETATION of what a human said
// ───────────────────────────────────────────────────────────────────────────

/** Where the agent's interpretation came from. */
export type ExtractionOrigin =
  /** Something the student said in conversation with the agent (ADR-0007). */
  | "conversation"
  /** Something read out of an uploaded document (brief §2.3). */
  | "document";

/**
 * A structured value the agent has INTERPRETED but the student has NOT yet
 * confirmed.
 *
 * ── Why this type exists (ADR-0007) ──────────────────────────────────────
 *
 * Under agent-led conversational intake, the student never fills in a form —
 * they talk, and the agent turns what they said into structured fields:
 *
 *   Student: "I finished my bachelor's in computer science at Tehran
 *             Polytechnic in 2023, got about 17 out of 20."
 *
 *   Agent:   { qualification: BSc, subject: "Computer Science",
 *              completionYear: 2023, grade: "17/20", scale: iran_20_point }
 *
 * That mapping **is a model inference**, with exactly the failure modes
 * document extraction has: a misheard value, the wrong grading scale, a
 * confident reading of an ambiguous sentence. Letting it straight into the
 * profile would make a model's interpretation into an application field —
 * which is the thing ADR-0004 exists to prevent.
 *
 * So conversation goes through extract-then-confirm exactly as documents do.
 * `ProposedValue` is what the agent produces; the student's confirmation is
 * what turns it into a `ConfirmedValue`.
 *
 * As with `ModelText`, THERE IS NO CONVERSION FUNCTION. Only the profile
 * package's confirmation step can mint a `ConfirmedValue`, and only against a
 * stored confirmation record.
 */
export interface ProposedValueFields<T> {
  readonly value: T;
  readonly origin: ExtractionOrigin;
  /**
   * The student's own words, or the document excerpt, that produced this
   * interpretation. Shown back to them so they can see what was understood
   * from what they actually said.
   */
  readonly verbatim: string;
  /**
   * The agent's confidence, 0–1.
   *
   * Layer-one escalation only. It can send a low-confidence reading to a human
   * — it can NEVER promote a high-confidence one to confirmed. No threshold
   * exists above which the student's confirmation is skipped.
   */
  readonly confidence: number;
  readonly documentId?: string;
}

export type ProposedValue<T> = Brand<ProposedValueFields<T>, "ProposedValue">;

/**
 * Mints a `ProposedValue`.
 *
 * Safe to export: this is the *unconfirmed* side of the wall. Anything may
 * propose. Only the student's confirmation promotes.
 */
export function proposeValue<T>(input: {
  readonly value: T;
  readonly origin: ExtractionOrigin;
  readonly verbatim: string;
  readonly confidence: number;
  readonly documentId?: string;
}): ProposedValue<T> {
  if (!(input.confidence >= 0 && input.confidence <= 1)) {
    throw new RangeError(`confidence must be between 0 and 1, received: ${String(input.confidence)}`);
  }
  return {
    value: input.value,
    origin: input.origin,
    verbatim: input.verbatim,
    confidence: input.confidence,
    ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
  } as unknown as ProposedValue<T>;
}

/**
 * Reads a proposed value, so the agent can play it back to the student for
 * confirmation.
 *
 * Reading is fine. It is *constructing a ConfirmedValue* that is restricted.
 */
export function unwrapProposed<T>(proposed: ProposedValue<T>): ProposedValueFields<T> {
  return proposed;
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
