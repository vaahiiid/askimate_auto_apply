/**
 * What the plane knows about a CV being read (ADR-0148 §9, P246).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A row per document sent for reading: which conversation it was sent in,
 * whether a reader holds it, and how the reading ended. NO byte of the
 * document, no line of it, no value read from it — the values go on the
 * conversation log as part readings (migration 0025), where the interview
 * picks them up, and the document itself stays in the vault under ADR-0092.
 *
 * The lease is the runner's lease shape (`work-store.ts`): a claim takes the
 * oldest pending row, or a leased one whose lease has lapsed, and a report
 * is accepted only from the holder of the lease it names. A reader that dies
 * mid-read leaves nothing to undo, because a reading writes nothing until it
 * reports; its lease lapses and the next reader takes the document again.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Pool } from "pg";

import type { ReadingStructure } from "./reading-account.js";

export type ReadingState = "pending" | "leased" | "read" | "failed";

export interface DocumentReading {
  readonly documentId: string;
  readonly conversationId: string;
  readonly studentId: string;
  readonly contentHash: string;
  readonly state: ReadingState;
  readonly requestedAt: Date;
  readonly leaseId: string | null;
  readonly holder: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly readAt: Date | null;
  /** The contract's closed word, or the gate's. Never a sentence. */
  readonly failure: string | null;
  /** What the report was made of — entries, parts, gaps — on a reading that was read (P248, migration 0031). Part keys and counts; never a value or a span. */
  readonly structure: ReadingStructure | null;
}

export interface DocumentReadingStore {
  /** Asks for a document to be read. A document already asked for is left as it is. */
  request(input: {
    readonly documentId: string;
    readonly conversationId: string;
    readonly studentId: string;
    readonly contentHash: string;
    readonly now: Date;
  }): Promise<void>;
  /** Leases the oldest document waiting, or one whose lease lapsed; `null` when none. */
  claim(input: {
    readonly holder: string;
    readonly leaseId: string;
    readonly now: Date;
    readonly leaseSeconds: number;
  }): Promise<DocumentReading | null>;
  /** The reading the given lease holds, or `null` when that lease is not the live one. */
  held(documentId: string, leaseId: string, now: Date): Promise<DocumentReading | null>;
  /** Ends a reading. `false` when the lease named is not the live one. */
  complete(input: {
    readonly documentId: string;
    readonly leaseId: string;
    readonly outcome: "read" | "failed";
    readonly failure?: string;
    readonly structure?: ReadingStructure;
    readonly now: Date;
  }): Promise<boolean>;
  readingFor(documentId: string): Promise<DocumentReading | null>;
}

interface Row {
  readonly document_id: string;
  readonly conversation_id: string;
  readonly student_id: string;
  readonly content_hash: string;
  readonly state: string;
  readonly requested_at: Date;
  readonly lease_id: string | null;
  readonly holder: string | null;
  readonly lease_expires_at: Date | null;
  readonly read_at: Date | null;
  readonly failure: string | null;
  readonly structure: ReadingStructure | null;
}

function readingOf(row: Row): DocumentReading {
  return {
    documentId: row.document_id,
    conversationId: row.conversation_id,
    studentId: row.student_id,
    contentHash: row.content_hash,
    state: row.state as ReadingState,
    requestedAt: row.requested_at,
    leaseId: row.lease_id,
    holder: row.holder,
    leaseExpiresAt: row.lease_expires_at,
    readAt: row.read_at,
    failure: row.failure,
    structure: row.structure,
  };
}

const COLUMNS =
  "document_id, conversation_id, student_id, content_hash, state, requested_at, lease_id, holder, lease_expires_at, read_at, failure, structure";

/** The `document_readings` table (migration 0030). */
export class PostgresDocumentReadingStore implements DocumentReadingStore {
  readonly #pool: Pool;

  public constructor(pool: Pool) {
    this.#pool = pool;
  }

