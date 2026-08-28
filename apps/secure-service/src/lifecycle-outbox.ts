/**
 * How a lifecycle transition reaches the conversation log.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"The browser must remain a UX observer and accelerator,
 * not the authority for secure lifecycle transitions… A failed lifecycle push
 * must fail closed: the Conversation Service must not release the composer
 * merely because the browser believes the secure step settled."*
 *
 *   Secure Interaction Service → authenticated internal append
 *     → Conversation Service → durable event log → SSE → browser
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The transactional outbox, and why ─────────────────────────────────────
 *
 * The planes have separate databases (ADR-0037), so the lifecycle row here and
 * the event there cannot commit together. `enqueue` therefore takes the CLIENT
 * of an open transaction rather than a pool: the transition and the intent to
 * publish it are written in the same transaction, so there is no instant at
 * which one exists without the other. If this process dies immediately after
 * committing, the row is still there and `publish` will find it.
 *
 * ── Where the failure lands ───────────────────────────────────────────────
 *
 * An undelivered row means the conversation log has not heard that the step
 * settled, so `openSecretRequest` there still reports it OPEN and the guard
 * refuses messages. The failure mode is a composer that stays blocked — never
 * one that opens early. That is fail-closed by the direction of the error
 * rather than by a rule someone has to remember.
 *
 * ── Two independent idempotency layers ────────────────────────────────────
 *
 *   1. `one_row_per_transition UNIQUE (request_id, kind)` here — a retry that
 *      re-enqueued cannot create a second row.
 *   2. The conversation service's internal route is idempotent on
 *      (conversation, request, kind) — a delivery that succeeded but whose
 *      response was lost cannot append twice when it is retried.
 *
 * Both, because a duplicate enqueue and a duplicate delivery have different
 * causes and either alone leaves the other unprotected.
 */

import type { Pool, PoolClient } from "pg";

import type { RejectionReason } from "@askimate/aas-contracts";

/** A transition, with exactly the fields its kind admits. */
export type LifecycleTransition =
  | {
      readonly kind: "secret_requested";
      readonly channel: "secure_control";
      readonly expiresAt: Date;
    }
  | { readonly kind: "secret_received"; readonly handle: string }
  | { readonly kind: "secret_consumed" | "secret_expired" | "secret_cancelled" }
  | { readonly kind: "secret_rejected"; readonly reason: RejectionReason };

export interface OutboxRow {
  readonly id: string;
  readonly requestId: string;
  readonly conversationId: string;
  readonly transition: LifecycleTransition;
  readonly attempts: number;
}

/** What one delivery attempt concluded. */
export type DeliveryOutcome =
  | { readonly delivered: true }
  /** Try again later — the other side was unreachable, or answered 5xx. */
  | { readonly delivered: false; readonly retry: true; readonly code: RetryableCode }
  /**
   * Never going to work. Recorded, and left undelivered ON PURPOSE: giving up
   * must not look like success, because "delivered" is what tells the guard the
   * step is settled.
   */
  | { readonly delivered: false; readonly retry: false; readonly code: PermanentCode };

export type RetryableCode = "unreachable" | "server_error";
export type PermanentCode = "refused" | "unknown_conversation" | "malformed";

/** Delivers one transition. The HTTP client is injected so a test can fail it. */
export type DeliverTransition = (row: OutboxRow) => Promise<DeliveryOutcome>;

/**
 * Backoff, in seconds, by attempt number.
 *
 * Capped and bounded rather than unbounded exponential: a transition that has
 * failed twelve times is not going to succeed on the thirteenth because it
 * waited an hour, and the composer it is holding shut belongs to a student who
 * is waiting. A fixed ceiling keeps the retry visible in the operational
 * signal instead of disappearing into a long sleep.
 */
export function backoffSeconds(attempts: number): number {
  return Math.min(2 ** Math.min(attempts, 6), 60);
}

export class LifecycleOutbox {
  readonly #pool: Pool;

  public constructor(pool: Pool) {
    this.#pool = pool;
  }

  /**
   * Records the intent to publish, INSIDE the caller's transaction.
   *
   * Takes a `PoolClient`, not a pool, and that is the whole point: a caller
   * that could pass a pool could enqueue outside the transaction that changed
   * the lifecycle, and then a crash between the two would lose the publication
   * while keeping the transition.
   *
   * `ON CONFLICT DO NOTHING` because the UNIQUE constraint is a guarantee, not
   * an error condition: enqueueing a transition that is already queued is a
   * retry, and a retry should be a no-op rather than a crash.
   */
  public async enqueue(
    client: PoolClient,
    input: {
      readonly requestId: string;
      readonly conversationId: string;
      readonly transition: LifecycleTransition;
      /**
       * When this becomes due — the caller's clock, not the database's.
       *
       * The column has a `DEFAULT now()`, and relying on it was wrong for the
       * reason this repository bans ambient clock reads everywhere else: it is
       * a SECOND clock, and it disagreed with the injected one the moment a
       * test used a fixed time. Every row was queued in the database's present
       * and asked for in the caller's past, so nothing was ever due — a
       * publisher that silently delivered nothing, which is the shape of an
       * outage rather than a bug anyone would notice quickly.
       *
       * The default stays as a floor for a caller that has no clock. This
       * parameter is how the service and its tests use one clock.
       */
      readonly now: Date;
    },
  ): Promise<void> {
    const t = input.transition;
    await client.query(
      `INSERT INTO lifecycle_outbox
         (request_id, conversation_id, kind, channel, expires_at, handle, reason,
          next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (request_id, kind) DO NOTHING`,
      [
        input.requestId,
        input.conversationId,
        t.kind,
        t.kind === "secret_requested" ? t.channel : null,
        t.kind === "secret_requested" ? t.expiresAt : null,
        t.kind === "secret_received" ? t.handle : null,
        t.kind === "secret_rejected" ? t.reason : null,
        input.now,
      ],
    );
  }

