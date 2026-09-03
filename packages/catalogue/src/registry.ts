/**
 * The approval registry: what content two people signed off, and who they were.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0057. This is the independent authority. `status: "reviewed"` inside an
 * artefact is the artefact's claim about itself; an entry here is a record
 * kept somewhere the artefact cannot reach.
 *
 * The two-person rule lives HERE and not on the artefact, and that relocation
 * is the whole point. `checkUsable` compares `mappingSet.reviewedBy` against
 * `mappingSet.authoredBy` — two fields in the same document, both written by
 * whoever wrote the document. Comparing them proves internal consistency and
 * nothing about the world.
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
  /** Who reviewed it. Never the author. */
  readonly approvedBy: string;
  readonly approvedAt: Date;
  /** Free text: what was checked, or which review this came from. */
  readonly note?: string;
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
  | { readonly kind: "self_approval"; readonly detail: string }
  | { readonly kind: "missing_reviewer"; readonly detail: string }
  | { readonly kind: "already_approved"; readonly detail: string };

export type ApprovalResult =
  | { readonly ok: true; readonly approval: Approval }
  | { readonly ok: false; readonly refusal: ApprovalRefusal };

/**
 * Builds an approval, refusing the ways one can be meaningless.
 *
 * The self-approval check is the same sentence `checkUsable` and the
 * requirements service both make, and it is made a third time here for a
 * reason: this is now the copy that decides. The other two are checks on a
 * document's internal consistency; this one is a check on a record of what
 * people did.
 */
export function approveContent(input: {
  readonly contentHash: string;
  readonly authoredBy: string;
  readonly approvedBy: string;
  readonly approvedAt: Date;
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

  if (authoredBy.trim() === approvedBy.trim()) {
    return {
      ok: false,
      refusal: {
        kind: "self_approval",
        detail:
          `This content was authored by "${authoredBy}" and cannot be approved by the same ` +
          `person. That is a draft with a signature on it (ADR-0017).`,
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
 * state of a system in which no artefact has yet been through two people, and
 * nothing here seeds an approval to make a demonstration succeed.
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
