/**
 * The join, held (P200, blocker 69).
 *
 * The derivation is what Vahid is asked to trust INSTEAD of a list somebody
 * typed, so the rule it applies has to be pinned by something other than the
 * one entry it happens to run against.
 */
import { describe, expect, it } from "vitest";

import { COUNTRIES } from "@askimate/aas-profile";

import type { Derivation, PortalOption } from "./derive-country-mappings.js";
import {
  COUNTRY_FIELD_REFS,
  bareValue,
  derivationsFrom,
  deriveCountryMapping,
  optionMapOf,
  optionsFromEntry,
  portalAliases,
  portalLabelsForCodes,
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
    const derived: readonly Derivation[] = derivationsFrom(ENTRY);
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
    const d = derivationsFrom(ENTRY).find((x) => x.fieldRef === "permanentResidence");
    if (d === undefined) return expect.unreachable("permanentResidence is derived");
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
    const derive = (): string => reviewPage(derivationsFrom(ENTRY));
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
    const fresh = reviewPage(derivationsFrom(ENTRY));
    expect(committed, "run `pnpm run country-mappings`").toBe(fresh);
  });

  it("says what the portal offers before asking him to read anything", () => {
    const page = reviewPage(derivationsFrom(ENTRY).slice(0, 1));
    expect(page).toContain("What the portal has, before a single line is read");
    expect(page).toContain("| `fundingNationality` | ISO codes | 242 | 235 |");
  });
});

describe("one option cannot be two countries (P202)", () => {
  // Vahid, reading the first page, 2026-09-23:
  //
  //   *"Two countries, one proposal, same submitted value. If I approved that
  //   page as it stands, a student from one would have the other on their
  //   application… refuse to propose the same submitted value for two
  //   different codes — make that a rule in the derivation rather than
  //   something I have to catch by eye."*
  //
  // The real entry no longer produces one, because pass 2 settles Congo from
  // the portal's own code list. The rule is held here on a list built to
  // collide, so it stays true when the data stops proving it.
  it("withdraws BOTH proposals and prints them as a collision", () => {
    const derived = deriveCountryMapping("test", [
      option("Congo:O", "Congo"),
      // No `Congo (Democratic Republic)`, so name resemblance offers the one
      // Congo to both CD and CG — which is exactly what the first page did.
    ]);
    for (const code of ["CD", "CG"]) {
      const entry = derived.unmatched.find((u) => u.country.code === code);
      expect(entry?.candidate, code).toBeNull();
      expect(entry?.why, code).toContain("WITHDRAWN");
      expect(entry?.why, code).toContain("one option cannot be two countries");
    }
    expect(derived.collisions).toHaveLength(1);
    expect(derived.collisions[0]?.countries.map((c) => c.code).sort()).toEqual(["CD", "CG"]);
  });

  it("does not withdraw a proposal that is the only one for its option", () => {
    const derived = deriveCountryMapping("test", [option("Iran, Islamic Republic of:O", "Iran, Islamic Republic of")]);
    expect(derived.collisions).toHaveLength(0);
    expect(derived.unmatched.find((u) => u.country.code === "IR")?.candidate?.value).toBe(
      "Iran, Islamic Republic of:O",
    );
  });
});

describe("the portal corroborating itself (P202)", () => {
  // Vahid: *"search the portal's list for each blank by something other than
  // our name, and say which blanks survive that. Czechia is the proof: the
  // code-valued field's spot-check shows Sheffield calls it 'Czech Republic',
  // so the name is right there in another list on the same portal."*
  const labels = (): ReadonlyMap<string, string> =>
    portalLabelsForCodes(COUNTRY_FIELD_REFS.map((ref) => optionsFromEntry(ENTRY, ref)));

  it("reads the portal's own name for a code out of its code-valued selects", () => {
    expect(labels().get("CZ")).toBe("Czech Republic");
    expect(labels().get("CD")).toBe("Congo (Democratic Republic)");
    expect(labels().get("CG")).toBe("Congo");
  });

  it("settles Czechia, which our name never could", () => {
    const residence = derivationsFrom(ENTRY).find((d) => d.fieldRef === "permanentResidence");
    const cz = residence?.unmatched.find((u) => u.country.code === "CZ");
    expect(cz?.kind).toBe("portal_corroborated");
    expect(cz?.candidate?.value).toBe("Czech Republic:E");
  });

  it("settles the TWO Congos the right way round, which is the whole point", () => {
    // Sheffield genuinely offers both, and its code list says which is which.
    // Getting these crossed would put one country on the other's application.
    for (const d of derivationsFrom(ENTRY)) {
      if (d.shape === "iso_code") continue;
      const cd = d.unmatched.find((u) => u.country.code === "CD");
      const cg = d.unmatched.find((u) => u.country.code === "CG");
      expect(cd?.kind, d.fieldRef).toBe("portal_corroborated");
      expect(cg?.kind, d.fieldRef).toBe("portal_corroborated");
      expect(cd?.candidate?.label, d.fieldRef).toBe("Congo (Democratic Republic)");
      expect(cg?.candidate?.label, d.fieldRef).toBe("Congo");
    }
  });

  it("splits the blanks: Korea and Ivory Coast are found, Antarctica is not", () => {
    const residence = derivationsFrom(ENTRY).find((d) => d.fieldRef === "permanentResidence");
    const kindOf = (code: string): string | undefined =>
      residence?.unmatched.find((u) => u.country.code === code)?.kind;
    // Countries a UK university certainly lists — the proposer had failed, not
    // the portal.
    for (const found of ["KP", "KR", "CI", "MM", "HK"]) expect(kindOf(found), found).toBe("portal_corroborated");
    // And one that really is not there.
    expect(kindOf("AQ")).toBe("absent");
  });

  it("refuses an abbreviation rather than reaching for it", () => {
    // Residence spells Laos `Lao PDR`; the code list says `Laos [Lao People¿s
    // Democratic Republic]`. Neither is the other, and pairing them is a
    // person's call, so it stays a blank he reads.
    const residence = derivationsFrom(ENTRY).find((d) => d.fieldRef === "permanentResidence");
    expect(residence?.unmatched.find((u) => u.country.code === "LA")?.kind).toBe("absent");
  });

  it("expands a portal label into the names the portal itself put in it", () => {
    expect([...portalAliases("Korea (South) [Korea, Republic of]")]).toContain("korea republic of");
    expect([...portalAliases("Ivory Coast [Côte D'ivoire]")]).toContain("ivory coast");
    // Nothing is invented: every alias is text the portal printed.
    expect([...portalAliases("Iran")]).toEqual(["iran"]);
  });
});
