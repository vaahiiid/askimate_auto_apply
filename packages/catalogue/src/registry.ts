/**
 * The approval registry: what content was signed off, by whom, and whom the
 * signature admits.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0057. This is the independent authority. `status: "reviewed"` inside an
 * artefact is the artefact's claim about itself; an entry here is a record
 * kept somewhere the artefact cannot reach.
 *
 * Who signed lives HERE and not on the artefact, and that relocation is the
 * whole point. `mappingSet.reviewedBy` and `mappingSet.authoredBy` are two
 * fields in the same document, both written by whoever wrote the document.
 * Comparing them proves internal consistency and nothing about the world.
 *
 * ── ADR-0118: one signature admits one account ─────────────────────────────
 *
 * Until 2026-09-16 an approval had to name two people, and an approval signed
 * by the artefact's author was refused as "a draft with a signature on it".
 * Vahid changed that, in his words: *"Drop it to one: I approve, and I am the
 * only signature."* — with a condition he asked to be enforced rather than
 * noted: *"Nothing reaches a real student on a one-signature approval …
 * a mapping set with one signature may be used for my own account and for
 * nothing else. If that gate does not exist as a thing in the code, build it,
 * because my memory of this conversation is not a control."*
 *
 * So an approval signed by its author is accepted ONLY when it names the one
 * account it admits (`ownAccountOnly`), and the loader carries that admission
 * onto the served entry, where the Conversation Service refuses every other
 * student — at the offer, at the start, and at every later lookup of the
 * entry for a bound case. An approval by a second person admits any applicant.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── A port, on purpose ────────────────────────────────────────────────────
 *
 * Vahid, 2026-09-03: *"Do not design the registry as though it must permanently
 * remain isolated. Keep the authority boundary sufficiently clean that a future
 * integration with the AskiMate KB review workflow is possible without
 * redesigning the catalogue integrity model."*
 *
 * So `ApprovalRegistry` is an interface with one question on it. The in-memory
 * and file-backed implementations are here; an adapter reading AskiMate's
 * `kb_entries` is a third, and adding one changes no parse, no canonical form,
 * no hash and no refusal. ADR-0019 keeps its reasoning about where a human
 * sits to review; this keeps the cryptographic truth testable without one.
 */

import type { Canonical } from "./canonical.js";
import { isLabelledHash, labelledHash } from "./canonical.js";

/**
 * One approval: this exact content, approved by this person, who is not its
 * author.
 *
 * Note what is NOT here: the artefact's id, its version, its institution. An
 * approval that recorded those would invite a lookup by them, and a lookup by
 * descriptive metadata is exactly the mistake this design exists to prevent —
 * two different documents share an id and a version all the time, which is what
 * a version bump that forgot to bump the version IS.
 */
export interface Approval {
  /** `sha256:<hex>` of the canonical artefact. The key, and the whole binding. */
  readonly contentHash: string;
  /** Who authored the artefact. Recorded by the registry, not read from it. */
  readonly authoredBy: string;
  /**
   * Who signed it. A second person, or — since ADR-0118 — the author, in
   * which case `ownAccountOnly` is required and the approval admits that one
   * account and nobody else.
   */
  readonly approvedBy: string;
  readonly approvedAt: Date;
  /**
   * The one student this approval admits, as the Conversation Service knows
   * them (`studentId`: the session's subject under `AAS_DEV_SESSION`, the
   * `students.id` row for the signed-in subject under OIDC).
   *
   * Required when the signer is the author. Permitted on a second person's
   * approval too — a reviewer may bound what they signed — and absent, a
   * second person's approval admits any applicant.
   */
  readonly ownAccountOnly?: { readonly studentId: string };
  /** Free text: what was checked, or which review this came from. */
  readonly note?: string;
}

/**
 * Whom an approval admits. Carried onto every served entry and every listed
 * target, and compared against the student at each point a run touches the
 * entry (ADR-0118).
 */
export type Admission =
  | { readonly kind: "any_applicant" }
  | {
      readonly kind: "one_account_only";
      readonly studentId: string;
      /** Whose single signature this is — for the record and the listing. */
      readonly signedBy: string;
    };

/** What this approval admits. */
export function admissionOf(approval: Approval): Admission {
  if (approval.ownAccountOnly !== undefined) {
    return {
      kind: "one_account_only",
      studentId: approval.ownAccountOnly.studentId,
      signedBy: approval.approvedBy,
    };
  }
  return { kind: "any_applicant" };
}

/** Whether this student is among those the admission admits. */
export function admits(admission: Admission, studentId: string): boolean {
  return admission.kind === "any_applicant" || admission.studentId === studentId;
}

/**
 * The question production code asks.
 *
 * One method, and it takes a hash. There is deliberately no `findById`: a
 * caller that could look an approval up by anything other than content could
 * be made to accept content nobody approved.
 */
export interface ApprovalRegistry {
  /** The approval for this exact content, or `null`. */
  approvalFor(contentHash: string): Promise<Approval | null>;
}

