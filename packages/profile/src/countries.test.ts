/**
 * The country table (P195, blocker 61).
 *
 * The derivation is RE-RUN here rather than asserted: a table nobody can
 * reproduce is a table nobody can review, which is the whole of Vahid's
 * instruction — *"build it as a reviewed artefact, not a lookup you generate"*.
 */

import { describe, expect, it } from "vitest";

import { COUNTRIES, NOT_ASSIGNED } from "./countries.data.js";
import {
  CountryTableChangedError,
  REVIEWED_COUNTRIES_HASH,
  assertCountriesUnchanged,
  canonicalCountries,
  countriesHash,
  readCountry,
} from "./countries.js";

describe("the table is the one that was reviewed", () => {
  it("hashes to the reviewed hash, so an edit cannot pass unnoticed", () => {
    expect(countriesHash()).toBe(REVIEWED_COUNTRIES_HASH);
    expect(() => { assertCountriesUnchanged(); }).not.toThrow();
  });

  it("REFUSES a table with a country added, removed or renamed", () => {
    // Three separate tamperings, because a hash that caught only one would be
    // worth nothing. Each is what a careless edit actually looks like.
    const added = [...COUNTRIES, { code: "ZZ", name: "Nowhere" }];
    const removed = COUNTRIES.filter((country) => country.code !== "IR");
    const renamed = COUNTRIES.map((country) =>
      country.code === "IR" ? { code: "IR", name: "Persia" } : country,
    );
    for (const tampered of [added, removed, renamed]) {
      expect(() => { assertCountriesUnchanged(tampered); }).toThrow(CountryTableChangedError);
    }
  });

  it("says what to do about it, rather than just failing", () => {
    try {
      assertCountriesUnchanged(COUNTRIES.slice(1));
      expect.unreachable("a short table is not the reviewed one");
    } catch (error) {
      expect(String(error)).toContain("review the diff");
      expect(String(error), "and why it matters").toContain("silently becomes a different one");
    }
  });

  it("canonicalises in code order, so the file's own order cannot move the hash", () => {
    const shuffled = [...COUNTRIES].reverse();
    expect(canonicalCountries(shuffled)).toBe(canonicalCountries());
  });
});

describe("the derivation, re-run", () => {
  it("is exactly ICU's regions minus the 31 codes ISO does not assign", () => {
    // 280 − 31 = 249. The arithmetic is the guard on the exclusion set: get a
    // single exclusion wrong and this count moves.
    const display = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });
    const resolved: string[] = [];
    for (let first = 65; first <= 90; first += 1) {
      for (let second = 65; second <= 90; second += 1) {
        const code = String.fromCharCode(first) + String.fromCharCode(second);
        if (display.of(code) !== code) resolved.push(code);
      }
    }
    expect(resolved.length, "what ICU knows").toBe(280);
    expect(Object.keys(NOT_ASSIGNED).length, "what ISO does not assign").toBe(31);
    expect(COUNTRIES.length, "the published count of assigned alpha-2 codes").toBe(249);

    const kept = resolved.filter((code) => !(code in NOT_ASSIGNED));
    expect(kept.sort()).toEqual(COUNTRIES.map((country) => country.code).sort());
  });

  it("gives every excluded code a reason, since the subtraction is the judgement", () => {
    for (const [code, reason] of Object.entries(NOT_ASSIGNED)) {
      expect(reason.length, code).toBeGreaterThan(10);
    }
  });

  it("has no two countries sharing a name, which a lookup would have to coin-flip on", () => {
    const names = COUNTRIES.map((country) => country.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("reading what the student typed", () => {
  it("reads a code", () => {
    expect(readCountry("IR")).toEqual({ code: "IR", name: "Iran" });
    expect(readCountry(" gb ")).toEqual({ code: "GB", name: "United Kingdom" });
  });

  it("reads a NAME — which P192 had to refuse, for want of this table", () => {
    // The point of the phase. `countryCodeIso2` refused "Iran" because turning
    // a name into a code was a guess; against a reviewed table it is a lookup.
    expect(readCountry("Iran")?.code).toBe("IR");
    expect(readCountry("united kingdom")?.code).toBe("GB");
    expect(readCountry("St. Lucia")?.code).toBe("LC");
    expect(readCountry("Antigua and Barbuda")?.code, "& and 'and' are one name").toBe("AG");
  });

  it("REFUSES a well-formed code nobody is assigned, and a name it does not hold", () => {
    // `ZZ` is the case a shape check alone cannot catch, and the reason the
    // table exists rather than a regular expression.
    for (const refused of ["ZZ", "XK", "EU", "UK", "Persia", "Narnia", "", "   ", "I"]) {
      expect(readCountry(refused), refused).toBeNull();
    }
  });

  it("refuses a code that is only formerly assigned, rather than resolving history", () => {
    // A student typing `YU` means something, and it is not a country this form
    // can name. Asking again is the honest answer.
    for (const gone of ["YU", "AN", "SU", "ZR"]) expect(readCountry(gone), gone).toBeNull();
  });
});
