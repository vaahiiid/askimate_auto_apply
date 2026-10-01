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

import type { ConfirmationProvenance, ConfirmedValue, ExtractionOrigin, ProposedValue } from "@askimate/aas-domain";
import { unwrapProposed } from "@askimate/aas-domain";

import type { ProfileFieldKey, ProfileFieldType } from "./fields.js";
import { FIELD_LABELS, isCountryField, partLabel, vocabularyWords } from "./fields.js";
import { readCountry } from "./countries.js";

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
    // A conversation-origin proposal that names a document is a value the
    // document gave in part and the student completed (P253, row 109): the
    // interview assembles a list that way. Neither "the student said it" nor
    // "extracted" alone is true of it, so it has its own word.
    source: accepted
      ? proposal.origin === "conversation"
        ? proposal.documentId === undefined
          ? "student_stated"
          : "document_extracted_and_completed"
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
  /** The authored question this value answers (P255), when the field has one: the playback names it rather than the label (P256). */
  question?: string,
): string {
  const proposal = unwrapProposed(proposed);
  // ── P199: a country is shown as a country ───────────────────────────────
  //
  // The value stored is the ISO code, because the reviewed mapping sets are
  // keyed by it. Asking a student who typed *Iran* to confirm `IR` asks them
  // to agree to something they never said. So the code is shown WITH the
  // reviewed table's name for it — the same way the authorisation preview
  // already renders it (`Nationality: Iran  (sent as "IR")`) — and the value
  // being stored is still exactly what is displayed inside the brackets.
  // Faithful and readable, rather than faithful alone.
  const rendered = countryNameFor(key, proposal.value) ?? formatValue(proposal.value, key);
  const heard =
    proposal.origin === "conversation"
      ? proposal.documentId === undefined
        ? `You said: "${proposal.verbatim}"`
        : `From your document, with your answers: "${proposal.verbatim}"`
      : `From your document: "${proposal.verbatim}"`;

  // P256. "I've recorded your currently living in the uk as: true" was a
  // label in a template, and Vahid read it. A field with an authored
  // question is played back by that question; a composite or a list, whose
  // label is a noun — home address, employment history — by the label.
  const recorded =
    question === undefined
      ? `I've recorded your ${label.toLowerCase()} as: ${rendered}`
      : `To "${question.replace(/ Please answer yes or no\.$/, "")}" I've recorded: ${rendered}`;
  return `${heard}\n\n${recorded}\n\nIs that right?`;
}

/** One part of one entry, with where its value came from (P263). */
export interface ListPartProvenance {
  /** `item<n>.<partKey>`, as the walk keys it. */
  readonly partKey: string;
  readonly origin: ExtractionOrigin;
  readonly verbatim: string;
}

/**
 * A list played back one entry per message, each part named with where it
 * came from, and the question last (P263).
 *
 * Vahid, asked to confirm seven jobs he could not see: *"the text surface
 * needs the entries' content in the transcript before the buttons: each
 * entry, its parts, in the student's own words where they gave them and the
 * CV's where it did. That is what the table will show later, and the sentence
 * cannot stand in for it if it never says what was read."* ADR-0150.
 *
 * Why several messages and not one: the whole-list playback said every part
 * twice — once in a "From your document" line of every part's verbatim, once
 * in the recorded list — and seven ordinary jobs ran to 8,730 characters
 * against the store's bound of 8,000. The store refused the message after the
 * proposal was written, and the page showed buttons over nothing. Each entry
 * is one message; an entry whose parts alone pass the bound is said part by
 * part, never cut, because a value shown in part is not the value stored.
 *
 * `text` is every message joined, in order: the one text the proposal's
 * playback hash binds, so the student is agreeing to exactly what was said.
 */
export function renderListForConfirmation(
  key: ProfileFieldKey,
  entries: readonly unknown[],
  parts: readonly ListPartProvenance[],
  itemLabel: string,
  bound: number,
): { readonly messages: readonly string[]; readonly text: string } {
  if (entries.length === 0) {
    const single = `I've recorded your ${FIELD_LABELS[key].toLowerCase()} as: none\n\nIs that right?`;
    return { messages: [single], text: single };
  }
  const noun = entries.length === 1 ? itemLabel : `${itemLabel}s`;
  const messages: string[] = [];
  entries.forEach((entry, index) => {
    const heading = `${itemLabel.charAt(0).toUpperCase()}${itemLabel.slice(1)} ${String(index + 1)} of ${String(entries.length)}`;
    const lines = Object.entries((entry ?? {}) as Record<string, unknown>).map(([field, item]) => {
      const named = partLabel(key, field);
      const label = named ?? field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
      const spoken = typeof item === "string" ? vocabularyWords(key, field, item) : null;
      const shown = spoken ?? (named !== null && isCountryPart(field) && typeof item === "string" ? (countryNamed(item) ?? formatValue(item)) : formatValue(item, key));
      // The part named as the field, or the parts a field was assembled from
      // — `end` from `endKind` and `endDate` — each with where it came from.
      const prefix = `item${String(index)}.${field}`;
      const exact = parts.filter((part) => part.partKey === prefix);
      // `employer` must not collect `employerAddress`: the prefix rule applies
      // only to a field no part is named for, which is how `end` is assembled.
      const sources = exact.length > 0 ? exact : parts.filter((part) => part.partKey.startsWith(prefix) && /^[A-Z]/.test(part.partKey.slice(prefix.length)));
      const fromDocument = sources.filter((part) => part.origin === "document");
      const fromStudent = sources.filter((part) => part.origin === "conversation");
      const fromElsewhere = sources.length - fromDocument.length - fromStudent.length;
      const from =
        sources.length === 0
          ? ""
          : fromElsewhere > 0 && fromDocument.length === 0 && fromStudent.length === 0
            ? " (from what you told me earlier)"
            : fromStudent.length === 0
              ? " (from your CV)"
              : fromDocument.length === 0
                ? ` (you said: ${fromStudent.map((part) => JSON.stringify(part.verbatim)).join(", ")})`
                : ` (from your CV: ${fromDocument.map((part) => JSON.stringify(part.verbatim)).join(", ")}; you said: ${fromStudent.map((part) => JSON.stringify(part.verbatim)).join(", ")})`;
      return `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${shown}${from}`;
    });
    const whole = `${heading} — ${lines.join("; ")}`;
    if (whole.length <= bound) {
      messages.push(whole);
      return;
    }
    // Past the bound: the entry's name once, then its parts one by one. A
    // single part longer than the bound is still said whole; the store will
    // refuse it by name, which is louder than a value shown in part.
    messages.push(`${heading} —`);
    for (const line of lines) messages.push(line);
  });
  messages.push(`${entries.length === 1 ? "That is" : "Those are"} the ${String(entries.length)} ${noun}. Is that right?`);
  return { messages, text: messages.join("\n\n") };
}

