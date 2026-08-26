/**
 * Document retention (ADR-0010).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "Do not invent a fixed retention period simply because we need a number for
 *  the schema."                                           — Vahid, 2026-08-26
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * So there are no retention periods in this file. Retention is CONFIGURATION,
 * supplied from the deployment's documented retention schedule, which is
 * finalised against ICO guidance before production.
 *
 * ── The design decision that matters most ─────────────────────────────────
 *
 * THERE IS NO DEFAULT, AND ABSENCE OF POLICY IS NOT PERMISSION TO KEEP.
 *
 * If no policy is configured for a document type, the vault REFUSES TO STORE
 * it. It does not fall back to "keep indefinitely".
 *
 * That is deliberate and it is the whole point. "Kept forever because nobody
 * configured it" is the characteristic UK GDPR failure: storage limitation and
 * data minimisation are breached silently, by omission, and nothing in the
 * system ever complains. Failing loudly at storage time surfaces the gap in
 * development, where it costs an afternoon — rather than in a subject access
 * request.
 */

/** What kind of document this is. Retention differs per type. */
export type DocumentType =
  | "passport"
  | "national_id"
  | "birth_certificate"
  | "bank_statement"
  | "sponsorship_letter"
  | "academic_transcript"
  | "degree_certificate"
  | "english_test_certificate"
  | "personal_statement"
  | "reference_letter"
  | "parental_consent"
  | "guardianship_document"
  | "visa_document"
  | "other";

/** Why we hold it. The same document type can have different rules per purpose. */
export type RetentionPurpose =
  | "application_submission"
  | "identity_verification"
  | "financial_evidence"
  | "minor_safeguarding"
  | "audit_evidence";

/** What starts the retention clock. */
export type RetentionTrigger =
  | "submission_confirmed"
  | "case_cancelled"
  | "case_failed"
  | "last_used";

/** What happens when the period elapses. */
export type PostRetentionAction = "delete" | "anonymise";

export interface RetentionPolicy {
  readonly documentType: DocumentType;
  readonly purpose: RetentionPurpose;
  readonly trigger: RetentionTrigger;
  /** How long after the trigger. Supplied by configuration, never hardcoded. */
  readonly retainForDays: number;
  readonly action: PostRetentionAction;
  /**
   * What a right-to-erasure request removes.
   *
   *   full            — the object goes; the audit keeps its ID and hash
   *   redact_contents — contents go, structured metadata stays
   *   retain_for_legal_obligation — cannot be erased; MUST cite the obligation
   */
  readonly erasureBehaviour: "full" | "redact_contents" | "retain_for_legal_obligation";
  /** Required when erasure is refused. A refusal without a citation is not a policy. */
  readonly legalBasis?: string;
  /** Where this rule comes from, for the data-protection review. */
  readonly policyReference: string;
}

/** The configured schedule. Supplied at deployment, reviewable as one artefact. */
export interface RetentionSchedule {
  readonly version: string;
  readonly approvedAt: Date;
  readonly approvedBy: string;
  readonly policies: readonly RetentionPolicy[];
}

/** Raised when a document type has no configured policy. */
export class RetentionPolicyMissingError extends Error {
  public override readonly name = "RetentionPolicyMissingError";
  public constructor(
    public readonly documentType: DocumentType,
    public readonly purpose: RetentionPurpose,
  ) {
    super(
      `No retention policy is configured for ${documentType} held for ${purpose}. ` +
        `The document cannot be stored. Add a policy to the retention schedule — ` +
        `storing personal data with no defined retention period is not permitted.`,
    );
  }
}

/** Finds the policy, or `null`. Prefer `requirePolicy` at storage time. */
export function findPolicy(
  schedule: RetentionSchedule,
  documentType: DocumentType,
  purpose: RetentionPurpose,
): RetentionPolicy | null {
  return (
    schedule.policies.find(
      (policy) => policy.documentType === documentType && policy.purpose === purpose,
    ) ?? null
  );
}

/**
 * The gate at storage time. Throws when no policy exists.
 *
 * Deliberately throws rather than returning a default. There is no safe default
 * for "how long may we keep this person's passport", and inventing one is the
 * exact thing ADR-0010 forbids.
 */
export function requirePolicy(
  schedule: RetentionSchedule,
  documentType: DocumentType,
  purpose: RetentionPurpose,
): RetentionPolicy {
  const policy = findPolicy(schedule, documentType, purpose);
  if (policy === null) throw new RetentionPolicyMissingError(documentType, purpose);
  return policy;
}

/** A hold that suspends deletion. */
export interface LegalHold {
  readonly reason: string;
  /** The named person accountable for lifting it. A hold with no owner becomes permanent. */
  readonly ownerId: string;
  readonly placedAt: Date;
  /** When the hold must be reviewed. Indefinite holds are how "temporary" becomes "forever". */
  readonly reviewBy: Date;
}

export type RetentionDecision =
  | { readonly action: "retain"; readonly until: Date }
  | { readonly action: "delete" }
  | { readonly action: "anonymise" }
  | { readonly action: "hold"; readonly hold: LegalHold };

/** Whether a document is due for its post-retention action as at `now`. */
export function decideRetention(input: {
  readonly policy: RetentionPolicy;
  readonly triggeredAt: Date | null;
  readonly now: Date;
  readonly legalHold?: LegalHold;
}): RetentionDecision {
  // A hold beats everything. It does not extend the period — it suspends the
  // action, and the hold's own review date is what stops it drifting.
  if (input.legalHold !== undefined) {
    return { action: "hold", hold: input.legalHold };
  }

  // The clock has not started, so nothing is due yet.
  if (input.triggeredAt === null) {
    return { action: "retain", until: input.now };
  }

  const dueAt = new Date(input.triggeredAt.getTime() + input.policy.retainForDays * 86_400_000);
  if (input.now < dueAt) return { action: "retain", until: dueAt };

  return input.policy.action === "delete" ? { action: "delete" } : { action: "anonymise" };
}

/**
 * Checks a schedule for internal consistency.
 *
 * Run at deployment. A schedule that refuses erasure without citing a legal
 * obligation, or that sets a non-positive period, is a configuration error and
 * should stop the deploy rather than reaching production.
 */
export function validateSchedule(schedule: RetentionSchedule): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const policy of schedule.policies) {
    const key = `${policy.documentType}:${policy.purpose}`;
    if (seen.has(key)) {
      problems.push(`Duplicate policy for ${key}. Exactly one policy must apply.`);
    }
    seen.add(key);

    if (!Number.isInteger(policy.retainForDays) || policy.retainForDays < 1) {
      problems.push(`${key}: retainForDays must be a positive integer, got ${String(policy.retainForDays)}.`);
    }

    if (policy.erasureBehaviour === "retain_for_legal_obligation" && policy.legalBasis === undefined) {
      problems.push(
        `${key}: refuses erasure but cites no legal obligation. A refusal without a citation ` +
          `is not a lawful basis.`,
      );
    }

    if (policy.policyReference.trim().length === 0) {
      problems.push(`${key}: policyReference is empty. Every rule must be traceable to the schedule.`);
    }
  }

  return problems;
}
