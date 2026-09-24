/**
 * The join, held (P200, blocker 69).
 *
 * The derivation is what Vahid is asked to trust INSTEAD of a list somebody
 * typed, so the rule it applies has to be pinned by something other than the
 * one entry it happens to run against.
 */
import { describe, expect, it } from "vitest";

import { COUNTRIES } from "@askimate/aas-profile";

import type { Derivation, PortalOption, ReviewedDecision } from "./derive-country-mappings.js";
import {
  COUNTRY_FIELD_REFS,
  COUNTRY_MAPS,
  applyToEntry,
  bareValue,
  derivationsFrom,
  deriveCountryMapping,
  optionMapOf,
  optionsFromEntry,
  portalAliases,
  portalLabelsForCodes,
  passAudit,
  reviewPage,
  settledOptions,
  shapeOf,
} from "./derive-country-mappings.js";

import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMMITTED_DECISIONS: readonly ReviewedDecision[] = (
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "docs", "run-a", "country-mapping-decisions.json"),
      "utf8",
    ),
  ) as { decisions: ReviewedDecision[] }
).decisions;

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
    const derive = (): string =>
      reviewPage(derivationsFrom(ENTRY, COMMITTED_DECISIONS), passAudit(ENTRY, COMMITTED_DECISIONS));
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
      derivationsFrom(ENTRY, COMMITTED_DECISIONS),
      passAudit(ENTRY, COMMITTED_DECISIONS),
    );
    expect(committed, "run `pnpm run country-mappings`").toBe(fresh);
  });

  it("says what the portal offers before asking him to read anything", () => {
    const page = reviewPage(derivationsFrom(ENTRY, COMMITTED_DECISIONS).slice(0, 1));
    expect(page).toContain("What the portal has, before a single line is read");
    // 234, not 235: Vahid held `MF` here on 2026-09-25, because the list
    // carries Saint Martin and no Sint Maarten at all (blocker 66).
    expect(page).toContain("| `fundingNationality` | ISO codes | 242 | 234 |");
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

describe("a shared single word is not a resemblance (P203)", () => {
  // Vahid, reading the second version, 2026-09-24:
  //
  //   *"Northern Mariana Islands is in the Pacific; Northern Ireland is in
  //   the UK. Paired on the word 'Northern'. A student from Saipan would have
  //   had Northern Ireland on their application, and on this portal that
  //   carries a fee-status marker. Do not propose it again — and treat it as
  //   evidence that a shared leading word is not a resemblance."*
  //
  // Both of his rejections came from one word in common and nothing else.
  it("refuses the two pairings he rejected", () => {
    const northern = deriveCountryMapping("test", [option("NORTHERN IRELAND", "Northern Ireland")]);
    expect(northern.unmatched.find((u) => u.country.code === "MP")?.candidate).toBeNull();

    const french = deriveCountryMapping("test", [option("French West Indies:E", "French West Indies")]);
    expect(french.unmatched.find((u) => u.country.code === "TF")?.candidate).toBeNull();
  });

  it("refuses a shared TRAILING word too, not just a leading one", () => {
    // `Solomon Islands` and `Marshall Islands` share only `islands`.
    const derived = deriveCountryMapping("test", [option("Marshall Islands:O", "Marshall Islands")]);
    expect(derived.unmatched.find((u) => u.country.code === "SB")?.candidate).toBeNull();
  });

  it("refuses two saints that share only their title", () => {
    // `and` and `the` are dropped as joining words, so `St Kitts & Nevis` and
    // `Saint Vincent and the Grenadines` share `st` alone.
    const derived = deriveCountryMapping("test", [
      option("Saint Vincent and the Grenadines:O", "Saint Vincent and the Grenadines"),
    ]);
    expect(derived.unmatched.find((u) => u.country.code === "KN")?.candidate).toBeNull();
  });

  it("keeps the four he accepted, which is the other half of the bar", () => {
    const pairs: readonly (readonly [string, string])[] = [
      ["CC", "Cocos Islands"],
      ["CV", "Cape Verde Islands"],
      ["GS", "South Georgia & the South Sandwich Is"],
      ["US", "United States of America"],
    ];
    for (const [code, label] of pairs) {
      const derived = deriveCountryMapping("test", [option(`${label}:O`, label)]);
      expect(derived.unmatched.find((u) => u.country.code === code)?.candidate?.label, code).toBe(label);
    }
  });

  it("opens word for word, never letter for letter", () => {
    // `niger` is a letter-prefix of `nigeria` and not a word of it.
    const derived = deriveCountryMapping("test", [option("Nigeria:O", "Nigeria")]);
    expect(derived.unmatched.find((u) => u.country.code === "NE")?.candidate).toBeNull();
  });
});

describe("a hyphen between two words of a name is not a different name (P203)", () => {
  // Vahid: *"BF, Burkina Faso, is recorded as absent from at least one portal
  // list. Every UK university lists Burkina Faso and its name is the same in
  // every language."* Sheffield's three uppercase lists spell it
  // `BURKINA-FASO`; the pass had failed exactly the way Czechia's did.
  it("corroborates Burkina Faso across the lists that hyphenate it", () => {
    for (const d of derivationsFrom(ENTRY)) {
      const bf = d.unmatched.find((u) => u.country.code === "BF");
      if (bf === undefined) continue; // matched strictly on that field
      expect(bf.kind, d.fieldRef).toBe("portal_corroborated");
      expect(bf.candidate?.label, d.fieldRef).toBe("Burkina-Faso");
    }
  });

  it("was the ONLY country hiding behind punctuation, across every absent row", () => {
    // Measured when the fold was widened: if this ever fails, another country
    // has started hiding the same way and the absent column is lying again.
    const stillAbsent = derivationsFrom(ENTRY).flatMap((d) =>
      d.unmatched.filter((u) => u.kind === "absent").map((u) => `${d.fieldRef}:${u.country.code}`),
    );
    expect(stillAbsent.filter((row) => row.endsWith(":BF"))).toEqual([]);
  });
});

describe("what he decided is not asked again (P203)", () => {
  const DECIDED = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "docs", "run-a", "country-mapping-decisions.json"), "utf8"),
  ) as { decisions: ReviewedDecision[] };

  it("never offers a pairing he refused, and says who refused it", () => {
    const derived = deriveCountryMapping(
      "corrCountry",
      [option("NORTHERN IRELAND", "Northern Ireland")],
      new Map(),
      DECIDED.decisions,
    );
    const mp = derived.unmatched.find((u) => u.country.code === "MP");
    expect(mp?.candidate).toBeNull();
    expect(mp?.kind).toBe("rejected");
    expect(mp?.why).toContain("REFUSED by Vahid");
    expect(mp?.why).toContain("in the Pacific");
  });

  it("does NOT suppress a different option for a country he refused once", () => {
    // He refused MP → Northern Ireland. If the portal ever offered a real
    // Northern Mariana Islands option, that is a new proposal and he sees it.
    const derived = deriveCountryMapping(
      "corrCountry",
      [option("NORTHERN MARIANA ISLANDS", "Northern Mariana Islands")],
      new Map(),
      DECIDED.decisions,
    );
    // It matches strictly, in fact — which is the strongest form of not suppressed.
    expect(derived.matched.some((m) => m.country.code === "MP")).toBe(true);
  });

  it("HOLDS a code the strict pass matched exactly, not only one it proposed (P205)", () => {
    // ═══════════════════════════════════════════════════════════════════
    // Found applying P204's result, one step before the hash would have been
    // computed. He held `CY` on every field under blocker 70. `corrCountry`
    // offers BOTH `Cyprus` and `Cyprus (European Union)`, so the strict
    // name pass matched `Cyprus` EXACTLY and settled it as derived — and the
    // decisions only ever ran over candidates, so his hold never saw it.
    //
    // The entry would have carried `CY → CYPRUS` on two fields: every Cypriot
    // student sent the option that does not state a fee status, chosen by a
    // string match, on the one question blocker 70 exists to say we cannot
    // answer.
    // ═══════════════════════════════════════════════════════════════════
    const derived = derivationsFrom(ENTRY, DECIDED.decisions);
    for (const field of derived) {
      expect(
        field.matched.some((m) => m.country.code === "CY"),
        `CY is not derived on ${field.fieldRef}`,
      ).toBe(false);
      const cy = field.unmatched.find((u) => u.country.code === "CY");
      expect(cy?.kind, `CY is held on ${field.fieldRef}`).toBe("held");
      expect(cy?.why).toContain("blocker 70");
    }
  });

  it("does NOT let a REJECT suppress a strict match on a different option (P205)", () => {
    // The other half of the same rule, and why a hold and a reject are not
    // treated alike. A hold names no option — the code is not to be applied
    // at all. A reject names one, so a real Northern Mariana Islands option
    // is a new fact he has not read, not the Northern Ireland he refused.
    const derived = deriveCountryMapping(
      "corrCountry",
      [option("NORTHERN MARIANA ISLANDS", "Northern Mariana Islands")],
      new Map(),
      DECIDED.decisions,
    );
    expect(derived.matched.some((m) => m.country.code === "MP")).toBe(true);
  });

  it("lets an ACCEPT settle a collision, because his word is not a guess (P204)", () => {
    // ═══════════════════════════════════════════════════════════════════
    // `UM` and `VI` both proposed *Virgin Islands (US)* on residence. He
    // settled it himself: *"the option says US, and the US Virgin Islands are
    // VI. UM is the Minor Outlying Islands and is not that option — leave UM
    // unproposed rather than finding it something."*
    //
    // Until P204 the collision rule ran BEFORE his decisions, so `VI` was
    // withdrawn for colliding with `UM` and his acceptance was then read
    // against a candidate that no longer existed. Run it the right way round
    // and only GUESSES collide: an accepted pairing is his word.
    // ═══════════════════════════════════════════════════════════════════
    const derived = derivationsFrom(ENTRY, DECIDED.decisions);
    const residence = derived.find((d) => d.fieldRef === "permanentResidence");
    const vi = residence?.unmatched.find((u) => u.country.code === "VI");
    expect(vi?.kind).toBe("accepted");
    expect(vi?.candidate?.label).toContain("Virgin Islands (US)");
    // And UM is left with nothing rather than found something.
    const um = residence?.unmatched.find((u) => u.country.code === "UM");
    expect(um?.candidate).toBeNull();
    // Nothing is left fighting over that option.
    expect(residence?.collisions).toEqual([]);
  });

  it("prefers a verdict naming THIS field over one naming every field (P204)", () => {
    // He accepted `VI` → *Virgin Is (US)* everywhere and *Virgin Islands (US)*
    // on residence: the same territory under two of the portal's spellings.
    // Reading whichever verdict came first in the file would have left one of
    // the two rows unsettled, and which one would depend on the file's order.
    const derived = derivationsFrom(ENTRY, DECIDED.decisions);
    for (const field of derived) {
      const vi = field.unmatched.find((u) => u.country.code === "VI");
      if (vi === undefined) continue;
      expect(vi.kind, `VI is settled on ${field.fieldRef}`).toBe("accepted");
    }
  });

  it("marks what he accepted and what he held, with his words and the blocker", () => {
    const derived = derivationsFrom(ENTRY, DECIDED.decisions);
    const residence = derived.find((d) => d.fieldRef === "permanentResidence");
    const sx = residence?.unmatched.find((u) => u.country.code === "SX");
    expect(sx?.kind).toBe("accepted");
    expect(sx?.why).toContain("ACCEPTED by Vahid");

    const cy = residence?.unmatched.find((u) => u.country.code === "CY");
    expect(cy?.kind).toBe("held");
    expect(cy?.why).toContain("blocker 70");

    const mfHeld = derived
      .find((d) => d.fieldRef === "corrCountry")
      ?.unmatched.find((u) => u.country.code === "MF");
    expect(mfHeld?.kind).toBe("held");
    expect(mfHeld?.why).toContain("blocker 66");
  });

  it("leaves only what he has not read in the column that asks for him", () => {
    for (const d of derivationsFrom(ENTRY, DECIDED.decisions)) {
      const toRead = d.unmatched.filter((u) => u.kind === "name_resemblance");
      expect(toRead.length, d.fieldRef).toBeLessThanOrEqual(2);
      for (const row of toRead) {
        expect(["KN", "VI", "VC"], `${d.fieldRef} ${row.country.code}`).toContain(row.country.code);
      }
    }
  });
});

