import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { ProposedValue } from "@askimate/aas-domain";
import { proposeValue } from "@askimate/aas-domain";
import type { ExtractionRequest, ModelClient, NotUnderstood } from "@askimate/aas-llm";
import { DeterministicModelClient } from "@askimate/aas-llm";

import { readListEntries } from "./extract.js";
import { planFor } from "./plans.js";
import type { ListTarget } from "./plans.js";
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

describe("reading a CV: the jobs and the qualifications, each entry grounded (ADR-0148 §1, §9; stage two, reshaped by ADR-0149)", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // PROVEN AGAINST THE DETERMINISTIC CLIENT ONLY. Vahid, 2026-09-27: *"a
  // green test against a client that always returns the same thing proves
  // the wiring, not the reading."* The deterministic client reads a line
  // labelled "Position:"; a real CV has no such line, and whether the
  // Bedrock client reads prose into these parts is NOT shown here. What IS
  // real: the bytes → text step runs the real PDF and Word libraries on
  // real files, and every value below is checked against the document's
  // own text before it is accepted.
  //
  // Since ADR-0149 an entry is not a whole value: it is what the document
  // gave (`fields`, parsed), what it did not (`missing`, `unparsed`), and
  // what was never asked of it (`student`). The interview asks the rest.
  // ═══════════════════════════════════════════════════════════════════════

  async function read(text: DocumentText, fieldKey: "employment.history" | "education.prior_qualifications", client: ModelClient = model) {
    const target = planFor("cv")?.targets.find((t): t is ListTarget => t.kind === "list" && t.fieldKey === fieldKey);
    if (target === undefined) throw new Error("no list target");
    return readListEntries(target, text, client);
  }

  it("reads two jobs and one qualification out of the PDF, through the real PDF library", async () => {
    const text = await new PdfTextExtractor().textOf({ documentId: "doc_cv_pdf", documentType: "cv", contents: PDF });
    const found = await read(text, "employment.history");
    expect(found.entries).toHaveLength(2);
    expect(found.entries[0]?.fields).toEqual({
      position: "Data analyst",
      employer: "Pardis Analytics Ltd",
      employerAddress: "12 Valiasr Street, Tehran",
      startDate: { year: 2021, month: 9 },
      end: { kind: "current" },
      duties: "Built reporting pipelines and dashboards for retail clients.",
    });
    expect(found.entries[1]?.fields).toMatchObject({
      position: "Junior developer",
      employer: "Nikan Software",
      startDate: { year: 2019, month: 6 },
      end: { kind: "ended", date: { year: 2021, month: 8 } },
    });
    // The student's to state: never read, even off a fixture that prints it.
    expect(found.entries[0]?.parts.find((part) => part.partKey === "basis")?.status).toBe("student");
    expect(found.entries.every((entry) => entry.dropped === null)).toBe(true);

    const studied = await read(text, "education.prior_qualifications");
    expect(studied.entries).toHaveLength(1);
    expect(studied.entries[0]?.fields).toEqual({
      awardTitle: "BSc",
      subject: "Computer science",
      institution: "University of Tehran",
      level: "Bachelor's degree",
      start: { year: 2015, month: 9 },
      end: { kind: "completed", date: { year: 2019, month: 6 } },
      grade: "17.2",
      gradeScale: "twenty_point",
    });
    expect(studied.entries[0]?.fields).not.toHaveProperty("countryCode");
    expect(studied.entries[0]?.parts.find((part) => part.partKey === "countryCode")?.status).toBe("student");
  });

  it("reads the same out of the Word file, through the real .docx library", async () => {
    const text = await new DocxTextExtractor().textOf({ documentId: "doc_cv_docx", documentType: "cv", contents: DOCX });
    expect((await read(text, "employment.history")).entries.map((entry) => entry.fields["position"])).toEqual(["Data analyst", "Junior developer"]);
    expect((await read(text, "education.prior_qualifications")).entries.map((entry) => entry.fields["institution"])).toEqual(["University of Tehran"]);
  });

  it("every reading is from the document: each part carries the line it was read from", async () => {
    const text = await new PdfTextExtractor().textOf({ documentId: "doc_cv_pdf", documentType: "cv", contents: PDF });
    const found = await read(text, "employment.history");
    expect(found.entries[0]?.spans["position"]).toContain("Position: Data analyst");
    expect(found.entries[1]?.spans["employer"]).toContain("Employer: Nikan Software");
    expect(Object.keys(found.entries[0]?.spans ?? {})).toEqual(Object.keys(found.entries[0]?.fields ?? {}));
  });

  it("KEEPS an entry a part is missing from — the interview asks for it — and says which (ADR-0149)", async () => {
    // Before ADR-0149 the second job was dropped for its missing employer. A
    // required part is required of the application, not of the document.
    const text = await plain(
      "Employment\nPosition: Data analyst\nEmployer: Pardis Analytics Ltd\nEmployer address: Tehran\nStart: September 2021\nEnd: Present\nDuties: Reporting.\n" +
        "Position: Mystery job\nStart: January 2018\nEnd: March 2018\nDuties: Unknown.\n",
    );
    const found = await read(text, "employment.history");
    expect(found.entries.map((entry) => entry.fields["position"])).toEqual(["Data analyst", "Mystery job"]);
    const second = found.entries[1];
    expect(second?.dropped).toBeNull();
    expect(second?.parts.filter((part) => part.status === "missing").map((part) => part.partKey)).toEqual(["employer", "employerAddress"]);
    expect(second?.fields).not.toHaveProperty("employer");
  });

  it("keeps a part the parser refuses as UNPARSED, never as a guess: 'BSc' is not a level", async () => {
    const text = await plain("Education\nQualification: BSc\nSubject: Computer science\nInstitution: University of Tehran\nLevel: BSc\nStart: September 2015\nEnd: June 2019\nGrade: 17.2\nGrade scale: 20-point\n");
    const studied = await read(text, "education.prior_qualifications");
    const level = studied.entries[0]?.parts.find((part) => part.partKey === "level");
    expect(level?.status).toBe("unparsed");
    expect(studied.entries[0]?.fields).not.toHaveProperty("level");
    expect(studied.entries[0]?.fields["awardTitle"]).toBe("BSc");
  });

  it("reports nothing to list — not an error — when the CV has no such section", async () => {
    const text = await plain("Niloofar Hosseini\nA short note with no sections at all.\n");
    const found = await read(text, "employment.history");
    expect(found.entries).toEqual([]);
    expect(found.sectionLines).toBe(0);
  });

  it("DROPS an entry whose quoted span is not in the document — a model that invents a job invents nothing here", async () => {
    // A model that returns a plausible employer with a span the document does
    // not contain. The grounding guard discards the reading and the entry.
    const inventing: ModelClient = {
      ...model,
      composeQuestion: (request) => model.composeQuestion(request),
      composeDocumentRequest: (request) => model.composeDocumentRequest(request),
      interpretAnswer: (request) => model.interpretAnswer(request),
      segmentDocument: (request) => model.segmentDocument(request),
      extractFromDocument: <T>(request: ExtractionRequest<T>): Promise<ProposedValue<T> | NotUnderstood> =>
        request.fieldKey.endsWith(".employer")
          ? Promise.resolve(
              proposeValue({ value: request.parse("Acme Global plc") as T, origin: "document", verbatim: "Employer: Acme Global plc", confidence: 0.9, documentId: request.documentId }),
            )
          : model.extractFromDocument(request),
    };
    const text = await plain("Employment\nPosition: Data analyst\nEmployer: Pardis Analytics Ltd\nEmployer address: Tehran\nStart: September 2021\nEnd: Present\nDuties: Reporting.\n");
    const found = await read(text, "employment.history", inventing);
    expect(found.entries).toHaveLength(1);
    expect(found.entries[0]?.dropped).toContain("employer");
    expect(found.entries[0]?.fields).toEqual({});
    const rejected = found.entries[0]?.parts.find((part) => part.status === "ungrounded");
    expect(rejected?.claimedSpan).toBe("Employer: Acme Global plc");
    expect(found.entries[0]?.parts.filter((part) => part.status === "skipped").length, "nothing after it is read").toBeGreaterThan(0);
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

// ── ADR-0149: some parts are the student's to state, never asked of a document ──
//
// Vahid, 2026-09-28: *"Asked for the country of 'University of Tehran', a
// model answers Iran and finds a span to ground it. Grounding does not catch
// it because the span is real — what is missing is that the student never
// stated it."* So the boundary is held BEFORE the model: a part marked as
// the student's is never in a request. The test records every part the
// model is asked for.

describe("a part that is the student's to state is never asked of the document (ADR-0149, P246)", () => {
  it("never sends the model a request for the country of a qualification or the basis of a job — even when the document prints them", async () => {
    const asked: string[] = [];
    const recording: ModelClient = {
      ...model,
      composeQuestion: (request) => model.composeQuestion(request),
      composeDocumentRequest: (request) => model.composeDocumentRequest(request),
      interpretAnswer: (request) => model.interpretAnswer(request),
      segmentDocument: (request) => model.segmentDocument(request),
      extractFromDocument: <T>(request: ExtractionRequest<T>): Promise<ProposedValue<T> | NotUnderstood> => {
        asked.push(request.fieldKey);
        return model.extractFromDocument(request);
      },
    };
    const text = await new PdfTextExtractor().textOf({ documentId: "doc_cv_pdf", documentType: "cv", contents: PDF });
    const plan = planFor("cv");
    for (const target of plan?.targets ?? []) {
      if (target.kind === "list") await readListEntries(target, text, recording);
    }
    expect(asked.length, "the document parts were read").toBeGreaterThan(0);
    expect(asked.filter((key) => key.endsWith(".countryCode")), "the fixture prints a Country line; it is still never asked").toEqual([]);
    expect(asked.filter((key) => key.endsWith(".basis"))).toEqual([]);
  });
});
