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
  content_hash_mismatch: "These are not the bytes this upload was prepared for",
  intake_not_open: "This upload is no longer open",
  unsupported_media_type: "Unsupported media type",
  payload_too_large: "Payload too large",
  idempotency_key_conflict: "Idempotency key already used with a different request",
  intervention_already_resolved: "This intervention has already been adjudicated",
  content_changed: "The content changed since it was shown; it must be re-approved",
  secret_request_open: "A secure step is open on this conversation",
  already_applying: "You already have an application for this course and intake",
  specialist_reviewing: "Someone is checking part of your application, and will finish shortly",
  email_not_verified: "Verify your email address, then sign in again",
  rate_limited: "Too many requests",
  internal_error: "Internal error",
  service_unavailable: "Service unavailable",
};

export const PROBLEM_STATUS: Readonly<Record<ProblemCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  content_hash_mismatch: 422,
  intake_not_open: 409,
  unsupported_media_type: 415,
  payload_too_large: 413,
  idempotency_key_conflict: 409,
  // 409 rather than 200: the caller's adjudication was NOT recorded, and a
  // specialist who submitted one needs to know it lost to somebody else's
  // rather than assume theirs is what the record now says.
  intervention_already_resolved: 409,
  // 409, and its own code rather than a generic refusal: a client that showed a
  // preview which has since changed must RE-RENDER and ask again. Retrying the
  // same hash would be asking the service to record an approval of content the
  // student never saw.
  content_changed: 409,
  secret_request_open: 409,
  // 409, and it names the case that holds the identity. The student is not
  // forbidden anything and nothing is missing — there is already an application
  // for this institution, course and intake, and a second one would be the
  // duplicate submission ADR-0006 exists to make structurally impossible.
  already_applying: 409,
  // 409, not 403 and not 404: the request is well-formed, the student is
  // permitted, and the application exists — it is the WORLD that is not ready,
  // and it becomes ready without them doing anything. The title is what they
  // can act on, which is nothing, and saying so is the point.
  specialist_reviewing: 409,
  // 403: authenticated, and not permitted to open this step yet. Its own code
  // rather than a bare `forbidden` so a client can say what to do about it —
  // and the title is the instruction, because this is the one refusal on this
  // path a student can act on without anybody's help.
  email_not_verified: 403,
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

/**
 * The application that already holds this submission identity.
 *
 * ── Why an identifier may be on this wire at all ──────────────────────────
 *
 * The submission identity includes the STUDENT, so a collision is always with
 * an application of the caller's own. There is no case in which this names
 * somebody else's — that is a property of `submissionKey`, not a check made
 * here, which is why the field can be unconditional.
 *
 * It is on the wire because the refusal is otherwise a dead end. "You already
 * have an application for this" is only useful if the client can take the
 * student to it, or — when it has concluded — offer them a second attempt.
 * `concluded` is the one bit of state that decides which, and it is a boolean
 * rather than the case's state because the state is a twelve-member vocabulary
 * describing an application the student is not looking at.
 */
export interface AlreadyApplyingProblem extends ProblemBase {
  readonly code: "already_applying";
  readonly existingCaseId: string;
  /** True when that application has finished, so a re-application is possible. */
  readonly concluded: boolean;
}

export interface PlainProblem extends ProblemBase {
  readonly code: Exclude<
    ProblemCode,
    "validation_failed" | "secret_request_open" | "rate_limited" | "already_applying"
  >;
}

export type Problem =
  | PlainProblem
  | ValidationProblem
  | SecretRequestOpenProblem
  | RateLimitedProblem
  | AlreadyApplyingProblem;

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
 * The published code for a body the parser refused, or `null`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * P41. Both services publish `413 payload_too_large` and `415
 * unsupported_media_type` on their write routes, and NEITHER produced one.
 * A body over the limit reached the blind error handler as a
 * `PayloadTooLargeError`, and the handler — which names the error's class and
 * nothing else, deliberately — answered `500 internal_error`. The comment
 * beside the limit said *"`413` from here is the contract's
 * `payload_too_large`"*, and nothing made that true.
 *
 * What a student saw for a statement they pasted was "Something went wrong at
 * our end", for a body only they can shorten.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why it reads `type` and NOTHING else ─────────────────────────────────
 *
 * `body-parser` puts the RAW REQUEST BODY on `err.body` for a syntax error —
 * the field that would carry a half-typed password into a log line or a
 * response. Both error handlers delete it before anything touches the error,
 * and this function is written so it would be harmless if they did not: it
 * reads one short machine string from a closed set and never the message, the
 * stack or the body.
 *
 * ── Why here, and not in each service ────────────────────────────────────
 *
 * Two copies would be two chances for one of them to answer a 500 for a
 * refusal the other states properly, and the codes it maps to are this
 * package's own vocabulary. It takes `unknown` and depends on nothing.
 */
export function problemForBodyError(error: unknown): ProblemCode | null {
  if (typeof error !== "object" || error === null || !("type" in error)) return null;
  const type = (error as { type?: unknown }).type;
  switch (type) {
    // The body exceeded `express.json({ limit })`.
    case "entity.too.large":
      return "payload_too_large";
    // Not JSON. `validation_failed` rather than a code of its own: from the
    // sender's side it is the same fact as a body that parses and is wrong.
    case "entity.parse.failed":
      return "validation_failed";
    // A charset or a Content-Encoding this server will not decode. A
    // Content-Type that is not JSON at all is NOT here: `express.json` skips
    // the body silently and the route's own validation refuses it, which is
    // the answer that names the missing field rather than the header.
    case "charset.unsupported":
    case "encoding.unsupported":
      return "unsupported_media_type";
    default:
      return null;
  }
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
    case "already_applying": {
      const existingCaseId = source["existingCaseId"];
      const concluded = source["concluded"];
      if (typeof existingCaseId !== "string" || existingCaseId.length === 0) return null;
      if (typeof concluded !== "boolean") return null;
      return { ...base, code, existingCaseId, concluded };
    }
    // ── Enumerated, not defaulted ─────────────────────────────────────
    //
    // A `default:` here would have swallowed a new problem code and given it
    // the plain shape, silently — so a code that ought to carry a field would
    // parse as one that carries none, and the field would go missing rather
    // than fail. The linter's exhaustiveness rule caught it. Listing every
    // member means adding one forces a decision at this switch.
    //
    // `email_not_verified` is among them deliberately. It carries NO extension
    // members: WHY the address is unverified — not verified, no address, no
    // claim — is not on the wire. The three are one refusal to the student and
    // one instruction, and distinguishing them publicly would tell an
    // unauthenticated caller what a provider returned about somebody's account.
    //
    // `content_hash_mismatch` and `intake_not_open` (ADR-0090) carry none
    // either. The refusal names the document type, the ceiling and the two
    // hashes in its `detail`; putting the received hash on the wire as a FIELD
    // would invite a client to retry by declaring it, which is the binding the
    // check exists to make.
    case "unauthenticated":
    case "forbidden":
    case "not_found":
    case "unsupported_media_type":
    case "payload_too_large":
    case "content_hash_mismatch":
    case "intake_not_open":
    case "idempotency_key_conflict":
    case "intervention_already_resolved":
    case "content_changed":
    case "email_not_verified":
    case "specialist_reviewing":
    case "internal_error":
    case "service_unavailable":
      return { ...base, code };
  }
}
