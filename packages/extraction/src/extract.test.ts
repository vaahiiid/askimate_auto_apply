import { describe, expect, it } from "vitest";

import type { ModelText, ProposedValue } from "@askimate/aas-domain";
import { proposeValue, unwrapProposed } from "@askimate/aas-domain";
import type {
  DocumentRequest,
  ExtractionRequest,
  InterpretationRequest,
  ModelClient,
  NotUnderstood,
  QuestionRequest,
} from "@askimate/aas-llm";
import { DeterministicModelClient } from "@askimate/aas-llm";

import {
  extractDocument,
  extracted,
  missingRequired,
  proposedFields,
  ungrounded,
} from "./extract.js";
import { PlainTextExtractor } from "./text.js";
import type { DocumentText } from "./text.js";
import {
  BANK_STATEMENT_TEXT,
  PASSPORT_MISSING_EXPIRY,
  PASSPORT_TEXT,
  TRANSCRIPT_TEXT,
  bytesOf,
} from "./fixtures/documents.js";

const model = new DeterministicModelClient();
const extractor = new PlainTextExtractor();

async function textOf(documentId: string, documentType: DocumentText["documentType"], body: string) {
  return extractor.textOf({ documentId, documentType, contents: bytesOf(body) });
}

describe("extracting a passport", () => {
  it("reads the fields the plan asks for", async () => {
    const text = await textOf("doc-passport", "passport", PASSPORT_TEXT);
    const report = await extractDocument(text, model);
    if (report === null) expect.unreachable("there is a plan for passports");

    const byKey = new Map(
      extracted(report).map((outcome) => [outcome.targetKey, unwrapProposed(outcome.proposed)]),
    );

    expect(byKey.get("identity.family_name")?.value).toBe("HOSSEINI");
    expect(byKey.get("identity.given_name")?.value).toBe("NILOOFAR");
    expect(byKey.get("identity.passport_number")?.value).toBe("K12345678");
    expect(byKey.get("identity.nationality")?.value).toBe("IRANIAN");
    expect(byKey.get("identity.date_of_birth")?.value).toEqual(new Date("1999-04-02T00:00:00Z"));
    expect(byKey.get("identity.passport_expiry")?.value).toEqual(new Date("2031-06-13T00:00:00Z"));
    expect(byKey.get("document.expiresAt")?.value).toEqual(new Date("2031-06-13T00:00:00Z"));
  });

  it("quotes the line it read, and that line is really in the document", async () => {
    const text = await textOf("doc-passport", "passport", PASSPORT_TEXT);
    const report = await extractDocument(text, model);
    if (report === null) expect.unreachable("there is a plan for passports");

    for (const outcome of extracted(report)) {
      const { verbatim } = unwrapProposed(outcome.proposed);
      expect(PASSPORT_TEXT).toContain(verbatim);
    }
  });

  it("prefers the longer label — expiry is not read as the date of issue", async () => {
    const text = await textOf("doc-passport", "passport", PASSPORT_TEXT);
    const report = await extractDocument(text, model);
    if (report === null) expect.unreachable("there is a plan for passports");

    const byKey = new Map(
      extracted(report).map((outcome) => [outcome.targetKey, unwrapProposed(outcome.proposed)]),
    );
    expect(byKey.get("document.issuedAt")?.value).toEqual(new Date("2021-06-14T00:00:00Z"));
    expect(byKey.get("document.expiresAt")?.value).toEqual(new Date("2031-06-13T00:00:00Z"));
  });

  it("reports a required field the document does not carry, rather than inventing it", async () => {
    const text = await textOf("doc-passport", "passport", PASSPORT_MISSING_EXPIRY);
    const report = await extractDocument(text, model);
    if (report === null) expect.unreachable("there is a plan for passports");

    expect(missingRequired(report)).toContain("identity.passport_expiry");
    expect(extracted(report).map((o) => o.targetKey)).not.toContain("identity.passport_expiry");
  });

  it("produces proposals, never confirmed values", async () => {
    const text = await textOf("doc-passport", "passport", PASSPORT_TEXT);
    const report = await extractDocument(text, model);
    if (report === null) expect.unreachable("there is a plan for passports");

    for (const { proposed } of proposedFields(report)) {
      expect(unwrapProposed(proposed).origin).toBe("document");
      expect(unwrapProposed(proposed).documentId).toBe("doc-passport");
    }
  });
});

