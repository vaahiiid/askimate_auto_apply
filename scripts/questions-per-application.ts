/**
 * Questions per application — a MEASURE, not a behaviour (P292, ADR-0156 proposed).
 *
 * The message of 2026-10-08, which speaks of Vahid in the third person, asked
 * for it: "Add a measure: questions per application. Count it on his current
 * run before the change … and after (state the number you measure, not a
 * target)."
 *
 * A question is a field — once per entry of a repeating page — at which the run
 * cannot go on without a human answer given DURING the application: a choice put
 * to the student, a stop for a person, or a value the form refuses that only the
 * student can change. Messages are not counted: one stop can name two fields,
 * and both still need an answer. Questions asked once at intake and kept on the
 * profile are counted apart, per student, because they are not per application.
 *
 * Two readings of the same walk:
 *
 *   - `questionsToday`: what the code does now. The real offer
 *     (`entryChoiceOffer`), each answered with the form's escape (the student's
 *     own case on his run), then what the plan still blocks on, then what the
 *     validator refuses.
 *   - `questionsProposed`: the same items, classified by ADR-0156's rule as
 *     PROPOSED. Nothing here changes what the run does; the rule is not built.
 *
 * Nothing is ranked by likeness, and no listed entry is ever picked: the only
 * default the proposal knows is the form's escape with the student's own words.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ApplicationBlueprint, BlueprintField } from "@askimate/aas-blueprint";
import { allFields, escapeOf } from "@askimate/aas-blueprint";
import type { ReviewedCatalogueEntry } from "@askimate/aas-catalogue";
import { parseReviewedEntryText } from "@askimate/aas-catalogue";
import { entryChoiceOffer } from "@askimate/aas-conversation-service";
import type { EntryChoiceOffer } from "@askimate/aas-conversation-service";
import type { FillPlan, StudentChoice, UsableMappingSet } from "@askimate/aas-mapping";
import { checkUsable, planFill } from "@askimate/aas-mapping";
import { validatePlan } from "@askimate/aas-preparation";
import type { ConfirmedProfile } from "@askimate/aas-profile";

export interface Question {
  readonly field: string;
  /** The entry of a repeating page, from 0. */
  readonly item?: number;
  /** `choice`: put to the student. `person`: the run stops for a person. `fix`: the form refuses a value only the student can change. */
  readonly kind: "choice" | "person" | "fix";
  readonly reason: string;
}

/** Standing answers the student gave once, at intake, kept on the profile (ADR-0156 §4, proposed). */
export interface StandingRules {
  /** "Where my exact words are not on a form's list, use the form's 'Not in list' with my own words." */
  readonly escapeWhenNotListed: boolean;
  /** Short forms for small boxes, by the profile part they shorten — e.g. `awardTitle`. */
  readonly shortForms: Readonly<Record<string, string>>;
}

export const NO_STANDING_RULES: StandingRules = { escapeWhenNotListed: false, shortForms: {} };

/** What the measure reads of an entry: its blueprint and its mapping set. */
type CatalogueEntry = Pick<ReviewedCatalogueEntry, "blueprint" | "mappingSet">;

const key = (question: { readonly field: string; readonly item?: number }): string => `${question.field}#${String(question.item ?? "-")}`;

interface Walk {
  readonly offers: readonly EntryChoiceOffer[];
  readonly after: FillPlan;
}

/** The run's own walk: every offer, each answered with the form's escape, and the plan after them. */
function walk(entry: CatalogueEntry, set: UsableMappingSet, profile: ConfirmedProfile): Walk {
  const choices: StudentChoice[] = [];
  const offers: EntryChoiceOffer[] = [];
  const plan = (extra: readonly StudentChoice[] = []): FillPlan => planFill(entry.blueprint, set, profile, [...choices, ...extra]);
  for (let offer = entryChoiceOffer(entry.blueprint, plan(), (c) => plan([c])); offer !== null; offer = entryChoiceOffer(entry.blueprint, plan(), (c) => plan([c]))) {
    if (offers.length > 50) throw new Error("the walk did not settle: an offer came back after its choice");
    offers.push(offer);
    choices.push({
      fieldRef: offer.fieldRef,
      ...(offer.item === undefined ? {} : { item: offer.item.index }),
      studentValue: offer.studentValue,
      value: offer.escape.value,
      label: offer.escape.label,
      escape: true,
      ...(offer.source.kind === "search" ? { searchedWith: offer.source.word } : {}),
    });
  }
  return { offers, after: plan() };
}

