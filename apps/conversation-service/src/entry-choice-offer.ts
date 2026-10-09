/**
 * A student's choice from a form's own list — the offer (P290, ADR-0155).
 *
 * The shape, in the words of the message of 2026-10-05, 15:02 UTC, which
 * speaks of Vahid in the third person ("The shape Vahid and I agree on"):
 * *"When a value is not among the entries read, the student is shown what the
 * portal's list does hold and chooses."* *"The system never pre-selects, never
 * orders by similarity, and never says "did you mean". The entries are shown
 * as the portal returned them."* *"The escape is always offered alongside, not
 * as a last resort after they have been shown near-misses."* *"And what they
 * pick is stored as their own words, with the portal's entry recorded beside
 * it."*
 *
 * And Vahid's own, amending ADR-0109 (2026-10-05, 15:52 UTC): *"the runner may
 * choose the form's escape entry when, and only when, the student has chosen
 * it."*
 *
 * Pure: an offer is DERIVED from the plan as it stands and the entry's own
 * record of what the form's lists hold — never stored, never guessed. A list
 * nobody read is not offered: the student would be shown less than the form
 * holds and told it was the list. Such a value still goes to a person.
 */

import { createHash } from "node:crypto";

import type { ApplicationBlueprint, BlueprintField, FieldReadUnder } from "@askimate/aas-blueprint";
import { allFields, escapeOf } from "@askimate/aas-blueprint";
import type { FillBlocker, FillPlan, StudentChoice } from "@askimate/aas-mapping";
import { textOf } from "@askimate/aas-mapping";
import { FIELD_LABELS, partLabel } from "@askimate/aas-profile";

/** One entry as the form shows it, by the id the offer gives it. */
export interface OfferedEntry {
  readonly id: string;
  /** What the form submits for it. */
  readonly value: string;
  /** What the form shows for it. */
  readonly label: string;
}

/** Where the entries on offer came from: what the entry records the form returned. */
export type OfferSource =
  /** A search: the word typed, and what it returned. */
  | { readonly kind: "search"; readonly word: string }
  /** A list the form loads after an earlier box is set, read for that box's value. */
  | { readonly kind: "after"; readonly fieldRef: string; readonly fieldLabel: string; readonly value: string; readonly valueLabel: string }
  /** The list the form shows whole. */
  | { readonly kind: "whole" };

export interface EntryChoiceOffer {
  readonly fieldRef: string;
  /** The form's own label for the box. */
  readonly fieldLabel: string;
  /** The entry of a repeating page, from 0, and how many there are. Absent off one. */
  readonly item?: { readonly index: number; readonly count: number; readonly list: string };
  /** The student's value the plan refused: the key their choice is recorded under. */
  readonly studentValue: string;
  /** `not_listed`: the list does not hold their value. `no_rule`: we have no rule for it. */
  readonly why: "not_listed" | "no_rule";
  /** The student's word for what the value is — "institution", "subject". */
  readonly about: string;
  readonly source: OfferSource;
  /** As the form returned them, in its order. Never ranked, never filtered by likeness. */
  readonly entries: readonly OfferedEntry[];
  /** The form's escape, offered beside the entries — first, and apart. */
  readonly escape: OfferedEntry;
  /**
   * The box the escape opens, by its label, and the student's own words the
   * plan would type into it were the escape chosen — read from that plan,
   * not assumed. Absent when nothing would be typed there, and then nothing
   * is promised.
   */
  readonly ownWordsBox?: {
    readonly label: string;
    readonly text: string;
    /**
     * The box's recorded length limit, when the words are longer (P291):
     * Sheffield's award-title box takes 28 characters, and "Doctorate of
     * Business Administration" is 36. Then nothing is promised — the words
     * are not shortened for the student (the validator says the same).
     */
    readonly tooLong?: { readonly max: number; readonly length: number };
  };
  /** `sha256:<hex>` over everything above: what a `choose_entry` must carry. */
  readonly offerHash: string;
}

