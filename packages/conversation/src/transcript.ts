/**
 * The conversation, projected for rendering. Nothing is dropped.
 *
 * ── One event in, one item out, in order ──────────────────────────────────
 *
 * `projectTranscript` is a `map`, and that is load-bearing. An earlier client
 * used a loop with a `continue` that skipped every non-message turn, which is
 * what pushed the secure request out of the conversation and into a detached
 * panel below the composer. A `map` cannot skip: the array it returns is the
 * same length as the array it was given, and every item carries the position it
 * came from.
 *
 * ── Where free text is, and is not ────────────────────────────────────────
 *
 * Exactly one item variant has `content`, and it is the one projected from a
 * message. That mirrors the event union, which mirrors the database's
 * `CHECK ((kind = 'message') = (body_id IS NOT NULL))`. The property holds at
 * three layers because it is expressed at three layers, not because one layer
 * is trusted.
 *
 * ── A rendering position is not a durable ordinal ─────────────────────────
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"The client must never create a durable ordinal… remove
 * the assumption that `previous.length + 1` represents a durable position."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The client used to number its own turns `previous.length + 1` and hand the
 * result to this function as an `Ordinal`. It rendered correctly and it was
 * wrong: an ordinal is the server's answer to "where in the log is this", it is
 * also the SSE event id, and a client that invents one has invented a durable
 * fact. Nothing in the type system objected, because a rendering position and a
 * durable ordinal were both `number`.
 *
 * They are now different types. A `Position` is either the server's ordinal or
 * a client-local id, and the two cannot be confused, compared or swapped —
 * `renderKey` is the only thing that flattens them, and it flattens them into a
 * string that is never an ordinal.
 */

import type {
  ConversationEvent,
  Ordinal,
  RejectionReason,
  SecretChannel,
  SecretLifecycleWord,
} from "@askimate/aas-contracts";

import type { UnpositionedEvent } from "./unpositioned.js";

/**
 * Where an item sits, and on whose authority.
 *
 * `durable` carries the ordinal the Conversation Service assigned inside the
 * same transaction as the insert. `provisional` carries a client-local id and
 * NO ordinal: there is no field on it a caller could put a position into, so
 * the "just number it locally" shortcut is not available to write.
 */
export type Position =
  | { readonly placement: "durable"; readonly ordinal: Ordinal }
  | { readonly placement: "provisional"; readonly localId: string };

export function durableAt(ordinal: Ordinal): Position {
  return { placement: "durable", ordinal };
}

export function provisionalAt(localId: string): Position {
  return { placement: "provisional", localId };
}

/**
 * A React key, or any other opaque identity.
 *
 * Prefixed, so a durable ordinal `1` and a provisional entry that happens to be
 * called `1` cannot collide — a collision would make React reuse one item's DOM
 * node for the other, which is how a settled secure step can end up wearing a
 * live control's element.
 */
export function renderKey(position: Position): string {
  return position.placement === "durable" ? `d:${position.ordinal}` : `p:${position.localId}`;
}

export type TranscriptItem =
  /**
   * An event that is real, ordered and durable — and that the student reads
   * nothing of.
   *
   * The interview's proposal exchange (ADR-0051) is the first: what the student
   * reads is the playback MESSAGE beside it, and rendering the structured
   * record too would show one reading twice. `nothing` rather than dropping the
   * event, because the ordinal is real and a consumer counting positions must
   * still see it.
   */
  | { readonly render: "nothing"; readonly position: Position }
  | {
      readonly render: "message";
      readonly position: Position;
      readonly actor: "student" | "assistant" | "mentor" | "system";
      /** The ONLY free text in this union. `null` when redacted. */
      readonly content: string | null;
    }
  | {
      readonly render: "secure_control";
      readonly position: Position;
      readonly requestId: string;
      readonly channel: SecretChannel;
      readonly expiresAt: string;
    }
  | {
      readonly render: "secret_status";
      readonly position: Position;
      readonly lifecycle: SecretLifecycleWord;
      readonly requestId: string;
      /** Opaque. Resolves to nothing outside a live vault. */
      readonly handle?: string;
    }
  | {
      readonly render: "secret_rejected";
      readonly position: Position;
      readonly requestId: string;
      /**
       * A CODE. The sentence a student reads is chosen at render time from a
       * fixed table keyed by this — never carried here, because a display
       * string on a transcript item is a field somebody eventually assembles
       * from input.
       */
      readonly reason: RejectionReason;
    };

