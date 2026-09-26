import { describe, expect, it } from "vitest";

import { verdictFrom } from "./named-tests.js";

describe("a run in which nothing ran is not green (P226)", () => {
  // Measured 2026-09-26: `vitest run <file> -t "NO SUCH TEST"` → 74 skipped,
  // exit 0. The third instrument of the week that could say green over
  // nothing (row 93); this one is read from vitest's own report.
  it("refuses a report where no test passed and none failed", () => {
    const verdict = verdictFrom(JSON.stringify({ numTotalTests: 74, numPassedTests: 0, numFailedTests: 0, numPendingTests: 74 }));
    expect(verdict).toEqual({ kind: "nothing_ran", skipped: 74 });
  });

  it("is green only when tests ran and all passed", () => {
    expect(verdictFrom(JSON.stringify({ numTotalTests: 3, numPassedTests: 3, numFailedTests: 0, numPendingTests: 0 }))).toEqual({ kind: "green", passed: 3 });
    expect(verdictFrom(JSON.stringify({ numTotalTests: 3, numPassedTests: 2, numFailedTests: 1, numPendingTests: 0 }))).toEqual({ kind: "red", passed: 2, failed: 1 });
  });

  it("reads a report with the counts missing as nothing ran, not as green", () => {
    expect(verdictFrom("{}")).toEqual({ kind: "nothing_ran", skipped: 0 });
  });
});
