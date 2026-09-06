/**
 * The walkthrough demonstrates what it says it demonstrates.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0072. `pnpm run walkthrough` is what the README calls "the fastest way to
 * see what has been built", and until P37 it printed whatever the domain did
 * and exited 0 either way. When ADR-0058 changed where a case opens, and when
 * capturing an authorisation became the thing that MOVES a case rather than a
 * step before one, NINE consecutive steps started printing "REFUSED" — and
 * nothing failed, because there was nothing to fail.
 *
 * This is the check that makes the script's own expectations load-bearing. It
 * runs the real thing, in a real process, and fails on a non-zero exit — which
 * the script now produces when any step's outcome disagrees with the story it
 * tells about that step.
 *
 * It is deliberately NOT a re-implementation of the walkthrough's assertions
 * here: the expectations belong next to the narrative they are about, where
 * somebody editing the story has to look at them.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("the walkthrough", () => {
  it("still does everything it claims, and exits 0", () => {
    const root = join(import.meta.dirname, "..");
    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", join(root, "scripts", "walkthrough.ts")],
      { cwd: root, encoding: "utf8", timeout: 120_000 },
    );

    // The script prints its own diagnosis of what broke, so surface it rather
    // than a bare exit code: "expected 1 to be 0" would send a reader back to
    // run it by hand to find out what happened.
    expect(
      run.status,
      `the walkthrough failed:\n${run.stderr}\n${run.stdout.slice(-2000)}`,
    ).toBe(0);

    // A run that produced nothing is not a passing run — a crash before the
    // first heading would also exit 0 under some shells.
    expect(run.stdout).toContain("The case can answer, from stored data alone");
    expect(run.stdout).toContain("CONFIRMED");
  }, 130_000);
});