  public async request(input: { documentId: string; conversationId: string; studentId: string; contentHash: string; now: Date }): Promise<void> {
    await this.#pool.query(
      `INSERT INTO document_readings (document_id, conversation_id, student_id, content_hash, state, requested_at)
            VALUES ($1, $2, $3, $4, 'pending', $5)
       ON CONFLICT (document_id) DO NOTHING`,
      [input.documentId, input.conversationId, input.studentId, input.contentHash, input.now],
    );
  }

  public async claim(input: { holder: string; leaseId: string; now: Date; leaseSeconds: number }): Promise<DocumentReading | null> {
    const expiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1000);
    // One statement: the candidate is chosen and leased under one lock, so
    // two readers polling together cannot both take it.
    const rows = await this.#pool.query<Row>(
      `UPDATE document_readings
          SET state = 'leased', lease_id = $1, holder = $2, lease_expires_at = $3
        WHERE document_id = (
              SELECT document_id FROM document_readings
               WHERE state = 'pending' OR (state = 'leased' AND lease_expires_at <= $4)
               ORDER BY requested_at ASC
               LIMIT 1
               FOR UPDATE SKIP LOCKED)
        RETURNING ${COLUMNS}`,
      [input.leaseId, input.holder, expiresAt, input.now],
    );
    const row = rows.rows[0];
    return row === undefined ? null : readingOf(row);
  }

  public async held(documentId: string, leaseId: string, now: Date): Promise<DocumentReading | null> {
    const rows = await this.#pool.query<Row>(
      `SELECT ${COLUMNS} FROM document_readings
        WHERE document_id = $1 AND state = 'leased' AND lease_id = $2 AND lease_expires_at > $3`,
      [documentId, leaseId, now],
    );
    const row = rows.rows[0];
    return row === undefined ? null : readingOf(row);
  }

  public async complete(input: { documentId: string; leaseId: string; outcome: "read" | "failed"; failure?: string; structure?: ReadingStructure; now: Date }): Promise<boolean> {
    const rows = await this.#pool.query(
      `UPDATE document_readings
          SET state = $3, read_at = $4, failure = $5, structure = $6, lease_id = NULL, holder = NULL, lease_expires_at = NULL
        WHERE document_id = $1 AND state = 'leased' AND lease_id = $2 AND lease_expires_at > $4`,
      [
        input.documentId,
        input.leaseId,
        input.outcome,
        input.now,
        input.outcome === "failed" ? (input.failure ?? "reader_fault") : null,
        input.outcome === "read" && input.structure !== undefined ? JSON.stringify(input.structure) : null,
      ],
    );
    return (rows.rowCount ?? 0) === 1;
  }

  public async readingFor(documentId: string): Promise<DocumentReading | null> {
    const rows = await this.#pool.query<Row>(`SELECT ${COLUMNS} FROM document_readings WHERE document_id = $1`, [documentId]);
    const row = rows.rows[0];
    return row === undefined ? null : readingOf(row);
  }
}

/** Tests and development. Every row lives in this process's heap. */
export class InMemoryDocumentReadingStore implements DocumentReadingStore {
  readonly #rows = new Map<string, DocumentReading>();

  public request(input: { documentId: string; conversationId: string; studentId: string; contentHash: string; now: Date }): Promise<void> {
    if (!this.#rows.has(input.documentId)) {
      this.#rows.set(input.documentId, {
        documentId: input.documentId,
        conversationId: input.conversationId,
        studentId: input.studentId,
        contentHash: input.contentHash,
        state: "pending",
        requestedAt: input.now,
        leaseId: null,
        holder: null,
        leaseExpiresAt: null,
        readAt: null,
        failure: null,
        structure: null,
      });
    }
    return Promise.resolve();
  }

  public claim(input: { holder: string; leaseId: string; now: Date; leaseSeconds: number }): Promise<DocumentReading | null> {
    const candidate = [...this.#rows.values()]
      .filter((row) => row.state === "pending" || (row.state === "leased" && row.leaseExpiresAt !== null && row.leaseExpiresAt.getTime() <= input.now.getTime()))
      .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime())[0];
    if (candidate === undefined) return Promise.resolve(null);
    const leased: DocumentReading = {
      ...candidate,
      state: "leased",
      leaseId: input.leaseId,
      holder: input.holder,
      leaseExpiresAt: new Date(input.now.getTime() + input.leaseSeconds * 1000),
    };
    this.#rows.set(candidate.documentId, leased);
    return Promise.resolve(leased);
  }

  public held(documentId: string, leaseId: string, now: Date): Promise<DocumentReading | null> {
    const row = this.#rows.get(documentId);
    const live = row !== undefined && row.state === "leased" && row.leaseId === leaseId && row.leaseExpiresAt !== null && row.leaseExpiresAt.getTime() > now.getTime();
    return Promise.resolve(live ? row : null);
  }

  public async complete(input: { documentId: string; leaseId: string; outcome: "read" | "failed"; failure?: string; structure?: ReadingStructure; now: Date }): Promise<boolean> {
    const row = await this.held(input.documentId, input.leaseId, input.now);
    if (row === null) return false;
    this.#rows.set(input.documentId, {
      ...row,
      state: input.outcome,
      readAt: input.now,
      failure: input.outcome === "failed" ? (input.failure ?? "reader_fault") : null,
      structure: input.outcome === "read" && input.structure !== undefined ? input.structure : null,
      leaseId: null,
      holder: null,
      leaseExpiresAt: null,
    });
    return true;
  }

  public readingFor(documentId: string): Promise<DocumentReading | null> {
    return Promise.resolve(this.#rows.get(documentId) ?? null);
  }
}
