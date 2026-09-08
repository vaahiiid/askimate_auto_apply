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
 * This file defines the port and the rules. The S3 + KMS implementation is a
 * deployment concern; an in-memory implementation satisfying the same contract
 * ships alongside, so the whole flow is testable with no AWS account.
 */

import type {
  Brand,
  DocumentType,
  RetentionPurpose,
  RetentionSchedule,
} from "@askimate/aas-domain";
import { requirePolicy } from "@askimate/aas-domain";
import type {
  AppropriatePolicyRegister,
  LawfulBasisDetermination,
  LawfulBasisRegister,
  PolicyDocumentCleared,
} from "@askimate/aas-disclosure";
import {
  APPROPRIATE_POLICY_DOCUMENTS,
  assertNotDecidedAgainst,
  determinationOf,
  requireAppropriatePolicy,
  requireLawfulBasis,
} from "@askimate/aas-disclosure";

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
  /**
   * The separate Article 9 consent, for the document types that need one.
   *
   * Absent for every type that does not — a passport carries none of this, and
   * asking for a consent nobody needs is not caution (B2, ADR-0087).
   */
  readonly specialCategoryConsent?: SpecialCategoryConsent;
}

/**
 * A student's explicit consent to hold a document that may carry
 * special-category data on its face.
 *
 * ── The wording is the record, as it is for an expiry warning ────────────
 *
 * `wording` is what the student was actually shown. ADR-0079 made the same
 * choice for the expiry warning and for the same reason: a record saying "they
 * consented" without saying what they were asked is evidence of nothing.
 *
 * `askedSeparately` is not decoration. B2 requires this to be asked **at the
 * point of upload, on its own** — a consent bundled into a general agreement is
 * the bundled consent ADR-0022 rejects, and a boolean that is always true would
 * be a field nobody can fail. It is asserted at the gate.
 */
export interface SpecialCategoryConsent {
  readonly givenAt: Date;
  readonly wording: string;
  readonly askedSeparately: boolean;
}

/** A document whose type needs an Article 9 condition, offered without one. */
export class SpecialCategoryConsentMissingError extends Error {
  public override readonly name = "SpecialCategoryConsentMissingError";
  public constructor(
    public readonly documentType: DocumentType,
    public readonly detail: string,
  ) {
    super(
      `Storing a ${documentType} needs an Article 9 condition as well as an Article 6 basis, and ` +
        `${detail} Holding the image is processing the data whether or not anything reads it — ` +
        `ADR-0077 makes the FIELDS unextractable, which is a different question (ADR-0087).`,
    );
  }
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
   * Stores a document that has already passed the gates.
   *
   * Takes a `StorableUpload`, which only `assertStorable` can produce, so an
   * implementation cannot store a document whose retention policy and lawful
   * basis were never established. It is not that this method must remember to
   * check — it is that it cannot be called without the check having run.
   */
  store(upload: StorableUpload, contents: Uint8Array, now: Date): Promise<DocumentRecord>;

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
 * Branded, and `assertStorable` is the only way to obtain one, so `store`
 * cannot be reached without the gates having run. That is the point, and it is
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
    /**
     * Proof that the DPA 2018 Sch. 1 prerequisite was checked (ADR-0088).
     *
     * Branded, and `requireAppropriatePolicy` is its only source, so this
     * object cannot be assembled by a future edit that drops the fourth gate
     * and leaves the other three — the brand is not decoration, it is the
     * reason the field is here rather than a comment saying the check ran.
     */
    readonly policyDocumentCleared: PolicyDocumentCleared;
  },
  "StorableUpload"
>;

