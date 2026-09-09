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
 *
 * ── The checksum is a SIGNED HEADER, not a query parameter ────────────────
 *
 * The first run against the real bucket (2026-09-09, run
 * 2026-09-09T13-31-02-151Z-e31c17) said REFUTED — and the record showed why:
 * the SDK had hoisted `x-amz-checksum-sha256` into the URL's query string,
 * the only signed header was `host`, S3 stored NO checksum, and the bound and
 * unbound URLs behaved identically. That is what a checksum never seen looks
 * like, not one seen and ignored. Vahid, on reading it:
 *
 *   "The run refuted the property under the SDK's default presign, not the
 *    property itself. … Treating that as final would have abandoned D over a
 *    client-side hoisting default."
 *
 * So the checksum header is now UNHOISTABLE: it is signed into the URL and
 * the uploader must send it, and the signature covers its value. He asked
 * this run to establish three things, not one:
 *
 *   1. S3 rejects a body that does not match the declared hash          (E2)
 *   2. an uploader who omits or alters the header is refused, because
 *      the signature covers it                                       (E6, E7)
 *   3. the KMS half still holds with both in place                   (E5, E8)
 *
 * The mechanism is recorded per experiment, so this run and the first can be
 * read side by side rather than guessed at.
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
  | "E5_sse_kms_via_presigned"
  /** Bound URL, body B, and the uploader SENDS NO checksum header. Must be refused. */
  | "E6_header_omitted_refused"
  /** Bound URL, body B, and the uploader sends a header that matches B. Must be refused. */
  | "E7_header_altered_refused"
  /** The KMS URL, body B, header H(A): the binding must still hold under SSE-KMS. */
  | "E8_sse_kms_substitution_refused";

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
  const e6 = by.get("E6_header_omitted_refused");
  const e7 = by.get("E7_header_altered_refused");
  const e8 = by.get("E8_sse_kms_substitution_refused");

  // Deliberately not a type predicate: its false branch would narrow the
  // observation to `undefined`, and a failed experiment is still one to read.
  const completed = (o: Observation | undefined): boolean =>
    o !== undefined && o.error === null && o.status !== null;

  let binding: Verdict;
  let bindingReason: string;

  // Any URL minted for H(A) that stored a body not hashing to H(A) refutes the
  // property — whichever way the uploader got it past: a plain substitution
  // (E2), dropping the header (E6), rewriting the header to match (E7), or the
  // same substitution under the KMS URL (E8).
  const accepted: { readonly id: ExperimentId; readonly what: string }[] = [];
  if (e2 !== undefined && ok(e2.status)) accepted.push({ id: e2.id, what: "a same-length substitution" });
  if (e6 !== undefined && ok(e6.status)) accepted.push({ id: e6.id, what: "a substitution with the checksum header OMITTED" });
  if (e7 !== undefined && ok(e7.status)) accepted.push({ id: e7.id, what: "a substitution with the checksum header ALTERED to match it" });
  if (e8 !== undefined && ok(e8.status)) accepted.push({ id: e8.id, what: "a same-length substitution under the SSE-KMS URL" });

  if (accepted.length > 0) {
    binding = "REFUTED";
    bindingReason =
      `S3 ACCEPTED a body that does not hash to the declared value: ` +
      accepted.map((a) => `${a.what} (${a.id} returned ${String(by.get(a.id)?.status)})`).join("; ") +
      `. A pre-signed PUT does not bind the body to the hash by this mechanism. Do not reshape the ` +
      `port around it.`;
  } else if (
    e1 !== undefined &&
    completed(e1) &&
    ok(e1.status) &&
    e2 !== undefined &&
    completed(e2) &&
    refused(e2.status) &&
    e3 !== undefined &&
    completed(e3) &&
    ok(e3.status) &&
    e6 !== undefined &&
    completed(e6) &&
    refused(e6.status) &&
    e7 !== undefined &&
    completed(e7) &&
    refused(e7.status) &&
    e4 !== undefined &&
    e4.head?.checksumSha256 !== null &&
    e4.head?.checksumSha256 !== undefined &&
    e4.error === null
  ) {
    const code = (o: Observation): string => (o.s3Code === null ? "" : ` ${o.s3Code}`);
    binding = "VERIFIED";
    bindingReason =
      `The bound URL accepted the right bytes (E1 ${String(e1.status)}), refused a same-length ` +
      `substitution (E2 ${String(e2.status)}${code(e2)}), an UNBOUND URL accepted that same ` +
      `substitution (E3 ${String(e3.status)}) so the refusal was the binding and nothing else, ` +
      `S3 stored the checksum it enforced (E4), and the signature covers the header: omitting it ` +
      `(E6 ${String(e6.status)}${code(e6)}) and altering it to match the substituted body ` +
      `(E7 ${String(e7.status)}${code(e7)}) were both refused.`;
  } else {
    binding = "NOT CHECKED";
    const required = [
      "E1_correct_bytes_bound",
      "E2_same_length_substitution_bound",
      "E3_unbound_put_accepts_anything",
      "E4_stored_checksum_matches",
      "E6_header_omitted_refused",
      "E7_header_altered_refused",
    ] as const;
    const missing = required.filter((id) => !completed(by.get(id)));
    bindingReason =
      missing.length > 0
        ? `Could not run: ${missing.join(", ")}. A verification that did not complete is not a pass.`
        : `The experiments completed but not in the pattern that proves the property — E1 ` +
          `${String(e1?.status)}, E2 ${String(e2?.status)}, E3 ${String(e3?.status)}, E6 ` +
          `${String(e6?.status)}, E7 ${String(e7?.status)}. Read the record; do not infer.`;
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
    // The encryption was applied. "With both in place" (Vahid) also needs the
    // binding to hold under the same URL — E8 — and that is asked separately
    // here, so a KMS verdict cannot be read as covering it by implication.
    if (e8 === undefined || !completed(e8)) {
      sseKms = "NOT CHECKED";
      sseKmsReason =
        `A pre-signed PUT with SSE-KMS headers was accepted and HEAD reports aws:kms under ` +
        `${e5.head.kmsKeyId}, but whether the binding still holds under that URL (E8) ` +
        `${e8 === undefined ? "was not tried" : `did not complete: ${e8.error ?? "no response"}`}. ` +
        `The KMS half is VERIFIED only with both in place.`;
    } else if (refused(e8.status)) {
      sseKms = "VERIFIED";
      sseKmsReason =
        `A pre-signed PUT with SSE-KMS headers was accepted and HEAD reports aws:kms under ` +
        `${e5.head.kmsKeyId}` +
        `${e5.head.checksumSha256 === null ? "" : ` with the declared checksum stored`}; and the ` +
        `same kind of URL refused a substituted body (E8 ${String(e8.status)}` +
        `${e8.s3Code === null ? "" : ` ${e8.s3Code}`}), so the binding holds with SSE-KMS in place.`;
    } else {
      sseKms = "REFUTED";
      sseKmsReason =
        `SSE-KMS itself was applied (E5 ${String(e5.status)}, HEAD aws:kms under ${e5.head.kmsKeyId}) ` +
        `but the KMS URL ACCEPTED a substituted body (E8 ${String(e8.status)}). The two properties ` +
        `do not hold together, which is the question asked. This is the binding failing under the ` +
        `KMS URL, not the encryption failing — the binding verdict names it as well.`;
    }
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
  /**
   * The temporary credential, read from AAS_S3_VERIFY_* — NOT from AWS_*.
   *
   * The sandbox this runs in injects placeholder AWS_ACCESS_KEY_ID /
   * AWS_SECRET_ACCESS_KEY values of its own (they begin `prox…`; STS answers
   * InvalidClientTokenId — see docs/what-a-controlled-live-run-needs.md §17),
   * and which value wins when the environment also sets AWS_* is not
   * documented. So the SDK's default chain is never consulted: the credential
   * is read from names nothing else sets and handed to the clients explicitly.
   */
  readonly credentials: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly sessionToken: string;
  };
}

