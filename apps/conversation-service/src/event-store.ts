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

import { createHash } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { ConversationEvent, Ordinal, RejectionReason } from "@askimate/aas-contracts";
import { PROPOSAL_EVENT_KINDS, TARGET_EVENT_KINDS, SECURE_EVENT_KINDS } from "@askimate/aas-contracts";

import { ulid } from "./ulid.js";

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
      readonly reason: RejectionReason }
  // ── The interview's proposal exchange (ADR-0051) ──────────────────────
  //
  // Appended by the SERVICE, never by a client: no route parses one, and
  // `parseSecureAppend` has no branch for it. What a student sends is a
  // message, or a decision on the decision route — both of which the service
  // turns into these.
  | { readonly kind: "value_proposed"; readonly fieldKey: string;
      readonly proposal: unknown; readonly playbackHash: string }
  | { readonly kind: "value_confirmed"; readonly fieldKey: string;
      readonly playbackHash: string }
  // ── The target exchange (ADR-0058) ────────────────────────────────────
  //
  // Appended by the SERVICE, never by a client, for the same reason the
  // proposal exchange is: `parseSecureAppend` has no branch for either, and
  // what a student sends is a message or a request on a decision route.
  //
  // An offer carries the target it resolved; a request names only the offer.
  // `only_an_offer_carries_a_target` enforces that in the schema.
  | { readonly kind: "target_offered"; readonly offerHash: string;
      readonly targetBlueprintId: string; readonly targetContentHash: string }
  | { readonly kind: "target_requested"; readonly offerHash: string }
  | { readonly kind: "value_rejected"; readonly fieldKey: string };

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

/** True for a secure request's lifecycle events. Explicit, never a complement. */
function isSecureEvent(
  event: AppendableEvent,
): event is Extract<AppendableEvent, { kind: (typeof SECURE_EVENT_KINDS)[number] }> {
  return (SECURE_EVENT_KINDS as readonly string[]).includes(event.kind);
}

/** True for the interview's proposal exchange (ADR-0051). */
function isProposalEvent(
  event: AppendableEvent,
): event is Extract<AppendableEvent, { kind: (typeof PROPOSAL_EVENT_KINDS)[number] }> {
  return (PROPOSAL_EVENT_KINDS as readonly string[]).includes(event.kind);
}

/** True for the target exchange (ADR-0058). */
function isTargetEvent(
  event: AppendableEvent,
): event is Extract<AppendableEvent, { kind: (typeof TARGET_EVENT_KINDS)[number] }> {
  return (TARGET_EVENT_KINDS as readonly string[]).includes(event.kind);
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

    // ── The interview's proposal exchange (ADR-0051) ────────────────────
    case "value_proposed":
      return {
        kind,
        ordinal,
        createdAt,
        fieldKey: row["field_key"] as string,
        proposal: row["proposal"],
        playbackHash: row["playback_hash"] as string,
      };
    case "target_offered":
      return {
        kind,
        ordinal,
        createdAt,
        offerHash: row["offer_hash"] as string,
        targetBlueprintId: row["target_blueprint_id"] as string,
        targetContentHash: row["target_content_hash"] as string,
      };
    case "target_requested":
      return { kind, ordinal, createdAt, offerHash: row["offer_hash"] as string };
    case "value_confirmed":
      return {
        kind,
        ordinal,
        createdAt,
        fieldKey: row["field_key"] as string,
        playbackHash: row["playback_hash"] as string,
      };
    case "value_rejected":
      return { kind, ordinal, createdAt, fieldKey: row["field_key"] as string };
  }
}

const SELECT_EVENT = `
  SELECT e.ordinal, e.created_at, e.kind, e.actor, e.request_id, e.handle,
         e.reason_code, e.channel, e.expires_at, e.field_key, e.proposal,
         e.playback_hash, e.offer_hash, e.target_blueprint_id,
         e.target_content_hash, b.content, b.redacted_at
    FROM conversation_events e
    LEFT JOIN message_bodies b ON b.id = e.body_id
`;

/** One conversation, in the shape `conversation.v1.yaml` publishes. */
export interface ConversationRecord {
  readonly id: string;
  readonly title: string | null;
  readonly createdAt: Date;
  readonly lastOrdinal: number;
  /**
   * The paging key: `created_at` at the database's own precision.
   *
   * Not published — `renderConversation` does not emit it — because it exists
   * to build an opaque cursor and a client has no use for it.
   */
  readonly cursorAt: string;
}

