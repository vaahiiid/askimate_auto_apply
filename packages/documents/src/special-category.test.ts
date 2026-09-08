/**
 * A national identity card cannot be stored without its own consent.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * B2's Article 9 half, decided by Vahid Mohammadi on 2026-09-08 (ADR-0087):
 *
 *   "Some national ID cards carry religion or ethnicity on their face.
 *    ADR-0077 made extracting those fields impossible, but holding the image is
 *    still processing the data, whether or not anything reads it. So a national
 *    ID needs an Article 9 condition as well as an Article 6 basis."
 *
 * The distinction ADR-0077 does NOT cover is the whole point. That decision
 * made a special-category FIELD unextractable — `FIELD_CATEGORY` is total over
 * the profile registry and a plan may only name an `ordinary` key. None of that
 * touches the bytes of an image sitting in a vault.
 *
 * And the passport is the control: it needs no condition, and asking for one it
 * does not need is not caution. A consent request a student cannot refuse
 * without losing something is the bundled consent this determination avoids by
 * naming contract for the activity as a whole.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import type { RetentionSchedule } from "@askimate/aas-domain";
import type { AppropriatePolicyRegister } from "@askimate/aas-disclosure";
import { b2Register } from "@askimate/aas-disclosure";

import type { DocumentUpload, SpecialCategoryConsent, StorableUpload } from "./vault.js";
import { SpecialCategoryConsentMissingError, assertStorable } from "./vault.js";

const NOW = new Date("2026-09-08T12:00:00Z");
const REGISTER = b2Register(NOW);

/** Covers both identity types, so the schedule is never the reason a test fails. */
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

/**
 * A register in which the Schedule 1 document EXISTS.
 *
 * ── Why these tests need a fixture the system does not have ───────────────
 *
 * ADR-0088 refuses `national_id` at the gate because the DPA 2018 Sch. 1
 * appropriate policy document is outstanding, and that refusal runs BEFORE this
 * one. With the real register every case below would fail on the policy
 * document and the Article 9 gate would be untested — present in the source,
 * asserted by nothing, which is the shape P37 spent a phase finding.
 *
 * So these run against the world as it will be the day the DPIA owner finishes:
 * the determination is registered and correct (ADR-0087), the policy document
 * is held, and what is left to check is the consent. The refusal that stands
 * TODAY is checked in `policy-document-gate.test.ts`, on the real register.
 */
const POLICY_DOCUMENT_HELD: AppropriatePolicyRegister = {
  national_id: {
    kind: "held",
    reference: "TEST-APD-001 (fixture — no such document exists)",
    confirmedBy: "test fixture",
    confirmedAt: new Date("2026-09-01T00:00:00Z"),
    reviewBy: new Date("2027-09-01T00:00:00Z"),
  },
};

const CONSENT: SpecialCategoryConsent = {
  givenAt: NOW,
  wording:
    "Your national ID card may show information such as religion or ethnicity. We need your " +
    "explicit permission to hold it. You can use your passport instead.",
  askedSeparately: true,
};

function upload(overrides: Partial<DocumentUpload> = {}): DocumentUpload {
  return {
    studentId: "stu_b2",
    documentType: "passport",
    purpose: "identity_verification",
    contentType: "application/pdf",
    sizeBytes: 1024,
    contentHash: "a".repeat(64),
    dates: { expiresAt: new Date("2030-01-01T00:00:00Z") },
    ...overrides,
  };
}

/** Every case here runs the real gate, with the policy document held. */
function store(item: DocumentUpload): StorableUpload {
  return assertStorable({
    schedule: SCHEDULE,
    register: REGISTER,
    policyDocuments: POLICY_DOCUMENT_HELD,
    upload: item,
    now: NOW,
  });
}

describe("the Article 9 gate at storage time", () => {
  it("stores a PASSPORT with no special-category consent at all", () => {
    // The control. A passport is inside the same determination and needs no
    // condition, so nothing extra is asked of it.
    const passed = store(upload());
    expect(passed.documentType).toBe("passport");
    expect(passed.policyReference).toBe("AAS-RET-passport");
  });

  it("REFUSES a national ID with no consent recorded", () => {
    expect(() => store(upload({ documentType: "national_id" }))).toThrow(
      SpecialCategoryConsentMissingError,
    );
  });

  it("stores a national ID when the consent was asked separately and recorded", () => {
    const passed = store(upload({ documentType: "national_id", specialCategoryConsent: CONSENT }));
    expect(passed.documentType).toBe("national_id");
  });

  it("REFUSES a consent that was bundled rather than asked on its own", () => {
    // "Asked separately at the point of upload" is the determination's own
    // wording. A consent folded into a general agreement is not freely given —
    // which is precisely why consent is not the Article 6 basis for the
    // activity — so a bundled one cannot rescue the Article 9 condition either.
    expect(() =>
      store({
        ...upload({ documentType: "national_id" }),
        specialCategoryConsent: { ...CONSENT, askedSeparately: false },
      }),
    ).toThrow(/not asked separately/);
  });

  it("REFUSES a consent that records no wording", () => {
    // ADR-0079's rule, in a second place: what the student agreed to IS the
    // record. "They consented" without the words is evidence of nothing.
    expect(() =>
      store({
        ...upload({ documentType: "national_id" }),
        specialCategoryConsent: { ...CONSENT, wording: "   " },
      }),
    ).toThrow(/records no wording/);
  });

  it("says what ADR-0077 does and does not cover, in the refusal", () => {
    // The confusion this gate exists to prevent, stated where somebody hitting
    // it will read it: unextractable fields are not the same as unheld bytes.
    try {
      store(upload({ documentType: "national_id" }));
      expect.unreachable("the national ID was stored without a condition");
    } catch (error) {
      expect(String(error)).toMatch(/whether or not anything reads it/);
      expect(String(error)).toMatch(/ADR-0077/);
    }
  });
});
