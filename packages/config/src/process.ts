/**
 * Starting and stopping, for a process that has to be operated.
 *
 * The five deployables differ in almost everything — one listens on nothing,
 * one holds no database, one drives a browser — but they share three needs, and
 * getting any of them subtly wrong in one app and right in the others is how a
 * deployment becomes folklore.
 *
 *   1. A startup failure must say what is wrong and exit non-zero.
 *   2. `SIGTERM` must stop the process cleanly, ONCE, and not hang forever.
 *   3. Nothing may print a configured value.
 */

import { ConfigError } from "./read.js";

/** Where a process writes its operational lines. Injected, so a test can read them. */
export type Log = (line: string) => void;

/**
 * Reports a startup failure and stops.
 *
 * ── Why this formats `ConfigError` specially ──────────────────────────────
 *
 * Because it is the one an operator will actually meet, and its message is the
 * whole list of what is wrong. Anything else prints its message and NOT its
 * stack: a stack from a database driver can carry the connection string, and
 * this is the path taken when a connection string is wrong.
 */
export function reportStartupFailure(error: unknown, log: Log): void {
  if (error instanceof ConfigError) {
    log(error.message);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  log(`REFUSING TO START: ${message}`);
}

export interface ShutdownOptions {
  readonly log: Log;
  /** Everything this process must close, in the order it must close it. */
  readonly close: () => Promise<void>;
  /**
   * How long a clean shutdown may take before the process stops waiting.
   *
   * A deploy that hangs on one stuck connection is worse than one that ends it:
   * an orchestrator will `SIGKILL` eventually anyway, and the difference is
   * whether the log says why. The runner sets this generously, because its
   * `stop` deliberately waits for a browser mid-action (P16).
   */
  readonly graceMs?: number;
  /** Injected so a test does not have to end its own process. */
  readonly exit?: (code: number) => void;
  readonly signals?: readonly NodeJS.Signals[];
}

export const DEFAULT_GRACE_MS = 20_000;

/**
 * Installs the signal handlers, and returns the handler for a test to call.
 *
 * A second signal while shutting down is IGNORED rather than escalated. An
 * operator pressing Ctrl-C twice usually means "I am impatient", and for this
 * system the thing they would be interrupting is a browser mid-portal-action or
 * an outbox flush — the two places where stopping half-way costs somebody real
 * work.
 */
export function installShutdown(options: ShutdownOptions): () => Promise<void> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  let stopping = false;

  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    options.log("shutting down");

    // The timer is unref'd so it cannot itself be the reason the process stays
    // alive, and it exits non-zero: a shutdown that ran out of time did not
    // finish, and saying otherwise would make a stuck instance look healthy.
    const timer = setTimeout(() => {
      options.log(`shutdown did not finish within ${String(graceMs)}ms; stopping anyway`);
      exit(1);
    }, graceMs);
    timer.unref();

    try {
      await options.close();
      clearTimeout(timer);
      options.log("stopped");
      exit(0);
    } catch (error) {
      clearTimeout(timer);
      const message = error instanceof Error ? error.message : String(error);
      options.log(`shutdown failed: ${message}`);
      exit(1);
    }
  };

  for (const signal of options.signals ?? (["SIGTERM", "SIGINT"] as const)) {
    process.on(signal, () => {
      void shutdown();
    });
  }
  return shutdown;
}
