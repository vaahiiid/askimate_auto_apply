/**
 * Does a pre-signed S3 PUT bind the body to the declared hash?
 *
 *   AAS_S3_VERIFY_BUCKET=<bucket> pnpm run verify-s3-checksum
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0092 decides that a student's document never enters a process we run:
 * the Conversation Service runs the storage gates, then mints a pre-signed
 * upload rather than accepting bytes. The property ADR-0090 built — THE GATES
 * RUN BEFORE A BYTE IS ACCEPTED — then rests on one fact about S3:
 *
 *     A pre-signed PUT minted for hash H must be REFUSED for any body that
 *     does not hash to H.
 *
 * That fact was flagged as unverified from the sandbox, and Vahid made its
 * verification a condition:
 *
 *   "Verify the S3 checksum enforcement against a real bucket BEFORE reshaping
 *    the port around it. … If a pre-signed URL cannot bind the body to the
 *    declared hash, tell me before building further — the whole
 *    gates-before-bytes property rests on it."
 *
 * This script IS that verification. It runs the experiment against a real
 * bucket and says VERIFIED, REFUTED or NOT CHECKED — and it cannot say
 * VERIFIED by accident, because the control experiment (E3) has to succeed
 * for the refusal in E2 to mean anything. See `judge`.
 *
 * ── Two halves, both required ─────────────────────────────────────────────
 *
 * The SSE-KMS experiment (E5) was optional when this was written. Vahid made
 * it required on 2026-09-09, in his words:
 *
 *   "The KMS half is not a nice-to-have — ADR-0010 requires the vault to be
 *    encrypted with a customer-managed key, and under D the encryption is
 *    S3's, so if a pre-signed PUT cannot carry SSE-KMS under a CMK the
 *    uploader has no grant to, then D has a hole in it. I would rather find
 *    that now than after the port is reshaped."
 *
 * So the run refuses to start without a key, the two verdicts are reported
 * separately, and the exit code is zero only when BOTH are VERIFIED. And,
 * as he asked: "If the SSE-KMS half is REFUTED, that is a different problem
 * and I want it named as such rather than folded in." The reasons say so.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What it does to the bucket, precisely ─────────────────────────────────
 *
 *   • writes at most three small objects under `verify/<runId>/`, each a few
 *     hundred bytes of text that is NOT a document and NOT personal data;
 *   • reads them back with HEAD;
 *   • deletes them before exiting, on every path including failure.
 *
 * It needs `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on that one
 * prefix, and nothing else. `docs/provisioning-request-s3-verification.md`
 * says exactly what to create. NOTHING IS PROVISIONED BY THIS SCRIPT.
 *
 * ── Without credentials or a bucket ───────────────────────────────────────
 *
 * It says so, loudly, and exits non-zero. The precedent is `verify-bedrock`:
 * a verification that could not run must not look like one that passed.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

// Built rather than written: a literal ESC byte in source is a control
// character the tooling refuses (P51 met the same thing in a regex).
const ESC = String.fromCharCode(27);
const DIM = `${ESC}[2m`;
const BOLD = `${ESC}[1m`;
const GREEN = `${ESC}[32m`;
const AMBER = `${ESC}[33m`;
const RED = `${ESC}[31m`;
const RESET = `${ESC}[0m`;

/** ADR-0012. Overridable only so a differently-placed verification bucket can be used. */
const DEFAULT_REGION = "eu-west-2";

/** Long enough to upload a few hundred bytes; short enough that a leaked URL is useless. */
const URL_TTL_SECONDS = 120;

// ───────────────────────────────────────────────────────────────────────────
// The experiments, as data — so the judgement can be tested without S3
// ───────────────────────────────────────────────────────────────────────────

export type ExperimentId =
  | "E1_correct_bytes_bound"
  | "E2_same_length_substitution_bound"
  | "E3_unbound_put_accepts_anything"
  | "E4_stored_checksum_matches"
  | "E5_sse_kms_via_presigned";

