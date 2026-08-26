/**
 * Playwright-backed INSPECTION session.
 *
 * The same read-only capability as discovery — no `fill`, no `click`, no
 * `upload`, no `submit` — with one difference: the request guard is
 * `decideInspectionRequest`, so the portal's own component-rendering POSTs are
 * permitted and a Salesforce Lightning interface actually draws.
 *
 * ── Why a separate class rather than a flag ───────────────────────────────
 *
 * Vahid: *"Do not merely weaken the existing safety guard globally. Build a
 * separate capability/mode with explicit allow-lists and hard safety
 * boundaries."*
 *
 * A boolean on `PlaywrightDiscoverySession` would have meant every existing
 * discovery run was one argument away from permitting POST, and the reviewer
 * of any future change would have to notice which branch they were in.
 * `PlaywrightDiscoverySession` is untouched by this file and still refuses
 * POST by method. Choosing inspection means naming this class.
 *
 * ── Navigation is allow-listed too ────────────────────────────────────────
 *
 * The network guard governs subresources. It does not, by itself, stop the
 * page navigating itself somewhere consequential — `window.location = …` on a
 * timer is a document request the guard sees as a GET to an allow-listed host,
 * and a GET to `/s/application/submit-confirm` may well create something.
 *
 * So navigation carries its own allow-list of URL patterns, checked on every
 * frame navigation, and anything else is refused and recorded.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";

import { OBSERVE_SCRIPT } from "./observe-script.js";
import type { LwcObservation } from "./lwc-observe-script.js";
import { LWC_OBSERVE_SCRIPT } from "./lwc-observe-script.js";
import type { ActionVerdict } from "./inspection-safety.js";
import { decideInspectionRequest } from "./inspection-safety.js";
import { BlockedRequestLog, HostAllowList } from "./safety.js";
import type { PageObservation, ReadOnlySession, SessionMode } from "./session.js";

/** What an inspection run is permitted to reach. */
export interface InspectionMode extends SessionMode {
  /**
   * URL patterns this run may navigate to, as regular expressions.
   *
   * Required and deliberately without a default. An inspection run exists to
   * look at a named handful of pages; "anything on the host" is what the
   * discovery crawler is for, and it does not permit POST.
   */
  readonly navigableUrlPatterns: readonly RegExp[];
}

/** An Aura action the guard refused, kept for the report. */
export interface RefusedAction {
  readonly url: string;
  readonly verdicts: readonly ActionVerdict[];
  readonly reason: string;
}

export class PlaywrightInspectionSession implements ReadOnlySession {
  readonly #blocked = new BlockedRequestLog();
  readonly #allowList: HostAllowList;
  readonly #refusedActions: RefusedAction[] = [];
  readonly #permittedActions: ActionVerdict[] = [];
  readonly #refusedNavigations: string[] = [];
  #browser: Browser | null = null;
  #context: BrowserContext | null = null;
  #page: Page | null = null;
  #shotCount = 0;

  private constructor(private readonly mode: InspectionMode) {
    this.#allowList = new HostAllowList(mode.allowedHosts);
  }

