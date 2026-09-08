/**
 * The browser lane contains exactly the files that launch a browser.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * P47. `BROWSER_TEST_FILES` is a list, and a list is the thing this repository
 * keeps finding out of date. Two ways for it to rot, and both matter:
 *
 *   a file starts launching a browser and is NOT added
 *     → it rejoins the contention, silently, and the suite starts failing for
 *       reasons that turn out not to matter again
 *
 *   a listed file stops launching one
 *     → it is serialised for nothing, and the lane is slower than it needs to
 *       be for a reason nobody can see
 *
 * So the list is checked in both directions against what the files actually
 * do.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the check follows imports ─────────────────────────────────────────
 *
 * Five of them never write `chromium.launch`. They construct a
 * `PlaywrightDiscoverySession` or a `PlaywrightInspectionSession`, and the
 * launch happens inside that class. Grepping the test file alone reported
 * twelve of the seventeen then present — and the five it missed were measured spawning eight
 * Chromium processes each, so the narrow predicate was not a smaller truth, it
 * was a wrong one.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BROWSER_TEST_FILES } from "./browser-test-files.js";

const ROOT = resolve(join(import.meta.dirname, ".."));
const SEARCHED = ["packages", "apps", "scripts"];
const LAUNCHES = /chromium\s*\.\s*launch|connectOverCDP/;

/**
 * This file, which is the one file that cannot be scanned by its own rule.
 *
 * It contains the pattern in order to look for the pattern — the first run
 * flagged `browser-lane.test.ts` itself as a file that launches a browser,
 * because `connectOverCDP` appears in the alternation above. That is the P39
 * mistake exactly: a check that reports the WORD as the deed.
 *
 * Excluded by name rather than by stripping literals, because a scanner that
 * tried to tell code from the text describing code would be a second, subtler
 * thing to get wrong. The exception is asserted to be this one file, so it
 * cannot quietly grow.
 */
const SELF = "scripts/browser-lane.test.ts";

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.test\.tsx?$/.test(entry) && relative(ROOT, path) !== SELF) found.push(path);
  }
  return found;
}

/** The first-party modules a file imports, resolved to their sources. */
function localImports(file: string): readonly string[] {
  const source = readFileSync(file, "utf8");
  const specifiers = [...source.matchAll(/from\s+"(\.[^"]+)"/g)].map((match) => match[1] ?? "");
  return specifiers.flatMap((specifier) => {
    const base = join(dirname(file), specifier.replace(/\.js$/, ""));
    return [`${base}.ts`, `${base}.tsx`].filter((candidate) => {
      try {
        return statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
  });
}

/** True when this test file, or a module it imports, starts a browser. */
function startsABrowser(file: string): boolean {
  if (LAUNCHES.test(readFileSync(file, "utf8"))) return true;
  return localImports(file).some((imported) => LAUNCHES.test(readFileSync(imported, "utf8")));
}

const ACTUAL = SEARCHED.flatMap((dir) => walk(join(ROOT, dir)))
  .filter(startsABrowser)
  .map((file) => relative(ROOT, file))
  .sort();

describe("the browser lane", () => {
  it("lists every test file that launches a browser", () => {
    const missing = ACTUAL.filter((file) => !BROWSER_TEST_FILES.includes(file));
    expect(
      missing,
      "these launch a browser and are not in the lane, so they run against everything else",
    ).toEqual([]);
  });

  it("lists NOTHING that does not launch one", () => {
    const stale = [...BROWSER_TEST_FILES].filter((file) => !ACTUAL.includes(file));
    expect(stale, "these are serialised for nothing").toEqual([]);
  });

  it("excludes exactly one file — itself — and says why", () => {
    // The exception cannot grow silently: everything else in the tree is
    // scanned, and this asserts the skipped set is the single self-referential
    // file rather than a list somebody added to.
    expect(SELF).toBe("scripts/browser-lane.test.ts");
    expect(
      LAUNCHES.test(readFileSync(join(ROOT, SELF), "utf8")),
      "it matches its own rule, which is why it is excluded",
    ).toBe(true);
    expect(ACTUAL, "and it is not in the answer").not.toContain(SELF);
  });

  it("is looking at real files, and at more than a handful", () => {
    // The vacuity guard. A walk that found nothing, or a predicate that matched
    // nothing, would satisfy both assertions above without being about
    // anything.
    // ── A floor, not a count (P53) ──────────────────────────────────────
    //
    // This said `>= 17`, which was the number the day it was written. P53
    // removed `apps/chat-integration` and its four browser files, and the guard
    // failed on the count rather than on anything being wrong — a hand-written
    // number that must be edited whenever the thing it counts changes, which is
    // the shape ADR-0082 through ADR-0084 spent three phases removing.
    //
    // What this assertion is FOR is vacuity: a walk that found nothing, or a
    // predicate that matched nothing, would satisfy both directions above
    // without being about anything. A floor does that. The exact agreement
    // between the two lists is asserted on the next line, and by the two
    // direction tests above, which is where exactness belongs.
    expect(ACTUAL.length, "the walk or the predicate found almost nothing").toBeGreaterThanOrEqual(8);
    expect(BROWSER_TEST_FILES.length).toBe(ACTUAL.length);
  });

  it("counts a file that launches only through a session class", () => {
    // The five the first version of this predicate missed. Each was measured
    // spawning eight Chromium processes.
    for (const file of [
      "apps/browser-runner/src/discovery.test.ts",
      "apps/browser-runner/src/inspection.test.ts",
      "apps/browser-runner/src/lwc-observe.test.ts",
      "apps/browser-runner/src/lwc-shadow.test.ts",
      "apps/browser-runner/src/preparation.test.ts",
    ]) {
      expect(ACTUAL, `${file} launches through a Playwright*Session`).toContain(file);
      expect(
        LAUNCHES.test(readFileSync(join(ROOT, file), "utf8")),
        `${file} does not say chromium.launch itself — which is the point`,
      ).toBe(false);
    }
  });

  it("keeps the setting that actually serialises the lane", () => {
    // ── Measured, and easy to lose ──────────────────────────────────────
    //
    // A single fork is what made the difference — peak browsers 3 → 1, peak
    // Chromium processes 21 → 7, peak load 5.13 → 3.13.
    //
    // Asserted against the file's text because the setting is the deliverable:
    // removing it leaves a lane that looks serialised and is not, which is the
    // state this phase started in.
    const workspace = readFileSync(join(ROOT, "vitest.workspace.ts"), "utf8");
    expect(workspace).toMatch(/pool:\s*"forks"/);
    expect(workspace).toMatch(/singleFork:\s*true/);
  });

  it("does not set fileParallelism on a project, where it does nothing", () => {
    // ── The one that got away, and how it was caught ────────────────────
    //
    // The first version of the lane set `fileParallelism: false` on the
    // chromium project. Vitest lists it in `NonProjectOptions` — a root-level
    // setting only — so it was accepted by the config loader and ignored at
    // runtime. The lane looked serialised, measured at three concurrent
    // browsers, and the reason was invisible until `tsc` rejected the key.
    //
    // Asserted so it cannot come back as a plausible-looking belt-and-braces
    // addition. Anything that reads as serialising this lane and is not doing
    // so is worse than nothing, because it stops anyone looking further.
    const workspace = readFileSync(join(ROOT, "vitest.workspace.ts"), "utf8");
    const settings = workspace.replace(/\/\/[^\n]*/g, "");
    expect(
      settings,
      "fileParallelism is a NonProjectOption; setting it here is silently ignored",
    ).not.toMatch(/fileParallelism/);
  });
});
