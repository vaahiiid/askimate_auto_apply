/**
 * Requirement provenance and multi-source verification (ADR-0009).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "The system must know where a requirement came from and whether it has been
 *  verified before using it in an application decision."   — Vahid, 2026-08-26
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two independent evidence channels:
 *
 *   CURATED  — a knowledge-base entry reviewed and approved by a human
 *              specialist. Judgement and context; goes stale silently.
 *
 *   OFFICIAL — direct verification against the university's own website or
 *              application portal. Current and first-hand; but a machine
 *              reading a page is INTERPRETING it, so it yields evidence rather
 *              than truth — the same treatment this system gives every other
 *              machine interpretation (ADR-0004, ADR-0007).
 *
 * Neither is authoritative alone for anything that can seriously harm a
 * student. The evidence bar scales with CONSEQUENCE, never with confidence.
 *
 * This file is pure domain logic. The Requirements Service that fetches
 * official sources and holds the curated KB is Phase 4; what is here is the
 * gate it must pass through.
 */

import type { Brand } from "./brand.js";

// ───────────────────────────────────────────────────────────────────────────
// Evidence
// ───────────────────────────────────────────────────────────────────────────

/** A human specialist reviewed and approved this requirement. */
export interface CuratedEvidence {
  readonly channel: "curated";
  /** The named specialist who approved it. Never a shared account. */
  readonly reviewerId: string;
  readonly reviewedAt: Date;
  /** The source the specialist cited, so their judgement is checkable. */
  readonly citedSource: string;
  /** The requirement as the specialist recorded it. */
  readonly statedValue: string;
  readonly notes?: string;
}

/**
 * Read directly from an official university source.
 *
 * `excerptHash` matters more than it looks. On re-verification a changed hash
 * forces re-review EVEN IF the extracted value looks identical — which catches
 * a university quietly rewording a page in a way that changes its meaning
 * without changing the number.
 */
export interface OfficialEvidence {
  readonly channel: "official";
  /** The exact page or endpoint read. */
  readonly sourceUrl: string;
  readonly retrievedAt: Date;
  /** The passage the value was read from, so a human can check the reading. */
  readonly evidenceExcerpt: string;
  /** Hash of that excerpt, for change detection. */
  readonly excerptHash: string;
  /** The value as extracted. An interpretation, not yet a fact. */
  readonly extractedValue: string;
  /**
   * Extraction confidence, 0–1.
   *
   * A layer-one escalation signal only. It can send a poor reading to a human;
   * it can NEVER promote a reading past its criticality's evidence bar.
   */
  readonly confidence: number;
}

export type RequirementEvidence = CuratedEvidence | OfficialEvidence;

// ───────────────────────────────────────────────────────────────────────────
// Criticality — consequence, not confidence
// ───────────────────────────────────────────────────────────────────────────

/**
 * How much harm being wrong about this requirement would cause.
 *
 * Derived from what the requirement IS, never from how sure the system feels.
 * Same principle as the mandatory-escalation rule in brief §2.5: some things
 * need more, always.
 */
export type RequirementCriticality =
  /**
   * Being wrong causes visa refusal, legal harm, or a rejected application.
   * Visa rules, financial evidence, ATAS, anything concerning a minor.
   */
  | "critical"
  /** Affects eligibility or outcome: entry grades, English requirements, deadlines. */
  | "material"
  /** Affects convenience: document formats, portal quirks. */
  | "procedural";

// ───────────────────────────────────────────────────────────────────────────
// Scope — which process actually asks for this
// ───────────────────────────────────────────────────────────────────────────

/**
 * WHICH PROCESS requires this, as opposed to how badly being wrong would hurt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A university application requirement is NOT a Student visa requirement.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Vahid, 2026-08-26: *"Do not make financial evidence a blocking requirement
 * for the first end-to-end UK application demonstration… The distinction must
 * be explicit: University application requirements ≠ Student Visa financial
 * requirements."*
 *
 * The confusion is easy to make and expensive. Financial evidence is genuinely
 * `critical` — being wrong about the 31-day window costs a visa — and it is
 * also **not something a UK university asks for before considering an
 * application**. Treating it as a blocker on the application would stop a
 * perfectly valid application from being prepared, for a rule that does not
 * apply yet and may never apply in that form to this student.
 *
 * So scope and criticality are SEPARATE axes, and this one decides *when* a
 * requirement bites. Criticality is untouched: a `student_visa` requirement is
 * still `critical`, still needs corroboration from both channels, and still
 * escalates on conflict — at the point where it is actually required.
 */
