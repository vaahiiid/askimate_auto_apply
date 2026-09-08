/**
 * robots.txt: read it, obey it, and keep what it said.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-09-08, as a precondition on any run against a live site:
 *
 *   "Read and obey robots.txt. Not because a crawl of public pages is
 *    necessarily forbidden, but because the difference between 'we respected
 *    the rules' and 'we did not look' is the whole difference if anyone ever
 *    asks."
 *
 * That sentence shapes the design more than the parsing does. Obeying is half
 * of it; the other half is that a run must be able to SHOW what the file said,
 * when it was fetched, and which requests it stopped. A crawler that quietly
 * complies leaves no evidence that it complied.
 *
 * So `RobotsPolicy` keeps the raw text, the fetch time and the status, and
 * every refusal it produces is recorded as a finding beside the method and
 * host refusals that were already there.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What is implemented, and what is deliberately not ─────────────────────
 *
 * RFC 9309, the parts that bear on a read-only crawl of a university site:
 * user-agent groups, `Allow`, `Disallow`, longest-match-wins with `Allow`
 * breaking a tie, `*` and `$` wildcards, and the unavailability rules.
 *
 * NOT implemented: `Sitemap` (this crawl follows seeds and links, and a
 * sitemap would widen it beyond what the target file authorises), and caching
 * across runs (a run is short and a fresh read is the honest one).
 *
 * `Crawl-delay` is not in RFC 9309 and is honoured anyway — see `crawlDelayMs`.
 */

/** What a robots.txt fetch produced, and what follows from it. */
export type RobotsPolicy =
  | {
      readonly kind: "fetched";
      readonly host: string;
      readonly fetchedAt: Date;
      readonly statusCode: number;
      /** Kept verbatim. The evidence, not a summary of it. */
      readonly body: string;
      readonly groups: readonly RobotsGroup[];
      /** The group that applies to us, already selected. */
      readonly applicable: RobotsGroup | null;
    }
  | {
      /**
       * 404 or another 4xx: there are no rules, so everything is allowed.
       *
       * RFC 9309 §2.3.1.3. "Unavailable" and "absent" are different facts and
       * this is the second one — the site has told us there is no policy.
       */
      readonly kind: "absent";
      readonly host: string;
      readonly fetchedAt: Date;
      readonly statusCode: number;
    }
  | {
      /**
       * 5xx, a network failure, or a timeout: NOTHING is allowed.
       *
       * RFC 9309 §2.3.1.4 calls this "unavailable" and says a crawler should
       * assume complete disallow. It is also the only reading that satisfies
       * the instruction this file exists for: a run that could not read the
       * rules has not respected them, and proceeding anyway is exactly the
       * "we did not look" this is meant to make impossible.
       */
      readonly kind: "unavailable";
      readonly host: string;
      readonly fetchedAt: Date;
      readonly statusCode: number | null;
      readonly error: string;
    };

export interface RobotsRule {
  readonly kind: "allow" | "disallow";
  /** The path pattern as written, `*` and `$` included. */
  readonly pattern: string;
}

export interface RobotsGroup {
  /** Lowercased user-agent tokens this group applies to. */
  readonly agents: readonly string[];
  readonly rules: readonly RobotsRule[];
  /** Seconds, as the file states it. Non-standard and honoured anyway. */
  readonly crawlDelaySeconds: number | null;
}

/**
 * The token we match `User-agent` lines against.
 *
 * The product token from our own user-agent string, lowercased. Discovery
 * identifies itself honestly (brief §7) and this is the other end of that: if
 * a site writes a rule naming us, it applies.
 */
export const ROBOTS_AGENT_TOKEN = "askimate-aas-discovery";

/**
 * Parses robots.txt into groups.
 *
 * Tolerant in the ways the format requires and strict in the ways that matter:
 * an unrecognised field is ignored (the format is extensible), a line with no
 * colon is ignored, comments are stripped — but a `Disallow` that fails to
 * parse is never silently dropped, because there is no such thing here: every
 * value is a path pattern, including the empty one, which means "allow all".
 */
export function parseRobots(body: string): readonly RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let crawlDelaySeconds: number | null = null;
  /** True while consecutive `User-agent` lines are still accumulating. */
  let collectingAgents = false;

  const flush = (): void => {
    if (agents.length > 0) {
      groups.push({ agents: [...agents], rules: [...rules], crawlDelaySeconds });
    }
    agents = [];
    rules = [];
    crawlDelaySeconds = null;
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (line.length === 0) continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;

    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      // A new `User-agent` after rules have started begins a NEW group. Two
      // agent lines in a row belong to the SAME group — that is how a file
      // says "these two agents, same rules", and treating them as separate
      // groups would give the second one an empty rule set.
      if (!collectingAgents && (rules.length > 0 || crawlDelaySeconds !== null)) flush();
      collectingAgents = true;
      if (value.length > 0) agents.push(value.toLowerCase());
      continue;
    }

    collectingAgents = false;
    if (field === "allow" || field === "disallow") {
      rules.push({ kind: field, pattern: value });
    } else if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) crawlDelaySeconds = seconds;
    }
  }
  flush();
  return groups;
}

