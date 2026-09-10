/**
 * The runner's document source: the plane, the bucket, and the gate again.
 *
 * No network and no vault: the plane is a fake intake, the bucket a fake
 * fetch. What is real is `authoriseDisclosure` over the record the plane
 * handed over — the point of the source is that the brand is minted HERE,
 * by the gate, and not cast.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { WorkDocument } from "@askimate/aas-contracts";
import { DISCLOSE_DOCUMENT, b2Register } from "@askimate/aas-disclosure";

import { documentSourceFor } from "./document-source.js";

const NOW = new Date("2026-09-10T09:00:00Z");
const BYTES = Buffer.from("%PDF-1.7\n a synthetic passport, not a real one\n");
const HASH = createHash("sha256").update(BYTES).digest("hex");
const WORK = { runId: "run_1", leaseId: "wl_1", caseId: "case_1" };

function handed(over: Partial<WorkDocument> = {}, disclosureOver: Partial<WorkDocument["disclosure"]> = {}): WorkDocument {
  return {
    documentId: "01JQDOC0000000000000000001",
    documentType: "passport",
    contentHash: HASH,
    contentType: "application/pdf",
    retrieval: { url: "https://vault.test/documents/stu/x?sig=1", method: "GET", expiresAt: NOW.toISOString() },
    disclosure: {
      disclosureId: "disc_run_1_passport_upload",
      subject: {
        documentId: "01JQDOC0000000000000000001",
        documentType: "passport",
        contentHash: HASH,
        caseId: "case_1",
        requestedFor: "Upload your passport",
      },
      destination: { institutionName: "Example University", portalHost: "apply.example.test" },
      determinationId: DISCLOSE_DOCUMENT.determinationId,
      studentAuthorisation: {
        studentRef: "11111111-1111-1111-1111-111111111111",
        presentedText:
          "Documents that will be sent:\n  Upload your passport: your passport\n    going to: Example University (apply.example.test)",
        authorisedAt: NOW.toISOString(),
        method: "chat_affirmation",
      },
      ...disclosureOver,
    },
    ...over,
  };
}

function source(answer: WorkDocument | null, bytes: Buffer = BYTES, status = 200) {
  const asked: string[] = [];
  const fetched: string[] = [];
  const documents = documentSourceFor({
    intake: {
      document: (runId, leaseId, documentRef) => {
        asked.push(`${runId}/${leaseId}/${documentRef}`);
        return Promise.resolve(answer);
      },
    },
    work: WORK,
    register: b2Register(NOW),
    fetch: (url) => {
      fetched.push(typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url);
      return Promise.resolve(new Response(new Uint8Array(bytes), { status }));
    },
  });
  return { documents, asked, fetched };
}

describe("the runner's document source", () => {
  it("asks the plane under its lease, fetches the URL once, and mints the authorisation by the GATE", async () => {
    const { documents, asked, fetched } = source(handed());
    const document = await documents("passport");
    expect(asked).toEqual(["run_1/wl_1/passport"]);
    expect(fetched).toEqual(["https://vault.test/documents/stu/x?sig=1"]);
    if (document === null) expect.unreachable("a document");
    expect(document.documentId).toBe("01JQDOC0000000000000000001");
    expect(document.contentHash).toBe(HASH);
    expect(Buffer.from(document.contents).equals(BYTES)).toBe(true);
    // The brand came from `authoriseDisclosure`, so the record it wraps is
    // the record the plane handed over — readable, and naming the case.
    expect(document.authorisation.subject.caseId).toBe("case_1");
    expect(document.authorisation.determination.determinationId).toBe(DISCLOSE_DOCUMENT.determinationId);
  });

  it("answers null when the plane refuses, and fetches nothing", async () => {
    const { documents, fetched } = source(null);
    expect(await documents("passport")).toBeNull();
    expect(fetched).toEqual([]);
  });

  it("REFUSES a record about another case before fetching a byte", async () => {
    const { documents, fetched } = source(handed({}, { subject: { ...handed().disclosure.subject, caseId: "case_other" } }));
    expect(await documents("passport")).toBeNull();
    expect(fetched, "no byte was fetched for a record about another application").toEqual([]);
  });

  it("REFUSES bytes that do not hash to what the plane said", async () => {
    const { documents } = source(handed(), Buffer.from("not the passport"));
    expect(await documents("passport")).toBeNull();
  });

  it("REFUSES a retrieval that did not answer 200", async () => {
    const { documents } = source(handed(), BYTES, 403);
    expect(await documents("passport")).toBeNull();
  });

  it("REFUSES a determination this register does not hold", async () => {
    const { documents } = source(handed({}, { determinationId: "b2-9-invented" }));
    expect(await documents("passport")).toBeNull();
  });

  it("REFUSES an authorisation whose text does not name the document and the destination", async () => {
    // The gate, here: "Your documents will be sent" is not a preview (ADR-0098).
    const { documents } = source(
      handed({}, {
        studentAuthorisation: { ...handed().disclosure.studentAuthorisation, presentedText: "Your documents will be sent." },
      }),
    );
    expect(await documents("passport")).toBeNull();
  });
});
