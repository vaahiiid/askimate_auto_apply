/**
 * @askimate/aas-secure-logging — the Secure Plane's logging discipline.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Extracted from `apps/secure-service` when the Secure Plane gained its SECOND
 * deployable (ADR-0042: the fill agent). The rule it enforces — a closed set of
 * scalar fields, no parameter through which an object can be passed — is a
 * property of the plane, not of one service, and the plane now has two
 * processes that both hold plaintext at some point in a request.
 *
 * Duplicating it would have been the wrong answer: a second copy is a second
 * place for `meta?: unknown` to be added to, and the compile-time assertion
 * that makes this file work only guards the copy it is written in.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type {
  FillRefusal,
  LogEvent,
  LogFields,
  LogSink,
  NO_LOG_FIELD_IS_AN_OBJECT,
} from "./logger.js";
export { FILL_REFUSALS, LOG_EVENTS, SecureLogger } from "./logger.js";