export const ESCAPE_ID = "escape";

/**
 * The first refusal in the plan that the student can settle by choosing, as
 * an offer — or `null`, when none can be, and the run goes to a person as
 * before.
 *
 * In the plan's own order, one at a time: an answer to one can change the
 * next (the grading list follows the institution), so later offers are
 * derived after earlier choices, never ahead of them.
 */
export function entryChoiceOffer(
  blueprint: ApplicationBlueprint,
  plan: FillPlan,
  /** The plan as it would be with one more choice: what choosing the escape would type, read rather than assumed. */
  planWith: (choice: StudentChoice) => FillPlan,
): EntryChoiceOffer | null {
  const fields = allFields(blueprint);
  const fieldOf = new Map(fields.map((field) => [field.fieldRef, field] as const));
  // A search box is set by its list's choice (the word whose results they
  // chose from); it is never offered itself.
  const searchBoxes = new Set(
    fields.flatMap((field) => (field.optionsAfter?.press === undefined ? [] : [field.optionsAfter.fieldRef])),
  );
  for (const blocker of plan.blockers) {
    if (blocker.kind !== "render_refused") continue;
    if (searchBoxes.has(blocker.fieldRef)) continue;
    const offer = offerFor(blocker, fieldOf, plan, fields, planWith);
    if (offer !== null) return offer;
  }
  return null;
}

function offerFor(
  blocker: Extract<FillBlocker, { kind: "render_refused" }>,
  fieldOf: ReadonlyMap<string, BlueprintField>,
  plan: FillPlan,
  fields: readonly BlueprintField[],
  planWith: (choice: StudentChoice) => FillPlan,
): EntryChoiceOffer | null {
  const refusal = blocker.refusal;
  if (refusal.kind !== "no_matching_option" && refusal.kind !== "no_matching_case") return null;
  const field = fieldOf.get(blocker.fieldRef);
  if (field === undefined) return null;
  // The escape is always offered alongside (his words): a list with no
  // escape on record is not offered, because the student would have no
  // honest answer if none of it is theirs.
  const escapeValue = escapeOf(field);
  if (escapeValue === undefined) return null;
  // An escape read to leave the student no way through (P291, Sheffield's
  // grading system): not offered at all. His words: *"the offer must not
  // present that escape as a way through."*
  if (field.escapeLeadsNowhere !== undefined) return null;
  const labelOf = (value: string): string => field.options?.find((option) => option.value === value)?.label ?? value;

  const listed = listOnFile(field, refusal.value, blocker.item?.index, plan, fieldOf);
  if (listed === null) return null;
  const entries = listed.values.map((value, index) => ({ id: `e${String(index + 1)}`, value, label: labelOf(value) }));
  const escape: OfferedEntry = { id: ESCAPE_ID, value: escapeValue, label: escapeValue === "" ? labelOf(escapeValue) || "Not in list" : labelOf(escapeValue) };

  // The box the escape opens, and what the plan would type into it were the
  // escape chosen: the plan with that choice, read.
  const box = fields.find(
    (candidate) =>
      candidate.visibleWhen?.whenFieldRef === field.fieldRef && candidate.visibleWhen.operator === "equals" && candidate.visibleWhen.value === escapeValue,
  );
  const typed =
    box === undefined
      ? undefined
      : planWith({
          fieldRef: field.fieldRef,
          ...(blocker.item === undefined ? {} : { item: blocker.item.index }),
          studentValue: refusal.value,
          value: escapeValue,
          label: escape.label,
          escape: true,
          ...(listed.source.kind === "search" ? { searchedWith: listed.source.word } : {}),
        }).instructions.find((instruction) => instruction.fieldRef === box.fieldRef && (instruction.item?.index ?? -1) === (blocker.item?.index ?? -1));
  const ownWords = typed === undefined ? "" : textOf(typed.value);
  const about =
    refusal.kind === "no_matching_option"
      ? ((refusal.part === undefined ? null : partLabel(blocker.fieldKey, refusal.part)) ?? (refusal.part === undefined ? FIELD_LABELS[blocker.fieldKey].toLowerCase() : said(blocker.label)))
      : said(blocker.label);
  const content = {
    fieldRef: field.fieldRef,
    fieldLabel: field.label,
    ...(blocker.item === undefined ? {} : { item: { ...blocker.item, list: FIELD_LABELS[blocker.fieldKey].toLowerCase() } }),
    studentValue: refusal.value,
    why: refusal.kind === "no_matching_option" ? ("not_listed" as const) : ("no_rule" as const),
    about,
    source: listed.source,
    entries,
    escape,
    ...(box === undefined || ownWords === "" ? {} : { ownWordsBox: { label: box.label, text: ownWords, ...lengthOver(box, ownWords) } }),
  };
  return { ...content, offerHash: `sha256:${createHash("sha256").update(JSON.stringify(content)).digest("hex")}` };
}

