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

  /** True when the portal attempted a state-changing request unprompted. */
  public get portalAttemptedWrite(): boolean {
    return this.#blocked.length > 0;
  }

  /** A summary for the discovery report. */
  public summarise(): string {
    if (this.#blocked.length === 0) {
      return "No state-changing requests were attempted. The portal was inspected read-only.";
    }
    const byMethod = new Map<string, number>();
    for (const entry of this.#blocked) {
      byMethod.set(entry.method, (byMethod.get(entry.method) ?? 0) + 1);
    }
    const breakdown = [...byMethod.entries()].map(([method, n]) => `${method}×${String(n)}`).join(", ");
    return (
      `${String(this.#blocked.length)} state-changing request(s) were blocked (${breakdown}). ` +
      `The portal attempts writes during normal browsing, which a specialist must review before ` +
      `any execution run.`
    );
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
    };
  }

  return methodDecision;
}
