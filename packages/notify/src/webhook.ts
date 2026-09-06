/**
 * The first `SpecialistNotifier`: an HTTP POST to a URL the operator chooses.
 *
 * ── Why a webhook rather than email, Slack or a paging SDK ────────────────
 *
 * Because it is the one shape that needs nothing provisioned. A chat platform's
 * incoming webhook, a paging service's events endpoint and an internal relay
 * all speak it, and choosing between them stays an operational decision rather
 * than becoming a dependency in this repository and a bill on somebody's card.
 *
 * It also keeps the SDK surface at zero. `fetch` is in the runtime; a vendor
 * client would be a package with its own transitive tree in a process that runs
 * unattended against the conversation database.
 *
 * ── The one thing this refuses ────────────────────────────────────────────
 *
 * A non-HTTPS destination that is not loopback. `SpecialistNotice` carries no
 * student data by construction, but it does carry the shape of a real
 * application in progress — which institution, which course, how often runs
 * stop — and putting that on the wire in clear text is a choice nobody would
 * make deliberately. Loopback is admitted because a local relay is a legitimate
 * deployment (an operator's own forwarder, or a test), and it does not leave
 * the host.
 *
 * The refusal is at CONSTRUCTION, not at send time. A misconfigured destination
 * should stop the worker starting (ADR-0055), not fail silently on the first
 * stopped run at three in the morning.
 */

import { NoticeDeliveryError, type SpecialistNotice, type SpecialistNotifier } from "./notice.js";

/** Raised when the configured destination would put a notice on the wire in clear. */
export class InsecureNotifierUrlError extends Error {
  public override readonly name = "InsecureNotifierUrlError";
  public constructor(public readonly url: string) {
    super(
      `The specialist notifier is configured with "${url}", which is not HTTPS and is not ` +
        `loopback. A notice names the institution, the course and the case of a real application ` +
        `in progress; sending that in clear text is not a deployment choice anyone makes on ` +
        `purpose. Use https://, or 127.0.0.1 / localhost for a local relay.`,
    );
  }
}

/**
 * `URL.hostname` keeps the brackets on an IPv6 literal — `http://[::1]:9000/`
 * has a hostname of `[::1]`, not `::1`. Both spellings are here because a test
 * asserted the bare one and this refused it, which is the shape of a control
 * that would have been wrong in exactly one deployment.
 */
const LOOPBACK = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/** True when a URL may carry a notice: HTTPS anywhere, or HTTP to loopback only. */
export function isDeliverableUrl(url: URL): boolean {
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  return LOOPBACK.has(url.hostname);
}

export interface WebhookNotifierOptions {
  readonly url: string;
  /**
   * How long one delivery may take.
   *
   * Bounded because this runs inside the worker's notify pass: an endpoint that
   * accepts a connection and never answers would otherwise hold the pass open
   * and stop every LATER notice in the batch, which turns one unreachable
   * destination into a silent queue.
   */
  readonly timeoutMs?: number;
  /** Injected so a test can assert what went on the wire without a server. */
  readonly fetch?: typeof globalThis.fetch;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class WebhookNotifier implements SpecialistNotifier {
  readonly #url: URL;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;

  public constructor(options: WebhookNotifierOptions) {
    // Throws on a malformed URL before anything is stored, so a typo is a
    // startup failure rather than a notifier that exists and cannot deliver.
    const url = new URL(options.url);
    if (!isDeliverableUrl(url)) throw new InsecureNotifierUrlError(options.url);
    this.#url = url;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  public async notify(notice: SpecialistNotice): Promise<void> {
    const abort = AbortSignal.timeout(this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(this.#url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(notice),
        signal: abort,
      });
    } catch (error: unknown) {
      // The transport's own message, never a response body.
      throw new NoticeDeliveryError(
        notice.interventionId,
        error instanceof Error ? error.name : "the request failed",
      );
    }

    if (!response.ok) {
      // Status only. A webhook endpoint's error page is content from outside
      // the system and this error is going into a log.
      throw new NoticeDeliveryError(
        notice.interventionId,
        `the endpoint answered ${String(response.status)}`,
      );
    }
  }
}
