/**
 * A value's shape, with the value removed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Brief §8: *"Redact personal data from logs by default."*
 *
 * `RedactedDetail` in ./audit.ts stops a ConfirmedValue reaching an audit
 * entry. It does not stop an UNWRAPPED one — a plain string satisfies
 * `string | number | boolean | null` perfectly well — and it says nothing
 * about the other places a value travels: an error object, a diagnostic
 * getter, an execution outcome, a console line.
 *
 * This is what those places carry instead.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything a diagnostic legitimately needs can be answered from a length and
 * a digest: did the value arrive, was it truncated, is what the portal stored
 * the same as what was sent. None of it needs the characters, and the
 * characters are a passport number.
 */

import { createHash } from "node:crypto";

import type { AuditSafeText } from "./audit.js";

export interface RedactedValue {
  readonly length: number;
  /**
   * First 12 hex characters of the SHA-256.
   *
   * Enough to tell two values apart or prove them identical; useless on its
   * own. Deliberately truncated: a full digest of a short, low-entropy value
   * like a date of birth or a nationality is trivially reversible by anyone
   * with a dictionary, and 12 characters keeps the comparison while making a
   * table lookup carry real collision noise.
   */
  readonly digest: string;
  /** Fixed text, so a redaction is recognisable in any output it lands in. */
  readonly redacted: "[redacted]";
}

export function redact(value: string): RedactedValue {
  return {
    length: value.length,
    digest: createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12),
    redacted: "[redacted]",
  };
}

/** True when two values are identical, without either being disclosed. */
export function sameRedacted(left: RedactedValue, right: RedactedValue): boolean {
  return left.length === right.length && left.digest === right.digest;
}

/**
 * A one-line description for a log, a report or an audit record.
 *
 * Returns `AuditSafeText`: a shape is exactly what an audit record may carry,
 * and this is the third of the three ways to produce one.
 */
export function describeRedacted(value: RedactedValue): AuditSafeText {
  return `[redacted · ${String(value.length)} chars · ${value.digest}]` as AuditSafeText;
}
