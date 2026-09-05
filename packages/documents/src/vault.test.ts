/**
 * Tests for the document vault.
 *
 * The load-bearing tests are the two storage gates: no document is stored
 * without a configured retention policy (ADR-0010) and none without a
 * determined lawful basis (ADR-0022). Neither implies the other, and until P32
 * only the first ran.
 *
 * Note where they are exercised. The gates live in `assertStorable`, whose
 * result is the ONLY thing `store` accepts, so a refusal is a throw from the
 * gate rather than a rejected promise from the vault. That is the change: an
 * implementation can no longer be trusted-to-check, because it can no longer
 * be called without the check having happened.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RetentionSchedule } from "@askimate/aas-domain";
import { RetentionPolicyMissingError } from "@askimate/aas-domain";
import type { LawfulBasisDeterminationRecord } from "@askimate/aas-disclosure";
import {
  LawfulBasisRegister,
  NoLawfulBasisError,
  determineLawfulBasis,
} from "@askimate/aas-disclosure";

import { InMemoryDocumentVault } from "./in-memory-vault.js";
import type { DocumentUpload, StorableUpload } from "./vault.js";
import {
  DocumentPurgedError,
  DocumentTypeNotCoveredError,
  assertStorable,
  hasContents,
  isReusable,
  storageActivityFor,
} from "./vault.js";

const NOW = new Date("2026-08-26T12:00:00Z");
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

/**
 * A deliberately PARTIAL schedule.
 *
 * Passports are configured. Bank statements are not configured at all, and
 * academic transcripts are recorded as UNRESOLVED — someone looked and could
 * not responsibly say. Both gaps are the point: they are what the refusal
 * tests exercise, and they refuse for different reasons.
 */
const SCHEDULE: RetentionSchedule = {
  version: "test-1",
  approvedAt: new Date("2026-08-01T00:00:00Z"),
  approvedBy: "data_protection_owner",
  effectiveFrom: new Date("2026-08-01T00:00:00Z"),
  policies: [
    {
      documentType: "passport",
      purpose: "identity_verification",
      trigger: "submission_confirmed",
      retainForDays: 90,
      action: "delete",
      erasureBehaviour: "full",
      policyReference: "AAS-RET-001",
      basis: {
        kind: "policy_decision",
        statement: "Test fixture. Not a determination and not a period anyone approved.",
        authoritativeSource: "AAS test fixture",
        verifiedBy: "test",
        verifiedAt: new Date("2026-08-01T00:00:00Z"),
      },
      reviewBy: new Date("2027-08-01T00:00:00Z"),
    },
  ],
  unresolved: [
    {
      documentType: "academic_transcript",
      purpose: "application_submission",
      question: "How long after a decision must a transcript be kept?",
      authoritativeSourceNeeded: "The university's own published records-retention requirement",
      expectedBasisKind: "operational_requirement",
      owner: "data_protection_owner",
      raisedBy: "test",
      raisedAt: new Date("2026-08-01T00:00:00Z"),
    },
  ],
};

function upload(overrides: Partial<DocumentUpload> = {}): DocumentUpload {
  return {
    studentId: "stu_001",
    documentType: "passport",
    purpose: "identity_verification",
    contentType: "application/pdf",
    sizeBytes: BYTES.length,
    contentHash: "sha256:abc",
    dates: { expiresAt: new Date("2030-01-01T00:00:00Z") },
    ...overrides,
  };
}

/**
 * A determination for one storing activity.
 *
 * Written out rather than shared with the disclosure tests, because the point
 * of the activity name is that a basis for holding is NOT a basis for sending
 * and a fixture reused across both would quietly say otherwise.
 */
function determination(
  overrides: Partial<LawfulBasisDeterminationRecord> = {},
): LawfulBasisDeterminationRecord {
  return {
    determinationId: "lb-store-identity",
    activity: {
      activity: storageActivityFor("identity_verification"),
      purpose: "Hold an identity document long enough to complete the application.",
      documentTypes: ["passport"],
    },
    article6: "contract",
    requiresStudentAuthorisation: false,
    determinedBy: "test-determiner",
    determinedAt: new Date("2026-08-01T00:00:00Z"),
    reasoning: "Test fixture. Not a determination anybody with the competence to make one made.",
    reviewBy: new Date("2027-08-01T00:00:00Z"),
    ...overrides,
  };
}

