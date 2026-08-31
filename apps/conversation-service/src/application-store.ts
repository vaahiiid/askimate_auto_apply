/**
 * The conversation ↔ case binding, in the database that owns both.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `docs/roadmap-and-priorities.md` §3: the event-sourced case and the
 * orchestrator's `RunState` *"were built in different phases and were never
 * joined"*. Migration 0002 is the join; this class is the one place that reads
 * and writes it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Identity only ─────────────────────────────────────────────────────────
 *
 * There is no method here that returns a case's status, phase or contents,
 * because there is no column holding one. What happened to a case is in
 * `case_events` (@askimate/aas-case-store); where a run has got to is in
 * `workflow_runs`. This answers exactly two questions — *does this conversation
 * own a case, and which one* — and nothing else.
 *
 * ── The ownership check is the database's, not this file's ────────────────
 *
 * `bind` does not read the conversation's student and compare it. It does not
 * need to: `conversations_case_belongs_to_the_same_student` is a composite
 * foreign key over (student_id, case_id), so an attempt to bind another
 * student's case is rejected by PostgreSQL with a 23503 before this code sees
 * a row. A comparison here would be a second implementation of a rule that is
 * already stated once, in the schema, where a refactor cannot quietly drop it.
 */

import type { Pool } from "pg";

/** Raised when a bind names a conversation that does not exist. */
export class UnknownConversationBindingError extends Error {
  public override readonly name = "UnknownConversationBindingError";
  public constructor(conversationId: string) {
    super(`No conversation ${conversationId}.`);
  }
}

/**
 * Raised when a bind would attach a case the conversation's student does not
 * own, or a case another conversation already owns.
 *
 * One error for both, deliberately: from the caller's side each means "this
 * case is not yours to bind here", and distinguishing them would report which
 * of the two is true about a case belonging to somebody else.
 */
export class CaseBindingRefusedError extends Error {
  public override readonly name = "CaseBindingRefusedError";
  public constructor(caseId: string) {
    super(
      `Case ${caseId} cannot be bound to that conversation: it belongs to a different student, ` +
        `or a different conversation already owns it.`,
    );
  }
}

export interface ConversationCase {
  readonly caseId: string;
  readonly studentId: string;
  /**
   * Which blueprint this case is an application against.
   *
   * Null only for a case created before migration 0004. A case nobody can
   * identify cannot be resumed, and the driver says so rather than guessing.
   */
  readonly blueprintId: string | null;
}

export class ApplicationBindingStore {
  readonly #pool: Pool;

  public constructor(pool: Pool) {
    this.#pool = pool;
  }

  /** The case this conversation owns, or null. */
  public async caseFor(conversationId: string): Promise<ConversationCase | null> {
    const found = await this.#pool.query<{
      case_id: string | null;
      student_id: string;
      blueprint_id: string | null;
    }>(
      `SELECT c.case_id, c.student_id, k.blueprint_id
         FROM conversations c
    LEFT JOIN cases k ON k.case_id = c.case_id
        WHERE c.id = $1`,
      [conversationId],
    );
    const row = found.rows[0];
    if (row === undefined) return null;
    if (row.case_id === null) return null;
    return { caseId: row.case_id, studentId: row.student_id, blueprintId: row.blueprint_id };
  }

  /**
   * Binds a case, then does the caller's work while still holding the lock.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * Added because a test caught a real defect: `bind` on its own serialises the
   * BINDING and nothing after it. Two simultaneous starts therefore agreed on
   * one case — and then both went on to open that case's event log, and one
   * lost the race with a `ConcurrencyConflictError` the student would have seen
   * as a 500.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * The critical section is the whole of "bind, open the case, start the run",
   * so it is held across all three. `task` runs on its own connections, so its
   * writes commit before this transaction does — which is exactly what a second
   * caller, blocked here, needs to see when it is let through.
   *
   * Deliberately NOT held across `nextStep`: a row lock around a decision is a
   * row lock held for as long as a decision takes, and the decision is pure and
   * needs no lock.
   */
  public async withBinding<T>(
    input: {
      readonly conversationId: string;
      readonly caseId: string;
      readonly blueprintId: string;
      readonly now: Date;
    },
    task: (bound: ConversationCase, created: boolean) => Promise<T>,
  ): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ case_id: string | null; student_id: string }>(
        "SELECT case_id, student_id FROM conversations WHERE id = $1 FOR UPDATE",
        [input.conversationId],
      );
      const row = existing.rows[0];
      if (row === undefined) {
        await client.query("ROLLBACK");
        throw new UnknownConversationBindingError(input.conversationId);
      }

      let bound: ConversationCase;
      let created = false;
      if (row.case_id === null) {
        await client.query(
          "INSERT INTO cases (case_id, student_id, blueprint_id, created_at) VALUES ($1, $2, $3, $4)",
          [input.caseId, row.student_id, input.blueprintId, input.now],
        );
        await client.query(
          "UPDATE conversations SET case_id = $1, updated_at = $2 WHERE id = $3",
          [input.caseId, input.now, input.conversationId],
        );
        bound = { caseId: input.caseId, studentId: row.student_id, blueprintId: input.blueprintId };
        created = true;
      } else {
        const held = await client.query<{ blueprint_id: string | null }>(
          "SELECT blueprint_id FROM cases WHERE case_id = $1",
          [row.case_id],
        );
        bound = {
          caseId: row.case_id,
          studentId: row.student_id,
          blueprintId: held.rows[0]?.blueprint_id ?? null,
        };
      }

      const result = await task(bound, created);
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (typeof error === "object" && error !== null && "code" in error) {
        const code = (error as { code?: unknown }).code;
        if (code === "23503" || code === "23505") throw new CaseBindingRefusedError(input.caseId);
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
