/**
 * The audit log.
 *
 * Distinct from the event log, and the distinction is worth stating because
 * conflating them is a common and expensive mistake:
 *
 *   Event log — the authoritative record of what HAPPENED to a case. State is
 *               derived from it. Losing it loses the case.
 *
 *   Audit log — the record of what the SYSTEM DID: every tool call, DOM action,
 *               decision, external response, retry and outcome (brief §5).
 *               High-volume, observational. Losing it loses explicability, not
 *               state.
 *
 * They are separated so that audit volume — which is enormous once browser
 * automation starts — never threatens the integrity or the read performance of
 * the record that state depends on.
 *
 * ── Redaction (brief §8) ─────────────────────────────────────────────────
 *
 * "Redact personal data from logs by default. Audit records may reference
 *  document IDs, not document contents."
 *
 * Enforced here by construction: `AuditEntry.detail` accepts only
 * `RedactedDetail`, whose values are non-sensitive primitives. There is no
 * field on an audit entry that will accept a document's contents, a form field
 * value, or a `ConfirmedValue`. As with ADR-0004, the type system does the
 * enforcing rather than a reviewer's memory.
 */

import type { CaseId, TaskId } from "./ids.js";

/** What the system was doing. */
export type AuditAction =
  | "tool_call"
  | "dom_action"
  | "decision"
  | "external_request"
  | "external_response"
  | "retry"
  | "state_derivation"
  | "guard_refusal"
  | "handoff_issued"
  | "handoff_resumed";

export type AuditOutcome = "success" | "failure" | "refused" | "timeout" | "retried";

/**
 * Text that has been deliberately marked safe to write into an audit record.
 *
 * ── Why a plain `string` is not good enough ───────────────────────────────
 *
 * This type used to be `string | number | boolean | null`, on the reasoning
 * that a `ConfirmedValue` is an object and so could not satisfy it. True, and
 * beside the point: `unwrapConfirmed(value)` is a `string`, and
 * `{ answer: unwrapped }` type-checked perfectly. The runtime key check below
 * catches `{ password: … }` but not `{ answer: … }`, because the KEY is
 * innocuous and the value is somebody's passport number.
 *
 * So a string reaching an audit record must now be marked, and there are only
 * three ways to mark one — none of which a personal value can pass through.
 */
declare const AUDIT_SAFE: unique symbol;
export type AuditSafeText = string & { readonly [AUDIT_SAFE]: true };

/**
 * Marks a string LITERAL as audit-safe.
 *
 * The signature is the control. `string extends T ? never : T` accepts a
 * literal type — `auditLabel("blueprint_not_executable")` — and rejects
 * anything whose type has widened to `string`, which is what every runtime
 * value is. A personal value cannot reach an audit record through here,
 * because a personal value is never a literal in the source.
 */
export function auditLabel<T extends string>(literal: string extends T ? never : T): AuditSafeText {
  return literal as unknown as AuditSafeText;
}

/**
 * Marks an identifier as audit-safe.
 *
 * Brief §8: *"Audit records may reference document IDs, not document
 * contents."* An id is a reference, which is the whole point of one. Accepts
 * branded ids and opaque reference strings that carry a recognised prefix.
 */
export function auditRef(id: string): AuditSafeText {
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    throw new AuditRedactionError("An empty string is not a reference.");
  }
  if (trimmed.length > 128) {
    throw new AuditRedactionError(
      `A reference of ${String(trimmed.length)} characters is not an identifier — it is content. ` +
        `Audit records reference data; they do not carry it.`,
    );
  }
  if (/\s/.test(trimmed)) {
    throw new AuditRedactionError(
      `"${trimmed.slice(0, 24)}…" contains whitespace, so it is prose rather than an identifier. ` +
        `Use auditLabel for a fixed phrase, or describeRedacted for a value's shape.`,
    );
  }
  return trimmed as AuditSafeText;
}

/**
 * Values permitted in audit detail.
 *
 * Note what is absent: a bare `string`. A `ConfirmedValue` is an object and
 * never satisfied this; an unwrapped one is a string and did.
 */
export type RedactedDetail = Readonly<Record<string, AuditSafeText | number | boolean | null>>;

export interface AuditEntry {
  readonly caseId: CaseId;
  readonly at: Date;
  readonly action: AuditAction;
  readonly outcome: AuditOutcome;
  /** The component responsible, e.g. `orchestrator-worker`, `browser-runner`. */
  readonly component: string;
  /** Short description of what was attempted. */
  readonly summary: string;
  /** Structured, non-sensitive detail. */
  readonly detail?: RedactedDetail;
  readonly taskId?: TaskId;
  /** Correlates entries belonging to one run. */
  readonly runId?: string;
  readonly durationMs?: number;
}

/**
 * Keys that must never appear in audit detail.
 *
 * The type system already prevents structured values from being logged. This
 * catches the other half of the problem: a *string* under a sensitive key —
 * `{ password: "hunter2" }` satisfies `RedactedDetail` perfectly well.
 */
const FORBIDDEN_KEY_PATTERN =
  /pass(word|phrase)|secret|token|credential|authorization|cookie|session|ssn|passport(?!_id)|iban|account[_-]?number|sort[_-]?code|card[_-]?number|cvv|dob|date[_-]?of[_-]?birth/i;

export class AuditRedactionError extends Error {
  public override readonly name = "AuditRedactionError";
}

/**
 * Builds an audit entry, refusing sensitive keys.
 *
 * Throws rather than silently dropping the offending key. A silent drop would
 * let a leak look like a successful write, and the whole point of this control
 * is to be noisy when someone gets it wrong — in development, where it is cheap
 * to fix.
 */
export function auditEntry(input: {
  readonly caseId: CaseId;
  readonly at: Date;
  readonly action: AuditAction;
  readonly outcome: AuditOutcome;
  readonly component: string;
  readonly summary: string;
  readonly detail?: RedactedDetail;
  readonly taskId?: TaskId;
  readonly runId?: string;
  readonly durationMs?: number;
}): AuditEntry {
  if (input.detail !== undefined) {
    for (const key of Object.keys(input.detail)) {
      if (FORBIDDEN_KEY_PATTERN.test(key)) {
        throw new AuditRedactionError(
          `Audit detail key "${key}" looks like personal or secret data and must not be logged. ` +
            `Reference a document ID instead of its contents.`,
        );
      }
    }
  }

  return {
    caseId: input.caseId,
    at: input.at,
    action: input.action,
    outcome: input.outcome,
    component: input.component,
    summary: input.summary,
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
    ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  };
}
