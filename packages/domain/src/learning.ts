/**
 * The learning loop (ADR-0008).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "This learning loop should be treated as an important architectural
 *  requirement for the system, not merely as logging."   — Vahid, 2026-08-26
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   AI attempts → failure → alert → specialist resolves → resolution captured
 *      → reviewed / validated → reusable knowledge or workflow rule
 *      → future attempts use it → fewer interventions over time
 *
 * ── The control that makes this safe ──────────────────────────────────────
 *
 * Also Vahid, and this is the load-bearing constraint:
 *
 *   "Do not interpret 'learning' as allowing the AI to automatically change its
 *    own production behaviour without controls."
 *
 * So capture and use are separated by a mandatory human validation step. An
 * intervention is recorded the moment it happens, but it cannot influence
 * anything until a human has reviewed and published it.
 *
 * Enforced by type, not by convention: `ReusableResolution` is minted ONLY from
 * a record whose lifecycle is `published`. Wiring the raw intervention log into
 * the AI's context — precisely the failure mode the constraint names — does not
 * fail a code review, it fails to compile.
 *
 * ── This is not a new workflow for the team ───────────────────────────────
 *
 * The existing AskiMate already runs this loop for its knowledge base:
 * `kb_pending_entries` (status: pending, approvedBy, ingestedAt / rejectedAt)
 * → human approval → `kb_entries`, with a quality gate on the answer before
 * ingestion. This is the same pattern applied to intervention resolutions
 * rather than student questions.
 */

import type { Brand } from "./brand.js";
import type { BlueprintVersion, CaseId, CourseId, InstitutionId, InterventionId } from "./ids.js";
import type { ExecutionCheckpoint, RecoveryEscalation, RecoveryResolution } from "./recovery.js";

// ───────────────────────────────────────────────────────────────────────────
// Where an intervention happened
// ───────────────────────────────────────────────────────────────────────────

/**
 * Which university, portal, course and step an intervention occurred on.
 *
 * Recorded because reusability is contextual. A fix for one portal's date
 * picker is not automatically a fix for another's, and a system that forgot
 * where a resolution came from would generalise it far too eagerly.
 */
export interface InterventionContext {
  readonly institutionId: InstitutionId;
  /** The portal, which may serve several institutions (e.g. a shared platform). */
  readonly portal: string;
  readonly courseId: CourseId;
  readonly blueprintVersion: BlueprintVersion;
  readonly page: string;
  readonly section: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Reusability
// ───────────────────────────────────────────────────────────────────────────

/**
 * How widely a resolution is expected to apply.
 *
 * The specialist proposes this; validation confirms or narrows it. Ordered from
 * narrowest to widest, and the default assumption is narrow — over-generalising
 * a fix is how a learning system starts making things worse.
 */
export type ReusabilityScope =
  /** One-off. Specific to this student or this moment. Not reusable. */
  | "this_case_only"
  /** Applies to this course's application flow. */
  | "this_course"
  /** Applies to any application to this institution. */
  | "this_institution"
  /** Applies to any institution on this portal platform. */
  | "this_portal"
  /** A general rule, e.g. how to read a class of validation error. */
  | "general";

/** What kind of change the resolution implies. */
export type ResolutionKind =
  /** The blueprint is wrong or out of date and should be corrected. */
  | "blueprint_correction"
  /** A canonical-field-to-portal-field mapping needs adding or fixing. */
  | "mapping_correction"
  /** A rule for recognising and handling a situation. */
  | "workflow_rule"
  /** Guidance only: useful context for a human, not an automated change. */
  | "guidance";

export interface ReusabilityAssessment {
  readonly scope: ReusabilityScope;
  readonly kind: ResolutionKind;
  /**
   * A short, matchable description of the situation this applies to.
   *
   * Phase 4+ uses this to recognise "the same or a sufficiently similar
   * situation". Written by the specialist, reviewed at validation.
   */
  readonly signature: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Lifecycle — the promotion gate
// ───────────────────────────────────────────────────────────────────────────

/**
 * An intervention record's journey from capture to use.
 *
 *   captured     — recorded automatically. NOT usable.
 *   under_review — a human is validating it. NOT usable.
 *   validated    — approved as correct and reusable. STILL NOT usable: this is
 *                  the deliberate gap between "this is right" and "this is
 *                  live", so publication is an explicit act.
 *   published    — in production knowledge. The ONLY usable state.
 *   rejected     — wrong, unsafe, or not generalisable. Kept, never deleted:
 *                  knowing what did not work is itself worth having.
 *   superseded   — a later resolution replaced it.
 */
export type InterventionLifecycle =
  | "captured"
  | "under_review"
  | "validated"
  | "published"
  | "rejected"
  | "superseded";

/** Lifecycle states in which a record may NOT influence production behaviour. */
export const NON_USABLE_LIFECYCLE_STATES = [
  "captured",
  "under_review",
  "validated",
  "rejected",
  "superseded",
] as const satisfies readonly InterventionLifecycle[];

// ───────────────────────────────────────────────────────────────────────────
// The record
// ───────────────────────────────────────────────────────────────────────────

/**
 * Everything captured about one human intervention.
 *
 * The field list is Vahid's, kept in the same order so the mapping from the
 * product requirement to the code is checkable by reading.
 */
export interface InterventionRecord {
  readonly interventionId: InterventionId;
  readonly caseId: CaseId;