describe("extracting a transcript", () => {
  it("assembles the qualification from parts, each quoted separately", async () => {
    const text = await textOf("doc-transcript", "academic_transcript", TRANSCRIPT_TEXT);
    const report = await extractDocument(text, model);
    if (report === null) expect.unreachable("there is a plan for transcripts");

    const [outcome] = extracted(report);
    expect(outcome?.targetKey).toBe("education.highest_qualification");

    const fields = unwrapProposed(outcome?.proposed as ProposedValue<unknown>);
    expect(fields.value).toEqual({
      level: "Bachelor of Science",
      subject: "Industrial Engineering",
      institution: "Amirkabir University of Technology",
      countryCode: "Iran",
      completionYear: 2022,
      grade: "17.42",
      gradeScale: "20-point scale",
    });

    // Every part traces to a line of the document.
    for (const span of fields.verbatim.split("\n")) {
      expect(TRANSCRIPT_TEXT).toContain(span);
    }
  });

  it("keeps the grade exactly as printed and does not convert it", async () => {
    const text = await textOf("doc-transcript", "academic_transcript", TRANSCRIPT_TEXT);
    const report = await extractDocument(text, model);
    if (report === null) expect.unreachable("there is a plan for transcripts");

    const value = unwrapProposed(
      extracted(report)[0]?.proposed as ProposedValue<unknown>,
    ).value as { grade: string; gradeScale: string };

    // 17.42/20 is roughly a UK first. The system does not say so here: that
    // conversion is a mapping decision with its own provenance, not a silent
    // rewrite of what the university awarded.
    expect(value.grade).toBe("17.42");
    expect(value.gradeScale).toBe("20-point scale");
  });

  it("fails the whole qualification when a required part is missing", async () => {
    const withoutSubject = TRANSCRIPT_TEXT.split("\n")
      .filter((line) => !line.startsWith("Subject:"))
      .join("\n");
    const text = await textOf("doc-transcript", "academic_transcript", withoutSubject);
    const report = await extractDocument(text, model);
    if (report === null) expect.unreachable("there is a plan for transcripts");

    // Not "six sevenths of a qualification". No qualification.
    expect(extracted(report)).toHaveLength(0);
    expect(missingRequired(report)).toEqual(["education.highest_qualification"]);
  });
});

describe("extracting a bank statement", () => {
  it("reads the closing date the recency window is measured from", async () => {
    const text = await textOf("doc-statement", "bank_statement", BANK_STATEMENT_TEXT);
    const report = await extractDocument(text, model);
    if (report === null) expect.unreachable("there is a plan for bank statements");

    const byKey = new Map(
      extracted(report).map((outcome) => [outcome.targetKey, unwrapProposed(outcome.proposed)]),
    );
    expect(byKey.get("document.coversTo")?.value).toEqual(new Date("2026-07-31T00:00:00Z"));
    expect(byKey.get("document.coversFrom")?.value).toEqual(new Date("2026-07-01T00:00:00Z"));
  });
});

