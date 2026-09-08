/**
 * A refusal that is a DECISION reads differently from one that is an absence.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0087 measured every (document type, purpose) pair through the storage
 * gates and reported `other / audit_evidence` as an OPEN QUESTION: it has a
 * retention policy — B1 row 5, six years from `case_concluded` — and no
 * storage determination. Vahid closed it on 2026-09-08:
 *
 *   "The audit record is the transmission record, the preview hash and the
 *    authorisation text, not an uploaded document. Allowing a document to be
 *    stored under that purpose would extend the six-year period from a receipt
 *    to a passport scan, which is what ADR-0078 was written to prevent. Record
 *    it as decided, not open."
 *
 * Prose would not have been enough. `NoLawfulBasisError` said one thing for
 * two facts — an activity AWAITING a decision, and an activity whose decision
 * IS the refusal — and a later phase reading the second as the first closes it
 * by registering a determination, which is the outcome the decision was made
 * to prevent. The retention side has had this distinction since ADR-0023.
 *
 * This file used to hold the Schedule 1 gate's tests as well. That gate and
 * the document type it refused were removed in ADR-0089; what survives here is
 * the half that was never about `national_id`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import type { DocumentType, RetentionSchedule } from "@askimate/aas-domain";
import {
  DeterminationDecidedAgainstError,
  NoLawfulBasisError,
  b2Register,
} from "@askimate/aas-disclosure";

import type { DocumentUpload } from "./vault.js";
import { assertStorable } from "./vault.js";

const NOW = new Date("2026-09-08T12:00:00Z");
const REGISTER = b2Register(NOW);

/** A passport under identity_verification, so nothing else is ever the reason. */
const SCHEDULE: RetentionSchedule = {
  version: "test-b2",
  approvedAt: new Date("2026-09-01T00:00:00Z"),
  approvedBy: "data_protection_owner",
  effectiveFrom: new Date("2026-09-01T00:00:00Z"),
  policies: [
    {
      documentType: "passport",
      purpose: "identity_verification",
      trigger: "last_used",
      retainForDays: 365,
      action: "delete",
      erasureBehaviour: "full",
      policyReference: "AAS-RET-passport",
      basis: {
        kind: "policy_decision",
        statement: "Test fixture. Held for reuse across applications (ADR-0078).",
        authoritativeSource: "AAS test fixture",
        verifiedBy: "test",
        verifiedAt: new Date("2026-09-01T00:00:00Z"),
        reliesOnLegalClaims: false,
      },
      reviewBy: new Date("2027-09-01T00:00:00Z"),
    },
  ],
  unresolved: [],
  determinations: [],
  obligations: [],
};

function upload(overrides: Partial<DocumentUpload> = {}): DocumentUpload {
  return {
    studentId: "stu_decided",
    documentType: "passport",
    purpose: "identity_verification",
    contentType: "application/pdf",
    sizeBytes: 1024,
    contentHash: "a".repeat(64),
    dates: { expiresAt: new Date("2030-01-01T00:00:00Z") },
    ...overrides,
  };
}

