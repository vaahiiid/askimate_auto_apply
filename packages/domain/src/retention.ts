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

/**
 * WHY we may keep something this long.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Three genuinely different things, and conflating them is the mistake.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Vahid, 2026-08-26: *"clearly distinguish legal requirement, operational
 * requirement and our own policy decision."*
 *
 * The distinction is not bureaucratic. It decides what happens when someone
 * challenges the period:
 *
 *   legal_requirement       we cannot shorten it. Cite the statute.
 *   operational_requirement we could shorten it, at a cost to the student or
 *                           to a process — so the cost is the justification.
 *   policy_decision         we chose it, under storage limitation, and we must
 *                           be able to explain why THAT long and not less.
 *
 * Most retention in this system is the third kind. UK GDPR does not prescribe
 * periods for passports or transcripts; Article 5(1)(e) requires that personal
 * data be kept no longer than is necessary for the purpose, and Article 5(2)
 * requires the controller to be able to demonstrate that. The period is
 * therefore ours to justify, which is a heavier duty than being told a number,
 * not a lighter one.
 */
export type RetentionBasisKind =
  /** A statute or regulation prescribes it. We cannot shorten it. */
  | "legal_requirement"
  /** A university, UKVI or process needs it this long. We could shorten it, at a cost. */
  | "operational_requirement"
  /** Our own justified choice under storage limitation. Must survive "why not less?". */
  | "policy_decision";

/**
 * The evidence behind a period.
 *
 * Every field is mandatory, including who read the source and when. A basis
 * nobody can be asked about is not a basis — it is a number with a footnote.
 */
export interface RetentionBasis {
  readonly kind: RetentionBasisKind;
  /** What the source actually says, in its own terms. */
  readonly statement: string;
  /**
   * Whether this period is held up by "establishing, exercising or defending
   * legal claims".
   *
   * ═══════════════════════════════════════════════════════════════════════
   * DECLARED, NOT INFERRED — and the answer to it is already determined.
   *
   * Vahid, 2026-09-07: *"we do not rely on 'establishing, exercising or
   * defending legal claims' as a retention purpose for documents. We do rely
   * on it for the audit record — the transmission record, preview hash and
   * authorisation text."*
   *
   * The reasoning, recorded because the period is ours to justify: WHAT THE
   * STUDENT AUTHORISED IS PROVABLE FROM THE RECORD WITHOUT THE SCAN. The
   * preview hash says what was put in front of them, the authorisation text
   * says what they agreed to, and the transmission record says what was
   * actually sent. A passport scan adds nothing to that proof and adds six
   * years of the highest-consequence data this system could hold.
   *
   * A boolean the author must state, rather than something `validateSchedule`
   * infers by looking for "Limitation Act" in the statement. A period that
   * leans on the limitation period without saying so is exactly what this is
   * meant to catch, and a string search would miss the one that phrased it
   * differently while feeling like a control.
   * ═══════════════════════════════════════════════════════════════════════
   */
  readonly reliesOnLegalClaims: boolean;
  /**
   * Where it comes from, precisely enough for someone else to find it.
   *
   * A statute section, a named ICO guidance page, a university's own published
   * requirement, or an internal policy document with a version.
   */
  readonly authoritativeSource: string;
  /** Who read that source. Never a shared account. */
  readonly verifiedBy: string;
  readonly verifiedAt: Date;
}

