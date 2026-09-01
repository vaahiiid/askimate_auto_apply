/**
 * The error contract: closed, and deliberately unable to carry a value.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Define all error responses as closed, explicit
 * contracts."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── RFC 9457, minus the field that leaks ──────────────────────────────────
 *
 * This is `application/problem+json` (RFC 9457), with one deliberate omission:
 * **there is no `detail` member.**
 *
 * RFC 9457 describes `detail` as "a human-readable explanation specific to this
 * occurrence of the problem". Specific-to-this-occurrence is precisely the
 * property that makes it dangerous here. It is the field into which a helpful
 * handler eventually interpolates the thing that was wrong — and on the one
 * endpoint that receives a password, the thing that was wrong is the password.
 * `"could not parse 'hunter2' as JSON"` is a plausible sentence for a library
 * to generate, and body-parser already attaches the raw request body to a JSON
 * syntax error as `err.body`.
 *
 * So the wording lives in a table keyed by `code`, in the client, chosen from
 * the code. There is nowhere on the wire for a sentence to be assembled.
 *
 * `title` is present because RFC 9457 requires it, and it is a FIXED string per
 * code — the same for every occurrence, never derived from the request.
 */

import type { ProblemCode } from "./vocabulary.js";
import { parseProblemCode } from "./vocabulary.js";

/** The base URI for problem types. Stable; part of the published contract. */
export const PROBLEM_TYPE_BASE = "https://askimate.com/problems/";

/**
 * The one place a code becomes a sentence, and every sentence is a constant.
 *
 * If any value here ever needs a placeholder, that is the signal that the
 * information belongs in a typed field on the extension members below — not in
 * a string.
 */
export const PROBLEM_TITLES: Readonly<Record<ProblemCode, string>> = {
  unauthenticated: "Authentication required",
  forbidden: "Not permitted",
  not_found: "Not found",
  validation_failed: "The request could not be understood",
  unsupported_media_type: "Unsupported media type",
  payload_too_large: "Payload too large",
  idempotency_key_conflict: "Idempotency key already used with a different request",
  intervention_already_resolved: "This intervention has already been adjudicated",
  secret_request_open: "A secure step is open on this conversation",
  rate_limited: "Too many requests",
  internal_error: "Internal error",
  service_unavailable: "Service unavailable",
};

export const PROBLEM_STATUS: Readonly<Record<ProblemCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  unsupported_media_type: 415,
  payload_too_large: 413,
  idempotency_key_conflict: 409,
  // 409 rather than 200: the caller's adjudication was NOT recorded, and a
  // specialist who submitted one needs to know it lost to somebody else's
  // rather than assume theirs is what the record now says.
  intervention_already_resolved: 409,
  secret_request_open: 409,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
};

interface ProblemBase {
  /** `https://askimate.com/problems/<code>`. Closed by construction. */
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  /** The request id, for correlating with logs. Not derived from any input. */
  readonly instance: string;
}

/**
 * Names the fields that failed, and never their values.
 *
 * JSON Pointers (`/content`, `/conversationId`) rather than a message, for the
 * same reason `detail` is absent: a pointer identifies a location, and a
 * message eventually contains what was found there.
 */
export interface ValidationProblem extends ProblemBase {
  readonly code: "validation_failed";
  readonly pointers: readonly string[];
}

/**
 * The fail-closed refusal of the message endpoint.
 *
 * Carries the OPEN REQUEST, never anything from the refused body — an echo is
 * how a refused password ends up in a client-side log. The request id lets a
 * stale client render the step it did not know about instead of leaving the
 * student to guess why Send stopped working.
 */
export interface SecretRequestOpenProblem extends ProblemBase {
  readonly code: "secret_request_open";
  readonly requestId: string;
  readonly expiresAt: string;
}

export interface RateLimitedProblem extends ProblemBase {
  readonly code: "rate_limited";
  readonly retryAfterSeconds: number;
}

export interface PlainProblem extends ProblemBase {
  readonly code: Exclude<
    ProblemCode,
    "validation_failed" | "secret_request_open" | "rate_limited"
  >;
}

export type Problem =
  | PlainProblem
  | ValidationProblem
  | SecretRequestOpenProblem
  | RateLimitedProblem;

/**
 * COMPILE-TIME: no problem member may carry free text beyond the fixed title.
 *
 * Distributive, so it asks the question of every member separately rather than
 * of their intersection. If anyone adds `detail`, `message`, `error` or
 * `description` to any member, this stops being `never` and the build fails
 * naming it.
 */
type FreeTextKeys = "detail" | "message" | "error" | "description" | "reason_text";
type HasFreeText<T> = T extends unknown
  ? Extract<keyof T, FreeTextKeys> extends never
    ? never
    : T
  : never;
type AssertNever<T extends never> = T;
export type NO_PROBLEM_CARRIES_FREE_TEXT = AssertNever<HasFreeText<Problem>>;

export function problemTypeFor(code: ProblemCode): string {
  return `${PROBLEM_TYPE_BASE}${code}`;
}

/**
 * Parses a problem document from an untrusted response.
 *
 * Everything is checked; an unrecognised `code` yields `null` so a client older
 * than the server treats an unknown failure as an unknown failure rather than
 * guessing at one it recognises.
 */
export function parseProblem(raw: unknown): Problem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;

  const code = parseProblemCode(source["code"]);
  if (code === null) return null;
  const instance = source["instance"];
  if (typeof instance !== "string" || instance.length === 0) return null;

  const base = {
    type: problemTypeFor(code),
    title: PROBLEM_TITLES[code],
    status: PROBLEM_STATUS[code],
    instance,
  } as const;

  switch (code) {
    case "validation_failed": {
      const pointers = source["pointers"];
      if (!Array.isArray(pointers)) return null;
      if (!pointers.every((entry): entry is string => typeof entry === "string")) return null;
      // Pointers are structural. A pointer that is not a JSON Pointer is a
      // message wearing a pointer's name, and is refused.
      if (!pointers.every((entry) => entry.startsWith("/"))) return null;
      return { ...base, code, pointers };
    }
    case "secret_request_open": {
      const requestId = source["requestId"];
      const expiresAt = source["expiresAt"];
      if (typeof requestId !== "string" || typeof expiresAt !== "string") return null;
      return { ...base, code, requestId, expiresAt };
    }
    case "rate_limited": {
      const retryAfterSeconds = source["retryAfterSeconds"];
      if (typeof retryAfterSeconds !== "number" || !Number.isFinite(retryAfterSeconds)) {
        return null;
      }
      return { ...base, code, retryAfterSeconds };
    }
    // ── Enumerated, not defaulted ─────────────────────────────────────
    //
    // A `default:` here would have swallowed a new problem code and given it
    // the plain shape, silently — so a code that ought to carry a field would
    // parse as one that carries none, and the field would go missing rather
    // than fail. The linter's exhaustiveness rule caught it. Listing every
    // member means adding one forces a decision at this switch.
    case "unauthenticated":
    case "forbidden":
    case "not_found":
    case "unsupported_media_type":
    case "payload_too_large":
    case "idempotency_key_conflict":
    case "intervention_already_resolved":
    case "internal_error":
    case "service_unavailable":
      return { ...base, code };
  }
}
