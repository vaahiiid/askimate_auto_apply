/**
 * The bound upload: a pre-signed PUT that cannot be minted without the
 * checksum as a SIGNED HEADER.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0092 verified, against a real bucket on 2026-09-09, that a pre-signed
 * S3 PUT binds the body to a declared SHA-256 — and found the one condition
 * under which it does: *the checksum must travel as a header the uploader
 * sends and the signature covers.* The SDK's DEFAULT presign hoists
 * `x-amz-checksum-sha256` into the URL's query string, where S3 never reads
 * it. Under that default the first run said REFUTED: no checksum stored, and
 * a bound URL behaved exactly like an unbound one.
 *
 * Vahid, on the finding: *"the property holds only when the checksum is a
 * signed header the browser sends, and the SDK's default hoists it into the
 * query string where S3 never reads it. Make that structural in the minting
 * code, not a note in the ADR — a default that silently disables the binding
 * is exactly the shape this repository has spent phases removing. If it can
 * be made impossible to mint an upload URL without that header signed, do
 * that."*
 *
 * ── How it is made impossible ─────────────────────────────────────────────
 *
 * `BoundUploadUrl` is a branded string and `mintBoundUpload` is its ONLY
 * producer. It does not trust the presigner it is handed:
 *
 *   1. it computes the checksum header value from the intake itself, so the
 *      adapter cannot sign a different hash from the one the gates saw;
 *   2. it names the headers that must be unhoistable, so the adapter cannot
 *      forget to say so;
 *   3. and then it READS THE URL BACK and refuses it unless `X-Amz-SignedHeaders`
 *      covers every required header and the checksum is absent from the query
 *      string. A presigner that hoisted — this SDK version by default, a future
 *      one by regression — produces a URL this function throws on rather than
 *      hands out.
 *
 * A route can only put a `BoundUploadUrl` on the wire, so an unbound URL has no
 * path to a browser. That is the structure; ADR-0093 is the record.
 *
 * ── The uploader's side ───────────────────────────────────────────────────
 *
 * The URL is useless without the headers: the run's E6 (header omitted) and E7
 * (header altered to match a substituted body) were both refused with
 * `SignatureDoesNotMatch`. So `PreparedUpload` STATES the headers the browser
 * must send, exactly — ADR-0075's rule that a client is told rather than left
 * to guess and be refused.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Brand } from "@askimate/aas-domain";

import type { DocumentIntake } from "./intake.js";
import { INTAKE_TTL_MS, IntakeRefusedError } from "./intake.js";

/** The header S3 reads the declared SHA-256 from. Base64 of the 32 digest bytes. */
export const CHECKSUM_HEADER = "x-amz-checksum-sha256";
/** The two SSE-KMS headers. Signed and sent for the same reason: S3 reads them from the request. */
export const SSE_HEADER = "x-amz-server-side-encryption";
export const SSE_KEY_HEADER = "x-amz-server-side-encryption-aws-kms-key-id";

/**
 * The headers the signature MUST cover, and therefore the headers the uploader
 * MUST send. `host` is always signed; these are the ones a presigner would
 * hoist by default.
 */
export const REQUIRED_SIGNED_HEADERS: readonly string[] = [
  CHECKSUM_HEADER,
  SSE_HEADER,
  SSE_KEY_HEADER,
];

/** A pre-signed PUT whose signature covers the checksum header. Only `mintBoundUpload` makes one. */
export type BoundUploadUrl = Brand<string, "BoundUploadUrl">;

/**
 * What the browser is handed: the URL, and the headers without which the URL
 * is refused. Stated, because the run proved omitting or altering any of them
 * is refused by S3 with `SignatureDoesNotMatch`.
 */
export interface PreparedUpload {
  readonly url: BoundUploadUrl;
  readonly method: "PUT";
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

/** A short-lived GET for the runner, minted after `mayTransmit` (ADR-0022). */
export interface PreparedRetrieval {
  readonly url: string;
  readonly method: "GET";
  readonly expiresAt: Date;
}

/** What `mintBoundUpload` asks a presigner for. Every field is decided here, not by the adapter. */
export interface PresignRequest {
  readonly key: string;
  /** Base64 of the declared SHA-256. Computed from the intake; the adapter signs exactly this. */
  readonly checksumSha256: string;
  readonly kmsKeyId: string;
  readonly expiresInSeconds: number;
  /** The headers the presigner must NOT hoist into the query string. */
  readonly unhoistableHeaders: ReadonlySet<string>;
}

/** An adapter's presigner. Returns the URL; `mintBoundUpload` decides whether to accept it. */
export type Presigner = (request: PresignRequest) => Promise<string>;

/** The URL a presigner returned does not bind the body to the declared hash. */
export class UnboundUploadError extends Error {
  public override readonly name = "UnboundUploadError";
  public constructor(message: string) {
    super(
      `REFUSING TO HAND OUT AN UPLOAD URL: ${message} ADR-0092's run established that the ` +
        `binding holds only when the checksum is a signed header the uploader sends; a URL ` +
        `without that is one S3 accepts any body on. Nothing was returned to the caller.`,
    );
  }
}

/** The object key an intake's bytes come to rest under. One place, so both adapters agree. */
export function objectKeyFor(intake: DocumentIntake): string {
  return `documents/${intake.upload.studentId}/${intake.intakeId}`;
}

/** The value S3 expects in `x-amz-checksum-sha256`: base64 of the digest bytes, not of the hex. */
export function checksumHeaderValue(hexSha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(hexSha256)) {
    throw new Error(`A SHA-256 is 64 lowercase hex characters; got ${JSON.stringify(hexSha256)}.`);
  }
  return Buffer.from(hexSha256, "hex").toString("base64");
}

