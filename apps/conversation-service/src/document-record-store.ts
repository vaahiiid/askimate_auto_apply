/**
 * Where a document's METADATA lives — never its contents.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0093 left `DocumentRecord`s in a Map inside the S3 vault and said so:
 * the bytes were where D puts them, the record of them was not yet in the
 * conversation plane's database. This is that record store (ADR-0094), as a
 * port with two implementations — one over the `documents` table migration
 * 0017 creates, one in memory for tests — so the vault is the same class in
 * both places and the durability question is answered by what it was handed.
 *
 * What a record store holds is exactly `DocumentRecord` plus the object key
 * the bytes rest under. Nothing here can hold a byte of a document: the port
 * has no such method and the table has no such column.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Pool } from "pg";

import type { DocumentId, DocumentRecord, DocumentState } from "@askimate/aas-documents";
import type { DocumentType, RetentionPurpose } from "@askimate/aas-domain";

/** A record and where its contents rest. `objectKey` outlives a purge, for the audit. */
export interface StoredDocument {
  readonly record: DocumentRecord;
  readonly objectKey: string;
}

export interface DocumentRecordStore {
  /** Writes a new record. A repeated id is a programming error and the store must refuse it. */
  insert(record: DocumentRecord, objectKey: string): Promise<void>;
  get(documentId: DocumentId): Promise<StoredDocument | null>;
  listForStudent(studentId: string): Promise<readonly DocumentRecord[]>;
  /** Replaces the record's mutable metadata. The object key and the hash never change. */
  update(record: DocumentRecord, purgedAt: Date | null): Promise<void>;
}

/** Development and tests. Every record lives in this process's heap. */
export class InMemoryDocumentRecordStore implements DocumentRecordStore {
  readonly #rows = new Map<DocumentId, { record: DocumentRecord; objectKey: string }>();

  public insert(record: DocumentRecord, objectKey: string): Promise<void> {
    if (this.#rows.has(record.documentId)) {
      return Promise.reject(new Error(`document ${record.documentId} already recorded`));
    }
    this.#rows.set(record.documentId, { record, objectKey });
    return Promise.resolve();
  }

  public get(documentId: DocumentId): Promise<StoredDocument | null> {
    const row = this.#rows.get(documentId);
    return Promise.resolve(row === undefined ? null : { record: row.record, objectKey: row.objectKey });
  }

  public listForStudent(studentId: string): Promise<readonly DocumentRecord[]> {
    return Promise.resolve(
      [...this.#rows.values()].map((r) => r.record).filter((r) => r.studentId === studentId),
    );
  }

  public update(record: DocumentRecord, _purgedAt: Date | null): Promise<void> {
    const row = this.#rows.get(record.documentId);
    if (row === undefined) return Promise.reject(new Error(`no document ${record.documentId}`));
    this.#rows.set(record.documentId, { record, objectKey: row.objectKey });
    return Promise.resolve();
  }
}

interface DocumentRow {
  readonly document_id: string;
  readonly student_id: string;
  readonly document_type: string;
  readonly purpose: string;
  readonly state: string;
  readonly content_hash: string;
  readonly content_type: string;
  readonly size_bytes: string | number;
  readonly uploaded_at: Date;
  readonly dates: Record<string, unknown>;
  readonly retention_policy_reference: string;
  readonly retention_triggered_at: Date | null;
  readonly superseded_by: string | null;
  readonly object_key: string;
}

function recordOf(row: DocumentRow): DocumentRecord {
  return {
    documentId: row.document_id,
    studentId: row.student_id,
    documentType: row.document_type as DocumentType,
    purpose: row.purpose as RetentionPurpose,
    state: row.state as DocumentState,
    contentHash: row.content_hash,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    uploadedAt: row.uploaded_at,
    dates: row.dates,
    retentionPolicyReference: row.retention_policy_reference,
    retentionTriggeredAt: row.retention_triggered_at,
    ...(row.superseded_by === null ? {} : { supersededBy: row.superseded_by }),
  };
}

const COLUMNS =
  "document_id, student_id, document_type, purpose, state, content_hash, content_type, size_bytes, " +
  "uploaded_at, dates, retention_policy_reference, retention_triggered_at, superseded_by, object_key";

/** The `documents` table (migration 0017). */
export class PostgresDocumentRecordStore implements DocumentRecordStore {
  readonly #pool: Pool;

  public constructor(pool: Pool) {
    this.#pool = pool;
  }

  public async insert(record: DocumentRecord, objectKey: string): Promise<void> {
    await this.#pool.query(
      `INSERT INTO documents
         (document_id, student_id, document_type, purpose, state, content_hash, content_type,
          size_bytes, uploaded_at, dates, retention_policy_reference, retention_triggered_at,
          superseded_by, object_key, purged_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, NULL)`,
      [
        record.documentId,
        record.studentId,
        record.documentType,
        record.purpose,
        record.state,
        record.contentHash,
        record.contentType,
        record.sizeBytes,
        record.uploadedAt,
        JSON.stringify(record.dates),
        record.retentionPolicyReference,
        record.retentionTriggeredAt,
        record.supersededBy ?? null,
        objectKey,
      ],
    );
  }

  public async get(documentId: DocumentId): Promise<StoredDocument | null> {
    const rows = await this.#pool.query<DocumentRow>(
      `SELECT ${COLUMNS} FROM documents WHERE document_id = $1`,
      [documentId],
    );
    const row = rows.rows[0];
    return row === undefined ? null : { record: recordOf(row), objectKey: row.object_key };
  }

  public async listForStudent(studentId: string): Promise<readonly DocumentRecord[]> {
    const rows = await this.#pool.query<DocumentRow>(
      `SELECT ${COLUMNS} FROM documents WHERE student_id = $1 ORDER BY uploaded_at, document_id`,
      [studentId],
    );
    return rows.rows.map(recordOf);
  }

  public async update(record: DocumentRecord, purgedAt: Date | null): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE documents
          SET state = $2,
              retention_triggered_at = $3,
              superseded_by = $4,
              purged_at = $5
        WHERE document_id = $1`,
      [
        record.documentId,
        record.state,
        record.retentionTriggeredAt,
        record.supersededBy ?? null,
        purgedAt,
      ],
    );
    if (result.rowCount !== 1) throw new Error(`no document ${record.documentId}`);
  }
}
