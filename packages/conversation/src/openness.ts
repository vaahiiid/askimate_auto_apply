/**
 * Whether a secure step is open — the one derivation the composer guard trusts.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Treat it as the single domain authority for conversation
 * decisions."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Two rules, and the second one was previously unrepresentable ──────────
 *
 *  1. **A rejection closes nothing.** A mistyped confirmation leaves the
 *     request open so the student can retry. Treating a rejection as closure
 *     would release the composer while the server still holds the request —
 *     the client/server divergence Phase D removed.
 *
 *  2. **A settlement closes only the request it NAMES.** This is the one the
 *     superseded turn model could not express: `ChatTurn`'s `secret_status`
 *     variant had no `requestId`, so the old `openSecureRequest` closed on ANY
 *     status. Two requests in one conversation — a lapsed one and a live one —
 *     and the lapsed one's expiry released the live one's guard, letting a
 *     message through while a password box was on screen.
 *
 * That is why this extraction migrated the client to the wire model rather
 * than lifting the old code: the old shape had no field to make the rule with.
 */

import type { UnpositionedEvent } from "./unpositioned.js";

/**
 * The request id of the open step, or null when the conversation is free.
 *
 * Takes UNPOSITIONED events on purpose. This decision reads `kind` and
 * `requestId` and nothing else, so requiring an ordinal would have forced every
 * caller holding a locally-drawn entry to invent one just to ask the question —
 * which is exactly the invention `log.ts` exists to remove. A
 * `ConversationEvent` is assignable here, so the server side is unchanged.
 */
export function openSecretRequest(events: readonly UnpositionedEvent[]): string | null {
  let open: string | null = null;
  for (const event of events) {
    switch (event.kind) {
      // A value proposal is not a secure step and must not settle or open one
      // (ADR-0051). Named rather than defaulted: a `default:` here would make
      // the next kind added settle a live secure request by accident.
      case "value_proposed":
      case "value_confirmed":
      case "value_rejected":
        break;
      case "secret_requested":
        open = event.requestId;
        break;
      case "secret_received":
      case "secret_consumed":
      case "secret_expired":
      case "secret_cancelled":
        // Only if it settles the one that is open. A stale request's
        // settlement must not release a live request's guard.
        if (open === event.requestId) open = null;
        break;
      case "message":
      case "secret_rejected":
        break;
    }
  }
  return open;
}

/**
 * The most recent secret request in a log, and where it got to.
 *
 * ── Why this is a SIXTH decision rather than a helper in the driver ───────
 *
 * `openSecretRequest` above answers "is a step open?" — which is what the
 * composer guard needs. The Run Driver needs a different question: "what does
 * the orchestrator's `RunState.secret` say?", which is a request id, a lifecycle
 * word and, once the student has answered, an opaque handle.
 *
 * Both are readings of the same log, and the comment on `openSecretRequest`
 * explains what happened last time two readings of it existed in two places:
 * they drifted, and a lapsed request released a live one's guard. So this lives
 * beside it, under the same rule — `scripts/check-boundaries.ts` permits these
 * names to be imported anywhere and defined only here.
 *
 * Returns the LATEST request rather than the open one, because a settled
 * request is exactly what the driver must see: `secret_consumed` is how it
 * knows not to ask again.
 */
export function latestSecretRequest(events: readonly UnpositionedEvent[]): {
  readonly requestId: string;
  readonly lifecycle:
    | "secret_requested"
    | "secret_received"
    | "secret_consumed"
    | "secret_expired"
    | "secret_cancelled";
  /** Present once the student has answered. Opaque; resolves to nothing here. */
  readonly handle?: string;
} | null {
  let requestId: string | null = null;
  let lifecycle:
    | "secret_requested"
    | "secret_received"
    | "secret_consumed"
    | "secret_expired"
    | "secret_cancelled" = "secret_requested";
  let handle: string | undefined;

  for (const event of events) {
    switch (event.kind) {
      case "value_proposed":
      case "value_confirmed":
      case "value_rejected":
        break;
      case "secret_requested":
        // A new request supersedes the last. Its handle does not carry over:
        // a handle belongs to the request it was minted for.
        requestId = event.requestId;
        lifecycle = "secret_requested";
        handle = undefined;
        break;
      case "secret_received":
      case "secret_consumed":
      case "secret_expired":
      case "secret_cancelled":
        // Only when it settles the one being tracked. A stale request's
        // settlement must not move a live request's lifecycle — the same rule,
        // and the same reason, as the guard above.
        if (requestId === event.requestId) {
          lifecycle = event.kind;
          if ("handle" in event && typeof event.handle === "string") handle = event.handle;
        }
        break;
      case "message":
      case "secret_rejected":
        break;
    }
  }

  if (requestId === null) return null;
  return { requestId, lifecycle, ...(handle === undefined ? {} : { handle }) };
}
