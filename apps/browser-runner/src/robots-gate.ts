/**
 * The runner's robots.txt gate (P135, distance item 7).
 *
 * ADR-0091 reads, obeys and keeps robots.txt and paces requests — and every
 * one of those lived in the discovery CLI, under ADR-0014's read-only run.
 * The Automation Runner's fill path, the one a live run uses, read nothing
 * and paced nothing. Vahid: *"The robots.txt rule and the one-second floor
 * already built are preconditions I am not revisiting."* So the same
 * reading, the same refusal and the same floor stand before every unit of
 * work the runner performs on a portal, and the run obeys them rather than
 * the operator.
 *
 * Read with `fetch`, not the browser, before anything navigates; kept for a
 * while so a fill of eleven pages does not read the file eleven times; failing
 * CLOSED when the file could not be read, because a run that could not ask
 * has not obeyed (ADR-0091 decision 1, the middle row of its table).
 */

import { crawlDelayMs, MINIMUM_CRAWL_DELAY_MS, RUNNER_AGENT_TOKEN } from "./robots.js";
import type { RobotsPolicy } from "./robots.js";
import { fetchRobotsFor, robotsSet } from "./robots-fetch.js";
import type { RobotsSet } from "./robots-fetch.js";

export type RobotsVerdict =
  | { readonly allowed: true; readonly set: RobotsSet; readonly delayMs: number }
  | { readonly allowed: false; readonly url: string; readonly reason: string };

export interface RobotsGate {
  /** Every URL the work item will open, checked before the browser does. */
  check(urls: readonly string[]): Promise<RobotsVerdict>;
}

export interface RobotsGateOptions {
  readonly now: () => Date;
  /** Injected so the fetch itself is testable without a network. */
  readonly get?: (url: string, init: RequestInit) => Promise<Response>;
  /** How long a read is kept before the file is read again. Ten minutes by default. */
  readonly keepMs?: number;
}

const DEFAULT_KEEP_MS = 10 * 60 * 1_000;

export function robotsGate(options: RobotsGateOptions): RobotsGate {
  const keepMs = options.keepMs ?? DEFAULT_KEEP_MS;
  const kept = new Map<string, { readonly policy: RobotsPolicy; readonly readAt: number }>();

  return {
    async check(urls) {
      const origins = new Map<string, string>();
      for (const url of urls) {
        try {
          const parsed = new URL(url);
          origins.set(parsed.origin, parsed.hostname.toLowerCase());
        } catch {
          return { allowed: false, url, reason: `Not a URL this run can check against robots.txt: ${url}` };
        }
      }
      const at = options.now().getTime();
      const stale = [...origins.keys()].filter((origin) => {
        const held = kept.get(origin);
        return held === undefined || at - held.readAt >= keepMs;
      });
      if (stale.length > 0) {
        const read = await fetchRobotsFor(stale, {
          userAgent: RUNNER_AGENT_TOKEN,
          now: options.now,
          ...(options.get === undefined ? {} : { get: options.get }),
        });
        for (const origin of stale) {
          const policy = read.get(origins.get(origin) ?? "") ?? read.get(new URL(origin).host.toLowerCase());
          if (policy !== undefined) kept.set(origin, { policy, readAt: at });
        }
      }
      const policies = new Map<string, RobotsPolicy>();
      for (const [origin, hostname] of origins) {
        const held = kept.get(origin);
        if (held === undefined) return { allowed: false, url: origin, reason: `No robots.txt could be read for ${origin}.` };
        policies.set(hostname, held.policy);
        policies.set(new URL(origin).host.toLowerCase(), held.policy);
      }
      const set = robotsSet(policies);
      for (const url of urls) {
        const decision = set.decide(url);
        if (!decision.allowed) return { allowed: false, url, reason: decision.reason };
      }
      const delayMs = Math.max(MINIMUM_CRAWL_DELAY_MS, ...[...policies.values()].map((policy) => crawlDelayMs(policy, MINIMUM_CRAWL_DELAY_MS)));
      return { allowed: true, set, delayMs };
    },
  };
}
