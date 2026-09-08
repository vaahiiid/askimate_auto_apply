/**
 * The four B2 determinations are registered, usable, and say what was decided.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0022 required a named person to determine a lawful basis for each
 * activity and named nobody; the blocker stood from P31 to P54. Answered by
 * Vahid Mohammadi on 2026-09-08.
 *
 * These check the determinations as RECORDED — that each carries a named
 * determiner, a date, a review date and reasoning, that the Article 6 basis is
 * the one decided, and that the two activities needing student authorisation
 * say so. They do not check the law, which ADR-0023 forbids this repository
 * from reading.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import {
  B2_DETERMINATIONS,
  B2_DETERMINED_AT,
  B2_REVIEW_BY,
  DISCLOSE_DOCUMENT,
  MINOR_ROUTE,
  STORE_ACADEMIC_DOCUMENT,
  STORE_IDENTITY_DOCUMENT,
  b2Register,
} from "./b2-determinations.js";
import { DISCLOSURE_ACTIVITY } from "./disclosure.js";
import { determineLawfulBasis } from "./lawful-basis.js";

const NOW = new Date("2026-09-08T12:00:00Z");

describe("the four B2 determinations", () => {
  it("are all four, and all usable", () => {
    expect(B2_DETERMINATIONS).toHaveLength(4);
    for (const record of B2_DETERMINATIONS) {
      const checked = determineLawfulBasis(record, NOW);
      expect(checked.valid, `${record.determinationId} was refused`).toBe(true);
    }
  });

  it("each names a person, a date, a review date and reasoning", () => {
    // The four things `determineLawfulBasis` treats as mandatory, asserted
    // here as CONTENT rather than as passing validation: a determination that
    // satisfied the checker with a one-word reason would pass there and be
    // useless to anyone reviewing it.
    for (const record of B2_DETERMINATIONS) {
      expect(record.determinedBy, record.determinationId).toBe("Vahid Mohammadi");
      expect(record.determinedAt).toEqual(B2_DETERMINED_AT);
      expect(record.reviewBy).toEqual(B2_REVIEW_BY);
      expect(record.reasoning.length, `${record.determinationId} reasoning is thin`).toBeGreaterThan(
        200,
      );
    }
  });

  it("sets the review twelve months out, as instructed", () => {
    expect(B2_REVIEW_BY.getUTCFullYear() - B2_DETERMINED_AT.getUTCFullYear()).toBe(1);
    expect(B2_REVIEW_BY.getUTCMonth()).toBe(B2_DETERMINED_AT.getUTCMonth());
    expect(B2_REVIEW_BY.getUTCDate()).toBe(B2_DETERMINED_AT.getUTCDate());
  });

  it("does NOT name consent for storing or disclosing", () => {
    // ── The part that matters ────────────────────────────────────────────
    //
    // Vahid: "Consent must be freely given, and a student who cannot get their
    // application submitted without agreeing has not freely given anything. A
    // record claiming consent in that situation looks like compliance and is
    // not."
    //
    // Asserted as a property rather than left to the reasoning text, because a
    // later edit could change the basis and leave the paragraph behind.
    for (const record of [STORE_IDENTITY_DOCUMENT, STORE_ACADEMIC_DOCUMENT, DISCLOSE_DOCUMENT]) {
      expect(record.article6, `${record.determinationId} names consent`).toBe("contract");
    }
  });

  it("names consent ONLY for the minor's route, and requires authorisation with it", () => {
    expect(MINOR_ROUTE.article6).toBe("consent");
    // Not optional: `determineLawfulBasis` refuses consent without
    // authorisation, and this is the one determination that has to satisfy it.
    expect(MINOR_ROUTE.requiresStudentAuthorisation).toBe(true);
  });

  it("requires student authorisation for DISCLOSING and not for storing", () => {
    // "Storing a document and sending it are different acts." The preview, the
    // authorisation text and the content hash are registered as required here.
    expect(DISCLOSE_DOCUMENT.requiresStudentAuthorisation, "sending needs asking").toBe(true);
    expect(STORE_IDENTITY_DOCUMENT.requiresStudentAuthorisation).toBe(false);
    expect(STORE_ACADEMIC_DOCUMENT.requiresStudentAuthorisation).toBe(false);
  });

  it("puts the Article 9 condition on the national ID and NOT on the passport", () => {
    // The distinction Vahid drew, and the reason it is a subset rather than a
    // flag: asking for a consent nobody needs is not caution.
    expect(STORE_IDENTITY_DOCUMENT.article9).toBe("explicit_consent");
    expect(STORE_IDENTITY_DOCUMENT.article9Required).toEqual(["national_id"]);
    expect(STORE_IDENTITY_DOCUMENT.activity.documentTypes).toContain("passport");
    expect(
      STORE_IDENTITY_DOCUMENT.article9Required,
      "a passport was given a condition it does not need",
    ).not.toContain("passport");
  });

  it("records WHY consent works for the national ID when it does not elsewhere", () => {
    // The alternative is the whole argument: the student has a passport, so the
    // choice is real. If that stops being true the determination must be
    // revisited, and the reasoning has to say so or nobody will know.
    expect(STORE_IDENTITY_DOCUMENT.reasoning).toMatch(/passport as an alternative/i);
    expect(STORE_IDENTITY_DOCUMENT.reasoning).toMatch(/CEASES TO BE TRUE|revisit/i);
  });

  it("registers each under the activity the code asks for", () => {
    const register = b2Register(NOW);
    expect(register.forActivity("store_document:identity_verification")).toBeDefined();
    expect(register.forActivity("store_document:application_submission")).toBeDefined();
    expect(register.forActivity("store_document:minor_safeguarding")).toBeDefined();
    expect(register.forActivity(DISCLOSURE_ACTIVITY)).toBeDefined();
  });

  it("registers NOTHING for financial evidence, deliberately", () => {
    // B1 row 12. ADR-0021 keeps the bank statement out of scope, ADR-0079
    // refused it an expiry threshold for the same reason, and a determination
    // here would make it look half-ready. Absence of a decision is not
    // permission — `assertStorable` throws for it, which is the point.
    const register = b2Register(NOW);
    expect(register.forActivity("store_document:financial_evidence")).toBeUndefined();
  });

  it("refuses to build a register from a determination that is not usable", () => {
    // The partial-register failure: a determination that silently failed
    // validation would leave storage proceeding on a basis nobody checked.
    const afterReview = new Date("2027-09-09T00:00:00Z");
    expect(() => b2Register(afterReview)).toThrow(/not usable/);
  });
});
