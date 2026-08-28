/**
 * The ordinal authority.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"The client must never create a durable ordinal. Only the
 * Conversation Service assigns ordinals."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── How a position is claimed ─────────────────────────────────────────────
 *
 *     UPDATE conversations SET last_ordinal = last_ordinal + 1
 *      WHERE id = $1 RETURNING last_ordinal;
 *
 * One statement, and it does three things at once:
 *
 *   1. **Claims** the next position and returns it.
 *   2. **Locks** the conversation row for the rest of the transaction, so a
 *      second writer on the same conversation blocks here rather than reading
 *      a stale `last_ordinal` and claiming the same number.
 *   3. **Advances** the counter, in the same transaction as the insert that
 *      uses it — so a failure after the claim rolls back BOTH. `last_ordinal`
 *      can never be ahead of the log.
 *
 * The read-then-write alternative —
 *
 *     SELECT last_ordinal FROM conversations WHERE id = $1;   -- no lock
 *     INSERT … VALUES (…, $last + 1, …);
 *
 * — races: under READ COMMITTED two transactions read the same value and both
 * try position 7. `UNIQUE (conversation_id, ordinal)` turns that into a 23505
 * rather than a duplicate, which is the backstop working — but a backstop that
 * fires on every concurrent send is a retry loop, not a design. The `UPDATE`
 * takes the lock first, so the second writer waits and then gets 8.
 *
 * ── Why not a sequence ────────────────────────────────────────────────────
 *
 * A PostgreSQL sequence is faster and is wrong here: sequences are not
 * transactional, so a rolled-back insert consumes a number and leaves a GAP.
 * Ordinals must be DENSE, because they are the SSE event id and a client that
 * resumes after 41 and receives 43 cannot tell "42 was rolled back" from "42
 * was lost". Density is what makes `Last-Event-ID` a complete answer.
 */

import type { Pool, PoolClient } from "pg";

import type { ConversationEvent, Ordinal, RejectionReason } from "@askimate/aas-contracts";

/** PostgreSQL's unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

/**
 * An event as a caller may ask for it: with no ordinal and no timestamp.
 *
 * Both are the server's. There is deliberately no field here a client could
 * set — a client-supplied ordinal cannot become authoritative because there is
 * nowhere to put one.
 */
export type AppendableEvent =
  | { readonly kind: "message"; readonly actor: "student" | "assistant" | "mentor" | "system";
      readonly content: string }
  | { readonly kind: "secret_requested"; readonly requestId: string;
      readonly channel: "secure_control"; readonly expiresAt: string }
  | { readonly kind: "secret_received"; readonly requestId: string; readonly handle: string }
  | { readonly kind: "secret_consumed" | "secret_expired" | "secret_cancelled";
      readonly requestId: string }
  | { readonly kind: "secret_rejected"; readonly requestId: string;
      readonly reason: RejectionReason };

/**
 * COMPILE-TIME: nothing appendable may name its own position.
 *
 * Ends in a CONSTRAINT rather than merely evaluating to `never` — a conditional
 * that computes `never` when the claim is false fails at nothing, which is how
 * an assertion of mine was vacuous until a regression caught it.
 */
type Positional = "ordinal" | "createdAt" | "id";
type NamesItsOwnPosition<T> = T extends unknown
  ? Extract<keyof T, Positional> extends never
    ? never
    : T
  : never;
type AssertNever<T extends never> = T;
export type NO_CALLER_MAY_NAME_A_POSITION = AssertNever<NamesItsOwnPosition<AppendableEvent>>;

export interface AppendResult {
  readonly event: ConversationEvent;
  /** True when an idempotency key replayed a write that had already happened. */
  readonly replayed: boolean;
}

export class UnknownConversationError extends Error {
  public override readonly name = "UnknownConversationError";
  public constructor(conversationId: string) {
    super(`No conversation ${conversationId}`);
  }
}

/** Raised when a key is reused with a different body — a client bug, not a replay. */
export class IdempotencyConflictError extends Error {
  public override readonly name = "IdempotencyConflictError";
  public constructor() {
    super(
      "Idempotency key already used with a different request body. Returning the first " +
        "result would hide the difference rather than surface it.",
    );
  }
}

