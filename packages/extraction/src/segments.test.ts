import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { ModelClient, Segmentation, SegmentationRequest } from "@askimate/aas-llm";
import { DeterministicModelClient } from "@askimate/aas-llm";

import { extractDocument } from "./extract.js";
import { planFor } from "./plans.js";
import type { ListTarget } from "./plans.js";
import { sectionRangeOf } from "./sections.js";
import { cutDocument, dateRangeCount, letterRangeOf, linesOf } from "./segments.js";
import { PlainTextExtractor } from "./text.js";
import type { DocumentText } from "./text.js";

const PROSE = readFileSync(new URL("./fixtures/cv-prose.txt", import.meta.url), "utf8");
const model = new DeterministicModelClient();

async function plain(body: string): Promise<DocumentText> {
  return new PlainTextExtractor().textOf({ documentId: "doc_prose", documentType: "cv", contents: new TextEncoder().encode(body) });
}

function target(fieldKey: "employment.history" | "education.prior_qualifications"): ListTarget {
  const found = planFor("cv")?.targets.find((t): t is ListTarget => t.kind === "list" && t.fieldKey === fieldKey);
  if (found === undefined) throw new Error("no list target");
  return found;
}

/** A model that cuts as told: the checks are what is under test, not the cut. */
function cuttingAs(entries: Segmentation["entries"]): ModelClient {
  return {
    ...model,
    composeQuestion: (r) => model.composeQuestion(r),
    composeDocumentRequest: (r) => model.composeDocumentRequest(r),
    interpretAnswer: (r) => model.interpretAnswer(r),
    extractFromDocument: (r) => model.extractFromDocument(r),
    segmentDocument: (_r: SegmentationRequest) => Promise.resolve({ entries }),
  };
}

describe("the stand-in's cut, crude but real: an entry starts where a date range is (stage three)", () => {
  // Vahid, 2026-09-28: *"if the segmentation can be given a deterministic
  // mode that cuts on something crude but real, we can at least see whether
  // the pipeline downstream of the cut works without spending anything."*
  it("finds the two jobs and the one qualification of an unlabelled CV, scoped to each section", async () => {
    const text = await plain(PROSE);
    const jobs = await cutDocument(target("employment.history"), text, model);
    expect(jobs.none).toBeNull();
    expect(jobs.entries.map((e) => [e.from, e.to]), "each job's block, title line included").toEqual([
      [16, 18],
      [20, 22],
    ]);
    expect(jobs.entries.map((e) => e.dateRanges)).toEqual([1, 1]);
    expect(jobs.entries.map((e) => e.letterLines), "no letter text in a job").toEqual([0, 0]);
    const studied = await cutDocument(target("education.prior_qualifications"), text, model);
    expect(studied.entries.map((e) => [e.from, e.to])).toEqual([[26, 28]]);
  });

  it("finds the section as a line range over the whole document, which is what a cut names", async () => {
    const text = await plain(PROSE);
    expect(sectionRangeOf(text, ["employment"])).toEqual({ from: 15, to: 23 });
    expect(sectionRangeOf(text, ["education"])).toEqual({ from: 25, to: 29 });
    expect(sectionRangeOf(text, ["publications"])).toBeNull();
  });

  it("says the document lists none, in the stand-in's own words, where no line carries a date range or a label", async () => {
    const text = await plain("Summary\nA person.\nEmployment\nI have worked a lot.\n");
    const cut = await cutDocument(target("employment.history"), text, model);
    expect(cut.none).toContain("no jobs");
    expect(cut.entries).toEqual([]);
    expect(cut.checks.unassignedSectionLines, "the section's one line, unassigned").toBe(1);
  });
});

describe("the cut held by structure: the checks and the two detectors", () => {
  it("REFUSES a range outside the document and a pair that share a line, and keeps the rest", async () => {
    const text = await plain(PROSE);
    const cut = await cutDocument(target("employment.history"), text, cuttingAs([{ from: 16, to: 18 }, { from: 18, to: 22 }, { from: 40, to: 45 }, { from: 26, to: 28 }]));
    expect(cut.checks.outsideDocument).toEqual([{ from: 40, to: 45 }]);
    expect(cut.checks.overlapping).toEqual([[1, 2]]);
    expect(cut.entries.map((e) => [e.from, e.to]), "only the one that shares no line survives").toEqual([[26, 28]]);
    expect(cut.checks.linesOutsideSection, "and it lies outside the employment section").toBe(3);
    expect(cut.checks.unassignedSectionLines, "every non-blank employment line unassigned").toBe(6);
  });

  it("counts the date ranges in an entry — two is two jobs cut as one — and the runner holds such an entry back", async () => {
    expect(dateRangeCount(["September 2021 – Present", "June 2019 – August 2021"])).toBe(2);
    expect(dateRangeCount(["2015 to 2019", "Grade 17.2"])).toBe(1);
    expect(dateRangeCount(["Born 1999", "Phone 2021"])).toBe(0);
    const text = await plain(PROSE);
    const merged = cuttingAs([{ from: 16, to: 22 }]);
    const cut = await cutDocument(target("employment.history"), text, merged);
    expect(cut.entries[0]?.dateRanges).toBe(2);
    const report = await extractDocument(text, merged);
    const held = report?.outcomes.find((o) => o.targetKey === "employment.history[1]");
    expect(held?.kind).toBe("not_found");
    expect(held?.kind === "not_found" ? held.reason : "").toContain("2 date ranges");
  });

  it("finds the cover letter by its opening and closing, and names letter text inside a job's range", async () => {
    const lines = linesOf(await plain(PROSE));
    expect(letterRangeOf(lines)).toEqual({ from: 4, to: 9 });
    expect(letterRangeOf(["Employment", "Data analyst", "2019 – 2021"])).toBeNull();
    // The named failure: the letter's sentence carries a date range, and a
    // cut that starts an entry there would put letter text inside a job.
    const text = await plain(PROSE);
    const cut = await cutDocument(target("employment.history"), text, cuttingAs([{ from: 6, to: 8 }, { from: 16, to: 18 }]));
    expect(cut.entries[0]?.letterLines, "three lines of the letter inside entry 1").toBe(3);
    expect(cut.entries[1]?.letterLines).toBe(0);
  });

  it("the stand-in, unscoped by a heading, would start an entry inside the letter — which the detector names", async () => {
    // The same CV with the Employment heading removed: no section to scope to,
    // so the crude cut runs over the whole document and the letter's own date
    // range starts an entry. The detector says so; nothing hides it.
    const text = await plain(PROSE.replace("Employment\n", "Work\n"));
    const cut = await cutDocument(target("employment.history"), text, model);
    expect(cut.checks.section).toBeNull();
    expect(cut.entries[0]?.from).toBe(6);
    expect(cut.entries[0]?.letterLines).toBeGreaterThan(0);
  });
});
