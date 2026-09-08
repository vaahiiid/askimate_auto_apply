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

  it("reports the repository's own schedule as having ONE row still blocking", async () => {
    // ── Rewritten in P44, and worth saying why ─────────────────────────
    //
    // This asserted "No student document can enter the vault" when P43 wrote
    // it, because no period was set. Vahid answered all twelve rows on
    // 2026-09-07 and that sentence stopped being true — so the assertion moves
    // to what IS true now rather than being deleted, which would quietly drop
    // the only test that reads the repository's real configuration.
    const out = await report([]);
    expect(out).toContain("1 question(s) recorded as unresolved");
    expect(out, "and it is row 12, out of scope by ADR-0021").toContain("bank_statement");
  }, 120_000);
});

describe("the schedule on disk says what was determined", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // The configuration is the record. Vahid answered all twelve B1 rows and
  // B5 on 2026-09-07, and a determination that lives only in an ADR is the
  // written rule this repository keeps replacing with a check.
  //
  // Read through the REAL script, so the file is parsed by the thing that
  // parses it in production rather than by a test's own reader.
  // ═══════════════════════════════════════════════════════════════════════
  it("carries eleven periods, one still-blocking row, and the four determinations", async () => {
    const out = await report([]);

    // Ten of eleven, not eleven of twelve: `national_id` left the supported
    // types in ADR-0089 and took its pair with it. The PERIOD it was given on
    // 2026-09-07 is still in the approved schedule and is reported as
    // determined-and-out-of-scope, which the next test checks.
    expect(out, "ten rows determined").toContain("10 of 11 pairs have a RETENTION POLICY");
    expect(out, "row 12 stays blocking").toContain("bank_statement:financial_evidence");

    for (const id of [
      "legal_claims_purpose",
      "document_custody_model",
      "purpose_alive_while_applying",
      "deletion_cascade",
      "expiry_is_the_student_s_choice",
    ]) {
      expect(out, `${id} is recorded`).toContain(id);
    }
    expect(out, "and named to a determiner").toContain("Vahid Mohammadi");
  }, 120_000);

  it("runs the reusable documents from LAST USE, not from a submission", async () => {
    // B5 = hold. A clock started at `submission_confirmed` would delete a
    // passport thirty days after the first application and ask for it again on
    // the second — the reuse mechanic destroyed by its own retention rule.
    const out = await report([]);
    expect(out).toContain("365d after last_used");
    expect(out, "nothing reusable runs from a submission").not.toMatch(
      /passport \/ identity_verification\s+\S*\d+d after submission_confirmed/,
    );
  }, 120_000);

  it("shows the two obligations, with an owner and a stage", async () => {
    const out = await report([]);
    expect(out).toContain("tell_the_student_about_the_referee");
    expect(out).toContain("read_the_test_provider_terms");
    expect(out).toContain("before: the first real submission");
  }, 120_000);

  it("does NOT say a resolved period is permission to store", async () => {
    // The half-truth P44 created and had to close: `assertStorable` also
    // requires a registered lawful basis (ADR-0022), which this report does
    // not read. "10 of 11 could be stored today" would read as permission it
    // cannot grant.
    const out = await report([]);
    expect(out).toContain("A retention policy is not permission to store");
    expect(out).toContain("ADR-0022");
  }, 120_000);

  it("reports a period determined for a type that has since left scope", async () => {
    // `AAS-RET-B1-02` — a period Vahid determined and approved by name on
    // 2026-09-07 for `national_id`, a document type removed on 2026-09-08
    // (ADR-0089). The determination did not become WRONG, it became MOOT.
    //
    // The schedule file is deliberately not edited: an approved version is a
    // record, superseded rather than rewritten, which is what `validateHistory`
    // exists for. Dropping the row silently would lose the fact; refusing to
    // load it would make a correct historical record unreadable.
    const out = await report([]);
    expect(out).toContain("AAS-RET-B1-02");
    expect(out).toContain("Determined, and now out of scope");
    expect(out).toContain("The record is kept as made");
  }, 120_000);

  it("does NOT accept a document type that does not exist", async () => {
    // The reason this needed a real check rather than a filter. The parser used
    // to write `policy["documentType"] as DocumentType` — a cast, which accepts
    // ANY string in the file and types it as a lie. A schedule naming a type
    // the system does not have would have loaded, validated, and reported as a
    // configured period.
    //
    // Asserted on a fixture rather than on the repository's own schedule,
    // because `AAS-RET-B1-02` alone cannot fail this: `national_id` is not in
    // `PAIRS`, so the cast and the check print the same table for it. A
    // demonstration that cannot fail is not evidence (ADR-0072).
    const invented = JSON.parse(
      JSON.stringify(leaningOnTheLimitationPeriod(false)),
    ) as { policies: { documentType: string; policyReference: string }[] };
    invented.policies[0]!.documentType = "driving_licence";
    invented.policies[0]!.policyReference = "FIXTURE-NOT-A-TYPE";

    const out = await report([invented]);
    expect(out).toContain("Determined, and now out of scope");
    expect(out).toContain("FIXTURE-NOT-A-TYPE");
    expect(out, "0 policies once the invented row is set aside").toContain("0 policies");
  }, 120_000);

  it("does NOT still call B2 undetermined — it was answered on 2026-09-08", async () => {
    // The staleness this phase found by reading its own output. B2 stood open
    // from P31 to P54 and this line said so; P54 answered it and left the line
    // behind. A report claiming a decision is outstanding after it is made is
    // the exact defect P37 spent a phase cataloguing, produced by the fix for
    // the previous one.
    const out = await report([]);
    expect(out).not.toContain("NOT yet determined");
    expect(out).toContain("DETERMINED on");
  }, 120_000);
});
