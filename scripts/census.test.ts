/**
 * The census table adds up, and it is not maintained by hand.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The defect this replaces was visible without running anything. §7's table
 * stated its own total, listed its own rows, and the two did not agree:
 *
 *     rows                              1,824
 *     "everything else"                  ~346
 *                                      ------
 *                                        2,170
 *     stated total                       2,306
 *
 * A hundred and thirty-six tests, in a document the README says to read first,
 * for weeks. Six of the twenty rows were individually wrong as well — but that
 * needs a run to detect, and THIS did not. Nothing had ever added up the table
 * it was reading.
 *
 * So the arithmetic is asserted here, where it costs nothing, and the numbers
 * themselves come from `pnpm run census` rather than from a person's memory.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The tilde is the mechanism, and it is gone ────────────────────────────
 *
 * The old row said "everything else | ~346". A tilde absorbs any error: no
 * reader could tell 346 from 482, and no check could either, because the table
 * was not claiming to be exact. The generated figure is exact, and this file
 * fails if a tilde comes back.
 */

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CENSUS_BEGIN, CENSUS_END, countsFrom, tableFrom } from "./census.js";

const ROOT = resolve(join(import.meta.dirname, ".."));
const document = readFileSync(join(ROOT, "docs", "state-of-the-system.md"), "utf8");

/**
 * The census block, or the empty string when the markers are gone.
 *
 * It used to `expect` at module scope, and removing the marker text made the
 * whole FILE fail to collect — vitest reported "no tests", which fails the run
 * without saying why. That is the P47 mistake (a check that fails for a reason
 * it never states) inside the fix for a different one, so the absence is a
 * value here and a named test below.
 */
function censusSection(): string {
  const start = document.indexOf(CENSUS_BEGIN);
  const end = document.indexOf(CENSUS_END);
  if (start === -1 || end === -1 || end < start) return "";
  return document.slice(start, end);
}

interface Cell {
  readonly area: string;
  readonly tests: number;
}

function cellsIn(section: string): readonly Cell[] {
  const out: Cell[] = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("| ")) continue;
    if (line.startsWith("| Area") || line.startsWith("|---")) continue;
    const parts = line.split("|").map((p) => p.trim());
    // A two-column table: area, tests, area, tests.
    for (const [nameCell, countCell] of [
      [parts[1], parts[2]],
      [parts[3], parts[4]],
    ]) {
      if (nameCell === undefined || countCell === undefined) continue;
      if (nameCell === "" || countCell === "") continue;
      const tests = Number.parseInt(countCell, 10);
      if (Number.isNaN(tests)) continue;
      out.push({ area: nameCell.replace(/`/g, ""), tests });
    }
  }
  return out;
}

const section = censusSection();
const cells = cellsIn(section);

describe("the test census", () => {
  it("is still in the document, between its markers", () => {
    // First, and separately, because everything below reads this block — and a
    // missing marker must say "the marker is missing" rather than taking the
    // file down with it.
    expect(
      document.includes(CENSUS_BEGIN),
      "the census begin marker is gone — `pnpm run census` has nowhere to write",
    ).toBe(true);
    expect(document.includes(CENSUS_END), "the census end marker is gone").toBe(true);
    expect(section.length, "the census block is empty").toBeGreaterThan(100);
  });

  it("adds up to the total it states", () => {
    // ── The assertion that would have caught it, for free ────────────────
    //
    // The table stated 2,306 and its own contents came to 2,170. Adding up a
    // table one is about to publish is not a sophisticated check; it is the
    // one nobody wrote.
    const stated = /\*\*([\d,]+) tests\*\*/.exec(section)?.[1];
    expect(stated, "the census does not state a total").toBeDefined();
    const total = Number.parseInt((stated ?? "0").replace(/,/g, ""), 10);
    const summed = cells.reduce((sum, cell) => sum + cell.tests, 0);
    expect(
      summed,
      `the rows come to ${String(summed)} and the table says ${String(total)}`,
    ).toBe(total);
  });

  it("gives an exact figure for everything else, not an approximation", () => {
    // The tilde is what let 136 tests hide. "~346" cannot be wrong, which is
    // precisely the problem — a number that cannot be wrong cannot be checked.
    expect(section, "a tilde in the census makes the arithmetic unfalsifiable").not.toMatch(/~\s*\d/);
    const rest = cells.find((cell) => cell.area === "everything else");
    expect(rest, "the census must account for the areas too small to list").toBeDefined();
  });

  it("names only areas that exist", () => {
    // A row for a package that has been deleted or renamed would keep its old
    // count for ever, and the total would still add up.
    const missing = cells
      .filter((cell) => cell.area !== "everything else")
      .filter((cell) => !existsSync(join(ROOT, cell.area)))
      .map((cell) => cell.area);
    expect(missing, "the census names these and no such directory exists").toEqual([]);
  });

  it("is the generated table, not one edited by hand", () => {
    // The markers are the contract. Editing between them is allowed by nothing
    // and silently lost on the next `pnpm run census`, so the document says so
    // and this asserts it still does.
    expect(section).toContain("do not edit by hand");
    expect(section).toContain("pnpm run census");
  });

  it("groups a file by the workspace it lives in", () => {
    // The grouping rule, exercised on a synthetic report rather than the real
    // one — so this stays true when the suite changes, and so the arithmetic
    // above is checking a table built by the logic tested here.
    const report = JSON.stringify({
      testResults: [
        { name: `${ROOT}/packages/domain/src/machine.test.ts`, assertionResults: [1, 2, 3] },
        { name: `${ROOT}/packages/domain/src/events.test.ts`, assertionResults: [1, 2] },
        { name: `${ROOT}/apps/worker/src/worker.test.ts`, assertionResults: [1] },
        { name: `${ROOT}/scripts/journey.test.ts`, assertionResults: [1, 2, 3, 4] },
      ],
    });
    const { areas, total } = countsFrom(report);
    expect(total).toBe(10);
    expect(areas).toEqual([
      { area: "packages/domain", tests: 5 },
      { area: "scripts", tests: 4 },
      { area: "apps/worker", tests: 1 },
    ]);
  });

  it("renders a table whose rows and remainder sum to the total", () => {
    // The property the generator must hold, on numbers chosen so that the
    // threshold actually bites: two areas above it, one below, so "everything
    // else" is doing real work rather than being zero.
    const areas = [
      { area: "packages/big", tests: 100 },
      { area: "packages/medium", tests: 30 },
      { area: "packages/tiny", tests: 7 },
      { area: "packages/tinier", tests: 3 },
    ];
    const total = 140;
    const rendered = tableFrom(areas, total);
    const summed = cellsIn(rendered).reduce((sum, cell) => sum + cell.tests, 0);
    expect(summed, "the generator must produce a table that adds up").toBe(total);
    expect(rendered).toContain("everything else | 10");
    expect(rendered, "areas below the threshold are not given rows").not.toContain("packages/tiny`");
  });

  it("is reading a real census", () => {
    // The vacuity guard. An empty section, or a parse that found no cells,
    // would satisfy the arithmetic assertion trivially — 0 === 0.
    expect(cells.length, "the census parsed to no rows").toBeGreaterThan(10);
    expect(
      cells.reduce((sum, cell) => sum + cell.tests, 0),
      "the census parsed to no tests",
    ).toBeGreaterThan(1000);
  });
});