/** What one experiment observed. `status` is the HTTP status, or null if the call did not complete. */
export interface Observation {
  readonly id: ExperimentId;
  readonly status: number | null;
  /** S3's own error code from the XML body, when there was one. */
  readonly s3Code: string | null;
  /** For E4/E5: what HEAD reported. */
  readonly head?: {
    readonly checksumSha256: string | null;
    readonly serverSideEncryption: string | null;
    readonly kmsKeyId: string | null;
  };
  /** Anything that stopped the experiment running at all. */
  readonly error: string | null;
  /** How the checksum was carried — the detail a second run would need. */
  readonly mechanism?: string;
}

export type Verdict = "VERIFIED" | "REFUTED" | "NOT CHECKED";

export interface Judgement {
  /** The load-bearing one. ADR-0090's property rests on this. */
  readonly binding: Verdict;
  readonly bindingReason: string;
  /** Separate, and required: can the same pre-signed PUT carry SSE-KMS under a CMK? */
  readonly sseKms: Verdict;
  readonly sseKmsReason: string;
}

const ok = (status: number | null): boolean => status !== null && status >= 200 && status < 300;
const refused = (status: number | null): boolean =>
  status !== null && status >= 400 && status < 500;

/**
 * Turns observations into a verdict, and cannot say VERIFIED by accident.
 *
 * ── The control experiment is what makes REFUSED mean something ───────────
 *
 * E2 alone — "S3 refused the substituted body" — proves nothing. A wrong
 * bucket policy, an expired credential or a mistyped key name also produce a
 * 4xx. So VERIFIED requires E1 to have SUCCEEDED (the bound URL works for the
 * right bytes) and E3 to have SUCCEEDED (an UNBOUND URL accepts the same
 * substituted bytes), so that the only difference between E2 and E3 is the
 * binding. That is ADR-0072's rule for a demonstration, applied to an
 * experiment: a result that cannot fail is not evidence.
 *
 * REFUTED needs only one thing: E2 was accepted. If S3 stored a body that does
 * not hash to the declared value, the property does not hold, whatever else
 * happened — and that is the answer Vahid asked to be told before building.
 */
