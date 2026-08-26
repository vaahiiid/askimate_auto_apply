/**
 * Identity check, minor detection, and the minor workflow (ADR-0011).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "Do not assume that parental consent is automatically the only legal
 *  requirement."                                          — Vahid, 2026-08-26
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * That instruction rules out the obvious implementation — a
 * `parentalConsent: boolean` on the case — because it would hardcode an
 * assumption about what the law and the university require, in the one area
 * where being wrong involves a child.
 *
 * Instead the conditions are DETERMINED per case, through the same multi-source
 * verification as any other requirement (ADR-0009). Anything concerning a minor
 * is `critical`, so it needs corroboration from both the human-reviewed
 * knowledge base and the university's official source.
 *
 *   Identity check → minor detected → conditions determined
 *     → consent / documentation collected → verified
 *     → continue ONLY when every condition is satisfied
 *
 * If the conditions cannot be determined, or cannot be satisfied and verified,
 * the case STOPS AND ESCALATES. It never assumes consent and never proceeds on
 * a partially satisfied set.
 */

// ───────────────────────────────────────────────────────────────────────────
// Date of birth
// ───────────────────────────────────────────────────────────────────────────

/**
 * How well the date of birth is established.
 *
 * Phase 0 found that AskiMate's `dateOfBirth` is a nullable, free-text,
 * unvalidated `TEXT` column. Minor detection cannot rest on that, so the level
 * of evidence is explicit.
 */
export type DobVerificationLevel =
  /** Not captured. */
  | "unknown"
  /**
   * The student said it, the agent interpreted it, and the student confirmed
   * the interpretation (ADR-0007).
   *
   * Enough to RAISE a suspicion of minority. NOT enough to conclude adulthood.
   */
  | "stated"
  /** Extracted from an identity document and confirmed. Sufficient. */
  | "document_verified";

export interface DateOfBirthRecord {
  readonly level: DobVerificationLevel;
  /** ISO-8601 date, present only once actually captured. */
  readonly value?: Date;
  /** The identity document it was verified against. ID only, never contents. */
  readonly documentId?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Age determination
// ───────────────────────────────────────────────────────────────────────────

/**
 * The outcome of asking "is this student a minor?".
 *
 * Note there is no `adult` member that can be reached without
 * `document_verified` evidence. That absence is the safety property.
 */
export type AgeDetermination =
  /** Confirmed 18 or over, on document-verified evidence. Proceed normally. */
  | { readonly kind: "adult_verified"; readonly ageAtReference: number }
  /** Confirmed under 18, on document-verified evidence. Minor workflow. */
  | { readonly kind: "minor_verified"; readonly ageAtReference: number }
  /**
   * Cannot conclude. An identity check is required before the case advances.
   *
   * Covers: no date of birth, a merely stated date of birth, and a stated date
   * of birth that suggests minority. All resolve the same way — check further.
   */
  | { readonly kind: "requires_identity_check"; readonly reason: string };

/** Whole years between two dates. */
function yearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const monthDelta = to.getUTCMonth() - from.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && to.getUTCDate() < from.getUTCDate())) {
    years -= 1;
  }
  return years;
}

/**
 * Determines whether the student is a minor.
 *
 * ── THE SAFETY PROPERTY ──────────────────────────────────────────────────
 *
 * This function NEVER returns `adult_verified` from an absent, unparseable, or
 * merely stated date of birth. Under-18 status is a legal safeguard: absence of
 * evidence that someone is a minor is not evidence that they are an adult.
 * Every ambiguous case resolves toward *check further*, never toward *proceed*.
 *
 * ── The reference date ───────────────────────────────────────────────────
 *
 * Age at application and age at course start can differ, and WHICH ONE APPLIES
 * is itself a determined requirement rather than something to hardcode
 * (ADR-0011). The caller passes the reference date the determined rule names;
 * both are available on the case.
 */
export function determineAge(dob: DateOfBirthRecord, referenceDate: Date): AgeDetermination {
  if (dob.level === "unknown" || dob.value === undefined) {
    return {
      kind: "requires_identity_check",
      reason: "No date of birth has been captured. The student's age cannot be established.",
    };
  }

  const age = yearsBetween(dob.value, referenceDate);

  if (dob.level === "stated") {
    // A stated date of birth is enough to suspect minority, never enough to
    // rule it out. Both branches lead to the identity check — the difference is
    // only what the message tells the specialist to expect.
    return {
      kind: "requires_identity_check",
      reason:
        age < 18
          ? `The student's stated date of birth indicates they are ${String(age)} and therefore a ` +
            `minor. This must be verified against an identity document before the minor workflow ` +
            `can proceed.`
          : `The student's date of birth is stated but not verified against an identity document. ` +
            `Adulthood cannot be concluded from a stated value.`,
    };
  }

  return age < 18
    ? { kind: "minor_verified", ageAtReference: age }
    : { kind: "adult_verified", ageAtReference: age };
}

