/**
 * The join, held (P200, blocker 69).
 *
 * The derivation is what Vahid is asked to trust INSTEAD of a list somebody
 * typed, so the rule it applies has to be pinned by something other than the
 * one entry it happens to run against.
 */
import { describe, expect, it } from "vitest";

import { COUNTRIES } from "@askimate/aas-profile";

import type { PortalOption } from "./derive-country-mappings.js";
import {
  COUNTRY_FIELD_REFS,
  bareValue,
  deriveCountryMapping,
  optionMapOf,
  optionsFromEntry,
  reviewPage,
  shapeOf,
} from "./derive-country-mappings.js";

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ENTRY = readFileSync(
  join(import.meta.dirname, "..", "docs", "run-a", "catalogue", "entries", "sheffield-pgt-2027-09.json"),
  "utf8",
);

const option = (value: string, label: string): PortalOption => ({ value, label });

describe("the fee-status suffix", () => {
  it("strips EVERY single letter, not the two that happened to be looked at", () => {
    // P199's first measurement read `:H` and `:O` and not `:E`, and reported
    // Germany, France, Spain and Austria as missing from a list that has them.
    // The number it produced — 51 — was wrong by 37, and nothing was recorded
    // until it was re-measured.
    expect(bareValue("IR:O")).toBe("IR");
    expect(bareValue("GB:H")).toBe("GB");
    expect(bareValue("DE:E")).toBe("DE");
    expect(bareValue("XX:Q")).toBe("XX");
    expect(bareValue("IRAN")).toBe("IRAN");
    expect(bareValue("Iran, Islamic Republic of:O")).toBe("Iran, Islamic Republic of");
  });
});

describe("what shape a select spells its countries in", () => {
  it("is measured from the options, not configured", () => {
    expect(shapeOf([option("IR:O", "Iran"), option("GB:H", "United Kingdom")])).toBe("iso_code");
    expect(shapeOf([option("Iran:O", "Iran"), option("United Kingdom:H", "UK")])).toBe("name");
    expect(shapeOf([])).toBe("name");
  });
});

describe("the strict join is exact, and says so by missing", () => {
  it("does NOT pair our name with a longer one the portal uses", () => {
    // The whole reason the name-valued fields go to a person: `Iran` and
    // `Iran, Islamic Republic of` are the same country and not the same string.
    const derived = deriveCountryMapping("test", [
      option("Iran, Islamic Republic of:O", "Iran, Islamic Republic of"),
    ]);
    expect(derived.matched.map((m) => m.country.code)).not.toContain("IR");
    const iran = derived.unmatched.find((u) => u.country.code === "IR");
    if (iran === undefined) return expect.unreachable("IR should be unmatched");
    // …but it is PROPOSED, so the page shows him the disagreement rather than
    // a blank he has to go and look up.
    expect(iran.candidate?.value).toBe("Iran, Islamic Republic of:O");
    expect(iran.why).toContain("UNVERIFIED");
  });

  it("matches a code even when the names disagree entirely", () => {
    const derived = deriveCountryMapping("test", [option("CZ:E", "Czech Republic")]);
    expect(optionMapOf(derived)["CZ"]).toBe("CZ:E");
  });

  it("proposes nothing when nothing resembles the name, rather than reaching", () => {
    // `Côte d'Ivoire` and `Ivory Coast` are the same country. A join that
    // paired them would be a join that pairs anything.
    const derived = deriveCountryMapping("test", [option("Ivory Coast:O", "Ivory Coast")]);
    const ci = derived.unmatched.find((u) => u.country.code === "CI");
    expect(ci?.candidate).toBeNull();
  });

  it("counts the portal's options and what nothing claimed", () => {
    const derived = deriveCountryMapping("test", [
      option("", "Please choose"),
      option("IR:O", "Iran"),
      option("XL:H", "Channel Islands, not otherwise specified"),
    ]);
    expect(derived.offered).toBe(2);
    expect(derived.unclaimed.map((o) => o.value)).toEqual(["XL:H"]);
  });
});

describe("the reviewed Sheffield entry, derived", () => {
  it("derives the two code-valued fields and leaves the rest to be read", () => {
    const derived = COUNTRY_FIELD_REFS.map((ref) =>
      deriveCountryMapping(ref, optionsFromEntry(ENTRY, ref)),
    );
    const byRef = new Map(derived.map((d) => [d.fieldRef, d]));

    for (const ref of ["fundingNationality", "countryOfBirth"]) {
      const d = byRef.get(ref);
      if (d === undefined) return expect.unreachable(`${ref} is derived`);
      expect(d.shape, ref).toBe("iso_code");
      expect(d.matched.length, ref).toBe(235);
      expect(d.unmatched.length, ref).toBe(14);
      // The entry's eight hand-typed codes are all still what they were.
      expect(optionMapOf(d)["IR"], ref).toBe("IR:O");
      expect(optionMapOf(d)["GB"], ref).toBe("GB:H");
    }

    for (const ref of ["corrCountry", "permanentResidence", "previousCountry1"]) {
      const d = byRef.get(ref);
      if (d === undefined) return expect.unreachable(`${ref} is read`);
      expect(d.shape, ref).toBe("name");
      // Between 15% and 18% of 249, which is what sends these to a person.
      expect(d.unmatched.length, ref).toBeGreaterThan(36);
      expect(d.unmatched.length, ref).toBeLessThan(46);
    }
  });

  it("puts Iran on the page he has to read, which is how he knew the page was honest", () => {
    const d = deriveCountryMapping("permanentResidence", optionsFromEntry(ENTRY, "permanentResidence"));
    const iran = d.unmatched.find((u) => u.country.code === "IR");
    expect(iran?.candidate?.value).toBe("Iran, Islamic Republic of:O");
  });

  it("covers every country-typed target field of the entry", () => {
    // If a country field is added to the entry and not here, its mapping would
    // be neither derived nor reviewed, and nothing would say so.
    for (const ref of COUNTRY_FIELD_REFS) {
      expect(optionsFromEntry(ENTRY, ref).length, ref).toBeGreaterThan(200);
    }
    expect(COUNTRIES.length).toBe(249);
  });
});

describe("the page", () => {
  it("is deterministic — the same derivation writes the same bytes", () => {
    const derive = (): string =>
      reviewPage(COUNTRY_FIELD_REFS.map((ref) => deriveCountryMapping(ref, optionsFromEntry(ENTRY, ref))));
    expect(derive()).toBe(derive());
  });

  it("is the page that is COMMITTED — a generated document that has drifted is worse than none", () => {
    // The same rule the census lives under (ADR-0084): the artefact in the
    // repository is the one a person reads, so it must be the one the
    // derivation produces, not a stale copy of an older run.
    const committed = readFileSync(
      join(import.meta.dirname, "..", "docs", "run-a", "country-mapping-review.md"),
      "utf8",
    );
    const fresh = reviewPage(
      COUNTRY_FIELD_REFS.map((ref) => deriveCountryMapping(ref, optionsFromEntry(ENTRY, ref))),
    );
    expect(committed, "run `pnpm run country-mappings`").toBe(fresh);
  });

  it("says what the portal offers before asking him to read anything", () => {
    const page = reviewPage([
      deriveCountryMapping("fundingNationality", optionsFromEntry(ENTRY, "fundingNationality")),
    ]);
    expect(page).toContain("What the portal has, before a single line is read");
    expect(page).toContain("| `fundingNationality` | ISO codes | 242 | 235 / 249 |");
  });
});
