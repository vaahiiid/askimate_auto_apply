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
  const tracing = context.tracing as unknown as Record<string, unknown>;
  tracing["start"] = (): never => {
    throw new TracingForbiddenError("start");
  };
  tracing["startChunk"] = (): never => {
    throw new TracingForbiddenError("startChunk");
  };
  // `stop` stays callable and does nothing, so a shared teardown path that
  // calls it does not have to know which kind of context it holds.
  tracing["stop"] = async (): Promise<void> => Promise.resolve();
  tracing["stopChunk"] = async (): Promise<void> => Promise.resolve();

  return context;
}

/** Whether a context has had its tracing disabled by `openSensitiveContext`. */
export function tracingIsForbidden(context: BrowserContext): boolean {
  try {
    (context.tracing as unknown as { start: () => void }).start();
    return false;
  } catch (error) {
    return error instanceof TracingForbiddenError;
  }
}
