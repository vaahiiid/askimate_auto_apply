/**
 * What reaches the model, and the one turn shape that is not a message.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"Prove that this marker does NOT appear in incoming
 * model messages, model context, prompts, tool arguments, streamed tokens,
 * conversation database, chat history, message events…"*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The leak this file is shaped against, found by reading the real code ──
 *
 * `POST /api/askimate/ai` takes `{ message, history }` where **`history` comes
 * from the request body** — the client sends it — and the route replays the
 * last ten entries into the prompt (`askimate-ai.ts`, `safeHistory`). The chat
 * route separately persists every turn to `askimate_messages.content`, and the
 * dashboard reads them back to build that history.
 *
 * So a password that becomes a message is not stored once. It is:
 *
 *   1. written to `askimate_messages.content` as plain text,
 *   2. read back by the dashboard on every load,
 *   3. sent to the server in `history` on every subsequent turn,
 *   4. **and interpolated into the model's prompt each time**, for as long as
 *      it stays within the last ten turns.
 *
 * There is no redaction anywhere on that path, and there is no mechanism for
 * removing a message once written. That is the finding that makes the secure
 * control necessary rather than merely tidy.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 * A `SecretPrompt` is delivered as an **assistant turn with a `directive`**,
 * never as message content. `buildModelRequest` below is the single funnel
 * through which anything reaches the model, and it copies only `content` from
 * turns whose kind is `message`. A directive turn contributes nothing to the
 * prompt but its own metadata.
 */

import type { SecretLifecycle, SecretPrompt } from "@askimate/aas-secrets";

/**
 * One turn in a conversation, as stored and as replayed.
 *
 * The union is the point. A `message` carries text a human or the model wrote.
 * A `directive` carries an instruction to the CHAT CLIENT and has no text
 * field at all — so there is no place on it for a typed value to sit, and no
 * branch of `buildModelRequest` that could copy one.
 */
export type ChatTurn =
  | {
      readonly kind: "message";
      readonly sender: "user" | "ai" | "mentor" | "system";
      readonly content: string;
    }
  | {
      readonly kind: "directive";
      readonly directive: "request_secret";
      readonly prompt: SecretPrompt;
    }
  | {
      readonly kind: "secret_status";
      readonly lifecycle: SecretLifecycle;
      /** Opaque, and safe to show the model. Resolves to nothing outside the store. */
      readonly handle?: string;
    };

/** Exactly what `POST /api/askimate/ai` accepts. Transcribed. */
export interface ModelRequest {
  readonly message: string;
  readonly history: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
}

const HISTORY_ENTRY_MAX_CHARS = 500;
const HISTORY_TURNS = 10;

/**
 * Assembles what goes to the model. **The only funnel.**
 *
 * Mirrors `safeHistory` in the real route — the same ten-turn window, the same
 * 500-character clamp — and adds the one thing the real route has no reason to
 * have: it can only read `content`, and only `message` turns have one.
 *
 * A `directive` turn contributes a fixed, literal sentence. Not a template
 * containing anything from the prompt object, because a template is where
 * someone later interpolates a field that turns out to carry a value.
 */
export function buildModelRequest(input: {
  readonly utterance: string;
  readonly turns: readonly ChatTurn[];
}): ModelRequest {
  const history: { role: "user" | "assistant"; content: string }[] = [];

  for (const turn of input.turns) {
    switch (turn.kind) {
      case "message": {
        if (turn.sender !== "user" && turn.sender !== "ai") break;
        history.push({
          role: turn.sender === "user" ? "user" : "assistant",
          content: turn.content.slice(0, HISTORY_ENTRY_MAX_CHARS),
        });
        break;
      }
      case "directive": {
        // A fixed sentence. The model needs to know it asked, so that it does
        // not ask again; it does not need anything the student typed, and
        // there is nothing on this turn that it could be given.
        history.push({
          role: "assistant",
          content: "[A secure password box was shown to the student.]",
        });
        break;
      }
      case "secret_status": {
        // The four words, and the handle. Vahid: *"The model should receive
        // only something equivalent to secret_received or secret_rejected,
        // with no plaintext."*
        history.push({
          role: "assistant",
          content:
            turn.handle === undefined
              ? `[${turn.lifecycle}]`
              : `[${turn.lifecycle} · ${turn.handle}]`,
        });
        break;
      }
    }
  }

  return {
    message: input.utterance.slice(0, HISTORY_ENTRY_MAX_CHARS * 4),
    history: history.slice(-HISTORY_TURNS),
  };
}

/**
 * Whether a turn may be persisted to `askimate_messages`.
 *
 * `askimate_messages.content` is `text NOT NULL` and everything in it is
 * replayed to the model. A directive has no content to write, and writing a
 * rendering of one would be inventing the very text this design avoids.
 */
export function persistableContent(turn: ChatTurn): string | null {
  return turn.kind === "message" ? turn.content : null;
}
