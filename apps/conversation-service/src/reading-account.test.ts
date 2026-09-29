import { describe, expect, it } from "vitest";

import type { ReadingReport } from "@askimate/aas-contracts";

import { readingSentence, structureOf } from "./reading-account.js";

const itemLabel = (fieldKey: string): string | null => ({ "employment.history": "job", "education.prior_qualifications": "qualification" })[fieldKey] ?? null;

/** His live run of 2026-09-29, as a report: seven jobs, six complete; three qualifications, each one line. */
function hisRun(): ReadingReport {
  const job = (index: number, duties: boolean): ReadingReport["lists"] extends readonly (infer L)[] | undefined ? (L extends { entries: readonly (infer E)[] } ? E : never) : never => ({
    index,
    fields: { position: "P", employer: "E", employerAddress: "A", startDate: { year: 2015, month: 9 }, end: { kind: "current" }, ...(duties ? { duties: "D" } : {}) },
    spans: { position: "P", employer: "E", employerAddress: "A", startDate: "Sep 2015", end: "Present", ...(duties ? { duties: "D" } : {}) },
    confidence: 0.9,
    toAsk: duties ? ["basis"] : ["duties", "basis"],
    student: ["basis"],
  });
  return {
    leaseId: "rl_1",
    outcome: "read",
    lists: [
      { fieldKey: "employment.history", entries: [1, 2, 3, 4, 5, 6, 7].map((index) => job(index, index !== 6)), dropped: 0 },
      {
        fieldKey: "education.prior_qualifications",
        entries: [1, 2, 3].map((index) => ({
          index,
          fields: { awardTitle: "BSc", subject: "S", institution: "I", level: "Bachelor's degree" },
          spans: { awardTitle: "BSc S, I", subject: "BSc S, I", institution: "BSc S, I", level: "BSc S, I" },
          confidence: 0.9,
          toAsk: ["countryCode", "start", "end", "grade", "gradeScale"],
          student: ["countryCode"],
        })),
        dropped: 0,
      },
    ],
  };
}

describe("the account of a reading: the structure kept and the sentence said (P248)", () => {
  it("says his sentence, with his split: what the document did not say, and what is the student's to tell", () => {
    const structure = structureOf(hisRun(), new Set(["employment.history", "education.prior_qualifications"]));
    expect(readingSentence({ outcome: "read", structure, itemLabel })).toBe(
      "I read your CV and filled in seven jobs and three qualifications from it. " +
        "I still need a few things it did not say: for one job, what you did there; and for each qualification, when it started and ended, the grade and its scale. " +
        "And a few that are yours to tell me: for each job, whether it was full-time or part-time; and for each qualification, the country.",
    );
  });

  it("says the two other sentences as he printed them: a failed reading, and an entry it could not read whole", () => {
    expect(readingSentence({ outcome: "failed", itemLabel })).toBe("I could not read your CV as text, so I will ask you about your jobs and qualifications as usual.");
    const report = hisRun();
    const jobs = report.lists?.[0];
    if (jobs === undefined) return expect.unreachable("the run has jobs");
    const six: ReadingReport = { ...report, lists: [{ ...jobs, entries: jobs.entries.slice(0, 6), dropped: 1 }] };
    const structure = structureOf(six, new Set(["employment.history"]));
    expect(readingSentence({ outcome: "read", structure, itemLabel })).toContain("I read your CV and filled in six jobs; one I could not read whole, so I will ask you about it.");
    // Two lists, two unread: the noun tells them apart, and "them".
    const both: ReadingReport = { ...report, lists: [{ ...jobs, entries: jobs.entries.slice(0, 6), dropped: 1 }, { ...(report.lists?.[1] as NonNullable<ReadingReport["lists"]>[number]), dropped: 2 }] };
    expect(readingSentence({ outcome: "read", structure: structureOf(both, new Set(["employment.history", "education.prior_qualifications"])), itemLabel })).toContain(
      "filled in six jobs and three qualifications; one job and two qualifications I could not read whole, so I will ask you about them.",
    );
  });

  it("names a part read in part as the month, not the date: what the document gave is not asked again", () => {
    const report = hisRun();
    const studied = report.lists?.[1];
    if (studied === undefined) return expect.unreachable("the run has qualifications");
    const withYears: ReadingReport = {
      ...report,
      lists: [
        {
          ...studied,
          entries: studied.entries.map((entry) => ({
            ...entry,
            spans: { ...entry.spans, start: "2015", end: "2019" },
            partial: { start: { have: { year: 2015 }, lacking: ["month"] }, end: { have: { kind: "completed", year: 2019 }, lacking: ["month"] } },
          })),
        },
      ],
    };
    const structure = structureOf(withYears, new Set(["education.prior_qualifications"]));
    expect(structure.lists[0]?.entries[0]).toEqual({ index: 1, read: ["awardTitle", "subject", "institution", "level"], missing: ["grade", "gradeScale"], partial: { start: ["month"], end: ["month"] }, student: ["countryCode"] });
    expect(readingSentence({ outcome: "read", structure, itemLabel })).toBe(
      "I read your CV and filled in three qualifications from it. " +
        "I still need a few things it did not say: for each qualification, the grade and its scale, the months it started and ended. " +
        "And a few that are yours to tell me: for each qualification, the country.",
    );
  });

  it("says when nothing was seeded, and when the document gave everything", () => {
    const report = hisRun();
    expect(readingSentence({ outcome: "read", structure: structureOf(report, new Set()), itemLabel })).toBe("I read your CV. You had already told me about your jobs and qualifications, so I have kept what you said.");
    const jobs = report.lists?.[0];
    if (jobs === undefined) return expect.unreachable("the run has jobs");
    const complete: ReadingReport = { ...report, lists: [{ ...jobs, entries: jobs.entries.slice(0, 2).map((entry) => ({ ...entry, fields: { ...entry.fields, duties: "D", basis: "full_time" }, spans: { ...entry.spans, duties: "D", basis: "full time" }, toAsk: [], student: [] })), dropped: 0 }] };
    expect(readingSentence({ outcome: "read", structure: structureOf(complete, new Set(["employment.history"])), itemLabel })).toBe("I read your CV and filled in two jobs from it. It gave me everything I need about them.");
  });

  it("keeps a structure of part keys and counts only — never a value, never a span", () => {
    const structure = structureOf(hisRun(), new Set(["employment.history"]));
    const everything = JSON.stringify(structure);
    for (const word of ["Sep 2015", "Present", "BSc S, I", "Bachelor", '"P"', '"E"']) expect(everything, word).not.toContain(word);
    expect(structure.lists.map((list) => [list.fieldKey, list.seeded, list.entries.length, list.unread])).toEqual([
      ["employment.history", true, 7, 0],
      ["education.prior_qualifications", false, 3, 0],
    ]);
    expect(structure.lists[0]?.entries[5]).toEqual({ index: 6, read: ["position", "employer", "employerAddress", "startDate", "end"], missing: ["duties"], partial: {}, student: ["basis"] });
  });
});