export type RequirementScope =
  /** The university asks for this to consider the application. Blocks preparation. */
  | "university_application"
  /**
   * UKVI asks for this, later, and only depending on the applicant's
   * circumstances. Does NOT block the university application.
   */
  | "student_visa"
  /**
   * The institution must satisfy this itself — ATAS, right-to-study checks,
   * sponsorship duties. Blocks, because the institution cannot proceed without
   * it either.
   */
  | "institution_compliance";

/**
 * Does this requirement block the university application?
 *
 * The one line that keeps the visa journey out of the application journey.
 * Nothing about the evidence bar changes — a `student_visa` requirement that
 * IS in scope (at the visa stage) faces exactly the same corroboration rule.
 */
export function blocksApplication(requirement: Requirement): boolean {
  return requirement.scope !== "student_visa";
}

/** The requirements that apply to one process. */
export function inScope(
  requirements: readonly Requirement[],
  scope: RequirementScope,
): readonly Requirement[] {
  return requirements.filter((requirement) => requirement.scope === scope);
}

// ───────────────────────────────────────────────────────────────────────────
// Verification status
// ───────────────────────────────────────────────────────────────────────────

export type VerificationStatus =
  /** No usable evidence at all. */
  | "unverified"
  /** Human-reviewed KB only; no official check, or it is stale or failed. */
  | "curated_only"
  /** Official source read; no human review of it. */
  | "official_only"
  /** Both channels, fresh, and AGREEING. The strongest status. */
  | "corroborated"
  /** Both present and they DISAGREE. Never resolved automatically. */
  | "conflicted"
  /** Evidence exists but is past its revalidate-by date. */
  | "stale";

/** A requirement, with everything needed to judge whether it may be used. */
export interface Requirement {
  readonly requirementId: string;
  /** What it constrains, e.g. `financial_evidence.recency_days`. */
  readonly key: string;
  readonly criticality: RequirementCriticality;
  /**
   * Which process asks for it. Separate from criticality on purpose — see
   * `RequirementScope`. Required, because leaving it optional would let a visa
   * rule default into blocking a university application.
   */
  readonly scope: RequirementScope;
  readonly curated?: CuratedEvidence;
  readonly official?: OfficialEvidence;
  /** After this date the requirement degrades to `stale` (brief §5). */
  readonly revalidateBy: Date;
}

/**
 * Do the two channels agree?
 *
 * Deliberately a plain normalised string comparison, and deliberately strict.
 * A fuzzy or model-based "close enough" would be the system quietly deciding
 * that two different answers are the same answer — which is the failure this
 * whole design exists to prevent. Where a genuine formatting difference causes
 * a false conflict, the fix is to normalise it in the Requirements Service
 * where a human can see the rule, not to loosen the comparison here.
 */
export function channelsAgree(curated: CuratedEvidence, official: OfficialEvidence): boolean {
  const normalise = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");
  return normalise(curated.statedValue) === normalise(official.extractedValue);
}

/** Derives the verification status of a requirement as at `now`. */
export function verificationStatusOf(requirement: Requirement, now: Date): VerificationStatus {
  const { curated, official } = requirement;

  if (curated === undefined && official === undefined) return "unverified";

  // Staleness is checked BEFORE agreement. Two stale sources agreeing is not
  // corroboration — it is two out-of-date answers that happen to match.
  if (now > requirement.revalidateBy) return "stale";

  if (curated !== undefined && official !== undefined) {
    return channelsAgree(curated, official) ? "corroborated" : "conflicted";
  }
  return curated !== undefined ? "curated_only" : "official_only";
}

// ───────────────────────────────────────────────────────────────────────────
// The evidence bar
// ───────────────────────────────────────────────────────────────────────────

/** The statuses that satisfy each criticality's bar. */
const ACCEPTABLE_STATUS: Readonly<Record<RequirementCriticality, readonly VerificationStatus[]>> = {
  // Both channels, agreeing, fresh. Nothing less.
  critical: ["corroborated"],
  // Either channel, verified and fresh.
  material: ["corroborated", "curated_only", "official_only"],
  // Any evidence that is neither conflicted nor stale.
  procedural: ["corroborated", "curated_only", "official_only"],
};

