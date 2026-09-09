/**
 * The intake, checked on its own — the gates ran, and the bytes are the ones.
 *
 * The route-level proof is in `apps/conversation-service/src/document-routes.test.ts`,
 * over a real HTTP server. These are the unit properties underneath it, and
 * the ones that would still hold if the transport moved to a different service.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { RetentionSchedule } from "@askimate/aas-domain";
import { b2Register } from "@askimate/aas-disclosure";

import { assertStorable } from "./vault.js";
import type { DocumentUpload, StorableUpload } from "./vault.js";
import {
  DOCUMENT_LIMITS,
  INTAKE_TTL_MS,
  IntakeRefusedError,
  limitFor,
  openIntake,
} from "./intake.js";

const NOW = new Date("2026-09-08T12:00:00Z");
const REGISTER = b2Register(NOW);
const BYTES = new Uint8Array(Buffer.from("%PDF-1.7\na passport scan that is not a real one.\n"));
const HASH = createHash("sha256").update(BYTES).digest("hex");

const SCHEDULE: RetentionSchedule = {
  version: "test-intake",
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
      policyReference: "AAS-RET-B1-01",
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
    studentId: "stu_intake",
    documentType: "passport",
    purpose: "identity_verification",
    contentType: "application/pdf",
    sizeBytes: BYTES.byteLength,
    contentHash: HASH,
    dates: {},
    ...overrides,
  };
}

function storable(overrides: Partial<DocumentUpload> = {}): StorableUpload {
  return assertStorable({ schedule: SCHEDULE, register: REGISTER, upload: upload(overrides) });
}

function intake(overrides: { readonly declaredSizeBytes?: number; readonly contentType?: string } = {}) {
  return openIntake({
    intakeId: "01JQTEST0000000000000000AA",
    conversationId: "conv_intake",
    upload: storable(),
    contentType: overrides.contentType ?? "application/pdf",
    declaredSizeBytes: overrides.declaredSizeBytes ?? BYTES.byteLength,
    now: NOW,
  });
}

describe("the limits table", () => {
  it("covers every document type", () => {
    // `as const satisfies Record<DocumentType, …>` makes this true at compile
    // time; asserted here as CONTENT, because a table that satisfied the type
    // with a nonsense ceiling would compile and be useless.
    for (const [type, limit] of Object.entries(DOCUMENT_LIMITS)) {
      expect(limit.maxBytes, type).toBeGreaterThan(0);
      expect(limit.contentTypes.length, type).toBeGreaterThan(0);
    }
  });

  it("does NOT give every type the same ceiling", () => {
    // The reason the table exists rather than one number. A personal statement
    // is text; a transcript is a scan of several pages. One ceiling for both
    // means accepting a 20 MB "personal statement" nobody decided to accept.
    const ceilings = new Set(Object.values(DOCUMENT_LIMITS).map((l) => l.maxBytes));
    expect(ceilings.size).toBeGreaterThan(1);
    expect(limitFor("personal_statement").maxBytes).toBeLessThan(
      limitFor("academic_transcript").maxBytes,
    );
  });
});

describe("opening an intake", () => {
  it("can only be reached with an upload the gates passed", () => {
    // The signature IS the control: `openIntake` takes `StorableUpload`, which
    // only `assertStorable` can mint (ADR-0068). There is no way to get an
    // intake for a document whose retention policy and lawful basis were never
    // established — not a check to remember, a type.
    const opened = intake();
    expect(opened.upload.policyReference).toBe("AAS-RET-B1-01");
    expect(opened.upload.lawfulBasis).toBeDefined();
  });

  it("carries the declared hash from the upload that passed the gates", () => {
    // Not re-supplied alongside. If the intake could name a different hash
    // from the one the gates saw, the binding would be decorative.
    expect(intake().declaredHash).toBe(HASH);
  });

  it("expires, and says when", () => {
    const opened = intake();
    expect(opened.expiresAt.getTime() - opened.openedAt.getTime()).toBe(INTAKE_TTL_MS);
  });

  it("REFUSES a content type the document may not arrive as", () => {
    expect(() => intake({ contentType: "application/zip" })).toThrow(IntakeRefusedError);
    try {
      intake({ contentType: "application/zip" });
    } catch (error) {
      expect((error as IntakeRefusedError).code).toBe("unsupported_media_type");
      expect(String(error)).toMatch(/before any body is read/);
    }
  });

  it("REFUSES a declared size over the ceiling, and says it was refused early", () => {
    try {
      intake({ declaredSizeBytes: 40 * 1024 * 1024 });
      expect.unreachable("an oversized declaration was accepted");
    } catch (error) {
      expect((error as IntakeRefusedError).code).toBe("payload_too_large");
      expect(String(error)).toMatch(/not asked to wait/);
    }
  });

  it("REFUSES a size that is zero, negative or not an integer", () => {
    for (const declaredSizeBytes of [0, -1, 1.5, Number.NaN]) {
      expect(() => intake({ declaredSizeBytes }), String(declaredSizeBytes)).toThrow(
        IntakeRefusedError,
      );
    }
  });
});

// `acceptBytes` and its group of tests are gone with it (ADR-0092, ADR-0093):
// the bytes no longer pass through a process this repository runs. What the
// bytes must match, and what refuses them when they do not, is now the bound
// upload URL — see `bound-upload.test.ts` — and the bucket the run verified.
