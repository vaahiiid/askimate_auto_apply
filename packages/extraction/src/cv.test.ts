import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { ProposedValue } from "@askimate/aas-domain";
import { proposeValue, unwrapProposed } from "@askimate/aas-domain";
import type { ExtractionRequest, ModelClient, NotUnderstood } from "@askimate/aas-llm";
import { DeterministicModelClient } from "@askimate/aas-llm";
import type { EmploymentEntry, Qualification } from "@askimate/aas-profile";

import { extractDocument, extracted } from "./extract.js";
import { DocxTextExtractor, PdfTextExtractor } from "./formats.js";
import { entriesOf, sectionOf } from "./sections.js";
import { PlainTextExtractor } from "./text.js";
import type { DocumentText } from "./text.js";

const model = new DeterministicModelClient();
const PDF = new Uint8Array(readFileSync(new URL("./fixtures/cv.pdf", import.meta.url)));
const DOCX = new Uint8Array(readFileSync(new URL("./fixtures/cv.docx", import.meta.url)));

async function plain(body: string): Promise<DocumentText> {
  return new PlainTextExtractor().textOf({ documentId: "doc_cv_text", documentType: "cv", contents: new TextEncoder().encode(body) });
}

function jobs(report: Awaited<ReturnType<typeof extractDocument>>): readonly EmploymentEntry[] {
  const found = report === null ? undefined : extracted(report).find((o) => o.fieldKey === "employment.history");
  return found === undefined ? [] : (unwrapProposed(found.proposed).value as readonly EmploymentEntry[]);
}

function qualifications(report: Awaited<ReturnType<typeof extractDocument>>): readonly Qualification[] {
  const found = report === null ? undefined : extracted(report).find((o) => o.fieldKey === "education.prior_qualifications");
  return found === undefined ? [] : (unwrapProposed(found.proposed).value as readonly Qualification[]);
}

