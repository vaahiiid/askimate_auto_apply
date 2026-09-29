/**
 * The reader's loop: claim, read, report; patient when there is nothing.
 *
 * The runner's supervisor (`apps/browser-runner/src/supervisor.ts`) without
 * the browser: a turn that throws is reported as `reader_fault` rather than
 * left unreported, `stop` waits for the turn in flight, and the timer never
 * holds the process open on its own.
 */

import type { ClaimedReading, ReadingReport } from "@askimate/aas-contracts";

import type { ReadingIntake } from "./intake.js";

export const DEFAULT_IDLE_MS = 5_000;
export const DEFAULT_BUSY_MS = 250;

export type ReadingPerformer = (claim: ClaimedReading) => Promise<ReadingReport>;

export type TurnResult =
  | { readonly kind: "idle" }
  | { readonly kind: "read"; readonly documentId: string; readonly report: ReadingReport }
  /** The reading was done but the plane would not accept the report: the lease lapsed. */
  | { readonly kind: "report_refused"; readonly documentId: string };

export async function runOneTurn(intake: ReadingIntake, perform: ReadingPerformer): Promise<TurnResult> {
  const claim = await intake.claim();
  if (claim === null) return { kind: "idle" };
  let report: ReadingReport;
  try {
    report = await perform(claim);
  } catch {
    // Nothing is known about what the reader managed before it threw, and
    // nothing of the throw is repeated: an error from a document library
    // can carry the document's own text.
    report = { leaseId: claim.leaseId, outcome: "failed", failure: "reader_fault" };
  }
  const accepted = await intake.report(claim.documentId, report);
  return accepted ? { kind: "read", documentId: claim.documentId, report } : { kind: "report_refused", documentId: claim.documentId };
}

export interface ReaderSupervisorOptions {
  readonly intake: ReadingIntake;
  readonly perform: ReadingPerformer;
  readonly idleIntervalMs?: number;
  readonly busyIntervalMs?: number;
  /** Where a turn's outcome goes. The result, never an error object. */
  readonly onTurn?: (result: TurnResult) => void;
  /**
   * Keep the process alive between turns. Off by default so a test that
   * starts a supervisor and forgets it cannot hold vitest open; ON in the
   * process, because this loop is the only thing the reader runs — found
   * the first time it ran as one (P248, row 103): it logged its opening
   * line, took one turn, and exited, its timers unreferenced and nothing
   * else — no pool, no browser, no listener — holding the event loop.
   */
  readonly holdProcess?: boolean;
}

export interface RunningReaderSupervisor {
  /** Stops the loop, waiting for a turn already in flight. */
  readonly stop: () => Promise<void>;
  /** One turn, run to completion, ignoring the timer. For tests. */
  readonly runOnce: () => Promise<TurnResult>;
}

export function startReaderSupervisor(options: ReaderSupervisorOptions): RunningReaderSupervisor {
  const idleMs = options.idleIntervalMs ?? DEFAULT_IDLE_MS;
  const busyMs = options.busyIntervalMs ?? DEFAULT_BUSY_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
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
          scheduleNext(result.kind === "read" ? busyMs : idleMs);
        })
        .catch(() => {
          scheduleNext(idleMs);
        });
    }, after);
    if (options.holdProcess !== true) timer.unref();
  };
  scheduleNext(0);

  return {
    stop: async (): Promise<void> => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (inFlight !== null) await inFlight.catch(() => undefined);
    },
    runOnce: takeATurn,
  };
}