describe("a document type with no plan", () => {
  it("returns null — which is not the same as finding nothing", async () => {
    const text = await textOf("doc-other", "reference_letter", "Dear Sir or Madam,");
    expect(await extractDocument(text, model)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The attack: a model that invents
// ───────────────────────────────────────────────────────────────────────────

/**
 * A model that returns confident, well-formed, entirely fabricated readings.
 *
 * Not a strawman. This is what a real model does on a blurry photograph when
 * it has seen ten thousand passports and this one's number is illegible: it
 * produces something that looks exactly like a passport number.
 */
class ConfabulatingModelClient implements ModelClient {
  public composeQuestion(_request: QuestionRequest): Promise<ModelText> {
    return Promise.reject(new Error("not used"));
  }
  public composeDocumentRequest(_request: DocumentRequest): Promise<ModelText> {
    return Promise.reject(new Error("not used"));
  }
  public interpretAnswer<T>(
    _request: InterpretationRequest<T>,
  ): Promise<ProposedValue<T> | NotUnderstood> {
    return Promise.reject(new Error("not used"));
  }
  public extractFromDocument<T>(
    request: ExtractionRequest<T>,
  ): Promise<ProposedValue<T> | NotUnderstood> {
    const invented = request.fieldKey.includes("date") || request.fieldKey.includes("expir")
      ? "01 JAN 2030"
      : "K99999999";
    const parsed = request.parse(invented);
    if (parsed === null) {
      return Promise.resolve({ kind: "not_understood", reason: "n/a" });
    }
    return Promise.resolve(
      proposeValue({
        value: parsed,
        origin: "document",
        // A quoted span that reads exactly like a real line — and is not one.
        verbatim: `${request.labels[0] ?? "Field"}: ${invented}`,
        confidence: 1,
        documentId: request.documentId,
      }),
    );
  }
}

describe("a model that invents values", () => {
  it("has every reading DISCARDED, at confidence 1.0", async () => {
    const text = await textOf("doc-passport", "passport", PASSPORT_TEXT);
    const report = await extractDocument(text, new ConfabulatingModelClient());
    if (report === null) expect.unreachable("there is a plan for passports");

    expect(extracted(report)).toHaveLength(0);
    expect(ungrounded(report).length).toBeGreaterThan(0);
  });

  it("reports invention distinctly from 'the document did not say'", async () => {
    const text = await textOf("doc-passport", "passport", PASSPORT_TEXT);
    const report = await extractDocument(text, new ConfabulatingModelClient());
    if (report === null) expect.unreachable("there is a plan for passports");

    const rejected = ungrounded(report)[0];
    expect(rejected?.kind).toBe("rejected_ungrounded");
    expect(rejected?.claimedSpan).toContain("K99999999");
    // Counting these is how a degrading text layer or a bad model becomes
    // visible, rather than being absorbed as "documents were unclear lately".
    expect(rejected?.reason).toContain("does not appear in the document");
  });

  it("discards the whole qualification when ONE part is invented", async () => {
    const text = await textOf("doc-transcript", "academic_transcript", TRANSCRIPT_TEXT);

    class OneLiePerTranscript implements ModelClient {
      readonly #honest = new DeterministicModelClient();
      public composeQuestion(request: QuestionRequest): Promise<ModelText> {
        return this.#honest.composeQuestion(request);
      }
      public composeDocumentRequest(request: DocumentRequest): Promise<ModelText> {
        return this.#honest.composeDocumentRequest(request);
      }
      public interpretAnswer<T>(
        request: InterpretationRequest<T>,
      ): Promise<ProposedValue<T> | NotUnderstood> {
        return this.#honest.interpretAnswer(request);
      }
      public extractFromDocument<T>(
        request: ExtractionRequest<T>,
      ): Promise<ProposedValue<T> | NotUnderstood> {
        if (!request.fieldKey.endsWith(".grade")) {
          return this.#honest.extractFromDocument(request);
        }
        const parsed = request.parse("19.80");
        if (parsed === null) return Promise.resolve({ kind: "not_understood", reason: "n/a" });
        return Promise.resolve(
          proposeValue({
            value: parsed,
            origin: "document",
            verbatim: "Overall grade: 19.80",
            confidence: 0.99,
            documentId: request.documentId,
          }),
        );
      }
    }

    const report = await extractDocument(text, new OneLiePerTranscript());
    if (report === null) expect.unreachable("there is a plan for transcripts");

    // Six true facts and one improved grade is not a qualification.
    expect(extracted(report)).toHaveLength(0);
    expect(ungrounded(report)[0]?.reason).toContain("grade");
  });
});
