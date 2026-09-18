/**
 * ATTACHED inspection: reading a form a person has signed in to.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The loop this exists for (ADR-0101, as amended in P79). The yes comes before
 * the account, so a reviewed blueprint of the form is a precondition of the
 * system creating the account — and a blueprint of a form behind a login
 * needs an account to see it. Neither discovery nor controlled inspection can
 * read a page behind a login: both launch their own browser, and neither
 * accepts a cookie, a storage state or an existing session. So nothing in
 * this repository could see the first real form.
 *
 * This mode does not create the account and does not sign in. A PERSON does
 * both, by hand, in a Chromium they launched with a remote-debugging port.
 * This session attaches to that browser over CDP, opens a tab in the context
 * that holds their signed-in session, and READS: the same in-page observation
 * script, the same captures, the same draft. The capability is `read_only`
 * and there is no `fill`, `click` or `submit` on the type.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The guard, and who it applies to ──────────────────────────────────────
 *
 * The request guard is discovery's — `GET`, `HEAD` and `OPTIONS` to the
 * allow-listed hosts, nothing else — installed on the attached context for as
 * long as this session holds it. A context is shared by every tab in it, so
 * while this session is attached the person's OWN tabs in that browser are
 * read-only too: a form they save in another tab is refused, and recorded.
 * That is the honest shape. The alternative — guarding only our tab — would
 * leave a POST one tab away from a session that says it cannot write. The
 * guard is removed when the session closes, and the browser is left running.
 *
 * Navigation carries its own allow-list, as inspection's does: the pages asked
 * for, by prefix. A page that sends itself elsewhere — most often a login page
 * when the session has ended — is refused and recorded, because "the session
 * was gone" is a finding and a silent redirect would hide it.
 *
 * ── What it does not apply, and why that is said here ─────────────────────
 *
 * robots.txt is not read. ADR-0091 governs a crawler fetching a site; this is
 * a person's own signed-in session, a named handful of pages, one tab, paced.
 * The pages behind a login are, on most portals, disallowed to every crawler,
 * which is right for crawlers and would make this mode refuse the only pages
 * it exists to read. The choice is recorded in the run record, so a reader
 * sees it was decided rather than forgotten. The pacing floor is kept.
 *
 * ── What it captures, and what it scrubs ──────────────────────────────────
 *
 * A signed-in page can carry the account holder's data: a name in the header,
 * a value the portal prefilled. The observation script records structure and
 * never values. The HTML capture is scrubbed of `<input value="…">` and
 * `<textarea>` content before it is written — in the captured string, not in
 * the page, which is not touched. What remains can still name the person; the
 * CLI says so and the runbook asks for a look before anything is sent.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Browser, BrowserContext, Page, Route } from "playwright";
import { chromium } from "playwright";

import type { FieldLocator } from "@askimate/aas-blueprint";
import { toPlaywrightLocator } from "@askimate/aas-browser-fill";

import { stackAtPoint, type LayerAtPoint } from "./point-read.js";

import { OBSERVE_SCRIPT } from "./observe-script.js";
import {
  BlockedRequestLog,
  HostAllowList,
  decideDiscoveryRequest,
  decideDiscoveryRequestForHost,
} from "./safety.js";
import { MINIMUM_CRAWL_DELAY_MS } from "./robots.js";
import type { PageObservation, ReadOnlySession, SessionMode } from "./session.js";

export type { LayerAtPoint } from "./point-read.js";

/** How an attached run is configured. */
export interface AttachedInspectionMode extends SessionMode {
  /**
   * The browser's CDP endpoint — `http://127.0.0.1:9222`, or the
   * `ws://…/devtools/browser/…` URL it answers at `/json/version`.
   */
  readonly cdpEndpoint: string;
  /** URL patterns this run may navigate to. Required; an empty list is refused. */
  readonly navigableUrlPatterns: readonly RegExp[];
  /** Injected so a test can hand over a browser it launched. */
  readonly connect?: (endpoint: string) => Promise<Browser>;
  /**
   * ADR-0128 — reading the page the RUNNER sees.
   *
   * `"refused"` (the default, and every capture before P161): a GET to a host
   * off the target's list is refused and recorded under the host rule. That
   * is why a tag manager, and anything a tag injects, has never appeared in
   * a page this repository has read.
   *
   * `"allowed"`: a GET, HEAD or OPTIONS to any host proceeds and is RECORDED
   * in `offHostReads`, so the run record says what loaded. The method rule
   * is untouched: nothing that is not a read proceeds, on any host.
   */
  readonly offHostReads?: "refused" | "allowed";
  /**
   * The `User-Agent` header presented on every request this session lets
   * through — the runner's own string, so the portal and its tags answer the
   * question "what do you serve THAT agent". Rewritten at the guard; the
   * page's `navigator.userAgent` is the person's browser's and is not
   * changed, which the run record states as a limit of the read.
   */
  readonly presentUserAgent?: string;
  /** The viewport our tab is set to — the runner's, so layout matches. */
  readonly viewport?: { readonly width: number; readonly height: number };
}

