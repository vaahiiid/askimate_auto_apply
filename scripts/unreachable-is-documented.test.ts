/**
 * The enforced register and the document a reader is sent to must agree.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * P39 made the build ask *"does anything in production call this?"* and the
 * register in `check-reachability.ts` has answered it every phase since. What
 * nothing asked is whether the DOCUMENT saying the same thing to a person still
 * matches — and `docs/state-of-the-system.md` is not incidental prose, it is
 * what the README says to read first.
 *
 * It had drifted, in both directions at once, and P48 found it:
 *
 *   `checkMinorGate` was in the register and in NO row of the document.
 *     One of the seven, guarding a MANDATORY-REVIEW category (ADR-0011,
 *     minors), and a reader of the standing account would not have known it
 *     was unenforced.
 *
 *   `packages/notify` was under the heading "Declared but unreachable" with a
 *     cell that began "Reachable."
 *     A row that contradicts the heading it sits under is worse than a missing
 *     row: it reads as reviewed.
 *
 * Neither is a code defect and neither would ever have failed a build. That is
 * the argument for this file: the register is checked and the prose was not, so
 * the prose is where a false record now accumulates. Seven phases of finding
 * records that assert what production does not do, and the record doing it
 * this time is the one describing the check.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this does not simply generate the table ────────────────────────────
 *
 * The generated version would be a worse document. "Why it is kept" is a
 * judgement — ADR-0019's constraint-before-the-thing, ADR-0071's refusal to add
 * a caller over unreachable code — and a generator would either drop it or
 * force it into the register, which is a checker and not a place to argue.
 *
 * So the document keeps its prose and loses only the freedom to DISAGREE: the
 * set of symbols in its enforced-register table must equal the register's, both
 * directions, and a symbol the register calls reachable may not appear there at
 * all.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CAPABILITIES } from "./check-reachability.js";

const ROOT = resolve(join(import.meta.dirname, ".."));
const DOCUMENT = join(ROOT, "docs", "state-of-the-system.md");

/** The heading of the table that mirrors the register, and the one after it. */
const TABLE_A_HEADING = "#### A · The enforced register";
const TABLE_B_HEADING = "#### B · Unreachable in ways the register does not track";

const document = readFileSync(DOCUMENT, "utf8");

function sectionBetween(from: string, to: string): string {
  const start = document.indexOf(from);
  const end = document.indexOf(to);
  expect(start, `"${from}" is missing from state-of-the-system.md`).toBeGreaterThan(-1);
  expect(end, `"${to}" is missing from state-of-the-system.md`).toBeGreaterThan(start);
  return document.slice(start, end);
}

/**
 * The symbols a markdown table names in its FIRST column.
 *
 * Deliberately the first cell only. A capability mentioned in a reason — as
 * `suggestsMinority` is, in `checkMinorGate`'s — is being contrasted, not
 * listed, and counting it would make the check agree with a table that merely
 * talks about the right things.
 */
