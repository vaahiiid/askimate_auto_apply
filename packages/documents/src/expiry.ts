/**
 * When a held document is running out, and what the student does about it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * B5 is "hold and reuse" (ADR-0078), and this is the rule that makes holding
 * safe. A document kept for twelve months after its last use is a document
 * that can quietly go out of date between one application and the next, and
 * the student is the only person who can do anything about it.
 *
 * Vahid, 2026-09-07:
 *
 *   "Every document that carries an expiry date has that date recorded. When
 *    it approaches, the student is warned and chooses: proceed with the
 *    document as it is, or upload a new one. If they proceed, that is their
 *    decision and it is recorded with the exact wording they were shown."
 *
 *   "The warning threshold belongs to each document type's own rule, not to a
 *    single global number: a passport's threshold cannot be a bank
 *    statement's."
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Three properties, and each is structural rather than remembered ───────
 *
 *   the wording is the wording that was shown   `recordChoice` takes the
 *     WARNING, which is branded and carries its own text, so there is no
 *     parameter through which a different sentence could be recorded than the
 *     one the student read
 *
 *   it fires once                               the decision takes what was
 *     already warned; a run that has warned cannot warn again, and the caller
 *     cannot express "warn anyway"
 *
 *   every document type is classified           `EXPIRY_THRESHOLDS` is total
 *     over `DocumentType`, so a new type does not compile until somebody
 *     decides what its threshold is — the same mechanism ADR-0077 uses for
 *     the profile registry, for the same reason
 *
 * ── Why these live in code and not in the retention schedule ──────────────
 *
 * They are not retention periods. A retention period is a legal determination
 * with a basis, a determiner and a version history, and it belongs in
 * versioned configuration for exactly those reasons. A warning threshold is a
 * PRODUCT rule over a closed union that lives in code, and its most valuable
 * property — that a new document type cannot be added without one — can only
 * be enforced by the type system. Recorded here so that the choice is visible
 * and can be overridden rather than being an accident of where it was easiest
 * to put.
 */

import type { Brand, DocumentType } from "@askimate/aas-domain";

/**
 * What to do as a document type's expiry approaches.
 *
 * Four states and not three: "nobody has decided" must be expressible, and it
 * must not read as "no warning is needed" — the same distinction ADR-0023
 * makes for a retention requirement and ADR-0077 makes for a profile field.
 */
export type ExpiryThreshold =
  /** Warn this many days before the expiry date. */
  | {
      readonly kind: "warn_before";
      readonly days: number;
      /**
       * The obligation that must be discharged before this number is settled.
       *
       * Present on `english_test_certificate` only. Row 8 of decision sheet B1
       * carries an obligation to read the IELTS, PTE and Duolingo terms before
       * the first real submission, and those terms may constrain validity or
       * verification in a way that moves this number. Vahid, 2026-09-07: *"keep
       * that link explicit so the number cannot be treated as settled."*
       */
      readonly provisionalUntil?: string;
    }
  /** The document carries no expiry date. Warning about one would invent it. */
  | { readonly kind: "does_not_expire" }
  /** Deliberately no threshold, because the document type is out of scope. */
  | { readonly kind: "out_of_scope"; readonly reason: string }
  /** Nobody has decided. Blocks a warning rather than defaulting to silence. */
  | { readonly kind: "undetermined"; readonly owner: string };

/** Days, from months, so the reasoning below reads in the units it was decided in. */
const months = (count: number): number => count * 30;

/**
 * Every document type, and when its holder is warned.
 *
 * Determined by Vahid Mohammadi on 2026-09-07, on one principle: **the
 * threshold is the time a student needs to obtain a replacement**, not a fixed
 * fraction of the document's life.
 */
