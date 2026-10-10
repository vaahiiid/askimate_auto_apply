/**
 * Every read prints the country selected when it was made (P295).
 *
 * Vahid, 2026-10-10: *"For reads R and L and every read from now on: each
 * snippet must also print the country selected at the time of the read, so the
 * country is never typed in by hand again."*
 *
 * The country his reads of 6 October were made under reached the entry by
 * hand (P294), from a heading beside the reads, and then from his word. This
 * file is what stops that happening again. It takes every console snippet
 * `read-snippets.ts` finds and runs each in Chromium, on a fresh page each
 * time, under four selections of the country: Iran; the United Kingdom; none
 * ("Select a country...", the value `""`); and a value made up for the run. Each
 * time, the snippet must print the value selected. Two countries alone would
 * pass a snippet that wrote "IRAN" in itself and fell back to it. A fresh page
 * means one snippet cannot leave a variable behind for the next. A snippet
 * that returns a promise fails, because the console would print
 * `Promise {<pending>}` and not the read.
 *
 * ── The snippets written before the rule ─────────────────────────────────
 *
 * `BEFORE_THE_RULE` pins each one by its content, in the file it is in, as the
 * scanner found them on 2026-10-10. A pin covers that snippet only. A new
 * snippet in the same file is held to the rule. Each pin must still find its
 * snippet, so the list cannot keep one it no longer needs. Each file holding
 * one must carry the line `**Written before the rule of 2026-10-10.**`, saying
 * not to run them as they stand. What this cannot stop: someone adding the hash
 * of a new snippet to the list. That is a visible act in a diff, not something a
 * test can date.
 *
 * ── What it cannot see ───────────────────────────────────────────────────
 *
 * What `read-snippets.ts` cannot (its header). Whether he ran the snippet as
 * written. And the page is synthetic: it holds the names the snippets read, not
 * Sheffield's form. It shows that a snippet prints the select's value. It
 * cannot show that the select holds the country on the real page. P149
 * recorded that it does.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";

import { allSnippets, ROOT } from "./read-snippets.js";

/** Found by `read-snippets.ts` on 2026-10-10, before his rule. They do not print the country. */
const BEFORE_THE_RULE: readonly { readonly path: string; readonly sha256: string }[] = [
  { path: "docs/run-a/p283-step2-for-signature.md", sha256: "8cfdba9235544887c8775e2bc787d13740e56a62cc06effd665f396ed24b117f" },
  { path: "docs/run-a/p290-reads.md", sha256: "b74404ee0a81576b76ecb876eb2c83b60ba8619f04507f8058b880f8abfc3988" },
  { path: "docs/run-a/p290-reads.md", sha256: "9a9a936b878738003d6c325f730967d2405e586bbbcfe80465c1e1d5c2a0ec74" },
  { path: "docs/run-a/p290-reads.md", sha256: "432f1dcd2eafef5f5cc89a4d4fb179d663045b3f40e13b455805e32a6041186b" },
  { path: "docs/run-a/p290-reads.md", sha256: "40b851f59161655acd995147a192bea90aeb8ea4ce62d8985ebae43df02872a4" },
  { path: "docs/run-a/p290-reads.md", sha256: "c853a4b52f078f4ec5380d64189721f34333f3ed735fccea8d7c573e7754ebbe" },
  { path: "docs/run-a/p292-reads.md", sha256: "9f972d300716c42bbb535cebbbba86db803c1b39ae6688b72e0dda8e26e358f0" },
  { path: "docs/run-a/p292-reads.md", sha256: "ed89be70f2e5c08fbbc7e9dec468bcdde5f1e325d0bff05aa6c86d02439fdeaa" },
  { path: "docs/run-a/p293-reads.md", sha256: "d957ea7ec2f6dd5f23d3af31cf28bcf94943e0be5828f4c00291dd5f6dd4291d" },
  { path: "docs/run-a/p293-reads.md", sha256: "ed89be70f2e5c08fbbc7e9dec468bcdde5f1e325d0bff05aa6c86d02439fdeaa" },
  { path: "docs/captures/sheffield-pgt-2026-09-10/README.md", sha256: "6b0d2c95f75e95e24c966fdad50ea86059d5633c2f3dca904af746293d8feb05" },
  { path: "docs/captures/sheffield-pgt-2026-09-10/README.md", sha256: "b41304d5a4cdfbf4badcdd4793ebc686da5ef7cb38e34bddc279e07e1e570287" },
  { path: "docs/captures/sheffield-pgt-2026-09-10/README.md", sha256: "0dced083706d4104f455b5d6f1edb7573a0a0013a54277b36db3464f790f8db1" },
  { path: "docs/captures/sheffield-pgt-2026-09-10/README.md", sha256: "3ba7febe721fe7a8e9b58b1b81c4917f64aa5179a337271042fd42e8de4f3d23" },
  { path: "docs/captures/sheffield-pgt-2026-09-10/README.md", sha256: "13a6db3c2f9e6c4216612997cd73681d32349b6169af7dfe19e84e1e3680a119" },
  { path: "docs/captures/sheffield-pgt-2026-09-10/README.md", sha256: "c3aed441ac6718533d2aad3c883c890e8eef41853710b0dbe9593166def97722" },
  { path: "docs/captures/sheffield-pgt-2026-09-10/README.md", sha256: "5f219df29c834d36650b5cfc1ecb160c802a764ebaa02af3b911d3a6d4375c3f" },
  { path: "docs/captures/sheffield-pgt-2026-09-14-five-pages-relabelled/README.md", sha256: "18e82bafec3bf801fe2500f56bf19942e1c4b3324f0d03e4b5ca03c95cd85ce5" },
];

