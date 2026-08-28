/**
 * Every closed set in the wire protocol, declared exactly once.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Contracts must use closed unions wherever possible.
 * Unknown lifecycle values, directive kinds and rejection reasons must fail
 * closed."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why arrays, and why the types are derived from them ───────────────────
 *
 * A union type and a runtime array written side by side are two declarations
 * of one fact, and they drift the moment somebody edits one. Deriving the type
 * from the array — `(typeof X)[number]` — makes drift unrepresentable: there is
 * one list, and the checker and the runtime read the same one.
 *
 * The OpenAPI documents in ../openapi/ are the published contract. They repeat
 * these values, because a `.yaml` cannot import from TypeScript. `openapi.test.ts`
 * asserts the two agree in BOTH directions, so a value added to either without
 * the other fails the build rather than shipping as a silent divergence.
 */

/**
 * The kinds of thing that can happen in a conversation.
 *
 * Note the shape: the lifecycle words ARE event kinds. There is deliberately no
 * separate `lifecycle` field on a secure event, because two fields describing
 * one fact are two fields that can disagree — and the disagreement would be
 * invisible until a transcript rendered one thing and a guard believed another.
 */
export const EVENT_KINDS = [
  "message",
  "secret_requested",
  "secret_received",
  "secret_consumed",
  "secret_expired",
  "secret_cancelled",
  "secret_rejected",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Every kind that is NOT a message. None of these may carry free text. */
export const SECURE_EVENT_KINDS = EVENT_KINDS.filter(
  (kind): kind is Exclude<EventKind, "message"> => kind !== "message",
);

/** Who a message is from. Not an identity — a role in the conversation. */
export const ACTORS = ["student", "assistant", "mentor", "system"] as const;
export type Actor = (typeof ACTORS)[number];

/**
 * The lifecycle of a secret request.
 *
 * Mirrors `SecretLifecycle` in `@askimate/aas-secrets`. Declared here rather
 * than imported for a measured reason: importing that package as a VALUE pulls
 * `InMemorySecretStore` — the object that actually holds plaintext — toward any
 * browser bundle that touches this module. That is not hypothetical; esbuild
 * refused to build the Phase D client with `Could not resolve "node:crypto"`
 * when exactly that import was tried. `contracts.test.ts` asserts the two lists
 * are the same set.
 */
export const SECRET_LIFECYCLES = [
  "secret_requested",
  "secret_received",
  "secret_consumed",
  "secret_expired",
  "secret_cancelled",
] as const;
export type SecretLifecycleWord = (typeof SECRET_LIFECYCLES)[number];

/** Terminal states. A request in one of these is closed, and stays closed. */
export const TERMINAL_LIFECYCLES = [
  "secret_consumed",
  "secret_expired",
  "secret_cancelled",
] as const;
export type TerminalLifecycle = (typeof TERMINAL_LIFECYCLES)[number];

/**
 * Why a secure step did not complete.
 *
 * A CODE, never a sentence. The wording shown to a student is chosen at render
 * time from a fixed table keyed by the code — because a display string carried
 * on the wire is a field somebody eventually assembles from input.
 */
export const REJECTION_REASONS = [
  // Decided by the Secure Interaction Service.
  "confirmation_mismatch",
  "empty",
  "unknown_request",
  "expired",
  "already_submitted",
  "not_your_request",
  "wrong_conversation",
  // Decided by the client, when the control could not be used at all.
  "endpoint_unreachable",
  "prompt_expired",
  "client_does_not_support_secure_control",
  "insecure_context",
  "unknown_channel",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/**
 * How a secret may be collected. One value.
 *
 * Kept as a closed set of one rather than a boolean or an absent field, so that
 * a future channel is a value this client can refuse rather than a shape it
 * silently mis-renders. `unknown_channel` above is its refusal.
 */
export const SECRET_CHANNELS = ["secure_control"] as const;
export type SecretChannel = (typeof SECRET_CHANNELS)[number];

/**
 * Every error this API can return.
 *
 * Closed, because an open error space is one where a handler eventually invents
 * a message from whatever it was given. See ./problems.ts for why there is no
 * free-text `detail` member.
 */
export const PROBLEM_CODES = [
  "unauthenticated",
  "forbidden",
  "not_found",
  "validation_failed",
  "unsupported_media_type",
  "payload_too_large",
  "idempotency_key_conflict",
  "secret_request_open",
  "rate_limited",
  "internal_error",
  "service_unavailable",
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];

/** Messages the secure frame may send to the conversation page. */
export const FRAME_OUTBOUND_KINDS = [
  "ready",
  "resize",
  "secret_status",
  "secret_rejected",
  "cancelled",
] as const;
export type FrameOutboundKind = (typeof FRAME_OUTBOUND_KINDS)[number];

/** Messages the conversation page may send to the secure frame. Exactly one. */
export const FRAME_INBOUND_KINDS = ["bootstrap"] as const;
export type FrameInboundKind = (typeof FRAME_INBOUND_KINDS)[number];

/** The postMessage protocol version. Bumped only for a breaking change. */
export const FRAME_PROTOCOL_VERSION = 1;

// ───────────────────────────────────────────────────────────────────────────
// Parsers — the fail-closed boundary
// ───────────────────────────────────────────────────────────────────────────

/**
 * Builds a parser for a closed set.
 *
 * Every value arriving from a network, a `postMessage`, or a database row goes
 * through one of these before it can reach a type. A miss returns `null` and
 * the caller decides; there is deliberately no default baked in here, because a
 * default chosen inside a parser is a default nobody reads.
 */
function closedSetParser<T extends string>(
  members: readonly T[],
): (value: unknown) => T | null {
  const set = new Set<string>(members);
  return (value: unknown): T | null =>
    typeof value === "string" && set.has(value) ? (value as T) : null;
}

export const parseEventKind = closedSetParser(EVENT_KINDS);
export const parseActor = closedSetParser(ACTORS);
export const parseSecretLifecycle = closedSetParser(SECRET_LIFECYCLES);
export const parseRejectionReason = closedSetParser(REJECTION_REASONS);
export const parseSecretChannel = closedSetParser(SECRET_CHANNELS);
export const parseProblemCode = closedSetParser(PROBLEM_CODES);
export const parseFrameOutboundKind = closedSetParser(FRAME_OUTBOUND_KINDS);
export const parseFrameInboundKind = closedSetParser(FRAME_INBOUND_KINDS);

export function isTerminalLifecycleWord(value: SecretLifecycleWord): boolean {
  return (TERMINAL_LIFECYCLES as readonly string[]).includes(value);
}
