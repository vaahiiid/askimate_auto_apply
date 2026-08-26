/**
 * The deterministic document validity engine.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * From the master brief, §2.4:
 *
 *   "Reuse is never automatic if validity is in question. Every document with
 *    an expiry or validity condition is monitored against the relevant rule. A
 *    document is offered for reuse only if it is still genuinely valid for the
 *    new application. This check is DETERMINISTIC DATE LOGIC and runs BEFORE
 *    any AI confidence system is involved. The canonical example is the UK
 *    Student visa 31-day financial evidence recency window. Silently reusing a
 *    stale bank statement is the exact failure this system exists to prevent."
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * So this file contains arithmetic and nothing else. No model call, no
 * confidence score, no heuristic, no "probably still fine". Given a document,
 * a rule and a date, the answer is the same every time.
 *
 * ── Where the rule comes from ─────────────────────────────────────────────
 *
 * NOT from here. There is no `31` in this file.
 *
 * The number is a requirement, and requirements carry provenance and must be
 * verified before use (ADR-0009). A visa rule is `critical`, so it needs
 * corroboration from both the human-reviewed knowledge base AND the
 * university's or UKVI's official source. `ruleFromRequirement` is the only way
 * to build a rule, and it accepts only a `VerifiedRequirement`.
 *
 * That closes the loop Vahid asked for: the system cannot apply a recency
 * window it cannot cite.
 */

import type { Brand, VerifiedRequirement } from "@askimate/aas-domain";

/** How a document's validity is constrained. */
export type ValidityRuleKind =
  /**
   * The document must be dated no more than N days before the reference date.
   * The UK Student visa financial-evidence window is this shape.
   */
  | "recency_window"
  /** The document carries its own expiry date, which must not have passed. */
  | "expiry_date"
  /** The document must cover a continuous period of at least N days. */
  | "minimum_coverage"
  /** The document must have been issued within N months of the reference date. */
  | "issued_within";

interface ValidityRuleFields {
  readonly kind: ValidityRuleKind;
  /** Days for `recency_window` / `minimum_coverage`; months for `issued_within`. */
  readonly value: number;
  /** The verified requirement this came from. A rule with no citation is not a rule. */
  readonly requirementId: string;
  /** Plain-language statement, for the student and the audit trail. */
  readonly statement: string;
}

/**
 * A rule the engine will apply.
 *
 * BRANDED, so `ruleFromRequirement` really is the only way to build one. An
 * engineer cannot hand-write `{ kind: "recency_window", value: 31, … }` with a
 * made-up citation and have the engine accept it — that would reintroduce
 * exactly the "AI or an engineer as the source of truth" problem Vahid ruled
 * out, wearing the costume of a config object.
 */
export type ValidityRule = Brand<ValidityRuleFields, "ValidityRule">;

/** The dates a document carries. All optional — many documents have few. */
export interface DocumentDates {
  /** When the document was issued or produced. */
  readonly issuedAt?: Date;
  /** When it stops being valid on its own terms (e.g. passport expiry). */
  readonly expiresAt?: Date;
  /** Start of the period it covers (e.g. bank statement period). */
  readonly coversFrom?: Date;
  /** End of that period. For a bank statement this is the date that matters. */
  readonly coversTo?: Date;
}

/** Why a document is not valid. */
export type InvalidityReason =
  | "outside_recency_window"
  | "expired"
  | "insufficient_coverage"
  | "issued_too_long_ago"
  | "required_date_missing";

export type ValidityAssessment =
  | {
      readonly valid: true;
      readonly rule: ValidityRule;
      /** When this document stops satisfying the rule. Drives proactive prompts. */
      readonly validUntil?: Date;
    }
  | {
      readonly valid: false;
      readonly rule: ValidityRule;
      readonly reason: InvalidityReason;
      readonly detail: string;
    };

const MS_PER_DAY = 86_400_000;

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Assesses one document against one rule, as at `asOf`.
 *
 * Pure arithmetic. Deterministic. Runs before anything else looks at the
 * document.
 */
