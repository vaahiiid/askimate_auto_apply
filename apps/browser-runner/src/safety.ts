/**
 * The read-only guard.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-26, authorising Phase 3 discovery:
 *
 *   "Discovery and inspection should remain clearly separated from actual
 *    submission. Do not submit a real application or create a consequential
 *    application for a real student without a further explicit approval."
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * That separation is enforced two ways, because one is not enough for an
 * instruction of this weight:
 *
 *   1. TYPE LEVEL — a `DiscoverySession` has no `fill`, `click` or `submit`
 *      method. There is nothing to call. (See `session.ts`.)
 *
 *   2. NETWORK LEVEL — this file. Every request the browser makes is
 *      intercepted, and in discovery mode anything that is not a safe,
 *      idempotent read is ABORTED before it leaves the machine.
 *
 * The second layer matters because the first is not sufficient on its own. A
 * page's own JavaScript can POST without anyone calling a method: an
 * auto-submitting form, an analytics beacon, a session-registration call on
 * page load. Type safety governs what OUR code does. It says nothing about
 * what THEIR code does. This layer covers that.
 *
 * The failure this prevents is not hypothetical: an application portal that
 * registers a partial application on first page load would create a real
 * record against a real institution, which is exactly what Vahid withheld
 * approval for.
 */

/** HTTP methods that cannot change state on a well-behaved server. */
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/** What the guard decided about one request. */
export interface GuardDecision {
  readonly allowed: boolean;
  readonly method: string;
  readonly url: string;
  readonly reason?: string;
  /**
   * Which rule decided it.
   *
   * Present so a report can separate three different findings that all look
   * like "a request did not happen": the portal tried to POST, the page
   * reached for another host, or robots.txt said no. The first is a discovery
   * about the portal, the third is a fact about our own compliance, and
   * merging them loses both.
   */
  readonly rule?: "method" | "host" | "robots" | "navigation";
}

/**
 * Decides whether a request may proceed in discovery mode.
 *
 * Pure, so the rule is testable without a browser. Deliberately a strict
 * allow-list of methods rather than a block-list: a method nobody thought of is
 * refused, not permitted.
 */
export function decideDiscoveryRequest(method: string, url: string): GuardDecision {
  const normalised = method.toUpperCase();

  if (!SAFE_METHODS.has(normalised)) {
    return {
      allowed: false,
      method: normalised,
      url,
      reason:
        `Discovery mode blocked a ${normalised} request to ${url}. Only safe, idempotent reads ` +
        `are permitted — discovery must not create, modify or submit anything.`,
      rule: "method",
    };
  }

  return { allowed: true, method: normalised, url };
}

/**
 * A record of everything the guard refused.
 *
 * Not merely a log. If discovery finds that a portal tries to POST on page
 * load, that is a genuine and important discovery about the portal — it tells
 * us the site cannot be inspected without side effects, which is something a
 * specialist must know before execution is ever attempted.
 */
export class BlockedRequestLog {
  readonly #blocked: GuardDecision[] = [];

  public record(decision: GuardDecision): void {
    if (!decision.allowed) this.#blocked.push(decision);
  }