/**
 * What stands at a control's centre point (ADR-0128).
 *
 * `document.elementsFromPoint` at the control's own centre, top-most first,
 * down to the control itself. `covered` is true when the top-most element is
 * neither the control nor inside it — the fact a press cannot get past.
 */
export interface CoveringReading {
  readonly locator: FieldLocator;
  readonly found: boolean;
  readonly covered: boolean;
  /** The top-most element at the point, when it is not the control. */
  readonly atPoint?: LayerAtPoint;
  /** Every layer at the point, top first, ending at the control. */
  readonly stack: readonly LayerAtPoint[];
}

export class PlaywrightAttachedInspection implements ReadOnlySession {
  readonly #blocked = new BlockedRequestLog();
  readonly #allowList: HostAllowList;
  readonly #refusedNavigations: string[] = [];
  readonly #offHostReads: { readonly method: string; readonly url: string }[] = [];
  #browser: Browser | null = null;
  #context: BrowserContext | null = null;
  #page: Page | null = null;
  /** The tab this session opened — the only one it may close. */
  #ownTab: Page | null = null;
  #guard: ((route: Route) => Promise<void>) | null = null;
  #shotCount = 0;

  private constructor(private readonly mode: AttachedInspectionMode) {
    this.#allowList = new HostAllowList(mode.allowedHosts);
  }

  /**
   * Attaches to the person's browser and installs the guard.
   *
   * Refuses a browser with no context to read from, and a browser with more
   * than one: a hand-launched Chromium has exactly one default context, and
   * "which of these is the signed-in one" is not a question this session
   * should answer by guessing.
   */
  public static async open(mode: AttachedInspectionMode): Promise<PlaywrightAttachedInspection> {
    if (mode.capability !== "read_only") {
      throw new Error(
        `PlaywrightAttachedInspection is read-only. Requested capability: ${mode.capability}. ` +
          `Reading a signed-in form does not require, and must never acquire, the ability to ` +
          `fill or click.`,
      );
    }
    if (mode.navigableUrlPatterns.length === 0) {
      throw new Error(
        `An attached inspection needs an explicit list of URLs it may navigate to. An empty ` +
          `list is refused rather than treated as "anywhere the person is signed in".`,
      );
    }

    const session = new PlaywrightAttachedInspection(mode);
    await mkdir(mode.traceDir, { recursive: true });

    const connect = mode.connect ?? ((endpoint: string) => chromium.connectOverCDP(endpoint));
    session.#browser = await connect(mode.cdpEndpoint);
    const contexts = session.#browser.contexts();
    const context = contexts[0];
    if (context === undefined || contexts.length !== 1) {
      await session.#browser.close();
      session.#browser = null;
      throw new Error(
        `Expected exactly one browser context to read from and found ${String(contexts.length)}. ` +
          `Launch a fresh Chromium with its own profile directory and sign in there.`,
      );
    }
    session.#context = context;

    // ── THE GUARD — on the person's context, for as long as we hold it ────
    const guard = async (route: Route): Promise<void> => {
      const request = route.request();
      const url = request.url();
      // ADR-0129. `isNavigationRequest()` is true for a SUBFRAME's first load
      // too — a tracking pixel in an iframe — and this guard once refused
      // those as "the page tried to send the tab elsewhere". It cost a round
      // of attention on Run A: two pixel frames read as a lead. Only the main
      // frame's navigation is the tab going somewhere; a subframe's load is
      // an off-host read and falls to the host rule below, recorded as one.
      const mainFrame = ((): boolean => {
        try {
          return request.frame().parentFrame() === null;
        } catch {
          // Issued before its frame exists (Playwright's own caveat): not a
          // tab going anywhere, so it falls to the host rule.
          return false;
        }
      })();
      if (request.isNavigationRequest() && mainFrame && !session.#navigable(url)) {
        session.#refusedNavigations.push(url);
        session.#blocked.record({
          allowed: false,
          method: request.method(),
          url,
          reason:
            `Attached inspection refused to navigate to ${url}: it is not on this run's list. ` +
            `A page sending itself elsewhere is a finding — most often, the session has ended.`,
          rule: "navigation",
        });
        await route.abort("blockedbyclient");
        return;
      }
      // ADR-0128: as the runner, the host rule is lifted for READS and every
      // lifted read is recorded; the method rule never is.
      const decision =
        mode.offHostReads === "allowed"
          ? decideDiscoveryRequest(request.method(), url)
          : decideDiscoveryRequestForHost(request.method(), url, session.#allowList);
      if (!decision.allowed) {
        session.#blocked.record(decision);
        await route.abort("blockedbyclient");
        return;
      }
      if (mode.offHostReads === "allowed" && !session.#allowList.permits(url)) {
        session.#offHostReads.push({ method: decision.method, url });
      }
      if (mode.presentUserAgent === undefined) {
        await route.continue();
        return;
      }
      await route.continue({
        headers: { ...request.headers(), "user-agent": mode.presentUserAgent },
      });
    };
    session.#guard = guard;
    await context.route("**/*", guard);

