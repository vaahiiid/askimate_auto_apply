/**
 * The S3 checksum verification cannot say VERIFIED by accident.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `verify-s3-checksum` is the experiment ADR-0092 conditions the port on:
 * Vahid — *"Verify the S3 checksum enforcement against a real bucket BEFORE
 * reshaping the port around it."* It cannot run here: this sandbox has no
 * bucket and no credentials, by design (AWS spend is his act).
 *
 * What CAN be checked without S3 is the judgement — the function that turns
 * observations into VERIFIED / REFUTED / NOT CHECKED — and that is the part
 * that has to be right, because it is the part a person will read and act on.
 * A judge that said VERIFIED when only the refusal was seen would be ADR-0072's
 * demonstration that cannot fail, and it would be the one deciding whether the
 * gates-before-bytes property holds.
 *
 * The other thing checked here is the no-bucket path: the command must say
 * NOT CHECKED, loudly, and exit non-zero. `verify-bedrock` set that rule and
 * `demonstrations.test.ts` lists both as guarded elsewhere — this is the
 * elsewhere.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { Observation } from "./verify-s3-checksum.js";
import { judge } from "./verify-s3-checksum.js";

const ROOT = resolve(join(import.meta.dirname, ".."));
const SCRIPT = join(ROOT, "scripts", "verify-s3-checksum.ts");

function obs(
  id: Observation["id"],
  status: number | null,
  extra: Partial<Observation> = {},
): Observation {
  return { id, status, s3Code: null, error: null, ...extra };
}

/** The pattern that proves the property: bound accepts A, bound refuses B, unbound accepts B, checksum stored. */
const PROVEN: readonly Observation[] = [
  obs("E1_correct_bytes_bound", 200),
  obs("E2_same_length_substitution_bound", 400, { s3Code: "XAmzContentChecksumMismatch" }),
  obs("E3_unbound_put_accepts_anything", 200),
  obs("E4_stored_checksum_matches", 200, {
    head: { checksumSha256: "abc=", serverSideEncryption: null, kmsKeyId: null },
  }),
];

describe("the judgement", () => {
  it("says VERIFIED only for the full pattern", () => {
    expect(judge(PROVEN).binding).toBe("VERIFIED");
  });

  it("says REFUTED the moment S3 accepts the substituted body — whatever else happened", () => {
    // The answer Vahid asked to be told before building. One observation is
    // enough: if a body that does not hash to the declared value was stored,
    // the property does not hold.
    const accepted = PROVEN.map((o) =>
      o.id === "E2_same_length_substitution_bound" ? obs(o.id, 200) : o,
    );
    const verdict = judge(accepted);
    expect(verdict.binding).toBe("REFUTED");
    expect(verdict.bindingReason).toMatch(/Do not reshape the port/);
  });

  it("does NOT say VERIFIED when the control experiment failed", () => {
    // ── The vacuity guard ────────────────────────────────────────────────
    //
    // E2's refusal on its own proves nothing: a wrong bucket policy, an
    // expired credential or a mistyped key also produce a 4xx. Only when an
    // UNBOUND url accepts the same bytes is the refusal attributable to the
    // binding. Without E3 succeeding, "S3 refused" is a result that cannot
    // fail, and ADR-0072 says what that is worth.
    const controlFailed = PROVEN.map((o) =>
      o.id === "E3_unbound_put_accepts_anything" ? obs(o.id, 403, { s3Code: "AccessDenied" }) : o,
    );
    expect(judge(controlFailed).binding).toBe("NOT CHECKED");
  });

  it("does NOT say VERIFIED when the bound URL never worked for the RIGHT bytes", () => {
    // If E1 fails, E2's refusal may be the same failure wearing a different
    // body. A binding that refuses everything is not a binding.
    const e1Failed = PROVEN.map((o) =>
      o.id === "E1_correct_bytes_bound" ? obs(o.id, 403, { s3Code: "SignatureDoesNotMatch" }) : o,
    );
    expect(judge(e1Failed).binding).toBe("NOT CHECKED");
  });

  it("does NOT say VERIFIED when an experiment did not complete", () => {
    const noResponse = PROVEN.map((o) =>
      o.id === "E2_same_length_substitution_bound"
        ? obs(o.id, null, { error: "TypeError: fetch failed" })
        : o,
    );
    const verdict = judge(noResponse);
    expect(verdict.binding).toBe("NOT CHECKED");
    expect(verdict.bindingReason).toMatch(/not a pass/);
  });

  it("does NOT say VERIFIED when S3 stored a different checksum from the one declared", () => {
    // E4 is the read-back. If S3 enforced one value and recorded another, the
    // experiment has found something and the honest verdict is not "verified".
    const mismatch = PROVEN.map((o) =>
      o.id === "E4_stored_checksum_matches"
        ? { ...o, error: "stored checksum xyz= ≠ declared abc=" }
        : o,
    );
    expect(judge(mismatch).binding).toBe("NOT CHECKED");
  });

  it("says NOT CHECKED with nothing at all — never a default pass", () => {
    expect(judge([]).binding).toBe("NOT CHECKED");
  });

  it("keeps SSE-KMS a separate verdict, NOT CHECKED unless it was tried", () => {
    // Two different facts. A verified binding with an untried KMS path must
    // not read as "encryption verified", and a refused KMS path must not
    // drag the binding verdict down with it.
    expect(judge(PROVEN).sseKms).toBe("NOT CHECKED");
    // Untried is not "optional" any more — Vahid, 2026-09-09 — and the reason
    // must say so rather than read as a harmless omission.
    expect(judge(PROVEN).sseKmsReason).toMatch(/required/);

    const kmsOk: Observation[] = [
      ...PROVEN,
      obs("E5_sse_kms_via_presigned", 200, {
        head: { checksumSha256: "abc=", serverSideEncryption: "aws:kms", kmsKeyId: "arn:aws:kms:eu-west-2:000000000000:key/example" },
      }),
    ];
    expect(judge(kmsOk).sseKms).toBe("VERIFIED");

    const kmsRefused: Observation[] = [
      ...PROVEN,
      obs("E5_sse_kms_via_presigned", 403, { s3Code: "AccessDenied" }),
    ];
    expect(judge(kmsRefused).sseKms).toBe("REFUTED");
    expect(judge(kmsRefused).binding, "a KMS refusal does not touch the binding verdict").toBe(
      "VERIFIED",
    );
  });

  it("names a KMS refusal as a DIFFERENT problem from the binding, not folded in", () => {
    // Vahid: "If the SSE-KMS half is REFUTED, that is a different problem and
    // I want it named as such rather than folded in." The reason is the text
    // a person reads, so the naming is asserted on the reason, and the
    // binding's reason must not absorb it.
    const kmsRefused: Observation[] = [
      ...PROVEN,
      obs("E5_sse_kms_via_presigned", 403, { s3Code: "AccessDenied" }),
    ];
    const verdict = judge(kmsRefused);
    expect(verdict.sseKmsReason).toMatch(/DIFFERENT PROBLEM/);
    expect(verdict.sseKmsReason).toMatch(/ADR-0010/);
    expect(verdict.bindingReason).not.toMatch(/KMS/);
  });
});

