/**
 * A student asking, in the chat, to correct an answer they have already
 * confirmed (P288, ADR-0154, row 134).
 *
 * Vahid, 2026-10-04: *"a confirmed answer cannot be changed in the chat. I
 * decided to correct mine three days ago and there was no way to do it … a
 * confirmed value should be correctable by asking, the same way a deletion is
 * asked for, with the correction played back and confirmed like any other."*
 *
 * Deterministic, and said so, as the deletion reader is: phrasings with tests
 * over them, not a model's reading. A correction names BOTH the answer as it
 * stands and what it should be — "my institution is Islamic Azad University,
 * not Azad University" — because the old words are how it finds the answer:
 * by its own text, never by a guess at which field a sentence is about. A
 * sentence that says something is wrong without both is asked about, never
 * acted on.
 *
 * Nothing here changes anything. What it reads is played back and confirmed
 * like any other answer (`RunDriver.answerStudent`), and a no leaves the
 * confirmed answer as it was.
 */

import { FIELD_SPECS, isComposite, isList, type FieldSpec } from "@askimate/aas-interview";
import { VOCABULARY_WORDS, isClosedVocabulary, isCountryField, isFinancialField, readCountry, readCountryCode } from "@askimate/aas-profile";
import type { ProfileFieldKey } from "@askimate/aas-profile";

export type CorrectionReading =
  /** Both halves: the answer as it stands (`from`), what it should be (`to`), and the words before them (`context`). */
  | { readonly kind: "request"; readonly from: string; readonly to: string; readonly context: string }
  /** A correction is asked for, but not both halves of one: asked back, never guessed. */
  | { readonly kind: "unclear" }
  /** Not a correction. */
  | { readonly kind: "not_a_request" };

const VERB = String.raw`(?:is|was|are|were|should be|should have been|ought to be|it'?s|it is|i meant|meant to be)`;

/**
 * The shapes a correction takes, each read to `from` and `to`. In order: the
 * first that matches is the reading. Every one needs both halves.
 */
