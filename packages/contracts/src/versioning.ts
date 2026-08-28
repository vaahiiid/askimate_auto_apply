/**
 * How these APIs may change, and the rule that makes enum growth safe.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Define versioning rules for the APIs."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The version is in the path ────────────────────────────────────────────
 *
 * `/v1/...`. Not a header, not a query parameter, not content negotiation.
 * A path version is visible in a log, a browser address bar, a load-balancer
 * rule and a curl command someone pastes into a ticket, and it costs nothing.
 * Header-based versioning is more elegant and is invisible in exactly the
 * situations where you most want to know which version was called.
 *
 * ── The rule that would normally be breaking, and is not here ─────────────
 *
 * In most APIs, adding a member to an enum is a breaking change: clients switch
 * on the value and fall through, or crash, or render "undefined".
 *
 * Here it is explicitly NOT breaking, because every client is contractually
 * required to FAIL CLOSED on a value it does not recognise — drop the event,
 * refuse the message, render nothing, forward nothing to the model. That
 * requirement exists for security (an unknown lifecycle must never be treated
 * as a known one), and it buys evolvability as a side effect: the server can
 * add a rejection reason or an event kind without a major version, and an old
 * client degrades safely instead of misbehaving.
 *
 * This is a trade, and it is worth naming: the cost is that an old client shows
 * a student slightly less than a new one would. The alternative — a major
 * version for every new reason code — would mean either never adding one, or a
 * migration for each. Degrading safely is the better failure.
 */

/** Additive within a major version. No client action required. */
export const NON_BREAKING_CHANGES = [
  "adding an endpoint",
  "adding an optional field to a request",
  "adding a field to a response",
  "adding a member to a closed set — clients MUST already fail closed on unknown members",
  "relaxing a validation rule",
  "adding a new problem code — an unrecognised code is reported as an unknown failure",
] as const;

/** Requires a new major version in the path. */
export const BREAKING_CHANGES = [
  "removing or renaming a field",
  "changing the type of a field",
  "removing a member from a closed set",
  "changing the meaning of an existing value",
  "making an optional request field required",
  "changing an endpoint's authentication or authorisation requirements",
  "changing the postMessage protocol shape — that has its own version, FRAME_PROTOCOL_VERSION",
] as const;

/**
 * The contract every client signs by consuming these APIs.
 *
 * Written down because it is the load-bearing half of the versioning rule: the
 * server's freedom to add enum members is paid for by the client's obligation
 * to refuse the ones it does not know.
 */
export const CLIENT_OBLIGATIONS = [
  "An unknown event kind MUST be dropped: not rendered, not stored, not sent to the model.",
  "An unknown lifecycle word MUST be treated as neither open nor closed, and the client MUST consult the server rather than guessing.",
  "An unknown rejection reason MUST be treated as a generic failure, never as a retryable one.",
  "An unknown problem code MUST be reported as an unknown failure, never mapped onto a known one.",
  "A postMessage with an unexpected protocol version MUST be discarded, not adapted.",
] as const;

/** Path prefix for the current major version of both services. */
export const API_VERSION = "v1" as const;

/**
 * Sunset signalling for a retired version.
 *
 * `Deprecation` and `Sunset` are the IETF-registered response headers for this
 * (RFC 8594 for `Sunset`), so monitoring can alert on a deprecated call rather
 * than discovering it when the version is switched off.
 */
export const DEPRECATION_HEADERS = ["Deprecation", "Sunset", "Link"] as const;
