/**
 * What the plans may ask for.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * B1 row 2, made structural (ADR-0077): *"a determination that we do NOT
 * extract or index any special-category field"* from a national identity
 * document.
 *
 * It is enforced in three places, because there are three ways in:
 *
 *   the constructor   `scalar()` and `composite()` take `ExtractableFieldKey`
 *   the interface     `ScalarTarget.fieldKey` is narrowed too, so a target
 *                     written as a raw object literal cannot bypass it
 *   this file         a plan ASSEMBLED FROM DATA meets neither of those,
 *                     because types erase — so the real classification is run
 *                     over the real plans here
 *
 * The first two fail at compile time and cannot be tested from inside the same
 * program: a `@ts-expect-error` naming a special-category field would fail to
 * compile because no such field EXISTS in the registry, which would pass for
 * the wrong reason and prove nothing. The measurement that they bite was made
 * by adding one and watching `tsc` refuse — recorded in ADR-0077 rather than
 * left as an assertion this file cannot honestly make.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import { PROFILE_FIELD_KEYS, unextractableFields } from "@askimate/aas-profile";

import { DOCUMENT_TYPES_WITH_PLANS, allExtractedFields, fieldsExtractedBy, planFor } from "./plans.js";

describe("no plan reads a field it may not read", () => {
  it("every field every configured plan asks for is classified ORDINARY", () => {
    const refused = unextractableFields([...allExtractedFields()]);
    expect(
      refused,
      "a plan asks for a field that is special-category or unclassified",
    ).toEqual([]);
  });

  it("is looking at actual plans, and actual fields", () => {
    // The vacuity guard. An empty plan set, or plans with no scalar targets,
    // would satisfy the assertion above without it being about anything —
    // which is precisely the failure ADR-0072 recorded about the walkthrough.
    expect(DOCUMENT_TYPES_WITH_PLANS.length).toBeGreaterThanOrEqual(3);
    expect(allExtractedFields().length, "eight today: seven off a passport, one off a transcript").toBeGreaterThanOrEqual(8);
    for (const key of allExtractedFields()) {
      expect(PROFILE_FIELD_KEYS, `${key} is not in the registry`).toContain(key);
    }
  });

  it("REFUSES the same plans under a classification that forbids them", () => {
    // The real check, driven with a classification it must reject. Without
    // this the assertion above would pass against a function that always
    // answered "nothing is wrong" — every field in the registry is ordinary
    // today, so the true case and the broken case look identical.
    const refused = unextractableFields([...allExtractedFields()], () => "special_category");
    expect(refused.length).toBe(allExtractedFields().length);
  });

  it("reads the fields off a plan, not off its document dates", () => {
    // `document_date` targets carry no field key: an expiry date feeds the
    // validity engine rather than the profile. Counting them would make the
    // check look broader than it is.
    const passport = planFor("passport");
    if (passport === undefined) expect.unreachable("the passport plan is configured");
    const fields = fieldsExtractedBy(passport);
    expect(fields).toContain("identity.passport_number");
    expect(fields.length).toBeLessThan(passport.targets.length);
  });
});
