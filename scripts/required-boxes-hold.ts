/**
 * Does every answer the interview accepts either fill each box of a signed
 * entry, or get asked about there and then? (P317, measured before anything is
 * built.)
 *
 * Vahid, 2026-10-16 (docs/run-a/p317-his-message-as-sent.txt): *"for every
 * required box in a signed entry, every answer the interview accepts must
 * either produce a value that satisfies the box, or lead the interview to ask
 * the follow-up there and then, never a stop after the plan is complete. A test
 * checks this for every signed entry and every accepted answer."*
 *
 * Deterministic: no model, no network, nothing written. For every entry the
 * signed catalogue admits (docs/run-a/catalogue, loaded as the run loads it),
 * for every profile field its mappings read, it builds the answers the
 * interview accepts for that field and plans Run A's synthetic profile with
 * each one put in, through the run's own planner, validator, part policy and
 * choice offer. What each answer meets is put in one class:
 *
 *   - breaks a required box: a violation the validator finds only once the
 *     plan has no blockers left, so after the interview; the run's next
 *     advance stops for a person (`fix_content`, `specialist:content_rejected`);
 *     the rule's own case, and his run's stop;
 *   - breaks another box: the same stop, on a box the entry does not require
 *     (`fix_content` is raised for a violation on any box);
 *   - held but unreadable: a value_unavailable blocker on the field just
 *     answered, which the interview never asks again;
 *   - refused by the map: any other blocker on the answer (a value the form's
 *     list does not hold and no list is on file to offer, a part the map needs
 *     and the answer has not, a list longer than the form's rows); the
 *     orchestrator returns a person's step for it as soon as the answer is
 *     confirmed, ahead of every unanswered field, and the run's next advance
 *     stops it for a person; nothing else is asked in between;
 *   - offered from the form's list: such a blocker the run settles by showing
 *     the student the form's own list (P290, ADR-0155), read by the run's own
 *     `entryChoiceOffer` on a plan holding that blocker alone, at the same
 *     moment; this holds the rule;
 *   - offered, but the escape cannot take the words: the same offer, whose
 *     escape would type the student's own words into a box too short for them
 *     (the offer's own `tooLong`), so choosing it still stops after the plan;
 *   - not one of the box's options: a select the plan fills with a text that
 *     is no option's value (a radio: no member's value, nor its label where
 *     every member's value is empty), as the browser runner matches them. The
 *     validator does not check this (packages/preparation/src/validate.ts), so
 *     the plan completes, the student authorises it, and the fill fails at the
 *     box as `portal_drift`; the page is tried once more, then stopped for a
 *     person. A box whose options load after another box's choice
 *     (`optionsAfter`) is not checked, because its list is not in the entry.
 *
 * How the accepted answers are built, and what that cannot see:
 *   - A part with a closed word table (`oneOf`): every value of the table. A
 *     yes-or-no part: yes and no. A country part (one that reads "Iran" as IR
 *     and refuses "Example"): every code in the reviewed table.
 *   - Any other part: the probes below, and the words of the part's own
 *     question and expected shape cut at commas and "or" (so a part is offered
 *     the answers its question names), passed through the part's own parser.
 *     Of text it keeps the shortest and the longest accepted, "Example", and
 *     the question's own words; of anything else, every value. A text limit is
 *     found only up to the longest probe (4,000 characters); a shape neither
 *     the probes nor the question's words reach is not seen, and the report
 *     names each part that was never varied, so its silence is not read as a
 *     pass.
 *   - Which parts are asked, and which refuse "none", come from the run's own
 *     `partPolicyFor` (ADR-0148 §4): an optional part no box reads is never
 *     asked, and one a required box reads refuses "none".
 *   - A composite: the base is Run A's synthetic profile's own answer, taken
 *     apart into the parts that assemble it (`baseParts`); the report says
 *     whether the parts put back together give that answer exactly. From it,
 *     one part is varied at a time, and every pair in which one part has at
 *     most twelve accepted values (a closed list, a yes-or-no, or a text
 *     part's few kept answers) and the other is varied over at most twelve
 *     spread over its list, plus, for a country, the short list below (up to
 *     nineteen, the United Kingdom first), and "left out" where it may be; so
 *     a part an earlier answer opens is varied with the answer that opens it. Three or more parts varied at
 *     once are not built. A part the base does not hold, opened by a varied
 *     answer, takes a filler: "Example" where the part accepts it, the United
 *     Kingdom for a country.
 *   - A list: no entries, one entry for each composite answer, and five copies
 *     of the profile's first entry. Two entries that differ are not built.
 *   - A field whose every box the base hides (its section shown only for
 *     another answer) is measured again under each value of another field, of
 *     at most twelve values or a country in a short list, that shows one of
 *     its boxes; the report names the opener.
 *   - A field the interview has no spec for is listed, not measured.
 *
 * Usage: tsx scripts/required-boxes-hold.ts [catalogue-directory]
 *        tsx scripts/required-boxes-hold.ts --answers <fieldKey>
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadCatalogueDirectory } from "@askimate/aas-catalogue";
import { FIELD_SPECS, isComposite, isList } from "@askimate/aas-interview";
import { checkUsable, planFill, textOf } from "@askimate/aas-mapping";
import type { FillBlocker } from "@askimate/aas-mapping";
import { partPolicyFor } from "@askimate/aas-orchestrator";
import { validatePlan } from "@askimate/aas-preparation";
import type { Violation } from "@askimate/aas-preparation";
import { COUNTRIES, decodeValue, encodeValue, rehydrateProfile } from "@askimate/aas-profile";
import type { ConfirmedProfile, StoredProfileEntry } from "@askimate/aas-profile";

import { entryChoiceOffer } from "../apps/conversation-service/src/entry-choice-offer.js";
import { readFixture } from "./profile-seed.js";

const ROOT = join(import.meta.dirname, "..");
const NOW = new Date("2026-10-16T12:00:00Z");

type Parse = ((raw: string) => unknown) & { readonly options?: Readonly<Record<string, unknown>> };

interface Part {
  readonly partKey: string;
  readonly parse: Parse;
  readonly optional?: boolean;
  readonly feeds?: string;
  readonly question?: string;
  readonly expectedShape?: string;
  readonly askWhen?: (answered: ReadonlyMap<string, unknown>) => boolean;
}

interface Composite {
  readonly parts: readonly Part[];
  readonly assemble: (answered: ReadonlyMap<string, unknown>) => unknown;
}

interface Entry {
  readonly blueprint: unknown;
  readonly mappingSet: unknown;
}

const LENGTHS = [1, 2, 3, 10, 28, 29, 30, 31, 35, 36, 50, 51, 58, 59, 79, 80, 95, 96, 100, 101, 118, 119, 120, 121, 190, 191, 200, 201, 250, 251, 1000, 4000];
const WORDS = "Abcdefghij";
const wordsOf = (length: number): string => Array.from({ length }, (_, i) => (i % 9 === 8 ? " " : WORDS[i % WORDS.length])).join("").replace(/\s+$/u, "x");
const withDigit = (length: number): string => `A1${"B".repeat(Math.max(0, length - 2))}`.slice(0, Math.max(2, length));

/** Strings any part might take: words, numbers, dates at both ends of a form's year lists, the student's "there is none". */
const PROBES: readonly string[] = [
  "yes", "no", "none", "GB", "IR", "United Kingdom", "Iran",
  "May 2023", "2023-05", "1900-01", "1950-01", "1956-06", "1960-01", "2031-06",
  "2023-05-14", "14/05/2023", "1990-01-31", "2027-09-30", "2031-01-15", "1939-12-31", "1900-01-01",
  "2023", "2019", "1", "20", "19.7", "4.0", "3.5", "100", "85",
  "6 months", "18 months", "1 year", "13 years", "2 years 3 months",
  "Example", "Example Ltd", "1 Example Way", "Sheffield", "S10 2TN", "AB1234567", "a@example.org", "+44 7700 900000",
  ...LENGTHS.map(wordsOf), ...LENGTHS.map(withDigit),
];