describe("`other / audit_evidence` is DECIDED, not open", () => {
  /**
   * B1 row 5's shape, plus a passport row the real schedule does not have.
   *
   * The extra row is deliberate and it is what isolates the gate. In
   * `config/retention/v1.2026-09-07.json` only `other` has a policy under this
   * purpose, so a passport offered as audit evidence is refused by RETENTION
   * before this decision is ever consulted. Giving it one here asks the
   * question the decision is actually about: if the retention gate opened,
   * does the lawful-basis side still refuse? It must, because the six years
   * are carried by the PURPOSE, not by the type.
   */
  const AUDIT_SCHEDULE: RetentionSchedule = {
    ...SCHEDULE,
    policies: (["other", "passport"] as const).map((documentType) => ({
      documentType,
      purpose: "audit_evidence" as const,
      trigger: "case_concluded" as const,
      retainForDays: 2190,
      action: "anonymise" as const,
      erasureBehaviour: "redact_contents" as const,
      policyReference: `AAS-RET-B1-05-${documentType}`,
      basis: {
        kind: "policy_decision" as const,
        statement:
          "Test fixture mirroring B1 row 5. The audit record holds the preview hash, the " +
          "authorisation text and the transmission record — no bytes.",
        authoritativeSource: "AAS test fixture",
        verifiedBy: "test",
        verifiedAt: new Date("2026-09-07T00:00:00Z"),
        reliesOnLegalClaims: true,
      },
      reviewBy: new Date("2027-09-07T00:00:00Z"),
    })),
  };

  function storeAsAuditEvidence(documentType: DocumentType): unknown {
    return assertStorable({
      schedule: AUDIT_SCHEDULE,
      register: REGISTER,
      upload: upload({ documentType, purpose: "audit_evidence" }),
    });
  }

  it("refuses with a DECISION, not with an absence", () => {
    expect(() => storeAsAuditEvidence("other")).toThrow(DeterminationDecidedAgainstError);
    expect(() => storeAsAuditEvidence("other")).not.toThrow(NoLawfulBasisError);
  });

  it("says why, and says not to close it by registering a determination", () => {
    try {
      storeAsAuditEvidence("other");
      expect.unreachable("a document was stored as audit evidence");
    } catch (error) {
      const message = String(error);
      expect(message).toMatch(/six-year period from a receipt to a passport scan/);
      expect(message).toMatch(/ADR-0078/);
      expect(message).toMatch(/Do not close this by registering a determination/);
      expect(message).toMatch(/Vahid Mohammadi/);
    }
  });

  it("is keyed on the PURPOSE, so a passport is refused there too", () => {
    // The concrete form of Vahid's sentence: the six years would follow the
    // passport, because the period belongs to the purpose. The same passport
    // stores under `identity_verification` for 365 days after last use.
    expect(() => storeAsAuditEvidence("passport")).toThrow(DeterminationDecidedAgainstError);

    const passed = assertStorable({ schedule: SCHEDULE, register: REGISTER, upload: upload() });
    expect(passed.documentType).toBe("passport");
  });

  it("leaves an activity nobody has decided EITHER WAY saying so", () => {
    // The distinction only means something if the other state still exists.
    // `financial_evidence` has no determination and no decision against one —
    // it is B1 row 12, out of scope and blocking (ADR-0021, ADR-0079) — and it
    // must keep reporting an absence rather than a decision.
    expect(() =>
      assertStorable({
        schedule: {
          ...SCHEDULE,
          policies: [
            {
              ...SCHEDULE.policies[0]!,
              documentType: "bank_statement",
              purpose: "financial_evidence",
              policyReference: "AAS-RET-fixture-financial",
            },
          ],
        },
        register: REGISTER,
        upload: upload({ documentType: "bank_statement", purpose: "financial_evidence" }),
      }),
    ).toThrow(NoLawfulBasisError);
  });
});

describe("what ADR-0089 removed, and what still refuses in its place", () => {
  it("has no `national_id` in the identity determination's scope", () => {
    // The determination was CORRECT and is recorded in ADR-0087. What changed
    // is the document type leaving scope, not the thinking — so what this
    // asserts is the scope, not the reasoning.
    const determination = REGISTER.forActivity("store_document:identity_verification");
    expect(determination).toBeDefined();
    expect(determination?.activity.documentTypes).toEqual(["passport"]);
  });

  it("refuses a type no determination names, which is why the gates could go", () => {
    // The backstop that made removing the Article 9 and Schedule 1 gates safe.
    // A `sponsorship_letter` has never had a determination; it cannot be
    // stored, and neither can any special-category type somebody adds later,
    // until a determination names it. That is the moment those gates have to
    // be rebuilt, and ADR-0089 records what they were.
    expect(() =>
      assertStorable({
        schedule: {
          ...SCHEDULE,
          policies: [{ ...SCHEDULE.policies[0]!, documentType: "sponsorship_letter" }],
        },
        register: REGISTER,
        upload: upload({ documentType: "sponsorship_letter" }),
      }),
    ).toThrow(/not sponsorship_letter/);
  });
});
