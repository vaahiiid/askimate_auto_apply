/**
 * The authenticated call from the secure plane to the conversation plane.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *   POST /internal/v1/conversations/{id}/events
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The ONLY thing this service ever sends to the other plane, and the shape is
 * why that is safe to say: a `LifecycleTransition` has a kind, a request id,
 * and — depending on the kind — a channel, an expiry, an opaque handle or a
 * reason code. There is no field for a body, so there is no field a password
 * could travel in. The conversation service's `parseSecureAppend` refuses
 * anything else on arrival, so the guarantee holds at both ends.
 *
 * ── What is a retry and what is not ───────────────────────────────────────
 *
 * Classified rather than merely counted, because "keep trying" and "stop" have
 * opposite consequences here:
 *
 *   unreachable / 5xx     → RETRY. The other plane is down or restarting, and
 *                           a rolling deployment is a routine event.
 *   403                   → PERMANENT. The service credential was refused;
 *                           retrying forever would hammer a door that is shut.
 *   404                   → PERMANENT. The conversation does not exist there.
 *   400                   → PERMANENT. We built a request it will never accept,
 *                           which is a bug in this service, not a blip.
 *
 * A permanent failure is NOT recorded as delivered. The transition stays
 * pending, the conversation log never learns the step settled, and the guard
 * there keeps the composer shut. Failing closed is the direction of the error.
 */

import type { DeliveryOutcome, OutboxRow } from "./lifecycle-outbox.js";

export interface InternalAppendOptions {
  /** Origin of the Conversation Service, e.g. `https://app.internal`. */
  readonly baseUrl: string;
  /**
   * The service credential.
   *
   * PROVISIONAL: ADR-0037 puts this call behind mutual TLS on a private
   * subnet, where the client certificate IS the identity and there is no
   * secret to carry in a header. This header is the stand-in the conversation
   * service's `authoriseService` already accepts, and it is deliberately the
   * only thing here that would change: the request body, the idempotency
   * behaviour and the retry classification are the same under mTLS.
   */
  readonly serviceCertificate: string;
  readonly fetch?: typeof globalThis.fetch;
  /** How long one attempt may take before it counts as unreachable. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export function internalAppend(options: InternalAppendOptions) {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (row: OutboxRow): Promise<DeliveryOutcome> => {
    const url =
      `${options.baseUrl}/internal/v1/conversations/` +
      `${encodeURIComponent(row.conversationId)}/events`;

    // A timeout, not an indefinite wait. A hung connection to the other plane
    // would otherwise hold this publisher's transaction open — and that
    // transaction holds a row lock other instances are skipping past.
    const timeout = new AbortController();
    const timer = setTimeout(() => {
      timeout.abort();
    }, timeoutMs);

    try {
      const response = await doFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-service-cert": options.serviceCertificate,
        },
        body: JSON.stringify(bodyFor(row)),
        signal: timeout.signal,
      });

      // 201 first write, 200 an idempotent repeat of a transition already
      // recorded. BOTH are delivered: the point of the retry is that the log
      // holds the transition, and it does either way.
      if (response.status === 200 || response.status === 201) return { delivered: true };
      if (response.status === 403) return { delivered: false, retry: false, code: "refused" };
      if (response.status === 404) {
        return { delivered: false, retry: false, code: "unknown_conversation" };
      }
      if (response.status >= 500) {
        return { delivered: false, retry: true, code: "server_error" };
      }
      return { delivered: false, retry: false, code: "malformed" };
    } catch {
      // A network error, a DNS failure, an abort. Nothing from the error is
      // read or recorded: an HTTP client's error message can carry the URL,
      // the headers and a fragment of the body, and this is the one service
      // where such a fragment might be a credential.
      return { delivered: false, retry: true, code: "unreachable" };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The wire body. Exactly the fields the transition's kind admits. */
function bodyFor(row: OutboxRow): Record<string, unknown> {
  const t = row.transition;
  switch (t.kind) {
    case "secret_requested":
      return {
        kind: t.kind,
        requestId: row.requestId,
        channel: t.channel,
        expiresAt: t.expiresAt.toISOString(),
      };
    case "secret_received":
      return { kind: t.kind, requestId: row.requestId, handle: t.handle };
    case "secret_rejected":
      return { kind: t.kind, requestId: row.requestId, reason: t.reason };
    case "secret_consumed":
    case "secret_expired":
    case "secret_cancelled":
      return { kind: t.kind, requestId: row.requestId };
  }
}
