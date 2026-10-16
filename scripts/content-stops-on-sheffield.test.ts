import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { describe as group, expect, it } from "vitest";

import { CASES, FUNDING_CASES, describe, outcomeFor, plannedFunding } from "./content-stops-on-sheffield.js";

// P315: what Sheffield's signed entry makes of his residence answers, of a job
// list confirmed empty and of funding not known, on Run A's synthetic profile.
// The numbers are what the measure printed on 2026-10-16 against the entry as
// committed (blueprint 0.2.36, mapping set 0.3.48), saved as it printed them in
// docs/run-a/p315-content-stops-on-sheffield.txt; if the entry moves, these
// move with it, and the records that quote them (rows 202 and the P315 sheet)
// do too.

const ROOT = join(import.meta.dirname, "..");
const ENTRY = join(ROOT, "docs", "run-a", "catalogue", "entries", "sheffield-pgt-2027-09.json");

function named(name: string): (typeof CASES)[number] {
  const one = CASES.find((candidate) => candidate.name === name);
  if (one === undefined) throw new Error(`no case named ${name}`);
  return one;
}

group("what stops for content on Sheffield's entry (P315)", () => {
  it("his residence answers (Iran; the United Kingdom from May 2023, current) block nothing and break no rule", () => {
    const outcome = outcomeFor(ENTRY, named("his residence answers"));
    expect(outcome.plan.blockers).toEqual([]);
    expect(outcome.validation?.violations).toEqual([]);
    expect(outcome.validation?.unknownFields).toEqual([]);
  });

  it("while the list is not confirmed, the plan lacks it on twenty boxes, so the step is the interview and nothing is validated", () => {
    const outcome = outcomeFor(ENTRY, named("his residence answers, the list not yet confirmed"));
    expect(outcome.plan.blockers).toHaveLength(20);
    expect(new Set(outcome.plan.blockers.map((blocker) => ("fieldKey" in blocker ? blocker.fieldKey : blocker.kind)))).toEqual(
      new Set(["residence.history"]),
    );
    expect(outcome.validation).toBeNull();
  });

  it("a job list confirmed empty breaks the employment page's four required boxes, with no entry number (row 202)", () => {
    const outcome = outcomeFor(ENTRY, named("a job list confirmed empty"));
    expect(outcome.plan.blockers).toEqual([]);
    expect(outcome.validation?.violations.map((violation) => [violation.fieldRef, violation.rule.kind, violation.item])).toEqual([
      ["startMonth", "required", undefined],
      ["position", "required", undefined],
      ["employerDetails", "required", undefined],
      ["duties", "required", undefined],
    ]);
  });

  it("funding not known breaks the required funding stage (row 86)", () => {
    const outcome = outcomeFor(ENTRY, named("funding not known"));
    expect(outcome.validation?.violations.map((violation) => [violation.fieldRef, violation.rule.kind])).toEqual([["fundingStage", "required"]]);
  });

  it("the saved output is what the measure prints now, line for line", () => {
    const printed = execFileSync("npx", ["tsx", join(ROOT, "scripts", "content-stops-on-sheffield.ts")], { cwd: ROOT, encoding: "utf8" });
    const saved = readFileSync(join(ROOT, "docs", "run-a", "p315-content-stops-on-sheffield.txt"), "utf8");
    expect(printed).toBe(saved);
    for (const one of CASES) expect(saved).toContain(describe(one, outcomeFor(ENTRY, one)));
  });
});

// P316: the funding stage his run stopped on. His words (docs/run-a/p316-his-message-as-sent.txt):
// *"Which profile field(s) the mapping reads to fill fundingStage, and which value of mine would
// map to each option."* Saved as printed in docs/run-a/p316-funding-on-page-12.txt.
group("what each funding answer fills on page 12 (P316)", () => {
  const planned = (name: string, ref: string): unknown => {
    const one = FUNDING_CASES.find((candidate) => candidate.name === name);
    if (one === undefined) throw new Error(`no case named ${name}`);
    const instruction = outcomeFor(ENTRY, one).plan.instructions.find((candidate) => candidate.fieldRef === ref);
    let value: unknown = instruction?.value;
    while (value !== null && typeof value === "object" && "value" in value) value = (value as { readonly value: unknown }).value;
    return value;
  };

  it("his held no fills No and leaves the stage empty, which its required rule refuses", () => {
    const outcome = outcomeFor(ENTRY, FUNDING_CASES[0] ?? expect.unreachable("no first case"));
    expect(planned("funding not known (his answer of 2026-10-16)", "fundingSourceKnown")).toBe("No");
    expect(planned("funding not known (his answer of 2026-10-16)", "fundingStage")).toBe("");
    expect(outcome.validation?.violations.map((violation) => [violation.fieldRef, violation.rule.kind])).toEqual([["fundingStage", "required"]]);
  });

  it("each of the five stages fills the form's own sentence, and breaks no rule", () => {
    const sentences: Readonly<Record<string, string>> = {
      confirmed: "The funding has been confirmed",
      project_studentship: "I am applying for a project studentship",
      applied: "I have applied for funding",
      applying: "I am applying for funding",
      considering: "I am thinking about funding my studies this way",
    };
    for (const [stage, sentence] of Object.entries(sentences)) {
      const name = `funding known: self or family, stage ${stage}`;
      expect(planned(name, "fundingStage"), stage).toBe(sentence);
      expect(planned(name, "fundingSourceKnown"), stage).toBe("Yes");
      const one = FUNDING_CASES.find((candidate) => candidate.name === name) ?? expect.unreachable(name);
      expect(outcomeFor(ENTRY, one).validation?.violations, stage).toEqual([]);
    }
  });

  it("a scholarship the form does not list blocks on the source box instead", () => {
    const one = FUNDING_CASES.find((candidate) => candidate.name.includes("does not list")) ?? expect.unreachable("no unlisted case");
    const outcome = outcomeFor(ENTRY, one);
    expect(outcome.plan.blockers.map((blocker) => [blocker.kind, blocker.fieldRef])).toEqual([["render_refused", "fundingSource"]]);
  });

  it("the saved output is what the measure prints now, line for line", () => {
    const printed = execFileSync("npx", ["tsx", join(ROOT, "scripts", "content-stops-on-sheffield.ts"), "--funding"], { cwd: ROOT, encoding: "utf8" });
    const saved = readFileSync(join(ROOT, "docs", "run-a", "p316-funding-on-page-12.txt"), "utf8");
    expect(printed).toBe(saved);
    for (const one of FUNDING_CASES) expect(saved).toContain(plannedFunding(outcomeFor(ENTRY, one)));
  });
});
