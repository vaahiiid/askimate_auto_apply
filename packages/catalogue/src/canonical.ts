/**
 * The canonical form of an artefact, and the hash taken over it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0057. An approval binds to CONTENT. This file decides what "the same
 * content" means, and the answer has to be exact — a hash is only as useful as
 * the equivalence it defines.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why not hash the raw bytes ────────────────────────────────────────────
 *
 * ADR-0003 hashes migration files byte for byte, and that is right for SQL: the
 * file IS the artefact, and whitespace in SQL is still SQL somebody wrote.
 *
 * A blueprint arrives as JSON, where key order and indentation are the
 * serialiser's choices rather than the author's. Two files that differ only in
 * how a text editor saved them describe the same portal, and refusing the
 * second would train an operator to re-approve things that did not change —
 * which is how a review becomes a formality.
 *
 * So the hash is taken over a CANONICAL form, and the canonical form is
 * produced from the PARSED artefact rather than from the incoming text. That
 * ordering matters more than it looks: a parse rebuilds field by field
 * (`parse.ts`), so anything the parser does not recognise is gone before the
 * hash is computed. What is hashed is therefore exactly what the system will
 * act on — never a superset of it.
 *
 * The consequence is worth stating plainly, because it is the one thing a
 * reader might mistake for a weakness: bytes carrying an extra unrecognised
 * field hash the same as bytes without it. That is correct. The extra field
 * reaches nothing, changes nothing, and is not part of the artefact. A hash
 * that moved for it would refuse an artefact whose meaning is identical.
 *
 * What a reviewer approves is the canonical form (`pnpm run catalogue` prints
 * it), so the thing signed for and the thing hashed cannot drift apart.
 */

import { createHash } from "node:crypto";

/**
 * A value that can appear in a canonical artefact.
 *
 * `undefined` is absent, not null: an optional field that was not supplied and
 * one supplied as `null` must not canonicalise alike, because a reviewer
 * reading the two would not read them alike either.
 */
export type Canonical =
  | string
  | number
  | boolean
  | null
  | readonly Canonical[]
  | { readonly [key: string]: Canonical | undefined };

/**
 * The canonical text of a value.
 *
 * Object keys sorted by code unit; arrays left in the order they were given,
 * because the order of a blueprint's pages and a mapping set's mappings is
 * content and not presentation. Absent keys are omitted entirely.
 *
 * Deliberately NOT `JSON.stringify` with a replacer: `stringify` emits keys in
 * insertion order, which would make the hash depend on how an object happened
 * to be built.
 */
export function canonicalText(value: Canonical): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    // A non-finite number has no JSON form, and `JSON.stringify` would silently
    // write `null` — a value that reads as "absent" for one that was wrong.
    if (!Number.isFinite(value)) {
      throw new Error("a non-finite number cannot appear in a canonical artefact");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalText(item as Canonical)).join(",")}]`;
  }

  const record = value as { readonly [key: string]: Canonical | undefined };
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalText(item)}`);
  }
  return `{${parts.join(",")}}`;
}

/** An ISO-8601 instant in UTC, which is how every date is canonicalised. */
export function canonicalDate(value: Date): string {
  return value.toISOString();
}

/**
 * The content hash: SHA-256 over the canonical text, as lowercase hex.
 *
 * The identifier an approval is keyed by, and the only thing production code
 * consults to decide whether an artefact was reviewed.
 */
export function contentHash(value: Canonical): string {
  return createHash("sha256").update(canonicalText(value), "utf8").digest("hex");
}

/** A hash as it is written down: the algorithm, so it can be changed later. */
export const HASH_PREFIX = "sha256:";

/** `sha256:<64 hex>`. Prefixed so a future algorithm change is not silent. */
export function labelledHash(value: Canonical): string {
  return `${HASH_PREFIX}${contentHash(value)}`;
}

/** Whether a string is a well-formed labelled hash. Not whether it is approved. */
export function isLabelledHash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}
