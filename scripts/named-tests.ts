/**
 * Runs a named part of the suite and refuses to call it green when nothing ran.
 *
 * P226. `vitest run <file> -t "<name>"` with a name that matches nothing skips
 * every test in the file and exits 0. Measured on 2026-09-26: `-t "NO SUCH
 * TEST"` against the interview suite printed `74 skipped` and exit 0. A phase
 * that runs its new tests by name reads that as green unless a person reads
 * the passed count, and a check whose guard is a person's eye is the class
 * of instrument that lied twice this week (row 93): the red CI nobody read,
 * the census that counted a run with 633 tests skipped.
 *
 * So: the same vitest run, with the JSON report read afterwards. Zero tests
 * executed — none passed and none failed — is a refusal with its own words,
 * exit 1, whatever vitest said. A red run keeps its report (P209).
 *
 *   pnpm run test:named -- --project unit packages/interview/src/interview.test.ts -t "P225"
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Verdict =
  | { readonly kind: "green"; readonly passed: number }
  | { readonly kind: "red"; readonly passed: number; readonly failed: number }
  | { readonly kind: "nothing_ran"; readonly skipped: number };

/** What the run proved, from vitest's own JSON report. Pure, so it is testable. */
export function verdictFrom(report: string): Verdict {
  const parsed = JSON.parse(report) as {
    numPassedTests?: number;
    numFailedTests?: number;
    numPendingTests?: number;
    numTotalTests?: number;
  };
  const passed = parsed.numPassedTests ?? 0;
  const failed = parsed.numFailedTests ?? 0;
  if (passed + failed === 0) {
    return { kind: "nothing_ran", skipped: parsed.numPendingTests ?? parsed.numTotalTests ?? 0 };
  }
  return failed > 0 ? { kind: "red", passed, failed } : { kind: "green", passed };
}

function main(args: readonly string[]): void {
  const directory = mkdtempSync(join(tmpdir(), "named-tests-"));
  const out = join(directory, "results.json");
  let exit = 0;
  try {
    execFileSync(
      "npx",
      ["vitest", "run", ...args, "--reporter=default", "--reporter=json", `--outputFile=${out}`],
      { stdio: "inherit" },
    );
  } catch (error) {
    exit = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 1;
  }
  if (!existsSync(out)) {
    console.error("\nNO REPORT — vitest produced nothing to read, so nothing is proven.");
    process.exitCode = 1;
    return;
  }
  const verdict = verdictFrom(readFileSync(out, "utf8"));
  if (verdict.kind === "nothing_ran") {
    console.error(
      `\nNOTHING RAN — ${String(verdict.skipped)} tests skipped and none executed. The name or file ` +
        `matched no test, so this run proves nothing; it is not green. Report kept at ${out}`,
    );
    process.exitCode = 1;
    return;
  }
  if (verdict.kind === "red") {
    console.error(`\nRED — ${String(verdict.failed)} failed, ${String(verdict.passed)} passed. Report kept at ${out}`);
    process.exitCode = exit === 0 ? 1 : exit;
    return;
  }
  console.log(`\nGREEN — ${String(verdict.passed)} tests ran and passed.`);
  rmSync(directory, { recursive: true, force: true });
}

const invokedDirectly = process.argv[1]?.endsWith("named-tests.ts") ?? false;
// `pnpm run test:named -- …` hands the `--` through; vitest would read it as
// the end of its options and run the whole suite in every lane.
if (invokedDirectly) main(process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--")));