/** Words that open a question, not an answer: a piece starting with one is the question's own sentence. */
const ASKING = new Set(["what", "how", "which", "when", "who", "where", "why", "do", "does", "did", "is", "are", "was", "were", "have", "has", "please"]);

/** The answers a question names, cut from its own words: "school, foundation, or other?" gives each. */
function namedIn(text: string | undefined): readonly string[] {
  if (text === undefined) return [];
  return text
    .split(/[,;?—()]|\bor\b/u)
    .map((piece) => piece.replace(/^\s*(e\.g\.|for example|one of:|such as)\s*/iu, "").trim())
    .filter((piece) => piece.length > 0 && piece.length <= 60 && !ASKING.has(piece.split(/\s+/u)[0]?.toLowerCase() ?? ""));
}

const COUNTRY_CODES: readonly string[] = COUNTRIES.map((country) => country.code);

/** A value for a part the base does not hold: plain words before a probe's edge. */
const FILLERS: readonly string[] = ["Example", "GB", "May 2023", "2027-09-30", "20", "yes"];

/** Countries tried as another field's value to show a hidden section: few, and the form's own country first. */
const OPENING_COUNTRIES: readonly string[] = ["GB", "IE", "FR", "US", "IN", "CN", "IR"];

interface Candidates {
  readonly values: readonly unknown[];
  /** The student may leave it out: optional, and no required box reads it. */
  readonly omittable: boolean;
  /** No box reads it and it is optional: the interview never asks it. */
  readonly unasked: boolean;
  readonly filler: unknown;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(encodeValue(a)) === JSON.stringify(encodeValue(b));

type PartPolicy = { readonly asked: ReadonlySet<string> | "all"; readonly required: ReadonlySet<string> };

/** What a part accepts, as the interview's own parser reads it, under the run's own part policy. */
function candidatesOf(part: Part, policy: PartPolicy | undefined): Candidates {
  const read = part.feeds ?? part.partKey;
  const required = policy !== undefined && policy.required.has(read);
  const asked = part.optional !== true || policy === undefined || policy.asked === "all" || policy.asked.has(read);
  const omittable = part.optional === true && !required;
  const values = acceptedBy(part);
  const filler = FILLERS.map((probe) => part.parse(probe)).find((value) => value !== null && value !== undefined && values.some((held) => same(held, value)));
  return { values: asked ? values : [], omittable, unasked: !asked, filler: filler ?? values[0] };
}

function acceptedBy(part: Part): readonly unknown[] {
  const parse = part.parse;
  if (parse.options !== undefined) return [...new Set(Object.values(parse.options))];
  if (parse("yes") === true && parse("no") === false) return [true, false];
  // A country part reads a name to its code and refuses other words; free text keeps "GB" as typed.
  if (parse("Iran") === "IR" && parse("Example") === null) return COUNTRY_CODES.filter((code) => parse(code) === code);
  const own = [...namedIn(part.question), ...namedIn(part.expectedShape)];
  const accepted = new Map<string, unknown>();
  const fromOwnWords = new Set<string>();
  for (const probe of [...PROBES, ...own]) {
    const value = parse(probe);
    if (value === null || value === undefined) continue;
    const key = JSON.stringify(encodeValue(value));
    accepted.set(key, value);
    if (own.includes(probe)) fromOwnWords.add(key);
  }
  const values = [...accepted.entries()];
  const strings = values.filter(([, value]) => typeof value === "string").sort(([, a], [, b]) => String(a).length - String(b).length);
  const others = values.filter(([, value]) => typeof value !== "string").map(([, value]) => value);
  // Text: the shortest and the longest accepted, which is where a box's rules bite; "Example"; and
  // the answers the question itself names, which is how a level list without a table is reached.
  const kept = new Map<string, unknown>();
  const shortest = strings[0];
  const longest = strings[strings.length - 1];
  if (shortest !== undefined) kept.set(shortest[0], shortest[1]);
  if (longest !== undefined) kept.set(longest[0], longest[1]);
  for (const [key, value] of strings) if (value === "Example" || fromOwnWords.has(key)) kept.set(key, value);
  return [...kept.values(), ...others];
}

/** Every leaf and every object inside a stored answer, as values a part could hold. */
function piecesOf(value: unknown, out: unknown[] = []): unknown[] {
  out.push(value);
  if (value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) for (const inner of Object.values(value)) piecesOf(inner, out);
  return out;
}

/** How many leaves two answers share, path and value alike; a refused assembly scores below any. */
function likeness(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return -1;
  const leaves = (value: unknown, prefix: string, out: Map<string, string>): Map<string, string> => {
    if (value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      for (const [key, inner] of Object.entries(value)) leaves(inner, prefix === "" ? key : `${prefix}.${key}`, out);
    } else out.set(prefix, JSON.stringify(encodeValue(value)));
    return out;
  };
  const left = leaves(a, "", new Map());
  const right = leaves(b, "", new Map());
  let shared = 0;
  for (const [path, held] of left) if (right.get(path) === held) shared += 1;
  return shared - 0.01 * (left.size + right.size - 2 * shared);
}

/** A part the base leaves out, as the student's "none" would. */
const LEFT_OUT = Symbol("left out");

/** Whether a part could have produced a held value: its own parser gives it back, or it is one of its values. */
function couldGive(part: Part, values: readonly unknown[], held: unknown): boolean {
  if (typeof held === "string" && same(part.parse(held), held)) return true;
  return values.some((value) => same(value, held));
}

type Option = { readonly part: Part } & Candidates;

/**
 * The parts that put the profile's own answer back together: a part named as a
 * key of the answer starts from that key's value where the part could have
 * given it (a stored "studied" is not what the part's "held" reads as), every
 * other part from its filler; then each part in turn takes whichever of its
 * accepted values, of the answer's own pieces, or leaving it out, brings the
 * assembly closest, two passes in the interview's order.
 */
function baseParts(spec: Composite, options: readonly Option[], own: unknown): { readonly parts: ReadonlyMap<string, unknown>; readonly exact: boolean } {
  const held = own !== null && typeof own === "object" && !Array.isArray(own) ? (own as Record<string, unknown>) : {};
  const pieces = own === undefined ? [] : piecesOf(own);
  const chosen = new Map<string, unknown>();
  for (const { part, values, filler, unasked } of options) {
    if (unasked) chosen.set(part.partKey, LEFT_OUT);
    else chosen.set(part.partKey, part.partKey in held && couldGive(part, values, held[part.partKey]) ? held[part.partKey] : filler);
  }
  const assembleFrom = (parts: ReadonlyMap<string, unknown>): unknown => {
    const answered = new Map<string, unknown>();
    for (const { part } of options) {
      if (part.askWhen !== undefined && !part.askWhen(answered)) continue;
      const value = parts.get(part.partKey);
      if (value !== undefined && value !== LEFT_OUT) answered.set(part.partKey, value);
    }
    return spec.assemble(answered);
  };
  if (own !== undefined) {
    for (let pass = 0; pass < 2; pass += 1) {
      for (const { part, values, omittable, unasked } of options) {
        if (unasked) continue;
        let best = chosen.get(part.partKey);
        let bestScore = likeness(assembleFrom(chosen), own);
        for (const value of [...pieces, ...values, ...(omittable ? [LEFT_OUT] : [])]) {
          const trial = new Map(chosen).set(part.partKey, value);
          const score = likeness(assembleFrom(trial), own);
          if (score > bestScore) {
            best = value;
            bestScore = score;
          }
        }
        chosen.set(part.partKey, best);
      }
    }
  }
  const exact = own !== undefined && same(assembleFrom(chosen), own);
  return { parts: chosen, exact };
}

/**
 * At most `limit` values, spread over the list, the first and the last kept: what a pair varies
 * the second part over. A list of countries keeps the short list of OPENING_COUNTRIES first, so
 * the form's own country is always paired (a UK address with each postcode answer).
 */
function sampleOf(values: readonly unknown[], limit: number): readonly unknown[] {
  if (values.length <= limit) return values;
  const step = (values.length - 1) / (limit - 1);
  const spread = Array.from({ length: limit }, (_, i) => values[Math.round(i * step)]);
  const countries = OPENING_COUNTRIES.filter((code) => values.includes(code));
  return [...new Set([...countries, ...spread])];
}

const SMALL = 12;

interface Answer {
  readonly what: string;
  readonly value: unknown;
}

/** Every answer a composite accepts: one part varied, then pairs, from the profile's own answer. */
function compositeAnswers(spec: Composite, policy: PartPolicy | undefined, own: unknown): { readonly answers: readonly Answer[]; readonly exact: boolean; readonly neverVaried: readonly string[] } {
  const options: readonly Option[] = spec.parts.map((part) => ({ part, ...candidatesOf(part, policy) }));
  const base = baseParts(spec, options, own);
  const varied = new Set<string>();
  // The walk: each part in order, asked only when its askWhen holds; `set` holds the varied parts' values.
  const walk = (set: ReadonlyMap<string, unknown>): { readonly answered: ReadonlyMap<string, unknown>; readonly asked: ReadonlySet<string> } | null => {
    const answered = new Map<string, unknown>();
    const asked = new Set<string>();
    for (const { part, omittable, filler, unasked } of options) {
      if (part.askWhen !== undefined && !part.askWhen(answered)) continue;
      if (unasked) continue;
      const value = set.has(part.partKey) ? set.get(part.partKey) : base.parts.get(part.partKey);
      if (set.has(part.partKey)) asked.add(part.partKey);
      if (value === LEFT_OUT && omittable) continue;
      const given = value === undefined || value === LEFT_OUT ? filler : value;
      if (given === undefined) {
        if (omittable) continue;
        return null;
      }
      answered.set(part.partKey, given);
    }
    return { answered, asked };
  };
  const out = new Map<string, Answer>();
  const add = (what: string, set: ReadonlyMap<string, unknown>): void => {
    const walked = walk(set);
    if (walked === null) return;
    const value = spec.assemble(walked.answered);
    if (value === null || value === undefined) return;
    for (const [partKey, given] of set) if (walked.asked.has(partKey) && !same(given, base.parts.get(partKey))) varied.add(partKey);
    const key = JSON.stringify(encodeValue(value));
    if (!out.has(key)) out.set(key, { what, value });
  };
  const show = (value: unknown): string => (value === LEFT_OUT ? "left out" : JSON.stringify(encodeValue(value)));
  add("base", new Map());
  for (const { part, values, omittable } of options) {
    for (const value of values) add(`${part.partKey}=${show(value)}`, new Map([[part.partKey, value]]));
    if (omittable) add(`${part.partKey} left out`, new Map([[part.partKey, LEFT_OUT]]));
  }
  // Pairs: a part of few values (a closed list, a yes-or-no) with every other part, so a part an
  // earlier answer opens is varied with the answer that opens it.
  for (const first of options) {
    if (first.values.length === 0 || first.values.length > SMALL) continue;
    for (const one of first.values) {
      if (same(one, base.parts.get(first.part.partKey))) continue;
      for (const second of options) {
        if (second === first) continue;
        for (const two of [...sampleOf(second.values, SMALL), ...(second.omittable ? [LEFT_OUT] : [])]) {
          add(`${first.part.partKey}=${show(one)}, ${second.part.partKey}=${show(two)}`, new Map([[first.part.partKey, one], [second.part.partKey, two]]));
        }
      }
    }
  }
  const neverVaried = options.filter(({ part, values, unasked }) => !unasked && values.length > 1 && !varied.has(part.partKey)).map(({ part }) => part.partKey);
  return { answers: [...out.values()], exact: base.exact, neverVaried };
}

function policyOf(entry: Entry): ReadonlyMap<string, PartPolicy> {
  const check = checkUsable(entry.mappingSet as Parameters<typeof checkUsable>[0], entry.blueprint as Parameters<typeof planFill>[0]);
  if (!check.usable) throw new Error(`the mapping set is not usable: ${check.refusal.detail}`);
  return partPolicyFor(entry.blueprint as Parameters<typeof partPolicyFor>[0], check.mappingSet);
}

interface Mapping {
  readonly fieldRef: string;
  readonly source: { readonly kind: string; readonly fieldKey?: string; readonly format?: unknown };
}

function mappingsOf(entry: { readonly mappingSet: unknown }): readonly Mapping[] {
  return (entry.mappingSet as { readonly mappings: readonly Mapping[] }).mappings;
}

interface Box {
  readonly fieldRef: string;
  readonly inputType: string;
  readonly validations: readonly { readonly kind: string }[];
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

function boxesOf(entry: { readonly blueprint: unknown }): readonly Box[] {
  const pages = (entry.blueprint as { readonly pages: readonly { readonly sections: readonly { readonly fields: readonly Box[] }[] }[] }).pages;
  return pages.flatMap((page) => page.sections.flatMap((section) => section.fields));
}

function requiredBoxes(entry: { readonly blueprint: unknown }): ReadonlySet<string> {
  return new Set(boxesOf(entry).filter((box) => box.validations.some((rule) => rule.kind === "required")).map((box) => box.fieldRef));
}

const BASE = (() => {
  const base = readFixture(readFileSync(join(ROOT, "docs", "run-a", "synthetic-profile.json"), "utf8"));
  if (!base.ok) throw new Error(`the synthetic profile does not read: ${JSON.stringify(base.refusal)}`);
  return base.fixture.entries;
})();

/** Every answer the interview accepts for a field, as a value the profile holds. */
export function acceptedAnswers(entry: Entry, fieldKey: string): { readonly answers: readonly Answer[]; readonly exact: boolean | null; readonly neverVaried: readonly string[] } | null {
  const spec = (FIELD_SPECS as Partial<Record<string, unknown>>)[fieldKey];
  if (spec === undefined) return null;
  const typed = spec as Parameters<typeof isComposite>[0];
  const policy = policyOf(entry).get(fieldKey);
  const own = BASE.find((held) => held.key === fieldKey)?.value;
  const decoded = own === undefined ? undefined : decodeValue(own);
  if (isList(typed)) {
    const item = typed.item as unknown as Composite;
    const first = Array.isArray(decoded) ? (decoded[0] as unknown) : undefined;
    const items = compositeAnswers(item, policy, first);
    const base = items.answers[0];
    return {
      answers: [
        { what: "no entries", value: [] },
        ...items.answers.map((one) => ({ what: `one entry: ${one.what}`, value: [one.value] })),
        ...(base === undefined ? [] : [{ what: "five entries", value: Array.from({ length: 5 }, () => base.value) }]),
      ],
      exact: first === undefined ? null : items.exact,
      neverVaried: items.neverVaried,
    };
  }
  if (isComposite(typed)) {
    const composite = compositeAnswers(typed, policy, decoded);
    return { answers: composite.answers, exact: decoded === undefined ? null : composite.exact, neverVaried: composite.neverVaried };
  }
  const scalar = typed as unknown as Part;
  const values = acceptedBy({ ...scalar, partKey: fieldKey });
  return { answers: values.map((value) => ({ what: JSON.stringify(encodeValue(value)), value })), exact: null, neverVaried: values.length > 1 ? [] : [fieldKey] };
}

/** Run A's synthetic profile with answers put in, each stored as the profile stores it (a date tagged). */
function profileWith(answers: ReadonlyMap<string, unknown>): ConfirmedProfile {
  const entries = [
    ...BASE.map((entry) => (answers.has(entry.key) ? { ...entry, value: encodeValue(answers.get(entry.key)) } : entry)),
    ...[...answers].filter(([key]) => !BASE.some((entry) => entry.key === key)).map(([key, value]) => ({ key, value: encodeValue(value) })),
  ];
  return rehydrateProfile({
    studentId: "synthetic-p317",
    updatedAt: NOW,
    entries: entries.map((entry) => ({ ...entry, provenance: { source: "seeded", confirmedAt: NOW }, revision: 1 })) as unknown as readonly StoredProfileEntry[],
  });
}

export interface Finding {
  readonly fieldKey: string;
  readonly answer: string;
  readonly kind:
    | "breaks_a_required_box"
    | "breaks_another_box"
    | "held_but_unreadable"
    | "refused_by_the_map"
    | "offered_but_the_escape_cannot_take_the_words"
    | "not_one_of_the_box_options"
    | "offered_from_the_form_list";
  readonly box: string;
  readonly detail: string;
}

const violationKey = (violation: Violation): string => `${violation.fieldRef}|${violation.rule.kind}|${String(violation.item)}`;
const blockerKey = (blocker: FillBlocker): string => `${blocker.kind}|${blocker.fieldRef}|${"item" in blocker ? JSON.stringify(blocker.item) : ""}`;

/** Select and radio boxes whose whole list is in the entry, with what the runner can match in each. */
export function closedBoxes(entry: { readonly blueprint: unknown }): ReadonlyMap<string, ReadonlySet<string>> {
  const boxes = new Map<string, ReadonlySet<string>>();
  for (const box of boxesOf(entry)) {
    if ((box.inputType !== "select" && box.inputType !== "radio") || box.options === undefined || box.options.length === 0) continue;
    // As the browser runner matches (apps/browser-runner/src/playwright-fill-session.ts): a select
    // by its option's value only; a radio by a member's value, or by its label where every
    // member's value is empty, and a lone radio by yes, true or on.
    const values = box.options.filter((option) => option.value !== "").map((option) => option.value);
    const byLabel = box.inputType === "radio" && box.options.every((option) => option.value === "");
    const lone = box.inputType === "radio" && box.options.length === 1 ? ["yes", "true", "on"] : [];
    boxes.set(box.fieldRef, new Set([...values, ...(byLabel ? box.options.map((option) => option.label) : []), ...lone]));
  }
  return boxes;
}

/** The fills of a plan that name no option of their box. */
export function offTheList(outcome: ReturnType<typeof planFill>, closed: ReadonlyMap<string, ReadonlySet<string>>): readonly { readonly fieldRef: string; readonly text: string }[] {
  return outcome.instructions.flatMap((instruction) => {
    const options = closed.get(instruction.fieldRef);
    if (options === undefined || instruction.optionsAfter !== undefined) return [];
    // An empty text leaves the box on its blank entry: a required box left so is the validator's to report.
    const text = textOf(instruction.value);
    return text === "" || options.has(text) ? [] : [{ fieldRef: instruction.fieldRef, text }];
  });
}

/** An answer as the report names it: long text by its length. */
const named = (what: string): string => what.replace(/"([^"]{40,})"/gu, (_, text: string) => `"${text.slice(0, 12)}…" (${String(text.length)} characters)`);

interface FieldResult {
  readonly answers: number;
  readonly exact: boolean | null;
  readonly neverVaried: readonly string[];
  /** Under the base, every box the field fills is hidden; `opened` names what showed one, if anything did. */
  readonly hiddenUnderBase: boolean;
  readonly opened: readonly string[];
}

export interface Measured {
  readonly findings: readonly Finding[];
  /** The boxes the entry marks required: his rule's words name these. */
  readonly required: ReadonlySet<string>;
  readonly fields: ReadonlyMap<string, FieldResult>;
  readonly unasked: readonly string[];
  readonly answers: number;
  readonly baseBreaks: readonly string[];
}

/** Plan the base, then each accepted answer of each field the entry's maps read (or of `only`), and keep what is new. */
export function findingsFor(entry: Entry, only?: ReadonlySet<string>): Measured {
  const blueprint = entry.blueprint as Parameters<typeof planFill>[0];
  const check = checkUsable(entry.mappingSet as Parameters<typeof checkUsable>[0], blueprint);
  if (!check.usable) throw new Error(`the mapping set is not usable: ${check.refusal.detail}`);
  const required = requiredBoxes(entry);
  const closed = closedBoxes(entry);
  const plan = (answers: ReadonlyMap<string, unknown>): ReturnType<typeof planFill> => planFill(blueprint, check.mappingSet, profileWith(answers), []);
  const boxesOfField = (fieldKey: string): ReadonlySet<string> =>
    new Set(mappingsOf(entry).filter((mapping) => mapping.source.kind === "profile_field" && mapping.source.fieldKey === fieldKey).map((mapping) => mapping.fieldRef));
  const shows = (outcome: ReturnType<typeof planFill>, boxes: ReadonlySet<string>): boolean =>
    outcome.instructions.some((instruction) => boxes.has(instruction.fieldRef)) || outcome.blockers.some((blocker) => boxes.has(blocker.fieldRef));

  /** What each answer meets that the context's own plan does not. Says whether any of the field's boxes was shown. */
  const measureAgainst = (context: ReadonlyMap<string, unknown>, fieldKey: string, answers: readonly Answer[], label: string, findings: Finding[]): boolean => {
    const base = plan(context);
    const baseBlockers = new Set(base.blockers.map(blockerKey));
    const baseViolations = new Set(base.blockers.length > 0 ? [] : validatePlan(blueprint, base).violations.map(violationKey));
    const baseOff = new Set(offTheList(base, closed).map((off) => `${off.fieldRef}|${off.text}`));
    const boxes = boxesOfField(fieldKey);
    let shown = shows(base, boxes);
    for (const { what, value } of answers) {
      const answer = `${label}${what}`;
      const put = new Map(context).set(fieldKey, value);
      const outcome = plan(put);
      shown ||= shows(outcome, boxes);
      for (const blocker of outcome.blockers.filter((one) => !baseBlockers.has(blockerKey(one)))) {
        const onThisField = "fieldKey" in blocker && blocker.fieldKey === fieldKey;
        if (blocker.kind === "value_unavailable" && !onThisField) continue;
        if (blocker.kind === "value_unavailable") {
          findings.push({ fieldKey, answer, kind: "held_but_unreadable", box: blocker.fieldRef, detail: blocker.kind });
          continue;
        }
        const offer = blocker.kind === "render_refused" ? entryChoiceOffer(blueprint, { ...outcome, blockers: [blocker] }, (choice) => planFill(blueprint, check.mappingSet, profileWith(put), [choice])) : null;
        const tooLong = offer?.ownWordsBox?.tooLong;
        const kind: Finding["kind"] = offer === null ? "refused_by_the_map" : tooLong === undefined ? "offered_from_the_form_list" : "offered_but_the_escape_cannot_take_the_words";
        const detail = "refusal" in blocker ? `${blocker.kind} (${blocker.refusal.kind})` : blocker.kind;
        findings.push({ fieldKey, answer, kind, box: blocker.fieldRef, detail: tooLong === undefined ? detail : `${detail}; the escape's box takes ${String(tooLong.max)}` });
      }
      for (const off of offTheList(outcome, closed)) {
        if (baseOff.has(`${off.fieldRef}|${off.text}`)) continue;
        findings.push({ fieldKey, answer, kind: "not_one_of_the_box_options", box: off.fieldRef, detail: "no option's value is the text" });
      }
      if (outcome.blockers.length > 0) continue;
      for (const violation of validatePlan(blueprint, outcome).violations) {
        if (baseViolations.has(violationKey(violation))) continue;
        const bound = violation.rule.value === undefined ? "" : ` ${String(violation.rule.value)}`;
        findings.push({
          fieldKey,
          answer,
          kind: required.has(violation.fieldRef) ? "breaks_a_required_box" : "breaks_another_box",
          box: violation.fieldRef,
          detail: `${violation.rule.kind}${bound}${violation.item === undefined ? "" : `, entry ${String(violation.item + 1)}`}`,
        });
      }
    }
    return shown;
  };

  const base = plan(new Map());
  // Every finding below is NEW against this base, so what the base breaks itself is said here, or it would be hidden.
  const baseBreaks = [
    ...base.blockers.map((blocker) => `${blocker.fieldRef}: ${blocker.kind}`),
    ...(base.blockers.length > 0 ? [] : validatePlan(blueprint, base).violations.map((violation) => `${violation.fieldRef}: ${violation.rule.kind}`)),
    ...offTheList(base, closed).map((off) => `${off.fieldRef}: not one of its options`),
  ];
  const fieldKeys = [...new Set(mappingsOf(entry).flatMap((mapping) => (mapping.source.kind === "profile_field" && mapping.source.fieldKey !== undefined ? [mapping.source.fieldKey] : [])))].sort();
  const findings: Finding[] = [];
  const fields = new Map<string, FieldResult>();
  const unasked: string[] = [];
  const accepted = new Map<string, NonNullable<ReturnType<typeof acceptedAnswers>>>();
  let answers = 0;
  for (const fieldKey of fieldKeys) {
    const one = acceptedAnswers(entry, fieldKey);
    if (one === null) unasked.push(fieldKey);
    else accepted.set(fieldKey, one);
  }
  // Another field's values that could show a hidden section: few of them, or a country from a short list.
  const openers = [...accepted].flatMap(([fieldKey, one]) => {
    const values = one.answers.map((answer) => answer.value);
    if (values.length > 0 && values.every((value) => typeof value === "string" && COUNTRY_CODES.includes(value))) {
      return OPENING_COUNTRIES.map((code): { readonly fieldKey: string; readonly value: unknown } => ({ fieldKey, value: code }));
    }
    return values.length <= SMALL ? values.map((value) => ({ fieldKey, value })) : [];
  });
  for (const [fieldKey, one] of accepted) {
    if (only !== undefined && !only.has(fieldKey)) continue;
    answers += one.answers.length;
    const shownUnderBase = measureAgainst(new Map(), fieldKey, one.answers, "", findings);
    const opened: string[] = [];
    if (!shownUnderBase) {
      const boxes = boxesOfField(fieldKey);
      for (const opener of openers) {
        if (opener.fieldKey === fieldKey) continue;
        const context = new Map([[opener.fieldKey, opener.value]]);
        if (!one.answers.some((answer) => shows(plan(new Map(context).set(fieldKey, answer.value)), boxes))) continue;
        const name = `${opener.fieldKey}=${JSON.stringify(encodeValue(opener.value))}`;
        opened.push(name);
        answers += one.answers.length;
        measureAgainst(context, fieldKey, one.answers, `with ${name}: `, findings);
      }
    }
    fields.set(fieldKey, { answers: one.answers.length, exact: one.exact, neverVaried: one.neverVaried, hiddenUnderBase: !shownUnderBase, opened });
  }
  return { findings, required, fields, unasked, answers, baseBreaks };
}

/** One line per field, box and class, the answers that meet it counted and the first few named. */
export function report(blueprintId: string, version: string, result: Measured): string {
  const lines = [
    `${blueprintId} (blueprint ${version})`,
    `  fields measured: ${String(result.fields.size)}; accepted answers planned: ${String(result.answers)}`,
    `  what Run A's synthetic profile breaks itself (findings below are new against it): ${result.baseBreaks.length === 0 ? "nothing" : result.baseBreaks.join("; ")}`,
  ];
  const groups = new Map<string, Finding[]>();
  for (const finding of result.findings) {
    const key = `${finding.kind}|${finding.fieldKey}|${finding.box}|${finding.detail}`;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  const order: readonly Finding["kind"][] = [
    "breaks_a_required_box",
    "breaks_another_box",
    "held_but_unreadable",
    "refused_by_the_map",
    "offered_but_the_escape_cannot_take_the_words",
    "not_one_of_the_box_options",
    "offered_from_the_form_list",
  ];
  // His rule names the boxes the entry marks required; each line says whether its box is one.
  const tally = { required: 0, other: 0, holding: 0 };
  for (const kind of order) {
    const of = [...groups.entries()].filter(([key]) => key.startsWith(`${kind}|`)).sort(([a], [b]) => a.localeCompare(b));
    lines.push(`  ${kind}: ${String(of.length)}`);
    for (const [, group] of of) {
      const first = group[0];
      if (first === undefined) continue;
      const marked = result.required.has(first.box);
      if (kind === "offered_from_the_form_list") tally.holding += 1;
      else if (marked) tally.required += 1;
      else tally.other += 1;
      // Every answer when they are few enough to read (a list of countries), else the first three.
      const shown = group.length <= 40 ? group : group.slice(0, 3);
      const answers = shown.map((finding) => named(finding.answer)).join("; ");
      lines.push(`    ${first.fieldKey} → ${first.box} [${marked ? "required" : "not required"}]: ${first.detail}, by ${String(group.length)} answer(s): ${answers}${shown.length < group.length ? "; …" : ""}`);
    }
  }
  lines.push(
    `  lines that break the rule on a box the entry marks required: ${String(tally.required)}; that stop the run on a box it does not mark required: ${String(tally.other)}; that hold the rule: ${String(tally.holding)}`,
  );
  const list = (items: readonly string[]): string => (items.length === 0 ? "none" : items.join(", "));
  const fields = [...result.fields];
  lines.push(`  fields the interview has no spec for (not measured): ${list(result.unasked)}`);
  lines.push(`  composite bases rebuilt exactly from the synthetic profile's own answer: ${list(fields.filter(([, field]) => field.exact === true).map(([key]) => key))}`);
  lines.push(`  composite bases only near it (the varied answers start from a nearby answer): ${list(fields.filter(([, field]) => field.exact === false).map(([key]) => key))}`);
  lines.push(`  parts never varied (their silence is not a pass): ${list(fields.flatMap(([key, field]) => field.neverVaried.map((part) => (part === key ? key : `${key}.${part}`))))}`);
  lines.push(
    `  fields whose every box the base hides, measured again where another answer shows one: ${list(fields.filter(([, field]) => field.hiddenUnderBase).map(([key, field]) => `${key} (${field.opened.length === 0 ? "nothing shows one" : field.opened.join("; ")})`))}`,
  );
  return lines.join("\n");
}

/** Every entry the signed catalogue admits, measured: the text the script prints and docs/run-a/p317-required-boxes.txt holds. */
export async function measureCatalogue(directory: string): Promise<string> {
  const load = await loadCatalogueDirectory({ directory });
  if (!load.ok) throw new Error(`the catalogue does not load: ${load.problems.map((problem) => problem.detail).join("; ")}`);
  const lines: string[] = [];
  for (const item of load.catalogue.inventory()) {
    const entry = await load.catalogue.find(item.blueprintId);
    if (entry === null) continue;
    lines.push(report(String(item.blueprintId), String(entry.blueprint.version), findingsFor(entry)), "");
  }
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1] && process.argv[2] === "--answers") {
  // What the checker plans for one field, to see what it covers.
  const load = await loadCatalogueDirectory({ directory: join(ROOT, "docs", "run-a", "catalogue") });
  if (!load.ok) throw new Error("the catalogue does not load");
  for (const item of load.catalogue.inventory()) {
    const entry = await load.catalogue.find(item.blueprintId);
    if (entry === null) continue;
    const accepted = acceptedAnswers(entry, process.argv[3] ?? "");
    process.stdout.write(`${String(item.blueprintId)}: ${accepted === null ? "no spec" : `${String(accepted.answers.length)} answers, base exact: ${String(accepted.exact)}, never varied: ${accepted.neverVaried.join(", ") || "none"}`}\n`);
    for (const answer of accepted?.answers ?? []) process.stdout.write(`  ${named(answer.what)} → ${named(JSON.stringify(encodeValue(answer.value)))}\n`);
  }
} else if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  process.stdout.write(await measureCatalogue(process.argv[2] ?? join(ROOT, "docs", "run-a", "catalogue")));
}