function usable(entry: CatalogueEntry): UsableMappingSet {
  const check = checkUsable(entry.mappingSet, entry.blueprint);
  if (!check.usable) throw new Error(`the entry's mapping set is not usable: ${check.refusal.detail}`);
  return check.mappingSet;
}

function fieldsOf(blueprint: ApplicationBlueprint): ReadonlyMap<string, BlueprintField> {
  return new Map(allFields(blueprint).map((field) => [field.fieldRef, field] as const));
}

/** Why a field the plan still blocks on cannot be offered — in the entry's own terms. */
function whyNotOffered(field: BlueprintField | undefined): string {
  if (field === undefined) return "a field the blueprint does not hold";
  if (field.escapeLeadsNowhere !== undefined) return "its escape leads nowhere (read), so it is not offered";
  if (escapeOf(field) === undefined) return "the form records no escape for it, so it is not offered";
  return "no list on file for these words, so it is not offered";
}

/** Today: what the code does now, field by field. */
export function questionsToday(entry: CatalogueEntry, profile: ConfirmedProfile): readonly Question[] {
  const set = usable(entry);
  const { offers, after } = walk(entry, set, profile);
  const fields = fieldsOf(entry.blueprint);
  const out = new Map<string, Question>();
  for (const offer of offers) {
    const q: Question = {
      field: offer.fieldRef,
      ...(offer.item === undefined ? {} : { item: offer.item.index }),
      kind: "choice",
      reason: `offered mid-run: ${String(offer.entries.length)} entr${offer.entries.length === 1 ? "y" : "ies"} and "${offer.escape.label}" for "${offer.studentValue}"`,
    };
    out.set(key(q), q);
  }
  for (const blocker of after.blockers) {
    const item = (blocker as { readonly item?: { readonly index: number } }).item?.index;
    const refusal = blocker.kind === "render_refused" ? ` (${blocker.refusal.kind})` : "";
    const q: Question = { field: blocker.fieldRef, ...(item === undefined ? {} : { item }), kind: "person", reason: `stops for a person${refusal}: ${whyNotOffered(fields.get(blocker.fieldRef))}` };
    out.set(key(q), q);
  }
  for (const violation of validatePlan(entry.blueprint, after).violations) {
    const items = after.instructions.filter((instruction) => instruction.fieldRef === violation.fieldRef).map((instruction) => instruction.item?.index);
    for (const item of items.length === 0 ? [undefined] : items) {
      const q: Question = { field: violation.fieldRef, ...(item === undefined ? {} : { item }), kind: "fix", reason: `the form refuses it: ${violation.detail}` };
      if (!out.has(key(q))) out.set(key(q), q);
    }
  }
  return [...out.values()];
}

/** The profile part a box's mapping types, when it types one part of the student's words. */
function partTyped(entry: CatalogueEntry, fieldRef: string): string | undefined {
  const mapping = entry.mappingSet.mappings.find((candidate) => candidate.fieldRef === fieldRef);
  if (mapping?.source.kind !== "profile_field") return undefined;
  const format = mapping.source.format;
  return format.kind === "part" ? format.path : undefined;
}

function maxLength(field: BlueprintField | undefined): number | undefined {
  const limits = (field?.validations ?? []).flatMap((rule) => (rule.kind === "maxlength" && rule.value !== undefined && /^[0-9]+$/u.test(rule.value) ? [Number(rule.value)] : []));
  return limits.length === 0 ? undefined : Math.min(...limits);
}

export interface ProposedCount {
  /** Asked per application, all together before the run starts (ADR-0156 §5, proposed). */
  readonly perApplication: readonly Question[];
  /** Standing questions this application needs answered once at intake, if the profile does not hold them yet. */
  readonly atIntake: readonly string[];
  /** Fields today asks about that the proposal settles without a question, and how. */
  readonly settled: readonly (Question & { readonly how: string })[];
}

/**
 * The same walk, classified by ADR-0156's rule as PROPOSED:
 *
 *   - one genuine option only (the escape): no question; the default is the
 *     escape with the student's own words, shown in the preview;
 *   - two or more: a question, unless the student's standing rule says "my
 *     exact words not listed → Not in list with my words";
 *   - own words longer than the box: a question, unless a standing short form
 *     fits;
 *   - a field with no usable escape and no deterministic row: a question
 *     (for the grading system, Option A's list with "None of these").
 */
