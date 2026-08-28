/**
 * The conversation, projected for rendering. Nothing is dropped.
 *
 * ── One event in, one item out, in order ──────────────────────────────────
 *
 * `projectTranscript` is a `map`, and that is load-bearing. An earlier client
 * used a loop with a `continue` that skipped every non-message turn, which is
 * what pushed the secure request out of the conversation and into a detached
 * panel below the composer. A `map` cannot skip: the array it returns is the
 * same length as the array it was given, and every item carries the ordinal it
 * came from.
 *
 * ── Where free text is, and is not ────────────────────────────────────────
 *
 * Exactly one item variant has `content`, and it is the one projected from a
 * message. That mirrors the event union, which mirrors the database's
 * `CHECK ((kind = 'message') = (body_id IS NOT NULL))`. The property holds at
 * three layers because it is expressed at three layers, not because one layer
 * is trusted.
 */

import type {
  ConversationEvent,
  Ordinal,
  RejectionReason,
  SecretChannel,
  SecretLifecycleWord,
} from "@askimate/aas-contracts";

export type TranscriptItem =
  | {
      readonly render: "message";
      readonly position: Ordinal;
      readonly actor: "student" | "assistant" | "mentor" | "system";
      /** The ONLY free text in this union. `null` when redacted. */
      readonly content: string | null;
    }
  | {
      readonly render: "secure_control";
      readonly position: Ordinal;
      readonly requestId: string;
      readonly channel: SecretChannel;
      readonly expiresAt: string;
    }
  | {
      readonly render: "secret_status";
      readonly position: Ordinal;
      readonly lifecycle: SecretLifecycleWord;
      readonly requestId: string;
      /** Opaque. Resolves to nothing outside a live vault. */
      readonly handle?: string;
    }
  | {
      readonly render: "secret_rejected";
      readonly position: Ordinal;
      readonly requestId: string;
      /**
       * A CODE. The sentence a student reads is chosen at render time from a
       * fixed table keyed by this — never carried here, because a display
       * string on a transcript item is a field somebody eventually assembles
       * from input.
       */
      readonly reason: RejectionReason;
    };

export function projectTranscript(
  events: readonly ConversationEvent[],
): readonly TranscriptItem[] {
  return events.map((event): TranscriptItem => {
    switch (event.kind) {
      case "message":
        return {
          render: "message",
          position: event.ordinal,
          actor: event.actor,
          content: event.content,
        };
      case "secret_requested":
        return {
          render: "secure_control",
          position: event.ordinal,
          requestId: event.requestId,
          channel: event.channel,
          expiresAt: event.expiresAt,
        };
      case "secret_received":
        return {
          render: "secret_status",
          position: event.ordinal,
          lifecycle: "secret_received",
          requestId: event.requestId,
          handle: event.handle,
        };
      case "secret_consumed":
      case "secret_expired":
      case "secret_cancelled":
        return {
          render: "secret_status",
          position: event.ordinal,
          lifecycle: event.kind,
          requestId: event.requestId,
        };
      case "secret_rejected":
        return {
          render: "secret_rejected",
          position: event.ordinal,
          requestId: event.requestId,
          reason: event.reason,
        };
    }
  });
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