export function judge(observations: readonly Observation[]): Judgement {
  const by = new Map(observations.map((o) => [o.id, o] as const));
  const e1 = by.get("E1_correct_bytes_bound");
  const e2 = by.get("E2_same_length_substitution_bound");
  const e3 = by.get("E3_unbound_put_accepts_anything");
  const e4 = by.get("E4_stored_checksum_matches");
  const e5 = by.get("E5_sse_kms_via_presigned");

  let binding: Verdict;
  let bindingReason: string;

  if (e2 !== undefined && ok(e2.status)) {
    binding = "REFUTED";
    bindingReason =
      `S3 ACCEPTED a body that does not hash to the declared value (E2 returned ` +
      `${String(e2.status)}). A pre-signed PUT does not bind the body to the hash by this ` +
      `mechanism. Do not reshape the port around it.`;
  } else if (
    e1 !== undefined &&
    ok(e1.status) &&
    e2 !== undefined &&
    refused(e2.status) &&
    e3 !== undefined &&
    ok(e3.status) &&
    e4 !== undefined &&
    e4.head?.checksumSha256 !== null &&
    e4.head?.checksumSha256 !== undefined &&
    e4.error === null
  ) {
    binding = "VERIFIED";
    bindingReason =
      `The bound URL accepted the right bytes (E1 ${String(e1.status)}), refused a same-length ` +
      `substitution (E2 ${String(e2.status)}${e2.s3Code === null ? "" : ` ${e2.s3Code}`}), an ` +
      `UNBOUND URL accepted that same substitution (E3 ${String(e3.status)}) so the refusal was the ` +
      `binding and nothing else, and S3 stored the checksum it enforced (E4).`;
  } else {
    binding = "NOT CHECKED";
    const required = [
      "E1_correct_bytes_bound",
      "E2_same_length_substitution_bound",
      "E3_unbound_put_accepts_anything",
      "E4_stored_checksum_matches",
    ] as const;
    const missing = required.filter((id) => {
      const o = by.get(id);
      return o === undefined || o.error !== null || o.status === null;
    });
    bindingReason =
      missing.length > 0
        ? `Could not run: ${missing.join(", ")}. A verification that did not complete is not a pass.`
        : `The experiments completed but not in the pattern that proves the property — E1 ` +
          `${String(e1?.status)}, E2 ${String(e2?.status)}, E3 ${String(e3?.status)}. Read the ` +
          `record; do not infer.`;
  }

  let sseKms: Verdict;
  let sseKmsReason: string;
  if (e5 === undefined) {
    sseKms = "NOT CHECKED";
    sseKmsReason =
      "SSE-KMS through a pre-signed PUT was not tried. It is required (Vahid, 2026-09-09): a run " +
      "without it is not the run that was approved.";
  } else if (
    ok(e5.status) &&
    e5.head?.serverSideEncryption === "aws:kms" &&
    e5.head.kmsKeyId !== null
  ) {
    sseKms = "VERIFIED";
    sseKmsReason = `A pre-signed PUT with SSE-KMS headers was accepted and HEAD reports aws:kms under ${e5.head.kmsKeyId}.`;
  } else if (e5.error === null && e5.status !== null && !ok(e5.status)) {
    sseKms = "REFUTED";
    sseKmsReason =
      `S3 refused the SSE-KMS pre-signed PUT (${String(e5.status)}` +
      `${e5.s3Code === null ? "" : ` ${e5.s3Code}`}). This is a DIFFERENT PROBLEM from the ` +
      `checksum binding and is reported as one: ADR-0010 requires the vault to be encrypted under ` +
      `a customer-managed key, and under ADR-0092 that encryption is S3's — if a pre-signed PUT ` +
      `cannot carry it, D has a hole in it. The signing credential may lack kms:GenerateDataKey ` +
      `on the key, or the SSE headers were not signed into the URL. Establish which before ` +
      `reading this as a verdict on the design.`;
  } else {
    sseKms = "NOT CHECKED";
    sseKmsReason = e5.error ?? "E5 completed without a readable HEAD.";
  }

  return { binding, bindingReason, sseKms, sseKmsReason };
}

// ───────────────────────────────────────────────────────────────────────────
// The experiment
// ───────────────────────────────────────────────────────────────────────────

interface Env {
  readonly bucket: string;
  readonly region: string;
  readonly kmsKeyId: string;
}

/** Which required variable is missing, if one is. Both halves need both. */
type Missing = "bucket" | "kms";

function readEnv(): Env | Missing {
  const bucket = process.env["AAS_S3_VERIFY_BUCKET"]?.trim();
  if (bucket === undefined || bucket.length === 0) return "bucket";
  const kmsKeyId = process.env["AAS_S3_VERIFY_KMS_KEY_ID"]?.trim();
  if (kmsKeyId === undefined || kmsKeyId.length === 0) return "kms";
  const region = process.env["AAS_S3_VERIFY_REGION"]?.trim();
  return {
    bucket,
    region: region === undefined || region.length === 0 ? DEFAULT_REGION : region,
    kmsKeyId,
  };
}

function heading(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}\n${DIM}${"─".repeat(74)}${RESET}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** S3's `<Code>` from an error body, or null. */
function s3CodeOf(body: string): string | null {
  const match = /<Code>([^<]+)<\/Code>/.exec(body);
  return match?.[1] ?? null;
}

/** Base64 of the raw SHA-256 — the form S3's checksum headers take. Not hex. */
function sha256Base64(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64");
}

