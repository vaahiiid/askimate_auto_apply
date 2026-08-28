/**
 * The container that owns the conversation, and owns nothing else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Treat the existing tested TypeScript security modules as
 * the single authority. Do not duplicate rendering, transcript, open-request,
 * composer, or security decisions in new client code."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this file is, and what it deliberately is not ────────────────────
 *
 * The vanilla harness hand-copied five decisions into browser JavaScript:
 * whether to render a control, how to order the transcript, whether a request
 * is open, what the composer may do, and what a rejection means. Five copies of
 * a rule is five chances to drift, and one of them had already drifted — the
 * harness closed the card on every rejection but a mismatch, while
 * `openSecureRequest` says a rejection closes nothing.
 *
 * So this hook decides none of those. It calls `decideRendering`,
 * `projectTranscript`, `openSecureRequest` and `composerPolicy`, and its own
 * body contains no rule that could disagree with them. What it adds is the part
 * those pure functions cannot have: the turn list, and the three network calls
 * that move a request between lifecycle states.
 *
 * ── What is NOT in this state ─────────────────────────────────────────────
 *
 * The password, and the composer draft. Neither is here, and neither can be:
 *
 *   - The password lives inside `SecureControl`'s submit handler and dies when
 *     it returns. This hook is handed a HANDLE, or a reason code.
 *   - The draft lives in the composer's DOM element. An uncontrolled input for
 *     the same reason the password field is uncontrolled — a student who types
 *     a password into the wrong box has made a mistake, and a controlled input
 *     would turn that mistake into React state that an error boundary or a
 *     state-serialising reporter can read. Uncontrolled, it is a DOM value that
 *     nothing snapshots.
 *
 * ── PROVISIONAL ───────────────────────────────────────────────────────────
 *
 * Nothing here is a UI decision. This file contains no markup, no copy and no
 * styling; it is the state machine that a real AskiMate interface would drive.
 */

import { useCallback, useMemo, useState } from "react";

import type { SecretLifecycle, SecretPrompt } from "@askimate/aas-secrets";

import type { ChatSendResponse } from "./chat-routes.js";
import type { ChatTurn, SecretRejectionReason } from "./chat-transport.js";
import { SECRET_LIFECYCLE_WORDS, parseRejectionReason } from "./chat-transport.js";
import {
  composerPolicy,
  decideRendering,
  type ClientCapabilities,
  type ComposerPolicy,
  type UncheckedSecretPrompt,
} from "./render-decision.js";
import { openSecureRequest, projectTranscript, type TranscriptItem } from "./transcript.js";

/**
 * A turn as it arrives, with the prompt still unchecked.
 *
 * `decideRendering` takes an `UncheckedSecretPrompt` precisely because a
 * directive comes off a network and its `channel` is a claim rather than a
 * fact. Typing the incoming turn as a `ChatTurn` here would assert that claim
 * before anything had checked it.
 */
export type ReceivedTurn =
  | Extract<ChatTurn, { kind: "message" | "secret_status" | "secret_rejected" }>
  | {
      readonly kind: "directive";
      readonly directive: "request_secret";
      readonly prompt: UncheckedSecretPrompt;
    };

/** The result of trying to send an ordinary message. */
export type SendOutcome =
  | { readonly outcome: "accepted" }
  /** The server has an open secure request. The draft is untouched. */
  | { readonly outcome: "held"; readonly requestId: string }
  /** Anything else — a dropped connection, a 500. The draft is untouched. */
  | { readonly outcome: "failed" };

/**
 * The three network calls this container makes.
 *
 * Injected as one object so a test can drive the whole state machine without a
 * server, and so it is visible in one place that the container never posts
 * anything but a message id, a message body and a delete.
 */
export interface SecureTurnTransport {
  /** `POST /api/askimate/ai`. */
  readonly send: (input: {
    readonly conversationId: number;
    readonly content: string;
  }) => Promise<{ readonly ok: boolean; readonly body: unknown }>;
  /** `DELETE /api/askimate/secret/:requestId`. Resolves true on a 200. */
  readonly cancel: (requestId: string) => Promise<boolean>;
}

export interface SecureTurnInput {
  readonly conversationId: number;
  /**
   * What this client can do, read at the moment a directive arrives.
   *
   * A function rather than a value, for the same reason `now` is one: both are
   * facts about the environment at the instant of the decision, not constants
   * fixed when the container was built. A page whose connection drops between
   * mount and directive should report `endpointReachable: false` then, not the
   * answer it would have given a minute earlier.
   */
  readonly capabilities: () => ClientCapabilities;
  readonly transport: SecureTurnTransport;
  /**
   * The clock, injected — required, not defaulted.
   *
   * A `now = () => new Date()` default here would be an ambient clock read in
   * the one file where every expiry decision passes through, and the repository
   * lint rule that forbids exactly that caught it. The page supplies its own
   * clock at the mount, where reading one is legitimate and visible.
   */
  readonly now: () => Date;
}