  /**
   * Delivers everything due, once.
   *
   * `FOR UPDATE SKIP LOCKED` because there are several instances of this
   * service and they all run this loop. Without it two instances would claim
   * the same row and deliver it twice; with it, the second instance simply
   * takes the next row. The conversation service's idempotency would have
   * caught the duplicate anyway — this stops it being generated.
   *
   * Returns how many rows were delivered, so an operator (and a test) can tell
   * "nothing was due" from "nothing got through".
   */
  public async publish(
    deliver: DeliverTransition,
    options: { readonly now: Date; readonly limit?: number },
  ): Promise<{ readonly delivered: number; readonly failed: number }> {
    const client = await this.#pool.connect();
    let delivered = 0;
    let failed = 0;
    try {
      await client.query("BEGIN");
      const due = await client.query<RawRow>(
        `SELECT id, request_id, conversation_id, kind, channel, expires_at, handle,
                reason, attempts
           FROM lifecycle_outbox
          WHERE delivered_at IS NULL AND next_attempt_at <= $1
          ORDER BY id
          LIMIT $2
            FOR UPDATE SKIP LOCKED`,
        [options.now, options.limit ?? 50],
      );

      for (const raw of due.rows) {
        const row = toRow(raw);
        const outcome = await deliver(row);
        if (outcome.delivered) {
          await client.query(
            `UPDATE lifecycle_outbox
                SET delivered_at = $2, attempts = attempts + 1, last_error = NULL
              WHERE id = $1`,
            [row.id, options.now],
          );
          delivered += 1;
          continue;
        }
        failed += 1;
        // A permanent failure is parked far in the future rather than deleted
        // or marked delivered. Deleting would erase the evidence that a
        // transition never reached the log; marking it delivered would tell
        // every later reader that it did.
        const wait = outcome.retry ? backoffSeconds(row.attempts + 1) : 86_400;
        await client.query(
          `UPDATE lifecycle_outbox
              SET attempts = attempts + 1,
                  next_attempt_at = $2::timestamptz + make_interval(secs => $3),
                  last_error = $4
            WHERE id = $1`,
          [row.id, options.now, wait, outcome.code],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return { delivered, failed };
  }

  /** Undelivered rows, for an operator and for the tests. */
  public async pending(): Promise<readonly OutboxRow[]> {
    const rows = await this.#pool.query<RawRow>(
      `SELECT id, request_id, conversation_id, kind, channel, expires_at, handle,
              reason, attempts
         FROM lifecycle_outbox WHERE delivered_at IS NULL ORDER BY id`,
    );
    return rows.rows.map(toRow);
  }

  public async isDelivered(requestId: string, kind: string): Promise<boolean> {
    const found = await this.#pool.query(
      "SELECT 1 FROM lifecycle_outbox WHERE request_id = $1 AND kind = $2 AND delivered_at IS NOT NULL",
      [requestId, kind],
    );
    return found.rowCount === 1;
  }
}

interface RawRow {
  id: string;
  request_id: string;
  conversation_id: string;
  kind: string;
  channel: string | null;
  expires_at: Date | null;
  handle: string | null;
  reason: string | null;
  attempts: number;
}

function toRow(raw: RawRow): OutboxRow {
  return {
    id: String(raw.id),
    requestId: raw.request_id,
    conversationId: raw.conversation_id,
    attempts: Number(raw.attempts),
    transition: toTransition(raw),
  };
}

function toTransition(raw: RawRow): LifecycleTransition {
  switch (raw.kind) {
    case "secret_requested":
      return {
        kind: "secret_requested",
        channel: "secure_control",
        // Non-null by `only_a_request_has_an_expiry`. The fallback is not a
        // default anyone should hit; it exists because the column is nullable
        // for the other kinds and the type system cannot see the CHECK.
        expiresAt: raw.expires_at ?? new Date(0),
      };
    case "secret_received":
      return { kind: "secret_received", handle: raw.handle ?? "" };
    case "secret_rejected":
      return { kind: "secret_rejected", reason: raw.reason as RejectionReason };
    case "secret_consumed":
    case "secret_expired":
    case "secret_cancelled":
      return { kind: raw.kind };
    default:
      // Enumerated above; the CHECK constraint admits nothing else. Throwing
      // rather than defaulting to a settlement: inventing a kind here would put
      // a transition in the conversation log that never happened.
      throw new Error(`unknown lifecycle kind in outbox row ${raw.id}`);
  }
}
