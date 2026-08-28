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
    }
  | {
      readonly kind: "secret_rejected";
      readonly reason: SecretRejectionReason;
    };

/**
 * Why an attempt failed. A CODE from a closed set — never assembled text.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The gap this closes: the client used to set a `window` variable on rejection
 * and push NO turn at all. The model therefore never learned the attempt had
 * failed, so it had no reason to try again and the conversation simply stopped
 * — a student left staring at a box that had refused them, with an assistant
 * that believed it was still waiting.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why a separate turn kind, and not another `secret_status` ─────────────
 *
 * `SecretLifecycle` has four words that are load-bearing elsewhere, and a
 * rejection is NOT a lifecycle transition: after a confirmation mismatch the
 * request is still `secret_requested`, waiting for another attempt. Folding
 * rejections into the lifecycle would either invent a fifth word or lie about
 * the state of the request.
 *
 * ── Why a union of literals rather than a string ──────────────────────────
 *
 * A `string` here is a place where someone eventually writes
 * `` `did not match: ${typed}` `` because it would be helpful. Every value
 * below is a fixed code decided before the student typed anything, so there is
 * nothing for a password to ride in on.
 */
export const SECRET_REJECTION_REASONS = [
  // Returned by the secure endpoint.
  "confirmation_mismatch",
  "empty",
  "unknown_request",
  "expired",
  "already_submitted",
  "not_your_request",
  "wrong_conversation",
  // Decided by the client, when the control could not even be used.
  "endpoint_unreachable",
  "prompt_expired",
  "client_does_not_support_secure_control",
  "insecure_context",
  "unknown_channel",
] as const;

/**
 * The closed set, derived FROM the array rather than declared beside it.
 *
 * Written as two independent declarations — a union and a runtime array — these
 * drift the moment someone adds a member to one. Deriving the type from the
 * array makes that impossible: there is one list, and the checker and the
 * runtime read the same one. `secret-routes.ts` then asserts, at compile time,
 * that every reason the SERVER can return is a member of it.
 */
export type SecretRejectionReason = (typeof SECRET_REJECTION_REASONS)[number];

/**
 * Narrows an untrusted string to the closed set.
 *
 * The reason arrives as JSON from the network, so its type is a promise rather
 * than a fact. Every client path that turns a server response into a
 * `secret_rejected` turn goes through here, so a value that is not a member
 * cannot reach the turn list, the transcript, or the model.
 *
 * A miss is not an error — it is what a client older than the server sees, and
 * the caller decides what to do about it. There is deliberately no fallback
 * built in here: a default chosen inside a parser is a default nobody reads.
 */
export function parseRejectionReason(value: unknown): SecretRejectionReason | null {
  if (typeof value !== "string") return null;
  return (SECRET_REJECTION_REASONS as readonly string[]).includes(value)
    ? (value as SecretRejectionReason)
    : null;
}

/**
 * The lifecycle words, as a list this client can carry on its own.
 *
 * ── Why this is not `SECRET_LIFECYCLE` from the secrets package ───────────
 *
 * It was, for about ten minutes. `useSecureTurn.ts` imported the array as a
 * VALUE to narrow an incoming lifecycle, and the browser bundle promptly failed
 * to build: `Could not resolve "node:crypto"`. The package's entry point
 * re-exports `store.ts`, so a value import of one constant drags
 * `InMemorySecretStore` — the thing that actually holds plaintext — toward the
 * browser. It would not have worked there, and it must never be asked to.
 *
 * So the client keeps its own list, and the type below asserts at compile time
 * that the two are the same set. A type-only import is erased; a value import
 * is a dependency.
 */
export const SECRET_LIFECYCLE_WORDS = [
  "secret_requested",
  "secret_received",
  "secret_consumed",
  "secret_expired",
  "secret_cancelled",
] as const;

/**
 * Both directions, so neither list can gain a member the other lacks.
 *
 * The same shape as the assertion in `secret-routes.ts`, for the same reason:
 * two lists in two files drift silently, and the drift here would mean the
 * client dropping a lifecycle word the store had started using.
 */
// Two declarations rather than one union of two `Exclude`s: when both sides
// match, that union is `never | never`, and the linter — correctly — reports a
// union whose constituents are redundant and duplicated. Split, each side reads
// as what it is, and each names its own direction when it fails.
type AssertNever<T extends never> = T;
export type NO_CLIENT_WORD_THE_STORE_LACKS = AssertNever<
  Exclude<(typeof SECRET_LIFECYCLE_WORDS)[number], SecretLifecycle>
>;
export type NO_STORE_WORD_THE_CLIENT_LACKS = AssertNever<
  Exclude<SecretLifecycle, (typeof SECRET_LIFECYCLE_WORDS)[number]>
>;

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
      case "secret_rejected": {
        // A code and nothing else. Deliberately NOT a template: a template is
        // where a field that turns out to carry a value gets interpolated
        // later. The model needs to know the attempt failed so it can offer to
        // try again; it does not need to know what was typed, and there is
        // nothing on this turn that could tell it.
        history.push({ role: "assistant", content: `[secret_rejected · ${turn.reason}]` });
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
