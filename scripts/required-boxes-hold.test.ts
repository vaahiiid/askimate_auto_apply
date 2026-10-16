/**
 * P317: the measurement behind his rule of 2026-10-16, pinned before anything is
 * built (docs/run-a/p317-his-message-as-sent.txt): *"for every required box in a
 * signed entry, every answer the interview accepts must either produce a value
 * that satisfies the box, or lead the interview to ask the follow-up there and
 * then, never a stop after the plan is complete. A test checks this for every
 * signed entry and every accepted answer."*
 *
 * This is not yet that test. Today the rule does not hold, and these tests say
 * by how much: the saved output is what the checker prints, his run's own case
 * is among it, and the checker is shown to see a box planted on the entry and to
 * lose a finding whose rule is taken off. The gate that fails on any break
 * waits for the build (ADR-0161, proposed).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadCatalogueDirectory } from "@askimate/aas-catalogue";

import { findingsFor, measureCatalogue } from "./required-boxes-hold.js";

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

describe("P317: the answers the interview accepts, against every box of every signed entry (measured, not yet the rule's gate)", () => {
  it("the saved output (docs/run-a/p317-required-boxes.txt) is what the checker prints today", async () => {
    const saved = readFileSync(join(ROOT, "docs", "run-a", "p317-required-boxes.txt"), "utf8");
    expect(await measureCatalogue(CATALOGUE)).toBe(saved);
  }, 240_000);

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
