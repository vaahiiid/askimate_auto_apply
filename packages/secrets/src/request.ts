/**
 * What the model is allowed to ask for, and what the chat is required to
 * render.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-26:
 *
 *   *"The LLM must never receive the password. The model may issue
 *   `request_secret` with metadata only."*
 *
 *   *"The Chat UI must render a dedicated password control. Do NOT accept
 *   passwords through ordinary chat text."*
 *
 *   *"Never ask 'What is your password?' in ordinary conversational text."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The realistic failure this is shaped against ──────────────────────────
 *
 * Nobody is going to write `askStudent("what is your password?")` on purpose.
 * What happens instead is that the password question becomes *one more field*
 * in an interview that already asks fifteen questions, because that is the
 * path of least resistance and the interview already works. The student types
 * it as a chat message, it lands in the transcript, the transcript goes to the
 * model as context on the next turn, and it is now in a place nobody can get
 * it out of.
 *
 * So a secret request is a DIFFERENT TYPE from an interview question. It is
 * not a `FieldSpec`, it does not go through `nextAction`, and there is no
 * function that turns one into the other. AskiMate Chat receives a
 * `SecretPrompt` and must render its own control; a chat that ignored it and
 * printed `prompt.title` as a message would be showing the student a heading
 * with no input under it, which fails visibly rather than silently.
 *
 * ── Nothing here is derived from a password ───────────────────────────────
 *
 * Every field on every type in this file is decided BEFORE the student types
 * anything. There is no place for a length, a strength score, a hash or a
 * masked preview, because each of those is a fact about the secret and would
 * travel wherever the metadata travels — which includes the model.
 */

import type { StudentId } from "@askimate/aas-domain";

import type { SecretPurpose, SecretRequestId, SecretTarget } from "./handle.js";

// ───────────────────────────────────────────────────────────────────────────
// What the model issues
// ───────────────────────────────────────────────────────────────────────────

/**
 * The model's `request_secret` call. Metadata only.
 *
 * This is the whole surface the model has. It can ask for a secret, say what
 * it is for and where it goes, and explain itself to the student. It cannot
 * read one, and there is no second call that would let it.
 */
export interface SecretRequest {
  readonly studentRef: StudentId;
  readonly purpose: SecretPurpose;
  readonly target: SecretTarget;
  /**
   * What the student is told, in the model's own words.
   *
   * The model writes this because it is conversational text and that is what
   * the model is for. It is shown to a human and never submitted anywhere —
   * the same category as an interview question's wording.
   */
  readonly explanation: string;
  /**
   * Whether the secret may be spent more than once.
   *
   * Typed as the literal `true` rather than a boolean. Vahid's requirement was
   * *"single-use"*, and a `boolean` here would be a field someone could set to
   * `false` in a hurry; a literal type means allowing reuse requires changing
   * this file and explaining why in the diff.
   */
  readonly singleUse: true;
  /** How long the student has before it is destroyed unspent. */
  readonly ttlSeconds: number;
}

/** Why a request was refused. Refusals are ordinary; none of them is a bug. */
export interface SecretRequestRefusal {
  readonly reason:
    | "ttl_too_long"
    | "ttl_too_short"
    | "explanation_missing"
    | "explanation_looks_like_a_password"
    | "target_host_missing";
  readonly detail: string;
}

/**
 * The longest a secret may sit unspent.
 *
 * Fifteen minutes is long enough for a student to be interrupted mid-flow and
 * come back, and short enough that an abandoned session does not leave a live
 * password in memory for an afternoon. It is a ceiling, not a default: a
 * caller asking for less gets less.
 */
export const MAX_TTL_SECONDS = 15 * 60;
/** Below this the student cannot realistically finish typing and confirming. */
export const MIN_TTL_SECONDS = 30;

// ───────────────────────────────────────────────────────────────────────────
// What the chat renders
// ───────────────────────────────────────────────────────────────────────────

/**
 * The instruction to AskiMate Chat to open its secure control.
 *
 * Everything here is display text and layout. The `channel` discriminant is
 * the part that matters: a chat client that does not understand
 * `"secure_control"` must refuse to render the prompt rather than fall back to
 * a text message, and the field exists so that refusal is possible.
 */
