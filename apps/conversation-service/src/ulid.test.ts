/**
 * The id generator, on its own.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Written after a deliberate regression SURVIVED: reversing the ULID so the
 * random half came first broke nothing, because every test that lists
 * conversations inserts them with literal ids. The generator's two published
 * properties — *"sortable by creation time and not guessable in sequence"* —
 * had nothing asserting either.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import { ulid, ULID_PATTERN } from "./ulid.js";

const AT = new Date("2026-09-04T12:00:00.000Z");

describe("the conversation id", () => {
  it("is the shape the contract publishes and the column enforces", () => {
    for (let index = 0; index < 200; index += 1) {
      expect(ulid(new Date(AT.getTime() + index))).toMatch(ULID_PATTERN);
    }
  });

  it("uses Crockford's alphabet, so a written-down id cannot be misread", () => {
    // I, L, O and U are absent on purpose: each is confusable with 1, 1, 0 and
    // V. A generator that admitted them would produce ids the column's CHECK
    // refuses, and the failure would surface as a database error nobody could
    // read rather than as this.
    const seen = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      for (const character of ulid(new Date(AT.getTime() + index))) seen.add(character);
    }
    for (const forbidden of ["I", "L", "O", "U"]) {
      expect(seen.has(forbidden), `${forbidden} must not appear`).toBe(false);
    }
  });

  it("SORTS by creation time — the property a listing pages on", () => {
    // Lexical order is time order. `GET /v1/conversations` orders on
    // `created_at`, but the id is the tiebreaker in the cursor, and an id whose
    // order disagreed with its timestamp would make a page's second sort key
    // fight its first.
    const ids = [0, 1, 2, 1000, 60_000, 86_400_000].map((offset) =>
      ulid(new Date(AT.getTime() + offset)),
    );
    expect([...ids].sort()).toEqual(ids);
  });

  it("is NOT guessable in sequence", () => {
    // Same millisecond, so the timestamp half is identical and only the random
    // half differs. Distinct every time, and never adjacent: an id that
    // incremented would let anyone holding one enumerate the next.
    const same = Array.from({ length: 500 }, () => ulid(AT));
    expect(new Set(same).size, "no collisions in 500 draws").toBe(500);

    const times = new Set(same.map((id) => id.slice(0, 10)));
    expect(times.size, "one millisecond, one timestamp half").toBe(1);
    const randoms = same.map((id) => id.slice(10));
    expect(new Set(randoms).size).toBe(500);
    // Sorted, no two neighbours differ only in the final character — which is
    // what a counter, or a badly seeded generator, would produce.
    const sorted = [...randoms].sort();
    let adjacent = 0;
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index]!.slice(0, 15) === sorted[index - 1]!.slice(0, 15)) adjacent += 1;
    }
    expect(adjacent, "80 random bits do not cluster").toBe(0);
  });

  it("takes the clock it is given, like every other clock here", () => {
    // The timestamp half is a pure function of the argument, so two calls with
    // one `Date` agree on the first ten characters. An ambient `Date.now()`
    // inside would make the id untestable and the ordering unprovable.
    const first = ulid(AT);
    const second = ulid(AT);
    expect(second.slice(0, 10)).toBe(first.slice(0, 10));
    expect(ulid(new Date(AT.getTime() + 1)).slice(0, 10)).not.toBe(first.slice(0, 10));
  });
});