function runCommand(env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const child = spawn("npx", ["tsx", SCRIPT], { cwd: ROOT, env: { ...process.env, ...env } });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("close", (code) => done({ code, out }));
  });
}

describe("the command, with no bucket configured", () => {
  it("says NOT CHECKED, points at the provisioning request, and exits non-zero", async () => {
    // A verification that could not run must not look like one that passed —
    // `verify-bedrock`'s rule. And it must not write a record, because a
    // record of a run that did not happen is the false-record shape this
    // repository keeps finding.
    const result = await runCommand({ AAS_S3_VERIFY_BUCKET: "", AAS_S3_VERIFY_KMS_KEY_ID: "" });
    expect(result.code).toBe(1);
    expect(result.out).toContain("NOT CHECKED");
    expect(result.out).toContain("This is not a pass");
    expect(result.out).toContain("provisioning-request-s3-verification.md");
    expect(result.out).not.toContain("record:");
  }, 60_000);
});

describe("the command, with a bucket but no KMS key", () => {
  it("REFUSES to run half the experiment, sends nothing to AWS, and exits non-zero", async () => {
    // The KMS half is required (Vahid, 2026-09-09). A run that produced a
    // binding verdict and left KMS untried would be half an experiment that
    // reads as the whole. So it refuses BEFORE any request — which is also
    // what makes this test safe to run anywhere: the bucket name below is
    // never sent to anything, and the assertion on "Nothing was sent" is
    // backed by the refusal happening before a client exists.
    const result = await runCommand({
      AAS_S3_VERIFY_BUCKET: "not-a-bucket-and-never-contacted",
      AAS_S3_VERIFY_KMS_KEY_ID: "",
      AWS_ACCESS_KEY_ID: "",
      AWS_SECRET_ACCESS_KEY: "",
      AWS_SESSION_TOKEN: "",
    });
    expect(result.code).toBe(1);
    expect(result.out).toContain("required");
    expect(result.out).toContain("Nothing was sent to AWS");
    expect(result.out).toContain("NOT CHECKED");
    expect(result.out).not.toContain("record:");
  }, 60_000);
});

describe("the command, with a bucket and a key but no credential of its own", () => {
  it("REFUSES before any request, and does not fall back to AWS_*", async () => {
    // The sandbox sets placeholder AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
    // of its own, and what wins when the environment sets them too is not
    // documented. So the credential lives under names nothing else sets, all
    // three parts, and the SDK's default chain is never consulted. Here AWS_*
    // is deliberately populated with junk: if the script fell back to it, it
    // would get past the refusal and reach STS.
    const result = await runCommand({
      AAS_S3_VERIFY_BUCKET: "not-a-bucket-and-never-contacted",
      AAS_S3_VERIFY_KMS_KEY_ID: "arn:aws:kms:eu-west-2:000000000000:key/never-contacted",
      AAS_S3_VERIFY_ACCESS_KEY_ID: "",
      AAS_S3_VERIFY_SECRET_ACCESS_KEY: "",
      AAS_S3_VERIFY_SESSION_TOKEN: "",
      AWS_ACCESS_KEY_ID: "AKIAJUNKJUNKJUNKJUNK",
      AWS_SECRET_ACCESS_KEY: "junk",
      AWS_SESSION_TOKEN: "junk",
    });
    expect(result.code).toBe(1);
    expect(result.out).toContain("AAS_S3_VERIFY_SESSION_TOKEN");
    expect(result.out).toContain("Nothing was sent to AWS");
    expect(result.out).not.toContain("Identity");
    expect(result.out).not.toContain("record:");
  }, 60_000);
});