function registerWith(
  ...records: readonly LawfulBasisDeterminationRecord[]
): LawfulBasisRegister {
  const register = new LawfulBasisRegister();
  for (const record of records) {
    const check = determineLawfulBasis(record, NOW);
    if (!check.valid) throw new Error(`fixture determination invalid: ${check.refusal.kind}`);
    register.register(check.determination);
  }
  return register;
}

/** The register a passing test uses: identity storage, covering passports. */
const REGISTER = registerWith(determination());

/** An upload through both gates. Throws exactly as production would. */
function storable(overrides: Partial<DocumentUpload> = {}): StorableUpload {
  return assertStorable({
    schedule: SCHEDULE,
    register: REGISTER,
    upload: upload(overrides),
  });
}

describe("the retention gate at storage time", () => {
  it("stores a document that has a configured policy", async () => {
    const vault = new InMemoryDocumentVault();
    const record = await vault.store(storable(), BYTES, NOW);

    expect(record.documentId).toBeDefined();
    expect(record.retentionPolicyReference).toBe("AAS-RET-001");
    expect(record.state).toBe("uploaded");
  });

  it("REFUSES a document type with no configured policy", () => {
    // THE decision. "Kept forever because nobody configured it" is the
    // characteristic UK GDPR failure — silent, by omission.
    expect(() => storable({ documentType: "bank_statement", purpose: "financial_evidence" })).toThrow(
      RetentionPolicyMissingError,
    );
  });

  it("does not fall back to keeping indefinitely", () => {
    expect(() =>
      storable({ documentType: "birth_certificate", purpose: "minor_safeguarding" }),
    ).toThrow(/cannot be stored/);
  });

  it("stores nothing when it refuses", async () => {
    // A refusal must not leave a half-stored document behind — and now it
    // cannot, because the refusal happens before anything the vault could act
    // on exists.
    const vault = new InMemoryDocumentVault();
    expect(() => storable({ documentType: "bank_statement", purpose: "financial_evidence" })).toThrow();
    expect(await vault.listForStudent("stu_001")).toEqual([]);
  });

  it("refuses the same type held for an unconfigured purpose", () => {
    // A passport held for identity verification is a different retention
    // question from a passport held as audit evidence.
    expect(() => storable({ documentType: "passport", purpose: "audit_evidence" })).toThrow(
      RetentionPolicyMissingError,
    );
  });
});

