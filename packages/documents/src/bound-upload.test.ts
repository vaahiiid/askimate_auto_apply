/**
 * An upload URL cannot be minted unbound.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0093. The run of 2026-09-09 found the property holds only when the
 * checksum is a signed header the uploader sends; the SDK's default hoists it
 * into the query string, where S3 never reads it, and under that default a
 * bound URL is an unbound one. Vahid: *"Make that structural in the minting
 * code, not a note in the ADR."*
 *
 * These are the structural tests. `mintBoundUpload` is the only producer of
 * `BoundUploadUrl`, and what is checked is that it REFUSES the hoisted URL,
 * refuses a signature that does not cover a required header, refuses a URL
 * that outlives its intake — and that the presigner is told exactly what to
 * sign, from the intake, not from the caller.
 *
 * The adapter test in the Conversation Service feeds `assertBoundUploadUrl`
 * URLs the REAL SDK minted, with and without `unhoistableHeaders`. Here the
 * presigner is the in-memory bucket's, which reproduces both shapes.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { RetentionSchedule } from "@askimate/aas-domain";
import { b2Register } from "@askimate/aas-disclosure";

import type { PresignRequest } from "./bound-upload.js";
import {
  CHECKSUM_HEADER,
  REQUIRED_SIGNED_HEADERS,
  SSE_HEADER,
  SSE_KEY_HEADER,
  UnboundUploadError,
  UnencryptedObjectError,
  assertBoundUploadUrl,
  checksumHeaderValue,
  mintBoundUpload,
  objectKeyFor,
  receiveUpload,
} from "./bound-upload.js";
import { InMemoryObjectStore } from "./in-memory-vault.js";
import { INTAKE_TTL_MS, IntakeRefusedError, openIntake } from "./intake.js";
import { assertStorable } from "./vault.js";

const NOW = new Date("2026-09-09T14:00:00Z");
const KMS = "arn:aws:kms:eu-west-2:000000000000:key/test";
const BYTES = new Uint8Array(Buffer.from("%PDF-1.7\na passport scan that is not a real one.\n"));
const HASH = createHash("sha256").update(BYTES).digest("hex");

const SCHEDULE: RetentionSchedule = {
  version: "test-bound-upload",
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

function intake(now = NOW) {
  return openIntake({
    intakeId: "01JQTEST0000000000000000AA",
    conversationId: "conv_bound",
    upload: assertStorable({
      schedule: SCHEDULE,
      register: b2Register(now),
      upload: {
        studentId: "stu_bound",
        documentType: "passport",
        purpose: "identity_verification",
        contentType: "application/pdf",
        sizeBytes: BYTES.byteLength,
        contentHash: HASH,
        dates: {},
      },
    }),
    contentType: "application/pdf",
    declaredSizeBytes: BYTES.byteLength,
    now,
  });
}

describe("the checksum header value", () => {
  it("is base64 of the digest BYTES, not of the hex", () => {
    // S3 compares against base64 of the 32 raw bytes. Base64 of the 64 hex
    // characters is a different, longer string, and would be a BadDigest on
    // every upload — the wrong encoding is the easiest way to make the binding
    // refuse everything and look like it is working.
    const value = checksumHeaderValue(HASH);
    expect(Buffer.from(value, "base64")).toHaveLength(32);
    expect(Buffer.from(value, "base64").toString("hex")).toBe(HASH);
  });

  it("refuses anything that is not a SHA-256", () => {
    expect(() => checksumHeaderValue("abc")).toThrow(/64 lowercase hex/);
  });
});

describe("minting a bound upload", () => {
  it("tells the presigner exactly what to sign, from the intake, and states the headers", async () => {
    const seen: PresignRequest[] = [];
    const store = new InMemoryObjectStore();
    const prepared = await mintBoundUpload({
      intake: intake(),
      kmsKeyId: KMS,
      now: NOW,
      presign: (request) => {
        seen.push(request);
        return store.presign(NOW)(request);
      },
    });

    // The checksum came from the intake, not from any caller.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.checksumSha256).toBe(checksumHeaderValue(HASH));
    expect(seen[0]?.kmsKeyId).toBe(KMS);
    expect([...(seen[0]?.unhoistableHeaders ?? [])].sort()).toEqual([...REQUIRED_SIGNED_HEADERS].sort());
    expect(seen[0]?.key).toBe(objectKeyFor(intake()));

    // And the browser is told what to send — the URL is refused without it.
    expect(prepared.method).toBe("PUT");
    expect(prepared.headers[CHECKSUM_HEADER]).toBe(checksumHeaderValue(HASH));
    expect(prepared.headers[SSE_HEADER]).toBe("aws:kms");
    expect(prepared.headers[SSE_KEY_HEADER]).toBe(KMS);
    expect(prepared.expiresAt.getTime()).toBeLessThanOrEqual(intake().expiresAt.getTime());
  });

  it("REFUSES the SDK's default — the checksum hoisted into the query string", async () => {
    // ── The structural half of ADR-0093 ─────────────────────────────────
    //
    // This is the URL the first run refuted the property under. A minting
    // function that returned it would hand a browser a URL S3 accepts any
    // body on, with a checksum in a place S3 never reads. It throws instead,
    // and nothing is returned.
    const store = new InMemoryObjectStore();
    await expect(
      mintBoundUpload({ intake: intake(), kmsKeyId: KMS, now: NOW, presign: store.presignHoisted(NOW) }),
    ).rejects.toThrow(UnboundUploadError);
    await expect(
      mintBoundUpload({ intake: intake(), kmsKeyId: KMS, now: NOW, presign: store.presignHoisted(NOW) }),
    ).rejects.toThrow(/HOISTED/);
  });

  it("REFUSES a signature that does not cover every required header", () => {
    const base = "https://b.in-memory.invalid/k?X-Amz-Expires=60&X-Amz-Date=20260909T140000Z";
    const bounds = { notAfter: new Date(NOW.getTime() + INTAKE_TTL_MS), now: NOW };
    expect(() => assertBoundUploadUrl(`${base}&X-Amz-SignedHeaders=host`, bounds)).toThrow(
      /does not cover x-amz-checksum-sha256/,
    );
    expect(() =>
      assertBoundUploadUrl(`${base}&X-Amz-SignedHeaders=host;x-amz-checksum-sha256`, bounds),
    ).toThrow(/does not cover x-amz-server-side-encryption/);
    expect(() =>
      assertBoundUploadUrl(
        `${base}&X-Amz-SignedHeaders=host;${REQUIRED_SIGNED_HEADERS.join(";")}`,
        bounds,
      ),
    ).not.toThrow();
  });

  it("REFUSES a URL that would outlive the intake it was minted for", () => {
    const signed = REQUIRED_SIGNED_HEADERS.join(";");
    const soon = new Date(NOW.getTime() + 60_000);
    expect(() =>
      assertBoundUploadUrl(
        `https://b.in-memory.invalid/k?X-Amz-Expires=900&X-Amz-Date=20260909T140000Z&X-Amz-SignedHeaders=host;${signed}`,
        { notAfter: soon, now: NOW },
      ),
    ).toThrow(/past the intake/);
  });

  it("REFUSES a URL with no expiry, a non-https URL, and a non-URL", () => {
    const signed = REQUIRED_SIGNED_HEADERS.join(";");
    const bounds = { notAfter: new Date(NOW.getTime() + INTAKE_TTL_MS), now: NOW };
    expect(() =>
      assertBoundUploadUrl(`https://b.in-memory.invalid/k?X-Amz-SignedHeaders=host;${signed}`, bounds),
    ).toThrow(/X-Amz-Expires/);
    expect(() =>
      assertBoundUploadUrl(`http://b.in-memory.invalid/k?X-Amz-Expires=60&X-Amz-SignedHeaders=host;${signed}`, bounds),
    ).toThrow(/not https/);
    expect(() => assertBoundUploadUrl("not a url", bounds)).toThrow(/not a URL/);
  });

  it("REFUSES to mint for an intake that is no longer open", async () => {
    const opened = intake();
    const store = new InMemoryObjectStore();
    await expect(
      mintBoundUpload({ intake: opened, kmsKeyId: KMS, now: opened.expiresAt, presign: store.presign(opened.expiresAt) }),
    ).rejects.toThrow(IntakeRefusedError);
  });

  it("REFUSES to mint with no customer-managed key configured", async () => {
    const store = new InMemoryObjectStore();
    await expect(
      mintBoundUpload({ intake: intake(), kmsKeyId: " ", now: NOW, presign: store.presign(NOW) }),
    ).rejects.toThrow(/ADR-0010/);
  });
});

describe("the in-memory bucket enforces what the run observed", () => {
  async function prepared(store: InMemoryObjectStore) {
    return mintBoundUpload({ intake: intake(), kmsKeyId: KMS, now: NOW, presign: store.presign(NOW) });
  }

  it("E1 — accepts the declared bytes with the stated headers", async () => {
    const store = new InMemoryObjectStore();
    const upload = await prepared(store);
    expect(store.put(upload.url, upload.headers, BYTES, NOW)).toEqual({ status: 200, code: null });
    expect(store.head(objectKeyFor(intake()))?.checksumSha256).toBe(checksumHeaderValue(HASH));
  });

  it("E2 — refuses a same-length substitution as BadDigest", async () => {
    const store = new InMemoryObjectStore();
    const upload = await prepared(store);
    const swapped = new Uint8Array(BYTES);
    swapped[swapped.length - 2] = swapped[swapped.length - 2] === 0x41 ? 0x42 : 0x41;
    expect(store.put(upload.url, upload.headers, swapped, NOW)).toEqual({ status: 400, code: "BadDigest" });
    expect(store.head(objectKeyFor(intake()))).toBeNull();
  });

  it("E6 — refuses the header omitted as SignatureDoesNotMatch", async () => {
    const store = new InMemoryObjectStore();
    const upload = await prepared(store);
    const { [CHECKSUM_HEADER]: _dropped, ...without } = upload.headers;
    expect(store.put(upload.url, without, BYTES, NOW)).toEqual({ status: 403, code: "SignatureDoesNotMatch" });
  });

  it("E7 — refuses the header altered to match a substituted body", async () => {
    const store = new InMemoryObjectStore();
    const upload = await prepared(store);
    const other = new Uint8Array(Buffer.from("%PDF-1.7\nsomething else, of whatever length.\n"));
    const altered = { ...upload.headers, [CHECKSUM_HEADER]: createHash("sha256").update(other).digest("base64") };
    expect(store.put(upload.url, altered, other, NOW)).toEqual({ status: 403, code: "SignatureDoesNotMatch" });
  });

  it("refuses an expired URL and a forged signature", async () => {
    const store = new InMemoryObjectStore();
    const upload = await prepared(store);
    const late = new Date(intake().expiresAt.getTime() + 1);
    expect(store.put(upload.url, upload.headers, BYTES, late).status).toBe(403);
    const forged = upload.url.replace(/X-Amz-Signature=[0-9a-f]+/, "X-Amz-Signature=0000");
    expect(store.put(forged, upload.headers, BYTES, NOW)).toEqual({ status: 403, code: "SignatureDoesNotMatch" });
  });
});

describe("receiving the upload — the read-back", () => {
  const good = {
    checksumSha256: checksumHeaderValue(HASH),
    contentLength: BYTES.byteLength,
    serverSideEncryption: "aws:kms",
    kmsKeyId: KMS,
  };

  it("accepts what matches the declaration exactly", () => {
    const received = receiveUpload({ intake: intake(), kmsKeyId: KMS, receipt: good });
    expect(received.key).toBe(objectKeyFor(intake()));
  });

  it("REFUSES nothing there as upload_not_received, and says to declare again", () => {
    try {
      receiveUpload({ intake: intake(), kmsKeyId: KMS, receipt: null });
      expect.unreachable("an absent object was received");
    } catch (error) {
      expect((error as IntakeRefusedError).code).toBe("upload_not_received");
      expect(String(error)).toMatch(/Declare the document again/);
    }
  });

  it("REFUSES a different checksum or length as content_hash_mismatch", () => {
    for (const receipt of [
      { ...good, checksumSha256: checksumHeaderValue("0".repeat(64)) },
      { ...good, checksumSha256: null },
      { ...good, contentLength: BYTES.byteLength + 1 },
    ]) {
      try {
        receiveUpload({ intake: intake(), kmsKeyId: KMS, receipt });
        expect.unreachable("a mismatch was received");
      } catch (error) {
        expect((error as IntakeRefusedError).code).toBe("content_hash_mismatch");
      }
    }
  });

  it("REFUSES an object not encrypted under the configured key, as a configuration fault", () => {
    expect(() =>
      receiveUpload({ intake: intake(), kmsKeyId: KMS, receipt: { ...good, serverSideEncryption: "AES256", kmsKeyId: null } }),
    ).toThrow(UnencryptedObjectError);
    expect(() =>
      receiveUpload({ intake: intake(), kmsKeyId: KMS, receipt: { ...good, kmsKeyId: "arn:aws:kms:eu-west-2:000000000000:key/other" } }),
    ).toThrow(/not the student's/);
  });
});