  /** What the AI encountered, what it expected, and where it failed. */
  readonly escalation: RecoveryEscalation;
  /** What the specialist did, and what the successful resolution was. */
  readonly resolution: RecoveryResolution;
  /** Which university / portal / course / step it occurred on. */
  readonly context: InterventionContext;
  /** Whether the resolution is reusable. */
  readonly reusability: ReusabilityAssessment;

  readonly lifecycle: InterventionLifecycle;
  /** Who validated it, once someone has. */
  readonly validatedBy?: string;
  readonly validatedAt?: Date;
  /** Why it was rejected, when it was. */
  readonly rejectionReason?: string;
  /** The record that replaced this one. */
  readonly supersededBy?: InterventionId;
}

/** Convenience: where the AI stopped. */
export function failurePointOf(record: InterventionRecord): ExecutionCheckpoint {
  return record.escalation.checkpoint;
}

// ───────────────────────────────────────────────────────────────────────────
// The gate
// ───────────────────────────────────────────────────────────────────────────

/**
 * A resolution that has passed human validation AND been published, and may
 * therefore influence what the AI does.
 *
 * The only type the (future) knowledge retrieval will accept. There is no other
 * constructor, and no cast helper — exactly as with `ConfirmedValue`.
 */
export type ReusableResolution = Brand<InterventionRecord, "ReusableResolution">;

/**
 * The single gate between a captured intervention and production behaviour.
 *
 * Returns `null` for anything not published — including `validated`, which is
 * approved but not yet live. That gap is deliberate: it makes going live an
 * explicit act rather than a side effect of approval.
 *
 * Also refuses `this_case_only`, because a resolution the specialist judged
 * one-off must not become a general rule however it was approved.
 */
export function asReusable(record: InterventionRecord): ReusableResolution | null {
  if (record.lifecycle !== "published") return null;
  if (record.reusability.scope === "this_case_only") return null;
  return record as ReusableResolution;
}

/**
 * Filters a set of records down to those safe to use.
 *
 * The function knowledge retrieval should call. Anything reaching for
 * `InterventionRecord[]` directly is bypassing the control.
 */
export function reusableOnly(records: readonly InterventionRecord[]): readonly ReusableResolution[] {
  const usable: ReusableResolution[] = [];
  for (const record of records) {
    const reusable = asReusable(record);
    if (reusable !== null) usable.push(reusable);
  }
  return usable;
}

/** Whether a lifecycle transition is allowed. */
export function canTransitionLifecycle(
  from: InterventionLifecycle,
  to: InterventionLifecycle,
): boolean {
  const allowed: Readonly<Record<InterventionLifecycle, readonly InterventionLifecycle[]>> = {
    captured: ["under_review", "rejected"],
    under_review: ["validated", "rejected"],
    // Validation and publication are separate acts, deliberately.
    validated: ["published", "rejected"],
    // A published record can be withdrawn if it turns out to be wrong.
    published: ["superseded", "rejected"],
    rejected: [],
    superseded: [],
  };
  return allowed[from].includes(to);
}