/** Which required variable is missing, if one is. Both halves need all of them. */
type Missing = "bucket" | "kms" | "credential";

function nonEmpty(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function readEnv(): Env | Missing {
  const bucket = nonEmpty("AAS_S3_VERIFY_BUCKET");
  if (bucket === undefined) return "bucket";
  const kmsKeyId = nonEmpty("AAS_S3_VERIFY_KMS_KEY_ID");
  if (kmsKeyId === undefined) return "kms";
  const accessKeyId = nonEmpty("AAS_S3_VERIFY_ACCESS_KEY_ID");
  const secretAccessKey = nonEmpty("AAS_S3_VERIFY_SECRET_ACCESS_KEY");
  const sessionToken = nonEmpty("AAS_S3_VERIFY_SESSION_TOKEN");
  if (accessKeyId === undefined || secretAccessKey === undefined || sessionToken === undefined) {
    return "credential";
  }
  return {
    bucket,
    region: nonEmpty("AAS_S3_VERIFY_REGION") ?? DEFAULT_REGION,
    kmsKeyId,
    credentials: { accessKeyId, secretAccessKey, sessionToken },
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

/** The header S3 reads a declared SHA-256 from. It is never read from the query string. */
const CHECKSUM_HEADER = "x-amz-checksum-sha256";

/**
 * Uploads to a pre-signed URL and records what happened.
 *
 * The caller decides exactly which headers the uploader sends — that is the
 * experiment. What is recorded alongside is how the URL was minted: whether
 * the checksum was hoisted into the query string (the SDK's default, and the
 * first run's REFUTED) or signed as a header the uploader must send, and
 * which headers the signature covers. A second run, or a differently-versioned
 * SDK, can then be compared against this one rather than guessed at.
 */
async function put(
  id: ExperimentId,
  url: string,
  body: Uint8Array,
  headers: Record<string, string>,
  note: string,
): Promise<Observation> {
  const parsed = new URL(url);
  const inQuery = parsed.searchParams.get(CHECKSUM_HEADER) !== null;
  const signed = parsed.searchParams.get("X-Amz-SignedHeaders") ?? "(none)";
  const mechanism =
    `${note}; ${CHECKSUM_HEADER} ${inQuery ? "HOISTED into the query string" : "not in the query string"}; ` +
    `X-Amz-SignedHeaders=${signed}; uploader sent ${Object.keys(headers).join(",") || "no extra headers"}`;

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
  if (env === "credential") {
    // All three parts of a temporary credential, under names nothing else in
    // this sandbox sets. A session token is required on purpose: the request
    // asks for an assumed-role credential that expires, not an IAM user's key.
    console.log(
      `\n  ${AMBER}The temporary credential is not set.${RESET} All three are required:\n` +
        `  AAS_S3_VERIFY_ACCESS_KEY_ID, AAS_S3_VERIFY_SECRET_ACCESS_KEY, AAS_S3_VERIFY_SESSION_TOKEN.\n` +
        `  AWS_* is deliberately NOT read — this sandbox sets placeholder AWS_* values of its own.\n` +
        `  Both halves stay ${BOLD}NOT CHECKED${RESET}. This is not a pass. Nothing was sent to AWS.\n`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `${DIM}Bucket: ${env.bucket} · Region: ${env.region} · writes under verify/<runId>/ only, then deletes${RESET}`,
  );

  heading("1 · Identity");
  try {
    const identity = await new STSClient({ region: env.region, credentials: env.credentials }).send(
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

  const client = new S3Client({ region: env.region, credentials: env.credentials });
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
  const hashB = sha256Base64(b);

  const keys = {
    bound: `${prefix}/bound.txt`,
    unbound: `${prefix}/unbound.txt`,
    kms: `${prefix}/kms.txt`,
  };
  const observations: Observation[] = [];

  // The SSE headers must be signed and sent — S3 requires them on the request
  // itself. And so must the checksum: hoisted into the query string it is
  // never read (the first run), so it is signed as a header the uploader has
  // to send, and the signature then covers its value.
  const SSE_HEADERS = {
    "x-amz-server-side-encryption": "aws:kms",
    "x-amz-server-side-encryption-aws-kms-key-id": env.kmsKeyId,
  } as const;
  const unhoistable = (...names: readonly string[]): Set<string> => new Set(names);

  /** A fresh URL minted for H(A), with the checksum as a signed header. */
  const boundUrl = (): Promise<string> =>
    getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: env.bucket,
        Key: keys.bound,
        ChecksumSHA256: hashA,
        ChecksumAlgorithm: "SHA256",
      }),
      { expiresIn: URL_TTL_SECONDS, unhoistableHeaders: unhoistable(CHECKSUM_HEADER) },
    );

  /** A fresh URL minted for H(A) under SSE-KMS, checksum and SSE headers all signed. */
  const kmsUrl = (): Promise<string> =>
    getSignedUrl(
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
        unhoistableHeaders: unhoistable(CHECKSUM_HEADER, ...Object.keys(SSE_HEADERS)),
      },
    );

  const record = (o: Observation): void => {
    observations.push(o);
    print(o);
  };

  try {
    heading("2 · The experiments");

    // E1 — a URL bound to H(A), given A with the header. Must succeed, or
    // nothing below means anything.
    record(
      await put("E1_correct_bytes_bound", await boundUrl(), a, { [CHECKSUM_HEADER]: hashA },
        "body A, header H(A)"),
    );

    // E2 — a FRESH URL bound to H(A), given B with the header still saying
    // H(A). THE PROPERTY. Must be refused.
    record(
      await put("E2_same_length_substitution_bound", await boundUrl(), b, { [CHECKSUM_HEADER]: hashA },
        "body B, header H(A)"),
    );

    // E6 — the uploader drops the header. The signature covers it, so this
    // must be refused: a binding the uploader can opt out of is not one.
    record(await put("E6_header_omitted_refused", await boundUrl(), b, {}, "body B, header omitted"));

    // E7 — the uploader rewrites the header to match the substituted body.
    // Same reason: the signed value is H(A), and H(B) is not it.
    record(
      await put("E7_header_altered_refused", await boundUrl(), b, { [CHECKSUM_HEADER]: hashB },
        "body B, header altered to H(B)"),
    );

    // E3 — the CONTROL. A URL with nothing bound, given B. Must succeed, so that
    // the refusals above are attributable to the binding and to nothing else.
    const unboundUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: env.bucket, Key: keys.unbound }),
      { expiresIn: URL_TTL_SECONDS },
    );
    record(await put("E3_unbound_put_accepts_anything", unboundUrl, b, {}, "no checksum bound; body B"));

    // E4 — what S3 says it stored for E1. The checksum it enforced, read back.
    const e4 = await head("E4_stored_checksum_matches", client, env.bucket, keys.bound);
    record(
      e4.head !== undefined && e4.head.checksumSha256 !== hashA
        ? { ...e4, error: `stored checksum ${e4.head.checksumSha256 ?? "—"} ≠ declared ${hashA}` }
        : e4,
    );

    // E5 — required: SSE-KMS under a CMK, through the same kind of URL, with
    // the checksum header signed alongside the SSE headers.
    const e5put = await put("E5_sse_kms_via_presigned", await kmsUrl(), a,
      { [CHECKSUM_HEADER]: hashA, ...SSE_HEADERS }, "body A, header H(A), SSE-KMS headers");
    const e5head = ok(e5put.status)
      ? await head("E5_sse_kms_via_presigned", client, env.bucket, keys.kms)
      : null;
    const e5: Observation =
      e5head === null
        ? e5put
        : e5head.head === undefined
          ? { ...e5put, error: e5head.error }
          : { ...e5put, head: e5head.head, error: e5head.error };
    record(e5);

    // E8 — "with both in place": the KMS URL, given B with the header saying
    // H(A). Must be refused. Only meaningful if E5 worked, so it runs only then.
    if (ok(e5.status)) {
      record(
        await put("E8_sse_kms_substitution_refused", await kmsUrl(), b,
          { [CHECKSUM_HEADER]: hashA, ...SSE_HEADERS }, "body B, header H(A), SSE-KMS headers"),
      );
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