export interface RetentionPolicy {
  readonly documentType: DocumentType;
  readonly purpose: RetentionPurpose;
  readonly trigger: RetentionTrigger;
  /** How long after the trigger. Supplied by configuration, never hardcoded. */
  readonly retainForDays: number;
  /** Why this long. Mandatory — see `RetentionBasis`. */
  readonly basis: RetentionBasis;
  /** When this policy must be looked at again. Periods go stale as law and practice change. */
  readonly reviewBy: Date;
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

/**
 * A retention question nobody has answered yet.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FIRST-CLASS, AND ALWAYS BLOCKING.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Vahid: *"Where an exact retention period cannot responsibly be determined
 * from an authoritative source, do not guess. Instead: record the requirement
 * as unresolved, identify the authoritative source needed…"*
 *
 * The alternative — leaving a gap — is indistinguishable from nobody having
 * thought about it, and it is how "we will decide later" becomes "we never
 * decided". An unresolved entry is a decision to NOT decide yet, recorded, with
 * a name against it.
 *
 * It blocks storage exactly as a missing policy does. That is deliberate: an
 * unresolved requirement is strictly worse than a missing one, because someone
 * has looked and found that they cannot responsibly say.
 */
export interface UnresolvedRetentionRequirement {
  readonly documentType: DocumentType;
  readonly purpose: RetentionPurpose;
  /** What specifically is not known. */
  readonly question: string;
  /** The source that would answer it, named precisely enough to go and get. */
  readonly authoritativeSourceNeeded: string;
  /** Our current reading of which kind of answer this will be. Marked as a reading. */
  readonly expectedBasisKind: RetentionBasisKind | "unknown";
  /** Who must obtain the answer. A question with no owner is a question nobody asks. */
  readonly owner: string;
  readonly raisedBy: string;
  readonly raisedAt: Date;
}

/**
 * A cross-cutting answer that constrains the periods, decided once.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Separate from `RetentionPolicy` because it is not a period. Several
 * unresolved entries name the same open question — decision sheet B1 puts one
 * of them above the whole table, because the answer moves most of the rows —
 * and answering it in twelve places is twelve chances to answer it twelve
 * ways.
 *
 * A determination is recorded WITH a determiner and a date for the same reason
 * a `RetentionBasis` is: an answer nobody can be asked about is not an answer.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface RetentionDetermination {
  /** Cited by the policies it governs. */
  readonly id: string;
  /** What was asked, in the form it was asked. */
  readonly question: string;
  /** What was decided. */
  readonly answer: string;
  /** Why. This is what a subject access request or a regulator eventually reads. */
  readonly reasoning: string;
  /** Who decided. Never a shared account, and never "the team". */
  readonly determinedBy: string;
  readonly determinedAt: Date;
}

/**
 * One version of the schedule.
 *
 * Versioned and superseding rather than edited in place, because "what was our
 * retention policy in March?" is a question a regulator can ask and an edited
 * document cannot answer.
 */
export interface RetentionSchedule {
  readonly version: string;
  readonly approvedAt: Date;
  readonly approvedBy: string;
  /** From when this version governs. */
  readonly effectiveFrom: Date;
  /** The version this replaces, where it replaces one. */
  readonly supersedes?: string;
  readonly policies: readonly RetentionPolicy[];
  /**
   * Questions deliberately left open.
   *
   * Present on the schedule rather than in a separate list, so a reviewer sees
   * what is decided and what is not in one artefact.
   */
  readonly unresolved: readonly UnresolvedRetentionRequirement[];
  /**
   * Cross-cutting answers this version was written under.
   *
   * On the schedule for the same reason `unresolved` is: a reviewer sees what
   * is decided, what is open, and what constrains both, in one artefact.
   */
  readonly determinations: readonly RetentionDetermination[];
}

/**
 * The versions, in order, as one auditable history.
 *
 * `effectiveFor` answers "what governed on this date?", which is the question
 * that matters when a document stored a year ago comes up for deletion.
 */
export interface RetentionScheduleHistory {
  readonly versions: readonly RetentionSchedule[];
}

/** The version governing at a given moment, or `null` before the first one. */
export function effectiveFor(
  history: RetentionScheduleHistory,
  at: Date,
): RetentionSchedule | null {
  const applicable = history.versions
    .filter((version) => version.effectiveFrom.getTime() <= at.getTime())
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return applicable[0] ?? null;
}

/**
 * Raised when someone has looked at this and cannot yet responsibly say.
 *
 * Distinct from `RetentionPolicyMissingError`, because the response differs:
 * a missing policy needs someone to write one, and this needs someone to go
 * and read a specific source.
 */
