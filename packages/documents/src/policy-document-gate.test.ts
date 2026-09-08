/**
 * A national ID is refused at the gate, and no consent can rescue it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0087 registered Article 9(2)(a) for a national identity card, which made
 * blocker 8 — the DPA 2018 Schedule 1 appropriate policy document — live rather
 * than hypothetical. Schedule 1 wants that document to exist BEFORE the
 * processing. It does not exist.
 *
 * Vahid, 2026-09-08:
 *
 *   "Disable national_id for now. Passport only. The Article 9 determination
 *    stays registered and correct, but the appropriate policy document must
 *    exist before that processing and it does not… Make it structural, not a
 *    note: national_id must be refused at the gate with a stated reason naming
 *    the missing policy document, so re-enabling it is a deliberate act rather
 *    than an oversight correcting itself."
 *
 * The distinction being kept: this is NOT the determination being wrong. The
 * determination is made, named and correct. A different person owes a different
 * document, and until it exists the type is NOT YET AVAILABLE rather than
 * available-and-non-compliant (ADR-0088).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import type { RetentionSchedule } from "@askimate/aas-domain";
import type { AppropriatePolicyRegister } from "@askimate/aas-disclosure";
import {
  APPROPRIATE_POLICY_DOCUMENTS,
  AppropriatePolicyMissingError,
  DeterminationDecidedAgainstError,
  NoLawfulBasisError,
  b2Register,
} from "@askimate/aas-disclosure";

import type { DocumentUpload, SpecialCategoryConsent } from "./vault.js";
import { assertStorable } from "./vault.js";

const NOW = new Date("2026-09-08T12:00:00Z");
const REGISTER = b2Register(NOW);

/** Both identity types have a policy, so retention is never why a case fails. */
const SCHEDULE: RetentionSchedule = {
  version: "test-b2",
  approvedAt: new Date("2026-09-01T00:00:00Z"),
  approvedBy: "data_protection_owner",
  effectiveFrom: new Date("2026-09-01T00:00:00Z"),
  policies: (["passport", "national_id"] as const).map((documentType) => ({
    documentType,
    purpose: "identity_verification" as const,
    trigger: "last_used" as const,
    retainForDays: 365,
    action: "delete" as const,
    erasureBehaviour: "full" as const,
    policyReference: `AAS-RET-${documentType}`,
    basis: {
      kind: "policy_decision" as const,
      statement: "Test fixture. Held for reuse across applications (ADR-0078).",
      authoritativeSource: "AAS test fixture",
      verifiedBy: "test",
      verifiedAt: new Date("2026-09-01T00:00:00Z"),
      reliesOnLegalClaims: false,
    },
    reviewBy: new Date("2027-09-01T00:00:00Z"),
  })),
  unresolved: [],
  determinations: [],
  obligations: [],
};

/** As good a consent as the determination could ever ask for. */
const PERFECT_CONSENT: SpecialCategoryConsent = {
  givenAt: NOW,
  wording:
    "Your national ID card may show information such as religion or ethnicity. We need your " +
    "explicit permission to hold it. You can use your passport instead.",
  askedSeparately: true,
};

function upload(overrides: Partial<DocumentUpload> = {}): DocumentUpload {
  return {
    studentId: "stu_apd",
    documentType: "passport",
    purpose: "identity_verification",
    contentType: "application/pdf",
    sizeBytes: 1024,
    contentHash: "a".repeat(64),
    dates: { expiresAt: new Date("2030-01-01T00:00:00Z") },
    ...overrides,
  };
}

/** The gate as production runs it: the REAL register, which refuses. */
function storeForReal(item: DocumentUpload, now: Date = NOW): unknown {
  return assertStorable({ schedule: SCHEDULE, register: REGISTER, upload: item, now });
}

describe("the Schedule 1 gate, against the register the system actually holds", () => {
  it("REFUSES a national ID even with a perfect separate consent", () => {
    // ── The property this phase exists for ───────────────────────────────
    //
    // The consent below satisfies every clause of the Article 9 gate: given,
    // asked separately, wording recorded. It still does not store, because the
    // missing thing is not the student's to give.
    expect(() =>
      storeForReal(upload({ documentType: "national_id", specialCategoryConsent: PERFECT_CONSENT })),
    ).toThrow(AppropriatePolicyMissingError);
  });

  it("names the missing policy document in the refusal", () => {
    // "with a stated reason naming the missing policy document" — Vahid. A
    // refusal that said only "not permitted" would be re-enabled by whoever
    // hit it next, on the assumption that it was a bug.
    try {
      storeForReal(upload({ documentType: "national_id", specialCategoryConsent: PERFECT_CONSENT }));
      expect.unreachable("a national ID entered the vault");
    } catch (error) {
      const message = String(error);
      expect(message).toMatch(/DPA 2018 Schedule 1 appropriate policy document/);
      expect(message).toMatch(/DPIA owner/);
      expect(message).toMatch(/deliberate refusal, not a defect/);
      expect(message, "the record to read before re-enabling").toMatch(/ADR-0088/);
    }
  });

  it("refuses BEFORE asking about consent, so nobody is sent to fix the wrong thing", () => {
    // Order matters here and it is not arbitrary. If the Article 9 gate ran
    // first, a developer would be told to record a consent, record it, and hit
    // this wall on the next run — two rounds to learn that no consent helps.
    try {
      storeForReal(upload({ documentType: "national_id" }));
      expect.unreachable("a national ID entered the vault");
    } catch (error) {
      expect(error).toBeInstanceOf(AppropriatePolicyMissingError);
    }
  });

  it("still stores a PASSPORT — the refusal is scoped to one document type", () => {
    // "Passport only." Blocking the whole identity route would have been the
    // easy version of this change and the wrong one: the passport carries no
    // special-category data on its face and needs no Schedule 1 document.
    const passed = assertStorable({
      schedule: SCHEDULE,
      register: REGISTER,
      upload: upload(),
      now: NOW,
    });
    expect(passed.documentType).toBe("passport");
    expect(passed.policyDocumentCleared).toBe("passport");
  });

  it("leaves the ADR-0087 determination registered and intact", () => {
    // The reason this is a separate record rather than an edit. A reader must
    // be able to see that the Article 9 determination is made and correct, and
    // that what is outstanding belongs to somebody else.
    const determination = REGISTER.forActivity("store_document:identity_verification");
    expect(determination).toBeDefined();
  });
});