/**
 * Uploads to a pre-signed URL and records what happened.
 *
 * The checksum can travel two ways in a pre-signed request and the SDK decides
 * which: hoisted into the query string, or left as a signed header the client
 * must send. This sends the header only when the URL does not already carry
 * the value, and records which — so a second run, or a differently-versioned
 * SDK, can be compared against this one rather than guessed at.
 */
async function put(
  id: ExperimentId,
  url: string,
  body: Uint8Array,
  checksumBase64: string | null,
  extraHeaders: Record<string, string> = {},
): Promise<Observation> {
  const parsed = new URL(url);
  const inQuery = parsed.searchParams.get("x-amz-checksum-sha256");
  const headers: Record<string, string> = { ...extraHeaders };
  let mechanism: string;
  if (checksumBase64 === null) {
    mechanism = "no checksum bound";
  } else if (inQuery !== null) {
    mechanism = "x-amz-checksum-sha256 hoisted into the signed query string";
  } else {
    headers["x-amz-checksum-sha256"] = checksumBase64;
    mechanism = "x-amz-checksum-sha256 sent as a signed header";
  }
  const signed = parsed.searchParams.get("X-Amz-SignedHeaders");
  mechanism += `; X-Amz-SignedHeaders=${signed ?? "(none)"}`;

  try {
    const response = await fetch(url, { method: "PUT", headers, body: new Uint8Array(body) });
    const text = await response.text();
    return {
      id,
      status: response.status,
      s3Code: response.ok ? null : s3CodeOf(text),
      error: null,
      mechanism,
    };
  } catch (error) {
    return { id, status: null, s3Code: null, error: messageOf(error), mechanism };
  }
}

async function head(
  id: ExperimentId,
  client: S3Client,
  bucket: string,
  key: string,
): Promise<Observation> {
  try {
    const result = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: "ENABLED" }),
    );
    return {
      id,
      status: 200,
      s3Code: null,
      error: null,
      head: {
        checksumSha256: result.ChecksumSHA256 ?? null,
        serverSideEncryption: result.ServerSideEncryption ?? null,
        kmsKeyId: result.SSEKMSKeyId ?? null,
      },
    };
  } catch (error) {
    return { id, status: null, s3Code: null, error: messageOf(error) };
  }
}

function print(o: Observation): void {
  const mark = o.error !== null ? `${RED}✗${RESET}` : `${GREEN}·${RESET}`;
  const status = o.status === null ? "no response" : `HTTP ${String(o.status)}`;
  console.log(
    `  ${mark} ${BOLD}${o.id}${RESET}  ${status}${o.s3Code === null ? "" : ` ${o.s3Code}`}`,
  );
  if (o.mechanism !== undefined) console.log(`    ${DIM}${o.mechanism}${RESET}`);
  if (o.head !== undefined) {
    console.log(
      `    ${DIM}HEAD: checksum ${o.head.checksumSha256 ?? "—"} · sse ` +
        `${o.head.serverSideEncryption ?? "—"}` +
        `${o.head.kmsKeyId === null ? "" : ` · key ${o.head.kmsKeyId}`}${RESET}`,
    );
  }
  if (o.error !== null) console.log(`    ${RED}${o.error}${RESET}`);
}