describe("writing the settled maps into the entry (P205)", () => {
  const derivations = () => derivationsFrom(ENTRY, COMMITTED_DECISIONS);

  it("carries only what is DERIVED, CORROBORATED or ACCEPTED — never a hold, a rejection or a guess", () => {
    for (const derivation of derivations()) {
      const settled = settledOptions(derivation);
      for (const row of derivation.unmatched) {
        if (row.kind === "portal_corroborated" || row.kind === "accepted") {
          expect(settled[row.country.code], `${derivation.fieldRef} ${row.country.code}`).toBe(
            row.candidate?.value,
          );
          continue;
        }
        expect(
          Object.hasOwn(settled, row.country.code),
          `${derivation.fieldRef} ${row.country.code} is ${row.kind} and must not be written`,
        ).toBe(false);
      }
    }
  });

  it("is sorted by ISO code, so a re-run diffs as what changed and not as how a Map was ordered", () => {
    for (const derivation of derivations()) {
      const codes = Object.keys(settledOptions(derivation));
      expect(codes, derivation.fieldRef).toEqual([...codes].sort());
    }
  });

  it("changes the nine option maps and NOTHING else in the entry", () => {
    const { text, before, after } = applyToEntry(ENTRY, derivations());
    // IDEMPOTENT since P206 applied it: the entry already carries the settled
    // maps, so a re-run must move nothing. Before P206 this read 72 → 2,088;
    // that it now reads 2,088 → 2,088 is the property worth holding, because
    // an apply that drifted on a second run would move the hash under a
    // signature.
    expect(after, "the settled maps Vahid signed").toBe(2088);
    expect(before, "applying twice moves nothing").toBe(after);
    // Blank every option map on both sides: what is left must be identical, so
    // the hash this produces differs from the signed one by the countries
    // alone. The whole point of the signature Vahid is spending.
    const blanked = (json: string): unknown => {
      const value: unknown = JSON.parse(json);
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          for (const item of node) walk(item);
          return;
        }
        if (typeof node !== "object" || node === null) return;
        const record = node as Record<string, unknown>;
        if (record["kind"] === "option") record["options"] = {};
        for (const child of Object.values(record)) walk(child);
      };
      walk(value);
      return value;
    };
    expect(blanked(text)).toEqual(blanked(ENTRY));
  });

  it("gives the four residence-history maps the ONE field a person actually read", () => {
    // previousCountry2-4 are the same question repeated, and nobody read their
    // option lists. They take previousCountry1's set rather than being derived
    // from lists no reviewer saw.
    const applied = JSON.parse(applyToEntry(ENTRY, derivations()).text) as {
      mappingSet: { mappings: { fieldRef: string; source: unknown }[] };
    };
    const optionsFor = (ref: string): Record<string, string> => {
      const mapping = applied.mappingSet.mappings.find((m) => m.fieldRef === ref);
      let rule: unknown = (mapping?.source as { format?: unknown } | undefined)?.format;
      while (rule !== null && typeof rule === "object") {
        if ((rule as { kind?: string }).kind === "option") {
          return (rule as { options: Record<string, string> }).options;
        }
        rule = (rule as { then?: unknown }).then;
      }
      expect.unreachable(`no option rule for ${ref}`);
    };
    const first = optionsFor("previousCountry1");
    for (const ref of ["previousCountry2", "previousCountry3", "previousCountry4"]) {
      expect(optionsFor(ref), ref).toEqual(first);
    }
  });

  it("names nine maps, and every one of them is in the entry", () => {
    const applied = JSON.parse(ENTRY) as { mappingSet: { mappings: { fieldRef: string }[] } };
    expect(COUNTRY_MAPS).toHaveLength(9);
    for (const [ref] of COUNTRY_MAPS) {
      expect(
        applied.mappingSet.mappings.some((m) => m.fieldRef === ref),
        ref,
      ).toBe(true);
    }
  });
});

