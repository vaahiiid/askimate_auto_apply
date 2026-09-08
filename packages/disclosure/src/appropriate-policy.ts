/**
 * The appropriate policy document, and the types that cannot be held without one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DPA 2018 Schedule 1 requires an **appropriate policy document** to exist
 * BEFORE certain special-category processing, not alongside it. ADR-0087 put a
 * national identity card in scope under Article 9(2)(a), which turned that
 * requirement from hypothetical into live — and it does not exist.
 *
 * Vahid, 2026-09-08:
 *
 *   "Disable national_id for now. Passport only. The Article 9 determination
 *    stays registered and correct, but the appropriate policy document must
 *    exist before that processing and it does not, so the honest position is
 *    that the document type is not yet available rather than
 *    available-and-non-compliant."
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is a SEPARATE record from the determination ──────────────────
 *
 * They have different owners. The lawful-basis determination is Vahid's, it is
 * made, and it is correct — nothing here weakens or removes it. The appropriate
 * policy document is the DPIA owner's, and it is outstanding.
 *
 * Folding the second into the first would mean editing a determination to
 * express a fact about somebody else's unfinished work, and would make
 * re-enabling look like a correction to the determination rather than what it
 * is: a different person finishing a different thing.
 *
 * ── Why `held` cannot be a boolean ────────────────────────────────────────
 *
 * A `satisfied: false` becomes `satisfied: true` in one keystroke, by anyone,
 * with no record of what was relied on. `held` demands a reference, a named
 * confirmer and a date — the same shape a lawful-basis determination and a
 * retention policy already require, and for the same reason. Re-enabling a
 * document type is then a deliberate act with somebody's name on it, which is
 * exactly what was asked for.
 */

import type { Brand } from "@askimate/aas-domain";

/** Where a required policy document stands. */
export type AppropriatePolicyDocument =
  | {
      readonly kind: "outstanding";
      /** What is missing, named precisely enough to go and get it. */
      readonly requirement: string;
      /** Whose it is. Never a team, never a shared account. */
      readonly heldBy: string;
      /** Why the processing is blocked rather than merely flagged. */
      readonly why: string;
    }
  | {
      readonly kind: "held";
      /** The document relied on. A claim with no reference is not evidence. */
      readonly reference: string;
      readonly confirmedBy: string;
      readonly confirmedAt: Date;
      /** Policy documents go stale exactly as determinations do. */
      readonly reviewBy: Date;
    };

/**
 * The register, keyed by document type.
 *
 * A type ABSENT from this map needs no appropriate policy document — which is
 * the ordinary case, and why this is not a total map over `DocumentType`. Only
 * a type that ADR-0087 brought into Article 9 scope belongs here, and there is
 * currently one.
 */
export type AppropriatePolicyRegister = Readonly<Record<string, AppropriatePolicyDocument>>;

/**
 * What the system holds today.
 *
 * `national_id` is the whole of it. The passport is deliberately absent: it
 * carries no special-category data on its face, ADR-0087 gives it no Article 9
 * condition, and a type that needs no policy document must not be listed as
 * having one outstanding.
 */
export const APPROPRIATE_POLICY_DOCUMENTS: AppropriatePolicyRegister = {
  national_id: {
    kind: "outstanding",
    requirement: "DPA 2018 Schedule 1 appropriate policy document",
    heldBy: "the DPIA owner",
    why:
      "ADR-0087 determined Article 9(2)(a), explicit consent, for a national identity card, and " +
      "Schedule 1 requires the policy document to exist BEFORE that processing rather than " +
      "alongside it. The determination is made and correct; this is not. Vahid, 2026-09-08: the " +
      "honest position is that the document type is NOT YET AVAILABLE rather than " +
      "available-and-non-compliant (ADR-0088).",
  },
};

/** A document type whose processing prerequisite is not satisfied. */
export class AppropriatePolicyMissingError extends Error {
  public override readonly name = "AppropriatePolicyMissingError";
  public constructor(
    public readonly documentType: string,
    public readonly outstanding: Extract<AppropriatePolicyDocument, { kind: "outstanding" }>,
  ) {
    super(
      `A ${documentType} cannot be stored: the ${outstanding.requirement} does not exist, and it ` +
        `is held by ${outstanding.heldBy}. ${outstanding.why} ` +
        `This is a deliberate refusal, not a defect — re-enabling the type means recording the ` +
        `policy document as held, with a reference and a named confirmer, in ` +
        `APPROPRIATE_POLICY_DOCUMENTS.`,
    );
  }
}

/**
 * A document type cleared of its policy-document prerequisite.
 *
 * Branded so the check cannot be skipped by a caller that forgot it — the same
 * device `assertStorable` uses on its own result.
 */
export type PolicyDocumentCleared = Brand<string, "PolicyDocumentCleared">;

/**
 * Throws unless the type needs no policy document, or has one held.
 *
 * A `held` entry past its review date is treated as outstanding: a policy
 * document nobody has looked at since it lapsed is not a policy document in
 * force, which is the rule `determineLawfulBasis` already applies to a
 * determination.
 */
export function requireAppropriatePolicy(
  register: AppropriatePolicyRegister,
  documentType: string,
  now: Date,
): PolicyDocumentCleared {
  const entry = register[documentType];
  if (entry === undefined) return documentType as PolicyDocumentCleared;

  if (entry.kind === "outstanding") {
    throw new AppropriatePolicyMissingError(documentType, entry);
  }

  if (entry.reviewBy.getTime() <= now.getTime()) {
    throw new AppropriatePolicyMissingError(documentType, {
      kind: "outstanding",
      requirement: `a current DPA 2018 Schedule 1 appropriate policy document (${entry.reference})`,
      heldBy: entry.confirmedBy,
      why:
        `It was due for review on ${entry.reviewBy.toISOString().slice(0, 10)}. A policy document ` +
        `nobody has looked at since it lapsed is not one in force.`,
    });
  }

  return documentType as PolicyDocumentCleared;
}