describe("what re-enabling looks like", () => {
  /** What the DPIA owner finishing the document will produce. */
  const HELD: AppropriatePolicyRegister = {
    national_id: {
      kind: "held",
      reference: "TEST-APD-001 (fixture — no such document exists)",
      confirmedBy: "test fixture",
      confirmedAt: new Date("2026-09-01T00:00:00Z"),
      reviewBy: new Date("2027-09-01T00:00:00Z"),
    },
  };

  it("is ONE record, and then the national ID stores on its Article 9 consent", () => {
    const passed = assertStorable({
      schedule: SCHEDULE,
      register: REGISTER,
      policyDocuments: HELD,
      upload: upload({ documentType: "national_id", specialCategoryConsent: PERFECT_CONSENT }),
      now: NOW,
    });
    expect(passed.documentType).toBe("national_id");
    expect(passed.policyDocumentCleared).toBe("national_id");
  });

  it("does NOT dissolve the Article 9 gate behind it", () => {
    // The failure this phase could have introduced: a policy document that
    // "unblocks national IDs" and quietly takes the consent requirement with
    // it. Held document, no consent — still refused, by the other gate.
    expect(() =>
      assertStorable({
        schedule: SCHEDULE,
        register: REGISTER,
        policyDocuments: HELD,
        upload: upload({ documentType: "national_id" }),
        now: NOW,
      }),
    ).toThrow(/Article 9 condition/);
  });

  it("goes stale — a document nobody has reviewed since it lapsed refuses again", () => {
    expect(() =>
      assertStorable({
        schedule: SCHEDULE,
        register: REGISTER,
        policyDocuments: HELD,
        upload: upload({ documentType: "national_id", specialCategoryConsent: PERFECT_CONSENT }),
        now: new Date("2027-09-02T00:00:00Z"),
      }),
    ).toThrow(AppropriatePolicyMissingError);
  });

  it("fails CLOSED when the register is omitted altogether", () => {
    // `policyDocuments` is optional so tests can move the world forward. The
    // default has to be the refusing register, or the option would be a way to
    // skip the gate by forgetting it.
    expect(APPROPRIATE_POLICY_DOCUMENTS["national_id"]?.kind).toBe("outstanding");
    expect(() =>
      storeForReal(upload({ documentType: "national_id", specialCategoryConsent: PERFECT_CONSENT })),
    ).toThrow(AppropriatePolicyMissingError);
  });
});

describe("`other / audit_evidence` is DECIDED, not open", () => {
  // ═════════════════════════════════════════════════════════════════════════
  // ADR-0087 measured this pair and recorded it as an open question: a
  // retention policy exists (B1 row 5 — six years from `case_concluded`) and no
  // storage determination does. Vahid closed it on 2026-09-08, and the answer
  // was that the refusal is correct:
  //
  //   "The audit record is the transmission record, the preview hash and the
  //    authorisation text, not an uploaded document. Allowing a document to be
  //    stored under that purpose would extend the six-year period from a
  //    receipt to a passport scan, which is what ADR-0078 was written to
  //    prevent."
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * B1 row 5's shape, plus a passport row the real schedule does not have.
   *
   * The extra row is deliberate and it is what isolates the gate. In
   * `config/retention/v1.2026-09-07.json` only `other` has a policy under this
   * purpose, so a passport offered as audit evidence is refused by RETENTION
   * before this decision is ever consulted. Giving it one here asks the
   * question the decision is actually about: if the retention gate opened, does
   * the lawful-basis side still refuse? It must, because the six years are
   * carried by the PURPOSE, not by the type.
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

  function storeAsAuditEvidence(documentType: DocumentUpload["documentType"]): unknown {
    return assertStorable({
      schedule: AUDIT_SCHEDULE,
      register: REGISTER,
      upload: upload({ documentType, purpose: "audit_evidence" }),
      now: NOW,
    });
  }

  it("refuses with a DECISION, not with an absence", () => {
    // `NoLawfulBasisError` says "nobody determined this", which reads as work
    // outstanding — and the work that "closes" it is exactly what ADR-0078 was
    // written to prevent. The retention side has had this distinction since
    // ADR-0023; the lawful-basis side did not until now.
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
    // stores under `identity_verification` for 365 days after last use, which
    // the first group above proves.
    expect(() => storeAsAuditEvidence("passport")).toThrow(DeterminationDecidedAgainstError);
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
        now: NOW,
      }),
    ).toThrow(NoLawfulBasisError);
  });
});