export interface SecureTurnState {
  readonly turns: readonly ChatTurn[];
  readonly items: readonly TranscriptItem[];
  /** The control to draw, from `openSecureRequest`. Null when nothing is open. */
  readonly openPrompt: SecretPrompt | null;
  /** Fixed refusal text from `decideRendering`. Never assembled from input. */
  readonly refusal: { readonly reason: SecretRejectionReason; readonly say: string } | null;
  readonly composer: ComposerPolicy;
  readonly receive: (turn: ReceivedTurn) => void;
  readonly submitted: (handle: string) => void;
  readonly rejected: (reason: SecretRejectionReason) => void;
  readonly cancel: () => void;
  readonly send: (content: string) => Promise<SendOutcome>;
}

export function useSecureTurn(input: SecureTurnInput): SecureTurnState {
  const [turns, setTurns] = useState<readonly ChatTurn[]>([]);
  const [refusal, setRefusal] = useState<SecureTurnState["refusal"]>(null);
  /**
   * The request the SERVER says is open, learned from a 409.
   *
   * This is not a second opinion about openness — it is the same fact from the
   * other end. A client that has been open in a tab across a restart, or that
   * missed a directive, has an empty transcript and a live request; the 409
   * tells it so. Held separately from the turn list because there is no turn to
   * append: we know a request exists, and we do not know its prompt, so
   * inventing a directive turn would put a card on screen with no content.
   */
  const [serverOpenRequestId, setServerOpenRequestId] = useState<string | null>(null);

  const { conversationId, capabilities, transport } = input;
  const now = input.now;

  const items = useMemo(() => projectTranscript(turns), [turns]);
  const openPrompt = useMemo(() => openSecureRequest(items), [items]);

  // The only composition of the two sources of "is a request open". Both are
  // asked; either one blocks. `composerPolicy` decides what blocking MEANS.
  const composer = composerPolicy({
    awaitingSecret: openPrompt !== null || serverOpenRequestId !== null,
  });

  const append = useCallback((turn: ChatTurn): void => {
    setTurns((previous) => [...previous, turn]);
  }, []);

  const receive = useCallback(
    (turn: ReceivedTurn): void => {
      if (turn.kind !== "directive") {
        append(turn);
        return;
      }

      const decision = decideRendering({
        prompt: turn.prompt,
        capabilities: capabilities(),
        now: now(),
      });

      if (decision.render === "refuse") {
        // ── FAIL CLOSED, and then close the request ─────────────────────
        //
        // The directive is NOT appended. `projectTranscript` would map it to a
        // `secure_control` item and the view would try to draw a card this
        // client has just established it cannot draw.
        //
        // Instead: the model is told, in a code from the closed set, that the
        // step failed and why — otherwise it waits for a submission that will
        // never come. And the server-side request is CANCELLED, because a live
        // request that no client can service would block this conversation's
        // composer for the whole TTL and produce nothing but 409s.
        setRefusal({ reason: decision.reason, say: decision.say });
        append({ kind: "secret_rejected", reason: decision.reason });
        void transport.cancel(turn.prompt.requestId).then((cancelled) => {
          // Only on a confirmed 200. Appending the status turn on a failed
          // delete would tell the transcript a request was closed that is still
          // open on the server, which is the divergence this whole phase is
          // about. If the delete failed, the TTL closes it and the composer
          // stays guarded by the server's 409 until then.
          if (cancelled) append({ kind: "secret_status", lifecycle: "secret_cancelled" });
        });
        return;
      }

      setRefusal(null);
      append({ kind: "directive", directive: "request_secret", prompt: decision.prompt });
    },
    [append, capabilities, now, transport],
  );

  const submitted = useCallback(
    (handle: string): void => {
      // A lifecycle transition, which is the only thing `openSecureRequest`
      // accepts as closing a request. The handle is opaque and safe to hold.
      append({ kind: "secret_status", lifecycle: "secret_received", handle });
      setServerOpenRequestId(null);
    },
    [append],
  );

  const rejected = useCallback(
    (reason: SecretRejectionReason): void => {
      // Appended, and NOTHING ELSE. In particular the request is not closed:
      // `openSecureRequest` deliberately ignores a rejection, so a mistyped
      // confirmation leaves the card exactly where it was and the student
      // simply tries again. The harness closed the card here for every reason
      // but a mismatch, which released the composer while the server still had
      // the request open — see docs/composer-during-secure-turn.md.
      append({ kind: "secret_rejected", reason });
    },
    [append],
  );

  const cancel = useCallback((): void => {
    // `??` rather than a second null test afterwards: the linter pointed out
    // that once both have been ruled out the result cannot be null, so the
    // extra guard was unreachable code pretending to be caution.
    const requestId = openPrompt?.requestId ?? serverOpenRequestId;
    if (requestId === null) return;

    void transport.cancel(requestId).then((cancelled) => {
      if (cancelled) {
        // ADR-0032: cancellation is its own word. It behaves identically to
        // expiry for every guard — both terminal, both release the composer —
        // and it reads differently to the model, the student and analytics.
        append({ kind: "secret_status", lifecycle: "secret_cancelled" });
        setServerOpenRequestId(null);
        return;
      }
      // The request is still open. Say so as a rejection, which by design does
      // not close it — the card stays and the student can still finish.
      append({ kind: "secret_rejected", reason: "endpoint_unreachable" });
    });
  }, [append, openPrompt, serverOpenRequestId, transport]);

  const send = useCallback(
    async (content: string): Promise<SendOutcome> => {
      // No guard of its own. The caller is a composer whose `send` the policy
      // above has already set to "blocked"; a second rule here would be a
      // second place for the answer to be wrong. The authority that actually
      // matters is the server's, and it is consulted below.
      const { ok, body } = await transport.send({ conversationId, content });
      const response = body as Partial<ChatSendResponse> | null;

      if (ok && response?.status === "accepted") {
        append({ kind: "message", sender: "user", content });
        const reply = (response as Extract<ChatSendResponse, { status: "accepted" }>).reply;
        if (typeof reply === "string" && reply.length > 0) {
          append({ kind: "message", sender: "ai", content: reply });
        }
        setServerOpenRequestId(null);
        return { outcome: "accepted" };
      }

      if (response?.status === "refused" && response.reason === "secret_request_open") {
        // This client was stale. The message is NOT appended, NOT retried and
        // NOT queued — the caller still holds it in the composer's DOM value,
        // which nothing here has touched.
        const requestId = (response as Extract<ChatSendResponse, { status: "refused" }>).requestId;
        setServerOpenRequestId(requestId);
        return { outcome: "held", requestId };
      }

      return { outcome: "failed" };
    },
    [append, conversationId, transport],
  );

  return { turns, items, openPrompt, refusal, composer, receive, submitted, rejected, cancel, send };
}

