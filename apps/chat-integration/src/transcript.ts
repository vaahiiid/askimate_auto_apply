/**
 * What the student sees, in order — including the turns that are not messages.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"The student must not be forced to leave the chat at any
 * point in their journey… The entire student experience should remain inside
 * the AskiMate chat experience. However, this does not mean sensitive data
 * should become an ordinary chat message."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The bug this module exists to remove ──────────────────────────────────
 *
 * The prototype rendered the transcript like this:
 *
 *     for (const turn of turns) {
 *       if (turn.kind !== "message") continue;   // ← the directive vanishes
 *       …
 *     }
 *
 * and then placed the password control in a `<section>` *below the composer*,
 * outside the conversation entirely. So a student was asked for a password by
 * a box that appeared somewhere else, while the conversation appeared to stop.
 *
 * Nothing about that was required by the security model. `ChatTurn` has always
 * been a union in which a directive is a first-class turn sitting in the same
 * ordered list as messages. The rendering threw that away.
 *
 * ── What this module is, and what it deliberately is not ──────────────────
 *
 * `projectTranscript` turns the turn list into an ordered list of things to
 * draw. It is pure, it has no DOM, and it has no framework. That matters for
 * three reasons:
 *
 *   1. The ordering property — *a secure request occupies its real position in
 *      the conversation* — is the architectural claim, and it is testable here
 *      without a renderer.
 *   2. AskiMate's own client is React today and may not be later. A projection
 *      binds it to a decision that has already been argued about, the same way
 *      `decideRendering` does.
 *   3. **A projection cannot leak.** It has no inputs other than turns and no
 *      outputs other than display data, so there is no seam where a password
 *      could enter. The type system carries that: see `TranscriptItem`.
 *
 * ── The property that makes this safe, stated as a type ───────────────────
 *
 * Exactly one variant of `TranscriptItem` carries free text, and it is the one
 * projected from `kind: "message"`. The other variants carry identifiers,
 * lifecycle words and prompt metadata that was fixed *before the student typed
 * anything*. There is no field on them that could hold input, which is the same
 * property `ChatTurn` has and the reason the projection can be trusted to
 * preserve it: it cannot invent a field the source union does not have.
 */

import type { SecretPrompt } from "@askimate/aas-secrets";

import type { ChatTurn } from "./chat-transport.js";

/**
 * One thing to draw, in transcript order.
 *
 * `position` is the index in the ORIGINAL turn list, not in the projection.
 * They are the same today because nothing is dropped — which is the point —
 * but a caller that later filters (a "hide system messages" toggle, say) needs
 * the stable original position to keep a persisted ordinal meaningful. See
 * `askimate_conversation_events.ordinal`.
 */
export type TranscriptItem =
  | {
      readonly render: "message";
      readonly position: number;
      readonly sender: "user" | "ai" | "mentor" | "system";
      /** The ONLY free text in this union. */
      readonly content: string;
    }
  | {
      readonly render: "secure_control";
      readonly position: number;
      /**
       * Everything needed to draw the card. Metadata only — every field was
       * decided before the student typed, so none of them can carry input.
       *
       * Note this is the prompt as received, not a copy of anything typed into
       * it. The control's value lives in the input element and is read at
       * submit; it never travels back through a turn, so it can never arrive
       * here on a re-render or a replay.
       */
      readonly prompt: SecretPrompt;
    }
  | {
      readonly render: "secret_status";
      readonly position: number;
      readonly lifecycle: string;
      /** Opaque. Resolves to nothing outside the store. */
      readonly handle?: string;
    };

/**
 * Projects the turn list into display order. Nothing is dropped.
 *
 * The absence of a `continue` in this function IS the fix. Every turn produces
 * exactly one item, so a directive occupies its real position between the
 * message that preceded it and the one that follows — which is what "inline in
 * the conversation" means when written as code rather than as a screenshot.
 */
export function projectTranscript(turns: readonly ChatTurn[]): readonly TranscriptItem[] {
  return turns.map((turn, position): TranscriptItem => {
    switch (turn.kind) {
      case "message":
        return {
          render: "message",
          position,
          sender: turn.sender,
          content: turn.content,
        };
      case "directive":
        return { render: "secure_control", position, prompt: turn.prompt };
      case "secret_status":
        return {
          render: "secret_status",
          position,
          lifecycle: turn.lifecycle,
          ...(turn.handle === undefined ? {} : { handle: turn.handle }),
        };
    }
  });
}

/**
 * Whether a secure request is open, derived from the transcript itself.
 *
 * Derived rather than tracked, because a separately-tracked boolean is a second
 * source of truth that drifts — and the thing it would gate is the composer,
 * where drifting *open* means an enabled send button next to a password box.
 *
 * "Open" means the last secure control in the transcript has no status after
 * it. A status of any kind — received, consumed, expired — closes it, and so
 * does a later directive superseding an earlier one.
 *
 * This is the CLIENT's view and it is not a security control. It decides what
 * to draw. The server decides what to accept, from the database, and does not
 * trust this. See `docs/composer-during-secure-turn.md` §1.
 */
export function openSecureRequest(items: readonly TranscriptItem[]): SecretPrompt | null {
  let open: SecretPrompt | null = null;
  for (const item of items) {
    if (item.render === "secure_control") open = item.prompt;
    else if (item.render === "secret_status") open = null;
  }
  return open;
}
