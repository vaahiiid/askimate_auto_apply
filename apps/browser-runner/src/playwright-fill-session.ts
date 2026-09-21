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
import type { TypeaheadEntries } from "@askimate/aas-execution";
import type { ConfirmedValue } from "@askimate/aas-domain";
import { unwrapConfirmed } from "@askimate/aas-domain";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { chromium } from "playwright";

import { toPlaywrightLocator } from "@askimate/aas-browser-fill";

import { OBSERVE_SCRIPT } from "./observe-script.js";
import type { ClickDecision } from "./preparation-safety.js";
import {
  ClickAllowList,
  HostAllowList,
  WriteLog,
  decidePreparationRequest,
  isStateChanging,
  looksLikeSubmission,
} from "./preparation-safety.js";
import type { LookupRecord } from "./safety.js";
import { BlockedRequestLog, LookupLog, lookupsInWords } from "./safety.js";
import type { RedactedValue } from "./sensitive.js";
import { openSensitiveContext, redact, sameRedacted } from "./sensitive.js";
import { detectChallenge, type Challenge } from "./challenge.js";
import type { FillableSession, PageObservation, SessionMode } from "./session.js";

/** How a preparation session is configured. */
export interface PreparationMode extends SessionMode {
  readonly capability: "fillable";
  /** Controls this run may click. Everything else is refused. */
  readonly clickableControls: readonly FieldLocator[];
  /** Submission endpoints, where the blueprint records them. */
  readonly forbiddenEndpoints?: readonly string[];
  /**
   * The floor between this session's navigations, in milliseconds (ADR-0091
   * decision 2: nothing may lower it; a site's Crawl-delay may raise it).
   */
  readonly pace?: { readonly minimumMs: number };
}

/** A navigation the portal's robots.txt disallows (P135). */
export class RobotsDisallowedError extends Error {
  public override readonly name = "RobotsDisallowedError";
  public constructor(public readonly url: string, reason: string) {
    super(reason);
  }
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
  /** Shapes, not values. An error object gets logged, serialised and reported. */
  public readonly intended: RedactedValue;
  public readonly stored: RedactedValue;

  public constructor(locator: FieldLocator, intended: string, stored: string) {
    super(
      stored.length === 0
        ? `The portal did not accept a value for ${locator.strategy}="${locator.value}". The ` +
            `field is still empty.`
        : `The portal truncated ${locator.strategy}="${locator.value}" from ` +
            `${String(intended.length)} characters to ${String(stored.length)}. Submitting the ` +
            `shortened version would submit something the student did not write.`,
    );
    this.locator = locator;
    this.intended = redact(intended);
    this.stored = redact(stored);
  }

  public readonly locator: FieldLocator;
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
  public readonly locator: FieldLocator;
  /** The student's answer, redacted. Nationality and country of birth are personal data. */
  public readonly wanted: RedactedValue;
  /** The portal's own list. Not the student's data, so kept in full. */
  public readonly available: readonly { readonly value: string; readonly label: string }[];

  /**
   * What the page asked the portal while this box was being filled (P179).
   *
   * `undefined` and `[]` are DIFFERENT and the distinction is the point:
   * `undefined` means nobody was watching, so the line says nothing about
   * requests; `[]` means somebody was, and the page asked for nothing. A
   * default of `[]` would have made every caller that does not watch assert
   * that the portal was never asked — which is the class of claim this
   * repository exists to refuse.
   */
  public readonly lookups: readonly LookupRecord[] | undefined;

