/**
 * The only way this service writes a line. A closed set of fields, by type.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"A logger API that accepts arbitrary objects is not
 * sufficient for this endpoint."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why an allowlist and not a redactor ───────────────────────────────────
 *
 * A redactor is a denylist: it knows the field names it has been told about and
 * passes everything else through. The failure mode is silent and permanent — a
 * field added next year is not in the list, so it is logged, and nobody finds
 * out until it is in a log aggregator with ninety days of retention.
 *
 * This logger has no parameter through which an arbitrary object can be passed.
 * `LogFields` is a closed interface of scalars with known, non-secret meanings.
 * There is no `...rest`, no `Record<string, unknown>`, no `meta`, no `extra`.
 * Adding a field is a diff a reviewer sees.
 *
 * ── Why it will not take an Error ─────────────────────────────────────────
 *
 * `log.error({ err })` is the single most common way a credential reaches a
 * log. `body-parser` attaches the raw request body to a JSON syntax error as
 * `err.body`; an HTTP client's error carries the request it failed on; a
 * validation library's error quotes the value that failed. So `failure()` takes
 * an unknown and reduces it to a CLASS NAME before anything else touches it —
 * `TypeError`, `SyntaxError` — and the message, stack and properties are
 * discarded at the boundary rather than filtered afterwards.
 *
 * The cost is real: debugging is harder without a message. On the one endpoint
 * in the system that receives a password, that is the correct trade, and the
 * `code` field carries the closed-set reason that actually identifies what
 * happened.
 */

import type { RejectionReason } from "@askimate/aas-contracts";

/**
 * Everything this service may write. Scalars only, all of them non-secret.
 *
 * Note what is absent and cannot be added without editing this type: any field
 * whose value comes from a request body, any free text, any length, and any
 * hash. A length is a fact about a password.
 */
export interface LogFields {
  /** A short, fixed, developer-written string. Never interpolated. */
  readonly event: LogEvent;
  /** `sr_…`, an identifier this service minted. */
  readonly requestId?: string;
  /** A ULID naming a conversation. Meaningless outside our database. */
  readonly conversationId?: string;
  /** A lifecycle word or a rejection reason — both closed sets. */
  readonly code?: RejectionReason | LifecycleWord | ProblemWord;
  /** HTTP status. A number. */
  readonly status?: number;
  /** The CLASS of a thrown value. Never its message. */
  readonly errorClass?: string;
  /** Milliseconds. */
  readonly durationMs?: number;
}

/**
 * The events this service can report. A closed set, so a log line's subject is
 * always a string written here rather than one assembled at a call site.
 */
export const LOG_EVENTS = [
  "request_opened",
  "frame_session_established",
  "frame_session_refused",
  "secret_submitted",
  "secret_refused",
  "secret_spent",
  "secret_use_refused",
  "request_cancelled",
  "request_expired",
  "lifecycle_published",
  "lifecycle_publish_failed",
  "unhandled_failure",
] as const;
export type LogEvent = (typeof LOG_EVENTS)[number];

type LifecycleWord =
  | "secret_requested"
  | "secret_received"
  | "secret_consumed"
  | "secret_expired"
  | "secret_cancelled";
type ProblemWord =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "rate_limited"
  | "internal_error";

/** Where a line goes. Injected so a test can capture without spying on globals. */
export type LogSink = (line: string) => void;

/**
 * COMPILE-TIME: no log field may be an object, an array, or a function.
 *
 * This is what stops `meta`, `context`, `err` or `body` being added later. A
 * field whose type is `unknown` or `Record<…>` makes this stop being `never`
 * and fails the build naming the field.
 */
type ScalarOnly<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends string | number | boolean ? never : K;
}[keyof T];
type AssertNever<T extends never> = T;
export type NO_LOG_FIELD_IS_AN_OBJECT = AssertNever<ScalarOnly<LogFields>>;

export class SecureLogger {
  readonly #sink: LogSink;

  public constructor(sink: LogSink = (line) => {
    // The one console call in this service, and it takes a STRING that this
    // class assembled from a closed set of scalars. `console.log(object)` is
    // what this whole file exists to make unwritable.
    console.log(line);
  }) {
    this.#sink = sink;
  }

  public log(fields: LogFields): void {
    // Assembled here, from a type that admits only scalars. `JSON.stringify` of
    // an arbitrary object is what this class exists to make unwritable.
    const parts: string[] = [`event=${fields.event}`];
    if (fields.requestId !== undefined) parts.push(`requestId=${fields.requestId}`);
    if (fields.conversationId !== undefined) parts.push(`conversationId=${fields.conversationId}`);
    if (fields.code !== undefined) parts.push(`code=${fields.code}`);
    if (fields.status !== undefined) parts.push(`status=${String(fields.status)}`);
    if (fields.errorClass !== undefined) parts.push(`errorClass=${fields.errorClass}`);
    if (fields.durationMs !== undefined) parts.push(`durationMs=${String(fields.durationMs)}`);
    this.#sink(parts.join(" "));
  }

  /**
   * Reports a thrown value as a CLASS NAME and nothing else.
   *
   * The `unknown` is reduced at the first statement. Nothing downstream ever
   * holds the error, so nothing downstream can serialise it — and the raw body
   * `body-parser` attaches to a parse error is deleted here as well, because
   * this may be the last code to see the object before a global handler does.
   */
  public failure(event: LogEvent, error: unknown, fields: Omit<LogFields, "event"> = {}): void {
    if (typeof error === "object" && error !== null && "body" in error) {
      delete (error as { body?: unknown }).body;
    }
    const errorClass = error instanceof Error ? error.constructor.name : typeof error;
    this.log({ ...fields, event, errorClass });
  }
}