  public get entries(): readonly GuardDecision[] {
    return [...this.#blocked];
  }

  public get count(): number {
    return this.#blocked.length;
  }

  /**
   * True when the portal attempted a state-changing request unprompted.
   *
   * ── Corrected in P58 ──────────────────────────────────────────────────
   *
   * This used to be `this.#blocked.length > 0`, which was true when the log
   * held only HOST refusals — a page reaching for a CDN is not the portal
   * attempting a write. It was harmless while the method rule was the only one
   * that fired often, and robots.txt makes it wrong more loudly: a run that
   * skipped one disallowed path would have reported that the portal tried to
   * change state.
   */
  public get portalAttemptedWrite(): boolean {
    return this.#blocked.some((entry) => entry.rule === "method" || entry.rule === undefined);
  }

  /** Refusals by which rule caused them. Three different findings. */
  public byRule(rule: "method" | "host" | "robots" | "navigation"): readonly GuardDecision[] {
    return this.#blocked.filter((entry) => entry.rule === rule);
  }

  /**
   * A summary for the discovery report.
   *
   * Three findings, kept apart. A POST the portal attempted is a fact about
   * the portal; a robots refusal is a fact about our own compliance AND a
   * caveat on the observation, because a page missing a disallowed stylesheet
   * did not render the way an applicant sees it.
   */
  public summarise(): string {
    if (this.#blocked.length === 0) {
      return "No state-changing requests were attempted. The portal was inspected read-only.";
    }

    const lines: string[] = [];

    const writes = this.byRule("method");
    if (writes.length === 0) {
      lines.push("No state-changing requests were attempted. The portal was inspected read-only.");
    } else {
      const byMethod = new Map<string, number>();
      for (const entry of writes) {
        byMethod.set(entry.method, (byMethod.get(entry.method) ?? 0) + 1);
      }
      const breakdown = [...byMethod.entries()]
        .map(([method, n]) => `${method}×${String(n)}`)
        .join(", ");
      lines.push(
        `${String(writes.length)} state-changing request(s) were blocked (${breakdown}). ` +
          `The portal attempts writes during normal browsing, which a specialist must review ` +
          `before any execution run.`,
      );
    }

    const robots = this.byRule("robots");
    if (robots.length > 0) {
      const paths = [...new Set(robots.map((entry) => entry.url))];
      lines.push(
        `${String(robots.length)} request(s) were not made because robots.txt disallows them ` +
          `(${String(paths.length)} distinct URL(s)). THE OBSERVATION MAY BE INCOMPLETE: a page ` +
          `whose stylesheet or script sits under a disallowed path did not render the way an ` +
          `applicant sees it.`,
      );
    }

    const hosts = this.byRule("host");
    if (hosts.length > 0) {
      lines.push(
        `${String(hosts.length)} request(s) went to hosts outside this run's allow-list and were ` +
          `refused. Same caveat: a blocked CDN changes what the page looks like.`,
      );
    }

    return lines.join("\n");
  }
}

/**
 * Hosts a discovery run may talk to.
 *
 * A second containment: even a GET should not wander off to an unrelated
 * domain. Discovery of one university's portal has no business loading another
 * site, and an open-ended crawl is not what was authorised.
 */
export class HostAllowList {
  readonly #allowed: ReadonlySet<string>;

  public constructor(hosts: readonly string[]) {
    this.#allowed = new Set(hosts.map((host) => host.toLowerCase()));
  }

  public permits(url: string): boolean {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      // An unparseable URL is refused. Failing closed is the whole point.
      return false;
    }

    // Exact match, or a subdomain of an allowed host.
    for (const allowed of this.#allowed) {
      if (host === allowed || host.endsWith(`.${allowed}`)) return true;
    }
    return false;
  }