export async function main(): Promise<void> {
  console.log(`\n${BOLD}verify-s3-checksum${RESET}`);
  console.log(
    `${DIM}Does a pre-signed S3 PUT bind the body to the declared SHA-256? ADR-0092's condition.${RESET}`,
  );

  const env = readEnv();
  if (env === "bucket") {
    console.log(
      `\n  ${AMBER}No AAS_S3_VERIFY_BUCKET is set.${RESET} Nothing can be verified, and the property\n` +
        `  ADR-0090 rests on stays ${BOLD}NOT CHECKED${RESET}. This is not a pass.\n\n` +
        `  What needs to exist, what it costs and what it can reach is in\n` +
        `  ${DIM}docs/provisioning-request-s3-verification.md${RESET}. Nothing is provisioned by this script.\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (env === "kms") {
    // Refused before a single request is made: a run without the KMS half is
    // not the run that was approved, and a binding verdict on its own would
    // invite reading half an experiment as the whole.
    console.log(
      `\n  ${AMBER}No AAS_S3_VERIFY_KMS_KEY_ID is set.${RESET} The SSE-KMS half is ${BOLD}required${RESET}, not\n` +
        `  optional — Vahid, 2026-09-09: "if a pre-signed PUT cannot carry SSE-KMS under a CMK the\n` +
        `  uploader has no grant to, then D has a hole in it." Both halves stay ${BOLD}NOT CHECKED${RESET}.\n` +
        `  This is not a pass. Nothing was sent to AWS.\n\n` +
        `  The key to create is in ${DIM}docs/provisioning-request-s3-verification.md${RESET} §4.\n`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `${DIM}Bucket: ${env.bucket} · Region: ${env.region} · writes under verify/<runId>/ only, then deletes${RESET}`,
  );

  heading("1 · Identity");
  try {
    const identity = await new STSClient({ region: env.region }).send(
      new GetCallerIdentityCommand({}),
    );
    console.log(
      `  ${GREEN}✓${RESET} Account ${BOLD}${identity.Account ?? "unknown"}${RESET}  ${DIM}${identity.Arn ?? ""}${RESET}`,
    );
  } catch (error) {
    console.log(`  ${RED}✗${RESET} Could not identify the caller: ${messageOf(error)}`);
    console.log(
      `\n  ${AMBER}No usable AWS credentials.${RESET} The property stays ${BOLD}NOT CHECKED${RESET}.\n`,
    );
    process.exitCode = 1;
    return;
  }

  const client = new S3Client({ region: env.region });
  // eslint-disable-next-line no-restricted-syntax -- run boundary
  const startedAt = new Date();
  const runId = `${startedAt.toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  const prefix = `verify/${runId}`;

  // The bodies. Same length, one byte apart — the substitution a length check
  // alone would miss, which is the case ADR-0090's tests isolate too.
  const nonce = randomBytes(8).toString("hex");
  const a = new TextEncoder().encode(
    `aas verify-s3-checksum ${runId} ${nonce} — not a document, not personal data. A`,
  );
  const b = new Uint8Array(a);
  b[b.length - 1] = "B".charCodeAt(0);
  const hashA = sha256Base64(a);

  const keys = {
    bound: `${prefix}/bound.txt`,
    unbound: `${prefix}/unbound.txt`,
    kms: `${prefix}/kms.txt`,
  };
  const observations: Observation[] = [];

  try {
    heading("2 · The experiments");

    // E1 — a URL bound to H(A), given A. Must succeed, or nothing below means anything.
    const boundUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: env.bucket,
        Key: keys.bound,
        ChecksumSHA256: hashA,
        ChecksumAlgorithm: "SHA256",
      }),
      { expiresIn: URL_TTL_SECONDS },
    );
    const e1 = await put("E1_correct_bytes_bound", boundUrl, a, hashA);
    observations.push(e1);
    print(e1);

    // E2 — a FRESH URL bound to H(A), given B. THE PROPERTY. Must be refused.
    const boundUrl2 = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: env.bucket,
        Key: keys.bound,
        ChecksumSHA256: hashA,
        ChecksumAlgorithm: "SHA256",
      }),
      { expiresIn: URL_TTL_SECONDS },
    );
    const e2 = await put("E2_same_length_substitution_bound", boundUrl2, b, hashA);
    observations.push(e2);
    print(e2);

    // E3 — the CONTROL. A URL with nothing bound, given B. Must succeed, so that
    // E2's refusal is attributable to the binding and to nothing else.
    const unboundUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: env.bucket, Key: keys.unbound }),
      { expiresIn: URL_TTL_SECONDS },
    );
    const e3 = await put("E3_unbound_put_accepts_anything", unboundUrl, b, null);
    observations.push(e3);
    print(e3);

    // E4 — what S3 says it stored for E1. The checksum it enforced, read back.
    const e4 = await head("E4_stored_checksum_matches", client, env.bucket, keys.bound);
    const e4Checked: Observation =
      e4.head !== undefined && e4.head.checksumSha256 !== hashA
        ? { ...e4, error: `stored checksum ${e4.head.checksumSha256 ?? "—"} ≠ declared ${hashA}` }
        : e4;
    observations.push(e4Checked);
    print(e4Checked);

    // E5 — required: SSE-KMS under a CMK, through the same kind of URL.
    {
      const kmsUrl = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: env.bucket,
          Key: keys.kms,
          ChecksumSHA256: hashA,
          ChecksumAlgorithm: "SHA256",
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: env.kmsKeyId,
        }),
        {
          expiresIn: URL_TTL_SECONDS,
          // SSE headers must be SIGNED and SENT, not hoisted — S3 requires them
          // on the request itself.
          unhoistableHeaders: new Set([
            "x-amz-server-side-encryption",
            "x-amz-server-side-encryption-aws-kms-key-id",
          ]),
        },
      );
      const e5put = await put("E5_sse_kms_via_presigned", kmsUrl, a, hashA, {
        "x-amz-server-side-encryption": "aws:kms",
        "x-amz-server-side-encryption-aws-kms-key-id": env.kmsKeyId,
      });
      const e5head = ok(e5put.status)
        ? await head("E5_sse_kms_via_presigned", client, env.bucket, keys.kms)
        : null;
      const e5: Observation =
        e5head === null
          ? e5put
          : e5head.head === undefined
            ? { ...e5put, error: e5head.error }
            : { ...e5put, head: e5head.head, error: e5head.error };
      observations.push(e5);
      print(e5);
    }
  } finally {
    // Leave the bucket as it was found, on every path.
    heading("3 · Cleanup");
    for (const key of Object.values(keys)) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: env.bucket, Key: key }));
        console.log(`  ${DIM}deleted ${key}${RESET}`);
      } catch (error) {
        console.log(`  ${AMBER}could not delete ${key}: ${messageOf(error)}${RESET}`);
      }
    }
  }

  heading("4 · Verdict");
  const verdict = judge(observations);
  const colour = (v: Verdict): string => (v === "VERIFIED" ? GREEN : v === "REFUTED" ? RED : AMBER);
  console.log(
    `  ${BOLD}binding${RESET}  ${colour(verdict.binding)}${verdict.binding}${RESET}\n    ${verdict.bindingReason}`,
  );
  console.log(
    `  ${BOLD}SSE-KMS${RESET}  ${colour(verdict.sseKms)}${verdict.sseKms}${RESET}\n    ${verdict.sseKmsReason}`,
  );

  // The record. This is what "verified before reshaping the port" points at.
  const dir = resolve("verification-runs", "s3-checksum");
  await mkdir(dir, { recursive: true });
  const file = resolve(dir, `${runId}.json`);
  await writeFile(
    file,
    JSON.stringify(
      {
        runId,
        startedAt: startedAt.toISOString(),
        bucket: env.bucket,
        region: env.region,
        observations,
        verdict,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\n  ${DIM}record: ${file}${RESET}`);

  // Zero only when BOTH halves are VERIFIED. They are still two verdicts:
  // a person reads them separately, and a KMS refusal is named above as the
  // different problem it is rather than folded into the binding's.
  if (verdict.binding !== "VERIFIED" || verdict.sseKms !== "VERIFIED") process.exitCode = 1;
  console.log("");
}

const invokedDirectly = process.argv[1]?.endsWith("verify-s3-checksum.ts") ?? false;
if (invokedDirectly) void main();
