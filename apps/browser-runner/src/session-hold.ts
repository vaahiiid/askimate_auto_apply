/**
 * The signed-in browser contexts a runner holds, in memory, for five minutes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0101 §2 — Vahid, 2026-09-10: *"Yes, in memory only, and the bound is
 * five minutes, not ten. Match the vault's ceiling from ADR-0034. Two
 * different timeouts for two sensitive things is how someone eventually
 * applies the wrong one. If five minutes turns out to be too short in
 * practice, tell me with the measurement and I will reconsider it — do not
 * quietly widen it."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Creating the account SIGNS THE STUDENT IN: the portal sets a session cookie
 * in the context the registration was typed in, and the application form is
 * unreachable without it. Before P71 that context was closed with the work
 * item that made it, and the next item — the first page of the form — arrived
 * logged out with no way back (blocker 19). This keeps it, per run, between
 * consecutive items, and nowhere but here:
 *
 *   in memory      a `BrowserContext` in this process's heap. Nothing is
 *                  written — no cookie, no storage state, no token — because a
 *                  session cookie is a bearer credential to a student's
 *                  account, and brief §8 forbids holding one at rest.
 *   five minutes   idle. `SECURE_HOLD_CEILING_SECONDS`, the vault's own
 *                  ceiling, referenced and not redeclared. A context that has
 *                  not been used for that long is closed on the next look.
 *   sensitive      every context comes from `openSensitiveContext`, so it is
 *                  never traced, recorded, or asked to remember a value
 *                  (ADR-0025).
 *
 * What the runner declares to the plane is `held()` — the run ids with a live
 * context — and the plane hands a fill only to a runner that names the run
 * (`claimWork`, ADR-0101 §2). A runner that crashes loses every hold, which is
 * the design: the run waits for the resume path (ADR-0101 §3), not for a
 * cookie somebody saved.
 */

import type { Browser, BrowserContext, Page } from "playwright";

import { SECURE_HOLD_CEILING_SECONDS } from "@askimate/aas-contracts";

import { openSensitiveContext } from "./sensitive.js";

export interface SessionHoldOptions {
  readonly browser: Browser;
  /** Injected, so the idle ceiling is testable without waiting five minutes. */
  readonly now: () => Date;
  readonly userAgent?: string;
}

interface Held {
  readonly context: BrowserContext;
  lastUsedAt: Date;
}

export class SessionHold {
  /** The one bound, as the vault's: five minutes idle. */
  public static readonly CEILING_SECONDS: number = SECURE_HOLD_CEILING_SECONDS;

  readonly #held = new Map<string, Held>();
  readonly #browser: Browser;
  readonly #now: () => Date;
  readonly #userAgent: string;

  public constructor(options: SessionHoldOptions) {
    this.#browser = options.browser;
    this.#now = options.now;
    this.#userAgent = options.userAgent ?? "AskiMate-Runner/1.0";
  }

  /**
   * The context for a run — the one held, or a fresh sensitive one. Touched,
   * so the ceiling counts from now.
   */
  public async open(runId: string): Promise<BrowserContext> {
    await this.sweep();
    const existing = this.#held.get(runId);
    if (existing !== undefined) {
      existing.lastUsedAt = this.#now();
      return existing.context;
    }
    const context = await openSensitiveContext(this.#browser, { userAgent: this.#userAgent });
    this.#held.set(runId, { context, lastUsedAt: this.#now() });
    return context;
  }

  /**
   * Takes over a context a caller signed in by other means.
   *
   * The seam the resume path (ADR-0101 §3, P72) hands a freshly signed-in
   * context through, and the seam a test signs in through until then. A
   * context already held for the run is closed first: two sessions for one
   * run would be two places a student is signed in from.
   */
  public async adopt(runId: string, context: BrowserContext): Promise<void> {
    await this.release(runId);
    this.#held.set(runId, { context, lastUsedAt: this.#now() });
  }

  /**
   * A page in the run's held context, or `null` when none is held or the
   * hold has idled past the ceiling. Touched. The context's first page where
   * there is one — the page the account was created in — otherwise a new
   * page, which is signed in all the same because the cookie is the
   * context's.
   */
  public async pageFor(runId: string): Promise<Page | null> {
    await this.sweep();
    const held = this.#held.get(runId);
    if (held === undefined) return null;
    held.lastUsedAt = this.#now();
    const open = held.context.pages();
    return open[0] ?? (await held.context.newPage());
  }

  /** The runs held right now — what the runner declares on every claim. */
  public async held(): Promise<readonly string[]> {
    await this.sweep();
    return [...this.#held.keys()];
  }

  /** Closes a run's context. Nothing happens for a run that holds none. */
  public async release(runId: string): Promise<void> {
    const held = this.#held.get(runId);
    if (held === undefined) return;
    this.#held.delete(runId);
    await held.context.close().catch(() => undefined);
  }

  /**
   * Closes every context idle past the ceiling. Called on every look, so the
   * bound holds without a timer; returns how many went, for a test.
   */
  public async sweep(): Promise<number> {
    const cutoff = this.#now().getTime() - SessionHold.CEILING_SECONDS * 1000;
    let closed = 0;
    for (const [runId, held] of [...this.#held.entries()]) {
      if (held.lastUsedAt.getTime() > cutoff) continue;
      await this.release(runId);
      closed += 1;
    }
    return closed;
  }

  /** Closes everything. The process is stopping; nothing survives it. */
  public async closeAll(): Promise<void> {
    for (const runId of [...this.#held.keys()]) await this.release(runId);
  }
}
