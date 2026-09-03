/**
 * What reaches the model. The single funnel.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0026: *"The password must NEVER become part of the LLM conversation,
 * model context, chat transcript, normal message payload…"*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why a switch with no default ──────────────────────────────────────────
 *
 * Every event kind is named here explicitly. A `default:` would mean a kind
 * added later reaches the model through a branch nobody wrote for it, carrying
 * whatever fields it happens to have. With every case named, adding a kind
 * fails to compile until somebody decides what the model should be told about
 * it — which is the decision, and it should not have a default.
 */

import type { UnpositionedEvent } from "./unpositioned.js";

/** Exactly what a chat completion endpoint is given. */
export interface ModelRequest {
  readonly message: string;
  readonly history: readonly {
    readonly role: "user" | "assistant";
    readonly content: string;
  }[];
}

const HISTORY_ENTRY_MAX_CHARS = 500;
const HISTORY_TURNS = 10;
const UTTERANCE_MAX_CHARS = HISTORY_ENTRY_MAX_CHARS * 4;

/**
 * The fixed sentence a secure request becomes.
 *
 * A literal, not a template. A template is where a field that turns out to
 * carry a value gets interpolated later. The model needs to know it asked, so
 * that it does not ask again; it does not need anything the student typed, and
 * there is nothing on the event that could tell it.
 */
export const SECURE_STEP_SENTENCE = "[A secure password box was shown to the student.]";

/**
 * Takes UNPOSITIONED events, like `persistableContent` and `openSecretRequest`.
 *
 * What reaches the model is decided from `kind`, `actor`, `content`, `handle`
 * and `reason` — never from where an event sits. Requiring an ordinal would
 * have meant a caller holding a locally-drawn entry had to invent one to ask
 * what the model should see, which is the invention `log.ts` exists to remove.
 */
export function buildModelRequest(input: {
  readonly utterance: string;
  readonly events: readonly UnpositionedEvent[];
}): ModelRequest {
  const history: { role: "user" | "assistant"; content: string }[] = [];

  for (const event of input.events) {
    switch (event.kind) {
      // ── The proposal exchange is NOT history the model gets ───────────
      //
      // ADR-0051. The playback the student read is an ordinary assistant
      // message and reaches the model as one. The structured record beside it
      // would be the same reading a second time, in a shape the model would
      // try to explain — and `value_proposed` carries the confirmed-value
      // candidate itself, which has no business in a prompt.
      case "value_proposed":
      case "value_confirmed":
      case "value_rejected":
        break;
      // ── Nor is the target exchange (ADR-0058) ─────────────────────────
      //
      // Same reasoning, and one more that is specific to it: the rendered
      // offer the student read is already in the log as an assistant message
      // and reaches the model that way. What these two carry beyond it are
      // HASHES — an offer hash and a content hash — and a model that saw one
      // could repeat it into prose the student would then be invited to treat
      // as a thing they can act on. The gate is a server-side check on a
      // server-issued value; nothing about it belongs in a prompt.
      case "target_offered":
      case "target_requested":
        break;
      case "message": {
        // A redacted body is not "an empty message" — it is a message whose
        // text no longer exists. Sending the model a blank turn would put a
        // gap in the conversation it would try to explain.
        if (event.content === null) break;
        if (event.actor !== "student" && event.actor !== "assistant") break;
        history.push({
          role: event.actor === "student" ? "user" : "assistant",
          content: event.content.slice(0, HISTORY_ENTRY_MAX_CHARS),
        });
        break;
      }
      case "secret_requested":
        history.push({ role: "assistant", content: SECURE_STEP_SENTENCE });
        break;
      case "secret_received":
        // A word and an opaque handle. Vahid: *"The model should receive only
        // something equivalent to secret_received or secret_rejected, with no
        // plaintext."*
        history.push({ role: "assistant", content: `[secret_received · ${event.handle}]` });
        break;
      case "secret_consumed":
      case "secret_expired":
      case "secret_cancelled":
        history.push({ role: "assistant", content: `[${event.kind}]` });
        break;
      case "secret_rejected":
        // A code and nothing else, so the model can offer another attempt.
        history.push({ role: "assistant", content: `[secret_rejected · ${event.reason}]` });
        break;
    }
  }

  return {
    message: input.utterance.slice(0, UTTERANCE_MAX_CHARS),
    history: history.slice(-HISTORY_TURNS),
  };
}

/**
 * Everything of an event that may be written to a message body.
 *
 * A message contributes its text. Nothing else contributes anything, because
 * nothing else has anything to contribute — and the database says the same
 * thing with `CHECK ((kind = 'message') = (body_id IS NOT NULL))`.
 *
 * Takes an UNPOSITIONED event, so it can be asked BEFORE the server has placed
 * the event. A caller holding an event on its way to the log should not have to
 * invent an ordinal in order to ask what of it may be stored.
 */
export function persistableContent(event: UnpositionedEvent): string | null {
  return event.kind === "message" ? event.content : null;
}
