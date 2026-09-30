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

/**
 * `held`: confirmed into the vault, nobody asked. `offered`: the interview
 * put the question (P251, ADR-0151). `pending`: the student said yes; the
 * reader may claim. `declined`: the student said no; the document is gone.
 */
export type ReadingState = "held" | "offered" | "pending" | "leased" | "read" | "failed" | "declined" | "superseded";

/**
 * Whether the student's word was had on this document (P253, row 108).
 *
 *   awaiting     held or offered: the question is not yet answered
 *   given        the student answered — before the reading (a yes or a no),
 *                or after it, to the honest question (`used` says which way)
 *   never_asked  read, leased or failed with no decision: the document was
 *                read before the question existed (before migration 0032).
 *                Vahid: *"a fact about how this system behaved for a period,
 *                and it should be legible as that rather than as missing
 *                data."* Named so nobody repairs the null.
 */
export type ReadingConsent = "awaiting" | "given" | "never_asked" | "moot";

export function consentOf(state: ReadingState, decidedAt: Date | null): ReadingConsent {
  // A later CV replaced this one before anyone was asked (P256): no question
  // was ever owed on it.
  if (state === "superseded") return "moot";
  if (state === "held" || state === "offered") return "awaiting";
  return decidedAt === null ? "never_asked" : "given";
}

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
  /** When the student answered the question, yes or no (P251, migration 0032). */
  readonly decidedAt: Date | null;
  /**
   * The conversation's last ordinal when the student said a LATE yes — the CV
   * arrived after its fields were confirmed, and they chose to go back (P252,
   * migration 0033). Events at or before it are the earlier confirmation;
   * the reading seeded after it reopens the field. `null` on every other row.
   */
  readonly reopenedAfter: number | null;
  /** The student's word on this document, by name (P253, row 108). Derived from `state` and `decidedAt`. */
  readonly consent: ReadingConsent;
  /** When the honest question was put on a row read before anyone asked (P253, migration 0034); `null` on every other row. */
  readonly askedAfterReadingAt: Date | null;
  /** The answer to that question: use what was read, or not. `null` while it stands, and on every other row. */
  readonly used: boolean | null;
  /** The later document that replaced this one before anyone was asked (P256, migration 0035); `null` on every other row. */
  readonly supersededBy: string | null;
  /** When the student was told what this row had to tell them — the question, that a CV ahead is held, or the reading's sentence. `null`: still owed (P256). */
  readonly toldAt: Date | null;
}

export interface DocumentReadingStore {
  /** Holds a confirmed document for the student's word — nothing is read until they say so (P251). A document already held is left as it is. */
  request(input: {
    readonly documentId: string;
    readonly conversationId: string;
    readonly studentId: string;
    readonly contentHash: string;
    readonly now: Date;
  }): Promise<void>;
  /** The question was put: `held` becomes `offered`, and the row is told (P256). `null` when the document is not held. */
  ask(documentId: string, now: Date): Promise<DocumentReading | null>;
  /** The student was told what this row had to tell them (P256): the held sentence, or the reading's. `null` when there is no such row. */
  told(documentId: string, now: Date): Promise<DocumentReading | null>;
  /** The rows in this conversation still owed a telling — held, or read — oldest first (P256). */
  untoldFor(conversationId: string): Promise<readonly DocumentReading[]>;
  /** A later CV replaces every earlier one of this student's in this conversation that nobody has been asked about yet (P256). The ids ended. */
  supersede(input: { readonly conversationId: string; readonly studentId: string; readonly by: string; readonly now: Date }): Promise<readonly string[]>;
  /**
   * The student's word on an offered document: yes makes it `pending` for the
   * reader, no ends it `declined`. `null` when no question stands.
   * `reopenedAfter`, on a yes, marks a late one (P252): the fields the CV can
   * fill are reopened from that ordinal.
   */
  decide(documentId: string, use: boolean, now: Date, reopenedAfter?: number): Promise<DocumentReading | null>;
  /** The document this conversation holds that is not yet ended — held, offered, pending or leased — the latest if several; `null` when none. */
  heldFor(conversationId: string): Promise<DocumentReading | null>;
  /** The latest document this conversation declined, or `null`: the honest answer to "actually, use my CV" after a no. */
  declinedFor(conversationId: string): Promise<DocumentReading | null>;
  /** The latest reading a late yes reopened fields for — pending, leased or read — or `null` (P252). A failed one reopened nothing: no seeding followed. */
  reopenedFor(conversationId: string): Promise<DocumentReading | null>;
  /** The latest document this conversation read before anyone asked — `read` with no decision — or `null` (P253, row 108). Returned while the honest question stands, until it is answered. */
  unaskedFor(conversationId: string): Promise<DocumentReading | null>;
  /** The honest question was put, on a row read before anyone asked. `null` when the row is not that, or was asked already. */
  askAfterReading(documentId: string, now: Date): Promise<DocumentReading | null>;
  /** The answer to the honest question. `null` when no such question stands. The row stays `read`: the reading happened. */
  decideAfterReading(documentId: string, use: boolean, now: Date): Promise<DocumentReading | null>;
  /** The documents whose parts a no set aside — read, and answered "do not use" — so the walk never reads them back (P253). */
  setAsideFor(conversationId: string): Promise<readonly string[]>;
  /** Leases the oldest document waiting (`pending`), or one whose lease lapsed; `null` when none. */
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
  readonly decided_at: Date | null;
  readonly reopened_after: number | null;
  readonly asked_after_reading_at: Date | null;
  readonly used: boolean | null;
  readonly superseded_by: string | null;
  readonly told_at: Date | null;
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
    decidedAt: row.decided_at,
    reopenedAfter: row.reopened_after,
    consent: consentOf(row.state as ReadingState, row.decided_at),
    askedAfterReadingAt: row.asked_after_reading_at,
    used: row.used,
    supersededBy: row.superseded_by,
    toldAt: row.told_at,
  };
}

