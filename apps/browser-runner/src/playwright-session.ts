/**
 * Playwright-backed read-only session.
 *
 * Runs the guard from `safety.ts` as a request interceptor, so the network
 * layer refuses anything that is not a safe, idempotent read on an
 * allow-listed host — regardless of whether our code or the page's own
 * JavaScript initiated it.
 *
 * Full trace capture per brief §5: trace, screenshots and video into the run's
 * directory, so a specialist can see exactly what the runner saw.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";

import type { PageObservation, ReadOnlySession, SessionMode } from "./session.js";
import { BlockedRequestLog, HostAllowList, decideDiscoveryRequestForHost } from "./safety.js";
import { OBSERVE_SCRIPT } from "./observe-script.js";

export class PlaywrightDiscoverySession implements ReadOnlySession {
  readonly #blocked = new BlockedRequestLog();
  readonly #allowList: HostAllowList;
  #browser: Browser | null = null;
  #context: BrowserContext | null = null;
  #page: Page | null = null;
  #shotCount = 0;

  private constructor(private readonly mode: SessionMode) {
    this.#allowList = new HostAllowList(mode.allowedHosts);
  }

  /** Opens an isolated, read-only session. */
  public static async open(mode: SessionMode): Promise<PlaywrightDiscoverySession> {
    if (mode.capability !== "read_only") {
      throw new Error(
        `PlaywrightDiscoverySession is read-only. Requested capability: ${mode.capability}.`,
      );
    }

    const session = new PlaywrightDiscoverySession(mode);
    await mkdir(mode.traceDir, { recursive: true });

    // Honour an explicit browser path when one is configured.
    //
    // Production images pin their own Chromium, and a dev image may carry a
    // build that does not match the pinned Playwright version. Resolving from
    // configuration keeps both working without the runner ever downloading a
    // browser at run time — which it must not do, since it runs in an isolated
    // container with no business fetching executables (brief §8).
    const executablePath = process.env["AAS_CHROMIUM_PATH"];
    session.#browser = await chromium.launch({
      headless: true,
      ...(executablePath !== undefined && executablePath.length > 0 ? { executablePath } : {}),
    });
    session.#context = await session.#browser.newContext({
      // A fresh context per run: no cookies, no storage, nothing carried over
      // from a previous case (brief §5, one session per run).
      recordVideo: { dir: join(mode.traceDir, "video") },
      // Identify honestly. Discovery does not disguise itself as something it
      // is not — brief §7 forbids defeating protective mechanisms, and that
      // principle covers not pretending to be an ordinary browser either.
      userAgent:
        "Mozilla/5.0 (compatible; AskiMate-AAS-Discovery/0.1; +https://askimate.com/bot) " +
        "read-only application-form discovery",
    });

    await session.#context.tracing.start({ screenshots: true, snapshots: true, sources: false });

    // ── esbuild helper shim ──────────────────────────────────────────────
    //
    // Functions passed to page.evaluate() are serialised and re-evaluated in
    // the browser. TypeScript runners built on esbuild (tsx, and bundlers in
    // general) rewrite named functions to reference a `__name` helper, which
    // exists in the Node module scope but NOT in the page — so the serialised
    // function throws "__name is not defined" the moment it runs.
    //
    // Found by running the CLI, not by the tests: vitest's transform does not
    // inject the helper, so the unit tests passed while the real entry point
    // failed on its first page. Shimmed as a no-op rather than restructuring
    // every in-page function into a string, which would cost all type checking
    // inside them.
    await session.#context.addInitScript({
      content: "globalThis.__name = globalThis.__name || function (f) { return f; };",
    });

    // ── THE GUARD ────────────────────────────────────────────────────────
    // Every request, including ones the page's own scripts initiate.
    await session.#context.route("**/*", async (route) => {
      const request = route.request();
      const decision = decideDiscoveryRequestForHost(
        request.method(),
        request.url(),
        session.#allowList,
      );

      if (!decision.allowed) {
        session.#blocked.record(decision);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    session.#page = await session.#context.newPage();
    return session;
  }

  public async goto(url: string): Promise<void> {
    if (!this.#allowList.permits(url)) {
      throw new Error(
        `Refusing to navigate to ${url}: host is not on this run's allow-list ` +
          `(${this.#allowList.hosts.join(", ")}).`,
      );
    }
    await this.#requirePage().goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  public async observe(): Promise<PageObservation> {
    const page = this.#requirePage();
    // The observation script runs in the page and returns plain data. It reads
    // the DOM; it does not interact with it.
    const observed = await page.evaluate(OBSERVE_SCRIPT);
    return {
      url: page.url(),
      title: await page.title(),
      forms: observed.forms,
      candidateAdvanceControls: observed.candidateAdvanceControls,
      observedAt: this.#now(),
    };
  }

  public async links(): Promise<readonly string[]> {
    return this.#requirePage().evaluate(() =>
      [...document.querySelectorAll("a[href]")]
        .map((anchor) => (anchor as HTMLAnchorElement).href)
        .filter((href) => href.startsWith("http")),
    );
  }

  public html(): Promise<string> {
    return this.#requirePage().content();
  }

  public async screenshot(name: string): Promise<string> {
    this.#shotCount += 1;
    const file = join(
      this.mode.traceDir,
      `${String(this.#shotCount).padStart(3, "0")}-${name.replace(/[^a-z0-9-]/gi, "_")}.png`,
    );
    await this.#requirePage().screenshot({ path: file, fullPage: true });
    return file;
  }

  public currentUrl(): Promise<string> {
    return Promise.resolve(this.#requirePage().url());
  }

  public blockedRequests(): readonly { readonly method: string; readonly url: string }[] {
    return this.#blocked.entries.map((entry) => ({ method: entry.method, url: entry.url }));
  }

  /** The blocked-request log, which is part of the discovery finding. */
  public get blockedLog(): BlockedRequestLog {
    return this.#blocked;
  }

  public async close(): Promise<void> {
    if (this.#context !== null) {
      await this.#context.tracing.stop({ path: join(this.mode.traceDir, "trace.zip") });
      await this.#context.close();
    }
    if (this.#browser !== null) await this.#browser.close();
    this.#page = null;
    this.#context = null;
    this.#browser = null;
  }

  #now(): Date {
    // The single sanctioned clock read in this package, at the injection
    // boundary. Everything downstream takes the result as a parameter.
    const injected = this.mode.now;
    if (injected !== undefined) return injected();
    // eslint-disable-next-line no-restricted-syntax -- injection boundary
    return new Date();
  }

  #requirePage(): Page {
    if (this.#page === null) throw new Error("Session is not open.");
    return this.#page;
  }
}
