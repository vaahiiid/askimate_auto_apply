/**
 * The Automation Runner's supervisor — the loop `runOneTurn` never had.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `runOneTurn` has been complete since P5 and nothing has ever looped it. It
 * was the last of the six pieces of machinery ADR-0052 listed as having no
 * production caller, and the only one that phase deliberately left alone:
 *
 *   ADR-0052 §12 — *"No runner supervisor. `runOneTurn` still has no loop. The
 *   Automation Runner is its own deployable in its own plane with no database;
 *   giving THIS worker the job of looping it would put conversation-plane
 *   credentials in the process that drives a browser, which is the exact
 *   widening ADR-0042 exists to prevent."*
 *
 * So the loop lives here, in the runner, and this file needs no new
 * architectural decision: ADR-0052 §12 settles where it goes and ADR-0045
 * settles how it works — *"the runner PULLS leased work; nothing calls into
 * it"*, with the cost already accepted: *"Latency is a poll interval rather
 * than a push."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this file has no opinions ─────────────────────────────────────────
 *
 * It is a scheduler around a function that already exists, and that is the
 * whole of it. Every rule about what may be worked on lives on the other side
 * of the intake:
 *
 *   - a CANCELLED or winding-down case is never offered (ADR-0053);
 *   - an `uncertain` or `escalated` run is never offered (ADR-0048);
 *   - a run already leased to another runner is never offered (ADR-0045);
 *   - an action that may already have happened stops the run rather than being
 *     retried (ADR-0008, `assessIntent` has no "retry it" branch).
 *
 * **This loop inherits every one of those by construction, because it performs
 * only what it is handed.** That is a stronger guarantee than re-checking them
 * here would be: a second opinion about what may be worked on is exactly the
 * second source of truth ADR-0041 exists to prevent, and it could disagree.
 *
 * ── What it must not become ───────────────────────────────────────────────
 *
 * Not a queue, not a scheduler with its own view of what is outstanding, and
 * not a holder of state that survives the process. The runner has no database
 * (ADR-0037) and this adds none. Kill it at any moment and the work returns to
 * the pool on its own when the lease lapses — which is the property `runOneTurn`
 * was written around and this file must not weaken.
 */

import { runOneTurn } from "./work-intake.js";
import type { TurnResult, WorkIntake, WorkPerformer } from "./work-intake.js";

/**
 * How long to wait after a turn that found nothing.
 *
 * Five seconds, matching the Background Worker's `advance` interval, and for
 * the same reason: the case a person can feel is one where they have just
 * acted, and their own request already advances their run synchronously
 * (ADR-0052 §8). This interval is what an ABSENT student's work waits.
 */
export const DEFAULT_IDLE_MS = 5_000;

/**
 * How long to wait after a turn that did something.
 *
 * Short, because work arrives in runs rather than singly: a multi-page
 * application hands out one page per claim, so a successful turn is strong
 * evidence the next one is already waiting. Not zero — a tight loop against an
 * empty pool is a busy-wait, and this bounds it either way.
 */
export const DEFAULT_BUSY_MS = 250;

export interface RunnerSupervisorOptions {
  readonly intake: WorkIntake;
  readonly perform: WorkPerformer;
  readonly idleIntervalMs?: number;
  readonly busyIntervalMs?: number;
  /**
   * Where a turn's outcome goes.
   *
   * Takes the RESULT rather than an error, because `runOneTurn` never throws —
   * a performer that throws is already converted into an `uncertain` report
   * with `runner_fault`, since a thrown error means this process does not know
   * what the browser managed to do before it stopped.
   *
   * Nothing here reads an error object. A thrown error from a browser session
   * can carry a page's text, a URL with a token in it, or a whole request body,
   * and this is the process driving the portal.
   */
  readonly onTurn?: (result: TurnResult) => void;
}

export interface RunningSupervisor {
  /**
   * Stops the loop, waiting for a turn already in flight.
   *
   * ── Why this AWAITS, when the worker's `stop` does not ─────────────────
   *
   * The Background Worker's jobs are database queries; abandoning one costs a
   * repeat. A runner's turn is a real browser typing into a real university
   * portal, and abandoning one mid-action is the exact situation
   * `workflow_action_intents` exists to detect and `assessIntent` refuses to
   * retry — it would leave a run stopped, an intervention raised and a person
   * having to go and look.
   *
   * So an orderly shutdown lets the turn finish and report. A DISORDERLY one
   * (the process is killed) is still safe, because that is the case the lease
   * and the intent ledger were built for — but it costs a person's attention,
   * and a rolling deploy should not.
   */
  readonly stop: () => Promise<void>;
  /** One turn, run to completion, ignoring the timer. For tests. */
  readonly runOnce: () => Promise<TurnResult>;
}

/**
 * Starts the loop.
 *
 * ── Serial, and why ───────────────────────────────────────────────────────
 *
 * One turn at a time. `runOneTurn` already claims ONE unit deliberately —
 * *"a runner that claimed a batch would hold leases on work it had not started,
 * and every one of those runs would be stranded for the lease duration if this
 * process died"* — and running turns concurrently would reintroduce that from
 * the other end: several browsers, several leases, one process to lose.
 *
 * It also means one runner makes one request at a time to one institution's
 * portal, which is the polite and the safe reading. Nothing in the accepted
 * decisions asks for throughput, and concurrency is a knob that can be added
 * when something actually needs it — with a decision, because "how many
 * browsers may drive one university's portal at once" is not an engineering
 * detail.
 *
 * ── Why a self-scheduling timeout, not setInterval ────────────────────────
 *
 * The interval depends on the outcome: come back promptly after work, wait
 * after idle. A fixed `setInterval` cannot express that, and would also let a
 * slow turn queue its successor behind it — which for a browser session is how
 * one stuck portal becomes several.
 */
export function startRunnerSupervisor(options: RunnerSupervisorOptions): RunningSupervisor {
  const idleMs = options.idleIntervalMs ?? DEFAULT_IDLE_MS;
  const busyMs = options.busyIntervalMs ?? DEFAULT_BUSY_MS;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The turn currently in flight, so `stop` can wait for it. */
  let inFlight: Promise<TurnResult> | null = null;

  const takeATurn = async (): Promise<TurnResult> => {
    const turn = runOneTurn(options.intake, options.perform);
    inFlight = turn;
    try {
      const result = await turn;
      options.onTurn?.(result);
      return result;
    } finally {
      inFlight = null;
    }
  };

  const scheduleNext = (after: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void takeATurn()
        .then((result) => {
          // Prompt after work, patient after nothing. `report_refused` is
          // treated as idle rather than as work: the lease was taken over while
          // this runner held it, so the pool has moved on and hurrying back
          // would just race the runner that now owns it.
          scheduleNext(result.kind === "worked" ? busyMs : idleMs);
        })
        .catch(() => {
          // `runOneTurn` does not throw, so reaching here means the intake
          // itself did something unexpected. The loop must not die of it —
          // a runner that stopped polling because of one bad response is a
          // runner that never comes back, and nothing would notice.
          scheduleNext(idleMs);
        });
    }, after);
    // The loop alone must not hold the process open. A runner whose only
    // remaining reason to run is a poll for work that is not there should exit
    // when told to, not linger on a timer.
    timer.unref();
  };

  scheduleNext(0);

  return {
    stop: async (): Promise<void> => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      // Await, never abandon. See `RunningSupervisor.stop`.
      if (inFlight !== null) await inFlight.catch(() => undefined);
    },
    runOnce: takeATurn,
  };
}
