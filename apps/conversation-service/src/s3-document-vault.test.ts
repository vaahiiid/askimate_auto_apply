/**
 * The S3 adapter, against the REAL SDK — offline.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Presigning is arithmetic over the request and a credential; it makes no
 * network call. So the SDK version this repository pins can be asked, here,
 * without a bucket: does `s3Presigner` produce a URL whose signature covers
 * the checksum header, and does the SDK's DEFAULT produce the hoisted one the
 * first run refuted the property under?
 *
 * That is the point of this file. `bound-upload.test.ts` proves the mint
 * refuses a hoisted URL from the in-memory bucket's presigner; this proves the
 * same refusal against the library that will actually mint them, so a future
 * SDK that changed the meaning of `unhoistableHeaders` fails HERE, in CI,
 * before it reaches a declaration.
 *
 * The confirm side stubs `client.send` — a HEAD's answer is data, and the four
 * answers that matter (nothing there, wrong checksum, wrong key, right) are
 * the ones the run observed.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { b2Register } from "@askimate/aas-disclosure";
import type { RetentionSchedule } from "@askimate/aas-domain";
import {
  CHECKSUM_HEADER,
  INTAKE_TTL_MS,
  IntakeRefusedError,
  REQUIRED_SIGNED_HEADERS,
  SSE_HEADER,
  SSE_KEY_HEADER,
  UnboundUploadError,
  assertBoundUploadUrl,
  assertStorable,
  checksumHeaderValue,
  openIntake,
} from "@askimate/aas-documents";

import { S3DocumentVault, s3Presigner } from "./s3-document-vault.js";

// The WALL clock, deliberately. The SDK stamps `X-Amz-Date` with the real time
// and the mint refuses a URL that would outlive its intake — so a fixture
// fixed at a date makes every URL "past the intake" the day after it was
// written. That is exactly what happened on 2026-09-10, to a test that had
// passed all the previous afternoon.
const NOW = new Date();
const BUCKET = "not-a-real-bucket-and-never-contacted";
const KMS = "arn:aws:kms:eu-west-2:000000000000:key/00000000-0000-0000-0000-000000000000";
const BYTES = Buffer.from("%PDF-1.7\nnot a real passport.\n");
const HASH = createHash("sha256").update(BYTES).digest("hex");

const SCHEDULE: RetentionSchedule = {
  version: "test-s3",
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
        statement: "Test fixture.",
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

/** A client that can SIGN and cannot SEND: fake static credentials, and no request ever leaves. */
function client(): S3Client {
  return new S3Client({
    region: "eu-west-2",
    credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "not-a-secret", sessionToken: "not-a-token" },
  });
}