function rowToEvent(row: Record<string, unknown>): ConversationEvent {
  const ordinal = Number(row["ordinal"]);
  const createdAt = (row["created_at"] as Date).toISOString();
  const kind = row["kind"] as ConversationEvent["kind"];
  const requestId = row["request_id"] as string | null;

  switch (kind) {
    case "message":
      return {
        kind: "message",
        ordinal,
        createdAt,
        actor: row["actor"] as "student" | "assistant" | "mentor" | "system",
        content: (row["content"] as string | null) ?? null,
        ...(row["redacted_at"] === null || row["redacted_at"] === undefined
          ? {}
          : { redactedAt: (row["redacted_at"] as Date).toISOString() }),
      };
    case "secret_requested":
      return {
        kind,
        ordinal,
        createdAt,
        requestId: requestId ?? "",
        channel: "secure_control",
        expiresAt: (row["expires_at"] as Date).toISOString(),
      };
    case "secret_received":
      return { kind, ordinal, createdAt, requestId: requestId ?? "", handle: row["handle"] as string };
    case "secret_rejected":
      return {
        kind,
        ordinal,
        createdAt,
        requestId: requestId ?? "",
        reason: row["reason_code"] as RejectionReason,
      };
    // Enumerated, not `default:`. A catch-all here would quietly turn a kind
    // added to the union later into a settlement — the same mistake
    // `problems.ts` had, where a `default:` made a new problem code render as
    // an existing one instead of failing the build.
    case "secret_consumed":
    case "secret_expired":
    case "secret_cancelled":
      return { kind, ordinal, createdAt, requestId: requestId ?? "" };
  }
}

const SELECT_EVENT = `
  SELECT e.ordinal, e.created_at, e.kind, e.actor, e.request_id, e.handle,
         e.reason_code, e.channel, e.expires_at, b.content, b.redacted_at
    FROM conversation_events e
    LEFT JOIN message_bodies b ON b.id = e.body_id
`;

export class ConversationEventStore {
  readonly #pool: Pool;
  /** In-process notification, so a local subscriber does not wait for a poll. */
  readonly #listeners = new Map<string, Set<(event: ConversationEvent) => void>>();

  public constructor(pool: Pool) {
    this.#pool = pool;
  }

  /**
   * Appends one event, assigning its ordinal, atomically.
   *
   * `idempotencyKey` and `studentId` together make a retry safe: a client that
   * times out and resends gets the FIRST event back rather than a second copy
   * of a student's message in the transcript.
   */
  public async append(input: {
    readonly conversationId: string;
    readonly event: AppendableEvent;
    readonly idempotency?: { readonly key: string; readonly studentId: string;
                             readonly digest: string };
  }): Promise<AppendResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");

      if (input.idempotency !== undefined) {
        const replayed = await this.#replayIfSeen(client, input.idempotency);
        if (replayed !== null) {
          await client.query("COMMIT");
          return { event: replayed, replayed: true };
        }
      }

      // ── The claim ────────────────────────────────────────────────────
      //
      // Locks the conversation row AND returns the position, in one statement.
      // A concurrent writer blocks on this line until this transaction ends.
      const claimed = await client.query<{ last_ordinal: number }>(
        `UPDATE conversations
            SET last_ordinal = last_ordinal + 1, updated_at = now()
          WHERE id = $1
      RETURNING last_ordinal`,
        [input.conversationId],
      );
      const ordinal = claimed.rows[0]?.last_ordinal;
      if (ordinal === undefined) {
        await client.query("ROLLBACK");
        throw new UnknownConversationError(input.conversationId);
      }

      const written = await this.#insert(client, input.conversationId, ordinal, input.event);

      if (input.idempotency !== undefined) {
        await client.query(
          `INSERT INTO idempotency_keys (student_id, key, request_digest, event_id)
           VALUES ($1, $2, $3, (SELECT id FROM conversation_events
                                 WHERE conversation_id = $4 AND ordinal = $5))`,
          [
            input.idempotency.studentId,
            input.idempotency.key,
            input.idempotency.digest,
            input.conversationId,
            ordinal,
          ],
        );
      }