/** The real transport, for a page talking to a real server. */
export function browserTransport(authToken: string): SecureTurnTransport {
  return {
    send: async (input) => {
      const response = await fetch("/api/askimate/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ conversationId: input.conversationId, content: input.content }),
      });
      const body: unknown = await response.json().catch(() => null);
      return { ok: response.ok, body };
    },
    cancel: async (requestId) => {
      const response = await fetch(`/api/askimate/secret/${requestId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      return response.ok;
    },
  };
}

/**
 * Turns a directive as it arrives on the wire into one this container accepts.
 *
 * Two conversions, both at the edge rather than inside the state machine:
 * `expiresAt` is an ISO string in JSON and a `Date` in the type, and the reason
 * on an incoming rejection is narrowed to the closed set. A turn that cannot be
 * understood is dropped rather than guessed at.
 *
 * Note what is NOT read: `conversationId`. The harness took it off the prompt,
 * which `SecretPrompt` does not declare — the value only existed because a test
 * spread it in. The conversation is the container's, passed in once.
 */
export function parseIncomingTurn(raw: unknown): ReceivedTurn | null {
  if (typeof raw !== "object" || raw === null) return null;
  const turn = raw as Record<string, unknown>;

  switch (turn["kind"]) {
    case "message": {
      const sender = turn["sender"];
      const content = turn["content"];
      if (typeof content !== "string") return null;
      if (sender !== "user" && sender !== "ai" && sender !== "mentor" && sender !== "system") {
        return null;
      }
      return { kind: "message", sender, content };
    }
    case "directive": {
      if (turn["directive"] !== "request_secret") return null;
      const prompt = turn["prompt"];
      if (typeof prompt !== "object" || prompt === null) return null;
      const fields = prompt as Record<string, unknown>;
      const expiresAt = fields["expiresAt"];
      const parsed =
        expiresAt instanceof Date
          ? expiresAt
          : typeof expiresAt === "string"
            ? new Date(expiresAt)
            : null;
      if (parsed === null || Number.isNaN(parsed.getTime())) return null;
      return {
        kind: "directive",
        directive: "request_secret",
        // `channel` stays whatever the server said it was. `decideRendering`
        // is what checks it, and it checks it first.
        prompt: { ...(fields as unknown as UncheckedSecretPrompt), expiresAt: parsed },
      };
    }
    case "secret_status": {
      const lifecycle = turn["lifecycle"];
      // Narrowed against the store's own list, for the same reason the reason
      // code is narrowed against its: a lifecycle word reaches the model, and
      // an unrecognised one would reach it unchecked.
      if (
        typeof lifecycle !== "string" ||
        !(SECRET_LIFECYCLE_WORDS as readonly string[]).includes(lifecycle)
      ) {
        return null;
      }
      const handle = turn["handle"];
      return {
        kind: "secret_status",
        lifecycle: lifecycle as SecretLifecycle,
        ...(typeof handle === "string" ? { handle } : {}),
      };
    }
    case "secret_rejected": {
      const reason = parseRejectionReason(turn["reason"]);
      return reason === null ? null : { kind: "secret_rejected", reason };
    }
    default:
      return null;
  }
}
