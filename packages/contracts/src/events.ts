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

/**
 * A reading the agent understood from what the student said (ADR-0051).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NOT a fact about the application. It is a fact about the CONVERSATION: this
 * is what we understood, and this is what we showed you. It becomes a fact
 * about the application only when the student agrees, and then it lives in the
 * confirmed profile — which is why this is on the conversation log and not the
 * case log (ADR-0031).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `playbackHash` names the message the student is being asked to agree to. The
 * confirmation carries the same hash, so "what exactly did I agree to?" is
 * answerable from two events and the message between them.
 */
export interface ValueProposedEvent extends EventBase {
  readonly kind: "value_proposed";
  readonly fieldKey: string;
  /**
   * The structured reading, tagged for transport.
   *
   * Stored rather than re-parsed from the playback on confirmation: re-parsing
   * would depend on `render ∘ parse` being lossless for every field spec, and
   * that fails silently. It carries no more of the student's data than the
   * playback message beside it already does.
   */
  readonly proposal: unknown;
  readonly playbackHash: string;
}

/** The student agreed to exactly the reading `playbackHash` names. */
export interface ValueConfirmedEvent extends EventBase {
  readonly kind: "value_confirmed";
  readonly fieldKey: string;
  readonly playbackHash: string;
}

/**
 * The student did not agree.
 *
 * A rejection closes the exchange without writing anything. The next thing
 * they say is a fresh answer, and it produces a fresh proposal — a correction
 * is never a confirmation of something else.
 */
export interface ValueRejectedEvent extends EventBase {
  readonly kind: "value_rejected";
  readonly fieldKey: string;
}

/**
 * The server resolved a REVIEWED target and put it to the student (ADR-0058).
 *
 * Content-free by construction: the prose the student reads is a `message`
 * beside this, and what this carries is the identity that prose describes —
 * which offer, which blueprint, and which reviewed catalogue content supported
 * it. `contentHash` is recorded rather than re-derived so that a later change
 * to the artefact is detectable instead of silently reinterpreted.
 */
export interface TargetOfferedEvent extends EventBase {
  readonly kind: "target_offered";
  /** `sha256:<hex>` over the canonical offer. What a request must name. */
  readonly offerHash: string;
  readonly targetBlueprintId: string;
  /** ADR-0057's content hash for the catalogue entry behind the offer. */
  readonly targetContentHash: string;
}

/**
 * The student explicitly asked to apply to that exact offer.
 *
 * The event immediately before `CaseOpened`, and the first consequential act in
 * the journey. It names the offer and nothing else: what was offered is the
 * offer's to state, and repeating it here would let two rows disagree about one
 * fact.
 */
export interface TargetRequestedEvent extends EventBase {
  readonly kind: "target_requested";
  readonly offerHash: string;
}

export type ConversationEvent =
  | MessageEvent
  | SecretRequestedEvent
  | SecretReceivedEvent
  | SecretSettledEvent
  | SecretRejectedEvent
  | ValueProposedEvent
  | ValueConfirmedEvent
  | ValueRejectedEvent
  | TargetOfferedEvent
  | TargetRequestedEvent;

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
    case "value_proposed": {
      const fieldKey = readString(source, "fieldKey");
      const playbackHash = readString(source, "playbackHash");
      // `proposal` is `unknown` on purpose: its shape is the profile package's
      // and this package may not depend on it (ADR-0040). What is checked here
      // is that it is PRESENT — a proposal with nothing proposed is not one.
      const proposal = source["proposal"];
      if (fieldKey === null || playbackHash === null || proposal === undefined) return null;
      return { ...base, kind: "value_proposed", fieldKey, proposal, playbackHash };
    }
    case "value_confirmed": {
      const fieldKey = readString(source, "fieldKey");
      const playbackHash = readString(source, "playbackHash");
      if (fieldKey === null || playbackHash === null) return null;
      return { ...base, kind: "value_confirmed", fieldKey, playbackHash };
    }
    case "value_rejected": {
      const fieldKey = readString(source, "fieldKey");
      if (fieldKey === null) return null;
      return { ...base, kind: "value_rejected", fieldKey };
    }
    default:
      return null;
  }
}