export function questionsProposed(entry: CatalogueEntry, profile: ConfirmedProfile, standing: StandingRules): ProposedCount {
  const set = usable(entry);
  const { offers, after } = walk(entry, set, profile);
  const fields = fieldsOf(entry.blueprint);
  const perApplication = new Map<string, Question>();
  const settled: (Question & { readonly how: string })[] = [];
  const intake = new Set<string>();
  const boxesShortened = new Set<string>();
  for (const offer of offers) {
    const base = { field: offer.fieldRef, ...(offer.item === undefined ? {} : { item: offer.item.index }), kind: "choice" as const, reason: "" };
    if (offer.entries.length === 0) {
      settled.push({ ...base, reason: `only the form's escape for "${offer.studentValue}"`, how: "one option, so no question: the escape with their own words, shown in the preview" });
    } else if (standing.escapeWhenNotListed) {
      settled.push({ ...base, reason: `${String(offer.entries.length)} entries and the escape for "${offer.studentValue}"`, how: "the standing rule from intake: the escape with their own words, shown in the preview" });
    } else {
      intake.add("escape when not listed");
      perApplication.set(key(base), { ...base, reason: `${String(offer.entries.length)} entries and the escape for "${offer.studentValue}", and no standing rule on the profile` });
    }
    // The box the escape opens: their words must fit it, or a short form must.
    const box = allFields(entry.blueprint).find((field) => field.visibleWhen?.whenFieldRef === offer.fieldRef && field.visibleWhen.value === offer.escape.value);
    const tooLong = offer.ownWordsBox?.tooLong;
    if (box !== undefined && tooLong !== undefined) {
      const part = partTyped(entry, box.fieldRef);
      const short = part === undefined ? undefined : standing.shortForms[part];
      const max = maxLength(fields.get(box.fieldRef));
      const boxKey = key({ field: box.fieldRef, ...(offer.item === undefined ? {} : { item: offer.item.index }) });
      boxesShortened.add(boxKey);
      const boxBase = { field: box.fieldRef, ...(offer.item === undefined ? {} : { item: offer.item.index }), kind: "fix" as const };
      if (short !== undefined && max !== undefined && [...short].length <= max) {
        settled.push({ ...boxBase, reason: `their words are ${String(tooLong.length)} characters; the box takes ${String(tooLong.max)}`, how: `the standing short form from intake ("${short}")` });
      } else {
        intake.add(`short form of ${part ?? box.fieldRef}`);
        perApplication.set(boxKey, { ...boxBase, reason: `their words are ${String(tooLong.length)} characters; the box takes ${String(tooLong.max)}, and no short form on the profile fits` });
      }
    }
  }
  for (const blocker of after.blockers) {
    const item = (blocker as { readonly item?: { readonly index: number } }).item?.index;
    const q: Question = { field: blocker.fieldRef, ...(item === undefined ? {} : { item }), kind: "choice", reason: `${whyNotOffered(fields.get(blocker.fieldRef))}, and no deterministic row maps it — asked before the run starts` };
    perApplication.set(key(q), q);
  }
  for (const violation of validatePlan(entry.blueprint, after).violations) {
    const items = after.instructions.filter((instruction) => instruction.fieldRef === violation.fieldRef).map((instruction) => instruction.item?.index);
    for (const item of items.length === 0 ? [undefined] : items) {
      const q: Question = { field: violation.fieldRef, ...(item === undefined ? {} : { item }), kind: "fix", reason: `the form refuses it: ${violation.detail}` };
      if (!boxesShortened.has(key(q)) && !perApplication.has(key(q))) perApplication.set(key(q), q);
    }
  }
  return { perApplication: [...perApplication.values()], atIntake: [...intake], settled };
}

/** Reads an entry file the way the catalogue does. */
export function readEntry(path: string): ReviewedCatalogueEntry {
  const parsed = parseReviewedEntryText(readFileSync(resolve(path), "utf8"));
  if (!parsed.ok) throw new Error(`${parsed.refusal.path}: ${parsed.refusal.detail}`);
  return parsed.value;
}

export function formatQuestions(questions: readonly Question[]): string {
  return questions.map((question) => `  ${key(question).padEnd(32)} ${question.kind.padEnd(7)} ${question.reason}`).join("\n");
}
