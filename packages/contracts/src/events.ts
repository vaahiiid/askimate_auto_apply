/**
 * The conversation event model, and the parser that is the only way in.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"The conversation event model must structurally prevent
 * secure events from containing message bodies."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Where free text lives, and where it cannot ────────────────────────────
 *
 * Exactly one member of this union has a `content` field, and it is the one
 * called `message`. The others do not have the field set to null, or empty, or
 * optional — the field does not exist on them. A secure event carrying what a
 * student typed is not a bug that could be introduced; it is a value that
 * cannot be constructed.
 *
 * ADR-0031 gives the database the same shape:
 *
 *     CHECK ((kind = 'message') = (body_id IS NOT NULL))
 *
 * so the property holds at both ends of the wire rather than only in the code
 * that happens to serialise it.
 *
 * ── What is NOT on a secure event, and why ────────────────────────────────
 *
 * Notably absent from `SecretRequestedEvent`: the prompt's title, explanation
 * and portal host. Those are free text chosen by a model, and Phase D carried
 * them on the directive turn.
 *
 * They are gone from this plane entirely. The Secure Interaction Service holds
 * them in its own database and renders them itself, inside its own document, on
 * its own origin (ADR-0030). The Conversation Service never receives the prompt
 * text at all — so `CHECK ((kind = 'message') = (body_id IS NOT NULL))` needs no
 * exception, and a compromise of the conversation database yields ids and
 * lifecycle words rather than anything a model wrote.
 *
 * What the directive DOES carry is what the page needs to decide whether it can
 * render a frame at all: the request id, the channel, and the expiry. All three
 * are closed sets or timestamps. None is free text.
 */

import type { Actor, RejectionReason, SecretChannel } from "./vocabulary.js";
import { parseActor, parseRejectionReason, parseSecretChannel } from "./vocabulary.js";

/** Dense, 1-based, unique per conversation. Also the SSE event id. */
export type Ordinal = number;

interface EventBase {
  readonly ordinal: Ordinal;
  /** RFC 3339. Server-assigned; a client's clock is never trusted for this. */
  readonly createdAt: string;
}

/**
 * The ONLY event with free text.
 *
 * `content` is `null` when the body has been redacted — by an erasure request,
 * or by the retention policy of ADR-0010 and ADR-0023. The event survives so
 * ordinals stay dense and the transcript keeps its shape; only the sentence is
 * gone. A deleted row would leave a hole every consumer had to reason about.
 */
export interface MessageEvent extends EventBase {
  readonly kind: "message";
  readonly actor: Actor;
  readonly content: string | null;
  readonly redactedAt?: string;
}

/** The model asked for a secret. Content-free by construction. */
export interface SecretRequestedEvent extends EventBase {
  readonly kind: "secret_requested";
  readonly requestId: string;
  readonly channel: SecretChannel;
  /** RFC 3339. After this the Secure Interaction Service refuses the request. */
  readonly expiresAt: string;
}

/** The student gave it. The handle is opaque and safe for the model to see. */
export interface SecretReceivedEvent extends EventBase {
  readonly kind: "secret_received";
  readonly requestId: string;
  readonly handle: string;
}

/** A terminal transition. No payload beyond which request it was. */
export interface SecretSettledEvent extends EventBase {
  readonly kind: "secret_consumed" | "secret_expired" | "secret_cancelled";
  readonly requestId: string;
}

/**
 * An attempt failed. A CODE, and nothing else.
 *
 * Deliberately not a template and not a message: a template is where a field
 * that turns out to carry a value gets interpolated later. The sentence a
 * student reads is chosen at render time from a fixed table keyed by `reason`.
 */
export interface SecretRejectedEvent extends EventBase {
  readonly kind: "secret_rejected";
  readonly requestId: string;
  readonly reason: RejectionReason;
}

export type ConversationEvent =
  | MessageEvent
  | SecretRequestedEvent
  | SecretReceivedEvent
  | SecretSettledEvent
  | SecretRejectedEvent;

/**
 * COMPILE-TIME: only `message` may have a `content` field.
 *
 * A distributive conditional, not a plain `keyof`. `keyof` over a union is the
 * INTERSECTION of the members' keys, so a naive check passes as long as *some*
 * member lacks the field — which is every union, always, and proves nothing.
 * `T extends unknown ? … : never` distributes over the members and asks the
 * question of each one separately.
 *
 * If a secure event ever gains `content`, `ContentBearing` stops being
 * `MessageEvent` and `AssertExactly` fails, naming the member that changed.
 */
type ContentBearing<T> = T extends unknown ? ("content" extends keyof T ? T : never) : never;

