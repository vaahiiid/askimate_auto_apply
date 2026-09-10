/**
 * In-memory document vault, over an in-memory object store that behaves as
 * the verified bucket did.
 *
 * The reference implementation: real enough to develop and test the whole
 * declare → upload → confirm → retrieve flow against, with no AWS account.
 *
 * NOT for production — it holds objects in process memory, loses them on
 * restart, and encrypts nothing. `assertDocumentStoreIsDurable` refuses it
 * there (ADR-0090). The S3 + KMS implementation lives in the Conversation
 * Service and satisfies this same contract.
 *
 * ── The fake is not a stub ────────────────────────────────────────────────
 *
 * `InMemoryObjectStore.put` refuses exactly what the run of 2026-09-09 showed
 * S3 refusing (ADR-0092 §4): a body that does not hash to the signed value
 * (E2, `BadDigest`), a required header the uploader omitted (E6,
 * `SignatureDoesNotMatch`), a header the uploader altered (E7, the same), a
 * URL past its expiry, and a signature that does not match. It accepts what S3
 * accepted (E1, E3, E5). A test that passes against this fake and would fail
 * against S3 has to be one the run did not cover — and the run is the record
 * of what was covered.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";

import type {
  ObjectReceipt,
  PreparedRetrieval,
  PreparedUpload,
  PresignRequest,
} from "./bound-upload.js";
import {
  CHECKSUM_HEADER,
  SSE_HEADER,
  SSE_KEY_HEADER,
  mintBoundUpload,
  objectKeyFor,
  receiveUpload,
} from "./bound-upload.js";
import type { DocumentIntake } from "./intake.js";
import type { DocumentId, DocumentRecord, DocumentState, DocumentVault } from "./vault.js";
import { DocumentNotFoundError, DocumentPurgedError } from "./vault.js";

/** What the fake answers a PUT with: the status and the S3 error code S3 would send. */
export interface FakePutResult {
  readonly status: number;
  readonly code: string | null;
}

interface Grant {
  readonly key: string;
  readonly checksumSha256: string;
  readonly kmsKeyId: string;
  readonly signedAt: Date;
  readonly expiresInSeconds: number;
  readonly signedHeaders: readonly string[];
}

interface StoredObject {
  readonly bytes: Uint8Array;
  readonly checksumSha256: string;
  readonly serverSideEncryption: string;
  readonly kmsKeyId: string;
}

/**
 * The bucket, in memory. Presigns like the SDK does WITH `unhoistableHeaders`
 * (the only way the run found the binding holds), and enforces on PUT what the
 * run observed S3 enforcing.
 */
export class InMemoryObjectStore {
  readonly #secret = randomBytes(16).toString("hex");
  readonly #grants = new Map<string, Grant>();
  readonly #objects = new Map<string, StoredObject>();
  readonly #host: string;
  readonly #origin: string;

  /**
   * `origin`, when given, is where the minted URLs point. The default is an
   * unresolvable `.invalid` host, which is right for every test that hands
   * the URL back to `put` in-process. A browser test that needs a real PUT
   * to cross a real origin boundary — the CORS rule's exercise — stands an
   * HTTPS listener in front of this store and names it here. HTTPS, because
   * `assertBoundUploadUrl` refuses anything else and a test that loosened
   * that for its own convenience would be proving a URL nothing may mint.
   */
  public constructor(bucket = "in-memory-vault", origin?: string) {
    this.#origin = origin ?? `https://${bucket}.in-memory.invalid`;
    this.#host = new URL(this.#origin).host;
  }

  /** The presigner an `InMemoryDocumentVault` hands to `mintBoundUpload`. */
  public presign(now: Date): (request: PresignRequest) => Promise<string> {
    return (request) => {
      const signedHeaders = ["host", ...[...request.unhoistableHeaders].sort()];
      const grant: Grant = {
        key: request.key,
        checksumSha256: request.checksumSha256,
        kmsKeyId: request.kmsKeyId,
        signedAt: now,
        expiresInSeconds: request.expiresInSeconds,
        signedHeaders,
      };
      const signature = this.#sign(grant);
      this.#grants.set(signature, grant);
      const url = new URL(`${this.#origin}/${request.key}`);
      url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
      url.searchParams.set("X-Amz-Date", amzDate(now));
      url.searchParams.set("X-Amz-Expires", String(request.expiresInSeconds));
      url.searchParams.set("X-Amz-SignedHeaders", signedHeaders.join(";"));
      url.searchParams.set("X-Amz-Signature", signature);
      return Promise.resolve(url.toString());
    };
  }