    // ── The esbuild helper shim, on a context we did not create ──────────
    //
    // The in-page observation script is serialised and re-evaluated in the
    // browser. Under tsx — which is what `pnpm run inspect:attached` runs
    // under — esbuild rewrites it to call a `__name` helper that exists in
    // this process and not in the page. The three launching sessions learned
    // that by running their CLIs and shim it on the contexts they create.
    // This session attaches to a context it did not create and needed the
    // same shim, and the first real run against Sheffield said so:
    // `page.evaluate: ReferenceError: __name is not defined`, with the attach,
    // the session, the guard and the pacing all having worked (P80).
    //
    // Added BEFORE our tab is opened, so it applies to that tab's documents.
    // It is a definition of a no-op helper and nothing else; the person's
    // other tabs pick it up only on their next navigation, harmlessly.
    // `attached-inspection.test.ts` proves it through the real command under
    // tsx, because vitest's transform does not inject the helper and every
    // in-process test was blind to it.
    await context.addInitScript({
      content: "globalThis.__name = globalThis.__name || function (f) { return f; };",
    });

    // Our own tab, in THEIR context — which is what carries the session.
    session.#page = await context.newPage();
    session.#ownTab = session.#page;
    if (mode.viewport !== undefined) await session.#page.setViewportSize(mode.viewport);
    return session;
  }

  /** The tab's viewport, so a run record can say what size the page was read at. */
  public async viewport(): Promise<{ readonly width: number; readonly height: number } | null> {
    const size = this.#requirePage().viewportSize();
    return Promise.resolve(size === null ? null : { width: size.width, height: size.height });
  }

  /** Reads this session let through to hosts off the target's list (ADR-0128). */
  public get offHostReads(): readonly { readonly method: string; readonly url: string }[] {
    return [...this.#offHostReads];
  }

  /**
   * What stands at each named control's centre point (ADR-0128).
   *
   * A READ: `elementsFromPoint` and computed style, nothing dispatched. The
   * runner's press failed with the password box still on the page; this is
   * how the thing over the button gets a name from a capture before anything
   * in the runner learns to push past it.
   */
  public async covering(locators: readonly FieldLocator[]): Promise<readonly CoveringReading[]> {
    const page = this.#requirePage();
    const readings: CoveringReading[] = [];
    for (const locator of locators) {
      const found = toPlaywrightLocator(page, locator);
      const handle = found === null ? null : await found.first().elementHandle({ timeout: 2_000 }).catch(() => null);
      if (handle === null) {
        readings.push({ locator, found: false, covered: false, stack: [] });
        continue;
      }
      const stack = await stackAtPoint(handle, { withText: true });
      const atPoint = stack.covered ? stack.layers[0] : undefined;
      readings.push({
        locator,
        found: true,
        covered: stack.covered,
        ...(atPoint === undefined ? {} : { atPoint }),
        stack: stack.layers,
      });
    }
    return readings;
  }

  /**
   * Reads the person's OWN tab as it stands, without navigating it (P127).
   *
   * Distance item 5: the education page's grade list arrives only after an
   * institution is chosen, and `goto` opens the page fresh — every choice the
   * person made in their tab is gone before the read. This finds the one open
   * tab at `url`, refuses none or several, and makes it the page the next
   * `observe()`, `html()` and `screenshot()` read. It is never closed by this
   * session and never navigated by it. The `__name` shim is put in by hand,
   * because `addInitScript` reaches a tab only on its next navigation and
   * this one must not have one (P80, the same failure by another door).
   */
  public async adopt(url: string): Promise<void> {
    if (!this.#navigable(url)) {
      throw new Error(`Refusing to read ${url}: not on this attached run's list.`);
    }
    const context = this.#context;
    if (context === null) throw new Error("Session is not open.");
    const wanted = url.split("#")[0] ?? url;
    const open = context.pages().filter((page) => page !== this.#ownTab && page.url().split("#")[0] === wanted);
    if (open.length === 0) {
      throw new Error(
        `There is no open tab at ${url} to read as it stands. Open the page in your browser, ` +
          `make the choices the read needs, leave the tab on that page, and re-run.`,
      );
    }
    const page = open[0];
    if (open.length > 1 || page === undefined) {
      throw new Error(`Found ${String(open.length)} open tabs at ${url}; close all but the one to read, and re-run.`);
    }
    await page.evaluate("globalThis.__name = globalThis.__name || function (f) { return f; };");
    this.#page = page;
  }

  #navigable(url: string): boolean {
    if (!this.#allowList.permits(url)) return false;
    return this.mode.navigableUrlPatterns.some((pattern) => pattern.test(url));
  }

  public async goto(url: string): Promise<void> {
    if (!this.#navigable(url)) {
      throw new Error(`Refusing to navigate to ${url}: not on this attached run's list.`);
    }
    const page = this.#requirePage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // ── A redirect is followed below the guard ──────────────────────────
    //
    // Chromium follows a 302 inside its network layer; the route handler sees
    // the first request and not the hop, so a page that bounces to its login
    // arrives here already loaded. The hop was a GET on an allow-listed host,
    // which the guard's letter permits; what it is not is a page on this
    // run's list. Checked after the fact, recorded as the finding it is, and
    // refused — the caller gets no observation of a page it did not ask for.
    const landed = page.url();
    if (!this.#navigable(landed)) {
      this.#refusedNavigations.push(landed);
      this.#blocked.record({
        allowed: false,
        method: "GET",
        url: landed,
        reason:
          `Attached inspection was redirected from ${url} to ${landed}, which is not on this ` +
          `run's list. Most often the signed-in session has ended.`,
        rule: "navigation",
      });
      throw new Error(
        `Landed on ${landed} instead of ${url}: not on this attached run's list. ` +
          `Most often the signed-in session has ended — sign in again and re-run.`,
      );
    }
  }

  /** Waits for the page to finish drawing; gives up rather than prodding it. */
  public async settle(timeoutMs = 15_000): Promise<void> {
    try {
      await this.#requirePage().waitForLoadState("networkidle", { timeout: timeoutMs });
    } catch {
      // A page with a heartbeat never goes idle. Capture what rendered.
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

  public async links(): Promise<readonly string[]> {
    return this.#requirePage().evaluate(() =>
      [...document.querySelectorAll("a[href]")]
        .map((anchor) => (anchor as HTMLAnchorElement).href)
        .filter((href) => href.startsWith("http")),
    );
  }

  /** The page's HTML with every input value and textarea body removed. */
  public async html(): Promise<string> {
    return scrubValues(await this.#requirePage().content());
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

  public get refusedNavigations(): readonly string[] {
    return [...this.#refusedNavigations];
  }

  /** The floor between page requests, kept here as everywhere (ADR-0091). */
  public static get paceFloorMs(): number {
    return MINIMUM_CRAWL_DELAY_MS;
  }

  /**
   * Removes the guard, closes our tab, and DISCONNECTS. The person's browser
   * keeps running with their session in it; closing it is theirs to do.
   */
  public async close(): Promise<void> {
    if (this.#ownTab !== null) await this.#ownTab.close().catch(() => undefined);
    this.#ownTab = null;
    if (this.#context !== null && this.#guard !== null) {
      await this.#context.unroute("**/*", this.#guard).catch(() => undefined);
    }
    if (this.#browser !== null) await this.#browser.close();
    this.#page = null;
    this.#context = null;
    this.#guard = null;
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

/**
 * Blanks `value="…"` on `<input>` tags and the body of every `<textarea>`.
 *
 * On the captured STRING. The page is not touched. Option values on a
 * `<select>` are structure, not the person's data, and are kept — a blueprint
 * needs them.
 */
export function scrubValues(html: string): string {
  return html
    .replace(/<input\b([^>]*?)\svalue\s*=\s*("[^"]*"|'[^']*')/gi, '<input$1 value=""')
    .replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/gi, "$1$2");
}