export type ApprovalRefusal =
  | { readonly kind: "malformed_hash"; readonly detail: string }
  /** The author signed, and named no account: a signature on a draft, for everyone (ADR-0118). */
  | { readonly kind: "self_approval_unbounded"; readonly detail: string }
  | { readonly kind: "missing_reviewer"; readonly detail: string }
  | { readonly kind: "already_approved"; readonly detail: string };

export type ApprovalResult =
  | { readonly ok: true; readonly approval: Approval }
  | { readonly ok: false; readonly refusal: ApprovalRefusal };

/**
 * Builds an approval, refusing the ways one can be meaningless.
 *
 * This is the copy that decides. `checkUsable` used to make the same
 * two-person sentence about the artefact's own fields; since ADR-0118 it no
 * longer does, because the question "whom does this signature admit?" has one
 * answer and it is recorded here, on the record of what people did.
 */
export function approveContent(input: {
  readonly contentHash: string;
  readonly authoredBy: string;
  readonly approvedBy: string;
  readonly approvedAt: Date;
  readonly ownAccountOnly?: { readonly studentId: string };
  readonly note?: string;
  /** Approvals already held, so a second one for the same content refuses. */
  readonly existing?: Approval | null;
}): ApprovalResult {
  const { contentHash, authoredBy, approvedBy, approvedAt } = input;

  if (!isLabelledHash(contentHash)) {
    return {
      ok: false,
      refusal: {
        kind: "malformed_hash",
        detail: `"${input.contentHash}" is not a sha256:<64 hex> content hash.`,
      },
    };
  }

  if (authoredBy.trim().length === 0 || approvedBy.trim().length === 0) {
    return {
      ok: false,
      refusal: {
        kind: "missing_reviewer",
        detail: "An approval records two named people. A blank name names nobody.",
      },
    };
  }

  const ownAccountOnly =
    input.ownAccountOnly === undefined
      ? undefined
      : { studentId: input.ownAccountOnly.studentId.trim() };
  if (ownAccountOnly !== undefined && ownAccountOnly.studentId.length === 0) {
    return {
      ok: false,
      refusal: {
        kind: "missing_reviewer",
        detail: "ownAccountOnly.studentId must name one account. A blank names nobody.",
      },
    };
  }

  if (authoredBy.trim() === approvedBy.trim() && ownAccountOnly === undefined) {
    return {
      ok: false,
      refusal: {
        kind: "self_approval_unbounded",
        detail:
          `This content was authored by "${authoredBy}" and is signed by the same person, and ` +
          `names no account. A single signature admits the signer's own account and nothing ` +
          `else (ADR-0118): add ownAccountOnly.studentId, or a second person's signature.`,
      },
    };
  }

  if (input.existing != null) {
    return {
      ok: false,
      refusal: {
        kind: "already_approved",
        detail:
          `This content is already approved by "${input.existing.approvedBy}". Approving it ` +
          `again would overwrite the record of who actually reviewed it.`,
      },
    };
  }

  return {
    ok: true,
    approval: {
      contentHash,
      authoredBy: authoredBy.trim(),
      approvedBy: approvedBy.trim(),
      approvedAt,
      ...(ownAccountOnly === undefined ? {} : { ownAccountOnly }),
      ...(input.note === undefined ? {} : { note: input.note }),
    },
  };
}

/**
 * A registry held in memory.
 *
 * The whole integrity model is testable against this, with no database and no
 * external system — which is what Vahid asked P20 to establish.
 *
 * It starts EMPTY, and an empty registry refuses everything. That is the honest
 * state of a system in which no artefact has yet been signed, and nothing here
 * seeds an approval to make a demonstration succeed.
 */
export class InMemoryApprovalRegistry implements ApprovalRegistry {
  readonly #approvals = new Map<string, Approval>();

  public constructor(approvals: readonly Approval[] = []) {
    for (const approval of approvals) this.#approvals.set(approval.contentHash, approval);
  }

  public approvalFor(contentHash: string): Promise<Approval | null> {
    return Promise.resolve(this.#approvals.get(contentHash) ?? null);
  }

  /** Records an approval, or says why it is not one. */
  public record(input: {
    readonly contentHash: string;
    readonly authoredBy: string;
    readonly approvedBy: string;
    readonly approvedAt: Date;
    readonly ownAccountOnly?: { readonly studentId: string };
    readonly note?: string;
  }): ApprovalResult {
    const result = approveContent({
      ...input,
      existing: this.#approvals.get(input.contentHash) ?? null,
    });
    if (result.ok) this.#approvals.set(result.approval.contentHash, result.approval);
    return result;
  }

  /** Every approval held, for an operator listing them. */
  public all(): readonly Approval[] {
    return [...this.#approvals.values()];
  }
}

/** The hash an approval would have to carry to cover this artefact. */
export function hashOf(canonical: Canonical): string {
  return labelledHash(canonical);
}
