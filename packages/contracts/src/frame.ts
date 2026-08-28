/**
 * The cross-origin contract between the Conversation Plane and the Secure Plane.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Define the content-free cross-origin communication
 * contract… Define the one-time secure-frame bootstrap and postMessage protocol
 * without placing credentials or capabilities in URLs."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The bootstrap, and why the token is not in the URL ────────────────────
 *
 *   1. Conversation Service asks the Secure Interaction Service, over the
 *      internal API, to open a request. It receives `{ requestId, frameToken }`.
 *      No secret exists yet; none ever reaches this plane.
 *   2. The page renders `<iframe src="https://secure.…/control/{requestId}">`.
 *      **The URL carries no credential.**
 *   3. The frame loads and posts `ready`.
 *   4. The page replies with `bootstrap`, carrying `frameToken` — over
 *      `postMessage`, never a URL.
 *   5. The frame POSTs the token to its OWN origin and exchanges it for a
 *      `__Host-` cookie. The token is consumed.
 *
 * Step 4 is the whole point of the handshake. A capability in a URL appears in
 * the `Referer` header, in browser history, in server access logs, in a shared
 * screenshot and in the parent page's DOM. A `postMessage` payload appears in
 * none of them. The request id is in the URL because it is an identifier, not a
 * capability — on its own it authenticates nobody, which is exactly why the
 * token exists.
 *
 * ── What may cross, and what may not ──────────────────────────────────────
 *
 * Every message below is content-free. There is no member that carries a
 * secret, a prompt, a message body, or any free text — and `NO_FRAME_MESSAGE_
 * CARRIES_A_SECRET` below fails the build if one is added.
 *
 * The opaque handle crosses on `secret_status`. That is the single capability
 * permitted over this boundary, and it is safe by construction: random rather
 * than derived, single-use, and bound to student, case, purpose and target,
 * re-checked at the moment it is spent.
 */

import type { RejectionReason, SecretLifecycleWord } from "./vocabulary.js";
import {
  FRAME_PROTOCOL_VERSION,
  parseRejectionReason,
  parseSecretLifecycle,
} from "./vocabulary.js";

interface FrameMessageBase {
  /** Bumped only for a breaking change. A mismatch is refused, not adapted. */
  readonly v: typeof FRAME_PROTOCOL_VERSION;
  readonly requestId: string;
}

/** The frame has mounted and wants its bootstrap token. */
export interface FrameReadyMessage extends FrameMessageBase {
  readonly kind: "ready";
  readonly height: number;
}

/** The frame's content changed size. The parent resizes the element. */
export interface FrameResizeMessage extends FrameMessageBase {
  readonly kind: "resize";
  readonly height: number;
}

/**
 * A lifecycle transition happened inside the secure plane.
 *
 * `handle` accompanies `secret_received` and nothing else — the parser below
 * refuses it on any other lifecycle, so a handle cannot be smuggled onto a
 * cancellation and treated as live.
 */
export interface FrameSecretStatusMessage extends FrameMessageBase {
  readonly kind: "secret_status";
  readonly lifecycle: SecretLifecycleWord;
  readonly handle?: string;
}

/** An attempt failed. A code from the closed set, and nothing else. */
export interface FrameSecretRejectedMessage extends FrameMessageBase {
  readonly kind: "secret_rejected";
  readonly reason: RejectionReason;
}

/** The student pressed cancel inside the frame. */
export interface FrameCancelledMessage extends FrameMessageBase {
  readonly kind: "cancelled";
}

export type FrameOutboundMessage =
  | FrameReadyMessage
  | FrameResizeMessage
  | FrameSecretStatusMessage
  | FrameSecretRejectedMessage
  | FrameCancelledMessage;

/**
 * The ONLY message the conversation page may send into the frame.
 *
 * One inbound member, deliberately. An inbound channel is an injection surface,
 * and the smallest one that works is one message that carries one short-lived,
 * single-use token.
 */
export interface FrameBootstrapMessage extends FrameMessageBase {
  readonly kind: "bootstrap";
  readonly frameToken: string;
}

export type FrameInboundMessage = FrameBootstrapMessage;

/**
 * COMPILE-TIME: no frame message may carry a secret or any free text.
 *
 * Distributive, so it asks of every member rather than of their intersection.
 * Adding `password`, `content`, `explanation` or `title` to any message stops
 * this being `never` and fails the build naming the member.
 */
