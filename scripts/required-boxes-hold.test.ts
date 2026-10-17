/**
 * P317: the measurement behind his rule of 2026-10-16, pinned before anything is
 * built (docs/run-a/p317-his-message-as-sent.txt): *"for every required box in a
 * signed entry, every answer the interview accepts must either produce a value
 * that satisfies the box, or lead the interview to ask the follow-up there and
 * then, never a stop after the plan is complete. A test checks this for every
 * signed entry and every accepted answer."*
 *
 * P318 makes it that test, at his word of 2026-10-17 (ADR-0161 approved, D1:
 * "the test with its shrinking list"): the gate below fails on any line that
 * breaks the rule and is not on `scripts/required-boxes-known.ts`, and on any
 * listed line that no longer occurs. Beside it: the saved output is what the
 * checker prints, his run's own case is among it, and the checker is shown to
 * see a box planted on the entry and to lose a finding whose rule is taken off.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { loadCatalogueDirectory } from "@askimate/aas-catalogue";

import { breakingKeys, findingsFor, gate, measureCatalogueResults, render } from "./required-boxes-hold.js";
import { KNOWN_BREAKS } from "./required-boxes-known.js";

const ROOT = join(import.meta.dirname, "..");
const CATALOGUE = join(ROOT, "docs", "run-a", "catalogue");

async function sheffield(): Promise<{ readonly blueprint: unknown; readonly mappingSet: unknown }> {
  const load = await loadCatalogueDirectory({ directory: CATALOGUE });
  if (!load.ok) throw new Error("the signed catalogue does not load");
  const item = load.catalogue.inventory().find((one) => String(one.blueprintId) === "bp-sheffield-pgt-september-direct");
  if (item === undefined) throw new Error("the signed catalogue no longer holds Sheffield");
  const entry = await load.catalogue.find(item.blueprintId);
  if (entry === null) throw new Error("Sheffield is listed and not found");
  return entry;
}

interface Field {
  readonly fieldRef: string;
  validations: { readonly kind: string; readonly source?: string }[];
}

/** The same entry with one box's rules changed, as a planted case. */
function withRules(entry: { readonly blueprint: unknown; readonly mappingSet: unknown }, fieldRef: string, change: (rules: Field["validations"]) => Field["validations"]): { readonly blueprint: unknown; readonly mappingSet: unknown } {
  const blueprint = structuredClone(entry.blueprint) as { pages: { sections: { fields: Field[] }[] }[] };
  let found = 0;
  for (const page of blueprint.pages) for (const section of page.sections) for (const field of section.fields) {
    if (field.fieldRef !== fieldRef) continue;
    field.validations = change(field.validations);
    found += 1;
  }
  if (found !== 1) throw new Error(`${fieldRef} is on the entry ${String(found)} times`);
  return { ...entry, blueprint };
}

const FUNDING = new Set(["finance.funding"]);

const brokenBy = (result: ReturnType<typeof findingsFor>, fieldKey: string, box: string): readonly string[] =>
  result.findings.filter((finding) => finding.kind === "breaks_a_required_box" && finding.fieldKey === fieldKey && finding.box === box).map((finding) => finding.answer);

let results: Awaited<ReturnType<typeof measureCatalogueResults>> = [];

beforeAll(async () => {
  results = await measureCatalogueResults(CATALOGUE);
}, 240_000);

const breakingNow = (): ReadonlySet<string> => new Set(results.flatMap((result) => [...breakingKeys(result.blueprintId, result.measured)]));

