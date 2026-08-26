/**
 * Playwright-backed preparation session.
 *
 * Fills a real application form and stops. It implements `FillableSession`,
 * which has no `submit` — so this class cannot submit, whatever it is asked to
 * do. The click guard in ./preparation-safety.ts closes the obvious way round
 * that, which is clicking the submit button.
 *
 * ── Label-first locators ──────────────────────────────────────────────────
 *
 * Locators are tried in the order the blueprint records them, and blueprints
 * put labels first. That is not an aesthetic preference: a portal that
 * re-renders its DOM breaks a CSS selector or a generated id long before it
 * breaks the words a human reads next to the box. Salesforce Experience Cloud,
 * the platform the first target appears to use, generates its ids.
 *
 * ── What `fill` accepts ───────────────────────────────────────────────────
 *
 * `ConfirmedValue<string>`, and nothing else. There is no overload taking a
 * plain string, so the last step before a value reaches a real university form
 * field is still type-checked. It is unwrapped at the moment of typing and
 * never before.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { FieldLocator } from "@askimate/aas-blueprint";
import type { ConfirmedValue } from "@askimate/aas-domain";
import { unwrapConfirmed } from "@askimate/aas-domain";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { chromium } from "playwright";

import { OBSERVE_SCRIPT } from "./observe-script.js";
import type { ClickDecision } from "./preparation-safety.js";
import {
  ClickAllowList,
  HostAllowList,
  WriteLog,
  decidePreparationRequest,
  isStateChanging,
} from "./preparation-safety.js";
import { BlockedRequestLog } from "./safety.js";
import type { FillableSession, PageObservation, SessionMode } from "./session.js";

/** How a preparation session is configured. */
export interface PreparationMode extends SessionMode {
  readonly capability: "fillable";
  /** Controls this run may click. Everything else is refused. */
  readonly clickableControls: readonly FieldLocator[];
  /** Submission endpoints, where the blueprint records them. */
  readonly forbiddenEndpoints?: readonly string[];
}

export class ClickRefusedError extends Error {
  public override readonly name = "ClickRefusedError";
  public constructor(public readonly decision: ClickDecision) {
    super(decision.reason ?? "The click was refused.");
  }
}

/**
 * The portal did not take the value it was given.
 *
 * The specific failure this catches: a `maxlength` that silently truncates. A
 * personal statement cut from 4,200 characters to 4,000 looks fine on the page
 * and is a different personal statement from the one the student wrote.
 */
export class ValueNotAcceptedError extends Error {
  public override readonly name = "ValueNotAcceptedError";
  public constructor(
    public readonly locator: FieldLocator,
    public readonly intended: string,
    public readonly stored: string,
  ) {
    super(
      stored.length === 0
        ? `The portal did not accept a value for ${locator.strategy}="${locator.value}". The ` +
            `field is still empty.`
        : `The portal truncated ${locator.strategy}="${locator.value}" from ` +
            `${String(intended.length)} characters to ${String(stored.length)}. Submitting the ` +
            `shortened version would submit something the student did not write.`,
    );
  }
}

/**
 * The portal's dropdown does not offer the confirmed value.
 *
 * Mapping already refused to approximate an option (ADR-0017), so reaching this
 * means the mapping is out of date with the portal — the university has changed
 * its list. Reported as its own error because the fix is a mapping review, not
 * a question for the student.
 */
export class OptionNotAvailableError extends Error {
  public override readonly name = "OptionNotAvailableError";
  public constructor(
    public readonly locator: FieldLocator,
    public readonly wanted: string,
    public readonly available: readonly { readonly value: string; readonly label: string }[],
  ) {
    super(
      `The portal's "${locator.value}" list does not offer "${wanted}". It offers: ` +
        `${available.map((option) => `${option.value} (${option.label})`).join(", ")}. ` +
        `The mapping is out of step with the portal and a specialist must review it — the ` +
        `nearest option is not chosen.`,
    );
  }
}

export class LocatorNotFoundError extends Error {
  public override readonly name = "LocatorNotFoundError";
  public constructor(public readonly locators: readonly FieldLocator[]) {
    super(
      `None of the recorded locators found an element: ` +
        `${locators.map((l) => `${l.strategy}="${l.value}"`).join(", ")}. This is blueprint ` +
        `drift — the page is not what the blueprint says it is.`,
    );
  }
}

