import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { ExtractionRequest, ModelClient, Segmentation, SegmentationRequest } from "@askimate/aas-llm";
import { proposeValue } from "@askimate/aas-domain";
import { DeterministicModelClient } from "@askimate/aas-llm";

import { readListEntries } from "./extract.js";
import { planFor } from "./plans.js";
import type { ListTarget } from "./plans.js";
import { sectionRangeOf } from "./sections.js";
import { cutDocument, dateRangeCount, letterRangeOf, linesOf } from "./segments.js";
import { PlainTextExtractor } from "./text.js";
import type { DocumentText } from "./text.js";

const PROSE = readFileSync(new URL("./fixtures/cv-prose.txt", import.meta.url), "utf8");
/** The same CV with the letter AFTER the last section and no heading after it — Vahid's own layout (P245). */
const LETTER_LAST = readFileSync(new URL("./fixtures/cv-prose-letter-last.txt", import.meta.url), "utf8");
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
    const reading = await readListEntries(target("employment.history"), text, merged);
    expect(reading.entries[0]?.dropped).toContain("2 date ranges");
    expect(reading.entries[0]?.fields, "held back: nothing of it is offered").toEqual({});
    expect(reading.entries[0]?.parts.every((part) => part.status === "skipped"), "and nothing of it is read").toBe(true);
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

  // ── Where a section ends when a letter follows it (P245) ──────────────
  //
  // Vahid's live run, 2026-09-28: the education section ran 39–60 and the
  // letter began at 45, so more than half of "education" was letter and 19
  // of 22 lines were unassigned. *"the section boundary is wrong and the
  // model had to work around it. Worth fixing where the section ends rather
  // than relying on the cut to be careful."* And the guard he asked for:
  // *"Make sure clipping at the letter cannot clip a real section short."*

  it("ends a section at the letter's opening when the letter follows it with no heading between (P245)", async () => {
    const text = await plain(LETTER_LAST);
    // The letter opens at line 23; the section is 18–22, not 18–29.
    expect(letterRangeOf(linesOf(text))).toEqual({ from: 23, to: 28 });
    expect(sectionRangeOf(text, ["education"])).toEqual({ from: 18, to: 22 });
    expect(sectionRangeOf(text, ["employment"]), "a section closed by a heading is untouched").toEqual({ from: 8, to: 16 });
    const cut = await cutDocument(target("education.prior_qualifications"), text, model);
    expect(cut.checks.section).toEqual({ from: 18, to: 22 });
    expect(cut.checks.sectionEndedAt).toBe("letter");
    expect(cut.entries.map((e) => [e.from, e.to])).toEqual([[19, 21]]);
    expect(cut.checks.unassignedSectionLines, "no letter line counted against the section").toBe(0);
    expect(cut.entries[0]?.letterLines).toBe(0);
  });

  it("CANNOT clip a real section short: no letter, an opening with no closing, or an opening it does not know", async () => {
    // No letter at all: a last section runs to the end of the document, and says so.
    const plainEnd = await plain(LETTER_LAST.slice(0, LETTER_LAST.indexOf("Dear Hiring Manager")).trimEnd() + "\n");
    expect(sectionRangeOf(plainEnd, ["education"])).toEqual({ from: 18, to: 22 });
    expect((await cutDocument(target("education.prior_qualifications"), plainEnd, model)).checks.sectionEndedAt).toBe("document_end");

    // An opening with no closing after it is not a letter: a line that merely
    // begins "Dear" cannot cut a section short.
    const noClose = await plain(LETTER_LAST.replace("Yours sincerely,\n", ""));
    expect(letterRangeOf(linesOf(noClose))).toBeNull();
    // One line fewer than the document with its closing, and the section runs to the end.
    expect(sectionRangeOf(noClose, ["education"])).toEqual({ from: 18, to: 28 });

    // An opening the finder does not know: not found, not clipped, and the
    // report says "none found" rather than a wrong range.
    const unknown = await plain(LETTER_LAST.replace("Dear Hiring Manager,", "To the admissions team,"));
    expect(letterRangeOf(linesOf(unknown))).toBeNull();
    const cut = await cutDocument(target("education.prior_qualifications"), unknown, model);
    expect(cut.checks.section).toEqual({ from: 18, to: 29 });
    expect(cut.checks.sectionEndedAt).toBe("document_end");
    expect(cut.checks.letter).toBeNull();
  });

  it("a letter BEFORE the sections clips nothing: the opening must lie inside the section it would end", async () => {
    const text = await plain(PROSE);
    expect(sectionRangeOf(text, ["employment"])).toEqual({ from: 15, to: 23 });
    const cut = await cutDocument(target("employment.history"), text, model);
    expect(cut.checks.sectionEndedAt).toBe("heading");
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

describe("an entry whose parts all came back as one span is not a reading: marked unreadable, offered to be asked by hand (P266)", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Vahid, 2026-10-02, on the entry he left out: *"Award title: "Bachelor's
  // in Business Studies, Azad University, 2012" / Subject: same string /
  // Institution: same string / Level: same string … The model could not
  // decompose that CV line and returned the whole line for every part.
  // Grounding passed because the span is real … That is a reading failure
  // with no detector. Every part identical is a signature: a reading where N
  // parts share one span is not a reading, and the entry should be marked
  // unreadable and asked by hand rather than offered."*
  //
  // The threshold is mine, recorded as mine: one span shared by at least
  // three parts AND by more than half of the parts that returned a span. A
  // real reading shares spans — "BSc Computer Science" is the award title,
  // the subject and the words the level was read from; "2015 – 2019" is the
  // start and the end — but never most of its parts.
  // ═══════════════════════════════════════════════════════════════════════
  const LINE = "Bachelor's in Business Studies, Azad University, 2012";
  const BODY = `Education\nBSc Computer Science, University of Tehran, 2015 – 2019\n${LINE}\n`;
  /** Reads entry 1 the way a good reading would, and entry 2 the way Vahid's was read: the whole line for every part. */
  const SPANS: Readonly<Record<string, string>> = {
    awardTitle: "BSc Computer Science",
    subject: "BSc Computer Science",
    level: "BSc Computer Science",
    institution: "University of Tehran",
    start: "2015 – 2019",
    end: "2015 – 2019",
  };
  function readingAs(cut: Segmentation["entries"]): ModelClient {
    const base = cuttingAs(cut);
    return {
      ...base,
      extractFromDocument: <T>(request: ExtractionRequest<T>) => {
        const part = request.fieldKey.split(".").at(-1) ?? "";
        const span = request.documentText.includes("Azad") ? LINE : SPANS[part];
        if (span === undefined) return Promise.resolve({ kind: "not_understood" as const, reason: "not stated" });
        const value = request.parse(span);
        if (value === null) return Promise.resolve({ kind: "not_understood" as const, reason: "not stated" });
        return Promise.resolve(proposeValue({ value, origin: "document" as const, verbatim: span, confidence: 0.8, documentId: request.documentId }));
      },
    };
  }

  it("marks the entry whose parts share one span, keeps the one whose parts share spans the ordinary way, and holds nothing of the unreadable one's parts", async () => {
    const text = await plain(BODY);
    const lines = linesOf(text);
    // The cut numbers lines from one.
    const first = lines.findIndex((line) => line.startsWith("BSc")) + 1;
    const second = lines.findIndex((line) => line.startsWith("Bachelor's")) + 1;
    const reading = await readListEntries(target("education.prior_qualifications"), text, readingAs([{ from: first, to: first }, { from: second, to: second }]));
    expect(reading.entries).toHaveLength(2);
    const [good, bad] = reading.entries;
    expect(good?.unreadable, "three of six parts share a span: an ordinary reading").toBeNull();
    expect(good?.fields["institution"]).toBe("University of Tehran");
    expect(bad?.unreadable, "the words every part came back as").toBe(LINE);
    expect(bad?.dropped, "not held back: offered, to be asked by hand").toBeNull();
    expect(bad?.fields, "nothing of it is taken as read").toEqual({});
    expect(bad?.spans).toEqual({});
    expect(bad?.partial).toEqual({});
    expect(bad?.parts.find((part) => part.partKey === "institution")?.reason).toContain("parts came back as the same words");
  });
});
