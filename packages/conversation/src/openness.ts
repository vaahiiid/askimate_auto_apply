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
