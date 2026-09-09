/**
 * The document vault over S3 + KMS: the bucket ADR-0092 decided on, minted
 * from the process ADR-0092 says mints it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * *"The conversation service runs the gates, then mints a pre-signed upload
 * rather than accepting bytes, and the document never enters any process we
 * run."* — Vahid, ADR-0092. This is the minting.
 *
 * What this class does NOT do is decide anything about the URL. It hands the
 * SDK's presigner to `mintBoundUpload`, which computes the checksum from the
 * intake, names the headers that must not be hoisted, and reads the result
 * back before it will return a `BoundUploadUrl` (ADR-0093). If a future SDK
 * version changed what `unhoistableHeaders` means, the mint throws and the
 * declaration fails — a browser is never handed an unbound URL. The test
 * beside this file feeds `assertBoundUploadUrl` URLs the REAL SDK produces
 * both ways, so the refusal is proven against the library, not a string.
 *
 * ── What is in memory here, and why that is not yet the vault ─────────────
 *
 * Document METADATA — `DocumentRecord`s and the object key each one lives
 * under — is held in a Map. That is the next phase: a durable metadata store
 * in the conversation plane's database, and the production wiring that goes
 * with it. Until then `assertDocumentStoreIsDurable` keeps refusing a
 * production start, exactly as it did before this class existed. The bytes,
 * though, are already where D puts them: in the bucket, under the CMK, and in
 * no process this repository runs.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type {
  DocumentId,
  DocumentIntake,
  DocumentRecord,
  DocumentState,
  DocumentVault,
  ObjectReceipt,
  PreparedRetrieval,
  PreparedUpload,
  PresignRequest,
} from "@askimate/aas-documents";
import {
  DocumentNotFoundError,
  DocumentPurgedError,
  mintBoundUpload,
  objectKeyFor,
  receiveUpload,
} from "@askimate/aas-documents";

import { ulid } from "./ulid.js";

/** How long a retrieval URL lives. The runner fetches at once; a minute is generous. */
export const RETRIEVAL_TTL_SECONDS = 60;

export interface S3DocumentVaultOptions {
  readonly client: S3Client;
  readonly bucket: string;
  /** The customer-managed key's ARN (ADR-0010). HEAD reports the ARN, so the ARN is what is compared. */
  readonly kmsKeyId: string;
}

/**
 * The SDK's presigner, told exactly what `mintBoundUpload` decided.
 *
 * Exported on its own so the adapter test can call it directly, and call the
 * SDK's DEFAULT beside it, and show `assertBoundUploadUrl` accepting the one
 * and refusing the other.
 */
export function s3Presigner(client: S3Client, bucket: string) {
  return (request: PresignRequest): Promise<string> =>
    getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: request.key,
        ChecksumSHA256: request.checksumSha256,
        ChecksumAlgorithm: "SHA256",
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: request.kmsKeyId,
      }),
      {
        expiresIn: request.expiresInSeconds,
        // ── The whole finding of 2026-09-09, as one option ─────────────
        //
        // Without this the SDK hoists x-amz-checksum-sha256 into the query
        // string, S3 never reads it, and the URL binds nothing. With it the
        // header is signed and must be sent. `mintBoundUpload` checks the
        // result either way; this is the adapter doing its part.
        unhoistableHeaders: new Set(request.unhoistableHeaders),
      },
    );
}

export class S3DocumentVault implements DocumentVault {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #kmsKeyId: string;
  readonly #records = new Map<DocumentId, DocumentRecord>();
  readonly #keys = new Map<DocumentId, string>();

  public constructor(options: S3DocumentVaultOptions) {
    this.#client = options.client;
    this.#bucket = options.bucket;
    this.#kmsKeyId = options.kmsKeyId;
  }