export const EXPIRY_THRESHOLDS = {
  /**
   * UK passport renewal is routinely about three weeks and can run to ten. Six
   * months also doubles as the warning that a visa route may refuse a passport
   * with less than six months' validity remaining at entry.
   */
  passport: { kind: "warn_before", days: months(6) },
  /** Usually renewable in-country in weeks, and the student is often there. */
  /**
   * Results take about two weeks, but a re-sit needs booking, preparation and
   * often travel. PROVISIONAL — see `provisionalUntil`.
   */
  english_test_certificate: {
    kind: "warn_before",
    days: months(4),
    provisionalUntil: "read_the_test_provider_terms",
  },

  // ── They do not expire. A threshold would invent a decay ───────────────
  birth_certificate: { kind: "does_not_expire" },
  degree_certificate: { kind: "does_not_expire" },
  academic_transcript: { kind: "does_not_expire" },
  /** Staleness here is a quality judgement, not an expiry, and it is theirs. */
  reference_letter: { kind: "does_not_expire" },
  personal_statement: { kind: "does_not_expire" },

  // ── Out of scope, and deliberately given nothing ───────────────────────
  /**
   * Vahid, 2026-09-07: *"Row 12 is out of scope and blocking, and giving it a
   * threshold makes it look half-ready. Leave it with nothing."* A bank
   * statement has a recency window rather than an expiry in any case, and
   * financial evidence is a visa requirement (ADR-0021).
   */
  bank_statement: {
    kind: "out_of_scope",
    reason:
      "B1 row 12 is unresolved and blocking. Financial evidence is a visa requirement rather " +
      "than a university application requirement (ADR-0021), and the visa path itself is shut on " +
      "compliance grounds (ADR-0080). A threshold would make it look half-ready.",
  },
  /**
   * Shut on COMPLIANCE grounds, which is a stronger reason than scope.
   *
   * Vahid, 2026-09-08: *"the entire visa path is outside this system's scope
   * until the OISC position is resolved, and that is a hard compliance
   * boundary in the business plan, not a scheduling gap… `undetermined` would
   * leave it open for someone to quietly decide later. `out_of_scope` says it
   * is deliberately shut."*
   *
   * The reason is ADR-0080's and not ADR-0021's, deliberately: ADR-0021 gives
   * a product-scope argument, and a product-scope argument is one a later
   * engineer could reasonably decide to overturn.
   */
  visa_document: {
    kind: "out_of_scope",
    reason:
      "ADR-0080 — the visa path is shut on compliance grounds until the OISC position is " +
      "resolved. Not a scheduling gap, and not a product-scope call anyone here can reverse.",
  },

  // ── Not yet decided, and saying so rather than guessing ────────────────
  sponsorship_letter: { kind: "undetermined", owner: "Vahid Mohammadi" },
  parental_consent: { kind: "undetermined", owner: "Vahid Mohammadi" },
  guardianship_document: { kind: "undetermined", owner: "Vahid Mohammadi" },
  other: { kind: "undetermined", owner: "Vahid Mohammadi" },
} as const satisfies Record<DocumentType, ExpiryThreshold>;

export function thresholdFor(documentType: DocumentType): ExpiryThreshold {
  return EXPIRY_THRESHOLDS[documentType];
}

/**
 * A warning the student was shown.
 *
 * BRANDED, and `decideExpiryWarning` is the only way to obtain one, for the
 * same reason `ValidityRule` is branded: the wording is the thing being
 * promised, and a hand-written object would let a caller record a sentence
 * nobody read.
 */
export type ExpiryWarning = Brand<
  {
    readonly documentType: DocumentType;
    readonly expiresAt: Date;
    readonly daysRemaining: number;
    /** Exactly what the student is shown. Recorded verbatim with their choice. */
    readonly wording: string;
    /** True while the threshold behind it is still provisional. */
    readonly provisional: boolean;
  },
  "ExpiryWarning"
>;

/** Why no warning is due. Distinct values, because they mean different things. */
export type NoWarningReason =
  | "not_yet_within_threshold"
  | "already_warned"
  | "does_not_expire"
  | "out_of_scope"
  | "threshold_undetermined"
  | "no_expiry_date_recorded"
  | "already_expired";

export type ExpiryDecision =
  | { readonly warn: true; readonly warning: ExpiryWarning }
  | { readonly warn: false; readonly because: NoWarningReason };

/**
 * Should the student be warned about this document, now?
 *
 * ── `alreadyWarnedAt` is what makes it fire once ──────────────────────────
 *
 * Vahid, 2026-09-07: *"the warning fires once, the student's choice is
 * recorded, and it does not repeat… a countdown that nags is one people learn
 * to dismiss."* There is deliberately no "warn anyway" parameter: a caller
 * that has warned cannot ask again, which is a property of this signature
 * rather than a rule somebody follows.
 *
 * `already_expired` is its own answer and NOT a warning. A document that has
 * expired is a validity failure — `assessValidity` refuses it — and telling
 * the student "this is about to expire" when it already has would be both
 * wrong and too late.
 */
