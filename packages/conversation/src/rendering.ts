/**
 * Whether this client can show a secure step at all, and what it says if not.
 *
 * ── What this decision needs, and what it deliberately does not ───────────
 *
 * It takes the CHANNEL and the EXPIRY, and nothing else about the request.
 * The superseded version took a whole `SecretPrompt` — title, explanation,
 * portal host — because in the same-origin design the conversation page
 * rendered those itself.
 *
 * Under ADR-0030 it does not have them and never will: the Secure Interaction
 * Service holds the prompt and renders it inside its own document, on its own
 * origin. So this signature is not merely narrower, it is the widest one the
 * architecture permits. A decision that cannot reach the prompt cannot leak it.
 *
 * ── There is no `chat_message` outcome ────────────────────────────────────
 *
 * The fallback that would collect a password as an ordinary chat message is
 * not a branch somebody forgot to remove. It is a value that does not exist in
 * the `RenderDecision` union, so writing it would mean widening the type.
 */

import type { RejectionReason, SecretChannel } from "@askimate/aas-contracts";
import { parseSecretChannel } from "@askimate/aas-contracts";

/** What the client can actually do. Reported by the client, never assumed. */
export interface ClientCapabilities {
  /** This build ships a secure control and understands this protocol version. */
  readonly supportsSecureControl: boolean;
  /**
   * `window.isSecureContext`. A password box on a plain-http page is a
   * password box whose contents are readable in transit.
   */
  readonly secureContext: boolean;
  /** The secure origin answered its health check. */
  readonly endpointReachable: boolean;
}

/** The channel as it arrives — a claim, not yet a fact. */
export interface UncheckedSecureStep {
  readonly channel: string;
  readonly expiresAt: Date;
}

/** A checked step, with the channel established as one this client renders. */
export interface SecureStep {
  readonly channel: SecretChannel;
  readonly expiresAt: Date;
}

export type RenderDecision =
  | { readonly render: "secure_control"; readonly step: SecureStep }
  | {
      readonly render: "refuse";
      readonly reason: Extract<
        RejectionReason,
        | "client_does_not_support_secure_control"
        | "insecure_context"
        | "endpoint_unreachable"
        | "prompt_expired"
        | "unknown_channel"
      >;
      /** Shown to the student. Fixed text — never assembled from input. */
      readonly say: string;
    };

type RefusalReason = Extract<RenderDecision, { render: "refuse" }>["reason"];

const REFUSAL_TEXT: Readonly<Record<RefusalReason, string>> = {
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

export function decideRendering(input: {
  readonly step: UncheckedSecureStep;
  readonly capabilities: ClientCapabilities;
  readonly now: Date;
}): RenderDecision {
  const { step, capabilities } = input;

  // Checked FIRST. A step for a channel this code does not know must not be
  // examined further — its other fields might not mean what they appear to.
  const channel = parseSecretChannel(step.channel);
  if (channel === null) {
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
  if (input.now.getTime() >= step.expiresAt.getTime()) {
    return { render: "refuse", reason: "prompt_expired", say: REFUSAL_TEXT.prompt_expired };
  }

  return { render: "secure_control", step: { channel, expiresAt: step.expiresAt } };
}

/** The fixed refusal wording, for a caller that already has a reason. */
export function refusalText(reason: RefusalReason): string {
  return REFUSAL_TEXT[reason];
}
