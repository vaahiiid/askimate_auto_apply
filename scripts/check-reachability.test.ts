/**
 * The reachability check must actually be able to fail.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A check that cannot fail is the shape P37 found twice: `pnpm run walkthrough`
 * printed nine refusals and exited 0, and `decideReapplication` was called by a
 * comment. This file runs the REAL script in a REAL process, against a REAL
 * mutation of the register, and asserts what it says.
 *
 * Three mutations, one per way the register can be wrong:
 *
 *   1. A capability the register calls ENFORCED, with no production caller.
 *      This is P37's finding, and the whole reason the check exists.
 *   2. A capability on the reviewed unreachable list that HAS one. A stale
 *      allow-list is what hides the next finding, so it is a failure and not a
 *      quiet promotion.
 *   3. A register entry naming a file that no longer declares the symbol. The
 *      register describing a repository that has moved on is the same class of
 *      defect one level up.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "check-reachability.ts");

interface Run {
  readonly code: number | null;
  readonly out: string;
}

/** Runs a copy of the script, so the repository's own file is never edited. */
async function run(source: string): Promise<Run> {
  const directory = mkdtempSync(join(tmpdir(), "reachability-"));
  const copy = join(directory, "check-reachability.ts");
  writeFileSync(copy, source, "utf8");
  try {
    return await new Promise<Run>((resolve) => {
      // From the repository root, because the script resolves everything from
      // `process.cwd()` — running it from anywhere else would measure nothing.
      const child = spawn("npx", ["tsx", copy], { cwd: ROOT });
      let out = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.on("close", (code) => {
        resolve({ code, out });
      });
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function theScript(): string {
  return readFileSync(SCRIPT, "utf8");
}

describe("the reachability check", () => {
  it("passes on the repository as it stands", async () => {
    const { code, out } = await run(theScript());
    expect(code, out).toBe(0);
    expect(out).toContain("Reachability check passed");
  }, 120_000);

  it("FAILS when something the register calls enforced has no production caller", async () => {
    // ── The P37 finding, reproduced ─────────────────────────────────────
    //
    // `purgeContents` is genuinely unreachable — the vault holds nothing,
    // because nothing can put anything into it. Claiming it is enforced is
    // exactly the false record every phase from P31 onwards has been finding
    // by hand, and the check must say so and name the promise.
    // Matched by SHAPE rather than by the exact text of the entry.
    //
    // This used to paste `purgeContents`'s whole `status` block as a literal,
    // and P44 broke it by editing the `closedBy` reason — B1 was decided, so
    // the reason naming B1 as the blocker had become false. The guard below
    // caught that honestly (the mutation no longer applied), but a fixture
    // that must be re-pasted every time a reviewed reason is corrected is a
    // fixture that discourages correcting them.
    const script = theScript();
    const entry = /(symbol: "purgeContents",[\s\S]*?)status: \{[\s\S]*?\n {4}\},/;
    expect(script, "the register still carries the entry this test mutates").toMatch(entry);
    const mutated = script.replace(entry, '$1status: { kind: "reachable" },');
    expect(mutated, "the mutation applied").not.toBe(script);

    const { code, out } = await run(mutated);
    expect(code, out).toBe(1);
    expect(out).toContain("purgeContents");
    expect(out).toContain("NOTHING IN PRODUCTION CALLS IT");
    // It names the promise, so the reader knows what is now untrue rather than
    // only which symbol moved.
    expect(out).toContain("destroyed when its retention schedule expires");
  }, 120_000);

  it("FAILS when a reviewed-unreachable entry acquires a production caller", async () => {
    // The allow-list is not a place things go to be forgotten. `noticeFor` has
    // a real caller in the run driver; calling it unreachable is a register
    // that has stopped describing the system, and the check refuses it.
    const mutated = theScript().replace(
      `    record: "ADR-0071",
    promise: "the only constructor for a specialist notice, and it reads named fields",
    status: { kind: "reachable" },`,
      `    record: "ADR-0071",
    promise: "the only constructor for a specialist notice, and it reads named fields",
    status: {
      kind: "unreachable",
      reason: "a claim this test exists to have refused",
      closedBy: "nothing — the caller is already there",
    },`,
    );
    expect(mutated, "the mutation applied").not.toBe(theScript());

    const { code, out } = await run(mutated);
    expect(code, out).toBe(1);
    expect(out).toContain("noticeFor is on the reviewed unreachable list");
    expect(out).toContain("run-driver.ts");
    expect(out).toContain("a stale allow-list is what hides the next one");
  }, 120_000);

  it("FAILS when the register names a file that does not declare the symbol", async () => {
    const mutated = theScript().replace(
      `    declaredIn: ["packages/domain/src/reapplication.ts"],
    record: "ADR-0006, ADR-0072",`,
      `    declaredIn: ["packages/domain/src/tasks.ts"],
    record: "ADR-0006, ADR-0072",`,
    );
    expect(mutated, "the mutation applied").not.toBe(theScript());

    const { code, out } = await run(mutated);
    expect(code, out).toBe(1);
    expect(out).toContain("which the register says declares it");
  }, 120_000);

  it("does not count a comment, an import or a re-export as a caller", async () => {
    // ── Measured, because the first version of the check got it wrong ────
    //
    // It counted the WORD `recommendWait` in three doc comments as three
    // production callers. A reachability check that reports a comment as a
    // call is the confident wrong answer it exists to prevent, so the
    // stripping is asserted here rather than trusted.
    //
    // `assessUsability` is re-exported by `packages/domain/src/index.ts` and
    // named in prose in several places; it stays unreachable, and that is only
    // true if barrels and comments are excluded.
    const { code, out } = await run(theScript());
    expect(code, out).toBe(0);
    expect(out).toContain("assessUsability");
    expect(out).toMatch(/assessUsability.*unreachable/);
  }, 120_000);

  it("runs inside pnpm run verify and in CI, so it cannot be skipped", () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(manifest.scripts?.["reachability"]).toContain("check-reachability.ts");
    expect(manifest.scripts?.["verify"]).toContain("pnpm run reachability");
    expect(readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8")).toContain(
      "pnpm run reachability",
    );
  });
});