describe("the pass audit — every ruling, and what actually reached it (P206)", () => {
  const audit = () => passAudit(ENTRY, COMMITTED_DECISIONS);

  it("finds NOTHING that contradicts a ruling", () => {
    // The whole point of the table. A hold names no option, so anything
    // applied contradicts it; a reject names one, so only that option does.
    const broken = audit().filter((row) => row.contradicts);
    expect(
      broken.map((row) => `${row.code} on ${row.fieldRef} carries ${String(row.applied)}`),
    ).toEqual([]);
  });

  it("covers every hold and every reject on every field they reach", () => {
    const rows = audit();
    for (const decision of COMMITTED_DECISIONS) {
      if (decision.verdict !== "hold" && decision.verdict !== "reject") continue;
      const fields =
        decision.fieldRef === "*"
          ? COUNTRY_FIELD_REFS.filter(
              (ref) =>
                !COMMITTED_DECISIONS.some((d) => d.code === decision.code && d.fieldRef === ref),
            )
          : [decision.fieldRef];
      for (const fieldRef of fields) {
        expect(
          rows.some((row) => row.code === decision.code && row.fieldRef === fieldRef),
          `${decision.code} on ${fieldRef}`,
        ).toBe(true);
      }
    }
  });

  it("still reports rulings reached by the STRICT MATCH, so the column keeps doing work", () => {
    // If this ever goes to zero it means either the entry changed or the audit
    // stopped measuring, and the second is the one that matters: a column that
    // can only ever say one thing is not a check (CLAUDE.md).
    const strict = audit().filter((row) => row.reachedBy === "strict match");
    expect(strict.length).toBeGreaterThan(0);
    // CY on the two lists that offer a bare `Cyprus`, which is the case that
    // was found applying P204, and MF on the two ISO lists, which is the case
    // Vahid then ruled on. MP is here too and is CORRECT: a reject on a
    // different option.
    const held = strict.filter((row) => row.verdict === "hold").map((row) => `${row.code}/${row.fieldRef}`);
    expect(held.sort()).toEqual([
      "CY/corrCountry",
      "CY/institutionCountry-ts-control",
      "MF/countryOfBirth",
      "MF/fundingNationality",
    ]);
  });

  it("says a ruling that stops nothing stops nothing, rather than implying it saved something", () => {
    const rows = audit();
    const tf = rows.filter((row) => row.code === "TF");
    expect(tf.length, "TF was refused on every field").toBe(6);
    for (const row of tf) {
      expect(row.reachedBy, `${row.fieldRef}`).toBe("nothing");
      expect(row.wouldHaveBeen).toBe("—");
    }
  });
});
