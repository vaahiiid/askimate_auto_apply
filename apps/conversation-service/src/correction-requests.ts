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
 * case and spacing aside. Only words a student gave as words can be found
 * this way: a date, a number or a choice from a fixed list is not text, and
 * is not offered (ADR-0154 §4).
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
  const scored = places.map((target) => {
    const value = confirmed.get(target.fieldKey);
    const entry: unknown = target.item === undefined ? value : Array.isArray(value) ? (value as readonly unknown[])[target.item] : undefined;
    const others =
      entry !== null && typeof entry === "object"
        ? Object.entries(entry as Record<string, unknown>).filter(([part, held]) => part !== target.part && typeof held === "string").map(([, held]) => held as string)
        : [];
    const theirs = wordsOf([...others, ...wordsFor(target)].join(" "));
    return { target, score: [...said].filter((word) => theirs.has(word)).length };
  });
  const best = Math.max(...scored.map((one) => one.score));
  const top = scored.filter((one) => one.score === best);
  return best > 0 && top.length === 1 ? (top[0]?.target ?? null) : null;
}
