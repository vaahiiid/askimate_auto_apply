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

/**
 * The advisory-lock namespace this module owns.
 *
 * Advisory locks are a single global keyspace shared by everything connected to
 * the database, so a bare `hashtext(id)` would be a name anyone could collide
 * with. The two-argument form gives it a namespace; this is ours.
 */
const CONVERSATION_LOCK_NAMESPACE = 0x4141_5301;

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
  /**
   * Which conversation authorised this case, or `null`.
   *
   * The reverse of `caseFor`, and it exists because work intake starts from a
   * RUN rather than from a conversation (ADR-0045): the claim path finds a
   * candidate run, and the run knows its case but not the conversation whose
   * student asked for it. The composite foreign key added in migration 0002 is
   * what makes this a single lookup rather than a guess.
   *
   * `null` means no conversation is bound to that case — which, given the
   * partial unique index, means the case was not opened through this service.
   * A run in that state is not claimable, and refusing it here is what keeps
   * "a run is attributable to the student and conversation that authorised it"
   * true on the work path as well as on the start path.
   */
  public async conversationForCase(caseId: string): Promise<string | null> {
    const rows = await this.#pool.query<{ id: string }>(
      "SELECT id FROM conversations WHERE case_id = $1",
      [caseId],
    );
    return rows.rows[0]?.id ?? null;
  }

  /**
   * Runs `task` while holding this conversation's ADVISORY lock.
   *
   * ═════════════════════════════════════════════════════════════════════════
   * "Ask the student for a password" is a critical section, and the run's
   * checkpoint is not what guards it. Two callers advancing the SAME
   * conversation can both hold a valid revision — the second loads the record
   * after the first has already checkpointed, so the optimistic lock never
   * fires — and then both read a log with no live request in it and both ask.
   * The student watches one secure box be replaced by another, and whichever
   * they typed into settles a request the run is no longer watching.
   * ═════════════════════════════════════════════════════════════════════════
   *
   * ── Why advisory, and not `SELECT … FOR UPDATE` like `withBinding` ───────
   *
   * Because the task APPENDS to the log, and appending updates
   * `conversations.last_ordinal` on a different connection. Holding the
   * conversation's row lock across that call deadlocks against the caller's own
   * append — not a lock wait that resolves, but one that never can, because the
   * transaction holding the row is waiting for the append that is waiting for
   * the row. This was written the obvious way first and hung exactly there.
   *
   * An advisory lock is a lock on a NAME. It excludes other holders of the same
   * name and nothing else, so the append proceeds while it is held.
   *
   * ── What it does and does not promise ───────────────────────────────────
   *
   * Mutual exclusion between processes asking the same question, not atomicity:
   * the task calls another service over HTTP, which cannot be inside a
   * transaction. A process killed mid-task leaves the lock (the session ends,
   * so PostgreSQL releases it) and possibly an opened request whose event was
   * never appended — which expires within ADR-0034's five minutes.
   */
  public async withConversationLock<T>(
    conversationId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const client = await this.#pool.connect();
    try {
      // Two-argument form. The first is a namespace this application owns, so a
      // conversation id that happened to hash to the same number as some other
      // subsystem's advisory key cannot collide with it.
      await client.query("SELECT pg_advisory_lock($1, hashtext($2))", [
        CONVERSATION_LOCK_NAMESPACE,
        conversationId,
      ]);
      try {
        return await task();
      } finally {
        await client
          .query("SELECT pg_advisory_unlock($1, hashtext($2))", [
            CONVERSATION_LOCK_NAMESPACE,
            conversationId,
          ])
          // Released with the session anyway. Swallowed so a failure to unlock
          // cannot mask the task's own error.
          .catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }

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