type ForbiddenKeys =
  | "password"
  | "secret"
  | "plaintext"
  | "credential"
  | "content"
  | "message"
  | "explanation"
  | "title"
  | "detail";
type CarriesForbidden<T> = T extends unknown
  ? Extract<keyof T, ForbiddenKeys> extends never
    ? never
    : T
  : never;
type AssertNever<T extends never> = T;
export type NO_FRAME_MESSAGE_CARRIES_A_SECRET = AssertNever<
  CarriesForbidden<FrameOutboundMessage | FrameInboundMessage>
>;

// ───────────────────────────────────────────────────────────────────────────
// Parsing — four checks, every time
// ───────────────────────────────────────────────────────────────────────────

/**
 * What a receiver must verify before a message may be believed.
 *
 * All four, on every message. `origin` is compared with `===` against an exact
 * string: not `startsWith`, which `https://secure.askimate.com.evil.test`
 * satisfies, and not a regular expression, which is where the dot that should
 * have been escaped lives.
 */
export interface FrameEnvelope {
  readonly origin: string;
  readonly source: unknown;
  readonly data: unknown;
}

export interface FrameExpectation {
  readonly expectedOrigin: string;
  readonly expectedSource: unknown;
  readonly expectedRequestId: string;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readHeight(source: Record<string, unknown>): number | null {
  const value = source["height"];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function shapeOf(raw: unknown, expectedRequestId: string): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  if (source["v"] !== FRAME_PROTOCOL_VERSION) return null;
  if (readString(source, "requestId") !== expectedRequestId) return null;
  return source;
}

/**
 * Parses a message from the secure frame, or refuses it.
 *
 * Refuses — returning `null` — unless the origin matches exactly, the source is
 * the window we rendered, the protocol version matches, the request id is the
 * one this frame was created for, and every enum member is in its closed set.
 */
export function parseFrameOutbound(
  envelope: FrameEnvelope,
  expectation: FrameExpectation,
): FrameOutboundMessage | null {
  if (envelope.origin !== expectation.expectedOrigin) return null;
  if (envelope.source !== expectation.expectedSource) return null;

  const source = shapeOf(envelope.data, expectation.expectedRequestId);
  if (source === null) return null;

  const requestId = expectation.expectedRequestId;
  const base = { v: FRAME_PROTOCOL_VERSION, requestId } as const;

  switch (source["kind"]) {
    case "ready":
    case "resize": {
      const height = readHeight(source);
      if (height === null) return null;
      return { ...base, kind: source["kind"], height };
    }
    case "secret_status": {
      const lifecycle = parseSecretLifecycle(source["lifecycle"]);
      if (lifecycle === null) return null;
      const handle = source["handle"];
      if (handle === undefined) return { ...base, kind: "secret_status", lifecycle };
      // A handle is only meaningful on `secret_received`. Anywhere else it is
      // either a mistake or an attempt to make a dead request look live.
      if (typeof handle !== "string" || handle.length === 0) return null;
      if (lifecycle !== "secret_received") return null;
      return { ...base, kind: "secret_status", lifecycle, handle };
    }
    case "secret_rejected": {
      const reason = parseRejectionReason(source["reason"]);
      if (reason === null) return null;
      return { ...base, kind: "secret_rejected", reason };
    }
    case "cancelled":
      return { ...base, kind: "cancelled" };
    default:
      return null;
  }
}

/**
 * Parses the bootstrap message inside the frame.
 *
 * The frame checks the parent's origin with the same exactness the parent uses
 * for the frame's. Neither side trusts the other's word for who it is.
 */
export function parseFrameInbound(
  envelope: FrameEnvelope,
  expectation: FrameExpectation,
): FrameInboundMessage | null {
  if (envelope.origin !== expectation.expectedOrigin) return null;
  if (envelope.source !== expectation.expectedSource) return null;

  const source = shapeOf(envelope.data, expectation.expectedRequestId);
  if (source === null) return null;
  if (source["kind"] !== "bootstrap") return null;

  const frameToken = readString(source, "frameToken");
  if (frameToken === null) return null;

  return {
    v: FRAME_PROTOCOL_VERSION,
    requestId: expectation.expectedRequestId,
    kind: "bootstrap",
    frameToken,
  };
}