      await client.query("COMMIT");
      this.#notify(input.conversationId, written);
      return { event: written, replayed: false };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async #replayIfSeen(
    client: PoolClient,
    idempotency: { readonly key: string; readonly studentId: string; readonly digest: string },
  ): Promise<ConversationEvent | null> {
    const seen = await client.query<{ request_digest: string; event_id: string | null }>(
      "SELECT request_digest, event_id FROM idempotency_keys WHERE student_id = $1 AND key = $2",
      [idempotency.studentId, idempotency.key],
    );
    const row = seen.rows[0];
    if (row === undefined) return null;
    // The same key with a DIFFERENT body is a conflict, not a replay: silently
    // returning the first result would hide a client bug instead of naming it.
    if (row.request_digest !== idempotency.digest) throw new IdempotencyConflictError();
    if (row.event_id === null) return null;
    const found = await client.query(`${SELECT_EVENT} WHERE e.id = $1`, [row.event_id]);
    const event = found.rows[0] as Record<string, unknown> | undefined;
    return event === undefined ? null : rowToEvent(event);
  }

  async #insert(
    client: PoolClient,
    conversationId: string,
    ordinal: Ordinal,
    event: AppendableEvent,
  ): Promise<ConversationEvent> {
    let bodyId: string | null = null;
    if (event.kind === "message") {
      const body = await client.query<{ id: string }>(
        "INSERT INTO message_bodies (content) VALUES ($1) RETURNING id",
        [event.content],
      );
      bodyId = body.rows[0]!.id;
    }

    const written = await client.query(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, actor, body_id, request_id, handle,
          reason_code, channel, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ordinal, created_at, kind, actor, request_id, handle, reason_code,
                 channel, expires_at`,
      [
        conversationId,
        ordinal,
        event.kind,
        event.kind === "message" ? event.actor : null,
        bodyId,
        event.kind === "message" ? null : event.requestId,
        event.kind === "secret_received" ? event.handle : null,
        event.kind === "secret_rejected" ? event.reason : null,
        event.kind === "secret_requested" ? event.channel : null,
        event.kind === "secret_requested" ? event.expiresAt : null,
      ],
    );

    const row = written.rows[0] as Record<string, unknown>;
    return rowToEvent({
      ...row,
      content: event.kind === "message" ? event.content : null,
      redacted_at: null,
    });
  }

  /** Events after `afterOrdinal`, ascending. The transcript, and the backfill. */
  public async since(
    conversationId: string,
    afterOrdinal: Ordinal,
    limit = 500,
  ): Promise<readonly ConversationEvent[]> {
    const rows = await this.#pool.query(
      `${SELECT_EVENT}
        WHERE e.conversation_id = $1 AND e.ordinal > $2
        ORDER BY e.ordinal ASC
        LIMIT $3`,
      [conversationId, afterOrdinal, limit],
    );
    return rows.rows.map((row) => rowToEvent(row as Record<string, unknown>));
  }

  /**
   * The guard: the open secure step, if any.
   *
   * Reads the view from the migration, which excludes a rejection from the
   * settling kinds — a mistyped confirmation leaves the step open. The clock is
   * the CALLER's, because the view deliberately contains no `now()`.
   */
  public async openSecretRequest(
    conversationId: string,
    now: Date,
  ): Promise<{ requestId: string; expiresAt: string } | null> {
    const rows = await this.#pool.query<{ request_id: string; expires_at: Date }>(
      `SELECT request_id, expires_at FROM open_secret_requests
        WHERE conversation_id = $1 AND expires_at > $2
        ORDER BY ordinal DESC LIMIT 1`,
      [conversationId, now],
    );
    const row = rows.rows[0];
    return row === undefined
      ? null
      : { requestId: row.request_id, expiresAt: row.expires_at.toISOString() };
  }

  public subscribe(
    conversationId: string,
    listener: (event: ConversationEvent) => void,
  ): () => void {
    const set = this.#listeners.get(conversationId) ?? new Set();
    set.add(listener);
    this.#listeners.set(conversationId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.#listeners.delete(conversationId);
    };
  }

  #notify(conversationId: string, event: ConversationEvent): void {
    for (const listener of this.#listeners.get(conversationId) ?? []) listener(event);
  }

  /** For a caller that wants to distinguish a race from a real failure. */
  public static isOrdinalCollision(error: unknown): boolean {
    return (error as { code?: string }).code === UNIQUE_VIOLATION;
  }
}
