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
  | { readonly kind: "date"; readonly pattern: DatePattern }
  /** One part of a structured value, e.g. a qualification's subject. */
  | { readonly kind: "part"; readonly path: string; readonly then?: FormatRule }
  /**
   * A dropdown or radio option.
   *
   * `options` maps the confirmed value to the portal's own option value. A
   * value with no entry is REFUSED — never approximated. See below.
   */
  | { readonly kind: "option"; readonly options: Readonly<Record<string, string>> }
  /** A number, as digits. */
  | { readonly kind: "number" }
  /** Money, as a decimal amount with no currency symbol. */
  | { readonly kind: "money_amount" }
  /** Money's currency code. */
  | { readonly kind: "money_currency" };

/** The date notations seen on application portals. */
export type DatePattern =
  | "YYYY-MM-DD"
  | "DD/MM/YYYY"
  | "MM/DD/YYYY"
  | "DD-MM-YYYY"
  | "D MMMM YYYY"
  | "DD MMM YYYY";

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
  | { readonly kind: "no_such_part"; readonly detail: string };

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

    case "date":
      return value instanceof Date
        ? formatDate(value, rule.pattern)
        : { kind: "rule_does_not_fit", detail: `"date" needs a Date, got ${typeName(value)}.` };

    case "number":
      return typeof value === "number"
        ? String(value)
        : { kind: "rule_does_not_fit", detail: `"number" needs a number, got ${typeName(value)}.` };

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
        return {
          kind: "no_such_part",
          detail: `The confirmed value has no part "${rule.path}".`,
        };
      }
      const part = container[rule.path];
      return applyRule(part, rule.then ?? { kind: "text" });
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