/**
 * The storage-time gate. Four refusals, for four independent questions.
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
 * **The appropriate policy document** (DPA 2018 Sch. 1, ADR-0088) — throws
 * `AppropriatePolicyMissingError` for a document type whose Schedule 1
 * prerequisite is outstanding. Today that is `national_id`, and nothing an
 * upload carries can satisfy it: the document is somebody else's to produce.
 *
 * **Article 9** (ADR-0087) — throws `SpecialCategoryConsentMissingError` for a
 * type the determination lists under `article9Required` when the separate
 * consent is absent, bundled, or records no wording.
 *
 * The four are genuinely independent and none implies another: a period
 * somebody justified is not a basis for holding the data, a basis for holding
 * it says nothing about for how long, and neither is the Schedule 1 document
 * that has to exist before the processing at all. Before P32 only the first
 * ran, so ADR-0022's *"the system will refuse to act until"* was true of
 * sending and false of storing.
 *
 * ── Two staleness rules that look inconsistent, and are not ───────────────
 *
 * A determination's `reviewBy` is deliberately NOT re-checked here.
 * `determineLawfulBasis` refuses an expired one when it is made, and
 * `requirePolicy` does not re-check a policy's `reviewBy` either —
 * `validateSchedule` reports staleness and `pnpm run retention-status` prints
 * it. Adding a second, differently-placed staleness rule for one of those two
 * gates would be an inconsistency, not a control.
 *
 * The appropriate policy document's `reviewBy` IS checked, and the difference
 * is that **there is nowhere else it could be**. A determination is minted by a
 * function that refuses a lapsed one; a retention schedule is validated by a
 * command someone runs. A `held` policy-document entry is a plain record with
 * no minting step and no report, so a lapse nobody checked here is a lapse
 * nothing checks at all.
 *
 * ── Why `now` is a parameter rather than a default ────────────────────────
 *
 * Every dated decision in this repository is handed the time it should use —
 * `store`, `transition`, `decideExpiryWarning`, `determineLawfulBasis`. A gate
 * that read `new Date()` internally would be a gate no test could put on either
 * side of a review date, which is most of what there is to check about one.
 */
export function assertStorable(input: {
  readonly schedule: RetentionSchedule;
  readonly register: LawfulBasisRegister;
  readonly upload: DocumentUpload;
  readonly now: Date;
  /**
   * The Schedule 1 register, defaulting to what the system actually holds.
   *
   * Injectable so a test can put a document type on the far side of the
   * decision — a `held` entry is what re-enabling `national_id` will look like
   * — and defaulted to the REFUSING one, so an omission fails closed.
   */
  readonly policyDocuments?: AppropriatePolicyRegister;
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

  // ── The THIRD gate: DPA 2018 Sch. 1's appropriate policy document ──────
  //
  // Keyed on the DOCUMENT TYPE and not on the determination, because it is a
  // prerequisite of the processing rather than a property of the decision. It
  // runs before the Article 9 consent check on purpose: no consent, however
  // well recorded, can substitute for a document that does not exist, and a
  // developer told to add consent first would hit this wall on the next run.
  const policyDocumentCleared = requireAppropriatePolicy(
    input.policyDocuments ?? APPROPRIATE_POLICY_DOCUMENTS,
    input.upload.documentType,
    input.now,
  );

  // ── The FOURTH gate: an Article 9 condition, where the type needs one ───
  //
  // Scoped by the determination itself, so a passport passes untouched and a
  // national identity card does not. See `article9Required` in
  // `lawful-basis.ts` for why this is a subset rather than a flag.
  if ((record.article9Required ?? []).includes(input.upload.documentType)) {
    const consent = input.upload.specialCategoryConsent;
    if (consent === undefined) {
      throw new SpecialCategoryConsentMissingError(
        input.upload.documentType,
        `determination ${record.determinationId} names ${String(record.article9)} as that ` +
          `condition — but this upload carries no record of the consent being given.`,
      );
    }
    if (!consent.askedSeparately) {
      throw new SpecialCategoryConsentMissingError(
        input.upload.documentType,
        `the consent on this upload was not asked separately. A consent bundled into a general ` +
          `agreement is not freely given, which is the whole reason consent is NOT the Article 6 ` +
          `basis here.`,
      );
    }
    if (consent.wording.trim().length === 0) {
      throw new SpecialCategoryConsentMissingError(
        input.upload.documentType,
        `the consent on this upload records no wording. What the student agreed to is the record; ` +
          `a bare "they consented" is evidence of nothing.`,
      );
    }
  }

  return {
    ...input.upload,
    policyReference: policy.policyReference,
    lawfulBasis: determination,
    policyDocumentCleared,
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
