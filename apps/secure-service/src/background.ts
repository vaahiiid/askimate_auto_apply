/**
 * What the Secure Interaction Service does when nobody is calling it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0052. Before P14 nothing in this repository ran without a request. The
 * outbox was written to and never drained, so a student who typed a password
 * had the transition recorded here and never delivered to the conversation
 * log — and that log's own guard kept refusing their messages. The composer
 * stayed shut for ever. `lifecycle-outbox.ts` predicted exactly that failure
 * and the two-origin browser test passed only because the TEST called
 * `publish` itself.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why these two loops live HERE and not in the worker ───────────────────
 *
 * ADR-0052 §13.0, decided by Vahid. The Background Worker owns the
 * Conversation Plane; these two jobs are the Secure Plane's own. Both read and
 * write `secret_requests` and `lifecycle_outbox`, and ADR-0037's separation
 * says **no process holds both planes' credentials** — so a worker that drained
 * this outbox would be the single process whose compromise yields both
 * databases, which is the property the separation exists to provide.
 *
 * `publish`'s own comment already assumed this home: *"FOR UPDATE SKIP LOCKED
 * because there are several instances of this service and they all run this
 * loop."* The loop was designed to live here. It was simply never started.
 *
 * ── The rule this file must never break ───────────────────────────────────
 *
 * ADR-0052 §13.0, binding:
 *
 *   **The Secure Service may run only loops over its OWN tables that publish
 *   outward. It may never poll another plane's state, and it may never acquire
 *   a second plane's credentials.**
 *
 * Draining `lifecycle_outbox` and sweeping `secret_requests` are permitted:
 * both are this service's tables, and both only ever push a transition out
 * through the internal append. Reading `workflow_runs`, `cases`,
 * `interventions` or `conversation_events` is not — in any loop, for any
 * reason. A future job that needs another plane's state belongs in that
 * plane's process. `pnpm run boundaries` enforces this.
 */

import type { Pool } from "pg";

import type { LifecycleOutbox, DeliverTransition } from "./lifecycle-outbox.js";
import type { SecureRequestStore } from "./requests.js";

/**
 * How often the outbox is drained.
 *
 * ADR-0052 §13.1. The one interval a student can feel: an undelivered row is
 * holding their composer shut. One second matches `DEFAULT_POLL_MS` in the
 * conversation service's SSE route, which is this repository's existing answer
 * to "how often, for something a person is waiting on".
 */
export const DEFAULT_DRAIN_MS = 1_000;

/**
 * How often expired requests are swept.
 *
 * Nobody is waiting on the sweep. Read-time expiry (`expires_at > $now`, in
 * every lookup) already makes a lapsed request unusable the instant it lapses,
 * so this interval decides only how quickly the student is TOLD. Thirty
 * seconds against ADR-0034's five-minute TTL ceiling is well inside it.
 */
export const DEFAULT_SWEEP_MS = 30_000;

/** How many expired requests one sweep settles. Bounded, like every batch here. */
const SWEEP_LIMIT = 100;

/**
 * Settles every request whose time has run out, and says so.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0034 states, as an accepted consequence: *"the request moves to
 * `secret_expired`, the student is told in the conversation, and the model asks
 * again."* Nothing wrote `secret_expired`. `settle` has admitted that argument
 * since it was written and had never been called with it — an Accepted ADR
 * describing behaviour the system could not perform.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The settle and the enqueue share ONE transaction, for the reason every other
 * enqueue in this service does: a crash between them would lose the
 * publication while keeping the transition, and then the conversation log would
 * never learn of an expiry that had already happened here.
 *
 * ── This is a transition, never a security control ───────────────────────
 *
 * Read-time expiry is untouched and stays the control. If this sweep never
 * runs, nothing becomes usable that was not usable before — the request is
 * simply not yet ANNOUNCED as expired. Fail-closed by construction, and the
 * sweeper cannot become load-bearing for safety.
 *
 * Returns how many were settled, so an operator (and a test) can tell "nothing
 * was due" from "nothing got through".
 */
export async function sweepExpiredRequests(input: {
  readonly pool: Pool;
  readonly store: SecureRequestStore;
  readonly outbox: LifecycleOutbox;
  readonly now: Date;
  readonly limit?: number;
}): Promise<{ readonly expired: number }> {
  // ── Which rows, and why `secret_requested` alone ─────────────────────────
  //
  // A `secret_received` request has a value in the vault and a handle a fill
  // agent may be about to spend. Expiring it from here would race a live spend
  // and could settle a request that succeeded a millisecond later. The vault's
  // own TTL removes the value (ADR-0034) and the spend path settles the row to
  // `secret_consumed` when it wins; a request stranded in `secret_received`
  // is a different problem and not this sweep's.
  const due = await input.pool.query<{ request_id: string; conversation_id: string }>(
    `SELECT request_id, conversation_id
       FROM secret_requests
      WHERE lifecycle = 'secret_requested' AND expires_at <= $1
      ORDER BY expires_at
      LIMIT $2`,
    [input.now, input.limit ?? SWEEP_LIMIT],
  );

  let expired = 0;
  for (const row of due.rows) {
    // One transaction per request rather than one for the batch: a single
    // request that cannot be settled must not roll back the ninety-nine that
    // could, and each is independent of the others.
    const settled = await input.store.withTransaction(async (client) => {
      const moved = await input.store.settle(client, row.request_id, "secret_expired", input.now);
      // `settle` answers false when the row was settled by somebody else
      // between the SELECT and here — a concurrent sweep, or a spend that won
      // the race. Nothing is enqueued in that case, because the transition did
      // not happen HERE.
      //
      // Measured, and worth stating rather than implying: removing this line
      // changes NO observable behaviour, because `enqueue` is
      // `ON CONFLICT (request_id, kind) DO NOTHING` and the duplicate would be
      // discarded by the database anyway. It stays because it makes the COUNT
      // truthful — a sweep that lost the race must not report an expiry it did
      // not cause — and because relying on the constraint to absorb a write we
      // know is wrong is a worse habit than not making it.
      if (!moved) return false;
      await input.outbox.enqueue(client, {
        requestId: row.request_id,
        conversationId: row.conversation_id,
        transition: { kind: "secret_expired" },
        now: input.now,
      });
      return true;
    });
    if (settled) expired += 1;
  }
  return { expired };
}

