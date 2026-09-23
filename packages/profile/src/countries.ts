/**
 * Reading a country a student named, and refusing one this table does not hold.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — blocker 61, and the rule underneath it.
 *
 * P192 wrote `Address.countryCode` and had to refuse *"Iran"*, because turning
 * a country's name into `IR` is a lookup and there was no reviewed table to do
 * it with. Vahid's standing rule made a half-table worse than none: *"a value
 * the student did not state is never supplied by us, however obvious the
 * default looks from where we sit"*, and a lookup that works for some students
 * and silently fails for others is the invisible failure this repository has
 * spent a week finding.
 *
 * With the table reviewed and frozen, reading a name is no longer a guess. It
 * is a lookup in an artefact somebody can check — so the student may type
 * `Iran` or `IR`, and anything the table does not hold is refused and asked
 * again rather than approximated.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createHash } from "node:crypto";

import type { Country } from "./countries.data.js";
import { COUNTRIES } from "./countries.data.js";

/**
 * The hash of the table as reviewed.
 *
 * ── What this does and does not promise ──────────────────────────────────
 *
 * It makes the table TAMPER-EVIDENT: an edit moves the hash and
 * `assertCountriesUnchanged` throws, so the list cannot drift quietly the way
 * the test count drifted 136 before ADR-0084.
 *
 * It is NOT a signature, and that is DELIBERATE — not an oversight for somebody
 * to tidy up later by adding one.
 *
 * Vahid, 2026-09-23, asked for the reason to live here rather than only in a
 * report, in his own words:
 *
 *   *"no signature, and say why in the file itself rather than only in a
 *   report. A derivation that re-runs and 249 matching the published count is
 *   stronger evidence than my signature would be — I cannot check 249 codes
 *   and would be signing your arithmetic. Record that as the reason, so nobody
 *   later reads the missing signature as an oversight and adds one to tidy it
 *   up."*
 *
 * So what stands behind the CONTENT is the derivation recorded in
 * `countries.data.ts` and the test that re-runs it — 280 ICU regions minus 31
 * named non-assignments, and 249 is the published count. A signature here would
 * assert a check nobody performed, which is the kind of record ADR-0082 to
 * ADR-0084 spent three phases removing.
 *
 * **If you are about to add an approval to this artefact: don't.** Strengthen
 * the derivation instead.
 */
export const REVIEWED_COUNTRIES_HASH =
  "sha256:3081f7eb3e7796ffab6ded953fa69c9b00e9048e703d92d6d14053b2189e204a";

/**
 * The table's canonical form: one `CODE\tName` line per country, code order.
 *
 * Deliberately not JSON. A canonical form exists so that the same list hashes
 * the same way however it is written down, and JSON offers a dozen ways to
 * write the same object — which is the drift a hash is supposed to catch.
 */
export function canonicalCountries(countries: readonly Country[] = COUNTRIES): string {
  return [...countries]
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((country) => `${country.code}\t${country.name}`)
    .join("\n");
}

export function countriesHash(countries: readonly Country[] = COUNTRIES): string {
  return `sha256:${createHash("sha256").update(canonicalCountries(countries), "utf8").digest("hex")}`;
}

/** Thrown when the table is not the one that was reviewed. */
export class CountryTableChangedError extends Error {
  public constructor(found: string) {
    super(
      `The country table has changed: expected ${REVIEWED_COUNTRIES_HASH}, found ${found}. ` +
        `A country list that moves without anybody noticing is how a student's country ` +
        `silently becomes a different one. Re-derive it, review the diff, and update ` +
        `REVIEWED_COUNTRIES_HASH deliberately.`,
    );
    this.name = "CountryTableChangedError";
  }
}

/** Refuses a table that is not the reviewed one. Called before any lookup. */
export function assertCountriesUnchanged(countries: readonly Country[] = COUNTRIES): void {
  const found = countriesHash(countries);
  if (found !== REVIEWED_COUNTRIES_HASH) throw new CountryTableChangedError(found);
}

/** Case- and punctuation-insensitive, so `st. lucia` finds `St. Lucia`. */
/**
 * The ONE normalisation used to compare a country's text with anything else —
 * exported since P200 so the mapping derivation joins the portal's option text
 * the same way `readCountry` reads a student's answer. Two normalisers would
 * be two answers to the same question.
 */
export function normaliseCountryText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,'’]/g, "")
    .replace(/&/g, "and")
    .replace(/\s+/g, " ");
}

const BY_CODE: ReadonlyMap<string, Country> = new Map(
  COUNTRIES.map((country) => [country.code, country]),
);

/**
 * Names to countries — and the names that are NOT unique are absent.
 *
 * ICU's list has no duplicate names today and a test holds that. The map is
 * still built defensively: if a future ICU ever gave two codes one name,
 * reading it would be a coin flip, and a coin flip is exactly what this
 * artefact exists to prevent. Such a name is dropped, so it refuses.
 */
const BY_NAME: ReadonlyMap<string, Country> = (() => {
  const seen = new Map<string, Country | null>();
  for (const country of COUNTRIES) {
    const key = normaliseCountryText(country.name);
    seen.set(key, seen.has(key) ? null : country);
  }
  return new Map(
    [...seen].filter((entry): entry is [string, Country] => entry[1] !== null),
  );
})();

/**
 * Reads a country from what the student typed — a code or a name.
 *
 * Returns `null` for anything the reviewed table does not hold, including a
 * well-formed code nobody is assigned (`ZZ`) and a name it does not carry. The
 * interview then asks again; it never approximates.
 */
export function readCountry(raw: string): Country | null {
  assertCountriesUnchanged();
  const value = raw.trim();
  if (value.length === 0) return null;
  if (/^[A-Za-z]{2}$/.test(value)) return BY_CODE.get(value.toUpperCase()) ?? null;
  return BY_NAME.get(normaliseCountryText(value)) ?? null;
}