  public get hosts(): readonly string[] {
    return [...this.#allowed];
  }
}

/** The full discovery-mode decision: method AND host. */
export function decideDiscoveryRequestForHost(
  method: string,
  url: string,
  allowList: HostAllowList,
): GuardDecision {
  const methodDecision = decideDiscoveryRequest(method, url);
  if (!methodDecision.allowed) return methodDecision;

  if (!allowList.permits(url)) {
    return {
      allowed: false,
      method: methodDecision.method,
      url,
      reason:
        `Discovery mode blocked a request to ${url}: the host is not on the allow-list for this ` +
        `run (${allowList.hosts.join(", ")}). Discovery is scoped to one target.`,
      rule: "host",
    };
  }

  return methodDecision;
}

/**
 * The guard, with robots.txt in front of it.
 *
 * ── Applied to EVERY request, not only to navigations ─────────────────────
 *
 * A page's own CSS, scripts and images are fetches this crawler makes, and RFC
 * 9309 is about what a crawler fetches. Exempting them would be the convenient
 * reading, and the convenient reading is the one that is hard to defend when
 * somebody asks.
 *
 * It has a cost, and the cost is recorded rather than hidden: a page whose
 * stylesheet sits under a disallowed path renders unstyled, so the OBSERVATION
 * may not be what an applicant sees. `blockedRequests()` separates robots
 * refusals from the other two so a report can say exactly that.
 *
 * Order matters. Method first, because a POST the portal attempts is a finding
 * about the portal whether or not robots.txt would also have stopped it, and
 * reporting it as "robots said no" would lose the more important fact.
 */
export function decideDiscoveryRequestWithRobots(
  method: string,
  url: string,
  allowList: HostAllowList,
  robots: (url: string) => { readonly allowed: boolean; readonly reason: string },
): GuardDecision {
  const decision = decideDiscoveryRequestForHost(method, url, allowList);
  if (!decision.allowed) return decision;

  const verdict = robots(url);
  if (verdict.allowed) return decision;

  return { allowed: false, method: decision.method, url, reason: verdict.reason, rule: "robots" };
}

/**
 * How many requests a run actually made, and of what kind.
 *
 * ── Why this had to be built before it could be reported ─────────────────
 *
 * `docs/target-sheffield-pgt.md` said a 45-page run was *"plausibly 1,500–4,000
 * GETs"* and said plainly that this repository had never measured it. Vahid,
 * 2026-09-08: *"Measure the sub-resource count on that run and report it. You
 * said the number has never been measured; measure it while it is small and
 * safe to measure."*
 *
 * `maxPages` bounds NAVIGATIONS. Nothing bounded the CSS, scripts, images and
 * fonts each page pulls, and nothing counted them — so the only honest thing
 * to say about the real cost of a run was that we did not know.
 */
export class RequestTally {
  #navigations = 0;
  #subResources = 0;
  #blocked = 0;
  readonly #byType = new Map<string, number>();

  public record(resourceType: string, allowed: boolean): void {
    if (!allowed) {
      this.#blocked += 1;
      return;
    }
    // Playwright calls a top-level navigation "document"; everything else is a
    // sub-resource, including the iframes a page embeds.
    if (resourceType === "document") this.#navigations += 1;
    else this.#subResources += 1;
    this.#byType.set(resourceType, (this.#byType.get(resourceType) ?? 0) + 1);
  }

  public get navigations(): number {
    return this.#navigations;
  }

  public get subResources(): number {
    return this.#subResources;
  }

  public get blocked(): number {
    return this.#blocked;
  }

  public get total(): number {
    return this.#navigations + this.#subResources;
  }