/** A running background loop. Stopping it is idempotent. */
export interface SecureBackground {
  /** Stops every timer. Safe to call twice, and safe to call before any tick. */
  readonly stop: () => void;
  /**
   * One drain and one sweep, run to completion, ignoring the timers.
   *
   * For a test that wants determinism rather than a race with an interval, and
   * for a shutdown that wants to flush what is due before the process exits.
   */
  readonly runOnce: () => Promise<{
    readonly delivered: number;
    readonly failed: number;
    readonly expired: number;
  }>;
}

export interface SecureBackgroundOptions {
  readonly pool: Pool;
  readonly store: SecureRequestStore;
  readonly outbox: LifecycleOutbox;
  /** Delivers one transition to the Conversation Service. `internalAppend`. */
  readonly deliver: DeliverTransition;
  /**
   * The clock.
   *
   * Injected like every other clock in this repository. The outbox learned this
   * the hard way: its `next_attempt_at` once defaulted to the DATABASE's
   * `now()`, which disagreed with the injected one the moment a test used a
   * fixed time, and every row was queued in the database's present and asked
   * for in the caller's past — a publisher that silently delivered nothing.
   */
  readonly now: () => Date;
  readonly drainIntervalMs?: number;
  readonly sweepIntervalMs?: number;
  /**
   * Where a thrown error goes.
   *
   * A loop that throws must not take the process down, and it must not be
   * silent either. Deliberately a callback taking a WORD rather than an error:
   * this is the one service where an error's message might carry a fragment of
   * a request body, and `internalAppend` already refuses to read one for
   * exactly that reason.
   */
  readonly onFailure?: (job: "drain" | "sweep") => void;
}

/**
 * Starts the two loops.
 *
 * `setInterval` with an injected clock and an explicit stop, the same shape the
 * conversation service's SSE route already uses for its drain and heartbeat.
 * Not cron, not a scheduled task, not `LISTEN`/`NOTIFY` — ADR-0052 §2 has the
 * argument, and the short version is that a missed notification is invisible
 * whereas a poll that finds nothing is cheap.
 *
 * ── Why a tick cannot overlap itself ──────────────────────────────────────
 *
 * A drain that takes longer than its interval would otherwise start again
 * underneath itself. `FOR UPDATE SKIP LOCKED` means the second pass would take
 * different rows rather than the same ones, so it would be SAFE — but it would
 * also multiply connections without bound under exactly the condition (a slow
 * conversation service) where that is worst. So each loop holds a flag and
 * skips its tick while the previous one is still running.
 */
export function startSecureBackground(options: SecureBackgroundOptions): SecureBackground {
  const drainMs = options.drainIntervalMs ?? DEFAULT_DRAIN_MS;
  const sweepMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_MS;

  let draining = false;
  let sweeping = false;
  let stopped = false;

  const drainOnce = async (): Promise<{ delivered: number; failed: number }> => {
    const outcome = await options.outbox.publish(options.deliver, { now: options.now() });
    return { delivered: outcome.delivered, failed: outcome.failed };
  };

  const sweepOnce = async (): Promise<number> => {
    const outcome = await sweepExpiredRequests({
      pool: options.pool,
      store: options.store,
      outbox: options.outbox,
      now: options.now(),
    });
    return outcome.expired;
  };

  const drainTimer = setInterval(() => {
    if (draining || stopped) return;
    draining = true;
    void drainOnce()
      .catch(() => {
        options.onFailure?.("drain");
      })
      .finally(() => {
        draining = false;
      });
  }, drainMs);

  const sweepTimer = setInterval(() => {
    if (sweeping || stopped) return;
    sweeping = true;
    void sweepOnce()
      .catch(() => {
        options.onFailure?.("sweep");
      })
      .finally(() => {
        sweeping = false;
      });
  }, sweepMs);

  // Neither timer keeps the process alive on its own. A service whose only
  // remaining reason to run is a poll for work that is not there should exit
  // when its server closes, not hold the event loop open for ever.
  drainTimer.unref();
  sweepTimer.unref();

  return {
    stop: (): void => {
      stopped = true;
      clearInterval(drainTimer);
      clearInterval(sweepTimer);
    },
    runOnce: async (): Promise<{ delivered: number; failed: number; expired: number }> => {
      // Sweep FIRST, then drain: a sweep enqueues, and running them in this
      // order means one `runOnce` both settles an expiry and delivers it. The
      // other order would need two calls to do the same thing, which is a
      // surprise in a function whose whole purpose is determinism.
      const expired = await sweepOnce();
      const { delivered, failed } = await drainOnce();
      return { delivered, failed, expired };
    },
  };
}