/**
 * What the entry records the form's list holds for this value — or `null`
 * when nobody has read it. Never the escape, and never a placeholder: the
 * escape is offered apart, and an empty entry is not an answer.
 */
function listOnFile(
  field: BlueprintField,
  value: string,
  item: number | undefined,
  plan: FillPlan,
  fieldOf: ReadonlyMap<string, BlueprintField>,
): { readonly source: OfferSource; readonly values: readonly string[] } | null {
  const escape = escapeOf(field);
  // Not the escape, not the empty entry, and not the list's own prompt
  // ("Select qualification...", P291): none of them is an answer.
  const answers = (values: readonly string[]): readonly string[] => values.filter((entry) => entry !== escape && entry !== "" && entry !== field.prompt);
  // P294: a read that records what it was made under (Sheffield's country
  // box) is true only of that. It is offered only to an entry the plan sets
  // the same way, so a list read under Iran is never shown to a qualification
  // elsewhere; there the value goes to a person, as for any list nobody read.
  const madeUnderThis = (under: readonly FieldReadUnder[] | undefined): boolean =>
    (under ?? []).every((held) => {
      const set = plan.instructions.find((instruction) => instruction.fieldRef === held.fieldRef && (instruction.item?.index ?? -1) === (item ?? -1));
      return set !== undefined && textOf(set.value) === held.value;
    });
  // A searched list — a typeahead, or a select a press fills — offers what
  // a search RETURNED: the ONE recorded search whose word is in the
  // student's own words. Their words decide which search, not a likeness;
  // and where their words hold two searched words ("International
  // Business"), nothing they said chooses between the two lists, so neither
  // is offered and a person looks, as before.
  if (field.typeahead !== undefined || field.optionsAfter?.press !== undefined) {
    const theirs = value.toLowerCase();
    const matching = (field.searches ?? []).filter((candidate) => theirs.includes(candidate.word.toLowerCase()) && madeUnderThis(candidate.under));
    const search = matching.length === 1 ? matching[0] : undefined;
    return search === undefined ? null : { source: { kind: "search", word: search.word }, values: answers(search.entries) };
  }
  // A list the form loads after an earlier box: read for THAT box's value,
  // as the plan now sets it — after the student's own choice there, if that
  // is what set it.
  if (field.optionsAfter !== undefined) {
    const opener = field.optionsAfter.fieldRef;
    const set = plan.instructions.find((instruction) => instruction.fieldRef === opener && (instruction.item?.index ?? -1) === (item ?? -1));
    if (set === undefined) return null;
    const openerValue = textOf(set.value);
    const read = field.listsAfter?.find((candidate) => candidate.fieldRef === opener && candidate.value === openerValue && madeUnderThis(candidate.under));
    if (read === undefined) return null;
    const openerField = fieldOf.get(opener);
    const valueLabel =
      set.value.kind === "chosen" ? set.value.label : (openerField?.options?.find((option) => option.value === openerValue)?.label ?? openerValue);
    return {
      source: { kind: "after", fieldRef: opener, fieldLabel: openerField?.label ?? opener, value: openerValue, valueLabel },
      values: answers(read.entries),
    };
  }
  // The list the form shows whole.
  const whole = answers((field.options ?? []).map((option) => option.value));
  return whole.length === 0 ? null : { source: { kind: "whole" }, values: whole };
}