  public prepareUpload(intake: DocumentIntake, now: Date): Promise<PreparedUpload> {
    return mintBoundUpload({
      intake,
      kmsKeyId: this.#kmsKeyId,
      now,
      presign: s3Presigner(this.#client, this.#bucket),
    });
  }

  public async confirmUpload(intake: DocumentIntake, now: Date): Promise<DocumentRecord> {
    const key = objectKeyFor(intake);
    const receipt = await this.#head(key);
    const received = receiveUpload({ intake, kmsKeyId: this.#kmsKeyId, receipt });
    const upload = received.intake.upload;

    const documentId = ulid(now);
    const record: DocumentRecord = {
      documentId,
      studentId: upload.studentId,
      documentType: upload.documentType,
      purpose: upload.purpose,
      state: "uploaded",
      contentHash: upload.contentHash,
      contentType: upload.contentType,
      sizeBytes: upload.sizeBytes,
      uploadedAt: now,
      dates: upload.dates,
      retentionPolicyReference: upload.policyReference,
      retentionTriggeredAt: null,
    };
    this.#records.set(documentId, record);
    this.#keys.set(documentId, received.key);
    return record;
  }

  public describe(documentId: DocumentId): Promise<DocumentRecord | null> {
    return Promise.resolve(this.#records.get(documentId) ?? null);
  }

  public async prepareRetrieval(documentId: DocumentId, now: Date): Promise<PreparedRetrieval> {
    const record = this.#records.get(documentId);
    if (record === undefined) throw new DocumentNotFoundError(documentId);
    const key = this.#keys.get(documentId);
    if (record.state === "purged" || key === undefined) throw new DocumentPurgedError(documentId);
    const url = await getSignedUrl(
      this.#client,
      new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      { expiresIn: RETRIEVAL_TTL_SECONDS },
    );
    return { url, method: "GET", expiresAt: new Date(now.getTime() + RETRIEVAL_TTL_SECONDS * 1000) };
  }

  public listForStudent(studentId: string): Promise<readonly DocumentRecord[]> {
    return Promise.resolve([...this.#records.values()].filter((r) => r.studentId === studentId));
  }

  public transition(documentId: DocumentId, state: DocumentState, _now: Date): Promise<DocumentRecord> {
    const record = this.#records.get(documentId);
    if (record === undefined) return Promise.reject(new DocumentNotFoundError(documentId));
    const updated: DocumentRecord = { ...record, state };
    this.#records.set(documentId, updated);
    return Promise.resolve(updated);
  }

  public startRetentionClock(documentId: DocumentId, at: Date): Promise<DocumentRecord> {
    const record = this.#records.get(documentId);
    if (record === undefined) return Promise.reject(new DocumentNotFoundError(documentId));
    if (record.retentionTriggeredAt !== null) return Promise.resolve(record);
    const updated: DocumentRecord = { ...record, retentionTriggeredAt: at };
    this.#records.set(documentId, updated);
    return Promise.resolve(updated);
  }

  public async purgeContents(documentId: DocumentId, _now: Date): Promise<DocumentRecord> {
    const record = this.#records.get(documentId);
    if (record === undefined) throw new DocumentNotFoundError(documentId);
    const key = this.#keys.get(documentId);
    if (key !== undefined) {
      await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
      this.#keys.delete(documentId);
    }
    const updated: DocumentRecord = { ...record, state: "purged" };
    this.#records.set(documentId, updated);
    return updated;
  }

  /** HEAD, with the checksum asked for. Null on 404 — S3's answer for "nothing there". */
  async #head(key: string): Promise<ObjectReceipt | null> {
    try {
      const result = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: key, ChecksumMode: "ENABLED" }),
      );
      return {
        checksumSha256: result.ChecksumSHA256 ?? null,
        contentLength: result.ContentLength ?? null,
        serverSideEncryption: result.ServerSideEncryption ?? null,
        kmsKeyId: result.SSEKMSKeyId ?? null,
      };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      const name = (error as { name?: string }).name;
      if (status === 404 || name === "NotFound" || name === "NoSuchKey") return null;
      throw error;
    }
  }
}
