/**
 * The preparation-mode guard.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PREPARATION FILLS AN APPLICATION AND STOPS BEFORE SUBMITTING IT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Discovery's guard is easy: nothing may write, so refuse every method that is
 * not a safe read (see ./safety.ts). Preparation cannot work that way. Typing
 * into a real portal means the portal saves drafts, and saving a draft is a
 * POST. A guard that blocked writes would block the work.
 *
 * So the containment moves from "what may leave the machine" to "what may be
 * clicked", and it is layered:
 *
 *   TYPE      `FillableSession` has no `submit`. There is nothing to call.
 *
 *   CLICK     Only controls the blueprint recorded as ADVANCE controls may be
 *             clicked. Everything else is refused — including a control the
 *             page invented since the blueprint was reviewed.
 *
 *   NAME      A control whose accessible name reads like a submission is
 *             refused even if something put it on the allow-list. Belt and
 *             braces, because the allow-list is assembled from a blueprint and
 *             blueprints can be wrong.
 *
 *   NETWORK   Requests to hosts outside the run's allow-list are refused, as
 *             in discovery. State-changing requests to allow-listed hosts are
 *             PERMITTED and RECORDED — every one of them, so a specialist can
 *             see exactly what was sent.
 *
 * ── What this does not claim ──────────────────────────────────────────────
 *
 * The network layer does not guarantee "no submission". It cannot: a portal's
 * own JavaScript can post a form without any control being clicked, and
 * distinguishing "saving a draft" from "submitting" by looking at an HTTP
 * request is guesswork. The submission guarantee rests on the type and the
 * click guard; the network layer's job is to keep the run on-target and to
 * make everything it did visible afterwards.
 *
 * Where the blueprint DOES record the submission endpoint, it is refused at the
 * network layer too — defence in depth exactly where knowledge exists, and no
 * pretence where it does not.
 */

import type { FieldLocator } from "@askimate/aas-blueprint";

import type { GuardDecision } from "./safety.js";
import { HostAllowList } from "./safety.js";

/** Methods that cannot change state. */
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Accessible names that mean "this sends the application".
 *
 * Matched loosely and refused. A false positive costs a specialist a look at a
 * blueprint; a false negative submits a real application without authorisation.
 * The asymmetry decides how aggressive this list should be.
 */
const SUBMISSION_NAMES: readonly RegExp[] = [
  /\bsubmit\b/i,
  /\bsend\s+(?:my\s+)?application\b/i,
  /\bsubmit\s+application\b/i,
  /\bconfirm\s+and\s+send\b/i,
  /\bfinish\s+and\s+send\b/i,
  /\bcomplete\s+application\b/i,
  /\bpay\s+and\s+submit\b/i,
  /\bapply\s+now\b/i,
];

export function looksLikeSubmission(accessibleName: string): boolean {
  return SUBMISSION_NAMES.some((pattern) => pattern.test(accessibleName));
}

/** What the click guard decided. */
export interface ClickDecision {
  readonly allowed: boolean;
  readonly locator: FieldLocator;
  readonly reason?: string;
}

/**
 * Which controls preparation may click.
 *
 * An allow-list, not a deny-list, for the same reason the discovery method
 * guard is: a control nobody thought of is refused rather than permitted.
 */
export class ClickAllowList {
  readonly #permitted: readonly FieldLocator[];

  public constructor(permitted: readonly FieldLocator[]) {
    this.#permitted = permitted;
  }

  public get permitted(): readonly FieldLocator[] {
    return this.#permitted;
  }

  public decide(locator: FieldLocator, accessibleName?: string): ClickDecision {
    // The name check runs FIRST, so a submission control on the allow-list is
    // still refused. An allow-list assembled from a blueprint is only as right
    // as the blueprint.
    if (accessibleName !== undefined && looksLikeSubmission(accessibleName)) {
      return {
        allowed: false,
        locator,
        reason:
          `Refusing to click "${accessibleName}": it reads as a submission control. Preparation ` +
          `fills an application and stops. Submission is a separate, authorised step.`,
      };
    }

    if (looksLikeSubmission(locator.value)) {
      return {
        allowed: false,
        locator,
        reason:
          `Refusing to click ${locator.strategy}="${locator.value}": it reads as a submission ` +
          `control.`,
      };
    }

    const listed = this.#permitted.some(
      (candidate) => candidate.strategy === locator.strategy && candidate.value === locator.value,
    );
    if (!listed) {
      return {
        allowed: false,
        locator,
        reason:
          `Refusing to click ${locator.strategy}="${locator.value}": it is not one of the ` +
          `controls this blueprint records as advancing the application ` +
          `(${this.#permitted.map((c) => `${c.strategy}="${c.value}"`).join(", ") || "none"}).`,
      };
    }

    return { allowed: true, locator };
  }
}

/** Everything preparation sent that could have changed something. */
export class WriteLog {
  readonly #writes: { readonly method: string; readonly url: string }[] = [];

  public record(method: string, url: string): void {
    this.#writes.push({ method: method.toUpperCase(), url });
  }

  public get entries(): readonly { readonly method: string; readonly url: string }[] {
    return [...this.#writes];
  }

  public get count(): number {
    return this.#writes.length;
  }

  /**
   * A summary for the run record.
   *
   * Written to be read by a person deciding whether a preparation run did
   * anything it should not have, so it says what was sent rather than that
   * everything was fine.
   */
  public summarise(): string {
    if (this.#writes.length === 0) {
      return "No state-changing requests were sent. The portal saved nothing.";
    }
    const byMethod = new Map<string, number>();
    for (const write of this.#writes) {
      byMethod.set(write.method, (byMethod.get(write.method) ?? 0) + 1);
    }
    const breakdown = [...byMethod.entries()]
      .map(([method, n]) => `${method}×${String(n)}`)
      .join(", ");
    return (
      `${String(this.#writes.length)} state-changing request(s) were sent (${breakdown}). ` +
      `The portal has stored something as a result of this run.`
    );
  }
}

/** How the preparation network guard is configured. */
export interface PreparationNetworkPolicy {
  readonly allowList: HostAllowList;
  /**
   * URLs (or path prefixes) that submit the application, where the blueprint
   * records them. Refused even for a state-changing method the guard would
   * otherwise permit.
   */
  readonly forbiddenEndpoints: readonly string[];
}

/**
 * Decides one request in preparation mode.
 *
 * Pure, so the policy is testable without a browser — the same discipline as
 * the discovery guard.
 */
export function decidePreparationRequest(
  method: string,
  url: string,
  policy: PreparationNetworkPolicy,
): GuardDecision {
  const normalised = method.toUpperCase();

  if (!policy.allowList.permits(url)) {
    return {
      allowed: false,
      method: normalised,
      url,
      reason:
        `Preparation blocked a request to ${url}: the host is not on this run's allow-list ` +
        `(${policy.allowList.hosts.join(", ")}).`,
    };
  }

  const forbidden = policy.forbiddenEndpoints.find((endpoint) => url.startsWith(endpoint));
  if (forbidden !== undefined && !SAFE_METHODS.has(normalised)) {
    return {
      allowed: false,
      method: normalised,
      url,
      reason:
        `Preparation blocked a ${normalised} to ${url}: the blueprint records this as the ` +
        `submission endpoint. Submitting is a separate step, and it is not this one.`,
    };
  }

  return { allowed: true, method: normalised, url };
}

/** Whether a request would change something on the server. */
export function isStateChanging(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export { HostAllowList };
