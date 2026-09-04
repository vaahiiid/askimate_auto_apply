/**
 * A ULID, because the contract and the database both insist on one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `conversation.v1.yaml` publishes the id as `^[0-9A-HJKMNP-TV-Z]{26}$` and
 * migration 0001 makes that pattern a CHECK on the column, with the comment
 * *"the contract and the column cannot disagree, because the column will not
 * hold a value the contract forbids"*. Until now nothing produced one: every
 * conversation in this repository was inserted by a test with a literal.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The alphabet is not a choice ─────────────────────────────────────────
 *
 * That character class IS Crockford's base32 — 0-9 and the letters with I, L,
 * O and U removed, so a written-down id cannot be misread as a different valid
 * one. It is spelled out below rather than derived, because a generator whose
 * alphabet drifted from the CHECK would fail at the database with an error
 * nobody could read.
 *
 * ── Sortable, and not guessable ──────────────────────────────────────────
 *
 * The contract says *"sortable by creation time and not guessable in
 * sequence"*, and those pull in opposite directions. A ULID is both: 48 bits
 * of millisecond timestamp first, so lexical order is time order, then 80 bits
 * from the CSPRNG, so knowing one id tells you nothing about the next.
 *
 * `randomBytes`, never `Math.random`: an id that is also a capability-shaped
 * URL segment has no business coming from a predictable source, and the two
 * ids on this service that are guessed at from outside — a conversation and a
 * run — are exactly the ones ownership checks defend.
 */

import { randomBytes } from "node:crypto";

/** Crockford base32. The same 32 characters the column's CHECK admits. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const TIME_CHARS = 10;
const RANDOM_CHARS = 16;

/**
 * The 48-bit timestamp, most significant character first.
 *
 * Ten base32 characters hold 50 bits, so the top two are always zero until the
 * year 10889 — which is why a ULID sorts lexically without padding tricks.
 */
function encodeTime(ms: number): string {
  let remaining = ms;
  let out = "";
  for (let index = 0; index < TIME_CHARS; index += 1) {
    out = `${ALPHABET[remaining % 32] ?? "0"}${out}`;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

/**
 * Eighty bits of randomness, as sixteen base32 characters.
 *
 * Taken five bits at a time from ten bytes, so every character is uniformly
 * distributed. Reducing a byte modulo 32 would be simpler and would bias the
 * first eight characters of the alphabet, which is the classic way to make an
 * id look random and not be.
 */
function encodeRandom(): string {
  const bytes = randomBytes(10);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let out = "";
  for (let index = 0; index < RANDOM_CHARS; index += 1) {
    out = `${ALPHABET[Number(bits & 31n)] ?? "0"}${out}`;
    bits >>= 5n;
  }
  return out;
}

/** A fresh ULID. `now` is injected, because every clock in this repository is. */
export function ulid(now: Date): string {
  return `${encodeTime(now.getTime())}${encodeRandom()}`;
}

/** The shape the contract publishes and the column enforces. */
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