describe("a run that skipped tests is not a census (P225)", () => {
  // Twice on 2026-09-26 the census ran without the database variables in its
  // environment: 633 tests skipped, a table written, exit 0. A count of tests
  // that did not run is a count of nothing, and a check that says nothing
  // about it is indistinguishable from one that found nothing.
  it("counts the tests a run skipped", () => {
    const report = JSON.stringify({
      testResults: [
        {
          name: `${process.cwd()}/packages/interview/src/interview.test.ts`,
          assertionResults: [{ status: "passed" }, { status: "failed" }, { status: "skipped" }, { status: "pending" }, { status: "todo" }],
        },
      ],
    });
    const counts = countsFrom(report);
    expect(counts.total).toBe(5);
    expect(counts.skipped).toBe(3);
  });

  it("refuses to write the table over a run that skipped tests, and says which variables to set", () => {
    const raw = readFileSync(join(import.meta.dirname, "census.ts"), "utf8");
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const guard = source.indexOf("if (skipped > 0) {");
    const write = source.indexOf("writeFileSync(DOCUMENT");
    expect(guard, "the guard exists").toBeGreaterThan(-1);
    expect(guard, "and stands before the write").toBeLessThan(write);
    expect(source.slice(guard, write)).toContain("return;");
    expect(source.slice(guard, write)).toContain("AAS_TEST_DATABASE_URL");
  });
});

describe("a red run keeps its report (P209)", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // `runSuite` used to end in `finally { rmSync(directory) }`, so the one
  // artefact saying WHY a run failed was destroyed by the tool that made it —
  // every time, including the times it mattered.
  //
  // It cost us on 2026-09-25: a census went red on
  // `local-stack-journey.test.ts`, the report was gone before it could be
  // read, and the only honest thing to record was that we did not know what
  // failed. Vahid: *"you took an action that destroyed the evidence of what
  // you were investigating… Make the report directory survive by default so
  // the choice never arises again."*
  //
  // This reads the source, because the behaviour it guards happens inside a
  // process that runs the whole suite and cannot be invoked from within it.
  // A source assertion is weaker than a behavioural one and is said to be:
  // what it can prove is that the unconditional delete is gone and the
  // deletion is conditioned on a green run.
  // ═══════════════════════════════════════════════════════════════════════
  const raw = readFileSync(join(import.meta.dirname, "census.ts"), "utf8");
  // COMMENTS STRIPPED, and the first version of this test is why: it matched
  // its own explanation of the defect and went red against the fix. A check
  // that reads prose is a check that can pass or fail for the wrong reason.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("does not delete the report directory in a `finally`", () => {
    expect(source).not.toMatch(/finally\s*\{[^}]*rmSync/);
  });

  it("deletes it only when the run PASSED", () => {
    const deletes = [...source.matchAll(/rmSync\(/g)];
    expect(deletes, "exactly one place removes the directory").toHaveLength(1);
    const before = source.slice(0, deletes[0]?.index ?? 0);
    expect(before.slice(-120)).toContain("if (passed) {");
  });

  it("tells the reader where the kept report is, rather than leaving it to be found", () => {
    // A directory that survives but is never named is only marginally better
    // than one that is deleted: the next person still has to know to look.
    expect(source).toContain("The failing run's report is KEPT");
    expect(source, "and it names the path, not just the fact").toMatch(
      /The failing run's report is KEPT[^`]*\$\{out\}/,
    );
  });
});