/** The `X-Amz-Date` form, `20260909T131500Z`, as a Date. */
function parseAmzDate(value: string | null): Date | null {
  if (value === null) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (match === null) return null;
  const [, y, mo, d, h, mi, s] = match;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
}

/**
 * Reads a presigned URL back and refuses it unless the binding is in the
 * signature. The only way to obtain a `BoundUploadUrl`.
 *
 * Exported for the adapter tests, which feed it URLs the REAL SDK minted with
 * and without `unhoistableHeaders`, so the refusal is proven against the
 * library that will produce the URLs rather than against a string a test
 * wrote.
 */
export function assertBoundUploadUrl(
  raw: string,
  bounds: { readonly notAfter: Date; readonly now: Date },
): BoundUploadUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnboundUploadError(`the presigner returned something that is not a URL.`);
  }
  if (url.protocol !== "https:") {
    throw new UnboundUploadError(`the URL is ${url.protocol}, not https:.`);
  }

  // 1. Not hoisted. A checksum in the query string is one S3 never reads.
  for (const name of url.searchParams.keys()) {
    if (name.toLowerCase() === CHECKSUM_HEADER) {
      throw new UnboundUploadError(
        `the presigner HOISTED ${CHECKSUM_HEADER} into the query string. That is the SDK's ` +
          `default, and it is exactly the URL the first run refuted the property under.`,
      );
    }
  }

  // 2. Signed. Every required header must be covered by the signature, or the
  //    uploader may omit or alter it (E6, E7).
  const signedRaw = url.searchParams.get("X-Amz-SignedHeaders");
  if (signedRaw === null || signedRaw.length === 0) {
    throw new UnboundUploadError(`the URL names no signed headers at all.`);
  }
  const signed = new Set(signedRaw.split(";").map((h) => h.trim().toLowerCase()));
  const missing = REQUIRED_SIGNED_HEADERS.filter((h) => !signed.has(h));
  if (missing.length > 0) {
    throw new UnboundUploadError(
      `the signature does not cover ${missing.join(", ")} (X-Amz-SignedHeaders=${signedRaw}).`,
    );
  }

  // 3. Short-lived, and never longer than the intake it was minted for. An
  //    upload URL that outlives its intake is a permission with no gate behind
  //    it.
  const expiresRaw = url.searchParams.get("X-Amz-Expires");
  const expires = expiresRaw === null ? Number.NaN : Number(expiresRaw);
  if (!Number.isSafeInteger(expires) || expires <= 0) {
    throw new UnboundUploadError(`the URL has no usable X-Amz-Expires (${String(expiresRaw)}).`);
  }
  const signedAt = parseAmzDate(url.searchParams.get("X-Amz-Date")) ?? bounds.now;
  const urlExpiresAt = new Date(signedAt.getTime() + expires * 1000);
  if (urlExpiresAt.getTime() > bounds.notAfter.getTime()) {
    throw new UnboundUploadError(
      `the URL would be valid until ${urlExpiresAt.toISOString()}, past the intake's ` +
        `${bounds.notAfter.toISOString()}.`,
    );
  }

  return raw as BoundUploadUrl;
}

/**
 * Mints the upload for an intake that passed the gates.
 *
 * Takes a `DocumentIntake`, which `openIntake` alone produces from a
 * `StorableUpload`, which `assertStorable` alone produces — the same chain of
 * brands as before (ADR-0068, ADR-0090), now ending in a URL instead of a
 * byte buffer. The checksum is computed HERE from the intake's declared hash;
 * the presigner is told what to sign and is then checked.
 */
