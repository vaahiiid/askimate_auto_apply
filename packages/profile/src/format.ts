/**
 * Rendering a confirmed value into the string a portal expects.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LAST STEP BEFORE A VALUE REACHES A FORM FIELD.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A confirmed date of birth is a `Date`. The portal wants `02/04/1999`, or
 * `1999-04-02`, or three separate boxes. Something has to turn one into the
 * other, and that something is the last place a value can be corrupted before
 * it is typed into a university application.
 *
 * ── Why format rules are DATA and not functions ───────────────────────────
 *
 * The obvious signature is:
 *
 *     renderConfirmed(confirmed, (value) => string)
 *
 * and it has a hole big enough to drive the whole system through. A closure can
 * ignore its argument:
 *
 *     renderConfirmed(dateOfBirth, () => whateverTheModelSaid)   // ← compiles
 *
 * That launders model output into a `ConfirmedValue<string>` carrying a real
 * student's provenance, which is precisely the failure ADR-0004 exists to make
 * impossible. So there is no formatter parameter. A `FormatRule` is a closed
 * union of DATA, interpreted here, and the only strings it can produce are
 * derived from the confirmed value itself.
 *
 * A reviewer reading a mapping therefore reads `{ kind: "date", pattern:
 * "DD/MM/YYYY" }` rather than a function they would have to reason about.
 *
 * ── Why the provenance carries through unchanged ──────────────────────────
 *
 * The rendered string is the same fact in a different notation. The student
 * confirmed `2 April 1999`; `02/04/1999` is that, written the way this portal
 * writes dates. Carrying the original provenance keeps the audit answer right:
 * "where did this come from?" is still "the student confirmed it on this date,
 * from this document".
 *
 * This function cannot be a laundering route because it REQUIRES a
 * `ConfirmedValue` to start from. There is no path in that does not already
 * pass through `applyConfirmation`.
 */

import type { ConfirmedValue } from "@askimate/aas-domain";
import { provenanceOf, unwrapConfirmed } from "@askimate/aas-domain";