const COLUMNS =
  "document_id, conversation_id, student_id, content_hash, state, requested_at, lease_id, holder, lease_expires_at, read_at, failure, structure, decided_at, reopened_after, asked_after_reading_at, used, superseded_by, told_at";

/** The `document_readings` table (migration 0030). */
export class PostgresDocumentReadingStore implements DocumentReadingStore {
  readonly #pool: Pool;

  public constructor(pool: Pool) {
    this.#pool = pool;
  }

  public async request(input: { documentId: string; conversationId: string; studentId: string; contentHash: string; now: Date }): Promise<void> {
    await this.#pool.query(
      `INSERT INTO document_readings (document_id, conversation_id, student_id, content_hash, state, requested_at)
            VALUES ($1, $2, $3, $4, 'held', $5)
       ON CONFLICT (document_id) DO NOTHING`,
      [input.documentId, input.conversationId, input.studentId, input.contentHash, input.now],
    );
  }

  public async ask(documentId: string, now: Date): Promise<DocumentReading | null> {
    const rows = await this.#pool.query<Row>(
      `UPDATE document_readings SET state = 'offered', told_at = $2 WHERE document_id = $1 AND state = 'held' RETURNING ${COLUMNS}`,
      [documentId, now],
    );
    const row = rows.rows[0];
    return row === undefined ? null : readingOf(row);
  }

  public async told(documentId: string, now: Date): Promise<DocumentReading | null> {
    const rows = await this.#pool.query<Row>(
      `UPDATE document_readings SET told_at = $2 WHERE document_id = $1 AND told_at IS NULL RETURNING ${COLUMNS}`,
      [documentId, now],
    );
    const row = rows.rows[0];
    return row === undefined ? null : readingOf(row);
  }

  public async untoldFor(conversationId: string): Promise<readonly DocumentReading[]> {
    const rows = await this.#pool.query<Row>(
      `SELECT ${COLUMNS} FROM document_readings
        WHERE conversation_id = $1 AND told_at IS NULL AND state IN ('held', 'read')
        ORDER BY requested_at ASC`,
      [conversationId],
    );
    return rows.rows.map(readingOf);
  }

  public async supersede(input: { conversationId: string; studentId: string; by: string; now: Date }): Promise<readonly string[]> {
    const rows = await this.#pool.query<{ document_id: string }>(
      `UPDATE document_readings SET state = 'superseded', superseded_by = $3, told_at = COALESCE(told_at, $4)
        WHERE conversation_id = $1 AND student_id = $2 AND document_id <> $3 AND state IN ('held', 'offered')
        RETURNING document_id`,
      [input.conversationId, input.studentId, input.by, input.now],
    );
    // RETURNING carries no order; the ids are sorted so the answer is one thing.
    return rows.rows.map((row) => row.document_id).sort();
  }

  public async decide(documentId: string, use: boolean, now: Date, reopenedAfter?: number): Promise<DocumentReading | null> {
    const rows = await this.#pool.query<Row>(
      `UPDATE document_readings SET state = $2, decided_at = $3, reopened_after = $4 WHERE document_id = $1 AND state = 'offered' RETURNING ${COLUMNS}`,
      [documentId, use ? "pending" : "declined", now, use ? (reopenedAfter ?? null) : null],
    );
    const row = rows.rows[0];
    return row === undefined ? null : readingOf(row);
  }

  public async heldFor(conversationId: string): Promise<DocumentReading | null> {
    const rows = await this.#pool.query<Row>(
      `SELECT ${COLUMNS} FROM document_readings
        WHERE conversation_id = $1 AND state IN ('held', 'offered', 'pending', 'leased')
        ORDER BY requested_at DESC LIMIT 1`,
      [conversationId],
    );
    const row = rows.rows[0];
    return row === undefined ? null : readingOf(row);
  }

  public async declinedFor(conversationId: string): Promise<DocumentReading | null> {
    const rows = await this.#pool.query<Row>(
      `SELECT ${COLUMNS} FROM document_readings
        WHERE conversation_id = $1 AND state = 'declined'
        ORDER BY decided_at DESC LIMIT 1`,
      [conversationId],
    );
    const row = rows.rows[0];
    return row === undefined ? null : readingOf(row);
  }

  public async reopenedFor(conversationId: string): Promise<DocumentReading | null> {
    const rows = await this.#pool.query<Row>(
      `SELECT ${COLUMNS} FROM document_readings
        WHERE conversation_id = $1 AND reopened_after IS NOT NULL AND state IN ('pending', 'leased', 'read')
        ORDER BY decided_at DESC LIMIT 1`,
      [conversationId],
    );
    const row = rows.rows[0];
    return row === undefined ? null : readingOf(row);
  }

  public async unaskedFor(conversationId: string): Promise<DocumentReading | null> {
    const rows = await this.#pool.query<Row>(
      `SELECT ${COLUMNS} FROM document_readings
        WHERE conversation_id = $1 AND state = 'read' AND decided_at IS NULL
        ORDER BY read_at DESC LIMIT 1`,
      [conversationId],
    );
    const row = rows.rows[0];
    return row === undefined ? null : readingOf(row);
  }

  public async askAfterReading(documentId: string, now: Date): Promise<DocumentReading | null> {
    const rows = await this.#pool.query<Row>(
      `UPDATE document_readings SET asked_after_reading_at = $2
        WHERE document_id = $1 AND state = 'read' AND decided_at IS NULL AND asked_after_reading_at IS NULL
        RETURNING ${COLUMNS}`,
      [documentId, now],
    );
    const row = rows.rows[0];
    return row === undefined ? null : readingOf(row);
  }

  public async decideAfterReading(documentId: string, use: boolean, now: Date): Promise<DocumentReading | null> {
    const rows = await this.#pool.query<Row>(
      `UPDATE document_readings SET decided_at = $3, used = $2
        WHERE document_id = $1 AND asked_after_reading_at IS NOT NULL AND decided_at IS NULL
        RETURNING ${COLUMNS}`,
      [documentId, use, now],
    );
    const row = rows.rows[0];
    return row === undefined ? null : readingOf(row);
  }

  public async setAsideFor(conversationId: string): Promise<readonly string[]> {
    const rows = await this.#pool.query<{ document_id: string }>(
      "SELECT document_id FROM document_readings WHERE conversation_id = $1 AND used = false ORDER BY document_id",
      [conversationId],
    );
    return rows.rows.map((row) => row.document_id);
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
          SET state = $3, read_at = $4, failure = $5, structure = $6, lease_id = NULL, holder = NULL, lease_expires_at = NULL, told_at = NULL
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
        state: "held",
        requestedAt: input.now,
        leaseId: null,
        holder: null,
        leaseExpiresAt: null,
        readAt: null,
        failure: null,
        structure: null,
        decidedAt: null,
        reopenedAfter: null,
        consent: "awaiting",
        askedAfterReadingAt: null,
        used: null,
        supersededBy: null,
        toldAt: null,
      });
    }
    return Promise.resolve();
  }

  public ask(documentId: string, now: Date): Promise<DocumentReading | null> {
    const row = this.#rows.get(documentId);
    if (row === undefined || row.state !== "held") return Promise.resolve(null);
    const offered: DocumentReading = { ...row, state: "offered", toldAt: now };
    this.#rows.set(documentId, offered);
    return Promise.resolve(offered);
  }

  public told(documentId: string, now: Date): Promise<DocumentReading | null> {
    const row = this.#rows.get(documentId);
    if (row === undefined || row.toldAt !== null) return Promise.resolve(null);
    const told: DocumentReading = { ...row, toldAt: now };
    this.#rows.set(documentId, told);
    return Promise.resolve(told);
  }

  public untoldFor(conversationId: string): Promise<readonly DocumentReading[]> {
    return Promise.resolve(
      [...this.#rows.values()]
        .filter((row) => row.conversationId === conversationId && row.toldAt === null && (row.state === "held" || row.state === "read"))
        .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime()),
    );
  }

  public supersede(input: { conversationId: string; studentId: string; by: string; now: Date }): Promise<readonly string[]> {
    const ended: string[] = [];
    for (const row of this.#rows.values()) {
      if (row.conversationId !== input.conversationId || row.studentId !== input.studentId || row.documentId === input.by) continue;
      if (row.state !== "held" && row.state !== "offered") continue;
      this.#rows.set(row.documentId, { ...row, state: "superseded", supersededBy: input.by, consent: "moot", toldAt: row.toldAt ?? input.now });
      ended.push(row.documentId);
    }
    return Promise.resolve(ended.sort());
  }

  public decide(documentId: string, use: boolean, now: Date, reopenedAfter?: number): Promise<DocumentReading | null> {
    const row = this.#rows.get(documentId);
    if (row === undefined || row.state !== "offered") return Promise.resolve(null);
    const decided: DocumentReading = { ...row, state: use ? "pending" : "declined", decidedAt: now, reopenedAfter: use ? (reopenedAfter ?? null) : null, consent: "given" };
    this.#rows.set(documentId, decided);
    return Promise.resolve(decided);
  }

  public heldFor(conversationId: string): Promise<DocumentReading | null> {
    const open = new Set<ReadingState>(["held", "offered", "pending", "leased"]);
    const found = [...this.#rows.values()]
      .filter((row) => row.conversationId === conversationId && open.has(row.state))
      .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())[0];
    return Promise.resolve(found ?? null);
  }

  public declinedFor(conversationId: string): Promise<DocumentReading | null> {
    const found = [...this.#rows.values()]
      .filter((row) => row.conversationId === conversationId && row.state === "declined")
      .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0];
    return Promise.resolve(found ?? null);
  }

  public unaskedFor(conversationId: string): Promise<DocumentReading | null> {
    const found = [...this.#rows.values()]
      .filter((row) => row.conversationId === conversationId && row.state === "read" && row.decidedAt === null)
      .sort((a, b) => (b.readAt?.getTime() ?? 0) - (a.readAt?.getTime() ?? 0))[0];
    return Promise.resolve(found ?? null);
  }

  public askAfterReading(documentId: string, now: Date): Promise<DocumentReading | null> {
    const row = this.#rows.get(documentId);
    if (row === undefined || row.state !== "read" || row.decidedAt !== null || row.askedAfterReadingAt !== null) return Promise.resolve(null);
    const asked: DocumentReading = { ...row, askedAfterReadingAt: now };
    this.#rows.set(documentId, asked);
    return Promise.resolve(asked);
  }

  public decideAfterReading(documentId: string, use: boolean, now: Date): Promise<DocumentReading | null> {
    const row = this.#rows.get(documentId);
    if (row === undefined || row.askedAfterReadingAt === null || row.decidedAt !== null) return Promise.resolve(null);
    const decided: DocumentReading = { ...row, decidedAt: now, used: use, consent: "given" };
    this.#rows.set(documentId, decided);
    return Promise.resolve(decided);
  }

  public setAsideFor(conversationId: string): Promise<readonly string[]> {
    return Promise.resolve(
      [...this.#rows.values()]
        .filter((row) => row.conversationId === conversationId && row.used === false)
        .map((row) => row.documentId)
        .sort(),
    );
  }

  public reopenedFor(conversationId: string): Promise<DocumentReading | null> {
    const reopened = new Set<ReadingState>(["pending", "leased", "read"]);
    const found = [...this.#rows.values()]
      .filter((row) => row.conversationId === conversationId && row.reopenedAfter !== null && reopened.has(row.state))
      .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0];
    return Promise.resolve(found ?? null);
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
      // A reading that ended has something new to tell (P256): the sentence.
      toldAt: null,
    });
    return true;
  }

  public readingFor(documentId: string): Promise<DocumentReading | null> {
    return Promise.resolve(this.#rows.get(documentId) ?? null);
  }
}