export async function mintBoundUpload(input: {
  readonly intake: DocumentIntake;
  readonly kmsKeyId: string;
  readonly now: Date;
  readonly presign: Presigner;
}): Promise<PreparedUpload> {
  const { intake, kmsKeyId, now } = input;
  if (now.getTime() >= intake.expiresAt.getTime()) {
    throw new IntakeRefusedError(
      "intake_not_open",
      `This upload was prepared at ${intake.openedAt.toISOString()} and is no longer open. ` +
        `Start the upload again — the checks that permitted it are re-run, which is the point.`,
    );
  }
  if (kmsKeyId.trim().length === 0) {
    throw new UnboundUploadError(`no customer-managed key is configured (ADR-0010).`);
  }

  const checksumSha256 = checksumHeaderValue(intake.declaredHash);
  const remainingMs = intake.expiresAt.getTime() - now.getTime();
  const expiresInSeconds = Math.max(1, Math.floor(Math.min(remainingMs, INTAKE_TTL_MS) / 1000));

  const raw = await input.presign({
    key: objectKeyFor(intake),
    checksumSha256,
    kmsKeyId,
    expiresInSeconds,
    unhoistableHeaders: new Set(REQUIRED_SIGNED_HEADERS),
  });

  const url = assertBoundUploadUrl(raw, { notAfter: intake.expiresAt, now });
  const expiresAt = new Date(Math.min(intake.expiresAt.getTime(), now.getTime() + expiresInSeconds * 1000));

  return {
    url,
    method: "PUT",
    headers: {
      [CHECKSUM_HEADER]: checksumSha256,
      [SSE_HEADER]: "aws:kms",
      [SSE_KEY_HEADER]: kmsKeyId,
    },
    expiresAt,
  };
}

// ── The other end: what the store says it holds ─────────────────────────────

/** What a HEAD on the object reports. `null` fields are absent from the response. */
export interface ObjectReceipt {
  readonly checksumSha256: string | null;
  readonly contentLength: number | null;
  readonly serverSideEncryption: string | null;
  readonly kmsKeyId: string | null;
}

/** The object is there and S3 encrypted it, but not under the key ADR-0010 requires. */
export class UnencryptedObjectError extends Error {
  public override readonly name = "UnencryptedObjectError";
  public constructor(key: string, receipt: ObjectReceipt) {
    super(
      `Object ${key} is not encrypted under the configured customer-managed key: S3 reports ` +
        `sse=${receipt.serverSideEncryption ?? "none"} key=${receipt.kmsKeyId ?? "none"}. This is ` +
        `a bucket or URL configuration fault, not the student's — the upload URL signs the SSE ` +
        `headers, so a compliant PUT cannot produce this. The document is not recorded.`,
    );
  }
}

/**
 * An upload the store confirms it holds, matching the declaration exactly.
 *
 * Branded, and `receiveUpload` is its only source, so a record cannot be
 * written for bytes nobody checked against the declaration — the device
 * `AcceptedBytes` used when the bytes came through this process, moved to
 * where the bytes now are.
 */
export type ReceivedUpload = Brand<
  {
    readonly intake: DocumentIntake;
    readonly key: string;
    readonly receipt: ObjectReceipt;
  },
  "ReceivedUpload"
>;

/**
 * Checks what the store holds against the intake that permitted it.
 *
 * S3 already enforced the checksum when it accepted the PUT (E2, E4). This is
 * the read-back: the confirmation must not take the browser's word that the
 * upload happened, and a store that enforced one value and recorded another
 * would be a finding, not a pass — the same rule the verification's judge
 * applied to E4.
 */
export function receiveUpload(input: {
  readonly intake: DocumentIntake;
  readonly kmsKeyId: string;
  readonly receipt: ObjectReceipt | null;
}): ReceivedUpload {
  const { intake, receipt } = input;
  const key = objectKeyFor(intake);

  if (receipt === null) {
    throw new IntakeRefusedError(
      "upload_not_received",
      `The store holds nothing for this upload. Either the PUT to the upload URL did not ` +
        `complete, or it was refused — a body that does not hash to the declared value, or a ` +
        `missing header, is refused by the store itself. Declare the document again; the checks ` +
        `that permit it are re-run, which is the point.`,
    );
  }

  const expected = checksumHeaderValue(intake.declaredHash);
  if (receipt.checksumSha256 !== expected) {
    throw new IntakeRefusedError(
      "content_hash_mismatch",
      `The store reports checksum ${receipt.checksumSha256 ?? "(none)"} for this upload, and the ` +
        `document the gates were run for has ${expected}. Nothing is recorded.`,
    );
  }
  if (receipt.contentLength !== intake.declaredSizeBytes) {
    throw new IntakeRefusedError(
      "content_hash_mismatch",
      `This upload was prepared for ${String(intake.declaredSizeBytes)} bytes and the store holds ` +
        `${String(receipt.contentLength)}. Nothing is recorded.`,
    );
  }
  if (receipt.serverSideEncryption !== "aws:kms" || receipt.kmsKeyId !== input.kmsKeyId) {
    throw new UnencryptedObjectError(key, receipt);
  }

  return { intake, key, receipt } as ReceivedUpload;
}