describe("P318: his rule's test — every signed entry, every accepted answer, and a list that can only shrink", () => {
  it("is measuring a real catalogue: at least one signed entry, and lines to hold", () => {
    expect(results.length).toBeGreaterThan(0);
    expect(KNOWN_BREAKS.length).toBeGreaterThan(0);
  });

  it("finds no line that breaks the rule and is not on the known list, and no listed line that has stopped occurring", () => {
    const verdict = gate(breakingNow(), KNOWN_BREAKS);
    expect(verdict.unexpected, "a line breaks his rule that is not on scripts/required-boxes-known.ts: mend it (a new line cannot be listed, see the next test)").toEqual([]);
    expect(verdict.gone, "a listed line no longer occurs: it was mended, so take it off scripts/required-boxes-known.ts").toEqual([]);
    expect(verdict.listedTwice).toEqual([]);
  });

  it("the list can only shrink: every listed line is one of the 59 P318 listed, so a new break cannot be listed, only mended", () => {
    // His D1: "the test with its shrinking list". The baseline is the list as
    // P318 left it, printed from scripts/required-boxes-known.ts by the code,
    // not typed. A line may leave the list; none may join it. P318's records
    // reviewer found the first gate let a new break pass by listing it.
    const baseline = new Set(readFileSync(join(ROOT, "docs", "run-a", "p318-known-breaks.txt"), "utf8").split("\n").filter((line) => line.length > 0));
    expect(baseline.size).toBe(59);
    expect(KNOWN_BREAKS.map((line) => line.key).filter((key) => !baseline.has(key)), "a line joined the list after P318: mend the break instead").toEqual([]);
  });

  it("names what every listed line waits on", () => {
    expect(KNOWN_BREAKS.filter((line) => line.waits.trim().length < 10)).toEqual([]);
  });

  it("the gate fails on a planted new line, on a planted mended line, and on a line listed twice", () => {
    const current = new Set(["e|a", "e|b"]);
    expect(gate(current, [{ key: "e|a" }, { key: "e|b" }])).toEqual({ unexpected: [], gone: [], listedTwice: [] });
    expect(gate(new Set([...current, "e|c"]), [{ key: "e|a" }, { key: "e|b" }]).unexpected).toEqual(["e|c"]);
    expect(gate(new Set(["e|a"]), [{ key: "e|a" }, { key: "e|b" }]).gone).toEqual(["e|b"]);
    expect(gate(current, [{ key: "e|a" }, { key: "e|b" }, { key: "e|a" }]).listedTwice).toEqual(["e|a"]);
  });

  it("the gate catches a new break on the real entry: a required box planted on the funding details is a line not on the list", async () => {
    const planted = findingsFor(withRules(await sheffield(), "fundingDetails", (rules) => [...rules, { kind: "required", source: "specialist_noted" }]), FUNDING);
    const verdict = gate(breakingKeys("bp-sheffield-pgt-september-direct", planted), KNOWN_BREAKS.filter((line) => line.key.includes("|finance.funding|")));
    expect(verdict.unexpected).toContain("bp-sheffield-pgt-september-direct|breaks_a_required_box|finance.funding|fundingDetails|maxlength 118");
  }, 120_000);
});

describe("P317: the answers the interview accepts, against every box of every signed entry (measured)", () => {
  it("the saved output (docs/run-a/p317-required-boxes.txt) is what the checker prints today", () => {
    const saved = readFileSync(join(ROOT, "docs", "run-a", "p317-required-boxes.txt"), "utf8");
    expect(render(results)).toBe(saved);
  });

  it("finds his run's case: a no to the funding question leaves Sheffield's required stage empty, after the plan is complete", async () => {
    const result = findingsFor(await sheffield(), FUNDING);
    expect(brokenBy(result, "finance.funding", "fundingStage")).toEqual(["known=false"]);
    // And no other answer to the funding questions breaks it.
    expect(result.findings.filter((finding) => finding.box === "fundingStage" && finding.kind === "breaks_a_required_box")).toHaveLength(1);
  }, 120_000);

  it("sees a required box planted on the entry: the funding details marked required, Run A's own answer (which names none) breaks it, and says so", async () => {
    const entry = await sheffield();
    const today = findingsFor(entry, FUNDING);
    expect(today.baseBreaks).toEqual([]);
    expect(brokenBy(today, "finance.funding", "fundingDetails")).toEqual([]);
    const planted = findingsFor(withRules(entry, "fundingDetails", (rules) => [...rules, { kind: "required", source: "specialist_noted" }]), FUNDING);
    // Found in P317 by this test: a break the base itself has was filtered out
    // as "not new" and said nowhere. It is said now, on its own line.
    expect(planted.baseBreaks).toEqual(["fundingDetails: required"]);
    // And its 118-character limit, required now, is broken by the longest details the interview takes.
    const onDetails = planted.findings.filter((finding) => finding.box === "fundingDetails");
    expect([...new Set(onDetails.map((finding) => `${finding.kind}: ${finding.detail}`))]).toEqual(["breaks_a_required_box: maxlength 118"]);
  }, 120_000);

  it("loses a finding when the rule behind it is taken off: the stage not required, the no breaks nothing", async () => {
    const lifted = withRules(await sheffield(), "fundingStage", (rules) => rules.filter((rule) => rule.kind !== "required"));
    expect(brokenBy(findingsFor(lifted, FUNDING), "finance.funding", "fundingStage")).toEqual([]);
  }, 120_000);
});
