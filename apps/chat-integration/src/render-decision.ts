/**
 * What the chat client does with a `request_secret` directive — and what it
 * must never do.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"The normal chat input must never automatically fall
 * back to sending the password as ordinary text. If the secure control is
 * unavailable or unsupported, fail closed. Do not silently fall back to the
 * ordinary message input."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is a pure function and not JSX ───────────────────────────────
 *
 * The decision is the part that has to be right. A React component that got
 * this logic wrong would be wrong in every framework it was ported to, and a
 * component that got it right is a thin shell around these three cases.
 * Keeping the decision separate means it is testable without a renderer, and
 * means AskiMate's own client — React today, whatever it is later — binds to a
 * decision that has already been argued about.
 *
 * ── The union has no third option, deliberately ───────────────────────────
 *
 * `RenderDecision` is `secure_control | refuse`. There is **no
 * `chat_message`**, so the fallback Vahid is worried about is not a branch
 * someone forgot to remove — it is a value that does not exist and cannot be
 * returned. A client that wanted to fall back would have to construct the
 * message itself, in code a reviewer would see.
 */

import type { SecretPrompt } from "@askimate/aas-secrets";

/**
 * A prompt as it ARRIVES, before anything has checked what it is.
 *
 * `SecretPrompt.channel` is the literal `"secure_control"`, so a function
 * taking a `SecretPrompt` cannot meaningfully check the channel — TypeScript
 * knows the comparison is always false, and the linter says so.
 *
 * But the prompt reaches a chat client as JSON over a wire, where `channel` is
 * whatever the server sent. Widening it here is what makes the guard in
 * `decideRendering` load-bearing rather than decorative: a future protocol
 * version that adds a second channel must be refused by a client that does not
 * understand it, not rendered as though it were the one channel this code
 * knows about.
 */
export type UncheckedSecretPrompt = Omit<SecretPrompt, "channel"> & {
  readonly channel: string;
};

/** What the client can actually do. Reported by the client, not assumed. */
export interface ClientCapabilities {
  /** The client ships a password control and knows this protocol version. */
  readonly supportsSecureControl: boolean;
  /**
   * The page is on a secure origin.
   *
   * A password field over plain HTTP is a password on the wire in the clear.
   * `localhost` counts as secure, per the browsers' own rule, which is what
   * makes local development possible without an exception here.
   */
  readonly secureContext: boolean;
  /** The secure endpoint answered its health check. */
  readonly endpointReachable: boolean;
}

export type RenderDecision =
  | { readonly render: "secure_control"; readonly prompt: SecretPrompt }
  | {
      readonly render: "refuse";
      readonly reason:
        | "client_does_not_support_secure_control"
        | "insecure_context"
        | "endpoint_unreachable"
        | "prompt_expired"
        | "unknown_channel";
      /** Shown to the student. Fixed text — never assembled from input. */
      readonly say: string;
    };

const REFUSAL_TEXT: Readonly<Record<Exclude<RenderDecision, { render: "secure_control" }>["reason"], string>> =
  {
    client_does_not_support_secure_control:
      "I need to ask you for a password, but this version of the app cannot show a secure " +
      "password box. Please update the app, or open your university's portal and set the " +
      "password there yourself — I will wait. Do not type a password into the chat.",
    insecure_context:
      "I need to ask you for a password, but this page is not on a secure connection, so I will " +
      "not ask for one here. Please reopen AskiMate over https. Do not type a password into the " +
      "chat.",
    endpoint_unreachable:
      "I need to ask you for a password, but I cannot reach the secure service that would " +
      "receive it. Nothing is wrong with your account — please try again in a moment. Do not " +
      "type a password into the chat.",
    prompt_expired:
      "The password box timed out before it opened. I will ask you again in a moment. Do not " +
      "type a password into the chat.",
    unknown_channel:
      "I was asked to collect something in a way this app does not recognise, so I have not " +
      "shown you a box. This is a bug on our side, not a problem with your account.",
  };

/**
 * Decides. Fails closed in every case that is not a clean success.
 *
 * Note that every refusal message ends with *"Do not type a password into the
 * chat"*. That sentence is doing real work: the student has just been told
 * AskiMate needs a password and cannot take one, and the obvious next thing a
 * helpful person does is type it into the box that is right there.
 */
export function decideRendering(input: {
  readonly prompt: UncheckedSecretPrompt;
  readonly capabilities: ClientCapabilities;
  readonly now: Date;
}): RenderDecision {
  const { prompt, capabilities } = input;

  // Checked first. A prompt for a channel this code does not know about must
  // not be examined further — the fields might not mean what they appear to.
  if (prompt.channel !== "secure_control") {
    return { render: "refuse", reason: "unknown_channel", say: REFUSAL_TEXT.unknown_channel };
  }
  if (!capabilities.supportsSecureControl) {
    return {
      render: "refuse",
      reason: "client_does_not_support_secure_control",
      say: REFUSAL_TEXT.client_does_not_support_secure_control,
    };
  }
  if (!capabilities.secureContext) {
    return { render: "refuse", reason: "insecure_context", say: REFUSAL_TEXT.insecure_context };
  }
  if (!capabilities.endpointReachable) {
    return {
      render: "refuse",
      reason: "endpoint_unreachable",
      say: REFUSAL_TEXT.endpoint_unreachable,
    };
  }
  if (input.now.getTime() >= prompt.expiresAt.getTime()) {
    return { render: "refuse", reason: "prompt_expired", say: REFUSAL_TEXT.prompt_expired };
  }

  // Narrowed by the check above: `channel` has been established as the one
  // value this client understands, so it is a `SecretPrompt` from here.
  return { render: "secure_control", prompt: prompt as SecretPrompt };
}

/**
 * Whether the ordinary chat input may be used at all while a box is open.
 *
 * `false` while a secret is being collected. Not to force the student's hand —
 * they can always cancel — but because an enabled text box next to a password
 * prompt is an invitation to type the password into it, and a disabled one is
 * the cheapest possible guard against the single most likely leak in the whole
 * design: the student pasting it into the wrong field.
 */
export function chatInputEnabled(state: {
  readonly awaitingSecret: boolean;
}): boolean {
  return !state.awaitingSecret;
}
