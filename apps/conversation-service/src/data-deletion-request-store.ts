/**
 * A request to delete the student's confirmed details, passed to a person
 * (P275, row 130). Migration 0038.
 *
 * Two sentences promise this handoff: the stop message's *"I will pass it to
 * a person"* (D6) and, after a document is deleted, *"tell me and I will say
 * what that takes"* (D31). What a person then does — the deletion itself — is
 * not built (stage B); this is the half that makes the promise true: the
 * request is held where a person reads it, raised once, and closed by a
 * person whose closing the student is told.
 *
 * Written by the Run Driver alone. The command a person runs calls the
 * service's internal routes, never this table (ADR-0048: one writer).
 */

import type pg from "pg";

export type DeletionOutcome = "deleted" | "declined";

export interface DataDeletionRequest {
  readonly requestId: string;
  readonly conversationId: string;
  readonly studentId: string;
  readonly caseId: string;
  readonly raisedAt: Date;
  /** Absent while it is open. `closedBy` is asserted, not authenticated (ADR-0048 §3). */
  readonly closed?: {
    readonly closedAt: Date;
    readonly closedBy: string;
    readonly outcome: DeletionOutcome;
    readonly reason: string | null;
  };
}

interface Row {
  request_id: string;
  conversation_id: string;
  student_id: string;
  case_id: string;
  raised_at: Date;
  closed_at: Date | null;
  closed_by: string | null;
  outcome: DeletionOutcome | null;
  reason: string | null;
}

const COLUMNS = "request_id, conversation_id, student_id, case_id, raised_at, closed_at, closed_by, outcome, reason";

function fromRow(row: Row): DataDeletionRequest {
  return {
    requestId: row.request_id,
    conversationId: row.conversation_id,
    studentId: row.student_id,
    caseId: row.case_id,
    raisedAt: row.raised_at,
    ...(row.closed_at === null || row.closed_by === null || row.outcome === null
      ? {}
      : { closed: { closedAt: row.closed_at, closedBy: row.closed_by, outcome: row.outcome, reason: row.reason } }),
  };
}

export class DataDeletionRequestStore {
  readonly #pool: pg.Pool;

  public constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  /**
   * Raises a request, or answers with the one already open for this student.
   * Raised ONCE: a student who says it twice is told it is with a person, and
   * a person reads one row, not two.
   */
  public async raise(input: {
    readonly requestId: string;
    readonly conversationId: string;
    readonly studentId: string;
    readonly caseId: string;
    readonly now: Date;
  }): Promise<{ readonly raised: boolean; readonly request: DataDeletionRequest }> {
    const inserted = await this.#pool.query<Row>(
      `INSERT INTO data_deletion_requests (request_id, conversation_id, student_id, case_id, raised_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (student_id) WHERE closed_at IS NULL DO NOTHING
       RETURNING ${COLUMNS}`,
      [input.requestId, input.conversationId, input.studentId, input.caseId, input.now],
    );
    const row = inserted.rows[0];
    if (row !== undefined) return { raised: true, request: fromRow(row) };
    const open = await this.openFor(input.studentId);
    if (open === null) throw new Error(`a deletion request for ${input.studentId} was neither raised nor open`);
    return { raised: false, request: open };
  }

  /** The student's open request, if there is one. */
  public async openFor(studentId: string): Promise<DataDeletionRequest | null> {
    const found = await this.#pool.query<Row>(
      `SELECT ${COLUMNS} FROM data_deletion_requests WHERE student_id = $1 AND closed_at IS NULL`,
      [studentId],
    );
    const row = found.rows[0];
    return row === undefined ? null : fromRow(row);
  }

  /** Every open request, oldest first: what a person reads. */
  public async open(): Promise<readonly DataDeletionRequest[]> {
    const found = await this.#pool.query<Row>(
      `SELECT ${COLUMNS} FROM data_deletion_requests WHERE closed_at IS NULL ORDER BY raised_at, request_id`,
    );
    return found.rows.map(fromRow);
  }

  public async get(requestId: string): Promise<DataDeletionRequest | null> {
    const found = await this.#pool.query<Row>(`SELECT ${COLUMNS} FROM data_deletion_requests WHERE request_id = $1`, [requestId]);
    const row = found.rows[0];
    return row === undefined ? null : fromRow(row);
  }

  /**
   * Closes an open request. `closedNow: false` when it was already closed —
   * the earlier closing stands and this one is NOT recorded, because two
   * people closing one request differently is evidence, not an update.
   */
  public async close(input: {
    readonly requestId: string;
    readonly closedBy: string;
    readonly outcome: DeletionOutcome;
    readonly reason: string | null;
    readonly now: Date;
  }): Promise<{ readonly closedNow: boolean; readonly request: DataDeletionRequest } | null> {
    const updated = await this.#pool.query<Row>(
      `UPDATE data_deletion_requests
          SET closed_at = $2, closed_by = $3, outcome = $4, reason = $5
        WHERE request_id = $1 AND closed_at IS NULL
        RETURNING ${COLUMNS}`,
      [input.requestId, input.now, input.closedBy, input.outcome, input.reason],
    );
    const row = updated.rows[0];
    if (row !== undefined) return { closedNow: true, request: fromRow(row) };
    const existing = await this.get(input.requestId);
    return existing === null ? null : { closedNow: false, request: existing };
  }
}