/**
 * The one mapping from event to item, used for both placements.
 *
 * Shared on purpose: a provisional student message and the durable one the
 * server writes back must render identically, or the transcript would visibly
 * flicker between two shapes at the moment the ordinal arrives. The only thing
 * that differs between them is the position, and it is the parameter.
 */
export function projectEvent(event: UnpositionedEvent, position: Position): TranscriptItem {
  switch (event.kind) {
    // ── The interview's proposal exchange renders as NOTHING ───────────
    //
    // ADR-0051. What the student reads is the playback MESSAGE, which is an
    // ordinary message event beside these. The proposal is the structured
    // record that makes their confirmation applicable; rendering it too would
    // show the same reading twice, once in prose and once as data.
    case "value_proposed":
    case "value_confirmed":
    case "value_rejected":
      return { render: "nothing", position };
    case "message":
      return { render: "message", position, actor: event.actor, content: event.content };
    case "secret_requested":
      return {
        render: "secure_control",
        position,
        requestId: event.requestId,
        channel: event.channel,
        expiresAt: event.expiresAt,
      };
    case "secret_received":
      return {
        render: "secret_status",
        position,
        lifecycle: "secret_received",
        requestId: event.requestId,
        handle: event.handle,
      };
    case "secret_consumed":
    case "secret_expired":
    case "secret_cancelled":
      return {
        render: "secret_status",
        position,
        lifecycle: event.kind,
        requestId: event.requestId,
      };
    case "secret_rejected":
      return {
        render: "secret_rejected",
        position,
        requestId: event.requestId,
        reason: event.reason,
      };
  }
}

export function projectTranscript(
  events: readonly ConversationEvent[],
): readonly TranscriptItem[] {
  return events.map((event) => projectEvent(event, durableAt(event.ordinal)));
}

/**
 * COMPILE-TIME: only the message item may carry `content`.
 *
 * Distributive, and it ends in a CONSTRAINT rather than merely evaluating to
 * `never` — a conditional type that computes `never` when a claim is false
 * fails at nothing, which is how the same assertion in `events.ts` was vacuous
 * until a regression caught it.
 */
type ContentBearing<T> = T extends unknown ? ("content" extends keyof T ? T : never) : never;
type MessageItem = Extract<TranscriptItem, { render: "message" }>;
type Exactly<T, Expected> = [T] extends [Expected]
  ? [Expected] extends [T]
    ? true
    : false
  : false;
type AssertTrue<T extends true> = T;
export type ONLY_MESSAGE_ITEMS_CARRY_CONTENT = AssertTrue<
  Exactly<ContentBearing<TranscriptItem>, MessageItem>
>;

/**
 * COMPILE-TIME: a provisional position has no ordinal.
 *
 * If a later edit added one — the obvious way to "fix" a sort, or to make a
 * provisional item comparable with a durable one — this stops compiling.
 * Written as a constraint for the reason above. Its companion, that an
 * unpositioned EVENT names no position either, lives in `unpositioned.ts`.
 */
type Provisional = Extract<Position, { placement: "provisional" }>;
type NamesAPosition<T> = T extends unknown
  ? Extract<keyof T, "ordinal" | "createdAt"> extends never
    ? never
    : T
  : never;
type AssertNever<T extends never> = T;
export type A_PROVISIONAL_POSITION_HAS_NO_ORDINAL = AssertNever<NamesAPosition<Provisional>>;