/**
 * Chooses the group that applies to us.
 *
 * RFC 9309 §2.2.1: the most specific match wins, and `*` is the fallback.
 * "Most specific" is the longest matching token, so a file naming
 * `askimate-aas-discovery` beats one naming `askimate` beats `*`.
 *
 * A file with rules for other crawlers and no `*` group applies to us not at
 * all, which is `null` — and `null` means allowed, because there are no rules
 * addressed to us. That is not the same as "no robots.txt", and the two are
 * kept distinct so a report can say which.
 */
export function groupFor(
  groups: readonly RobotsGroup[],
  agentToken: string = ROBOTS_AGENT_TOKEN,
): RobotsGroup | null {
  let best: RobotsGroup | null = null;
  let bestLength = -1;
  for (const group of groups) {
    for (const agent of group.agents) {
      const matches = agent === "*" || agentToken.startsWith(agent);
      if (!matches) continue;
      const length = agent === "*" ? 0 : agent.length;
      if (length > bestLength) {
        best = group;
        bestLength = length;
      }
    }
  }
  return best;
}

/** Turns a robots path pattern into a regex, honouring `*` and `$`. */
function patternToRegex(pattern: string): RegExp {
  const anchoredEnd = pattern.endsWith("$");
  const body = anchoredEnd ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}${anchoredEnd ? "$" : ""}`);
}

/**
 * The length a rule matched by, or -1 for no match.
 *
 * Length is measured on the PATTERN, not the path, because that is what RFC
 * 9309's "most specific" means: `/a/b/` is more specific than `/a/`, and both
 * match the same URL.
 */
function matchLength(rule: RobotsRule, path: string): number {
  // An empty `Disallow:` means "nothing is disallowed" and matches nothing.
  if (rule.pattern.length === 0) return -1;
  return patternToRegex(rule.pattern).test(path) ? rule.pattern.length : -1;
}

export interface RobotsDecision {
  readonly allowed: boolean;
  /** The rule that decided it, for the record. Null when no rule matched. */
  readonly rule: RobotsRule | null;
  readonly reason: string;
}

/**
 * Decides one URL against a policy.
 *
 * Longest match wins; `Allow` breaks a tie, which is what lets a file say
 * *"disallow /search/ but allow /search/courses"*.
 */
export function decideAgainstRobots(policy: RobotsPolicy, url: string): RobotsDecision {
  if (policy.kind === "absent") {
    return { allowed: true, rule: null, reason: `${policy.host} publishes no robots.txt.` };
  }

  if (policy.kind === "unavailable") {
    return {
      allowed: false,
      rule: null,
      reason:
        `robots.txt for ${policy.host} could not be read (${policy.error}), so nothing may be ` +
        `fetched. RFC 9309 §2.3.1.4 treats an unavailable robots.txt as a complete disallow, and ` +
        `a run that could not read the rules has not respected them.`,
    };
  }

  const group = policy.applicable;
  if (group === null) {
    return {
      allowed: true,
      rule: null,
      reason: `${policy.host}'s robots.txt has no group addressed to this crawler.`,
    };
  }

  let winner: RobotsRule | null = null;
  let winnerLength = -1;
  for (const rule of group.rules) {
    const length = matchLength(rule, pathOf(url));
    if (length < winnerLength) continue;
    // Equal length: `Allow` wins, per RFC 9309 §2.2.2.
    if (length === winnerLength && rule.kind !== "allow") continue;
    winner = rule;
    winnerLength = length;
  }

  if (winner === null || winner.kind === "allow") {
    return {
      allowed: true,
      rule: winner,
      reason:
        winner === null
          ? `No rule in ${policy.host}'s robots.txt matches this path.`
          : `Allowed by "Allow: ${winner.pattern}".`,
    };
  }

  return {
    allowed: false,
    rule: winner,
    reason:
      `robots.txt for ${policy.host} disallows this path: "Disallow: ${winner.pattern}". ` +
      `Not fetched.`,
  };
}

/** The path and query a robots rule is matched against. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

/**
 * The delay to leave between requests, in milliseconds.
 *
 * ── Why there is a floor the file cannot lower ────────────────────────────
 *
 * Vahid, 2026-09-08: *"Even one second. Sequential crawling at browser speed
 * from a single IP is what gets an address blocked, and being blocked by our
 * first target before we have an account would be an expensive way to learn
 * this."*
 *
 * So a `Crawl-delay` of 0 — or its absence — does not mean "as fast as
 * possible". The floor is ours, the file may raise it, and nothing may lower
 * it: `Math.max` in one place rather than a default somebody can override.
 */
export const MINIMUM_CRAWL_DELAY_MS = 1_000;

export function crawlDelayMs(policy: RobotsPolicy, configuredMs: number): number {
  const stated =
    policy.kind === "fetched" && policy.applicable?.crawlDelaySeconds != null
      ? policy.applicable.crawlDelaySeconds * 1_000
      : 0;
  return Math.max(MINIMUM_CRAWL_DELAY_MS, configuredMs, stated);
}