export class PlaywrightPreparationSession implements FillableSession {
  readonly #allowList: HostAllowList;
  readonly #clickAllowList: ClickAllowList;
  readonly #writes = new WriteLog();
  readonly #reformatted: {
    readonly locator: FieldLocator;
    readonly intended: string;
    readonly stored: string;
  }[] = [];
  readonly #blocked = new BlockedRequestLog();
  #browser: Browser | null = null;
  #context: BrowserContext | null = null;
  #page: Page | null = null;
  #shotCount = 0;

  private constructor(private readonly mode: PreparationMode) {
    this.#allowList = new HostAllowList(mode.allowedHosts);
    this.#clickAllowList = new ClickAllowList(mode.clickableControls);
  }

  public static async open(mode: PreparationMode): Promise<PlaywrightPreparationSession> {
    // No runtime capability check here, unlike the discovery session: this one
    // takes a `PreparationMode`, whose capability is the literal "fillable", so
    // the compiler has already refused anything else.
    const session = new PlaywrightPreparationSession(mode);
    await mkdir(mode.traceDir, { recursive: true });

    const executablePath = process.env["AAS_CHROMIUM_PATH"];
    session.#browser = await chromium.launch({
      headless: true,
      ...(executablePath !== undefined && executablePath.length > 0 ? { executablePath } : {}),
    });
    session.#context = await session.#browser.newContext({
      recordVideo: { dir: join(mode.traceDir, "video") },
      // Identifies honestly, as discovery does. A run that fills a real
      // application has even less business pretending to be something else.
      userAgent:
        "Mozilla/5.0 (compatible; AskiMate-AAS-Preparation/0.1; +https://askimate.com/bot) " +
        "application preparation — does not submit",
    });

    await session.#context.tracing.start({ screenshots: true, snapshots: true, sources: false });

    // See PlaywrightDiscoverySession for why this shim exists: esbuild rewrites
    // named functions to reference a helper the page does not have.
    await session.#context.addInitScript({
      content: "globalThis.__name = globalThis.__name || function (f) { return f; };",
    });

    const policy = {
      allowList: session.#allowList,
      forbiddenEndpoints: mode.forbiddenEndpoints ?? [],
    };

    await session.#context.route("**/*", async (route) => {
      const request = route.request();
      const decision = decidePreparationRequest(request.method(), request.url(), policy);

      if (!decision.allowed) {
        session.#blocked.record(decision);
        await route.abort("blockedbyclient");
        return;
      }

      // Recorded BEFORE it is sent, so the log is complete even if the run dies
      // mid-request. "What did we send?" must be answerable after a crash.
      if (isStateChanging(request.method())) {
        session.#writes.record(request.method(), request.url());
      }
      await route.continue();
    });

    session.#page = await session.#context.newPage();
    return session;
  }

  // ── Reading ──────────────────────────────────────────────────────────────

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

  /** Everything this run sent that could have changed something on the server. */
  public get writeLog(): WriteLog {
    return this.#writes;
  }

  // ── Writing ──────────────────────────────────────────────────────────────

  /**
   * Types a confirmed value into a field.
   *
   * `select` elements are set by option value rather than typed into, and the
   * option must exist: mapping already refused to approximate one (ADR-0017),
   * and Playwright's own `selectOption` fails rather than choosing a default.
   */
  public async fill(locator: FieldLocator, value: ConfirmedValue<string>): Promise<void> {
    // Unwrapped at the last possible moment. Before this line it is a
    // ConfirmedValue and nothing else could have been passed here.
    await this.#type(locator, unwrapConfirmed(value));
  }

  async #type(locator: FieldLocator, text: string): Promise<void> {
    const target = await this.#resolve([locator]);

    const tagName = (await target.evaluate((element) => element.tagName)).toLowerCase();
    if (tagName === "select") {
      // Check the option exists before asking for it. Playwright would retry
      // for its default timeout and then fail — correct, but thirty seconds
      // later and with an error about waiting rather than about the option.
      const available = await target.evaluate((element) =>
        [...(element as HTMLSelectElement).options].map((option) => ({
          value: option.value,
          label: option.textContent ?? "",
        })),
      );
      if (!available.some((option) => option.value === text)) {
        throw new OptionNotAvailableError(locator, text, available);
      }
      await target.selectOption(text);
      return;
    }

    const type = await target.getAttribute("type");
    if (type === "checkbox" || type === "radio") {
      // A checkbox carrying a student's answer is set from that answer, never
      // ticked because the form wants it ticked.
      if (text === "true" || text === "yes" || text === "on") await target.check();
      else await target.uncheck();
      return;
    }

    await target.fill(text);

    // ── Read back what the portal actually took ────────────────────────────
    //
    // Portals normalise. A date input turns 02/04/1999 into 1999-04-02, and
    // that is fine. A maxlength turns a 4,200-character personal statement into
    // a 4,000-character one, and that is not: it is a different statement, it
    // looks entirely normal on the page, and nobody would notice before it was
    // submitted.
    //
    // So a truncation or an empty field throws; anything else different is
    // recorded for the specialist rather than treated as a failure.
    const stored = await target.inputValue();
    if (text.length > 0 && stored.length === 0) {
      throw new ValueNotAcceptedError(locator, text, stored);
    }
    if (stored.length < text.length && text.startsWith(stored)) {
      throw new ValueNotAcceptedError(locator, text, stored);
    }
    if (stored !== text) {
      this.#reformatted.push({ locator, intended: text, stored });
    }
  }

  /**
   * Reads what a field currently holds.
   *
   * A plain read, and it is how `fill` verifies itself. Exposed because a
   * caller checking the portal's state before advancing is a legitimate thing
   * to want, not only a test convenience.
   */
  public async readValue(locator: FieldLocator): Promise<string> {
    const target = await this.#resolve([locator]);
    const tagName = (await target.evaluate((element) => element.tagName)).toLowerCase();
    if (tagName === "select" || tagName === "input" || tagName === "textarea") {
      return target.inputValue();
    }
    return (await target.textContent()) ?? "";
  }

  /**
   * Fields the portal stored differently from what was typed.
   *
   * Normalisation, usually — and worth a specialist's eye, because it is also
   * what a portal quietly mangling a value looks like.
   */
  public get reformattedFields(): readonly {
    readonly locator: FieldLocator;
    readonly intended: string;
    readonly stored: string;
  }[] {
    return [...this.#reformatted];
  }

  /**
   * Types a reviewed application constant.
   *
   * Shares `#type` with `fill`, so a constant is subject to the same read-back
   * verification — a truncated course code is as wrong as a truncated name.
   */
  public async fillConstant(locator: FieldLocator, text: string): Promise<void> {
    await this.#type(locator, text);
  }

  /**
   * Clicks a control, if the guard permits it.
   *
   * The accessible name is read FIRST and passed to the guard, so a control
   * that reads as a submission is refused even when a blueprint listed it as an
   * advance control.
   */
  public async click(locator: FieldLocator): Promise<void> {
    const target = await this.#resolve([locator]);
    const accessibleName = ((await target.textContent()) ?? "").trim();

    const decision = this.#clickAllowList.decide(locator, accessibleName);
    if (!decision.allowed) throw new ClickRefusedError(decision);

    await target.click();
  }

  /** Attaches a document. The bytes come from the vault; this class never holds one. */
  public async attach(
    locator: FieldLocator,
    documentId: string,
    contents: Uint8Array,
  ): Promise<void> {
    const target = await this.#resolve([locator]);
    await target.setInputFiles({
      name: documentId,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(contents),
    });
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

  // ── Internals ────────────────────────────────────────────────────────────

  /**
   * Finds an element from the blueprint's recorded locators, in order.
   *
   * Throws rather than guessing when none matches. A locator that finds nothing
   * is blueprint drift, and the correct response is to stop and log it (brief
   * §3.2) — not to look around the page for something similar.
   */
  async #resolve(locators: readonly FieldLocator[]): Promise<Locator> {
    const page = this.#requirePage();

    for (const locator of locators) {
      const candidate = toPlaywrightLocator(page, locator);
      if (candidate === null) continue;
      if ((await candidate.count()) > 0) return candidate.first();
    }

    throw new LocatorNotFoundError(locators);
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
 * Translates a blueprint locator into a Playwright one.
 *
 * `role` is encoded as `role:name` in the blueprint (e.g. `button:Continue`),
 * because a role on its own rarely identifies one control.
 */
export function toPlaywrightLocator(page: Page, locator: FieldLocator): Locator | null {
  switch (locator.strategy) {
    case "label":
      return page.getByLabel(locator.value, { exact: false });
    case "placeholder":
      return page.getByPlaceholder(locator.value, { exact: false });
    case "name":
      return page.locator(`[name=${JSON.stringify(locator.value)}]`);
    case "id":
      return page.locator(`#${cssEscape(locator.value)}`);
    case "css":
      return page.locator(locator.value);
    case "role": {
      const [role, ...rest] = locator.value.split(":");
      const name = rest.join(":");
      if (role === undefined || role.length === 0) return null;
      return name.length > 0
        ? page.getByRole(role as Parameters<Page["getByRole"]>[0], { name })
        : page.getByRole(role as Parameters<Page["getByRole"]>[0]);
    }
  }
}

/** Escapes an id for use in a CSS selector. */
function cssEscape(value: string): string {
  return value.replace(/([^\w-])/g, "\\$1");
}