  /** Counts by Playwright resource type, largest first. */
  public get byType(): readonly (readonly [string, number])[] {
    return [...this.#byType.entries()].sort((a, b) => b[1] - a[1]);
  }

  public summarise(): string {
    if (this.total === 0 && this.#blocked === 0) return "No requests were made.";
    const perPage =
      this.#navigations === 0 ? "—" : (this.#subResources / this.#navigations).toFixed(1);
    const breakdown = this.byType.map(([type, n]) => `${type} ${String(n)}`).join(", ");
    return (
      `${String(this.total)} request(s) were made: ${String(this.#navigations)} navigation(s) and ` +
      `${String(this.#subResources)} sub-resource(s) — ${perPage} per page. ` +
      `${String(this.#blocked)} were refused before leaving the machine.\n` +
      `  by type: ${breakdown}`
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// What the page asked the portal while a box was being filled (P179)
// ───────────────────────────────────────────────────────────────────────────

/**
 * One same-host GET the page made, as much of it as the runner may repeat.
 *
 * ── The boundary, and why it is drawn here ────────────────────────────────
 *
 * The PATH is the portal's own, and naming it is what makes a lookup
 * actionable. The QUERY is not: on this portal the institution search carries
 * `?name=…`, which is whatever was typed into the box — a reviewed constant
 * for one field and the student's own answer for the next. So the query is
 * reduced to the shape it has: each parameter's NAME, and whether it arrived
 * with anything in it. That answers "did the country reach the search?"
 * without printing a single value.
 *
 * The ANSWER is the portal's: a status, and a count when the body is a list.
 * Never the entries themselves — the runner has no way to know that an
 * institution list is not, on some other portal, a list of the student's own
 * saved answers.
 */
export interface LookupRecord {
  readonly method: string;
  /** Path only. The query is next, in shape. */
  readonly path: string;
  readonly params: readonly { readonly name: string; readonly empty: boolean }[];
  readonly status: number;
  /**
   * What came back, in the runner's words: `"7 entries"` when the body is a
   * JSON list, and otherwise why it is not counted — `"not json"`,
   * `"not a list"`, `"not read"`, `"too large to count"`.
   */
  readonly answer: string;
}

/**
 * The last few lookups, so a box that found nothing can say what the page
 * asked for and what came back.
 *
 * Bounded on purpose: this holds responses from a live portal in memory, and
 * an unbounded log of them on a page that polls would grow without limit.
 * `mark()` and `since()` scope it to one box's fill — everything else on the
 * page is somebody else's business.
 */
export class LookupLog {
  readonly #entries: LookupRecord[] = [];
  readonly #ceiling: number;

  public constructor(ceiling = 50) {
    this.#ceiling = ceiling;
  }

  public record(entry: LookupRecord): void {
    this.#entries.push(entry);
    if (this.#entries.length > this.#ceiling) this.#entries.shift();
  }

  /** Where the log stands now. */
  public mark(): number {
    return this.#entries.length;
  }

  /** What was recorded after a mark — capped, because a line is read by a person. */
  public since(mark: number, most = 5): readonly LookupRecord[] {
    return this.#entries.slice(Math.max(mark, 0)).slice(0, most);
  }

  public get count(): number {
    return this.#entries.length;
  }
}

/** One lookup, in the words the runner is allowed. */
export function lookupInWords(entry: LookupRecord): string {
  const query =
    entry.params.length === 0
      ? ""
      : `?${entry.params.map((param) => `${param.name}=${param.empty ? "(empty)" : "(set)"}`).join("&")}`;
  return `${entry.method} ${entry.path}${query} → ${String(entry.status)}, ${entry.answer}`;
}

/**
 * What the page asked while a box was being filled, for a failure's own words.
 *
 * The no-request case is the one worth reading twice: a box that found nothing
 * and a page that asked nothing are a different fault from a box that found
 * nothing because the portal answered with nothing.
 *
 * ── Why every sentence here names GET (P181) ──────────────────────────────
 *
 * The watcher that fills this log records GET and nothing else. Until P181 the
 * no-request sentence read *"the page made NO request of its own to the
 * portal"*, and that is a claim about every method the log never sees. It was
 * printed to Vahid on attempt 6 about a page whose one lookup we DO hold the
 * shape of — `POST …/getGradingSystemsForCountry.do?institutionCode=&…`, a
 * read whose parameters travel in the query string — so the sentence was
 * asserting the absence of exactly the kind of request it cannot see.
 *
 * A wrong label is worse than none. These words now say GET, and say that the
 * rest is unwatched, until the watcher covers the rest (blocker 52).
 */
export function lookupsInWords(entries: readonly LookupRecord[]): string {
  if (entries.length === 0) {
    return (
      `While this box was being filled the page made NO GET request of its own to the portal. ` +
      `Requests by any other method are not watched, so this says nothing about them.`
    );
  }
  return (
    `While this box was being filled the page asked the portal ` +
    `${entries.length === 1 ? "once" : `${String(entries.length)} times`} by GET ` +
    `(other methods are not watched): ${entries.map(lookupInWords).join("; ")}.`
  );
}
