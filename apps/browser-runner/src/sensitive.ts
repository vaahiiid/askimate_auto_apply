/**
 * The sensitive-data browser context, and the redaction it forces.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The problem this exists for, established empirically rather than assumed:
 *
 *   **Playwright writes typed values verbatim into `trace.trace`.** Every
 *   input route does it — `fill()`, `keyboard.type()`, `pressSequentially()`,
 *   `evaluate(setter, value)` — and so does a page that fetches a value
 *   itself, because response bodies are stored as trace resources.
 *
 *   None of the obvious mitigations work:
 *
 *   | Attempt                                  | Result        |
 *   |------------------------------------------|---------------|
 *   | `tracing.stopChunk()` around the fill     | still leaks   |
 *   | full `tracing.stop()` → fill → `start()`  | still leaks   |
 *   | tracing never started on the context      | **clean**     |
 *
 *   The middle row is the surprising one: the action is buffered and replayed
 *   into the NEXT trace file. So "turn tracing off for the sensitive bit" is
 *   not a technique that exists.
 *
 * The preparation session was created with `recordVideo` and
 * `tracing.start({ screenshots: true, snapshots: true })`. It fills passport
 * numbers, dates of birth, addresses and personal statements. All of it was
 * being written to disk in the clear, on every run.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * A context that will ever hold personal data is created here, and **tracing
 * is not merely left off — it is made unavailable.** `tracing.start` and
 * `tracing.startChunk` are replaced with functions that throw.
 *
 * That is deliberately not a convention. Vahid: *"Do not rely on developers
 * remembering to call stopChunk(), stop(), or similar. The architecture must
 * make it impossible."* A comment saying "do not enable tracing here" is
 * exactly the kind of instruction that survives until someone is debugging at
 * five o'clock and wants one trace.
 */

import type { Browser, BrowserContext } from "playwright";

// Redaction is a domain concept, not a browser one — the orchestrator's
// execution outcomes need it too, and a package may not depend on an app.
export type { RedactedValue } from "@askimate/aas-domain";
export { redact, sameRedacted } from "@askimate/aas-domain";

/**
 * The private mark `openSensitiveContext` leaves and `tracingIsForbidden`
 * reads.
 *
 * A symbol rather than a string key, and never exported, so nothing outside
 * this module can forge it — including the tests, which is the point.
 */
const FORBIDDEN = Symbol("askimate.tracing.forbidden");

/** Thrown when something tries to start tracing on a sensitive context. */
export class TracingForbiddenError extends Error {
  public override readonly name = "TracingForbiddenError";
  public constructor(method: string) {
    super(
      `tracing.${method}() is not available on a sensitive browser context. Playwright writes ` +
        `typed values verbatim into trace.trace, and stopping tracing around the fill does not ` +
        `prevent it — the action is buffered and replayed into the next trace file. A context ` +
        `that handles a student's passport number, date of birth or personal statement therefore ` +
        `never has tracing at all. If you need to debug a fill, use the redacted fill log.`,
    );
  }
}

/** Options a sensitive context accepts. Note what is NOT here. */
export interface SensitiveContextOptions {
  readonly userAgent: string;
}

/**
 * Opens a browser context that can never be traced or recorded.
 *
 * There is no option to turn any of it back on. `SensitiveContextOptions` has
 * no `recordVideo`, no `tracing` and no escape hatch, and the returned
 * context's tracing methods throw.
 *
 * Screenshots are still possible, but only through `maskedScreenshot` below,
 * which covers every input before the shutter.
 */
export async function openSensitiveContext(
  browser: Browser,
  options: SensitiveContextOptions,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    // No recordVideo. A video of a form being filled shows every value that is
    // not a password field in plain sight, and unlike a trace it cannot be
    // scanned for a leak afterwards — which makes it worse, not better.
    userAgent: options.userAgent,
  });

  // ── Make tracing unavailable, not merely unused ─────────────────────────
  //
  // Replacing the methods rather than trusting nobody calls them. A future
  // change that adds `tracing.start()` here fails loudly on the first run
  // instead of silently writing personal data to disk.
  const tracing = context.tracing as unknown as Record<PropertyKey, unknown>;
  const start = (): never => {
    throw new TracingForbiddenError("start");
  };
  const startChunk = (): never => {
    throw new TracingForbiddenError("startChunk");
  };
  tracing["start"] = start;
  tracing["startChunk"] = startChunk;
  // `stop` stays callable and does nothing, so a shared teardown path that
  // calls it does not have to know which kind of context it holds.
  tracing["stop"] = async (): Promise<void> => Promise.resolve();
  tracing["stopChunk"] = async (): Promise<void> => Promise.resolve();

  // The mark `tracingIsForbidden` reads. Non-enumerable and non-writable, and
  // keyed by a symbol that never leaves this module — so nothing outside can
  // set it, and nothing that walks the object's keys will see it.
  Object.defineProperty(tracing, FORBIDDEN, {
    value: { start, startChunk },
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return context;
}

/**
 * Whether a context has had its tracing disabled by `openSensitiveContext`.
 *
 * ── This used to be a probe, and the probe was the bug ────────────────────
 *
 * The first version answered the question by CALLING `context.tracing.start()`
 * and reporting whether it threw. On a sensitive context that is harmless —
 * the replacement throws before doing anything. On an ordinary context it is
 * the opposite of harmless: **it starts tracing.** A function whose whole job
 * is to detect the leak mechanism was switching it on, and then returning
 * `false` as though it had merely observed something.
 *
 * It was found by an unhandled rejection in the test that checks an ordinary
 * context is refused: the second call reported "Tracing has been already
 * started", which is only possible if the first call started it. The real
 * `start()` is async, so the rejection also escaped the `try` entirely and the
 * function would have returned `false` either way — right answer, wrong
 * reason, wrong side effects.
 *
 * So the check reads a mark instead, and touches nothing. The mark is keyed by
 * a module-private symbol, is non-enumerable and non-writable, and carries the
 * identities of the two functions that were installed — so a context that was
 * marked and then had `start` quietly restored fails the identity check rather
 * than passing on the strength of the mark alone.
 */
export function tracingIsForbidden(context: BrowserContext): boolean {
  const tracing = context.tracing as unknown as Record<PropertyKey, unknown>;
  const mark = tracing[FORBIDDEN] as { start: unknown; startChunk: unknown } | undefined;
  if (mark === undefined) return false;
  return tracing["start"] === mark.start && tracing["startChunk"] === mark.startChunk;
}