export class RetentionRequirementUnresolvedError extends Error {
  public override readonly name = "RetentionRequirementUnresolvedError";
  public constructor(public readonly requirement: UnresolvedRetentionRequirement) {
    super(
      `The retention period for ${requirement.documentType} held for ${requirement.purpose} is ` +
        `UNRESOLVED, so the document cannot be stored.\n\n` +
        `Open question: ${requirement.question}\n` +
        `Answered by: ${requirement.authoritativeSourceNeeded}\n` +
        `Owner: ${requirement.owner}\n\n` +
        `This is not a gap. Someone looked and recorded that they could not responsibly say — ` +
        `guessing here would be worse than stopping.`,
    );
  }
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
  // An open question is checked FIRST, so the caller gets the useful error —
  // "go and read this source" rather than "write a policy" — when someone has
  // already established that the policy cannot yet be written.
  const unresolved = schedule.unresolved.find(
    (entry) => entry.documentType === documentType && entry.purpose === purpose,
  );
  if (unresolved !== undefined) throw new RetentionRequirementUnresolvedError(unresolved);

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
/**
 * The id the claims determination is recorded under.
 *
 * A constant rather than a literal in two places, because the check and the
 * configuration must agree about it or the check silently stops applying.
 */
export const CLAIMS_DETERMINATION_ID = "legal_claims_purpose";

export function validateSchedule(schedule: RetentionSchedule, now?: Date): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const determinationIds = new Set(schedule.determinations.map((entry) => entry.id));

  for (const determination of schedule.determinations) {
    if (determination.determinedBy.trim().length === 0) {
      problems.push(
        `determination ${determination.id}: names nobody who decided it. An answer nobody can be ` +
          `asked about is not an answer.`,
      );
    }
    if (determination.reasoning.trim().length < 20) {
      problems.push(
        `determination ${determination.id}: gives ` +
          `${String(determination.reasoning.trim().length)} characters of reasoning. The period ` +
          `is ours to justify under Article 5(2), which is a heavier duty than being handed one.`,
      );
    }
  }
  const unresolvedKeys = new Set(
    schedule.unresolved.map((entry) => `${entry.documentType}:${entry.purpose}`),
  );

  for (const entry of schedule.unresolved) {
    const key = `${entry.documentType}:${entry.purpose}`;
    if (entry.owner.trim().length === 0) {
      problems.push(`${key}: an unresolved requirement with no owner is a question nobody asks.`);
    }
    if (isPlaceholder(entry.authoritativeSourceNeeded)) {
      problems.push(
        `${key}: names no authoritative source to resolve it. "We need to look it up" is not a ` +
          `plan; the point of recording it unresolved is to say WHERE the answer is.`,
      );
    }
  }