export function decideExpiryWarning(input: {
  readonly documentType: DocumentType;
  readonly expiresAt: Date | null;
  readonly now: Date;
  readonly alreadyWarnedAt: Date | null;
}): ExpiryDecision {
  if (input.alreadyWarnedAt !== null) return { warn: false, because: "already_warned" };

  const threshold = thresholdFor(input.documentType);
  if (threshold.kind === "does_not_expire") return { warn: false, because: "does_not_expire" };
  if (threshold.kind === "out_of_scope") return { warn: false, because: "out_of_scope" };
  if (threshold.kind === "undetermined") {
    return { warn: false, because: "threshold_undetermined" };
  }

  if (input.expiresAt === null) return { warn: false, because: "no_expiry_date_recorded" };

  const daysRemaining = Math.floor(
    (input.expiresAt.getTime() - input.now.getTime()) / 86_400_000,
  );
  if (daysRemaining < 0) return { warn: false, because: "already_expired" };
  if (daysRemaining > threshold.days) return { warn: false, because: "not_yet_within_threshold" };

  const provisional = threshold.provisionalUntil !== undefined;
  return {
    warn: true,
    warning: {
      documentType: input.documentType,
      expiresAt: input.expiresAt,
      daysRemaining,
      wording: wordingFor(input.documentType, input.expiresAt, daysRemaining),
      provisional,
    } as ExpiryWarning,
  };
}

/**
 * What the student reads.
 *
 * Plain, specific, and it does not tell them what to do. Both options are real
 * — proceeding is a legitimate choice and the copy must not imply otherwise,
 * because the record of that choice is what makes it theirs.
 */
function wordingFor(documentType: DocumentType, expiresAt: Date, daysRemaining: number): string {
  const readable = documentType.replace(/_/g, " ");
  const when = expiresAt.toISOString().slice(0, 10);
  return (
    `Your ${readable} expires on ${when}, in ${String(daysRemaining)} days. ` +
    `You can carry on with it as it is, or upload a newer one. ` +
    `If you carry on, I will use this one and will not ask again.`
  );
}

/** What the student did about it. */
export type ExpiryChoice = "proceed" | "replace";

export interface ExpiryChoiceRecord {
  readonly documentType: DocumentType;
  readonly expiresAt: Date;
  readonly choice: ExpiryChoice;
  /** The exact sentence the student was shown. Copied from the warning. */
  readonly wordingShown: string;
  readonly decidedAt: Date;
  /** True when the threshold that produced the warning was still provisional. */
  readonly provisionalThreshold: boolean;
}

/**
 * Records what the student decided, against the warning they were shown.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * It takes the WARNING and not a string. That is the whole of *"recorded with
 * the exact wording they were shown"*: there is no parameter through which a
 * caller could record a sentence other than the one `decideExpiryWarning`
 * produced, and the warning cannot be hand-built because it is branded.
 *
 * A record that said "the student was warned" without saying what they read
 * would be evidence of nothing — which is the same argument ADR-0059 makes
 * about the preview a student authorises.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function recordChoice(
  warning: ExpiryWarning,
  choice: ExpiryChoice,
  decidedAt: Date,
): ExpiryChoiceRecord {
  return {
    documentType: warning.documentType,
    expiresAt: warning.expiresAt,
    choice,
    wordingShown: warning.wording,
    decidedAt,
    provisionalThreshold: warning.provisional,
  };
}

/**
 * Every document type whose threshold nobody has decided.
 *
 * A reviewed list computed rather than maintained, so it cannot go stale. Its
 * job is to be visible: an undetermined threshold means a held document can
 * silently reach its expiry with nobody warned.
 */
export function undeterminedThresholds(): readonly DocumentType[] {
  return (Object.keys(EXPIRY_THRESHOLDS) as DocumentType[]).filter(
    (type) => thresholdFor(type).kind === "undetermined",
  );
}

/** Every threshold still waiting on an obligation before it is settled. */
export function provisionalThresholds(): readonly {
  readonly documentType: DocumentType;
  readonly obligation: string;
}[] {
  return (Object.keys(EXPIRY_THRESHOLDS) as DocumentType[]).flatMap((type) => {
    const threshold = thresholdFor(type);
    return threshold.kind === "warn_before" && threshold.provisionalUntil !== undefined
      ? [{ documentType: type, obligation: threshold.provisionalUntil }]
      : [];
  });
}
