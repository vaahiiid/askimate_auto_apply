/**
 * In-memory document vault.
 *
 * The Phase 2 reference implementation: real enough to develop and test the
 * whole extract-then-confirm and validity flow against, with no AWS account.
 *
 * NOT for production — it holds contents in process memory and loses them on
 * restart, and it does not encrypt anything. The S3 + KMS implementation
 * arrives with the Phase 2 infrastructure and must satisfy this same contract.
 */

import type {
  DocumentId,
  DocumentRecord,
  DocumentState,
  DocumentVault,
  StorableUpload,
} from "./vault.js";
import { DocumentNotFoundError, DocumentPurgedError } from "./vault.js";

export class InMemoryDocumentVault implements DocumentVault {
  readonly #records = new Map<DocumentId, DocumentRecord>();
  readonly #contents = new Map<DocumentId, Uint8Array>();
  #counter = 0;

  /**
   * No retention schedule, and no lawful-basis register.
   *
   * Both used to be an implementation's business, which meant an
   * implementation could forget them. Since P32 the gates run in
   * `assertStorable`, which is the only producer of the `StorableUpload` this
   * method takes — so there is nothing left here to hold, and nothing left to
   * forget. See `vault.ts`.
   */
  public store(upload: StorableUpload, contents: Uint8Array, now: Date): Promise<DocumentRecord> {
    const policyReference = upload.policyReference;
    this.#counter += 1;
    const documentId = `doc_${String(this.#counter).padStart(6, "0")}`;

    const record: DocumentRecord = {
      documentId,
      studentId: upload.studentId,
      documentType: upload.documentType,
      purpose: upload.purpose,
      state: "uploaded",
      contentHash: upload.contentHash,
      contentType: upload.contentType,
      sizeBytes: upload.sizeBytes,
      uploadedAt: now,
      dates: upload.dates,
      retentionPolicyReference: policyReference,
      retentionTriggeredAt: null,
    };

    this.#records.set(documentId, record);
    this.#contents.set(documentId, contents.slice());
    return Promise.resolve(record);
  }

  public describe(documentId: DocumentId): Promise<DocumentRecord | null> {
    return Promise.resolve(this.#records.get(documentId) ?? null);
  }

  public retrieve(documentId: DocumentId): Promise<Uint8Array> {
    const record = this.#records.get(documentId);
    if (record === undefined) return Promise.reject(new DocumentNotFoundError(documentId));
    const contents = this.#contents.get(documentId);
    if (contents === undefined) return Promise.reject(new DocumentPurgedError(documentId));
    return Promise.resolve(contents.slice());
  }

  public listForStudent(studentId: string): Promise<readonly DocumentRecord[]> {
    return Promise.resolve([...this.#records.values()].filter((r) => r.studentId === studentId));
  }

  public transition(documentId: DocumentId, state: DocumentState, _now: Date): Promise<DocumentRecord> {
    const record = this.#records.get(documentId);
    if (record === undefined) return Promise.reject(new DocumentNotFoundError(documentId));
    const updated: DocumentRecord = { ...record, state };
    this.#records.set(documentId, updated);
    return Promise.resolve(updated);
  }

  public startRetentionClock(documentId: DocumentId, at: Date): Promise<DocumentRecord> {
    const record = this.#records.get(documentId);
    if (record === undefined) return Promise.reject(new DocumentNotFoundError(documentId));
    // Idempotent: the clock starts once. Re-triggering must not extend it.
    if (record.retentionTriggeredAt !== null) return Promise.resolve(record);
    const updated: DocumentRecord = { ...record, retentionTriggeredAt: at };
    this.#records.set(documentId, updated);
    return Promise.resolve(updated);
  }

  public purgeContents(documentId: DocumentId, _now: Date): Promise<DocumentRecord> {
    const record = this.#records.get(documentId);
    if (record === undefined) return Promise.reject(new DocumentNotFoundError(documentId));
    // Contents go; metadata and hash stay, so the audit trail survives erasure.
    this.#contents.delete(documentId);
    const updated: DocumentRecord = { ...record, state: "purged" };
    this.#records.set(documentId, updated);
    return Promise.resolve(updated);
  }
}