function intake() {
  return openIntake({
    intakeId: "01JQS3TEST000000000000000A",
    conversationId: "conv_s3",
    upload: assertStorable({
      schedule: SCHEDULE,
      register: b2Register(NOW),
      upload: {
        studentId: "stu_s3",
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
    now: NOW,
  });
}

describe("the real SDK's presigner", () => {
  it("with unhoistableHeaders, signs the checksum and SSE headers — the bound URL", async () => {
    const url = await s3Presigner(client(), BUCKET)({
      key: "documents/stu_s3/x",
      checksumSha256: checksumHeaderValue(HASH),
      kmsKeyId: KMS,
      expiresInSeconds: 60,
      unhoistableHeaders: new Set(REQUIRED_SIGNED_HEADERS),
    });
    const parsed = new URL(url);
    const signed = (parsed.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
    expect(signed).toContain(CHECKSUM_HEADER);
    expect(signed).toContain(SSE_HEADER);
    expect(signed).toContain(SSE_KEY_HEADER);
    expect(parsed.searchParams.has(CHECKSUM_HEADER)).toBe(false);
    expect(parsed.hostname).toContain(BUCKET);
    // And so the mint accepts it.
    expect(() =>
      assertBoundUploadUrl(url, { notAfter: new Date(NOW.getTime() + INTAKE_TTL_MS), now: NOW }),
    ).not.toThrow();
  });

  it("by DEFAULT hoists the checksum into the query string — and the mint REFUSES that URL", async () => {
    // ── The finding of 2026-09-09, reproduced against the library ────────
    //
    // This is exactly what the first run minted: the SDK's default, no
    // `unhoistableHeaders`. The checksum lands in the query string, only
    // `host` is signed, and S3 never reads it. Under this URL a bound upload
    // is an unbound one. `assertBoundUploadUrl` is the reason it cannot leave
    // this process.
    const hoisted = await getSignedUrl(
      client(),
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: "documents/stu_s3/x",
        ChecksumSHA256: checksumHeaderValue(HASH),
        ChecksumAlgorithm: "SHA256",
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: KMS,
      }),
      { expiresIn: 60 },
    );
    const parsed = new URL(hoisted);
    expect(parsed.searchParams.has(CHECKSUM_HEADER), "the SDK hoisted it").toBe(true);
    expect(() =>
      assertBoundUploadUrl(hoisted, { notAfter: new Date(NOW.getTime() + INTAKE_TTL_MS), now: NOW }),
    ).toThrow(UnboundUploadError);
  });
});

describe("the vault", () => {
  it("prepares an upload the browser is told exactly how to make", async () => {
    const vault = new S3DocumentVault({ client: client(), bucket: BUCKET, kmsKeyId: KMS });
    const prepared = await vault.prepareUpload(intake(), NOW);
    expect(prepared.method).toBe("PUT");
    expect(prepared.headers[CHECKSUM_HEADER]).toBe(checksumHeaderValue(HASH));
    expect(prepared.headers[SSE_KEY_HEADER]).toBe(KMS);
    expect(new URL(prepared.url).pathname).toBe("/documents/stu_s3/01JQS3TEST000000000000000A");
  });

  /** A client whose HEAD answers with the given data, or a 404. */
  function heading(answer: Record<string, unknown> | "missing"): S3Client {
    const c = client();
    (c as unknown as { send: (command: unknown) => Promise<unknown> }).send = () =>
      answer === "missing"
        ? Promise.reject(Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }))
        : Promise.resolve(answer);
    return c;
  }

  it("confirms only what the bucket says it holds, exactly as declared", async () => {
    const vault = new S3DocumentVault({
      client: heading({
        ChecksumSHA256: checksumHeaderValue(HASH),
        ContentLength: BYTES.byteLength,
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: KMS,
      }),
      bucket: BUCKET,
      kmsKeyId: KMS,
    });
    const record = await vault.confirmUpload(intake(), NOW);
    expect(record.contentHash).toBe(HASH);
    expect(record.state).toBe("uploaded");
    expect(await vault.describe(record.documentId)).not.toBeNull();
  });

  it("REFUSES to record when the bucket holds nothing (upload_not_received)", async () => {
    const vault = new S3DocumentVault({ client: heading("missing"), bucket: BUCKET, kmsKeyId: KMS });
    await expect(vault.confirmUpload(intake(), NOW)).rejects.toThrow(IntakeRefusedError);
    await expect(vault.confirmUpload(intake(), NOW)).rejects.toMatchObject({ code: "upload_not_received" });
    expect(await vault.listForStudent("stu_s3")).toEqual([]);
  });

  it("REFUSES to record a different checksum (content_hash_mismatch)", async () => {
    const vault = new S3DocumentVault({
      client: heading({
        ChecksumSHA256: checksumHeaderValue("0".repeat(64)),
        ContentLength: BYTES.byteLength,
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: KMS,
      }),
      bucket: BUCKET,
      kmsKeyId: KMS,
    });
    await expect(vault.confirmUpload(intake(), NOW)).rejects.toMatchObject({ code: "content_hash_mismatch" });
  });

  it("REFUSES to record an object not under the customer-managed key", async () => {
    const vault = new S3DocumentVault({
      client: heading({
        ChecksumSHA256: checksumHeaderValue(HASH),
        ContentLength: BYTES.byteLength,
        ServerSideEncryption: "AES256",
      }),
      bucket: BUCKET,
      kmsKeyId: KMS,
    });
    await expect(vault.confirmUpload(intake(), NOW)).rejects.toThrow(/customer-managed key/);
    expect(await vault.listForStudent("stu_s3")).toEqual([]);
  });

  it("re-throws anything that is not a 404 from HEAD, rather than reading it as absence", async () => {
    // A 403 from a misconfigured credential must not become "nothing there,
    // declare again" — that would send the student round a loop the bucket
    // is the cause of.
    const c = client();
    (c as unknown as { send: () => Promise<never> }).send = () =>
      Promise.reject(Object.assign(new Error("Forbidden"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }));
    const vault = new S3DocumentVault({ client: c, bucket: BUCKET, kmsKeyId: KMS });
    await expect(vault.confirmUpload(intake(), NOW)).rejects.toThrow(/Forbidden/);
  });

  it("mints a short-lived GET for retrieval, and none once purged", async () => {
    const sends: unknown[] = [];
    const c = heading({
      ChecksumSHA256: checksumHeaderValue(HASH),
      ContentLength: BYTES.byteLength,
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: KMS,
    });
    const original = (c as unknown as { send: (command: unknown) => Promise<unknown> }).send;
    (c as unknown as { send: (command: unknown) => Promise<unknown> }).send = (command) => {
      sends.push(command);
      return original(command);
    };
    const vault = new S3DocumentVault({ client: c, bucket: BUCKET, kmsKeyId: KMS });
    const record = await vault.confirmUpload(intake(), NOW);

    const retrieval = await vault.prepareRetrieval(record.documentId, NOW);
    expect(retrieval.method).toBe("GET");
    expect(new URL(retrieval.url).searchParams.get("X-Amz-Expires")).toBe("60");

    await vault.purgeContents(record.documentId, NOW);
    expect(sends.some((s) => s instanceof Object && s.constructor.name === "DeleteObjectCommand")).toBe(true);
    await expect(vault.prepareRetrieval(record.documentId, NOW)).rejects.toThrow(/removed/);
  });
});