export interface SecretPrompt {
  readonly requestId: SecretRequestId;
  /**
   * How this must be collected. One value, and it is not "chat message".
   *
   * Vahid: *"Do NOT accept passwords through ordinary chat text."*
   */
  readonly channel: "secure_control";
  /** e.g. "Create a password for your university application". */
  readonly title: string;
  /** The model's explanation, shown under the title. */
  readonly explanation: string;
  /** Whether the control shows a second "confirm" box. */
  readonly requiresConfirmation: boolean;
  /** The portal the password is for, shown so the student can see it. */
  readonly portalHost: string;
  /** When the control stops accepting input. */
  readonly expiresAt: Date;
  /**
   * The rules the portal was OBSERVED to enforce, shown as guidance.
   *
   * Empty when discovery has not observed any. An invented rule shown to a
   * student is a small lie that makes them choose a worse password.
   */
  readonly observedRules: readonly string[];
}

/**
 * Turns a model-issued request into the prompt the chat renders, or refuses.
 *
 * Pure, and it takes the clock as an argument. The `requestId` is passed in
 * rather than generated here so that this function has no I/O and no
 * randomness — the store mints ids, and a test can pin one.
 */
export function buildSecretPrompt(input: {
  readonly requestId: SecretRequestId;
  readonly request: SecretRequest;
  readonly now: Date;
  /** Password rules observed on this portal. Never invented. */
  readonly observedRules?: readonly string[];
}):
  | { readonly ok: true; readonly prompt: SecretPrompt }
  | { readonly ok: false; readonly refusal: SecretRequestRefusal } {
  const { request } = input;

  if (request.target.host.trim().length === 0) {
    return {
      ok: false,
      refusal: {
        reason: "target_host_missing",
        detail:
          "A secret is bound to the host it will be typed into. Without one there is nothing " +
          "stopping the handle being spent against a different portal.",
      },
    };
  }
  if (request.ttlSeconds > MAX_TTL_SECONDS) {
    return {
      ok: false,
      refusal: {
        reason: "ttl_too_long",
        detail:
          `A secret may live at most ${String(MAX_TTL_SECONDS)} seconds; ` +
          `${String(request.ttlSeconds)} was asked for. The ceiling is what stops an abandoned ` +
          `conversation leaving a live password in memory.`,
      },
    };
  }
  if (request.ttlSeconds < MIN_TTL_SECONDS) {
    return {
      ok: false,
      refusal: {
        reason: "ttl_too_short",
        detail:
          `${String(request.ttlSeconds)} seconds is not long enough for a student to type a ` +
          `password and confirm it. Expiring under their fingers would send them round the ` +
          `loop again for no safety gain.`,
      },
    };
  }
  if (request.explanation.trim().length === 0) {
    return {
      ok: false,
      refusal: {
        reason: "explanation_missing",
        detail:
          "A student being asked for a password must be told what it is for. An unexplained " +
          "password box in a chat window is indistinguishable from a phishing attempt.",
      },
    };
  }
  if (looksLikeAPassword(request.explanation)) {
    // The model writes the explanation. If a password ever appears in it —
    // because a student typed one into ordinary chat and the model echoed it
    // back — this is the last place to stop it becoming a rendered prompt.
    return {
      ok: false,
      refusal: {
        reason: "explanation_looks_like_a_password",
        detail:
          "The explanation contains something shaped like a credential. Explanations are shown " +
          "to the student and stored in the transcript; a password must not be in one. This is " +
          "usually a sign that a password reached the conversation through ordinary chat text, " +
          "which is the thing the secure control exists to prevent.",
      },
    };
  }

  return {
    ok: true,
    prompt: {
      requestId: input.requestId,
      channel: "secure_control",
      title: titleFor(request.purpose),
      explanation: request.explanation.trim(),
      // Confirmation on creation, where a typo becomes an account nobody can
      // get into. Not on sign-in, where the portal itself tells them at once.
      requiresConfirmation: request.purpose === "portal_account_creation",
      portalHost: request.target.host,
      expiresAt: new Date(input.now.getTime() + request.ttlSeconds * 1000),
      observedRules: input.observedRules ?? [],
    },
  };
}

const TITLES: Readonly<Record<SecretPurpose, string>> = {
  portal_account_creation: "Create a password for your university application",
  portal_sign_in: "Enter your university portal password",
};

function titleFor(purpose: SecretPurpose): string {
  return TITLES[purpose];
}

/**
 * A deliberately crude check for credential-shaped text.
 *
 * It is not a password detector and cannot be one. It catches the realistic
 * case — a lone token with mixed case, a digit and a symbol, sitting in prose
 * that should be a sentence — and it is a backstop behind the architecture,
 * not the defence itself.
 */
function looksLikeAPassword(text: string): boolean {
  return text.split(/\s+/).some((word) => {
    if (word.length < 8 || word.length > 128) return false;
    if (/^https?:\/\//i.test(word)) return false;
    return (
      /[a-z]/.test(word) && /[A-Z]/.test(word) && /[0-9]/.test(word) && /[^A-Za-z0-9]/.test(word)
    );
  });
}
