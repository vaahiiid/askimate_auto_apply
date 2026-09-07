/**
 * The classification is total, and the derived list cannot drift from it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * B1 row 2 made structural (ADR-0077). The property being defended is not
 * "today's registry contains no special-category field" — it does not, and a
 * test asserting that would pass for ever without ever being about anything.
 *
 * The property is that a field CANNOT BE ADDED WITHOUT BEING CLASSIFIED, and
 * that an extraction plan can only name one classified `ordinary`. The first
 * half is enforced by `satisfies Record<ProfileFieldKey, DataCategory>` and
 * fails at compile time; what is left for this file is that the runtime
 * companions agree with it, because they are what a plan assembled from data
 * rather than written as a literal would meet.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import {
  ARTICLE_9_CATEGORIES,
  CLASSIFIED_FIELD_KEYS,
  FIELD_CATEGORY,
  categoryOf,
  isExtractable,
  unextractableFields,
} from "./categories.js";
import { PROFILE_FIELD_KEYS } from "./fields.js";

describe("every profile field is classified", () => {
  it("classifies EVERY key in the registry, and nothing else", () => {
    // The compile-time guarantee, asserted at runtime too: `satisfies` proves
    // the record covers the type, and this proves it covers the ITERABLE list
    // the rest of the system walks. The two could otherwise disagree.
    expect([...Object.keys(FIELD_CATEGORY)].sort()).toEqual([...PROFILE_FIELD_KEYS].sort());
  });

  it("gives every field one of the three categories", () => {
    for (const key of CLASSIFIED_FIELD_KEYS) {
      expect(["ordinary", "special_category", "undetermined"], key).toContain(categoryOf(key));
    }
  });

  it("quotes Article 9(1)'s categories as the statute enumerates them", () => {
    // Data rather than prose, so a reviewer can see what the classification was
    // made against. Eight, and the list is closed.
    expect(ARTICLE_9_CATEGORIES).toHaveLength(8);
    expect(ARTICLE_9_CATEGORIES).toContain("religious or philosophical beliefs");
    expect(ARTICLE_9_CATEGORIES).toContain("racial or ethnic origin");
    expect(ARTICLE_9_CATEGORIES).toContain(
      "biometric data for the purpose of uniquely identifying a natural person",
    );
  });
});

describe("what may be read off a document", () => {
  it("says nothing is wrong with the registry as it stands", () => {
    expect(unextractableFields([...PROFILE_FIELD_KEYS])).toEqual([]);
  });

  it("REFUSES a field that is not ordinary — so the answer above is an answer", () => {
    // ═══════════════════════════════════════════════════════════════════
    // The vacuity guard, and the reason this file exists.
    //
    // Every field in the registry is `ordinary` today, so the assertion above
    // would pass just as happily against a function that returned `[]`
    // unconditionally. This drives the REAL function with a classification it
    // must reject — the fabrication is the INPUT, never a re-implementation of
    // the filter beside it, which would prove nothing about the code that runs.
    //
    // It stands for the case B1 row 2 is about: a national ID that prints the
    // holder's religion on its face. No such field is added to the production
    // registry, because inventing a product decision to test a control is how
    // a control ends up guarding something nobody wanted.
    // ═══════════════════════════════════════════════════════════════════
    const asSpecial = unextractableFields([...PROFILE_FIELD_KEYS], () => "special_category");
    expect(asSpecial).toHaveLength(PROFILE_FIELD_KEYS.length);
    expect(asSpecial.every((row) => row.category === "special_category")).toBe(true);
  });

  it("treats UNDETERMINED as blocking, not as permission", () => {
    // ADR-0023's rule, in this file's terms: the honest answer "nobody
    // competent has decided" must block exactly as `special_category` does.
    // The dangerous state is the one that looks decided.
    const refused = unextractableFields(["identity.given_name"], () => "undetermined");
    expect(refused).toEqual([{ key: "identity.given_name", category: "undetermined" }]);
  });

  it("lets an ORDINARY field through, so it is not refusing everything", () => {
    expect(unextractableFields(["identity.given_name"], () => "ordinary")).toEqual([]);
    expect(isExtractable("identity.given_name")).toBe(true);
  });
});