/** How a confirmed value becomes the string a portal field takes. */
export type FormatRule =
  /** The value as text, unchanged. */
  | { readonly kind: "text" }
  /** Text, upper-cased. Passports and some portals insist. */
  | { readonly kind: "uppercase" }
  /**
   * A date, in the portal's notation.
   *
   * The pattern is a closed set rather than a format string, because a format
   * string is a small programming language and this is a place where a typo
   * writes the wrong date of birth into a visa-relevant application.
   */
  | {
      readonly kind: "date";
      readonly pattern: DatePattern;
      /**
       * Applied to the rendered text — for a month select whose entries are
       * the portal's own spellings (Sheffield's *Jan … June, July … Sept*),
       * reached from `MMMM` through an option map (P142).
       */
      readonly then?: FormatRule;
    }
  /**
   * One part of a structured value, e.g. a qualification's subject.
   *
   * `absent: "leave_empty"` renders the EMPTY string when the value has no
   * such part, instead of refusing — for a part whose absence is itself the
   * student's statement: a job with `end: { kind: "current" }` has no end
   * date, and the portal's end-date boxes are left empty because of what they
   * said, not because of what we inferred (ADR-0111). Without it a missing
   * part refuses, as it always has.
   *
   * `absent: { typed: "…" }` renders the given text instead (ADR-0117): the
   * PORTAL'S OWN instruction for a value the student has stated they do not
   * have — Sheffield's *"If you don't have a passport please enter 'no
   * passport' in the box"*. The words are quoted from the page into the
   * reviewed mapping and never stored in the profile: they are the portal's
   * instruction, not a fact about the student, and a portal that says
   * something else gets its own words.
   */
  | {
      readonly kind: "part";
      readonly path: string;
      readonly then?: FormatRule;
      readonly absent?: "leave_empty" | { readonly typed: string };
    }
  /**
   * Several parts of a structured value, each as text, joined in order with
   * the separator given — for a portal that asks for the employer's name and
   * address in one box (ADR-0111). A part the value does not have refuses the
   * whole, never the rest.
   */
  | { readonly kind: "join"; readonly parts: readonly string[]; readonly separator: string }
  /**
   * A dropdown or radio option.
   *
   * `options` maps the confirmed value to the portal's own option value. A
   * value with no entry is REFUSED — never approximated. See below.
   */
  | { readonly kind: "option"; readonly options: Readonly<Record<string, string>> }
  /**
   * One half of a UK postcode, for a portal that asks for it as two boxes
   * (Sheffield's contact page, P116). The inward code is the last three
   * characters — a digit and two letters — and the outward code is the rest,
   * two to four; the seam is the postcode's own, never a fixed 3+3. Case is
   * left as the student wrote it: the portal stores what is typed, and
   * whether to canonicalise is not this rule's to decide.
   */
  | { readonly kind: "uk_postcode"; readonly part: "outward" | "inward" }
  /** A number, as digits. */
  | { readonly kind: "number" }
  /** Money, as a decimal amount with no currency symbol. */
  | { readonly kind: "money_amount" }
  /** Money's currency code. */
  | { readonly kind: "money_currency" }
  /**
   * A field this portal asks for that the registry HAS NO FACT FOR, so no
   * rendering of what it does hold could be right. It always refuses, and it
   * carries the reason it refuses.
   *
   * ── Why this exists, and why it is a rule rather than an absence ──────
   *
   * Sheffield's `degree` box wants an AWARD TITLE — `BA`, `BEd`, `BSc`, one
   * of forty-two. The registry holds a qualification's LEVEL — *"Bachelor's
   * degree"*. A level does not determine a title, and the map that claimed it
   * did sent every BA student to a university as a BSc, silently: the plan had
   * no blocker, the validator no violation, the preview built, and the
   * read-back passed, because the value landed. It was simply wrong (blocker
   * 71, found 2026-09-25).
   *
   * An empty `option` map produces the same STOP. Vahid chose this instead,
   * and the reason is the whole point of the rule:
   *
   *   *"A stop whose message tells the next person to add rows teaches the bug
   *   to whoever inherits it — and the person most likely to read that message
   *   is someone under time pressure who will do exactly what it says."*
   *
   * An `option` rule with no options reads as an UNFINISHED map, and the
   * refusal it produces says *"a specialist maps it, or the student is
   * asked"* — which for this field is false twice over. This rule cannot be
   * mistaken for unfinished, and its `reason` is carried verbatim into the
   * refusal, so whoever meets the stop reads why no mapping can be right and
   * where the fix actually is.
   *
   * It is NOT for a field that is merely unmapped, nor for one whose options
   * a reviewer has not read yet. Those are thin maps, and they refuse for the
   * students they do not cover while working for the ones they do. This is for
   * a field where widening the map is the mistake.
   */
  | { readonly kind: "not_derivable"; readonly reason: string }
  /**
   * One rule per value of a part — a map keyed on TWO parts of a value
   * (P218, closing blocker 78 and widening 85).
   *
   * Sheffield's grade list is loaded per grading system, and the grading
   * system per institution; a grade string maps to a value only under one
   * system. A funding list names twenty-eight scholarships; the registry says
   * `scholarship` and holds the name apart. Neither is one path deep. This
   * rule reads the part at `path`, picks the case named by its value, and
   * applies that case's rule to the WHOLE value — so a case may `part` into a
   * sibling. Cases nest. A value no case names refuses (`no_matching_case`):
   * an unread list is a refusal, never the nearest case.
   *
   * `absent` as on `part`: what to render when the value has no such part.
   */
  | {
      readonly kind: "switch";
      readonly path: string;
      readonly cases: Readonly<Record<string, FormatRule>>;
      readonly absent?: "leave_empty" | { readonly typed: string };
    };

/** The date notations seen on application portals. */
export type DatePattern =
  | "YYYY-MM-DD"
  | "DD/MM/YYYY"
  | "MM/DD/YYYY"
  | "DD-MM-YYYY"
  | "D MMMM YYYY"
  | "DD MMM YYYY"
  // One part of a date, for a portal that asks it as three selects (P89:
  // Sheffield's date of birth is day "1"…"31", month "January"…"December",
  // year). Three more members of the closed set — still not a format string.
  | "D"
  | "MMMM"
  | "YYYY";

/** Why a value could not be rendered. */
export type RenderRefusal =
  /**
   * The confirmed value is not one of the portal's options.
   *
   * The most important refusal in this file. A student's nationality is
   * `IRANIAN`; the dropdown offers `Iran (Islamic Republic of)`. Those are the
   * same country and NOT the same string, and the temptation to fuzzy-match is
   * exactly the temptation to let software decide what a student's nationality
   * is. It stops and asks (brief §3.1).
   */
  | { readonly kind: "no_matching_option"; readonly detail: string; readonly value: string }
  /** The rule does not fit the value's type — a mapping mistake, not a data one. */
  | { readonly kind: "rule_does_not_fit"; readonly detail: string }
  /** A `part` rule named a path the value does not have. */
  | { readonly kind: "no_such_part"; readonly detail: string }
  /** An item was asked of a value that is not a list (ADR-0103, gap 3). */
  | { readonly kind: "not_a_list"; readonly detail: string }
  /** An item the list does not have. */
  | { readonly kind: "no_such_item"; readonly detail: string }
  /**
   * The portal asks for a fact the registry does not hold (`not_derivable`).
   *
   * Separate from `no_matching_option` because the two ask for opposite
   * things. A missing option says *this value is not in the list* — extend
   * the list. This says *no list could help*: the value the portal wants was
   * never collected, and mapping what was collected is the defect.
   */
  | { readonly kind: "not_derivable"; readonly detail: string }
  /** A `switch` met a part value none of its cases names (P218). */
  | { readonly kind: "no_matching_case"; readonly detail: string; readonly value: string };