export function assessValidity(
  dates: DocumentDates,
  rule: ValidityRule,
  asOf: Date,
): ValidityAssessment {
  switch (rule.kind) {
    case "recency_window": {
      // The date that matters is the END of the period a document covers — a
      // bank statement covering January to June is "dated" June, not January.
      // Falling back to issuedAt covers documents with no period at all.
      const effectiveDate = dates.coversTo ?? dates.issuedAt;
      if (effectiveDate === undefined) {
        return missingDate(rule, "The document has no statement date or issue date to measure from.");
      }

      const age = daysBetween(effectiveDate, asOf);

      // A future-dated document is not "very fresh" — it is wrong, and treating
      // it as valid would let a mis-read date sail through.
      if (age < 0) {
        return {
          valid: false,
          rule,
          reason: "outside_recency_window",
          detail:
            `The document is dated ${iso(effectiveDate)}, which is in the future relative to ` +
            `${iso(asOf)}. This needs checking before the document can be used.`,
        };
      }

      if (age > rule.value) {
        return {
          valid: false,
          rule,
          reason: "outside_recency_window",
          detail:
            `The document is dated ${iso(effectiveDate)}, which is ${String(age)} days before ` +
            `${iso(asOf)}. ${rule.statement} A more recent document is needed.`,
        };
      }

      return {
        valid: true,
        rule,
        validUntil: new Date(effectiveDate.getTime() + rule.value * MS_PER_DAY),
      };
    }

    case "expiry_date": {
      if (dates.expiresAt === undefined) {
        return missingDate(rule, "The document has no expiry date recorded.");
      }
      if (dates.expiresAt <= asOf) {
        return {
          valid: false,
          rule,
          reason: "expired",
          detail: `The document expired on ${iso(dates.expiresAt)}. ${rule.statement}`,
        };
      }
      return { valid: true, rule, validUntil: dates.expiresAt };
    }

    case "minimum_coverage": {
      if (dates.coversFrom === undefined || dates.coversTo === undefined) {
        return missingDate(rule, "The document does not record the period it covers.");
      }
      const coverage = daysBetween(dates.coversFrom, dates.coversTo);
      if (coverage < rule.value) {
        return {
          valid: false,
          rule,
          reason: "insufficient_coverage",
          detail:
            `The document covers ${String(coverage)} days ` +
            `(${iso(dates.coversFrom)} to ${iso(dates.coversTo)}). ${rule.statement}`,
        };
      }
      return { valid: true, rule };
    }

    case "issued_within": {
      if (dates.issuedAt === undefined) {
        return missingDate(rule, "The document has no issue date recorded.");
      }
      const cutoff = new Date(asOf);
      cutoff.setUTCMonth(cutoff.getUTCMonth() - rule.value);
      if (dates.issuedAt < cutoff) {
        return {
          valid: false,
          rule,
          reason: "issued_too_long_ago",
          detail: `The document was issued on ${iso(dates.issuedAt)}. ${rule.statement}`,
        };
      }
      return { valid: true, rule };
    }
  }
}

function missingDate(rule: ValidityRule, detail: string): ValidityAssessment {
  // A missing date is NOT valid. The safe direction is always "we cannot
  // confirm this is valid", never "we found no reason to doubt it".
  return { valid: false, rule, reason: "required_date_missing", detail };
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Assesses a document against every rule that applies to it.
 *
 * A document is valid only if it satisfies ALL of them. One failing rule is
 * enough — there is no weighting and no majority.
 */
export function assessAll(
  dates: DocumentDates,
  rules: readonly ValidityRule[],
  asOf: Date,
): readonly ValidityAssessment[] {
  return rules.map((rule) => assessValidity(dates, rule, asOf));
}

/** True only when every rule passes. */
export function isValid(assessments: readonly ValidityAssessment[]): boolean {
  return assessments.every((assessment) => assessment.valid);
}

/** The assessments that failed, for explaining the problem to the student. */
export function failures(
  assessments: readonly ValidityAssessment[],
): readonly Extract<ValidityAssessment, { valid: false }>[] {
  return assessments.filter(
    (assessment): assessment is Extract<ValidityAssessment, { valid: false }> => !assessment.valid,
  );
}

/**
 * The earliest date at which the document stops satisfying its rules.
 *
 * Used to prompt the student BEFORE a document goes stale, rather than
 * discovering it at submission. `null` when nothing expires.
 */
export function validUntil(assessments: readonly ValidityAssessment[]): Date | null {
  // The first filter narrows to the valid branch (TypeScript infers the
  // predicate), so `validUntil` is directly readable here.
  const dates = assessments
    .filter((assessment) => assessment.valid)
    .map((assessment) => assessment.validUntil)
    .filter((date): date is Date => date !== undefined);

  if (dates.length === 0) return null;
  return dates.reduce((earliest, date) => (date < earliest ? date : earliest));
}

/**
 * Builds a rule from a verified requirement.
 *
 * The ONLY way to construct a `ValidityRule`. It takes a `VerifiedRequirement`,
 * which `@askimate/aas-domain` mints only for a requirement that has passed its
 * evidence bar — corroborated by both the curated knowledge base and the
 * official source, for anything `critical`.
 *
 * So the system cannot apply a recency window it cannot cite, and cannot invent
 * one. That is the whole point: the engine is deterministic, and the number it
 * is deterministic *about* is sourced and verified elsewhere.
 */
export function ruleFromRequirement(input: {
  readonly requirement: VerifiedRequirement;
  readonly kind: ValidityRuleKind;
  readonly value: number;
  readonly statement: string;
}): ValidityRule {
  if (!Number.isFinite(input.value) || input.value <= 0) {
    throw new RangeError(`A validity rule value must be a positive number, received: ${String(input.value)}`);
  }
  // The one sanctioned construction. Legitimate here and nowhere else, because
  // it is unreachable without a VerifiedRequirement — which the domain mints
  // only for a requirement that passed its evidence bar (ADR-0009).
  return {
    kind: input.kind,
    value: input.value,
    requirementId: input.requirement.requirementId,
    statement: input.statement,
  } as ValidityRule;
}
