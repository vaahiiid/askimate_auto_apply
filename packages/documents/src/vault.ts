/**
 * The document vault.
 *
 * Holds passports and bank statements, so the requirements are not decorative:
 *
 *   • encrypted at rest with a customer-managed key (brief §8)
 *   • NO document stored without a configured retention policy (ADR-0010)
 *   • audit records reference document IDs, never contents (brief §8)
 *   • deterministic validity checked before any reuse (brief §2.4)
 *
 * This file defines the port and the rules. The S3 + KMS implementation is a
 * deployment concern; an in-memory implementation satisfying the same contract
 * ships alongside, so the whole flow is testable with no AWS account.
 */

import type { DocumentType, RetentionPurpose, RetentionSchedule } from "@askimate/aas-domain";
import { requirePolicy } from "@askimate/aas-domain";

import type { DocumentDates } from "./validity.js";

/** Opaque handle to a stored document. IDs travel; contents do not. */
export type DocumentId = string;

/** Where a document is in its life. */
export type DocumentState =
  /** Bytes received, nothing read from it yet. */
  | "uploaded"
  /** Extraction ran; the student has not confirmed what was read. */
  | "extracted"
  /** The student confirmed the extraction. Usable. */
  | "confirmed"
  /** A specialist checked it against the original. */
  | "verified"
  /** Superseded by a newer document of the same type. */
  | "superseded"
  /** Past its retention period; contents removed. */
  | "purged";

/** A document's metadata. Never its contents. */
export interface DocumentRecord {
  readonly documentId: DocumentId;
  readonly studentId: string;
  readonly documentType: DocumentType;
  readonly purpose: RetentionPurpose;
  readonly state: DocumentState;
  /** SHA-256 of the stored bytes. Survives erasure so the audit stays checkable. */
  readonly contentHash: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly uploadedAt: Date;
  /** Dates read from the document, which the validity engine works on. */
  readonly dates: DocumentDates;
  /** The retention policy in force, resolved at storage time. */
  readonly retentionPolicyReference: string;
  /** When the retention clock started. `null` until the trigger event happens. */
  readonly retentionTriggeredAt: Date | null;
  readonly supersededBy?: DocumentId;
}

/** What a caller supplies to store a document. */
export interface DocumentUpload {
  readonly studentId: string;
  readonly documentType: DocumentType;
  readonly purpose: RetentionPurpose;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly contentHash: string;
  readonly dates: DocumentDates;
}

export class DocumentNotFoundError extends Error {
  public override readonly name = "DocumentNotFoundError";
  public constructor(public readonly documentId: DocumentId) {
    super(`No document ${documentId}.`);
  }
}

export class DocumentPurgedError extends Error {
  public override readonly name = "DocumentPurgedError";
  public constructor(public readonly documentId: DocumentId) {
    super(
      `Document ${documentId} has passed its retention period and its contents have been removed. ` +
        `Its metadata and hash remain for audit.`,
    );
  }
}

/**
 * Storage for student documents.
 *
 * Note the absence of an `update` for contents: a document's bytes are written
 * once. A corrected document is a NEW document that supersedes the old one,
 * which keeps "what exactly did we submit?" answerable.
 */
export interface DocumentVault {
  /**
   * Stores a document.
   *
   * MUST refuse when no retention policy covers `(documentType, purpose)`.
   * See `assertStorable` — that check is the point, not a formality.
   */
  store(upload: DocumentUpload, contents: Uint8Array, now: Date): Promise<DocumentRecord>;

  /** Metadata only. Cheap, and safe to call for a purged document. */
  describe(documentId: DocumentId): Promise<DocumentRecord | null>;

  /** The bytes. Throws `DocumentPurgedError` once contents are gone. */
  retrieve(documentId: DocumentId): Promise<Uint8Array>;

  /** Every document held for a student. */
  listForStudent(studentId: string): Promise<readonly DocumentRecord[]>;

  /** Advances a document's state. Metadata only; contents never change. */
  transition(documentId: DocumentId, state: DocumentState, now: Date): Promise<DocumentRecord>;

  /** Starts the retention clock. */
  startRetentionClock(documentId: DocumentId, at: Date): Promise<DocumentRecord>;

  /**
   * Removes contents, keeping metadata and hash.
   *
   * What both retention expiry and a right-to-erasure request call. The record
   * survives so the audit trail can still answer which document was used and
   * whether it was the one the student confirmed — without keeping the personal
   * data (ADR-0010).
   */
  purgeContents(documentId: DocumentId, now: Date): Promise<DocumentRecord>;
}

/**
 * The storage-time gate.
 *
 * Throws `RetentionPolicyMissingError` when nothing covers this document type
 * and purpose. Absence of policy is not permission to keep (ADR-0010), so an
 * unconfigured type fails loudly here — in development, where it costs an
 * afternoon — rather than silently becoming an indefinite hold.
 */
export function assertStorable(
  schedule: RetentionSchedule,
  documentType: DocumentType,
  purpose: RetentionPurpose,
): string {
  return requirePolicy(schedule, documentType, purpose).policyReference;
}

/** True when the document can still be read. */
export function hasContents(record: DocumentRecord): boolean {
  return record.state !== "purged";
}

/**
 * True when a document may be offered for reuse on a new application.
 *
 * Deliberately conservative, and deliberately not the whole answer: this covers
 * the document's *state*. Its *validity* — the 31-day window and friends — is
 * decided separately by the deterministic engine, which runs before any AI
 * confidence system is involved (brief §2.4). Both must pass.
 */
export function isReusable(record: DocumentRecord): boolean {
  return record.state === "confirmed" || record.state === "verified";
}