export type RenderResult =
  | { readonly rendered: true; readonly value: ConfirmedValue<string> }
  | { readonly rendered: false; readonly refusal: RenderRefusal };

export function isRenderRefused(
  result: RenderResult,
): result is { rendered: false; refusal: RenderRefusal } {
  return !result.rendered;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function two(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDate(date: Date, pattern: DatePattern): string {
  const year = String(date.getUTCFullYear());
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const monthName = MONTH_NAMES[month] ?? "";

  switch (pattern) {
    case "YYYY-MM-DD":
      return `${year}-${two(month + 1)}-${two(day)}`;
    case "DD/MM/YYYY":
      return `${two(day)}/${two(month + 1)}/${year}`;
    case "MM/DD/YYYY":
      return `${two(month + 1)}/${two(day)}/${year}`;
    case "DD-MM-YYYY":
      return `${two(day)}-${two(month + 1)}-${year}`;
    case "D MMMM YYYY":
      return `${String(day)} ${monthName} ${year}`;
    case "DD MMM YYYY":
      return `${two(day)} ${monthName.slice(0, 3).toUpperCase()} ${year}`;
    case "D":
      return String(day);
    case "MMMM":
      return monthName;
    case "YYYY":
      return year;
  }
}

/**
 * Applies a rule to a raw value.
 *
 * Separated from `renderConfirmed` so `part` can recurse without unwrapping a
 * confirmed value more than once.
 */
function applyRule(value: unknown, rule: FormatRule): string | RenderRefusal {
  switch (rule.kind) {
    // ── Always refuses, and says why (blocker 71) ──────────────────────
    //
    // Placed first because it consults the value for nothing: whatever the
    // student gave, this field wants something else, and rendering what they
    // gave is the defect this rule exists to stop.
    case "not_derivable":
      return { kind: "not_derivable", detail: rule.reason };

    case "text":
      return typeof value === "string"
        ? value
        : { kind: "rule_does_not_fit", detail: `"text" needs a string, got ${typeName(value)}.` };

    case "uppercase":
      return typeof value === "string"
        ? value.toUpperCase()
        : {
            kind: "rule_does_not_fit",
            detail: `"uppercase" needs a string, got ${typeName(value)}.`,
          };

    case "date": {
      if (!(value instanceof Date)) {
        return { kind: "rule_does_not_fit", detail: `"date" needs a Date, got ${typeName(value)}.` };
      }
      const rendered = formatDate(value, rule.pattern);
      return rule.then === undefined ? rendered : applyRule(rendered, rule.then);
    }

    case "number":
      return typeof value === "number"
        ? String(value)
        : { kind: "rule_does_not_fit", detail: `"number" needs a number, got ${typeName(value)}.` };

    case "uk_postcode": {
      if (typeof value !== "string") {
        return { kind: "rule_does_not_fit", detail: `"uk_postcode" needs a string, got ${typeName(value)}.` };
      }
      const compact = value.replace(/\s+/g, "");
      // Outward: a letter, then one to three letters or digits. Inward: a
      // digit and two letters. Five to seven characters in all.
      const seam = /^([A-Za-z][A-Za-z0-9]{1,3})([0-9][A-Za-z]{2})$/.exec(compact);
      if (seam === null || seam[1] === undefined || seam[2] === undefined) {
        return {
          kind: "rule_does_not_fit",
          detail: `"uk_postcode" needs a UK postcode — an outward code of two to four characters and an inward code of a digit and two letters — and the value is not one.`,
        };
      }
      return rule.part === "outward" ? seam[1] : seam[2];
    }

    case "money_amount": {
      const money = value as { amountMinorUnits?: unknown } | null;
      if (typeof money?.amountMinorUnits !== "number") {
        return { kind: "rule_does_not_fit", detail: `"money_amount" needs a Money value.` };
      }
      return (money.amountMinorUnits / 100).toFixed(2);
    }

    case "money_currency": {
      const money = value as { currency?: unknown } | null;
      return typeof money?.currency === "string"
        ? money.currency
        : { kind: "rule_does_not_fit", detail: `"money_currency" needs a Money value.` };
    }

    case "part": {
      const container = value as Record<string, unknown> | null;
      if (container === null || typeof container !== "object" || !(rule.path in container)) {
        if (rule.absent === "leave_empty") return "";
        if (rule.absent !== undefined) return rule.absent.typed;
        return {
          kind: "no_such_part",
          detail: `The confirmed value has no part "${rule.path}".`,
        };
      }
      const part = container[rule.path];
      return applyRule(part, rule.then ?? { kind: "text" });
    }

    case "switch": {
      const container = value as Record<string, unknown> | null;
      if (container === null || typeof container !== "object" || !(rule.path in container)) {
        if (rule.absent === "leave_empty") return "";
        if (rule.absent !== undefined) return rule.absent.typed;
        return { kind: "no_such_part", detail: `The confirmed value has no part "${rule.path}".` };
      }
      const chosen = container[rule.path];
      const key = chosen instanceof Date ? chosen.toISOString() : String(chosen);
      const branch = rule.cases[key];
      if (branch === undefined) {
        // The same discipline as `option`: a case nobody wrote is a list nobody
        // read, and the nearest case is not a reading of it.
        return {
          kind: "no_matching_case",
          value: key,
          detail:
            `"${key}" (the value of "${rule.path}") is not one this mapping has a rule for. The ` +
            `system will not choose the closest one — the list for it is read, or the student is asked.`,
        };
      }
      return applyRule(value, branch);
    }

    case "join": {
      const container = value as Record<string, unknown> | null;
      if (container === null || typeof container !== "object") {
        return { kind: "rule_does_not_fit", detail: `"join" needs a structured value, got ${typeName(value)}.` };
      }
      const pieces: string[] = [];
      for (const path of rule.parts) {
        if (!(path in container)) {
          return { kind: "no_such_part", detail: `The confirmed value has no part "${path}".` };
        }
        const piece = applyRule(container[path], { kind: "text" });
        if (typeof piece !== "string") return piece;
        pieces.push(piece);
      }
      return pieces.join(rule.separator);
    }

    case "option": {
      // Exact match only, on the value's own text. A near match is not a match:
      // the portal's option list is the university's vocabulary, and choosing
      // one on the student's behalf is choosing an answer for them.
      const key = value instanceof Date ? value.toISOString() : String(value);
      const option = rule.options[key];
      if (option === undefined) {
        return {
          kind: "no_matching_option",
          value: key,
          detail:
            `"${key}" is not one of this field's options. The system will not choose the closest ` +
            `one — a specialist maps it, or the student is asked.`,
        };
      }
      return option;
    }
  }
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Date) return "Date";
  return typeof value;
}

/**
 * Renders a confirmed value into the string a portal field takes.
 *
 * ── The second sanctioned construction of a ConfirmedValue ────────────────
 *
 * `applyConfirmation` is the first, and mints one from a student's
 * confirmation. This is the second, and it can only RE-NOTATE one that already
 * exists: it takes a `ConfirmedValue` in, carries its provenance through
 * untouched, and cannot be reached with anything else.
 *
 * It is not a second way to create confirmed data. It is the same confirmed
 * data, written the way this portal writes it.
 */
/**
 * Renders ONE item of a list-valued confirmed field (ADR-0103, gap 3).
 *
 * A page that repeats over `education.prior_qualifications` types each
 * qualification into the same boxes in turn; the mapping's rule is relative to
 * the item, and the provenance is the list's — the student confirmed the list,
 * and each item is that confirmation, not a new one.
 */
export function renderConfirmedItem<T>(
  confirmed: ConfirmedValue<T>,
  index: number,
  rule: FormatRule,
): RenderResult {
  const list = unwrapConfirmed(confirmed);
  if (!Array.isArray(list)) {
    return { rendered: false, refusal: { kind: "not_a_list", detail: `The confirmed value is ${typeName(list)}, not a list.` } };
  }
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    return {
      rendered: false,
      refusal: { kind: "no_such_item", detail: `The list has ${String(list.length)} item(s); there is no item ${String(index)}.` },
    };
  }
  const applied = applyRule(list[index], rule);
  if (typeof applied !== "string") return { rendered: false, refusal: applied };
  return {
    rendered: true,
    value: { value: applied, provenance: provenanceOf(confirmed) } as unknown as ConfirmedValue<string>,
  };
}

export function renderConfirmed<T>(
  confirmed: ConfirmedValue<T>,
  rule: FormatRule,
): RenderResult {
  const applied = applyRule(unwrapConfirmed(confirmed), rule);

  if (typeof applied !== "string") {
    return { rendered: false, refusal: applied };
  }

  return {
    rendered: true,
    value: {
      value: applied,
      provenance: provenanceOf(confirmed),
    } as unknown as ConfirmedValue<string>,
  };
}