/**
 * ── The first version of this was VACUOUS, and a regression proved it ─────
 *
 * It read:
 *
 *     type AssertExactly<T, E> = [T] extends [E] ? ([E] extends [T] ? true : never) : never;
 *     export type ONLY_MESSAGES_CARRY_CONTENT = AssertExactly<…>;
 *
 * which COMPUTES `never` when the claim is false. `never` is a perfectly legal
 * type, so the declaration succeeded and nothing errored. Adding
 * `content?: string` to a secure event compiled cleanly.
 *
 * The distinction that matters: `AssertNever<T extends never>` fails because
 * the CONSTRAINT is violated. A conditional type that merely evaluates to
 * `never` fails at nothing. So the assertion has to end in a constraint, and
 * `AssertTrue<T extends true>` is the one that does.
 *
 * Found by regression C4b in the Phase E contract work — adding an OPTIONAL
 * `content` to `SecretSettledEvent`, which the parser could still construct
 * around, so no consequential error masked the silence.
 */
type Exactly<T, Expected> = [T] extends [Expected]
  ? [Expected] extends [T]
    ? true
    : false
  : false;
type AssertTrue<T extends true> = T;
export type ONLY_MESSAGES_CARRY_CONTENT = AssertTrue<
  Exactly<ContentBearing<ConversationEvent>, MessageEvent>
>;

/** The same claim at runtime, so it is visible in a test list too. */
export function eventCarriesContent(event: ConversationEvent): boolean {
  return event.kind === "message";
}

/**
 * Everything of an event that may be shown, stored, or sent onward.
 *
 * A message contributes its body. Nothing else contributes anything, because
 * nothing else has anything to contribute.
 */
export function persistableContent(event: ConversationEvent): string | null {
  return event.kind === "message" ? event.content : null;
}

// ───────────────────────────────────────────────────────────────────────────
// The parser — fail closed, no exceptions
// ───────────────────────────────────────────────────────────────────────────

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readOrdinal(source: Record<string, unknown>): Ordinal | null {
  const value = source["ordinal"];
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/**
 * Turns an untrusted object into an event, or into nothing.
 *
 * Vahid: *"Unknown lifecycle values, directive kinds and rejection reasons must
 * fail closed."* A miss returns `null`, and every caller drops it: it is not
 * rendered, not appended to the transcript, and not forwarded to the model.
 *
 * Dropping rather than throwing is deliberate. An unknown kind is what a client
 * older than the server sees, which is a routine condition under the versioning
 * rules in ./versioning.ts — not an error, and not a reason to tear down a
 * stream that is otherwise delivering valid events.
 */
export function parseConversationEvent(raw: unknown): ConversationEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;

  const ordinal = readOrdinal(source);
  const createdAt = readString(source, "createdAt");
  if (ordinal === null || createdAt === null) return null;

  const base = { ordinal, createdAt } as const;

  switch (source["kind"]) {
    case "message": {
      const actor = parseActor(source["actor"]);
      if (actor === null) return null;
      const content = source["content"];
      // `null` is a redacted body and is legal. `undefined` is a missing field
      // and is not — the difference matters, so it is not collapsed.
      if (content !== null && typeof content !== "string") return null;
      const redactedAt = readString(source, "redactedAt");
      return {
        ...base,
        kind: "message",
        actor,
        content,
        ...(redactedAt === null ? {} : { redactedAt }),
      };
    }
    case "secret_requested": {
      const requestId = readString(source, "requestId");
      const channel = parseSecretChannel(source["channel"]);
      const expiresAt = readString(source, "expiresAt");
      if (requestId === null || channel === null || expiresAt === null) return null;
      return { ...base, kind: "secret_requested", requestId, channel, expiresAt };
    }
    case "secret_received": {
      const requestId = readString(source, "requestId");
      const handle = readString(source, "handle");
      if (requestId === null || handle === null) return null;
      return { ...base, kind: "secret_received", requestId, handle };
    }
    case "secret_consumed":
    case "secret_expired":
    case "secret_cancelled": {
      const requestId = readString(source, "requestId");
      if (requestId === null) return null;
      return { ...base, kind: source["kind"], requestId };
    }
    case "secret_rejected": {
      const requestId = readString(source, "requestId");
      const reason = parseRejectionReason(source["reason"]);
      if (requestId === null || reason === null) return null;
      return { ...base, kind: "secret_rejected", requestId, reason };
    }
    default:
      return null;
  }
}

/**
 * Whether a secure request is open, derived from the event list.
 *
 * ── A rejection does NOT close a request. This is the subtle one ──────────
 *
 * A confirmation mismatch leaves the request at `secret_requested` on the
 * server, waiting for another attempt — the student mistyped, and the box
 * should still be there. Treating a rejection as closure would release the
 * composer while a live request is still open, which is precisely the
 * client/server divergence the fail-closed guard exists to catch. Phase D found
 * that exact bug in the previous client.
 *
 * What closes a request is a lifecycle transition, and only the Secure
 * Interaction Service can make one of those.
 */
export function openSecretRequest(events: readonly ConversationEvent[]): string | null {
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
        if (open === event.requestId) open = null;
        break;
      case "message":
      case "secret_rejected":
        break;
    }
  }
  return open;
}