/**
 * `Iran (IR)` for a country-typed field holding a code the reviewed table
 * knows; `null` for everything else, including a country field whose value is
 * not a code the table holds — which cannot happen through the interview and
 * must not be papered over if it ever does.
 */
function countryNameFor(key: ProfileFieldKey, value: unknown): string | null {
  if (!isCountryField(key) || typeof value !== "string") return null;
  const country = readCountry(value);
  return country === null ? null : `${country.name} (${country.code})`;
}

/**
 * Formats a value for display. Deterministic — never model-written.
 *
 * A value with parts is read by the parts' NAMES (P228, row 92): *Street: 12
 * Valiasr Street, Town: Tehran, Postcode: 1966733411, Country: Iran (IR)*,
 * never `line1: …, countryCode: IR`. The names are `PART_LABELS`', the same
 * table the interview asks with, so a student confirms the thing they were
 * asked for under the name they were asked for it by. A part that holds a
 * country code is shown as the country, as a country field is (P199). A
 * nested object with no table of names — the months and years of a visa, the
 * components of a test score — reads its own keys as words.
 */
function formatValue(value: unknown, key?: ProfileFieldKey): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // A yes or a no, as the student said it — never `true` (P256).
  if (typeof value === "boolean") return value ? "yes" : "no";
  // The shapes with no table of names, read the way a person says them
  // (P229): an amount of money, a month of a year, an end that is a kind and
  // maybe a date, a time in years and months.
  if (isMoney(value)) return money(value);
  if (isYearMonth(value)) return yearMonth(value);
  if (isKindAndDate(value)) return value.date === undefined ? value.kind : `${value.kind}, ${formatValue(value.date)}`;
  if (isYearsAndMonths(value)) return `${String(value.years)} years, ${String(value.months)} months`;
  // A list: "none" when empty — a student confirming an empty employment
  // history must see the word, not a blank after "as:" (ADR-0113 §3) — and
  // numbered otherwise, so a playback of three jobs reads as three.
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    return value.map((item, index) => `${String(index + 1)}) ${formatValue(item, key)}`).join("; ");
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([field, item]) => {
        const named = key === undefined ? null : partLabel(key, field);
        const label = named ?? field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
        const spoken = key !== undefined && typeof item === "string" ? vocabularyWords(key, field, item) : null;
        const shown = spoken ?? (named !== null && isCountryPart(field) && typeof item === "string"
          ? (countryNamed(item) ?? formatValue(item))
          : formatValue(item));
        return `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${shown}`;
      })
      .join(", ");
  }
  return String(value);
}

function isMoney(value: unknown): value is { amountMinorUnits: number; currency: string } {
  return typeof value === "object" && value !== null && "amountMinorUnits" in value && "currency" in value
    && typeof (value as { amountMinorUnits: unknown }).amountMinorUnits === "number"
    && typeof (value as { currency: unknown }).currency === "string";
}

/** "12,000.00 GBP": the amount as typed back, in the major unit, two places. */
function money(value: { amountMinorUnits: number; currency: string }): string {
  const major = Math.trunc(value.amountMinorUnits / 100);
  const minor = Math.abs(value.amountMinorUnits % 100);
  const grouped = major.toLocaleString("en-GB");
  return `${grouped}.${String(minor).padStart(2, "0")} ${value.currency}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function isYearMonth(value: unknown): value is { year: number; month: number } {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes("year") && keys.includes("month")
    && typeof (value as { year: unknown }).year === "number" && typeof (value as { month: unknown }).month === "number";
}

function yearMonth(value: { year: number; month: number }): string {
  return `${MONTHS[value.month - 1] ?? String(value.month)} ${String(value.year)}`;
}

function isKindAndDate(value: unknown): value is { kind: string; date?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  return typeof (value as { kind: unknown }).kind === "string"
    && (keys.length === 1 || (keys.length === 2 && keys.includes("date")));
}

function isYearsAndMonths(value: unknown): value is { years: number; months: number } {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes("years") && keys.includes("months")
    && typeof (value as { years: unknown }).years === "number" && typeof (value as { months: unknown }).months === "number";
}

function isCountryPart(partKey: string): boolean {
  return partKey === "countryCode" || partKey === "issuingCountry";
}

function countryNamed(code: string): string | null {
  const country = readCountry(code);
  return country === null ? null : `${country.name} (${country.code})`;
}
