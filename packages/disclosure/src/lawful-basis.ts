/**
 * The lawful basis for processing — recorded, never assumed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-26: *"Do NOT encode 'student consent' as automatically being
 * the legal basis for all processing… Do not invent a universal legal rule
 * that 'student consent is always sufficient'."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * That instruction rules out the obvious shortcut, which is a `consented:
 * boolean` on a document. It is a shortcut worth understanding, because it is
 * wrong in both directions:
 *
 *   • **Consent is often the WRONG basis.** Under UK GDPR, consent must be
 *     freely given — and a student who cannot get their application submitted
 *     without agreeing has not freely given anything. Contract (Art. 6(1)(b))
 *     is frequently the better fit for the application itself.
 *
 *   • **Consent is often NOT ENOUGH.** A passport carries special-category
 *     data in some contexts; a minor's data brings its own conditions; and
 *     "the student agreed to us holding it" is a different question from "the
 *     student agreed to us sending it to this university".
 *
 * So this file models the *determination* rather than the *answer*. A human
 * with the relevant competence decides, records what they decided and why, and
 * the system carries it. There is no default and no fallback.
 *
 * ── What this file is not ─────────────────────────────────────────────────
 *
 * It is not legal advice and does not encode any. It is the shape a
 * determination has to take so that it can be recorded, cited and audited —
 * and so that a piece of processing without one cannot proceed.
 */

import type { Brand } from "@askimate/aas-domain";

/** The UK GDPR Article 6 bases. Named, so a determination cites one. */
export type Article6Basis =
  | "consent"
  | "contract"
  | "legal_obligation"
  | "vital_interests"
  | "public_task"
  | "legitimate_interests";

/**
 * Article 9 conditions, for special-category data.
 *
 * Present because it is genuinely reachable here — a document supporting a
 * disability adjustment, or a medical reason for a deferred entry, is special
 * category. An Article 6 basis alone does not cover it.
 */
export type Article9Condition =
  | "explicit_consent"
  | "employment_social_security"
  | "vital_interests"
  | "legitimate_activities"
  | "public_by_data_subject"
  | "legal_claims"
  | "substantial_public_interest"
  | "health_or_social_care"
  | "public_health"
  | "archiving_research_statistics";

/** What is being done, and to what. */
export interface ProcessingActivity {
  /** e.g. `store_identity_document`, `disclose_document_to_institution`. */
  readonly activity: string;
  /** What the activity is for, in plain words a student would recognise. */
  readonly purpose: string;
  readonly documentTypes: readonly string[];
}

/**
 * A recorded determination of the lawful basis for one activity.
 *
 * Note what is mandatory: a named human, a date, and the reasoning. A
 * determination nobody can be asked about is not a determination.
 */
export interface LawfulBasisDeterminationRecord {
  readonly determinationId: string;
  readonly activity: ProcessingActivity;
  readonly article6: Article6Basis;
  /** Required when the activity can touch special-category data. */
  readonly article9?: Article9Condition;
  /**
   * Whether this activity ALSO needs specific authorisation from the student
   * on top of the lawful basis.
   *
   * These are different questions and conflating them is the mistake this
   * whole file exists to prevent. "We may lawfully process this" does not
   * answer "may we send this particular document to this particular
   * university" — and the second is the one a student would expect to be
   * asked.
   */
  readonly requiresStudentAuthorisation: boolean;
  /** The named person who determined it. Never a shared account. */
  readonly determinedBy: string;
  readonly determinedAt: Date;
  /** Why. Cited so it can be reviewed, challenged and re-decided. */
  readonly reasoning: string;
  /** When this must be looked at again. */
  readonly reviewBy: Date;
}

/**
 * A determination that may actually be relied on.
 *
 * Branded, so `determineLawfulBasis` is the only way to get one and every
 * downstream check takes this type rather than the raw record.
 */
export type LawfulBasisDetermination = Brand<
  LawfulBasisDeterminationRecord,
  "LawfulBasisDetermination"
>;

export type DeterminationRefusal =
  | { readonly kind: "no_reasoning"; readonly detail: string }
  | { readonly kind: "no_determiner"; readonly detail: string }
  | { readonly kind: "expired"; readonly detail: string }
  | { readonly kind: "consent_without_authorisation"; readonly detail: string };

export type DeterminationCheck =
  | { readonly valid: true; readonly determination: LawfulBasisDetermination }
  | { readonly valid: false; readonly refusal: DeterminationRefusal };

/**
 * Validates a determination and makes it usable.
 *
 * The fourth check is the interesting one: a determination that names
 * **consent** as its basis and then says no student authorisation is needed is
 * self-contradictory. Consent that was never asked for is not consent, and a
 * record claiming it would be worse than having no record at all — it would
 * look like compliance.
 */
export function determineLawfulBasis(
  record: LawfulBasisDeterminationRecord,
  now: Date,
): DeterminationCheck {
  if (record.reasoning.trim().length === 0) {
    return {
      valid: false,
      refusal: {
        kind: "no_reasoning",
        detail:
          `Determination ${record.determinationId} records no reasoning. A basis nobody can be ` +
          `asked to justify is not a determination.`,
      },
    };
  }

  if (record.determinedBy.trim().length === 0) {
    return {
      valid: false,
      refusal: {
        kind: "no_determiner",
        detail: `Determination ${record.determinationId} names nobody who made it.`,
      },
    };
  }

  if (record.reviewBy.getTime() <= now.getTime()) {
    return {
      valid: false,
      refusal: {
        kind: "expired",
        detail:
          `Determination ${record.determinationId} was due for review on ` +
          `${record.reviewBy.toISOString().slice(0, 10)}. Law and circumstances change; a lapsed ` +
          `determination is not relied on.`,
      },
    };
  }

  if (record.article6 === "consent" && !record.requiresStudentAuthorisation) {
    return {
      valid: false,
      refusal: {
        kind: "consent_without_authorisation",
        detail:
          `Determination ${record.determinationId} relies on consent but records that no student ` +
          `authorisation is needed. Consent that was never asked for is not consent.`,
      },
    };
  }

  return { valid: true, determination: record as LawfulBasisDetermination };
}

/** Reads a determination, for a preview or an audit record. */
export function determinationOf(
  determination: LawfulBasisDetermination,
): LawfulBasisDeterminationRecord {
  return determination;
}

/**
 * The determinations a deployment holds, by activity.
 *
 * Deliberately a lookup that can MISS. An activity with no determination is
 * not permitted — the same shape as the retention schedule (ADR-0010), and for
 * the same reason: absence of a decision is not permission.
 */
export class LawfulBasisRegister {
  readonly #byActivity = new Map<string, LawfulBasisDetermination>();

  public register(determination: LawfulBasisDetermination): void {
    this.#byActivity.set(determinationOf(determination).activity.activity, determination);
  }

  public forActivity(activity: string): LawfulBasisDetermination | undefined {
    return this.#byActivity.get(activity);
  }

  public get activities(): readonly string[] {
    return [...this.#byActivity.keys()];
  }
}

export class NoLawfulBasisError extends Error {
  public override readonly name = "NoLawfulBasisError";
  public constructor(public readonly activity: string) {
    super(
      `No lawful basis has been determined for "${activity}". Nothing proceeds on the assumption ` +
        `that one exists — absence of a decision is not permission.`,
    );
  }
}

/** The determination for an activity, or a loud failure. */
export function requireLawfulBasis(
  register: LawfulBasisRegister,
  activity: string,
): LawfulBasisDetermination {
  const determination = register.forActivity(activity);
  if (determination === undefined) throw new NoLawfulBasisError(activity);
  return determination;
}