  /**
   * The SDK's DEFAULT presign, for tests that need a URL the binding is
   * absent from: the checksum hoisted into the query string, only `host`
   * signed. This is the URL the first run refuted the property under, and the
   * URL `assertBoundUploadUrl` must refuse.
   */
  public presignHoisted(now: Date): (request: PresignRequest) => Promise<string> {
    return (request) => {
      const grant: Grant = {
        key: request.key,
        checksumSha256: request.checksumSha256,
        kmsKeyId: request.kmsKeyId,
        signedAt: now,
        expiresInSeconds: request.expiresInSeconds,
        signedHeaders: ["host"],
      };
      const signature = this.#sign(grant);
      this.#grants.set(signature, grant);
      const url = new URL(`${this.#origin}/${request.key}`);
      url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
      url.searchParams.set("X-Amz-Date", amzDate(now));
      url.searchParams.set("X-Amz-Expires", String(request.expiresInSeconds));
      url.searchParams.set("X-Amz-SignedHeaders", "host");
      url.searchParams.set(CHECKSUM_HEADER, request.checksumSha256);
      url.searchParams.set("X-Amz-Signature", signature);
      return Promise.resolve(url.toString());
    };
  }

  /**
   * The browser's PUT. Enforces what the run observed, in the order S3 did:
   * signature (which covers the signed headers' VALUES), then the checksum
   * against the body.
   */
  public put(
    url: string,
    headers: Readonly<Record<string, string>>,
    body: Uint8Array,
    now: Date,
  ): FakePutResult {
    const parsed = new URL(url);
    if (parsed.host !== this.#host) return { status: 404, code: "NoSuchBucket" };
    const signature = parsed.searchParams.get("X-Amz-Signature") ?? "";
    const grant = this.#grants.get(signature);
    if (grant === undefined) return { status: 403, code: "SignatureDoesNotMatch" };
    if (parsed.pathname !== `/${grant.key}`) return { status: 403, code: "SignatureDoesNotMatch" };
    if (now.getTime() >= grant.signedAt.getTime() + grant.expiresInSeconds * 1000) {
      return { status: 403, code: "AccessDenied" };
    }

    const sent = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const expectedHeaderValues: Record<string, string> = {
      [CHECKSUM_HEADER]: grant.checksumSha256,
      [SSE_HEADER]: "aws:kms",
      [SSE_KEY_HEADER]: grant.kmsKeyId,
    };
    // Every signed header must be SENT, with the SIGNED value. Omitted (E6)
    // and altered (E7) were both SignatureDoesNotMatch.
    for (const name of grant.signedHeaders) {
      if (name === "host") continue;
      const expected = expectedHeaderValues[name];
      if (expected === undefined) continue;
      if (sent.get(name) !== expected) return { status: 403, code: "SignatureDoesNotMatch" };
    }

    // Then the body against the checksum S3 was told to expect. Unbound URLs
    // (E3) carry no checksum and accept anything; bound ones refuse (E2).
    const bodyChecksum = createHash("sha256").update(body).digest("base64");
    const declared = grant.signedHeaders.includes(CHECKSUM_HEADER)
      ? grant.checksumSha256
      : (sent.get(CHECKSUM_HEADER) ?? null);
    if (declared !== null && declared !== bodyChecksum) return { status: 400, code: "BadDigest" };

    const sse = sent.get(SSE_HEADER) ?? "AES256";
    this.#objects.set(grant.key, {
      bytes: body.slice(),
      checksumSha256: declared ?? bodyChecksum,
      serverSideEncryption: sse,
      kmsKeyId: sse === "aws:kms" ? (sent.get(SSE_KEY_HEADER) ?? grant.kmsKeyId) : "",
    });
    return { status: 200, code: null };
  }

  /** HEAD. Null when nothing is there, as S3 answers 404. */
  public head(key: string): ObjectReceipt | null {
    const object = this.#objects.get(key);
    if (object === undefined) return null;
    return {
      checksumSha256: object.checksumSha256,
      contentLength: object.bytes.byteLength,
      serverSideEncryption: object.serverSideEncryption,
      kmsKeyId: object.kmsKeyId.length === 0 ? null : object.kmsKeyId,
    };
  }

  /** A retrieval URL and the GET that resolves it. */
  public presignGet(key: string, now: Date, expiresInSeconds: number): string {
    const url = new URL(`${this.#origin}/${key}`);
    url.searchParams.set("X-Amz-Date", amzDate(now));
    url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
    url.searchParams.set("X-Amz-SignedHeaders", "host");
    url.searchParams.set("X-Amz-Signature", createHmac("sha256", this.#secret).update(`GET ${key}`).digest("hex"));
    return url.toString();
  }

  public get(url: string): Uint8Array | null {
    const parsed = new URL(url);
    const key = parsed.pathname.slice(1);
    const expected = createHmac("sha256", this.#secret).update(`GET ${key}`).digest("hex");
    if (parsed.searchParams.get("X-Amz-Signature") !== expected) return null;
    const object = this.#objects.get(key);
    return object === undefined ? null : object.bytes.slice();
  }

  public delete(key: string): void {
    this.#objects.delete(key);
  }

  /** For tests: what is at rest under a key, or null. */
  public peek(key: string): Uint8Array | null {
    const object = this.#objects.get(key);
    return object === undefined ? null : object.bytes.slice();
  }

  /** For tests: how many upload URLs have been minted. A refused declaration must not add one. */
  public grantCount(): number {
    return this.#grants.size;
  }

  #sign(grant: Grant): string {
    return createHmac("sha256", this.#secret)
      .update(
        [grant.key, grant.checksumSha256, grant.kmsKeyId, amzDate(grant.signedAt), String(grant.expiresInSeconds), grant.signedHeaders.join(";")].join("\n"),
      )
      .digest("hex");
  }
}

function amzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** How long a retrieval URL lives. The runner fetches immediately; a minute is generous. */
export const RETRIEVAL_TTL_SECONDS = 60;

export class InMemoryDocumentVault implements DocumentVault {
  readonly #records = new Map<DocumentId, DocumentRecord>();
  readonly #keys = new Map<DocumentId, string>();
  #counter = 0;

  /**
   * No retention schedule, and no lawful-basis register.
   *
   * Both used to be an implementation's business, which meant an
   * implementation could forget them. Since P32 the gates run in
   * `assertStorable`, whose branded result is the only thing `openIntake`
   * takes, and an intake is the only thing this port takes — so there is
   * nothing left here to hold, and nothing left to forget. See `vault.ts`.
   */
  public constructor(
    public readonly objects: InMemoryObjectStore = new InMemoryObjectStore(),
    public readonly kmsKeyId = "arn:aws:kms:eu-west-2:000000000000:key/in-memory",
  ) {}

  public prepareUpload(intake: DocumentIntake, now: Date): Promise<PreparedUpload> {
    return mintBoundUpload({
      intake,
      kmsKeyId: this.kmsKeyId,
      now,
      presign: this.objects.presign(now),
    });
  }

  public confirmUpload(intake: DocumentIntake, now: Date): Promise<DocumentRecord> {
    const key = objectKeyFor(intake);
    const received = receiveUpload({ intake, kmsKeyId: this.kmsKeyId, receipt: this.objects.head(key) });
    const upload = received.intake.upload;

    this.#counter += 1;
    const documentId = `doc_${String(this.#counter).padStart(6, "0")}`;
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
    return Promise.resolve(record);
  }

  public describe(documentId: DocumentId): Promise<DocumentRecord | null> {
    return Promise.resolve(this.#records.get(documentId) ?? null);
  }

  public prepareRetrieval(documentId: DocumentId, now: Date): Promise<PreparedRetrieval> {
    const record = this.#records.get(documentId);
    if (record === undefined) return Promise.reject(new DocumentNotFoundError(documentId));
    const key = this.#keys.get(documentId);
    if (record.state === "purged" || key === undefined) {
      return Promise.reject(new DocumentPurgedError(documentId));
    }
    return Promise.resolve({
      url: this.objects.presignGet(key, now, RETRIEVAL_TTL_SECONDS),
      method: "GET",
      expiresAt: new Date(now.getTime() + RETRIEVAL_TTL_SECONDS * 1000),
    });
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
    // Idempotent: the clock starts once. Re-triggering must not extend it.
    if (record.retentionTriggeredAt !== null) return Promise.resolve(record);
    const updated: DocumentRecord = { ...record, retentionTriggeredAt: at };
    this.#records.set(documentId, updated);
    return Promise.resolve(updated);
  }

  public purgeContents(documentId: DocumentId, _now: Date): Promise<DocumentRecord> {
    const record = this.#records.get(documentId);
    if (record === undefined) return Promise.reject(new DocumentNotFoundError(documentId));
    // Contents go; metadata and hash stay, so the audit trail survives erasure.
    const key = this.#keys.get(documentId);
    if (key !== undefined) this.objects.delete(key);
    this.#keys.delete(documentId);
    const updated: DocumentRecord = { ...record, state: "purged" };
    this.#records.set(documentId, updated);
    return Promise.resolve(updated);
  }
}