const MARK = "**Written before the rule of 2026-10-10.**";

const found = allSnippets();
const pinned = (path: string, sha256: string): boolean => BEFORE_THE_RULE.some((pin) => pin.path === path && pin.sha256 === sha256);
const bound = found.filter((snippet) => !pinned(snippet.path, snippet.sha256));

/**
 * What the snippets read, and nothing of Sheffield's: the country select, the
 * institution's code, the grading system, the grade list, the institution
 * box with an open dropdown, and the three escape boxes.
 */
const PAGE = `<!doctype html><html><body>
<form>
  <select name="institutionCountry">
    <option value="">Select a country...</option>
    <option value="IRAN">Iran</option>
    <option value="UNITED KINGDOM">United Kingdom</option>
  </select>
  <select name="institutionCode"><option value="">Not in list</option></select>
  <input id="institution-ts-control" value="Azad">
  <div id="institution-ts-dropdown">
    <div role="option" data-value="UNI1" data-selectable>Example University</div>
    <div role="option" data-value="">Not in list</div>
  </div>
  <select name="gradingSystemId"><option value="6">GPA 20 (e.g. 16.5/20)</option></select>
  <select name="grade"><option value="">Select your grade...</option><option value="0.0">0.0</option></select>
  <div class="form-group"><label for="ui">Institution name</label><input id="ui" name="unlistedInstitution"></div>
  <div class="form-group"><label for="us">Subject</label><input id="us" name="unlistedSubject"></div>
  <div class="form-group"><label for="ud">Award title</label><input id="ud" name="unlistedDegree"></div>
</form>
</body></html>`;

const MADE_UP = `COUNTRY-${randomUUID()}`;
const SELECTIONS: readonly { readonly name: string; readonly value: string }[] = [
  { name: "Iran", value: "IRAN" },
  { name: "the United Kingdom", value: "UNITED KINGDOM" },
  { name: "no country", value: "" },
  { name: "a value made up for this run", value: MADE_UP },
];

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 120_000);

afterAll(async () => {
  await browser.close();
});

/** What the console would print for the snippet, on a fresh page with `value` selected. */
async function printed(snippet: string, value: string): Promise<unknown> {
  const page = await browser.newPage();
  try {
    await page.setContent(PAGE);
    // A string, as the snippets are: this file's types have no DOM.
    const held: unknown = await page.evaluate(
      `(() => { const selected = ${JSON.stringify(value)}; const select = document.querySelector('[name="institutionCountry"]'); ` +
        `if (select === null) return null; if (![...select.options].some((o) => o.value === selected)) select.add(new Option(selected, selected)); ` +
        `select.value = selected; return select.value; })()`,
    );
    if (held !== value) throw new Error(`the test page did not take ${JSON.stringify(value)}; it holds ${JSON.stringify(held)}`);
    return await page.evaluate((source) => {
      const result: unknown = (0, eval)(source);
      const thenable = typeof result === "object" && result !== null && typeof (result as { then?: unknown }).then === "function";
      return thenable ? { aPromise: true } : result;
    }, snippet);
  } finally {
    await page.close();
  }
}

describe("every read prints the country selected when it was made (P295)", () => {
  it("finds the snippets it holds to the rule: a check over nothing would pass", () => {
    expect(bound.length, "no plan holds a read; the rule would hold over nothing").toBeGreaterThan(0);
    expect(bound.map((snippet) => snippet.path)).toContain("docs/run-a/p294-reads.md");
  });

  it("can run every snippet written since the rule as written", () => {
    const unrunnable = bound.filter((snippet) => snippet.unrunnable !== undefined).map((snippet) => `${snippet.path}:${String(snippet.line)}: ${snippet.unrunnable ?? ""}`);
    expect(unrunnable, "a snippet this file cannot run is a snippet it cannot hold to the rule").toEqual([]);
  });

  it("pins only snippets still there, each in a file that says not to run them as they stand", () => {
    const stale = BEFORE_THE_RULE.filter((pin) => !found.some((snippet) => snippet.path === pin.path && snippet.sha256 === pin.sha256));
    expect(stale, "a pin that finds no snippet").toEqual([]);
    const unmarked = [...new Set(BEFORE_THE_RULE.map((pin) => pin.path))].filter((path) => !readFileSync(join(ROOT, path), "utf8").includes(MARK));
    expect(unmarked, `files holding snippets written before the rule, without ${MARK}`).toEqual([]);
  });

  for (const selection of SELECTIONS) {
    it(`each prints what is selected when ${selection.name} is`, async () => {
      const wrong: string[] = [];
      for (const snippet of bound.filter((candidate) => candidate.unrunnable === undefined)) {
        const where = `${snippet.path}:${String(snippet.line)}`;
        let output: unknown;
        try {
          output = await printed(snippet.text, selection.value);
        } catch (error) {
          wrong.push(`${where}: threw on the test page (${String(error).split("\n")[0] ?? ""}); if it reads something new, add that to the page`);
          continue;
        }
        if (typeof output !== "string") {
          wrong.push(`${where}: printed ${JSON.stringify(output)}, not the string the console shows`);
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(output);
        } catch {
          wrong.push(`${where}: printed a string that is not JSON`);
          continue;
        }
        const said = (parsed as { under?: { institutionCountry?: unknown } } | null)?.under?.institutionCountry;
        if (said !== selection.value) wrong.push(`${where}: under.institutionCountry is ${JSON.stringify(said)}, with ${JSON.stringify(selection.value)} selected`);
      }
      expect(wrong).toEqual([]);
    });
  }
});