const SHAPES: readonly { readonly pattern: RegExp; readonly read: (match: RegExpExecArray) => { context: string; from: string; to: string } }[] = [
  // "my institution is Islamic Azad University, not Azad University" — the
  // LAST verb before the new value, so "this is wrong: my institution is X,
  // not Y" reads X, not "wrong: my institution is X".
  { pattern: new RegExp(String.raw`^(.*)\b${VERB}\s+(.+?),?\s+(?:and\s+)?not\s+(.+)$`, "i"), read: (m) => ({ context: m[1] ?? "", to: m[2] ?? "", from: m[3] ?? "" }) },
  // "not Azad University but Islamic Azad University", "not Y, it's X"
  { pattern: /^(.*?)\bnot\s+(.+?),?\s+(?:but|it'?s|it is)\s+(.+)$/i, read: (m) => ({ context: m[1] ?? "", from: m[2] ?? "", to: m[3] ?? "" }) },
  // "change my institution from Azad University to Islamic Azad University", "change Y to X"
  { pattern: /^(.*?)\b(?:change|correct|update|amend|fix)\s+(?:(.*?)\bfrom\s+)?(.+?)\s+to\s+(.+)$/i, read: (m) => ({ context: `${m[1] ?? ""} ${m[2] ?? ""}`, from: m[3] ?? "", to: m[4] ?? "" }) },
  // "replace Azad University with Islamic Azad University"
  { pattern: /^(.*?)\breplace\s+(.+?)\s+with\s+(.+)$/i, read: (m) => ({ context: m[1] ?? "", from: m[2] ?? "", to: m[3] ?? "" }) },
];

/** Words that say an answer is wrong, without saying what it should be. */
const SAYS_WRONG = [
  /\b(?:is|was|are|were)\s+wrong\b/i,
  /\bmade\s+a\s+mistake\b/i,
  /\bmis-?typed\b/i,
  /\btypo\b/i,
  /\b(?:want|like|need|have)\s+to\s+(?:change|correct|fix|amend|update)\b/i,
  /\bcan\s+i\s+(?:change|correct|fix|amend|update)\b/i,
  /\bcorrect\s+(?:my|an|the|one of my)\s+answers?\b/i,
];

const NEGATED = /\b(?:not|isn'?t|wasn'?t|nothing(?:'s| is)?)\s+(?:wrong|a mistake|a typo)\b|\bdon'?t\s+(?:change|correct|fix)\b/i;

/** The value as written: its own words, without the quotes or the full stop around them. */
function cleaned(value: string): string {
  return value
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[\s.!?;]+$/u, "")
    .replace(/,?\s+please$/i, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

/** What a student's message reads as, about correcting a confirmed answer. */
export function readCorrectionRequest(text: string): CorrectionReading {
  const said = text.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  if (said.length === 0 || NEGATED.test(said)) return { kind: "not_a_request" };
  for (const shape of SHAPES) {
    const match = shape.pattern.exec(said);
    if (match === null) continue;
    const read = shape.read(match);
    const from = cleaned(read.from);
    const to = cleaned(read.to);
    // Both halves, each short enough to be an answer and not a paragraph,
    // and different from each other: "X, not X" changes nothing.
    if (from.length === 0 || to.length === 0 || from.length > 200 || to.length > 200) continue;
    if (sameWords(from, to)) continue;
    return { kind: "request", from, to, context: read.context.trim() };
  }
  return SAYS_WRONG.some((pattern) => pattern.test(said)) ? { kind: "unclear" } : { kind: "not_a_request" };
}

/** Two answers are the same answer when they read the same, letter case and spacing aside. */
export function sameWords(a: string, b: string): boolean {
  const flat = (value: string): string => cleaned(value).replace(/\s+/g, " ").toLowerCase();
  return flat(a) === flat(b);
}

/** Where a confirmed answer holds the words being corrected: a field, and for a list its entry and part. */
export interface CorrectionTarget {
  readonly fieldKey: string;
  /** The entry of a list, from 0 — absent for a field that is not a list. */
  readonly item?: number;
  /** The part of a composite or of a list's entry — absent for a plain field. */
  readonly part?: string;
}

/**
 * Every place among the confirmed answers that holds exactly `from`, letter
 * case and spacing aside: the stored words, and nothing else. The row-134
 * stop names an entry's exact text by it. A correction finds its answer with
 * `placesSaying`, which also knows a closed list by its shown words (P311).
 * A date or a number is not text, and is found by neither (ADR-0154 §5).
 */
export function placesHolding(confirmed: ReadonlyMap<string, unknown>, from: string): readonly CorrectionTarget[] {
  const found: CorrectionTarget[] = [];
  for (const [fieldKey, value] of confirmed) {
    if (typeof value === "string") {
      if (sameWords(value, from)) found.push({ fieldKey });
    } else if (Array.isArray(value)) {
      value.forEach((entry, item) => {
        if (entry === null || typeof entry !== "object") return;
        for (const [part, held] of Object.entries(entry as Record<string, unknown>)) {
          if (typeof held === "string" && sameWords(held, from)) found.push({ fieldKey, item, part });
        }
      });
    } else if (value !== null && typeof value === "object") {
      for (const [part, held] of Object.entries(value as Record<string, unknown>)) {
        if (typeof held === "string" && sameWords(held, from)) found.push({ fieldKey, part });
      }
    }
  }
  return found;
}

/**
 * A closed list a correction can read (P311): a country, a token of a closed
 * vocabulary, or a part the interview takes only from its own table (a
 * qualification's level). Vahid, 2026-10-14: *"a correction to a fixed-choice
 * part (grade scale, and any other closed list) must work. Match the words the
 * student is shown ("UK honours"), never only the internal token, and when the
 * new value is a fixed choice, take it only if it is one of the set."*
 */
export interface ClosedPart {
  /** The words the student is shown for a value of the set, or `null` for one that is not (a grade scale kept in the student's own words, P297). */
  readonly shown: (held: string) => string | null;
  /** The student's words read into a value, by the interview's own reader and the shown words; `null` when they name no value it takes. */
  readonly read: (words: string) => string | null;
  /** The set in the words the student is shown, for a refusal; `null` where it is too long to list (countries). */
  readonly choices: readonly string[] | null;
}

/** The interview's own reader for a field, or for one of its parts (`FIELD_SPECS`). */
function interviewReader(fieldKey: string, part: string | undefined): ((raw: string) => unknown) | null {
  const spec = (FIELD_SPECS as Partial<Record<string, FieldSpec<unknown>>>)[fieldKey];
  if (spec === undefined) return null;
  if (part === undefined) return isComposite(spec) || isList(spec) ? null : spec.parse;
  const parts = isList(spec) ? spec.item.parts : isComposite(spec) ? spec.parts : [];
  return parts.find((candidate) => candidate.partKey === part)?.parse ?? null;
}

/** The words a country is shown in, as the playback writes them: "Iran (IR)". */
function countryShown(code: string): string | null {
  const country = readCountry(code);
  return country === null ? null : `${country.name} (${country.code})`;
}

/** A country from a name, a code, or the playback's "Iran (IR)" — whose two halves must agree. */
function readCountryWords(words: string): string | null {
  const shownForm = /^(.+?)\s*\(([A-Za-z]{2})\)$/u.exec(words.trim());
  if (shownForm === null) return readCountryCode(words);
  const byName = readCountryCode(shownForm[1] ?? "");
  return byName !== null && byName === readCountryCode(shownForm[2] ?? "") ? byName : null;
}

/**
 * The closed list a place holds, or `null` for a place that holds the
 * student's own words. Read by the interview's own reader, so a correction
 * takes exactly what the question takes, and by the shown words too, because
 * a student corrects what they were shown (`finance.funding`'s "a loan" is
 * not a word its question takes).
 */
export function closedPart(fieldKey: string, part: string | undefined): ClosedPart | null {
  const key = fieldKey as ProfileFieldKey;
  if ((part === undefined && isCountryField(key)) || part === "countryCode") {
    return { shown: countryShown, read: readCountryWords, choices: null };
  }
  if (part === undefined) return null;
  const reader = interviewReader(fieldKey, part);
  const table = (VOCABULARY_WORDS as Partial<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>>)[fieldKey]?.[part];
  if (table !== undefined && isClosedVocabulary(key, part)) {
    const byShown = new Map(Object.entries(table).map(([token, words]) => [flat(words), token]));
    return {
      shown: (held) => table[held] ?? null,
      read: (words) => {
        const read = reader?.(words);
        if (typeof read === "string") return read;
        // The shown words, and the token itself if a student types it.
        return byShown.get(flat(words)) ?? (table[words.trim()] !== undefined ? words.trim() : null);
      },
      choices: Object.values(table),
    };
  }
  // A part held as words but taken only from the interview's own table.
  const options = (reader as { readonly options?: Readonly<Record<string, string>> } | null)?.options;
  if (reader === null || options === undefined) return null;
  const choices = [...new Set(Object.values(options))];
  return {
    shown: (held) => (choices.includes(held) ? held : null),
    read: (words) => {
      const read = reader(words);
      return typeof read === "string" ? read : null;
    },
    choices,
  };
}

/**
 * A place a correction does not change from words (P311), and why.
 *
 * - `financial`: a choice in a financial answer. The mandatory review of
 *   financial evidence is done once, before the preview, and a correction
 *   after it would not be reviewed again (it touches money, so it is his to
 *   decide). Refused as before P311.
 * - `decides_the_shape`: a `kind` that decides what else the answer holds —
 *   a passport held or not — which no part can be changed without.
 */
export function refusedPart(place: CorrectionTarget): "financial" | "decides_the_shape" | null {
  if (place.part === "kind") return "decides_the_shape";
  if (isFinancialField(place.fieldKey as ProfileFieldKey) && closedPart(place.fieldKey, place.part) !== null) return "financial";
  return null;
}

/** A value's words for matching, as `sameWords` compares them. */
function flat(value: string): string {
  return cleaned(value).replace(/\s+/g, " ").toLowerCase();
}

/**
 * Every place among the confirmed answers that says `from` (P311): holds it
 * as words, as `placesHolding` finds them, or holds a value of a closed list
 * that `from` names — by the words the student was shown for it, or by the
 * interview's own reader. The token alone is never all a student has.
 */
export function placesSaying(confirmed: ReadonlyMap<string, unknown>, from: string): readonly CorrectionTarget[] {
  const says = (fieldKey: string, part: string | undefined, held: string): boolean => {
    if (sameWords(held, from)) return true;
    const closed = closedPart(fieldKey, part);
    if (closed === null) return false;
    const shown = closed.shown(held);
    return (shown !== null && sameWords(shown, from)) || (shown !== null && closed.read(from) === held);
  };
  const found: CorrectionTarget[] = [];
  for (const [fieldKey, value] of confirmed) {
    if (typeof value === "string") {
      if (says(fieldKey, undefined, value)) found.push({ fieldKey });
    } else if (Array.isArray(value)) {
      value.forEach((entry, item) => {
        if (entry === null || typeof entry !== "object") return;
        for (const [part, held] of Object.entries(entry as Record<string, unknown>)) {
          if (typeof held === "string" && says(fieldKey, part, held)) found.push({ fieldKey, item, part });
        }
      });
    } else if (value !== null && typeof value === "object") {
      for (const [part, held] of Object.entries(value as Record<string, unknown>)) {
        if (typeof held === "string" && says(fieldKey, part, held)) found.push({ fieldKey, part });
      }
    }
  }
  return found;
}

/** The words of a sentence worth matching: three letters or more, a possessive's "'s" set aside. */
function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/'s\b/g, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !COMMON.has(word)),
  );
}

const COMMON = new Set(["the", "and", "not", "but", "for", "with", "from", "that", "this", "was", "are", "were", "should", "have", "been", "change", "correct", "update", "amend", "fix", "replace", "answer", "said"]);

/** How many words of the sentence name this place: its entry's other words, and its own labels. */
function scoreOf(
  target: CorrectionTarget,
  confirmed: ReadonlyMap<string, unknown>,
  said: ReadonlySet<string>,
  wordsFor: (target: CorrectionTarget) => readonly string[],
): number {
  const value = confirmed.get(target.fieldKey);
  const entry: unknown = target.item === undefined ? value : Array.isArray(value) ? (value as readonly unknown[])[target.item] : undefined;
  const others =
    entry !== null && typeof entry === "object"
      ? Object.entries(entry as Record<string, unknown>).filter(([part, held]) => part !== target.part && typeof held === "string").map(([, held]) => held as string)
      : [];
  const theirs = wordsOf([...others, ...wordsFor(target)].join(" "));
  return [...said].filter((word) => theirs.has(word)).length;
}

/**
 * The places a correction may be about (P311), before one is named.
 *
 * The stored words first: a town called Singapore is the town, not the
 * country `SG` that the same word names through the country table. Only
 * when no answer holds the words is a closed list found by the words it is
 * shown in. And while a question is open, a place found that way must be
 * named by the sentence too, so "It's Iraq, not Iran" stays the answer to
 * the question it answers rather than a change to a confirmed nationality.
 */
export function placesToCorrect(input: {
  readonly confirmed: ReadonlyMap<string, unknown>;
  readonly from: string;
  readonly context: string;
  readonly answering: boolean;
  readonly wordsFor: (target: CorrectionTarget) => readonly string[];
}): readonly CorrectionTarget[] {
  const stored = placesHolding(input.confirmed, input.from);
  if (stored.length > 0) return stored;
  const shown = placesSaying(input.confirmed, input.from);
  if (!input.answering) return shown;
  const said = wordsOf(input.context);
  return shown.filter((place) => scoreOf(place, input.confirmed, said, input.wordsFor) > 0);
}

/**
 * Of several places holding the same words, the one the rest of the sentence
 * names — "my MASTER'S institution" — by the other words of that entry or
 * field. One place, or none: two that the sentence names equally are asked
 * about, never chosen between.
 */
export function namedPlace(
  places: readonly CorrectionTarget[],
  confirmed: ReadonlyMap<string, unknown>,
  context: string,
  wordsFor: (target: CorrectionTarget) => readonly string[],
): CorrectionTarget | null {
  if (places.length === 1) return places[0] ?? null;
  const said = wordsOf(context);
  const scored = places.map((target) => ({ target, score: scoreOf(target, confirmed, said, wordsFor) }));
  const best = Math.max(...scored.map((one) => one.score));
  const top = scored.filter((one) => one.score === best);
  return best > 0 && top.length === 1 ? (top[0]?.target ?? null) : null;
}
