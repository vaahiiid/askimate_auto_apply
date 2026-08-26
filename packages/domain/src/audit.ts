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
 * Values permitted in audit detail.
 *
 * Deliberately narrow. Note the absence of anything that could carry document
 * contents or a field value: a `ConfirmedValue` is an object and will not
 * satisfy this type, so it cannot be logged even by accident.
 */
export type RedactedDetail = Readonly<Record<string, string | number | boolean | null>>;

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
