/**
 * The document vault.
 *
 * Holds passports and bank statements, so the requirements are not decorative:
 *
 *   • encrypted at rest with a customer-managed key (brief §8)
 *   • NO document stored without a configured retention policy (ADR-0010)
 *   • NO document stored without a determined lawful basis (ADR-0022)
 *   • audit records reference document IDs, never contents (brief §8)
 *   • deterministic validity checked before any reuse (brief §2.4)
 *
 * This file defines the port and the rules. The S3 + KMS implementation lives
 * in the Conversation Service, which is the process that mints upload URLs
 * (ADR-0092); an in-memory implementation satisfying the same contract ships
 * here, behaving as the verified bucket did, so the whole flow is testable
 * with no AWS account.
 *
 * ── The bytes never enter a process we run (ADR-0092, ADR-0093) ───────────
 *
 * There is no `store(bytes)` on this port. A document is uploaded by the
 * browser straight to the bucket, on a URL this port PREPARES and the port
 * then CONFIRMS by asking the bucket what it holds. Contents are never a
 * parameter and never a return value: the runner is handed a short-lived URL
 * after `mayTransmit`, not a buffer.
 */

import type {
  Brand,
  DocumentType,
  RetentionPurpose,
  RetentionSchedule,
} from "@askimate/aas-domain";
import { requirePolicy } from "@askimate/aas-domain";
import type { LawfulBasisDetermination, LawfulBasisRegister } from "@askimate/aas-disclosure";
import {
  assertNotDecidedAgainst,
  determinationOf,
  requireLawfulBasis,
} from "@askimate/aas-disclosure";

import type { DocumentDates } from "./validity.js";
import type { DocumentIntake } from "./intake.js";
import type { PreparedRetrieval, PreparedUpload } from "./bound-upload.js";

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
 *
 * And note the absence of the bytes themselves. Nothing on this port takes or
 * returns document contents (ADR-0092).
 */
export interface DocumentVault {
  /**
   * Mints the upload for an intake that has already passed the gates.
   *
   * Takes a `DocumentIntake`, which only `openIntake` produces, from a
   * `StorableUpload`, which only `assertStorable` produces — so an
   * implementation cannot prepare an upload for a document whose retention
   * policy and lawful basis were never established. And the `PreparedUpload`
   * it returns carries a `BoundUploadUrl`, which only `mintBoundUpload`
   * produces, so it cannot hand out a URL whose signature does not cover the
   * checksum header (ADR-0093). Neither is a check to remember; both are the
   * signature.
   */
  prepareUpload(intake: DocumentIntake, now: Date): Promise<PreparedUpload>;

  /**
   * Asks the store what it holds for the intake, and records the document if
   * it is exactly what was declared.
   *
   * The confirmation does not take the browser's word for it: the store is
   * asked (a HEAD), and `receiveUpload` — the only producer of the branded
   * `ReceivedUpload` a record is written from — refuses a missing object, a
   * different checksum or length, and an object not encrypted under the
   * customer-managed key.
   */
  confirmUpload(intake: DocumentIntake, now: Date): Promise<DocumentRecord>;

  /** Metadata only. Cheap, and safe to call for a purged document. */
  describe(documentId: DocumentId): Promise<DocumentRecord | null>;

  /**
   * A short-lived URL the runner fetches the bytes from, after `mayTransmit`.
   * Throws `DocumentPurgedError` once contents are gone. The bytes still do
   * not pass through this process: the runner holds a URL, not a key
   * (ADR-0042 kept).
   */
  prepareRetrieval(documentId: DocumentId, now: Date): Promise<PreparedRetrieval>;

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
 * The lawful-basis activity a STORAGE determination must cover.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0022 enumerates the storing activities someone must determine and
 * register — *"storing identity documents, storing academic documents… and
 * whatever a minor's route adds"* — which is a per-PURPOSE granularity, and
 * `lawful-basis.ts` already gives `store_identity_document` as its own example
 * of an activity name.
 *
 * So the name is DERIVED from `RetentionPurpose` rather than invented. Two
 * consequences, both wanted:
 *
 *   • a document's two storage gates are keyed on the same closed vocabulary,
 *     so they cannot disagree about which category it is in;
 *   • adding a `RetentionPurpose` silently adds a determination somebody must
 *     make, rather than silently widening what may be stored.
 *
 * Disclosure keeps ONE activity for every document type (`DISCLOSURE_ACTIVITY`)
 * because ADR-0022 enumerates sending once. The asymmetry is the ADR's, not a
 * design preference.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function storageActivityFor(purpose: RetentionPurpose): string {
  return `store_document:${purpose}`;
}

/** A determination that does not cover the document being stored. */
export class DocumentTypeNotCoveredError extends Error {
  public override readonly name = "DocumentTypeNotCoveredError";
  public constructor(
    public readonly documentType: DocumentType,
    public readonly activity: string,
    public readonly covered: readonly string[],
  ) {
    super(
      `The lawful basis determined for "${activity}" covers ${
        covered.length === 0 ? "no document types at all" : covered.join(", ")
      } — not ${documentType}. A determination is scoped to what it was made about; storing ` +
        `outside that scope would be relying on a decision nobody made.`,
    );
  }
}

/**
 * An upload that has passed BOTH storage gates.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Branded, and `assertStorable` is the only way to obtain one, so `openIntake`
 * — and through it every upload — cannot be reached without the gates having run. That is the point, and it is
 * ADR-0017's sentence applied to documents: *"was this reviewed?" is answered
 * by the function signature rather than by a check someone has to remember to
 * call.*
 *
 * Before P32 the gate was a helper the ONE existing implementation happened to
 * call. Nothing made the S3 + KMS implementation — which does not exist yet —
 * call it too, and nothing would have noticed if it had not.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export type StorableUpload = Brand<
  DocumentUpload & {
    /** The retention policy in force, resolved at the gate. */
    readonly policyReference: string;
    /** The determination relied on to hold this document. */
    readonly lawfulBasis: LawfulBasisDetermination;
  },
  "StorableUpload"
