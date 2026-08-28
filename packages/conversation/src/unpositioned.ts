/**
 * An event before the log has given it a position.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"The client must never create a durable ordinal."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Its own module because three things need it and they must not import each
 * other: the projection draws it, `openSecretRequest` decides over it, and the
 * client log holds it.
 *
 * ── Why a distributive conditional and not `Omit` ─────────────────────────
 *
 * `Omit<ConversationEvent, "ordinal" | "createdAt">` does NOT work. `Omit` is
 * built on `keyof`, and `keyof` over a union is the INTERSECTION of its
 * members' keys — so every kind-specific field disappears and the result
 * accepts nothing useful. `T extends unknown ? … : never` distributes over the
 * members and omits from each separately.
 *
 * ── Why `createdAt` goes with `ordinal` ───────────────────────────────────
 *
 * Both are the server's, for the same reason. The contract says of `createdAt`
 * that "a client's clock is never trusted for this"; a client that stamps its
 * own has produced a timestamp that will disagree with the log. So an
 * unpositioned event carries neither, and there is no field to put either in.
 */

import type { ConversationEvent } from "@askimate/aas-contracts";

export type Unpositioned<T> = T extends unknown ? Omit<T, "ordinal" | "createdAt"> : never;
export type UnpositionedEvent = Unpositioned<ConversationEvent>;

/**
 * COMPILE-TIME: an unpositioned event names no position.
 *
 * A constraint, not a computation. A conditional type that merely evaluates to
 * `never` when its claim is false fails at nothing — the mistake that made the
 * same assertion in `events.ts` vacuous until a regression caught it.
 */
type NamesAPosition<T> = T extends unknown
  ? Extract<keyof T, "ordinal" | "createdAt"> extends never
    ? never
    : T
  : never;
type AssertNever<T extends never> = T;
export type AN_UNPOSITIONED_EVENT_HAS_NO_POSITION = AssertNever<
  NamesAPosition<UnpositionedEvent>
>;