  for (const policy of schedule.policies) {
    const key = `${policy.documentType}:${policy.purpose}`;
    if (seen.has(key)) {
      problems.push(`Duplicate policy for ${key}. Exactly one policy must apply.`);
    }
    seen.add(key);

    // A pair that is both decided and open is a contradiction, and the
    // dangerous direction is that the policy silently wins.
    if (unresolvedKeys.has(key)) {
      problems.push(
        `${key}: has BOTH a policy and an unresolved requirement. One of them is wrong, and ` +
          `leaving it would let the policy quietly answer a question someone recorded as open.`,
      );
    }

    // ── The placeholder checks ──────────────────────────────────────────
    //
    // The realistic failure is not a missing basis. It is a basis of "TODO"
    // added to get an upload working, which then looks exactly like a real
    // one in every listing and review.
    if (isPlaceholder(policy.basis.statement)) {
      problems.push(`${key}: the basis statement is empty or a placeholder ("${policy.basis.statement}").`);
    }
    if (isPlaceholder(policy.basis.authoritativeSource)) {
      problems.push(
        `${key}: cites no authoritative source ("${policy.basis.authoritativeSource}"). A period ` +
          `nobody can check is a guess with a date on it.`,
      );
    }
    if (isPlaceholder(policy.basis.verifiedBy)) {
      problems.push(`${key}: names nobody who read the source.`);
    }
    // ── The claims determination, enforced (B1, ADR-0077) ─────────────
    //
    // "Establishing, exercising or defending legal claims" is the purpose that
    // would anchor a document to the six-year limitation period, and it is
    // determined that we do not rely on it for documents — only for the audit
    // record, where the evidence is a hash, a text and a transmission record
    // rather than a scan.
    //
    // Refused here rather than reviewed later, because the failure this
    // prevents is quiet: one row that leans on the limitation period turns a
    // 30-day passport scan into a six-year one, and nothing about the schedule
    // would look wrong.
    if (policy.basis.reliesOnLegalClaims && policy.purpose !== "audit_evidence") {
      problems.push(
        `${key}: relies on defending legal claims for a purpose other than audit_evidence. It is ` +
          `determined that documents do NOT rely on that purpose — what the student authorised is ` +
          `provable from the preview hash, the authorisation text and the transmission record, ` +
          `without the document itself. Keep the evidence, not the scan.`,
      );
    }
    // A determination is only load-bearing if the thing that leans on it has
    // to name it. Otherwise the schedule can claim the purpose and the record
    // of who allowed it lives nowhere.
    if (policy.basis.reliesOnLegalClaims && !determinationIds.has(CLAIMS_DETERMINATION_ID)) {
      problems.push(
        `${key}: relies on defending legal claims, but this schedule version records no ` +
          `"${CLAIMS_DETERMINATION_ID}" determination saying who decided that and why.`,
      );
    }

    if (policy.basis.kind === "legal_requirement" && policy.basis.statement.trim().length < 20) {
      problems.push(
        `${key}: claims a LEGAL requirement in ${String(policy.basis.statement.trim().length)} ` +
          `characters. A legal requirement we cannot state is one we have not read.`,
      );
    }

    if (now !== undefined && policy.reviewBy.getTime() <= now.getTime()) {
      problems.push(
        `${key}: was due for review on ${policy.reviewBy.toISOString().slice(0, 10)}. Retention ` +
          `periods go stale as law and practice change.`,
      );
    }

    if (!Number.isInteger(policy.retainForDays) || policy.retainForDays < 1) {
      problems.push(`${key}: retainForDays must be a positive integer, got ${String(policy.retainForDays)}.`);
    }

    if (policy.erasureBehaviour === "retain_for_legal_obligation" && policy.legalBasis === undefined) {
      problems.push(
        `${key}: refuses erasure but cites no legal obligation. A refusal without a citation ` +
          `is not a lawful basis.`,
      );
    }

    if (isPlaceholder(policy.policyReference)) {
      problems.push(`${key}: policyReference is empty or a placeholder. Every rule must be traceable.`);
    }
  }

  if (schedule.supersedes === schedule.version) {
    problems.push(`Version ${schedule.version} supersedes itself.`);
  }
  if (isPlaceholder(schedule.approvedBy)) {
    problems.push(`Version ${schedule.version} names nobody who approved it.`);
  }

  return problems;
}

/**
 * Words that mean "not yet decided", wearing the costume of a decision.
 *
 * Deliberately a list of the things people actually type. The realistic
 * failure here is not an empty field — it is `"TODO"` added to get an upload
 * working, which then looks like a real basis in every listing and review
 * until someone reads it closely, which nobody does.
 */
const PLACEHOLDERS: readonly string[] = [
  "",
  "todo",
  "to do",
  "tbc",
  "tbd",
  "n/a",
  "na",
  "none",
  "unknown",
  "?",
  "-",
  "xxx",
  "placeholder",
  "fixme",
  "pending",
];

function isPlaceholder(value: string): boolean {
  const normalised = value.trim().toLowerCase().replace(/[.\s]+$/, "");
  return PLACEHOLDERS.includes(normalised);
}

/**
 * Everything this schedule cannot yet store, and why.
 *
 * The list a data-protection reviewer actually wants: what is open, who owns
 * it, and which source answers it.
 */
export function blockedByRetention(
  schedule: RetentionSchedule,
): readonly { readonly key: string; readonly reason: string; readonly owner: string }[] {
  return schedule.unresolved.map((entry) => ({
    key: `${entry.documentType}:${entry.purpose}`,
    reason: `${entry.question} — answered by: ${entry.authoritativeSourceNeeded}`,
    owner: entry.owner,
  }));
}