/** Why a requirement may not be used in an application decision. */
export type RequirementUnusableReason =
  | "no_evidence"
  | "stale"
  | "conflicting_sources"
  | "insufficient_corroboration";

export type RequirementUsability =
  | { readonly usable: true; readonly status: VerificationStatus }
  | {
      readonly usable: false;
      readonly status: VerificationStatus;
      readonly reason: RequirementUnusableReason;
      readonly detail: string;
    };

/**
 * The single gate between a requirement and an application decision.
 *
 * Everything that wants to act on a requirement goes through here. A
 * requirement below its bar is NOT usable, and the system does not fall back
 * to the weaker source and proceed — it raises a task and escalates.
 */
export function assessUsability(requirement: Requirement, now: Date): RequirementUsability {
  const status = verificationStatusOf(requirement, now);

  if (status === "unverified") {
    return {
      usable: false,
      status,
      reason: "no_evidence",
      detail: `No evidence for "${requirement.key}". It cannot support an application decision.`,
    };
  }

  if (status === "stale") {
    return {
      usable: false,
      status,
      reason: "stale",
      detail:
        `Evidence for "${requirement.key}" is past its revalidate-by date ` +
        `(${requirement.revalidateBy.toISOString()}). It must be re-verified before use.`,
    };
  }

  // Conflict is never resolved automatically, at ANY criticality. The system
  // does not prefer a channel, and it does not prefer the fresher source — a
  // conflict means something is wrong, and guessing quickly is still guessing.
  if (status === "conflicted") {
    return {
      usable: false,
      status,
      reason: "conflicting_sources",
      detail:
        `The curated knowledge base and the official source disagree about "${requirement.key}". ` +
        `Curated: "${requirement.curated?.statedValue ?? ""}". ` +
        `Official: "${requirement.official?.extractedValue ?? ""}". ` +
        `This must be resolved by a human specialist.`,
    };
  }

  if (!ACCEPTABLE_STATUS[requirement.criticality].includes(status)) {
    return {
      usable: false,
      status,
      reason: "insufficient_corroboration",
      detail:
        `"${requirement.key}" is ${requirement.criticality} and is only ${status}. ` +
        `A ${requirement.criticality} requirement needs corroboration from BOTH the human-reviewed ` +
        `knowledge base AND the university's official source, agreeing and fresh. ` +
        `Confidence does not substitute for corroboration.`,
    };
  }

  return { usable: true, status };
}

/**
 * A requirement that has passed its evidence bar and may inform a decision.
 *
 * Minted only by `verifiedRequirement`. As with `ConfirmedValue`, the point is
 * that consuming code cannot accept anything else, so the gate cannot be
 * skipped by forgetting to call the check.
 */
export type VerifiedRequirement = Brand<Requirement, "VerifiedRequirement">;

/** Returns the requirement only if it passes its bar; otherwise `null`. */
export function verifiedRequirement(requirement: Requirement, now: Date): VerifiedRequirement | null {
  return assessUsability(requirement, now).usable ? (requirement as VerifiedRequirement) : null;
}

/** Filters a set down to those safe to act on. */
export function usableOnly(
  requirements: readonly Requirement[],
  now: Date,
): readonly VerifiedRequirement[] {
  const usable: VerifiedRequirement[] = [];
  for (const requirement of requirements) {
    const verified = verifiedRequirement(requirement, now);
    if (verified !== null) usable.push(verified);
  }
  return usable;
}

// ───────────────────────────────────────────────────────────────────────────
// Change detection
// ───────────────────────────────────────────────────────────────────────────

/**
 * True when an official source has changed since it was last read.
 *
 * Compares the excerpt hash, not the extracted value, so a reworded page that
 * changes meaning without changing the number still forces a re-review.
 */
export function officialSourceChanged(previous: OfficialEvidence, current: OfficialEvidence): boolean {
  return previous.excerptHash !== current.excerptHash;
}

/**
 * Default revalidation windows, in days.
 *
 * Exported so the Requirements Service can override them from configuration.
 * These are starting points, not policy: the real schedule belongs in
 * configuration alongside the retention schedule (ADR-0010).
 */
export const DEFAULT_REVALIDATION_DAYS: Readonly<Record<RequirementCriticality, number>> = {
  critical: 30,
  material: 90,
  procedural: 180,
};