describe("reading a CV: the jobs and the qualifications, each entry grounded (ADR-0148 §1, §9; stage two)", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // PROVEN AGAINST THE DETERMINISTIC CLIENT ONLY. Vahid, 2026-09-27: *"a
  // green test against a client that always returns the same thing proves
  // the wiring, not the reading."* The deterministic client reads a line
  // labelled "Position:"; a real CV has no such line, and whether the
  // Bedrock client reads prose into these parts is NOT shown here. What IS
  // real: the bytes → text step runs the real PDF and Word libraries on
  // real files, and every value below is checked against the document's
  // own text before it is accepted.
  // ═══════════════════════════════════════════════════════════════════════

  it("reads two jobs and one qualification out of the PDF, through the real PDF library", async () => {
    const text = await new PdfTextExtractor().textOf({ documentId: "doc_cv_pdf", documentType: "cv", contents: PDF });
    const report = await extractDocument(text, model);
    expect(report, "a CV has a plan").not.toBeNull();
    const found = jobs(report);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({
      position: "Data analyst",
      employer: "Pardis Analytics Ltd",
      employerAddress: "12 Valiasr Street, Tehran",
      startDate: { year: 2021, month: 9 },
      end: { kind: "current" },
      duties: "Built reporting pipelines and dashboards for retail clients.",
    });
    expect(found[1]).toMatchObject({
      position: "Junior developer",
      employer: "Nikan Software",
      startDate: { year: 2019, month: 6 },
      end: { kind: "ended", date: { year: 2021, month: 8 } },
    });
    const studied = qualifications(report);
    expect(studied).toHaveLength(1);
    expect(studied[0]).toMatchObject({
      awardTitle: "BSc",
      subject: "Computer science",
      institution: "University of Tehran",
      countryCode: "IR",
      level: "Bachelor's degree",
      start: { year: 2015, month: 9 },
      end: { kind: "completed", date: { year: 2019, month: 6 } },
      grade: "17.2",
      gradeScale: "twenty_point",
    });
  });

  it("reads the same out of the Word file, through the real .docx library", async () => {
    const text = await new DocxTextExtractor().textOf({ documentId: "doc_cv_docx", documentType: "cv", contents: DOCX });
    const report = await extractDocument(text, model);
    expect(jobs(report).map((job) => job.position)).toEqual(["Data analyst", "Junior developer"]);
    expect(qualifications(report).map((q) => q.institution)).toEqual(["University of Tehran"]);
  });

  it("every reading is from the document: the proposal quotes the lines it was read from, with the document's id", async () => {
    const text = await new PdfTextExtractor().textOf({ documentId: "doc_cv_pdf", documentType: "cv", contents: PDF });
    const report = await extractDocument(text, model);
    const found = report === null ? undefined : extracted(report).find((o) => o.fieldKey === "employment.history");
    if (found === undefined) throw new Error("no jobs");
    const fields = unwrapProposed(found.proposed);
    expect(fields.origin).toBe("document");
    expect(fields.documentId).toBe("doc_cv_pdf");
    expect(fields.verbatim).toContain("Position: Data analyst");
    expect(fields.verbatim).toContain("Employer: Nikan Software");
  });

  it("drops an entry a required part is missing from, says which, and keeps the others", async () => {
    const text = await plain(
      "Employment\nPosition: Data analyst\nEmployer: Pardis Analytics Ltd\nEmployer address: Tehran\nStart: September 2021\nEnd: Present\nDuties: Reporting.\n" +
        "Position: Mystery job\nStart: January 2018\nEnd: March 2018\nDuties: Unknown.\n",
    );
    const report = await extractDocument(text, model);
    expect(jobs(report).map((job) => job.position)).toEqual(["Data analyst"]);
    const dropped = report?.outcomes.find((o) => o.kind === "not_found" && o.targetKey === "employment.history[2]");
    expect(dropped, "the dropped entry is on the report, by its position").toBeDefined();
    expect(dropped?.kind === "not_found" ? dropped.reason : "").toContain("employer");
  });

  it("reports nothing to list — not an error — when the CV has no such section", async () => {
    const text = await plain("Niloofar Hosseini\nA short note with no sections at all.\n");
    const report = await extractDocument(text, model);
    expect(jobs(report)).toEqual([]);
    const none = report?.outcomes.find((o) => o.targetKey === "employment.history");
    expect(none?.kind).toBe("not_found");
    expect(none?.kind === "not_found" ? none.required : true, "a CV need not list any").toBe(false);
  });

  it("REJECTS an entry whose quoted span is not in the document — a model that invents a job invents nothing here", async () => {
    // A model that returns a plausible employer with a span the document does
    // not contain. The grounding guard discards the reading and says so.
    const inventing: ModelClient = {
      ...model,
      composeQuestion: (request) => model.composeQuestion(request),
      composeDocumentRequest: (request) => model.composeDocumentRequest(request),
      interpretAnswer: (request) => model.interpretAnswer(request),
      extractFromDocument: <T>(request: ExtractionRequest<T>): Promise<ProposedValue<T> | NotUnderstood> =>
        request.fieldKey.endsWith(".employer")
          ? Promise.resolve(
              proposeValue({ value: request.parse("Acme Global plc") as T, origin: "document", verbatim: "Employer: Acme Global plc", confidence: 0.9, documentId: request.documentId }),
            )
          : model.extractFromDocument(request),
    };
    const text = await plain("Employment\nPosition: Data analyst\nEmployer: Pardis Analytics Ltd\nEmployer address: Tehran\nStart: September 2021\nEnd: Present\nDuties: Reporting.\n");
    const report = await extractDocument(text, inventing);
    expect(jobs(report)).toEqual([]);
    const rejected = report?.outcomes.find((o) => o.kind === "rejected_ungrounded");
    expect(rejected?.kind === "rejected_ungrounded" ? rejected.claimedSpan : "").toBe("Employer: Acme Global plc");
  });
});

describe("the sections and entries of a CV, found by code (stage two)", () => {
  // Deterministic and said so: a heading line opens a section, the next
  // heading closes it, and an entry begins at each line carrying the entry's
  // first label. A real CV laid out differently is not read by this — that
  // is the limit stage three's model reading has to meet, not this code.
  it("finds the employment section under any of its headings and splits it at the first label", async () => {
    const text = await plain("Summary\nHello.\nWork experience\nPosition: A\nEmployer: X\nPosition: B\nEmployer: Y\nEducation\nQualification: BSc\n");
    const section = sectionOf(text, ["employment", "work experience", "experience"]);
    expect(section.map((line) => line.trim())).toEqual(["Position: A", "Employer: X", "Position: B", "Employer: Y"]);
    expect(entriesOf(section, ["Position"])).toEqual([
      ["Position: A", "Employer: X"],
      ["Position: B", "Employer: Y"],
    ]);
  });

  it("finds nothing where there is no heading, rather than reading the whole document as one entry", async () => {
    const text = await plain("Position: A\nEmployer: X\n");
    expect(sectionOf(text, ["employment"])).toEqual([]);
  });
});
