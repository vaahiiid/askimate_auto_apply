/**
 * Loading a catalogue entry, and the refusal that makes the rest of it matter.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0057. The order below is the design:
 *
 *   1. PARSE      rebuild field by field; unknown fields do not survive
 *   2. CANONICAL  the artefact, not the file that carried it
 *   3. HASH       sha256 over the canonical text
 *   4. APPROVAL   does an independent registry hold this hash?   ← the gate
 *   5. INTEGRITY  checkExecutable / checkUsable, still enforced
 *
 * Step 4 is the one that is new and the one that cannot be skipped. Steps 1-3
 * exist to make it meaningful: without a parse the hash would cover bytes
 * nobody normalised, and without canonicalisation a reformatted file would need
 * re-approval and reviewers would learn to re-approve without looking.
 *
 * Step 5 is kept because an approval is not a substitute for coherence. Two
 * people can approve a mapping set pinned to the wrong blueprint version; the
 * pin check catches that and should still run. What step 5 must never be is the
 * ONLY thing standing between bytes and a run, which is what it was before P20.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { checkExecutable } from "@askimate/aas-blueprint";
import { checkUsable } from "@askimate/aas-mapping";

import { toCanonical, type ReviewedCatalogueEntry } from "./entry.js";
import { parseReviewedEntryText, type ParseRefusal } from "./parse.js";
import { hashOf, type Approval, type ApprovalRegistry } from "./registry.js";

/**
 * A reviewed entry plus the deployment fact that is not part of it.
 *
 * Structurally identical to the Conversation Service's `CatalogueEntry`, which
 * is checked by a compile-time assertion where the two meet rather than by
 * this package importing from an app.
 */
export type DeployedCatalogueEntry = ReviewedCatalogueEntry & {
  readonly portalOrigin?: string;
};

export type LoadRefusal =
  /** The bytes are not a well-formed artefact. Carries where it stopped. */
  | { readonly kind: "malformed"; readonly detail: string; readonly path: string }
  /**
   * No approval exists for this content.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * THE refusal. It fires whatever the artefact says about itself — a
   * document declaring `status: "reviewed"`, naming a reviewer and naming a
   * different author reaches this line exactly as an obvious forgery does,
   * because none of those fields is consulted.
   * ═══════════════════════════════════════════════════════════════════════
   */
  | { readonly kind: "not_approved"; readonly detail: string; readonly contentHash: string }
  | { readonly kind: "blueprint_not_executable"; readonly detail: string }
  | { readonly kind: "mapping_not_usable"; readonly detail: string };

export type LoadResult =
  | {
      readonly ok: true;
      readonly entry: DeployedCatalogueEntry;
      /** `sha256:<hex>` — what was approved, for an audit line. */
      readonly contentHash: string;
      readonly approval: Approval;
    }
  | { readonly ok: false; readonly refusal: LoadRefusal };

function malformed(refusal: ParseRefusal): LoadResult {
  return { ok: false, refusal: { kind: "malformed", detail: refusal.detail, path: refusal.path } };
}

/**
 * Bytes in, a usable entry or a refusal out.
 *
 * `portalOrigin` is applied AFTER hashing, deliberately: it is a deployment
 * fact and not part of what anybody reviewed, so running the same reviewed
 * entry against a sandbox and against production must not produce two hashes
 * and must not need two approvals.
 */
export async function loadReviewedEntry(input: {
  readonly text: string;
  readonly registry: ApprovalRegistry;
  readonly portalOrigin?: string;
}): Promise<LoadResult> {
  const parsed = parseReviewedEntryText(input.text);
  if (!parsed.ok) return malformed(parsed.refusal);

  const reviewed = parsed.value;
  const contentHash = hashOf(toCanonical(reviewed));

  const approval = await input.registry.approvalFor(contentHash);
  if (approval === null) {
    return {
      ok: false,
      refusal: {
        kind: "not_approved",
        contentHash,
        detail:
          `No approval exists for ${contentHash}. Nothing about what this document says of ` +
          `itself — its status, its reviewer, its dates — can substitute for one (ADR-0057). ` +
          `If this artefact was approved and then edited, the edit is why: the approval covers ` +
          `the content that was reviewed, and this is no longer that content.`,
      },
    };
  }

  // ── Still enforced, and still worth enforcing ─────────────────────────
  const executable = checkExecutable(reviewed.blueprint);
  if (!executable.executable) {
    return {
      ok: false,
      refusal: { kind: "blueprint_not_executable", detail: executable.refusal.detail },
    };
  }

  const usable = checkUsable(reviewed.mappingSet, reviewed.blueprint);
  if (!usable.usable) {
    return { ok: false, refusal: { kind: "mapping_not_usable", detail: usable.refusal.detail } };
  }

  return {
    ok: true,
    entry: {
      ...reviewed,
      ...(input.portalOrigin === undefined ? {} : { portalOrigin: input.portalOrigin }),
    },
    contentHash,
    approval,
  };
}

/**
 * A catalogue over entries that have already been loaded.
 *
 * Built once at startup and immutable afterwards. There is no `add`: an entry
 * that arrived after the process started would be one nothing checked at the
 * moment the process decided it was safe to run (ADR-0055).
 */
export class ReviewedCatalogue {
  readonly #entries: ReadonlyMap<string, DeployedCatalogueEntry>;
  readonly #hashes: ReadonlyMap<string, string>;

  public constructor(loaded: readonly { entry: DeployedCatalogueEntry; contentHash: string }[]) {
    const entries = new Map<string, DeployedCatalogueEntry>();
    const hashes = new Map<string, string>();
    for (const item of loaded) {
      const id = String(item.entry.blueprint.blueprintId);
      entries.set(id, item.entry);
      hashes.set(id, item.contentHash);
    }
    this.#entries = entries;
    this.#hashes = hashes;
  }

  public find(blueprintId: string): Promise<DeployedCatalogueEntry | null> {
    return Promise.resolve(this.#entries.get(blueprintId) ?? null);
  }

  /** What this catalogue serves, for a startup log line and an operator. */
  public inventory(): readonly { readonly blueprintId: string; readonly contentHash: string }[] {
    return [...this.#hashes].map(([blueprintId, contentHash]) => ({ blueprintId, contentHash }));
  }

  public get size(): number {
    return this.#entries.size;
  }
}
