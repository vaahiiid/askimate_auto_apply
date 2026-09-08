/**
 * The Schedule 1 prerequisite refuses, and re-enabling it needs a name on it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Blocker 8 has been on the list since P31 as a HYPOTHETICAL: no
 * special-category processing was in scope, so no appropriate policy document
 * was needed yet. ADR-0087 changed that in one sentence — a national identity
 * card under Article 9(2)(a) — and DPA 2018 Schedule 1 wants the document to
 * exist BEFORE the processing rather than alongside it.
 *
 * Vahid, 2026-09-08:
 *
 *   "Disable national_id for now. Passport only. … Make it structural, not a
 *    note: national_id must be refused at the gate with a stated reason naming
 *    the missing policy document, so re-enabling it is a deliberate act rather
 *    than an oversight correcting itself."
 *
 * These check the record and the function. The refusal reaching a real upload
 * is checked at the gate, in `packages/documents/src/policy-document-gate.test.ts`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import type { AppropriatePolicyRegister } from "./appropriate-policy.js";
import {
  APPROPRIATE_POLICY_DOCUMENTS,
  AppropriatePolicyMissingError,
  requireAppropriatePolicy,
} from "./appropriate-policy.js";
import { STORE_IDENTITY_DOCUMENT } from "./b2-determinations.js";

const NOW = new Date("2026-09-08T12:00:00Z");

const HELD: AppropriatePolicyRegister = {
  national_id: {
    kind: "held",
    reference: "TEST-APD-001 (fixture — no such document exists)",
    confirmedBy: "test fixture",
    confirmedAt: new Date("2026-09-01T00:00:00Z"),
    reviewBy: new Date("2027-09-01T00:00:00Z"),
  },
};

describe("the appropriate policy document register", () => {
  it("holds `national_id` as OUTSTANDING and nothing else", () => {
    expect(Object.keys(APPROPRIATE_POLICY_DOCUMENTS)).toEqual(["national_id"]);
    expect(APPROPRIATE_POLICY_DOCUMENTS["national_id"]?.kind).toBe("outstanding");
  });

  it("leaves the PASSPORT out — a type needing no document must not be listed", () => {
    // The same argument that made the Article 9 condition a subset rather than
    // a flag (ADR-0087). Listing the passport as "outstanding" would refuse it
    // for a prerequisite it does not have, and listing it as "held" would claim
    // a document nobody wrote.
    expect(APPROPRIATE_POLICY_DOCUMENTS["passport"]).toBeUndefined();
    expect(requireAppropriatePolicy(APPROPRIATE_POLICY_DOCUMENTS, "passport", NOW)).toBe("passport");
  });

  it("names the requirement and its owner, not merely that something is missing", () => {
    const entry = APPROPRIATE_POLICY_DOCUMENTS["national_id"];
    expect(entry?.kind).toBe("outstanding");
    if (entry?.kind !== "outstanding") return;
    expect(entry.requirement).toMatch(/DPA 2018 Schedule 1/);
    expect(entry.heldBy).toMatch(/DPIA owner/);
    expect(entry.why, "a refusal nobody can act on is a defect report").toMatch(/ADR-0088/);
  });

  it("does NOT weaken the ADR-0087 determination it blocks", () => {
    // The whole reason this is a separate record. The determination is Vahid's
    // and it is made; the policy document is somebody else's and it is not.
    // Re-enabling must not read as a correction to the determination.
    expect(STORE_IDENTITY_DOCUMENT.article9).toBe("explicit_consent");
    expect(STORE_IDENTITY_DOCUMENT.article9Required).toEqual(["national_id"]);
  });
});

describe("requireAppropriatePolicy", () => {
  it("REFUSES a type whose document is outstanding", () => {
    expect(() =>
      requireAppropriatePolicy(APPROPRIATE_POLICY_DOCUMENTS, "national_id", NOW),
    ).toThrow(AppropriatePolicyMissingError);
  });

  it("says WHAT is missing, WHO holds it, and what re-enabling would take", () => {
    try {
      requireAppropriatePolicy(APPROPRIATE_POLICY_DOCUMENTS, "national_id", NOW);
      expect.unreachable("a national ID cleared the Schedule 1 gate");
    } catch (error) {
      const message = String(error);
      expect(message).toMatch(/DPA 2018 Schedule 1 appropriate policy document/);
      expect(message).toMatch(/DPIA owner/);
      expect(message, "the refusal must not read as a defect").toMatch(/deliberate refusal/);
      expect(message).toMatch(/reference and a named confirmer/);
    }
  });

  it("clears a type whose document is HELD and current", () => {
    expect(requireAppropriatePolicy(HELD, "national_id", NOW)).toBe("national_id");
  });

  it("REFUSES a held document past its review date", () => {
    // The one staleness rule `assertStorable` applies itself, because there is
    // nowhere else it could live: a `held` entry is a plain record, minted by
    // no function and printed by no report.
    const lapsed = new Date("2027-09-02T00:00:00Z");
    expect(() => requireAppropriatePolicy(HELD, "national_id", lapsed)).toThrow(
      /due for review on 2027-09-01/,
    );
  });

  it("treats the review date as INCLUSIVE — the day it is due it is not current", () => {
    expect(() => requireAppropriatePolicy(HELD, "national_id", new Date("2027-09-01T00:00:00Z")))
      .toThrow(AppropriatePolicyMissingError);
  });

  it("carries the failing type on the error, so a caller can say which", () => {
    try {
      requireAppropriatePolicy(APPROPRIATE_POLICY_DOCUMENTS, "national_id", NOW);
      expect.unreachable("a national ID cleared the Schedule 1 gate");
    } catch (error) {
      expect(error).toBeInstanceOf(AppropriatePolicyMissingError);
      expect((error as AppropriatePolicyMissingError).documentType).toBe("national_id");
    }
  });
});