interface ConversationRow {
  readonly id: string;
  readonly title: string | null;
  readonly last_ordinal: number;
  readonly created_at: Date;
  /**
   * `created_at` at FULL precision, as text from PostgreSQL.
   *
   * ── Why the JS Date is not good enough to page on ────────────────────
   *
   * `timestamptz` keeps microseconds; a JavaScript `Date` keeps milliseconds,
   * and `toISOString()` prints milliseconds. So a cursor built from the Date
   * names an instant slightly EARLIER than the row it came from — and every
   * row created in the remainder of that millisecond sorts after the cursor
   * and is skipped on the next page.
   *
   * That is not hypothetical: five conversations opened in a loop hit it, and
   * the paging test lost one. The cursor is therefore built from this column,
   * which is the database's own value at its own precision.
   */
  readonly cursor_at: string;
}

function toConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    // `bigint`-free: the column is `integer`, so pg hands back a number.
    lastOrdinal: Number(row.last_ordinal),
    cursorAt: row.cursor_at,
  };
}

/** The projection every conversation read shares, cursor column included. */
const CONVERSATION_COLUMNS = `id, title, last_ordinal, created_at,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at`;

/**
 * A page cursor: the `(created_at, id)` of the last row the client saw.
 *
 * OPAQUE to the client — base64url over a string it has no reason to read —
 * because a cursor a client can construct is a cursor a client can use to walk
 * somebody else's rows. It is still scoped by `student_id` in the query, so
 * forging one changes where this student's page starts and nothing more; the
 * opacity is what stops anybody trying.
 */