describe("the lawful-basis gate at storage time", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // ADR-0022 says a determination must be registered for *"storing identity
  // documents, storing academic documents… and whatever a minor's route
  // adds"*, and that **"the system will refuse to act until they have"**.
  //
  // Until P32 that sentence was true of sending and FALSE of storing.
  // `InMemoryDocumentVault` was constructed with a `RetentionSchedule` and
  // nothing else, and `store()`'s only gate was the retention one — so with a
  // policy configured and no lawful basis anywhere in the process, a document
  // stored. Measured, in P31, before this group existed.
  // ═══════════════════════════════════════════════════════════════════════

  it("REFUSES when no determination is registered for the storing activity", () => {
    expect(() =>
      assertStorable({ schedule: SCHEDULE, register: new LawfulBasisRegister(), upload: upload() }),
    ).toThrow(NoLawfulBasisError);
  });

  it("names the activity nobody determined, so the gap is actionable", () => {
    expect(() =>
      assertStorable({ schedule: SCHEDULE, register: new LawfulBasisRegister(), upload: upload() }),
    ).toThrow(/store_document:identity_verification/);
  });

  it("REFUSES a basis determined for SENDING, which is a different decision", () => {
    // The mirror of `authoriseDisclosure`'s first check, whose own message is
    // "A basis for holding a document is not a basis for sending it." This is
    // that sentence read the other way round, and it is the reason the
    // activity name is part of the key rather than decoration.
    const sending = registerWith(
      determination({
        determinationId: "lb-disclose",
        activity: {
          activity: "disclose_document_to_institution",
          purpose: "Send the document to the university.",
          documentTypes: ["passport"],
        },
      }),
    );
    expect(() => assertStorable({ schedule: SCHEDULE, register: sending, upload: upload() })).toThrow(
      NoLawfulBasisError,
    );
  });

  it("REFUSES a determination made about a different kind of document", () => {
    // `ProcessingActivity.documentTypes` — "what is being done, and to what" —
    // has been declared since Phase 1 and read by NOTHING. This is the first
    // control that reads it. A determination is scoped to what it was made
    // about, and holding outside that scope relies on a decision nobody made.
    const narrow = registerWith(
      determination({
        activity: {
          activity: storageActivityFor("identity_verification"),
          purpose: "Hold an identity document.",
          documentTypes: ["national_id"],
        },
      }),
    );
    expect(() => assertStorable({ schedule: SCHEDULE, register: narrow, upload: upload() })).toThrow(
      DocumentTypeNotCoveredError,
    );
  });

  it("carries the determination it relied on, so the record can be audited", () => {
    const passed = storable();
    expect(passed.lawfulBasis.determinationId).toBe("lb-store-identity");
    expect(passed.policyReference).toBe("AAS-RET-001");
  });

  it("keeps the two gates INDEPENDENT — neither implies the other", () => {
    // A period somebody justified is not a basis for holding the data, and a
    // basis for holding it says nothing about for how long. Both are required
    // and each fails on its own.
    //
    // Retention configured, basis absent:
    expect(() =>
      assertStorable({ schedule: SCHEDULE, register: new LawfulBasisRegister(), upload: upload() }),
    ).toThrow(NoLawfulBasisError);

    // Basis present and covering the type, retention absent:
    const covering = registerWith(
      determination({
        determinationId: "lb-store-audit",
        activity: {
          activity: storageActivityFor("audit_evidence"),
          purpose: "Hold a document as audit evidence.",
          documentTypes: ["passport"],
        },
      }),
    );
    expect(() =>
      assertStorable({
        schedule: SCHEDULE,
        register: covering,
        upload: upload({ purpose: "audit_evidence" }),
      }),
    ).toThrow(RetentionPolicyMissingError);
  });

  it("is DETERMINISTIC — the same inputs refuse the same way every time", () => {
    // A gate that refused intermittently would be worse than one that did not
    // exist, because the passing run would be the one somebody kept.
    const empty = new LawfulBasisRegister();
    const once = (): unknown => {
      try {
        assertStorable({ schedule: SCHEDULE, register: empty, upload: upload() });
        return "stored";
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(once()).toBe(once());
    expect(once()).toBe(once());
  });

  it("puts NO document contents in the record it returns", async () => {
    // Brief §8: audit records reference document IDs, never contents. The
    // record is what everything downstream carries, so a byte that reached it
    // would reach a log, an error and a snapshot with it.
    const vault = new InMemoryDocumentVault();
    const record = await vault.store(storable(), BYTES, NOW);

    const serialised = JSON.stringify(record);
    expect(serialised).not.toContain(String.fromCharCode(...BYTES));
    expect(Object.keys(record)).not.toContain("contents");
    // And the branded upload the gate produced carries none either, though it
    // is the thing handed across the boundary.
    expect(Object.keys(storable())).not.toContain("contents");
  });

  it("cannot be bypassed by an implementation that forgets to call it", () => {
    // ═══════════════════════════════════════════════════════════════════
    // The structural half, and the reason the signature changed rather than a
    // line being added inside `InMemoryDocumentVault`.
    //
    // `store` takes a `StorableUpload`, which only `assertStorable` produces.
    // A second implementation — the S3 + KMS one that does not exist yet —
    // cannot store a document whose gates never ran, because it cannot be
    // handed one. ADR-0017's sentence, applied to documents: "was this
    // reviewed?" is answered by the function signature rather than by a check
    // someone has to remember to call.
    //
    // Asserted against the source because the property is a TYPE, and a type
    // that stopped being required would still compile everywhere it is
    // currently satisfied.
    // ═══════════════════════════════════════════════════════════════════
    const source = readFileSync(join(import.meta.dirname, "vault.ts"), "utf8");
    expect(source, "the port takes the branded value").toContain(
      "store(upload: StorableUpload, contents: Uint8Array, now: Date): Promise<DocumentRecord>;",
    );
    expect(source, "and only the gate can make one").toContain(
      "): StorableUpload {",
    );
    const implementation = readFileSync(join(import.meta.dirname, "in-memory-vault.ts"), "utf8");
    expect(
      implementation,
      "so the implementation holds no schedule and no register of its own",
    ).not.toContain("RetentionSchedule");
  });
});

describe("storing and reading", () => {
  it("returns the bytes it was given", async () => {
    const vault = new InMemoryDocumentVault();
    const record = await vault.store(storable(), BYTES, NOW);
    expect(await vault.retrieve(record.documentId)).toEqual(BYTES);
  });

  it("does not let a caller mutate stored contents through the returned array", async () => {
    const vault = new InMemoryDocumentVault();
    const record = await vault.store(storable(), BYTES, NOW);

    const first = await vault.retrieve(record.documentId);
    first[0] = 0x00;

    expect((await vault.retrieve(record.documentId))[0]).toBe(0x25);
  });

  it("records a content hash that survives everything", async () => {
    const vault = new InMemoryDocumentVault();
    const record = await vault.store(storable(), BYTES, NOW);
    expect(record.contentHash).toBe("sha256:abc");
  });

  it("returns null describing an unknown document", async () => {
    const vault = new InMemoryDocumentVault();
    expect(await vault.describe("doc_nope")).toBeNull();
  });
});

describe("erasure keeps the audit trail intact", () => {
  it("removes contents but keeps metadata and hash", async () => {
    // Brief §8: audit records reference document IDs, not contents. That is
    // what makes erasure workable — the case can still answer "which document
    // was used, and was it the one the student confirmed?" (ADR-0010).
    const vault = new InMemoryDocumentVault();
    const record = await vault.store(storable(), BYTES, NOW);

    const purged = await vault.purgeContents(record.documentId, NOW);

    expect(purged.state).toBe("purged");
    expect(purged.contentHash).toBe("sha256:abc");
    expect(purged.documentType).toBe("passport");
    expect(hasContents(purged)).toBe(false);
  });

  it("refuses to return contents once purged", async () => {
    const vault = new InMemoryDocumentVault();
    const record = await vault.store(storable(), BYTES, NOW);
    await vault.purgeContents(record.documentId, NOW);

    await expect(vault.retrieve(record.documentId)).rejects.toThrow(DocumentPurgedError);
  });

  it("still describes a purged document", async () => {
    const vault = new InMemoryDocumentVault();
    const record = await vault.store(storable(), BYTES, NOW);
    await vault.purgeContents(record.documentId, NOW);

    expect(await vault.describe(record.documentId)).not.toBeNull();
  });
});

describe("the retention clock", () => {
  it("does not start on upload", async () => {
    // It starts on the policy's trigger event, not when the file arrives.
    const vault = new InMemoryDocumentVault();
    const record = await vault.store(storable(), BYTES, NOW);
    expect(record.retentionTriggeredAt).toBeNull();
  });

  it("starts when triggered", async () => {
    const vault = new InMemoryDocumentVault();
    const record = await vault.store(storable(), BYTES, NOW);
    const triggered = await vault.startRetentionClock(record.documentId, NOW);
    expect(triggered.retentionTriggeredAt).toEqual(NOW);
  });

  it("is idempotent — re-triggering does not extend retention", async () => {
    // Otherwise a repeated event would quietly keep data longer each time.
    const vault = new InMemoryDocumentVault();
    const record = await vault.store(storable(), BYTES, NOW);
    await vault.startRetentionClock(record.documentId, NOW);

    const later = await vault.startRetentionClock(record.documentId, new Date("2027-01-01T00:00:00Z"));
    expect(later.retentionTriggeredAt).toEqual(NOW);
  });
});

describe("reuse eligibility", () => {
  it("allows reuse of a confirmed or verified document", async () => {
    const vault = new InMemoryDocumentVault();
    const record = await vault.store(storable(), BYTES, NOW);

    expect(isReusable(await vault.transition(record.documentId, "confirmed", NOW))).toBe(true);
    expect(isReusable(await vault.transition(record.documentId, "verified", NOW))).toBe(true);
  });

  it("does NOT allow reuse of an unconfirmed extraction", async () => {
    // Extract-then-confirm: what the machine read is not yet usable.
    const vault = new InMemoryDocumentVault();
    const record = await vault.store(storable(), BYTES, NOW);
    expect(isReusable(await vault.transition(record.documentId, "extracted", NOW))).toBe(false);
  });

  it("does not allow reuse of a superseded or purged document", async () => {
    const vault = new InMemoryDocumentVault();
    const record = await vault.store(storable(), BYTES, NOW);

    expect(isReusable(await vault.transition(record.documentId, "superseded", NOW))).toBe(false);
    expect(isReusable(await vault.purgeContents(record.documentId, NOW))).toBe(false);
  });
});
