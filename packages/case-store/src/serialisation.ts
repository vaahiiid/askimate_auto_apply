/**
 * Turning a `CaseEvent` into JSON and back, without silently losing a `Date`.
 *
 * ── The bug this exists to prevent ────────────────────────────────────────
 *
 * `JSON.parse(JSON.stringify(event))` looks like it round-trips an event, and
 * it does not: every `Date` comes back as a **string**. The domain has them at
 * several levels —
 *
 *   EventEnvelope.occurredAt
 *   CaseOpened.requestEvidence.requestedAt
 *   AuthorisationCaptured.authorisedAt
 *   AuthorisationCaptured.expiresAt
 *
 * — and more will be added. A store that returned strings where the domain
 * declares `Date` would typecheck (the values come back as `unknown` and are
 * cast), pass a shallow equality test, and then produce nonsense the first time
 * anything did date arithmetic on them: `expiresAt.getTime()` throws, and
 * `a < b` on two ISO strings happens to work often enough to hide the problem.
 *
 * That is exactly the class of defect `contract.ts` exists to catch — a
 * Postgres implementation that quietly weakens a guarantee the in-memory one
 * upholds.
 *
 * ── Why tagging, and not "revive anything that looks like a date" ─────────
 *
 * The obvious fix is a reviver that converts any ISO-8601-shaped string back
 * into a `Date`. It is wrong, and dangerously so: this system stores
 * `ProposedValue.verbatim` — **text quoted verbatim from a student's
 * document** — and a passport's date of birth quoted as `"1999-04-02"` would
 * be silently converted from the string the document showed into a `Date`
 * object. The grounding check that compares a reading against the document
 * would then be comparing a Date to a string and would reject a valid reading.
 *
 * So a `Date` is written as `{ "$date": "…" }` and nothing else is touched. It
 * is unambiguous, it needs no list of known date fields to keep in step with
 * the domain, and a `Date` added anywhere in a future payload is handled with
 * no change here.
 *
 * The one cost: `event->>'occurredAt'` in raw SQL returns the wrapper rather
 * than the timestamp. The `case_events` table therefore also carries a real
 * `occurred_at timestamptz` column for querying and indexing.
 */

import type { CaseEvent } from "@askimate/aas-domain";

/** The wrapper. `$`-prefixed because no domain field starts with one. */
const DATE_TAG = "$date";

interface TaggedDate {
  readonly [DATE_TAG]: string;
}

function isTaggedDate(value: unknown): value is TaggedDate {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>)[DATE_TAG] === "string"
  );
}

/**
 * Encodes an event for storage.
 *
 * Walks the structure rather than using `JSON.stringify`'s replacer, because a
 * replacer receives the value **after** `Date.prototype.toJSON` has already
 * turned it into a string — by which point the type information is gone.
 */
export function encodeEvent(event: CaseEvent): string {
  return JSON.stringify(encode(event));
}

function encode(value: unknown): unknown {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(
        "Refusing to store an Invalid Date in a case event. An event log is the record of what " +
          "happened; a date nobody can read is not a record of anything, and it would come back " +
          "as `null` and be indistinguishable from an absent field.",
      );
    }
    return { [DATE_TAG]: value.toISOString() };
  }
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, held] of Object.entries(value)) out[key] = encode(held);
    return out;
  }
  return value;
}

/** Decodes a stored event. The inverse of `encodeEvent`, exactly. */
export function decodeEvent(stored: unknown): CaseEvent {
  return decode(typeof stored === "string" ? JSON.parse(stored) : stored) as CaseEvent;
}

function decode(value: unknown): unknown {
  if (isTaggedDate(value)) return new Date(value[DATE_TAG]);
  if (Array.isArray(value)) return value.map(decode);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, held] of Object.entries(value)) out[key] = decode(held);
    return out;
  }
  return value;
}