function encodeCursor(row: ConversationRecord): string {
  return Buffer.from(`${row.cursorAt} ${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): { readonly createdAt: string; readonly id: string } | null {
  if (cursor === undefined || cursor.length === 0) return null;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const gap = decoded.indexOf(" ");
  if (gap <= 0) return null;
  const createdAt = decoded.slice(0, gap);
  const id = decoded.slice(gap + 1);
  // A cursor that does not parse is treated as no cursor rather than as an
  // error: the worst it can do is start the page at the beginning, and a 400
  // here would break a client that had merely kept a cursor too long.
  if (Number.isNaN(Date.parse(createdAt)) || id.length === 0) return null;
  return { createdAt, id };
}

export { encodeCursor };

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
          reason_code, channel, expires_at, field_key, proposal, playback_hash,
          offer_hash, target_blueprint_id, target_content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13,
               $14, $15, $16)
       RETURNING ordinal, created_at, kind, actor, request_id, handle, reason_code,
                 channel, expires_at, field_key, proposal, playback_hash,
                 offer_hash, target_blueprint_id, target_content_hash`,
      [
        conversationId,
        ordinal,
        event.kind,
        event.kind === "message" ? event.actor : null,
        bodyId,
        // A secure event names its request; a message and a proposal never do.
        // The CHECK in migration 0008 enforces the same partition, so a caller
        // that got this wrong is refused by the database rather than trusted.
        isSecureEvent(event) ? event.requestId : null,
        event.kind === "secret_received" ? event.handle : null,
        event.kind === "secret_rejected" ? event.reason : null,
        event.kind === "secret_requested" ? event.channel : null,
        event.kind === "secret_requested" ? event.expiresAt : null,
        isProposalEvent(event) ? event.fieldKey : null,
        event.kind === "value_proposed" ? JSON.stringify(event.proposal) : null,
        event.kind === "value_proposed" || event.kind === "value_confirmed"
          ? event.playbackHash
          : null,
        // The target exchange (ADR-0058). Both halves name the offer;
        // `a_target_exchange_names_an_offer` enforces that in the schema.
        isTargetEvent(event) ? event.offerHash : null,
        // Only the OFFER carries the target, per `only_an_offer_carries_a_target`.
        event.kind === "target_offered" ? event.targetBlueprintId : null,
        event.kind === "target_offered" ? event.targetContentHash : null,
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
   * Opens a conversation for one student. ADR-0060.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * The first step of the journey, and until now there was no code that took
   * it: every conversation in this repository was an `INSERT` in a test. The
   * id is generated here rather than accepted from the client, because a
   * client that chose ids could name someone else's conversation into
   * existence and then be its owner.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * `key` makes a retry after a timeout return the SAME conversation instead
   * of leaving an empty second one behind. There is no request body, so there
   * is nothing a reused key could disagree with — a key here is a replay
   * guard and cannot be a conflict.
   */
  public async createConversation(input: {
    readonly studentId: string;
    readonly key?: string;
    readonly now: Date;
  }): Promise<{ readonly conversation: ConversationRecord; readonly created: boolean }> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      if (input.key !== undefined) {
        // Locked, not merely read: two tabs retrying the same key at once must
        // resolve to one conversation, and the winner is decided by the row
        // rather than by whichever query returned first.
        const held = await client.query<{ conversation_id: string | null }>(
          `SELECT conversation_id FROM idempotency_keys
            WHERE student_id = $1 AND key = $2 FOR UPDATE`,
          [input.studentId, input.key],
        );
        const existing = held.rows[0]?.conversation_id ?? null;
        if (existing !== null) {
          const found = await this.#readConversation(client, existing, input.studentId);
          await client.query("COMMIT");
          /* c8 ignore next -- the FK makes a dangling key impossible */
          if (found === null) throw new Error("an idempotency key named a conversation that is gone");
          return { conversation: found, created: false };
        }
      }

      // Retried on a primary-key collision rather than assumed unique. Two ids
      // generated in the same millisecond differ in 80 random bits, so this
      // loop is not expected to run twice — but "not expected" is not the same
      // as "cannot", and the alternative is a 500 a student sees.
      let id = "";
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const candidate = ulid(input.now);
        const inserted = await client.query(
          `INSERT INTO conversations (id, student_id, created_at, updated_at)
           VALUES ($1, $2, $3, $3) ON CONFLICT (id) DO NOTHING`,
          [candidate, input.studentId, input.now],
        );
        if (inserted.rowCount === 1) {
          id = candidate;
          break;
        }
      }
      if (id === "") throw new Error("could not allocate a conversation id");

      if (input.key !== undefined) {
        await client.query(
          `INSERT INTO idempotency_keys (student_id, key, request_digest, conversation_id, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [input.studentId, input.key, createHash("sha256").update("").digest("hex"), id, input.now],
        );
      }
      const created = await this.#readConversation(client, id, input.studentId);
      await client.query("COMMIT");
      /* c8 ignore next -- just inserted in this transaction */
      if (created === null) throw new Error("the conversation just created could not be read");
      return { conversation: created, created: true };
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** One conversation, or `null` when it is not this student's. */
  public async findConversation(
    conversationId: string,
    studentId: string,
  ): Promise<ConversationRecord | null> {
    return this.#readConversation(this.#pool, conversationId, studentId);
  }

  /**
   * This student's conversations, newest first.
   *
   * Ordered and paged on `(created_at, id)` rather than on `created_at` alone:
   * two conversations opened in the same millisecond would otherwise be able
   * to swap places between pages, and a cursor that can skip a row is a
   * listing that silently loses one. The composite is total because `id` is
   * the primary key.
   *
   * `conversations_by_student (student_id, created_at DESC)` has existed since
   * migration 0001 for exactly this query, and nothing had ever run it.
   */
  public async listConversations(input: {
    readonly studentId: string;
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<{ readonly conversations: readonly ConversationRecord[]; readonly hasMore: boolean }> {
    const after = decodeCursor(input.cursor);
    const rows = await this.#pool.query<ConversationRow>(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations
        WHERE student_id = $1
          AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::text))
        ORDER BY created_at DESC, id DESC
        LIMIT $4`,
      [input.studentId, after?.createdAt ?? null, after?.id ?? null, input.limit + 1],
    );
    const page = rows.rows.slice(0, input.limit).map(toConversation);
    return { conversations: page, hasMore: rows.rows.length > input.limit };
  }

  async #readConversation(
    client: Pool | PoolClient,
    conversationId: string,
    studentId: string,
  ): Promise<ConversationRecord | null> {
    const rows = await client.query<ConversationRow>(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations
        WHERE id = $1 AND student_id = $2`,
      [conversationId, studentId],
    );
    const row = rows.rows[0];
    return row === undefined ? null : toConversation(row);
  }

  /**
   * The target exchange of one conversation: what was offered, and what was
   * asked for.
   *
   * ══════════════════════════════════════════════════════════════════════
   * Gate 2's first condition (ADR-0058). Reads the VIEW from migration 0012
   * rather than filtering the log in the caller, for the reason
   * `openSecretRequest` reads a view: which rows count is a rule about the
   * log, and a rule written in a handler is a rule the next handler gets
   * subtly wrong.
   *
   * Scoped to one conversation by the query itself, so an offer made
   * elsewhere cannot appear here however the caller asks.
   * ══════════════════════════════════════════════════════════════════════
   */
  public async targetExchange(
    conversationId: string,
  ): Promise<readonly { readonly kind: "target_offered" | "target_requested"; readonly offerHash: string }[]> {
    const rows = await this.#pool.query<{ kind: string; offer_hash: string }>(
      `SELECT kind, offer_hash FROM conversation_target_exchange
        WHERE conversation_id = $1
        ORDER BY ordinal ASC`,
      [conversationId],
    );
    return rows.rows.map((row) => ({
      kind: row.kind as "target_offered" | "target_requested",
      offerHash: row.offer_hash,
    }));
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