  public static async open(mode: InspectionMode): Promise<PlaywrightInspectionSession> {
    if (mode.capability !== "read_only") {
      throw new Error(
        `PlaywrightInspectionSession is read-only. Requested capability: ${mode.capability}. ` +
          `Rendering a Salesforce interface does not require, and must never acquire, the ` +
          `ability to fill or click.`,
      );
    }
    if (mode.navigableUrlPatterns.length === 0) {
      throw new Error(
        `An inspection run needs an explicit list of URLs it may navigate to. An empty list is ` +
          `refused rather than treated as "anywhere on the host".`,
      );
    }

    const session = new PlaywrightInspectionSession(mode);
    await mkdir(mode.traceDir, { recursive: true });

    const executablePath = process.env["AAS_CHROMIUM_PATH"];
    session.#browser = await chromium.launch({
      headless: true,
      ...(executablePath !== undefined && executablePath.length > 0 ? { executablePath } : {}),
    });

    session.#context = await session.#browser.newContext({
      recordVideo: { dir: join(mode.traceDir, "video") },
      // Identify honestly, as discovery does. Inspection is a more capable
      // mode, which makes saying what we are more important rather than less.
      userAgent:
        "Mozilla/5.0 (compatible; AskiMate-AAS-Inspection/0.1; +https://askimate.com/bot) " +
        "read-only application-portal inspection",
    });

    await session.#context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    await session.#context.addInitScript({
      content: "globalThis.__name = globalThis.__name || function (f) { return f; };",
    });

    // ── THE GUARD ────────────────────────────────────────────────────────
    await session.#context.route("**/*", async (route) => {
      const request = route.request();
      const isNavigation = request.isNavigationRequest();
      const url = request.url();

      // Navigation is checked FIRST and separately. A page that sends itself
      // to a consequential endpoint is a GET the network guard would wave
      // through.
      if (isNavigation && !session.#navigable(url)) {
        session.#refusedNavigations.push(url);
        session.#blocked.record({
          allowed: false,
          method: request.method(),
          url,
          reason:
            `Inspection refused to navigate to ${url}: it is not on this run's navigation ` +
            `allow-list. A page navigating itself somewhere is still a navigation.`,
        });
        await route.abort("blockedbyclient");
        return;
      }

      const decision = decideInspectionRequest({
        method: request.method(),
        url,
        postData: request.postData(),
        allowList: session.#allowList,
      });

      if (!decision.allowed) {
        session.#blocked.record(decision);
        if (decision.actions !== undefined) {
          session.#refusedActions.push({
            url,
            verdicts: decision.actions,
            reason: decision.reason ?? "",
          });
        }
        await route.abort("blockedbyclient");
        return;
      }

      if (decision.actions !== undefined) session.#permittedActions.push(...decision.actions);
      await route.continue();
    });

    session.#page = await session.#context.newPage();
    return session;
  }

  #navigable(url: string): boolean {
    if (!this.#allowList.permits(url)) return false;
    return this.mode.navigableUrlPatterns.some((pattern) => pattern.test(url));
  }

  public async goto(url: string): Promise<void> {
    if (!this.#navigable(url)) {
      throw new Error(
        `Refusing to navigate to ${url}: not on this inspection run's navigation allow-list.`,
      );
    }
    await this.#requirePage().goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  /**
   * Waits for the framework to finish drawing.
   *
   * A Lightning page is empty at `domcontentloaded` and fills in over several
   * round trips. Reading it too early captures the same "Loading… CSS Error"
   * shell the Phase 3 run got, which would make this whole mode pointless.
   *
   * Waiting is not interaction: it observes, and gives up rather than
   * prodding the page along.
   */
  public async settle(timeoutMs = 15_000): Promise<void> {
    const page = this.#requirePage();
    try {
      await page.waitForLoadState("networkidle", { timeout: timeoutMs });
    } catch {
      // A portal with a polling heartbeat never goes idle. Not a failure —
      // capture what rendered by the deadline.
    }
  }

  public async observe(): Promise<PageObservation> {
    const page = this.#requirePage();
    const observed = await page.evaluate(OBSERVE_SCRIPT);
    return {
      url: page.url(),
      title: await page.title(),
      forms: observed.forms,
      candidateAdvanceControls: observed.candidateAdvanceControls,
      signals: observed.signals,
      observedAt: this.#now(),
    };
  }

  /**
   * Reads the page the way a Lightning interface actually presents itself.
   *
   * `observe()` is kept because plain-HTML portals still exist and it is what
   * discovery uses. It reports nothing on an LWC page, for the reason
   * documented in `lwc-observe-script.ts`: there is no `<form>` to hang
   * fields off.
   *
   * Reads only. It does not open a combobox to see its options; it records
   * that they are unavailable and why.
   */
  public async observeLwc(): Promise<LwcObservation> {
    return await this.#requirePage().evaluate(LWC_OBSERVE_SCRIPT);
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

  public get blockedLog(): BlockedRequestLog {
    return this.#blocked;
  }

  /**
   * Aura actions the guard refused.
   *
   * Part of the finding, not a diagnostic. A page that renders incompletely
   * because a non-cacheable Apex call was refused is telling us something a
   * specialist needs to see — possibly that this portal cannot be inspected
   * without permitting a specific named method, which is their decision.
   */
  public get refusedActions(): readonly RefusedAction[] {
    return [...this.#refusedActions];
  }

  /** Actions the guard permitted, so the report shows both sides. */
  public get permittedActions(): readonly ActionVerdict[] {
    return [...this.#permittedActions];
  }

  public get refusedNavigations(): readonly string[] {
    return [...this.#refusedNavigations];
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