  public constructor(
    locator: FieldLocator,
    wanted: string,
    available: readonly { readonly value: string; readonly label: string }[],
    lookups?: readonly LookupRecord[],
  ) {
    // The wanted value is NOT in the message. It is the student's answer —
    // a nationality, a country of birth — and this message goes into logs,
    // escalations and specialist reports. The portal's own option list is the
    // portal's, and naming it is what makes the error actionable.
    //
    // ── And, when the list is EMPTY, what the page asked for (P179) ───────
    //
    // Attempt 5 on the first real form: `It offers: .` — nothing, and the
    // line stopped there. An empty list has at least four causes on this
    // portal's record (blocker 49) and the option list cannot separate them,
    // because the difference is in what the page asked and what came back.
    // Vahid, 2026-09-21: *"make the next failure line say … what the country
    // box holds at that moment, whether a request to search.app went out, and
    // what it answered — status and entry count, never the entries' text."*
    //
    // `lookupsInWords` is where that boundary is drawn: paths in full,
    // parameters by name and whether they arrived empty, the answer as a
    // status and a count. The query's VALUES never appear — on this box one
    // of them is the text the reviewer recorded, and on the next box it would
    // be the student's own answer.
    super(
      `The portal's "${locator.value}" list does not offer the confirmed value ` +
        `(${String(wanted.length)} characters). It offers: ` +
        `${available.map((option) => `${option.value} (${option.label})`).join(", ")}. ` +
        `${lookups === undefined ? "" : `${lookupsInWords(lookups)} `}` +
        `The mapping is out of step with the portal and a specialist must review it — the ` +
        `nearest option is not chosen.`,
    );
    this.locator = locator;
    this.wanted = redact(wanted);
    this.available = available;
    this.lookups = lookups;
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

/**
 * How long a list the portal fills after another field may take to offer the
 * option the fill was told to select (ADR-0103, gap 1). One server round trip
 * on a slow day, with room; not a retry loop.
 */
const OPTION_WAIT_MS = 5_000;

/**
 * Between keystrokes when typing into a typeahead (P180).
 *
 * Under Tom Select's 300 ms `loadThrottle` on purpose, so that one box costs
 * the portal one lookup rather than one per character — the same as a person
 * typing at speed. Not zero: a burst with no gap is not what any page was
 * built for, and the pacing rule this repository follows is about being an
 * ordinary visitor rather than a fast one.
 */
const TYPING_DELAY_MS = 50;

/**
 * Records what the PAGE fetched from the portal, in shape (P179).
 *
 * ── Why a response listener and not the route guard ───────────────────────
 *
 * The guard sees requests before they go and decides whether they may; it
 * cannot see what came back. The question a box that found nothing raises is
 * exactly about what came back, so this listens for the answers.
 *
 * Read-only and bounded, in that order:
 *
 *   - **same host only.** Another host's answer is not this portal's, and the
 *     allow-list has already refused most of them;
 *   - **GET only.** A write was to be `#writes`'s business, and this about
 *     lookups. **P181 found that division does not hold on the path a
 *     deployed run takes:** `#writes` is fed by the route handler that only
 *     `open()` installs, and production attaches to a held context instead —
 *     see the P181 block at the top of ./preparation-safety.ts. So a non-GET
 *     the page makes during a real fill is recorded NOWHERE, and this log's
 *     silence is not evidence that none was made. The words this feeds now
 *     say GET (`lookupsInWords`); widening the watcher is blocker 52;
 *   - **the body is read only to COUNT it**, only when the portal says it is
 *     JSON, and only under a ceiling. Nothing of the body is kept: not the
 *     entries, not a sample, not the first characters. A count of a list and
 *     a status are the whole record.
 *
 * Every failure here is swallowed: a diagnostic that can break a fill is
 * worse than no diagnostic. A body that cannot be read is recorded as
 * `not read`, which is itself worth knowing.
 */
const COUNTABLE_BODY_BYTES = 262_144;

function watchLookups(page: Page, log: LookupLog): void {
  page.on("response", (response) => {
    void (async () => {
      const request = response.request();
      if (request.method().toUpperCase() !== "GET") return;
      const here = safeUrl(page.url());
      const asked = safeUrl(response.url());
      if (here === null || asked === null || here.host !== asked.host) return;
      log.record({
        method: request.method().toUpperCase(),
        path: asked.pathname,
        params: [...asked.searchParams].map(([name, value]) => ({
          name,
          empty: value.trim().length === 0,
        })),
        status: response.status(),
        answer: await answerShape(response),
      });
    })().catch(() => undefined);
  });
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** A status and a count, or why there is no count. Never the body itself. */
async function answerShape(response: {
  headers: () => Record<string, string>;
  body: () => Promise<Buffer>;
}): Promise<string> {
  const type = (response.headers()["content-type"] ?? "").toLowerCase();
  if (!type.includes("json")) return "not json";
  let body: Buffer;
  try {
    body = await response.body();
  } catch {
    return "not read";
  }
  if (body.byteLength > COUNTABLE_BODY_BYTES) return "too large to count";
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return "not json";
  }
  // A top-level list is the shape this portal's lookups answer with. Anything
  // else is reported as not a list rather than guessed at: counting a key of
  // an object nobody has read would be an invention about the portal.
  return Array.isArray(parsed) ? `${String(parsed.length)} entries` : "not a list";
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class PlaywrightPreparationSession implements FillableSession {
  #lastNavigationAt: number | null = null;
  readonly #allowList: HostAllowList;
  readonly #clickAllowList: ClickAllowList;
  readonly #writes = new WriteLog();
  readonly #reformatted: {
    readonly locator: FieldLocator;
    readonly intended: RedactedValue;
    readonly stored: RedactedValue;
  }[] = [];
  readonly #blocked = new BlockedRequestLog();
  /**
   * What the PAGE asked the portal, for a box that found nothing (P179).
   *
   * Separate from `#blocked` and `#writes`, which record what the guard
   * refused and what we sent. This records what the page fetched and what came
   * back, in shape only — see `LookupRecord` for where that line is drawn.
   */
  readonly #lookups = new LookupLog();
  #browser: Browser | null = null;
  #context: BrowserContext | null = null;
  #page: Page | null = null;
  #shotCount = 0;

  private constructor(private readonly mode: PreparationMode) {
    this.#allowList = new HostAllowList(mode.allowedHosts);
    this.#clickAllowList = new ClickAllowList(mode.clickableControls);
  }

  /**
   * A session over a page that already exists, and a context this does not own.
   *
   * ═════════════════════════════════════════════════════════════════════════
   * ADR-0046. The application form is behind a login: creating the account
   * signed the student in, and the context holding that cookie is the only
   * session the run has. `open` launches its own browser and would arrive
   * logged out — with no way back, because the password was single-use.
   *
   * So the caller supplies the page. Everything else is identical: the same
   * `#type`, the same option check, the same read-back that catches a portal
   * silently truncating a personal statement. A caller that hand-rolled an
   * `ApplicationSession` over a page would lose all three, which is what the
   * first version of the end-to-end journey did — and it typed "IR" into a
   * `<select>` and failed.
   * ═════════════════════════════════════════════════════════════════════════
   *
   * `close()` closes nothing here. The context belongs to whoever opened it.
   */
  public static attach(
    page: Page,
    mode: Omit<PreparationMode, "traceDir">,
  ): PlaywrightPreparationSession {
    const session = new PlaywrightPreparationSession({ ...mode, traceDir: "" });
    session.#page = page;
    watchLookups(page, session.#lookups);
    return session;
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
    // A SENSITIVE context: no video, no tracing, and tracing made unavailable
    // rather than merely left off. This session fills passport numbers, dates
    // of birth, addresses and personal statements, and Playwright writes typed
    // values verbatim into trace.trace — see ./sensitive.ts for the evidence
    // and for why stopping tracing around the fill does not help.
    session.#context = await openSensitiveContext(session.#browser, {
      // Identifies honestly, as discovery does. A run that fills a real
      // application has even less business pretending to be something else.
      userAgent:
        "Mozilla/5.0 (compatible; AskiMate-AAS-Preparation/0.1; +https://askimate.com/bot) " +
        "application preparation — does not submit",
    });

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
      // Applied to every request, not only to navigations (ADR-0091, P135):
      // a script or a stylesheet under a disallowed path is not fetched.
      const robots = mode.robots?.(request.url());
      if (robots !== undefined && !robots.allowed) {
        session.#blocked.record({ allowed: false, method: request.method(), url: request.url(), reason: robots.reason });
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
    watchLookups(session.#page, session.#lookups);
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
    // The portal's robots.txt, as the gate read it before the browser opened
    // (P135): a navigation the file disallows is refused here as well as at
    // the gate — two places, deliberately (ADR-0091). `SessionMode.robots`
    // is the same decider the discovery session's guard runs.
    const robots = this.mode.robots?.(url);
    if (robots !== undefined && !robots.allowed) throw new RobotsDisallowedError(url, robots.reason);
    // The floor between navigations (P135): the wait is the remainder of the
    // pace since the last one, and the first navigation waits for nothing.
    const pace = this.mode.pace;
    if (pace !== undefined && this.#lastNavigationAt !== null) {
      const remaining = pace.minimumMs - (this.#now().getTime() - this.#lastNavigationAt);
      if (remaining > 0) await new Promise((done) => setTimeout(done, remaining));
    }
    this.#lastNavigationAt = this.#now().getTime();
    await this.#requirePage().goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  /**
   * Whether the current page asks for something only a person can pass
   * (ADR-0101 §6). The fill path's `ChallengeProbe`; reads the page and
   * changes nothing.
   */
  public async challenge(): Promise<Challenge | null> {
    return await detectChallenge(this.#requirePage());
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

  public html(): Promise<string> {
    return this.#requirePage().content();
  }

  /**
   * A screenshot with every input, textarea and select MASKED.
   *
   * The layout, the error banners and the page state are what a specialist
   * needs from a screenshot of a part-filled form. The values are not, and an
   * unmasked shot of this page is a picture of somebody's passport number.
   *
   * Masking is Playwright's own, applied at capture time, so the values never
   * reach the PNG rather than being painted over afterwards.
   */
  public async screenshot(name: string): Promise<string> {
    this.#shotCount += 1;
    const file = join(
      this.mode.traceDir,
      `${String(this.#shotCount).padStart(3, "0")}-${name.replace(/[^a-z0-9-]/gi, "_")}.png`,
    );
    const page = this.#requirePage();
    await page.screenshot({
      path: file,
      fullPage: true,
      mask: await page.locator("input, textarea, select").all(),
      maskColor: "#334155",
    });
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

  public async fillTypeahead(locator: FieldLocator, entries: TypeaheadEntries, value: ConfirmedValue<string>): Promise<void> {
    await this.#chooseTypeahead(locator, entries, unwrapConfirmed(value));
  }

  public async fillTypeaheadConstant(locator: FieldLocator, entries: TypeaheadEntries, value: string): Promise<void> {
    await this.#chooseTypeahead(locator, entries, value);
  }

  /**
   * A typeahead (ADR-0103, gap 2; ADR-0109): type the text the reviewer
   * recorded for the value, wait — bounded — for the ONE entry that reads
   * exactly that text AND carries the value the form submits, choose it.
   *
   * The Tom Select boxes on the first real form: the visible input searches,
   * the entries appear beneath it with a `data-value` each, and the
   * `<select>` behind is set by the choice. Vahid, 2026-09-13: *"the mapping
   * names the value AND the reviewer records the text it reads as, and both
   * must match at the fill."* Two entries that read the same — his
   * *Sheffield International College* twice — are told apart by value. Four
   * refusals, nothing chosen in any: the value is the form's escape (by
   * value, whatever the text — on that form the escape's value is its own
   * label); no entry reads the text and carries the value; more than one
   * does; or the entry reads as a submission control. The click is not an
   * advance and the allow-list is not consulted for it, because the entry is
   * the answer, not a control.
   */
  async #chooseTypeahead(locator: FieldLocator, entries: TypeaheadEntries, value: string): Promise<void> {
    if (entries.escapeValue !== undefined && value === entries.escapeValue) {
      throw new ClickRefusedError({
        allowed: false,
        locator: entries.optionLocator,
        reason: `Refusing to choose the form's escape entry: a student whose answer is not listed is a handoff, not a match (ADR-0109).`,
      });
    }
    const box = await this.#resolve([locator]);
    // Marked BEFORE anything is typed, so what follows is this box's own
    // lookups and not the page's load (P179).
    const askedFrom = this.#lookups.mark();
    // ── Typed KEY BY KEY, not set in one act (P180) ────────────────────
    //
    // Measured by Vahid on the live form, 2026-09-21: typing `sheff` by hand
    // opened the list with all eleven entries at once; the runner's fill
    // asked the portal nothing at all — which P179's line is what showed.
    //
    // The reason is in Tom Select's own source, and it is a version fork:
    // 1.x binds `keyup` (`tom-select.ts:317` in 1.7.8) and has no `input`
    // listener, while 2.x binds `input` instead (2.0.0 onwards). Playwright's
    // `fill` sets `.value` and dispatches ONE `input` event, so on a 1.x page
    // nothing runs: no `load()`, no `refreshOptions()`. Which version this
    // portal ships is not established — no capture holds its scripts — but
    // typing satisfies BOTH, because a keystroke fires `keydown`, `keypress`,
    // `input` and `keyup`.
    //
    // It costs the portal no more than a person does: Tom Select debounces
    // the user's `load` by `loadThrottle` (300 ms, a trailing debounce in
    // `loadDebounce`), so a burst of keystrokes under that interval is ONE
    // request, fired once the typing stops.
    //
    // Cleared first, because a retry on the same page meets a box that still
    // holds the last attempt's text.
    await box.fill("");
    await box.pressSequentially(entries.text, { delay: TYPING_DELAY_MS });

    const page = this.#requirePage();
    const offered = toPlaywrightLocator(page, entries.optionLocator);
    if (offered === null) throw new LocatorNotFoundError([entries.optionLocator]);
    const exact = offered
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(entries.text)}\\s*$`) })
      .and(page.locator(`[data-value="${cssEscape(value)}"]`));

    // Bounded by attempts, not by a clock: the session's clock is injectable
    // and a test's may stand still.
    let matches = await exact.count();
    for (let attempt = 0; matches !== 1 && attempt < OPTION_WAIT_MS / 100; attempt++) {
      await page.waitForTimeout(100);
      matches = await exact.count();
    }
    if (matches !== 1) {
      const shown = await offered.evaluateAll((elements) =>
        elements.map((element) => ({ value: (element.getAttribute("data-value") ?? "").trim(), label: (element.textContent ?? "").trim() })),
      );
      throw new OptionNotAvailableError(locator, value, shown, this.#lookups.since(askedFrom));
    }
    if (looksLikeSubmission(entries.text)) {
      throw new ClickRefusedError({
        allowed: false,
        locator: entries.optionLocator,
        reason: `Refusing to choose a typeahead entry that reads as a submission control.`,
      });
    }
    await exact.first().click();
  }

  /**
   * Waits, bounded, for a list to offer `value` (ADR-0103, gap 1).
   *
   * The education chain on the first real form: an institution's grading
   * systems arrive after the institution is chosen and the server has
   * answered. Fill order already put the earlier field first; this is the
   * wait, and it is for ONE named option — the one the reviewer saw — not for
   * "the list to change". When the bound passes the error names what the
   * list offered, so the review can see whether the option moved or the list
   * never loaded.
   */
  public async awaitOption(locator: FieldLocator, value: string): Promise<void> {
    const target = await this.#resolve([locator]);
    const tagName = (await target.evaluate((element) => element.tagName)).toLowerCase();
    const type = tagName === "select" ? "select" : await target.getAttribute("type");

    const wanted =
      type === "select"
        ? target.locator(`option[value="${cssEscape(value)}"]`)
        : type === "radio"
          ? target
              .page()
              .locator(
                `input[type="radio"][name="${cssEscape((await target.getAttribute("name")) ?? "")}"][value="${cssEscape(value)}"]`,
              )
          : null;
    if (wanted === null) {
      throw new OptionNotAvailableError(locator, value, []);
    }
    try {
      await wanted.first().waitFor({ state: "attached", timeout: OPTION_WAIT_MS });
    } catch {
      const available =
        type === "select"
          ? await target.evaluate((element) =>
              [...(element as HTMLSelectElement).options].map((option) => ({
                value: option.value,
                label: option.textContent ?? "",
              })),
            )
          : await target
              .page()
              .locator(`input[type="radio"][name="${cssEscape((await target.getAttribute("name")) ?? "")}"]`)
              .evaluateAll((elements) =>
                elements.map((element) => ({ value: (element as HTMLInputElement).value, label: "" })),
              );
      throw new OptionNotAvailableError(locator, value, available);
    }
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
    if (type === "radio") {
      // P93: a radio GROUP is found by name and set by VALUE — the option
      // whose value is the text, and no other, the case the portal's.
      //
      // P110: the VALUE is tried first, always. The old rule read "yes" as
      // "tick this radio" — a boolean — before looking at values, and on a
      // group that SUBMITS "yes" / "no" (Sheffield's nationality.do has
      // twelve, read by Vahid on 2026-09-12) it ticked whichever member the
      // locator resolved to first. "true" / "on" / "yes" tick a LONE radio,
      // as before; on a group they must be a value the group offers.
      const name = await target.getAttribute("name");
      const members = target.page().locator(`input[type="radio"][name="${cssEscape(name ?? "")}"]`);
      const group = target
        .page()
        .locator(`input[type="radio"][name="${cssEscape(name ?? "")}"][value="${cssEscape(text)}"]`);
      if ((await group.count()) === 0) {
        if ((text === "true" || text === "yes" || text === "on") && (await members.count()) <= 1) {
          await target.check();
          return;
        }
        const available = await target
          .page()
          .locator(`input[type="radio"][name="${cssEscape(name ?? "")}"]`)
          .evaluateAll((elements) =>
            elements.map((element) => ({ value: (element as HTMLInputElement).value, label: "" })),
          );
        throw new OptionNotAvailableError(locator, text, available);
      }
      await group.first().check();
      return;
    }
    if (type === "checkbox") {
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
    if (!sameRedacted(redact(stored), redact(text))) {
      // Shapes, not values. A specialist needs to know THAT the portal changed
      // something and by how much; the characters are the student's.
      this.#reformatted.push({ locator, intended: redact(text), stored: redact(stored) });
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
    if (tagName === "input" && (await target.getAttribute("type")) === "radio") {
      // P93: what a radio group holds is the value of its CHECKED member, or
      // nothing — not the value attribute of whichever input matched first.
      const name = await target.getAttribute("name");
      const checked = target.page().locator(`input[type="radio"][name="${cssEscape(name ?? "")}"]:checked`);
      return (await checked.count()) === 0 ? "" : checked.first().inputValue();
    }
    if (tagName === "select" || tagName === "input" || tagName === "textarea") {
      return target.inputValue();
    }
    return (await target.textContent()) ?? "";
  }

  /**
   * How many elements a locator matches now (ADR-0106): a listing's entries,
   * or the marker a held file shows. Zero, never a throw, when nothing does —
   * "not there" is the answer the caller is asking for.
   */
  public async count(locator: FieldLocator): Promise<number> {
    const target = toPlaywrightLocator(this.#requirePage(), locator);
    return target === null ? 0 : await target.count();
  }

  /**
   * Fields the portal stored differently from what was typed.
   *
   * Normalisation, usually — and worth a specialist's eye, because it is also
   * what a portal quietly mangling a value looks like.
   */
  public get reformattedFields(): readonly {
    readonly locator: FieldLocator;
    readonly intended: RedactedValue;
    readonly stored: RedactedValue;
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
      // No trace to write. `stop` is a no-op on a sensitive context, and
      // calling it would produce nothing; not calling it is clearer.
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

// `toPlaywrightLocator` used to live here. ADR-0042 moved it to
// @askimate/aas-browser-fill, because the Secure Plane's fill agent resolves
// the same blueprint locators from a different process and two copies of that
// logic would eventually disagree about which element a blueprint meant.
export { toPlaywrightLocator } from "@askimate/aas-browser-fill";

/** Escapes a value for use inside a CSS attribute selector's quotes. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, (character) => `\\${character}`);
}
