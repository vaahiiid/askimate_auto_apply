/**
 * Tests for the document vault.
 *
 * The load-bearing test is the retention gate: no document is stored without a
 * configured policy, and absence of policy is never permission to keep
 * (ADR-0010).
 */

import { describe, expect, it } from "vitest";

import type { RetentionSchedule } from "@askimate/aas-domain";
import { RetentionPolicyMissingError } from "@askimate/aas-domain";

import { InMemoryDocumentVault } from "./in-memory-vault.js";
import type { DocumentUpload } from "./vault.js";
import { DocumentPurgedError, hasContents, isReusable } from "./vault.js";

const NOW = new Date("2026-08-26T12:00:00Z");
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

/**
 * A deliberately PARTIAL schedule: passports are configured, bank statements
 * are not. The gap is the point — it is what the refusal tests exercise.
 */
const SCHEDULE: RetentionSchedule = {
  version: "test-1",
  approvedAt: new Date("2026-08-01T00:00:00Z"),
  approvedBy: "data_protection_owner",
  policies: [
    {
      documentType: "passport",
      purpose: "identity_verification",
      trigger: "submission_confirmed",
      retainForDays: 90,
      action: "delete",
      erasureBehaviour: "full",
      policyReference: "AAS-RET-001",
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

describe("the retention gate at storage time", () => {
  it("stores a document that has a configured policy", async () => {
    const vault = new InMemoryDocumentVault(SCHEDULE);
    const record = await vault.store(upload(), BYTES, NOW);

    expect(record.documentId).toBeDefined();
    expect(record.retentionPolicyReference).toBe("AAS-RET-001");
    expect(record.state).toBe("uploaded");
  });

  it("REFUSES to store a document type with no configured policy", async () => {
    // THE decision. "Kept forever because nobody configured it" is the
    // characteristic UK GDPR failure — silent, by omission.
    const vault = new InMemoryDocumentVault(SCHEDULE);
    await expect(
      vault.store(upload({ documentType: "bank_statement", purpose: "financial_evidence" }), BYTES, NOW),
    ).rejects.toThrow(RetentionPolicyMissingError);
  });

  it("does not fall back to keeping indefinitely", async () => {
    const vault = new InMemoryDocumentVault(SCHEDULE);
    await expect(
      vault.store(upload({ documentType: "birth_certificate", purpose: "minor_safeguarding" }), BYTES, NOW),
    ).rejects.toThrow(/cannot be stored/);
  });

  it("stores nothing when it refuses", async () => {
    // A refusal must not leave a half-stored document behind.
    const vault = new InMemoryDocumentVault(SCHEDULE);
    await expect(
      vault.store(upload({ documentType: "bank_statement", purpose: "financial_evidence" }), BYTES, NOW),
    ).rejects.toThrow();
    expect(await vault.listForStudent("stu_001")).toEqual([]);
  });

  it("refuses the same type held for an unconfigured purpose", async () => {
    // A passport held for identity verification is a different retention
    // question from a passport held as audit evidence.
    const vault = new InMemoryDocumentVault(SCHEDULE);
    await expect(
      vault.store(upload({ documentType: "passport", purpose: "audit_evidence" }), BYTES, NOW),
    ).rejects.toThrow(RetentionPolicyMissingError);
  });
});

describe("storing and reading", () => {
  it("returns the bytes it was given", async () => {
    const vault = new InMemoryDocumentVault(SCHEDULE);
    const record = await vault.store(upload(), BYTES, NOW);
    expect(await vault.retrieve(record.documentId)).toEqual(BYTES);
  });

  it("does not let a caller mutate stored contents through the returned array", async () => {
    const vault = new InMemoryDocumentVault(SCHEDULE);
    const record = await vault.store(upload(), BYTES, NOW);

    const first = await vault.retrieve(record.documentId);
    first[0] = 0x00;

    expect((await vault.retrieve(record.documentId))[0]).toBe(0x25);
  });

  it("records a content hash that survives everything", async () => {
    const vault = new InMemoryDocumentVault(SCHEDULE);
    const record = await vault.store(upload(), BYTES, NOW);
    expect(record.contentHash).toBe("sha256:abc");
  });

  it("returns null describing an unknown document", async () => {
    const vault = new InMemoryDocumentVault(SCHEDULE);
    expect(await vault.describe("doc_nope")).toBeNull();
  });
});

describe("erasure keeps the audit trail intact", () => {
  it("removes contents but keeps metadata and hash", async () => {
    // Brief §8: audit records reference document IDs, not contents. That is
    // what makes erasure workable — the case can still answer "which document
    // was used, and was it the one the student confirmed?" (ADR-0010).
    const vault = new InMemoryDocumentVault(SCHEDULE);
    const record = await vault.store(upload(), BYTES, NOW);

    const purged = await vault.purgeContents(record.documentId, NOW);

    expect(purged.state).toBe("purged");
    expect(purged.contentHash).toBe("sha256:abc");
    expect(purged.documentType).toBe("passport");
    expect(hasContents(purged)).toBe(false);
  });

  it("refuses to return contents once purged", async () => {
    const vault = new InMemoryDocumentVault(SCHEDULE);
    const record = await vault.store(upload(), BYTES, NOW);
    await vault.purgeContents(record.documentId, NOW);

    await expect(vault.retrieve(record.documentId)).rejects.toThrow(DocumentPurgedError);
  });

  it("still describes a purged document", async () => {
    const vault = new InMemoryDocumentVault(SCHEDULE);
    const record = await vault.store(upload(), BYTES, NOW);
    await vault.purgeContents(record.documentId, NOW);

    expect(await vault.describe(record.documentId)).not.toBeNull();
  });
});

describe("the retention clock", () => {
  it("does not start on upload", async () => {
    // It starts on the policy's trigger event, not when the file arrives.
    const vault = new InMemoryDocumentVault(SCHEDULE);
    const record = await vault.store(upload(), BYTES, NOW);
    expect(record.retentionTriggeredAt).toBeNull();
  });

  it("starts when triggered", async () => {
    const vault = new InMemoryDocumentVault(SCHEDULE);
    const record = await vault.store(upload(), BYTES, NOW);
    const triggered = await vault.startRetentionClock(record.documentId, NOW);
    expect(triggered.retentionTriggeredAt).toEqual(NOW);
  });

  it("is idempotent — re-triggering does not extend retention", async () => {
    // Otherwise a repeated event would quietly keep data longer each time.
    const vault = new InMemoryDocumentVault(SCHEDULE);
    const record = await vault.store(upload(), BYTES, NOW);
    await vault.startRetentionClock(record.documentId, NOW);

    const later = await vault.startRetentionClock(record.documentId, new Date("2027-01-01T00:00:00Z"));
    expect(later.retentionTriggeredAt).toEqual(NOW);
  });
});

describe("reuse eligibility", () => {
  it("allows reuse of a confirmed or verified document", async () => {
    const vault = new InMemoryDocumentVault(SCHEDULE);
    const record = await vault.store(upload(), BYTES, NOW);

    expect(isReusable(await vault.transition(record.documentId, "confirmed", NOW))).toBe(true);
    expect(isReusable(await vault.transition(record.documentId, "verified", NOW))).toBe(true);
  });

  it("does NOT allow reuse of an unconfirmed extraction", async () => {
    // Extract-then-confirm: what the machine read is not yet usable.
    const vault = new InMemoryDocumentVault(SCHEDULE);
    const record = await vault.store(upload(), BYTES, NOW);
    expect(isReusable(await vault.transition(record.documentId, "extracted", NOW))).toBe(false);
  });

  it("does not allow reuse of a superseded or purged document", async () => {
    const vault = new InMemoryDocumentVault(SCHEDULE);
    const record = await vault.store(upload(), BYTES, NOW);

    expect(isReusable(await vault.transition(record.documentId, "superseded", NOW))).toBe(false);
    expect(isReusable(await vault.purgeContents(record.documentId, NOW))).toBe(false);
  });
});
