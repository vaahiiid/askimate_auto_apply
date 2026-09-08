/**
 * Fetching robots.txt for the hosts a run is allowed to touch.
 *
 * Separate from `robots.ts` so the rules stay pure and testable with no
 * network, and so the ONE place that talks to a live site before a crawl
 * begins is a file you can read in a minute.
 *
 * ── Fetched with `fetch`, not with the browser ────────────────────────────
 *
 * A page load runs the site's JavaScript. robots.txt is a text file, and
 * reading it should not execute anything — least of all before we know what
 * the file permits. It is also the one request that is exempt from its own
 * rules, by definition, so routing it through the guard would be circular.
 */

import type { RobotsPolicy } from "./robots.js";
import { decideAgainstRobots, groupFor, parseRobots } from "./robots.js";

/** Long enough for a slow origin, short enough that a hung host is a failure. */
const TIMEOUT_MS = 10_000;

/** The bytes we will read. A robots.txt larger than this is not a robots.txt. */
const MAX_BYTES = 512 * 1024;

export interface RobotsFetchOptions {
  readonly userAgent: string;
  readonly now: () => Date;
  /** Injected so the fetch itself is testable without a network. */
  readonly get?: (url: string, init: RequestInit) => Promise<Response>;
}

/**
 * Reads one host's robots.txt and turns it into a policy.
 *
 * Every failure lands on `unavailable`, which disallows everything. That is
 * severe on purpose: a run that could not read the rules has not respected
 * them, and the alternative — carry on because the file did not load — is
 * precisely the "we did not look" this exists to prevent.
 */
export async function fetchRobots(
  origin: string,
  options: RobotsFetchOptions,
): Promise<RobotsPolicy> {
  // ── The ORIGIN, not the host ──────────────────────────────────────────
  //
  // `https://${host}` was the obvious shape and it is wrong for the fixture
  // portal, which serves plain HTTP on a loopback port — so the fetch failed,
  // the policy became `unavailable`, and a run against the fixture fetched
  // nothing. Correct behaviour from a wrong input, which is the worst kind of
  // bug to leave in a safety check: it fails CLOSED and looks like the rule
  // working.
  const url = `${origin.replace(/\/+$/, "")}/robots.txt`;
  const host = new URL(url).host;
  const get = options.get ?? ((target, init) => fetch(target, init));
  const fetchedAt = options.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await get(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": options.userAgent, accept: "text/plain,*/*" },
    });

    if (response.status >= 400 && response.status < 500) {
      // The site has told us there is no policy. Different from "we could not
      // ask", and the two must not be merged.
      return { kind: "absent", host, fetchedAt, statusCode: response.status };
    }

    if (!response.ok) {
      return {
        kind: "unavailable",
        host,
        fetchedAt,
        statusCode: response.status,
        error: `${String(response.status)} from the origin`,
      };
    }

    const body = (await response.text()).slice(0, MAX_BYTES);
    const groups = parseRobots(body);
    return {
      kind: "fetched",
      host,
      fetchedAt,
      statusCode: response.status,
      body,
      groups,
      applicable: groupFor(groups),
    };
  } catch (error) {
    return {
      kind: "unavailable",
      host,
      fetchedAt,
      statusCode: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every allowed host's policy, and one function that decides a URL.
 *
 * A URL whose host is not in the map is refused. That cannot normally happen —
 * the host allow-list runs first — but "cannot normally happen" is not a
 * reason to default to allow in the function that exists to say no.
 */
export interface RobotsSet {
  readonly policies: ReadonlyMap<string, RobotsPolicy>;
  decide(url: string): { readonly allowed: boolean; readonly reason: string };
}

export async function fetchRobotsFor(
  origins: readonly string[],
  options: RobotsFetchOptions,
): Promise<ReadonlyMap<string, RobotsPolicy>> {
  const policies = new Map<string, RobotsPolicy>();
  for (const origin of origins) {
    const policy = await fetchRobots(origin, options);
    // Both forms again, and for the same reason as `originsFor`: the guard
    // looks a URL up by its hostname and the policy was fetched from an origin
    // that may carry a port.
    policies.set(policy.host.toLowerCase(), policy);
    try {
      policies.set(new URL(`${origin}/`).hostname.toLowerCase(), policy);
    } catch {
      // `fetchRobots` already turned a malformed origin into `unavailable`.
    }
  }
  return policies;
}

/**
 * The origins to read robots.txt from, derived from the run's own seed URLs.
 *
 * An allowed host with no seed gets `https://`, which is the right default for
 * a real site and never applies to the fixture portal, whose seeds are all
 * plain HTTP on a loopback port.
 */
export function originsFor(
  allowedHosts: readonly string[],
  seedUrls: readonly string[],
): readonly string[] {
  const bySeed = new Map<string, string>();
  for (const seed of seedUrls) {
    try {
      const parsed = new URL(seed);
      const origin = `${parsed.protocol}//${parsed.host}`;
      // Keyed by BOTH forms, because `allowedHosts` is written without a port
      // and a seed URL carries one. `127.0.0.1` in the target file and
      // `127.0.0.1:8123` in the seed are the same host to a person and two
      // different strings to a Map — which is exactly how the fixture run
      // ended up reading `https://127.0.0.1/robots.txt`, failing, and
      // correctly fetching nothing.
      for (const key of [parsed.host.toLowerCase(), parsed.hostname.toLowerCase()]) {
        if (!bySeed.has(key)) bySeed.set(key, origin);
      }
    } catch {
      // A malformed seed is the target parser's problem, not this function's.
    }
  }
  return allowedHosts.map((host) => bySeed.get(host.toLowerCase()) ?? `https://${host}`);
}

/** Builds the decider the session's guard calls, from fetched policies. */
export function robotsSet(policies: ReadonlyMap<string, RobotsPolicy>): RobotsSet {
  return {
    policies,
    decide(url: string) {
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        return { allowed: false, reason: `Not a URL this run can check against robots.txt: ${url}` };
      }
      const policy = policies.get(host);
      if (policy === undefined) {
        return {
          allowed: false,
          reason:
            `No robots.txt was read for ${host}, so nothing may be fetched from it. Hosts are ` +
            `read before a crawl begins; one appearing later has not been checked.`,
        };
      }
      const decision = decideAgainstRobots(policy, url);
      return { allowed: decision.allowed, reason: decision.reason };
    },
  };
}
