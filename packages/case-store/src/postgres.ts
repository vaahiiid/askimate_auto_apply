/**
 * The Postgres case store.
 *
 * Passes the same `runCaseStoreContract` suite as the in-memory one. That is
 * the whole point of the contract existing: the durability guarantees in
 * brief §4 are easy to weaken accidentally when a map becomes a database, and
 * very hard to notice by reading code.
 *
 * ── Where each guarantee actually lives ──────────────────────────────────
 *
 * | Guarantee | Enforced by |
 * |---|---|
 * | append-only | no UPDATE or DELETE is issued, and `CaseStore` has no operation that would |
 * | no sequence gaps | a consecutive check in `append`, plus `CHECK ("sequence" > 0)` |
 * | optimistic concurrency | **`PRIMARY KEY (case_id, "sequence")`** |
 * | atomic append | one transaction |
 * | unique submission keys | **`PRIMARY KEY (submission_key)`** |
 *
 * The two bold rows are the ones that matter, and they are constraints rather
 * than code. An application-level "check then write" races by construction —
 * between the check and the write, the other worker writes. A unique index
 * does not race, and it is what makes the contract's two `Promise.allSettled`
 * tests pass rather than pass-most-of-the-time.
 *
 * ── The read-then-insert is still there, and is not the guarantee ────────
 *
 * `append` reads the current sequence before inserting. That is for the
 * *error message*: a caller that appended against a stale sequence should be
 * told which sequence the store is at, and a bare unique violation cannot say.
 * The insert is what actually decides.
 */

import type { CaseEvent, CaseId, SubmissionKey } from "@askimate/aas-domain";
import type { Pool, PoolClient } from "pg";

import { decodeEvent, encodeEvent } from "./serialisation.js";
import { ConcurrencyConflictError, DuplicateSubmissionError } from "./store.js";
import type { CaseStore } from "./store.js";

/** Postgres's unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export class PostgresCaseStore implements CaseStore {
  public constructor(private readonly pool: Pool) {}

  public async append(
    caseId: CaseId,
    expectedSequence: number,
    events: readonly CaseEvent[],
  ): Promise<void> {
    // An empty append is a no-op, per the contract. Doing it before opening a
    // transaction means an orchestrator that decided "nothing happened" costs
    // no round trip.
    if (events.length === 0) return;

    // ── Checks that do not need the database ────────────────────────────
    //
    // Done before the transaction, because they are faults in the CALLER, not
    // races: an event numbered wrongly, or belonging to another case, is a bug
    // in whoever built it and cannot be fixed by retrying.
    events.forEach((event, index) => {
      const expected = expectedSequence + index + 1;
      if (event.sequence !== expected) {
        throw new Error(
          `Events must be consecutive from the expected sequence: event ${String(index)} is ` +
            `numbered ${String(event.sequence)} but should be ${String(expected)}. A gap in a ` +
            `case log is unreadable — fold() refuses it — so this is rejected before anything ` +
            `is written.`,
        );
      }
      if (event.caseId !== caseId) {
        throw new Error(
          `Event ${event.eventId} belongs to case ${event.caseId}, not ${caseId}. Appending it ` +
            `here would put one case's history inside another's.`,
        );
      }
    });

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const actual = await this.#sequenceWithin(client, caseId);
      if (actual !== expectedSequence) {
        await client.query("ROLLBACK");
        throw new ConcurrencyConflictError(caseId, expectedSequence, actual);
      }

      for (const event of events) {
        await client.query(
          `INSERT INTO case_events (case_id, "sequence", event, occurred_at)
           VALUES ($1, $2, $3::jsonb, $4)`,
          [caseId, event.sequence, encodeEvent(event), event.occurredAt],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);

      // The race the read above cannot close: both workers read the same
      // sequence, both passed the check, and the primary key decided. The
      // loser is told the same thing it would have been told by the check.
      if (isUniqueViolation(error)) {
        throw new ConcurrencyConflictError(
          caseId,
          expectedSequence,
          await this.currentSequence(caseId),
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async read(caseId: CaseId): Promise<readonly CaseEvent[]> {
    const rows = await this.pool.query<{ event: unknown }>(
      `SELECT event FROM case_events WHERE case_id = $1 ORDER BY "sequence" ASC`,
      [caseId],
    );
    // A fresh array and freshly decoded objects on every read, so a caller that
    // mutates what it was given cannot reach the stored log. The in-memory
    // store has to copy deliberately; here it falls out of decoding.
    return rows.rows.map((row) => decodeEvent(row.event));
  }

  public async currentSequence(caseId: CaseId): Promise<number> {
    const client = await this.pool.connect();
    try {
      return await this.#sequenceWithin(client, caseId);
    } finally {
      client.release();
    }
  }

  public async claimSubmissionKey(key: SubmissionKey, caseId: CaseId): Promise<void> {
    try {
      // ON CONFLICT DO NOTHING, then read back who holds it. The alternative —
      // SELECT then INSERT — races: two claimants both see it unheld.
      const inserted = await this.pool.query(
        `INSERT INTO submission_keys (submission_key, case_id)
         VALUES ($1, $2)
         ON CONFLICT (submission_key) DO NOTHING`,
        [key, caseId],
      );
      if (inserted.rowCount === 1) return;

      const holder = await this.findBySubmissionKey(key);
      // Re-claiming for the same case is a no-op, so an idempotent retry of the
      // claim itself does not fail.
      if (holder === caseId) return;
      if (holder === null) {
        // Vanishingly unlikely: the conflicting row was deleted between the
        // insert and the read. Nothing deletes from this table, so this means
        // something outside the application is editing it.
        throw new Error(
          `Submission key ${key} conflicted on insert but is now unheld. Something outside this ` +
            `application is modifying submission_keys, which is the one table that must not be ` +
            `edited by hand.`,
        );
      }
      throw new DuplicateSubmissionError(key, holder);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const holder = await this.findBySubmissionKey(key);
        if (holder === caseId) return;
        if (holder !== null) throw new DuplicateSubmissionError(key, holder);
      }
      throw error;
    }
  }

  public async findBySubmissionKey(key: SubmissionKey): Promise<CaseId | null> {
    const rows = await this.pool.query<{ case_id: string }>(
      "SELECT case_id FROM submission_keys WHERE submission_key = $1",
      [key],
    );
    return (rows.rows[0]?.case_id ?? null) as CaseId | null;
  }

  /**
   * The case's current sequence, on a given client.
   *
   * `MAX("sequence")` rather than `COUNT(*)`: they agree only while there are
   * no gaps, and if a gap ever existed, counting would silently report a lower
   * sequence and invite an append that overwrote nothing and collided with
   * everything.
   */
  async #sequenceWithin(client: PoolClient, caseId: CaseId): Promise<number> {
    const rows = await client.query<{ max: string | null }>(
      `SELECT MAX("sequence") AS max FROM case_events WHERE case_id = $1`,
      [caseId],
    );
    const max = rows.rows[0]?.max;
    return max === null || max === undefined ? 0 : Number(max);
  }
}
