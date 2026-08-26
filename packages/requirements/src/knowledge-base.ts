/**
 * The curated channel — AskiMate's existing knowledge-base workflow.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *   kb_pending_entries  →  human review  →  kb_entries
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Vahid, 2026-08-26: *"Continue preparing the Requirements Service using the
 * existing AskiMate knowledge-base workflow… Do not create a separate
 * requirements-management system unless there is a genuine architectural
 * reason."*
 *
 * There is no such reason, and the instruction is the right call for a concrete
 * operational one: AskiMate already runs this loop, with real people who
 * already review things through it. A second console is a second thing nobody
 * opens.
 *
 * So this file is a **port shaped like that workflow**, not a new system. The
 * production adapter maps onto AskiMate's own tables across the integration
 * boundary (ADR-0001); the in-memory one here exists so the whole requirements
 * flow is testable with no AskiMate instance.
 *
 * ── The one thing this adds ───────────────────────────────────────────────
 *
 * `CuratedEvidence` — the domain type that satisfies half the evidence bar —
 * can only be built from an **approved** entry, and approval is structurally
 * unreachable for a pending or rejected one. A specialist's judgement enters
 * the system through exactly one door.
 */

import type { Brand, CuratedEvidence } from "@askimate/aas-domain";

/** Mirrors AskiMate's own status values. */
export type PendingStatus = "pending" | "approved" | "rejected";

/**
 * An entry in the queue.
 *
 * Field names follow AskiMate's existing table so the adapter is a rename and
 * not a translation: `approvedBy`, `ingestedAt`, `rejectedAt`.
 */
export interface KbEntryRecord {
  readonly entryId: string;
  /** What this constrains, e.g. `english_language.ielts_overall`. */
  readonly key: string;
  /** The requirement as the specialist recorded it. */
  readonly statedValue: string;
  /** The source they read. Their judgement has to be checkable. */
  readonly citedSource: string;
  readonly notes?: string;

  readonly status: PendingStatus;
  readonly submittedBy: string;
  readonly submittedAt: Date;
  /** Set on approval. Never the submitter — see `approve`. */
  readonly approvedBy?: string;
  readonly ingestedAt?: Date;
  readonly rejectedAt?: Date;
  readonly rejectionReason?: string;
}

/**
 * An entry that a second person approved.
 *
 * Branded, and produced only by `approve`. `curatedEvidenceFrom` takes this
 * type, so there is no route from a pending entry to evidence the system will
 * act on.
 */
export type ApprovedKbEntry = Brand<KbEntryRecord, "ApprovedKbEntry">;

export type ApprovalRefusal =
  | { readonly kind: "not_pending"; readonly detail: string }
  | { readonly kind: "self_approval"; readonly detail: string }
  | { readonly kind: "no_source"; readonly detail: string };

export type ApprovalResult =
  | { readonly approved: true; readonly entry: ApprovedKbEntry }
  | { readonly approved: false; readonly refusal: ApprovalRefusal };

/**
 * Approves an entry.
 *
 * Three refusals, and the second is the one that matters. A specialist
 * approving their own submission is one person's opinion with a second
 * timestamp on it — the same rule as mapping sets (ADR-0017), for the same
 * reason.
 */
export function approve(input: {
  readonly entry: KbEntryRecord;
  readonly approvedBy: string;
  readonly at: Date;
}): ApprovalResult {
  const { entry, approvedBy, at } = input;

  if (entry.status !== "pending") {
    return {
      approved: false,
      refusal: {
        kind: "not_pending",
        detail: `Entry ${entry.entryId} is "${entry.status}" and only a pending entry can be approved.`,
      },
    };
  }

  if (approvedBy.trim().length === 0 || approvedBy === entry.submittedBy) {
    return {
      approved: false,
      refusal: {
        kind: "self_approval",
        detail:
          `Entry ${entry.entryId} was submitted by "${entry.submittedBy}" and cannot be approved ` +
          `by the same person. One person's opinion with a second timestamp on it is not review.`,
      },
    };
  }

  if (entry.citedSource.trim().length === 0) {
    return {
      approved: false,
      refusal: {
        kind: "no_source",
        detail:
          `Entry ${entry.entryId} cites no source. A specialist's judgement has to be checkable, ` +
          `or the curated channel is just a second opinion with no evidence behind it.`,
      },
    };
  }

  return {
    approved: true,
    entry: {
      ...entry,
      status: "approved",
      approvedBy,
      ingestedAt: at,
    } as ApprovedKbEntry,
  };
}