>;

/**
 * The storage-time gate. Two refusals, for two independent questions.
 *
 * **Retention** (ADR-0010, ADR-0023) — throws `RetentionRequirementUnresolvedError`
 * when someone has looked and could not responsibly say, and
 * `RetentionPolicyMissingError` when nobody has looked. Absence of policy is
 * not permission to keep.
 *
 * **Lawful basis** (ADR-0022) — throws `DeterminationDecidedAgainstError` when
 * somebody decided this activity gets no determination (ADR-0088),
 * `NoLawfulBasisError` when none is registered and nobody has decided either
 * way, and `DocumentTypeNotCoveredError` when the determination that IS
 * registered was not made about this kind of document.
 *
 * The two are genuinely independent and neither implies the other: a period
 * somebody justified is not a basis for holding the data, and a basis for
 * holding it says nothing about for how long. Before P32 only the first ran,
 * so ADR-0022's *"the system will refuse to act until"* was true of sending
 * and false of storing.
 *
 * ── There were four gates for one day, and ADR-0089 removed two ───────────
 *
 * P54 added an **Article 9 consent** gate and P55 a **DPA 2018 Sch. 1
 * appropriate policy document** gate. Both existed for `national_id` and for
 * nothing else, and ADR-0089 removed that document type: a type refused at the
 * gate is machinery no student can use, carried with a policy justification
 * attached. A passport is sufficient for identity and needs neither.
 *
 * **`DocumentTypeNotCoveredError` is why removing them opened nothing.** A
 * document type no determination names cannot be stored at all, so the next
 * special-category type is refused from the moment it exists until somebody
 * writes a determination for it — which is exactly when those two gates have
 * to be rebuilt. ADR-0089 records what they were, so that starts from the
 * reasoning rather than from scratch.
 *
 * A determination's `reviewBy` is deliberately NOT re-checked here.
 * `determineLawfulBasis` refuses an expired one when it is made, and
 * `requirePolicy` does not re-check a policy's `reviewBy` either —
 * `validateSchedule` reports staleness and `pnpm run retention-status` prints
 * it. Adding a second, differently-placed staleness rule for one of the two
 * gates would be an inconsistency, not a control.
 */
export function assertStorable(input: {
  readonly schedule: RetentionSchedule;
  readonly register: LawfulBasisRegister;
  readonly upload: DocumentUpload;
}): StorableUpload {
  const policy = requirePolicy(input.schedule, input.upload.documentType, input.upload.purpose);

  const activity = storageActivityFor(input.upload.purpose);
  // ── Decided-against comes BEFORE "not determined" ──────────────────────
  //
  // `other / audit_evidence` has a retention policy and no determination, and
  // it will never have one (ADR-0088). Reaching `requireLawfulBasis` for it
  // would report an absence, which reads as work outstanding — and the work
  // that "closes" it is the thing ADR-0078 exists to prevent.
  assertNotDecidedAgainst(activity);
  const determination = requireLawfulBasis(input.register, activity);
  const record = determinationOf(determination);
  const covered = record.activity.documentTypes;
  if (!covered.includes(input.upload.documentType)) {
    throw new DocumentTypeNotCoveredError(input.upload.documentType, activity, covered);
  }

  return {
    ...input.upload,
    policyReference: policy.policyReference,
    lawfulBasis: determination,
  } as StorableUpload;
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