/** True when the case must not advance until an identity check has happened. */
export function requiresIdentityCheck(determination: AgeDetermination): boolean {
  return determination.kind === "requires_identity_check";
}

/** True when the minor workflow applies. */
export function isMinor(determination: AgeDetermination): boolean {
  return determination.kind === "minor_verified";
}

// ───────────────────────────────────────────────────────────────────────────
// Minor conditions — determined, never assumed
// ───────────────────────────────────────────────────────────────────────────

/**
 * A condition that must be satisfied because the applicant is a minor.
 *
 * Deliberately open-ended and NOT a fixed list, because Vahid's instruction is
 * that parental consent must not be assumed to be the only requirement. What
 * actually applies varies by UK data-protection rules, the university's own
 * rules, and the application route — so it is resolved per case by the
 * Requirements Service (Phase 4), not baked in here.
 */
export interface MinorCondition {
  readonly conditionId: string;
  /** What must be done, in terms a student and a specialist both understand. */
  readonly description: string;
  /**
   * Where this condition comes from. Every condition must cite a source — a
   * condition nobody can trace is an assumption wearing a badge.
   */
  readonly derivedFrom: "uk_data_protection" | "institution_policy" | "application_route" | "visa_rule";
  /** The verified requirement that established it (ADR-0009). */
  readonly requirementId: string;
  readonly satisfaction: ConditionSatisfaction;
}

export type ConditionSatisfaction =
  /** Determined but not yet acted on. */
  | { readonly state: "outstanding" }
  /** Something was collected; it has NOT yet been verified. */
  | { readonly state: "collected"; readonly documentId?: string; readonly collectedAt: Date }
  /** Collected AND verified by a named specialist. Only this counts. */
  | {
      readonly state: "verified";
      readonly documentId?: string;
      readonly verifiedBy: string;
      readonly verifiedAt: Date;
    }
  /** Could not be satisfied. Blocks the case; escalate. */
  | { readonly state: "failed"; readonly reason: string };

/** The determined set of conditions for one minor's application. */
export interface MinorConditionSet {
  /**
   * Whether the conditions could be determined at all.
   *
   * `false` means the Requirements Service could not establish what applies —
   * which BLOCKS the case. An undetermined set is not an empty set.
   */
  readonly determined: boolean;
  readonly conditions: readonly MinorCondition[];
  readonly determinedAt?: Date;
  /** Why determination failed, when it did. */
  readonly undeterminedReason?: string;
}

export type MinorGateResult =
  | { readonly permitted: true }
  | {
      readonly permitted: false;
      readonly reason: "conditions_undetermined" | "conditions_outstanding" | "conditions_failed";
      readonly detail: string;
      readonly outstandingConditionIds: readonly string[];
    };

/**
 * The hard gate: may a case involving a minor proceed?
 *
 * Independent of, and additional to, the mandatory human review that anything
 * involving a minor already triggers (brief §2.5). Passing review does not
 * satisfy this gate, and satisfying this gate does not skip review. Both must
 * hold.
 */
export function checkMinorGate(conditionSet: MinorConditionSet): MinorGateResult {
  // An undetermined set is not an empty set. If we could not work out what
  // applies, we must not proceed as though nothing does — that would be exactly
  // the assumption Vahid ruled out.
  if (!conditionSet.determined) {
    return {
      permitted: false,
      reason: "conditions_undetermined",
      detail:
        conditionSet.undeterminedReason ??
        "The requirements that apply to a minor for this application could not be determined. " +
          "The case cannot proceed on an assumption about what is required.",
      outstandingConditionIds: [],
    };
  }

  const failed = conditionSet.conditions.filter((c) => c.satisfaction.state === "failed");
  if (failed.length > 0) {
    return {
      permitted: false,
      reason: "conditions_failed",
      detail:
        `${String(failed.length)} condition(s) required for a minor could not be satisfied. ` +
        `The case must be escalated rather than proceeding.`,
      outstandingConditionIds: failed.map((c) => c.conditionId),
    };
  }

  // "collected" is not "verified". Something handed over but never checked does
  // not satisfy a legal safeguard.
  const notVerified = conditionSet.conditions.filter((c) => c.satisfaction.state !== "verified");
  if (notVerified.length > 0) {
    return {
      permitted: false,
      reason: "conditions_outstanding",
      detail:
        `${String(notVerified.length)} condition(s) required for a minor are not yet collected and ` +
        `verified. Every condition must be satisfied before the application proceeds.`,
      outstandingConditionIds: notVerified.map((c) => c.conditionId),
    };
  }

  return { permitted: true };
}