function symbolsListedIn(section: string): readonly string[] {
  return section
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => line.split("|")[1]?.trim() ?? "")
    .map((cell) => /^`([^`]+)`/.exec(cell)?.[1] ?? "")
    .filter((symbol) => symbol !== "")
    .sort();
}

const REGISTER_UNREACHABLE = CAPABILITIES.filter((c) => c.status.kind === "unreachable")
  .map((c) => c.symbol)
  .sort();

const REGISTER_REACHABLE = CAPABILITIES.filter((c) => c.status.kind === "reachable").map(
  (c) => c.symbol,
);

const tableA = sectionBetween(TABLE_A_HEADING, TABLE_B_HEADING);

describe("the unreachable register and the document that describes it", () => {
  it("names every capability the register calls unreachable", () => {
    // The `checkMinorGate` direction. A reader of the standing account must be
    // able to see everything the build knows is unenforced — most of all the
    // ones guarding a mandatory-review category.
    const listed = symbolsListedIn(tableA);
    const missing = REGISTER_UNREACHABLE.filter((symbol) => !listed.includes(symbol));
    expect(
      missing,
      "the register calls these unreachable and the document does not mention them — " +
        "a reader would believe they are enforced",
    ).toEqual([]);
  });

  it("names NOTHING the register does not", () => {
    // The other direction, and not symmetric with the first: a row here for a
    // capability the register never entered would be a claim nothing checks,
    // which is the state the whole register exists to end.
    const listed = symbolsListedIn(tableA);
    const stale = listed.filter((symbol) => !REGISTER_UNREACHABLE.includes(symbol));
    expect(
      stale,
      "these are in the document's enforced-register table and not in the register",
    ).toEqual([]);
  });

  it("does not present an ENFORCED capability as unreachable", () => {
    // `recommendWait` is the live example and the reason table B exists: the
    // symbol is enforced, and it is one BRANCH of it that cannot be reached.
    // Listing the symbol in table A would be false; deleting the note would
    // lose a real fact. It goes in B, which is prose the register does not
    // claim to check.
    const listed = symbolsListedIn(tableA);
    const wrong = listed.filter((symbol) => REGISTER_REACHABLE.includes(symbol));
    expect(wrong, "the register says these DO have a production caller").toEqual([]);
  });

  it("states the same count the register does", () => {
    // The number in the phase report every time. It is quoted in prose rather
    // than in the table, so it can drift on its own.
    const stated = /Seven capabilities/.exec(tableA);
    expect(
      stated,
      `the document must state the count in words; the register has ${String(REGISTER_UNREACHABLE.length)}`,
    ).not.toBeNull();
    expect(REGISTER_UNREACHABLE.length, "the word 'Seven' is now wrong").toBe(7);
  });

  it("has no row that contradicts the heading it sits under", () => {
    // ── The `packages/notify` finding, made into a rule ──────────────────
    //
    // It sat under "Declared but unreachable" saying "Reachable." A row that
    // argues with its own heading is worse than an absent one, because it
    // reads as reviewed — someone looked, wrote a sentence, and left it filed
    // under the opposite claim.
    const wholeSection = sectionBetween(
      "### ⚠️ Declared but unreachable",
      "### ❌ Not built at all",
    );
    const rows = wholeSection.split("\n").filter((line) => line.startsWith("| "));
    const contradicting = rows.filter((row) => /\|\s*\*\*Reachable\.\*\*/.test(row));
    expect(
      contradicting,
      "a row under the unreachable heading that says it is reachable belongs in another section",
    ).toEqual([]);
  });

  it("is reading a real register and a real document", () => {
    // The vacuity guard. An empty register or an unparsed table would satisfy
    // every assertion above without being about anything — the failure mode
    // P37 named, where a check with no expectations cannot be wrong.
    expect(CAPABILITIES.length, "the register is empty or did not import").toBeGreaterThanOrEqual(
      21,
    );
    expect(REGISTER_UNREACHABLE.length).toBeGreaterThan(0);
    expect(symbolsListedIn(tableA).length, "table A parsed to nothing").toBe(
      REGISTER_UNREACHABLE.length,
    );
    expect(document.length, "the document did not load").toBeGreaterThan(10_000);
  });

  it("keeps the guard that stops the import running the check", () => {
    // ── Measured, and the reason this assertion exists at all ───────────
    //
    // Removing `invokedDirectly` and calling `main()` unconditionally does NOT
    // fail the test below while the register is passing: the check simply runs
    // during the import, prints into the test output, and sets no exit code.
    // The suite stayed green at 7/7 with the side effect live.
    //
    // It only bites when the register is ALSO failing, and then it fails this
    // file for a reason this file never asserted. So the guard is checked
    // where it is cheap — in the source — rather than left covered only by the
    // case where it has already done harm.
    const script = readFileSync(join(ROOT, "scripts", "check-reachability.ts"), "utf8");
    expect(script, "`main()` must run only when the script IS the program").toMatch(
      /if \(invokedDirectly\) main\(\);/,
    );
    expect(script, "an unconditional call would run the whole check on import").not.toMatch(
      /^main\(\);/m,
    );
  });

  it("importing the register does not run the check", () => {
    // `check-reachability.ts` calls `main()` when it is the program, and that
    // sets `process.exitCode = 1` on failure. If importing it here ran the
    // check, a reachability failure would surface as this SUITE failing with no
    // failed assertion — a test file able to fail for a reason it never states.
    expect(process.exitCode, "importing the register set an exit code").not.toBe(1);
  });
});