/** The box's recorded maximum length, where the words exceed it. */
function lengthOver(box: BlueprintField, text: string): { readonly tooLong?: { readonly max: number; readonly length: number } } {
  const limits = box.validations.flatMap((rule) => (rule.kind === "maxlength" && rule.value !== undefined && /^[0-9]+$/u.test(rule.value) ? [Number(rule.value)] : []));
  if (limits.length === 0) return {};
  const max = Math.min(...limits);
  return [...text].length > max ? { tooLong: { max, length: [...text].length } } : {};
}

/** The form's own label, as a word in a sentence. */
function said(label: string): string {
  return label.replace(/[\s:.…]+$/u, "").toLowerCase();
}

/**
 * What the student reads with the offer. Every sentence that promises an act
 * is held by a test (CLAUDE.md): the box their own words go in, and that
 * nothing is chosen until they press.
 */
export function entryChoiceMessage(institutionName: string, offer: EntryChoiceOffer, afterResolution = false): string {
  const sentences: string[] = [];
  if (afterResolution) sentences.push(`Someone on the team has looked at your ${institutionName} application.`);
  if (offer.item !== undefined && offer.item.count > 1) {
    sentences.push(`This is about entry ${String(offer.item.index + 1)} of the ${String(offer.item.count)} in your ${offer.item.list}.`);
  }
  const source = offer.source;
  if (offer.why === "not_listed") {
    sentences.push(`Their form asks you to choose your ${offer.about} from its own list, and it does not hold "${offer.studentValue}", which is what you told me.`);
  } else {
    sentences.push(`Their form asks for the ${offer.about} from its own list, and I have no rule for it for "${offer.studentValue}".`);
  }
  const count = offer.entries.length;
  const these = count === 0 ? "" : count === 1 ? "the one entry below" : `the ${String(count)} entries below`;
  sentences.push(
    source.kind === "search"
      ? count === 0
        ? `Searched for "${source.word}", it offers no entry apart from its own option for one that is not on it.`
        : `Searched for "${source.word}", it offers ${these}, in its own order.`
      : source.kind === "after"
        ? count === 0
          ? `With "${source.valueLabel}" as the ${said(source.fieldLabel)}, it offers no entry apart from its own option for one that is not on it.`
          : `With "${source.valueLabel}" as the ${said(source.fieldLabel)}, it offers ${these}, in its own order.`
        : `It holds ${these}, in its own order.`,
  );
  if (count > 0) sentences.push(`If one of them is yours, choose it.`);
  sentences.push(
    `If none is, choose "${offer.escape.label}": that is the form's own option for exactly this` +
      (offer.ownWordsBox === undefined
        ? `.`
        : offer.ownWordsBox.tooLong === undefined
          ? `, and I will type your own words, "${offer.ownWordsBox.text}", into the box it opens.`
          : `. The box it opens takes at most ${String(offer.ownWordsBox.tooLong.max)} characters, and your words, "${offer.ownWordsBox.text}", are ${String(offer.ownWordsBox.tooLong.length)}, so they will not go in as they are; I will not shorten them for you.`),
  );
  sentences.push(`Whichever you choose is your answer and is recorded as yours. I will not choose for you, and nothing is chosen until you press one.`);
  return sentences.join(" ");
}

/** What the student reads after choosing: what was recorded, beside their own words. */
export function entryChosenMessage(offer: EntryChoiceOffer, chosen: OfferedEntry): string {
  return chosen.id === ESCAPE_ID
    ? `You chose "${chosen.label}" for your ${offer.about}, where you told me "${offer.studentValue}". That is recorded as your answer.`
    : `You chose "${chosen.label}" on their list for your ${offer.about}, where you told me "${offer.studentValue}". That is recorded as your answer.`;
}
