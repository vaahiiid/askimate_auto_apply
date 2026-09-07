/**
 * The retention status report, run as a real process against real schedules.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * P43. The claims determination — documents do NOT rely on "establishing,
 * exercising or defending legal claims"; the audit record does — is enforced
 * by `validateSchedule`, which has its own unit tests. What those cannot reach
 * is the READER: a declaration is only enforceable if a schedule that omits it
 * is treated as suspect rather than as consent.
 *
 * That default was measured, not assumed. With the reader written the other
 * way — `=== true` rather than `!== false` — a schedule that keeps a passport
 * for 2,190 days on the strength of the limitation period, and simply does not
 * mention it, printed "No contradictions, no placeholder bases." The fixture
 * below is that schedule.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "retention-status.ts");

async function report(schedules: readonly unknown[]): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "retention-"));
  const files = schedules.map((schedule, index) => {
    const file = join(directory, `v${String(index)}.json`);
    writeFileSync(file, JSON.stringify(schedule), "utf8");
    return file;
  });
  try {
    return await new Promise<string>((resolve) => {
      const child = spawn("npx", ["tsx", SCRIPT, ...files], { cwd: ROOT });
      let out = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.on("close", () => {
        resolve(out);
      });
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const DETERMINATION = {
  id: "legal_claims_purpose",
  question: "Are we relying on defending legal claims as a retention purpose?",
  answer: "No for documents. Yes for the audit record.",
  reasoning:
    "What the student authorised is provable from the preview hash, the authorisation text and " +
    "the transmission record, without the document itself.",
  determinedBy: "Vahid Mohammadi",
  determinedAt: "2026-09-07T00:00:00Z",
};

/** A passport kept for the six-year limitation period. */
function leaningOnTheLimitationPeriod(declare: boolean | undefined): unknown {
  return {
    version: "fixture",
    approvedAt: "2026-09-07T00:00:00Z",
    approvedBy: "test fixture",
    effectiveFrom: "2026-09-07T00:00:00Z",
    determinations: [DETERMINATION],
    unresolved: [],
    policies: [
      {
        documentType: "passport",
        purpose: "identity_verification",
        trigger: "submission_confirmed",
        retainForDays: 2190,
        action: "delete",
        erasureBehaviour: "full",
        policyReference: "FIXTURE-1",
        reviewBy: "2027-09-07T00:00:00Z",
        basis: {
          kind: "policy_decision",
          statement: "Kept for the limitation period so a claim can be defended six years later.",
          authoritativeSource: "Limitation Act 1980 s.5",
          verifiedBy: "somebody",
          verifiedAt: "2026-09-07T00:00:00Z",
          ...(declare === undefined ? {} : { reliesOnLegalClaims: declare }),
        },
      },
    ],
  };
}

describe("what the report does with the claims determination", () => {
  it("REFUSES a document period that declares it", async () => {
    const out = await report([leaningOnTheLimitationPeriod(true)]);
    expect(out).toContain("relies on defending legal claims");
    expect(out, "and says why, not just that").toContain("provable from the preview hash");
  }, 120_000);

  it("REFUSES one that quietly omits the declaration", async () => {
    // The measured regression. A missing declaration is a schedule nobody has
    // thought about, and reading it as "no" would let exactly the period this
    // determination exists to prevent pass unremarked.
    const out = await report([leaningOnTheLimitationPeriod(undefined)]);
    expect(out).toContain("relies on defending legal claims");
  }, 120_000);

  it("accepts a document period that declares it does NOT rely on it", async () => {
    const out = await report([leaningOnTheLimitationPeriod(false)]);
    expect(out).not.toContain("relies on defending legal claims");
    expect(out, "the vacuity guard — it is not refusing everything").toContain(
      "No contradictions",
    );
  }, 120_000);

  it("PRINTS the determination, with who decided it and why", async () => {
    // A cross-cutting answer nobody sees is the written rule this replaces.
    const out = await report([leaningOnTheLimitationPeriod(false)]);
    expect(out).toContain("legal_claims_purpose");
    expect(out).toContain("Vahid Mohammadi");
    expect(out).toContain("provable from the preview hash");
  }, 120_000);

  it("reports the repository's own schedule as storing nothing", async () => {
    // The state P43 leaves the system in, asserted rather than assumed: a
    // determination was recorded and NO period was set, so nothing is storable.
    const out = await report([]);
    expect(out).toContain("No student document can enter the vault");
  }, 120_000);
});