/** Rejects an entry, with a reason. Rejection without one teaches nobody anything. */
export function reject(input: {
  readonly entry: KbEntryRecord;
  readonly rejectedBy: string;
  readonly reason: string;
  readonly at: Date;
}): KbEntryRecord {
  return {
    ...input.entry,
    status: "rejected",
    rejectedAt: input.at,
    rejectionReason: `${input.reason} (${input.rejectedBy})`,
  };
}

/**
 * Turns an approved entry into evidence the requirements gate will accept.
 *
 * **The only constructor of `CuratedEvidence` in the system.** It takes an
 * `ApprovedKbEntry`, which only `approve` produces — so a pending entry cannot
 * become evidence however the caller holds it.
 */
export function curatedEvidenceFrom(entry: ApprovedKbEntry): CuratedEvidence {
  const record: KbEntryRecord = entry;
  return {
    channel: "curated",
    // The APPROVER is the reviewer of record, not the submitter. The evidence
    // bar is about who checked it.
    reviewerId: record.approvedBy ?? "",
    reviewedAt: record.ingestedAt ?? record.submittedAt,
    citedSource: record.citedSource,
    statedValue: record.statedValue,
    ...(record.notes !== undefined ? { notes: record.notes } : {}),
  };
}

/** Reads an approved entry, for a console or an audit record. */
export function entryOf(entry: ApprovedKbEntry): KbEntryRecord {
  return entry;
}

// ───────────────────────────────────────────────────────────────────────────
// The port
// ───────────────────────────────────────────────────────────────────────────

/**
 * AskiMate's knowledge base, as this system needs it.
 *
 * Deliberately narrow, and deliberately shaped like the existing tables. The
 * production adapter is a mapping across the integration boundary; it is not a
 * place to add behaviour AskiMate's own workflow does not have.
 */
export interface KnowledgeBase {
  /** Adds a pending entry to the review queue. */
  submit(entry: Omit<KbEntryRecord, "status">): Promise<KbEntryRecord>;
  /** The review queue, for the specialist's console. */
  pending(): Promise<readonly KbEntryRecord[]>;
  /** Stores an approval. */
  recordApproval(entry: ApprovedKbEntry): Promise<void>;
  /** Stores a rejection. */
  recordRejection(entry: KbEntryRecord): Promise<void>;
  /** Approved entries for a key, newest first. */
  approvedFor(key: string): Promise<readonly ApprovedKbEntry[]>;
}

/** An in-memory knowledge base, so the flow is testable with no AskiMate. */
export class InMemoryKnowledgeBase implements KnowledgeBase {
  readonly #entries = new Map<string, KbEntryRecord>();

  public submit(entry: Omit<KbEntryRecord, "status">): Promise<KbEntryRecord> {
    const stored: KbEntryRecord = { ...entry, status: "pending" };
    this.#entries.set(stored.entryId, stored);
    return Promise.resolve(stored);
  }

  public pending(): Promise<readonly KbEntryRecord[]> {
    return Promise.resolve(
      [...this.#entries.values()].filter((entry) => entry.status === "pending"),
    );
  }

  public recordApproval(entry: ApprovedKbEntry): Promise<void> {
    this.#entries.set(entryOf(entry).entryId, entryOf(entry));
    return Promise.resolve();
  }

  public recordRejection(entry: KbEntryRecord): Promise<void> {
    this.#entries.set(entry.entryId, entry);
    return Promise.resolve();
  }

  public approvedFor(key: string): Promise<readonly ApprovedKbEntry[]> {
    return Promise.resolve(
      [...this.#entries.values()]
        .filter((entry) => entry.key === key && entry.status === "approved")
        .sort((a, b) => (b.ingestedAt?.getTime() ?? 0) - (a.ingestedAt?.getTime() ?? 0))
        .map((entry) => entry as ApprovedKbEntry),
    );
  }
}
