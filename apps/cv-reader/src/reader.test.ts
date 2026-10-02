import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { ClaimedReading, ReadingReport } from "@askimate/aas-contracts";
import { CV_LIST_FIELDS } from "@askimate/aas-contracts";
import type { ListReading } from "@askimate/aas-extraction";
import { planFor } from "@askimate/aas-extraction";
import { DeterministicModelClient } from "@askimate/aas-llm";

import { httpReadingIntake } from "./intake.js";
import { readDocument, readingOf } from "./read.js";
import { runOneTurn, startReaderSupervisor } from "./supervisor.js";

// ═══════════════════════════════════════════════════════════════════════════
// PROVEN AGAINST THE DETERMINISTIC CLIENT ONLY. The stand-in reads a line
// labelled "Position:"; whether the Bedrock client reads a real CV is what
// Vahid's live run shows. What IS real here: the bytes → text step through
// the real PDF library, the hash check, and the shape of what leaves this
// process — which is the whole of what the plane ever sees.
// ═══════════════════════════════════════════════════════════════════════════

const PDF = new Uint8Array(readFileSync(new URL("../../../packages/extraction/src/fixtures/cv.pdf", import.meta.url)));
const HASH = createHash("sha256").update(PDF).digest("hex");
const model = new DeterministicModelClient();

function claimFor(overrides: Partial<ClaimedReading> = {}): ClaimedReading {
  return {
    leaseId: "rl_1",
    expiresAt: "2026-09-28T20:05:00Z",
    documentId: "01JQDOC0000000000000000001",
    conversationId: "01JBXQ8Z9WKTQ6M4H2NPX23701",
    documentType: "cv",
    contentType: "application/pdf",
    contentHash: HASH,
    retrieval: { url: "https://vault.test/cv", method: "GET", expiresAt: "2026-09-28T20:01:00Z" },
    ...overrides,
  };
}

/** A bucket that answers the retrieval with the fixture, or with what the test says. */
function bucket(answer: () => Response | Promise<Response>): typeof globalThis.fetch {
  return (input) => {
    if (String(input instanceof Request ? input.url : input) !== "https://vault.test/cv") throw new Error("the reader fetched something other than the retrieval URL");
    return Promise.resolve(answer());
  };
}

describe("one document, read and forgotten (ADR-0148 §9, ADR-0149)", () => {
  it("reads the fixture CV into what the interview would have held — and names what it would ask", async () => {
    const report = await readDocument({ claim: claimFor(), model, fetch: bucket(() => new Response(PDF, { status: 200 })) });
    expect(report.outcome).toBe("read");
    const jobs = report.lists?.find((list) => list.fieldKey === "employment.history");
    expect(jobs?.entries).toHaveLength(2);
    expect(jobs?.dropped).toBe(0);
    expect(jobs?.entries[0]?.fields).toMatchObject({ position: "Data analyst", employer: "Pardis Analytics Ltd", end: { kind: "current" } });
    expect(jobs?.entries[0]?.spans["position"]).toContain("Position: Data analyst");
    // The basis is the student's to state: never asked of the document, so it is asked of the student — and the report says it is the student's (P248).
    expect(jobs?.entries[0]?.toAsk).toEqual(["basis"]);
    expect(jobs?.entries[0]?.student).toEqual(["basis"]);
    expect(jobs?.entries[0]?.partial).toBeUndefined();
    const studied = report.lists?.find((list) => list.fieldKey === "education.prior_qualifications");
    expect(studied?.entries).toHaveLength(1);
    expect(studied?.entries[0]?.fields).not.toHaveProperty("countryCode");
    // Vahid's end state: a qualification asking for its country, and nothing else.
    expect(studied?.entries[0]?.toAsk).toEqual(["countryCode"]);
    expect(studied?.entries[0]?.student).toEqual(["countryCode"]);
    // The stand-in has no usage figures; a Bedrock client's are the provider's.
    expect(report.usage).toBeUndefined();
  });

  it("REFUSES bytes that do not hash to what the plane said", async () => {
    const report = await readDocument({ claim: claimFor({ contentHash: "a".repeat(64) }), model, fetch: bucket(() => new Response(PDF, { status: 200 })) });
    expect(report).toEqual({ leaseId: "rl_1", outcome: "failed", failure: "content_changed" });
  });

  it("reports a retrieval that did not answer 200, and one that threw, as retrieval_failed", async () => {
    expect((await readDocument({ claim: claimFor(), model, fetch: bucket(() => new Response("gone", { status: 403 })) })).failure).toBe("retrieval_failed");
    expect((await readDocument({ claim: claimFor(), model, fetch: () => Promise.reject(new Error("no route")) })).failure).toBe("retrieval_failed");
  });

  it("reports a document nothing here reads as unreadable — a content type with no extractor, and a PDF with no PDF in it", async () => {
    const png = new Uint8Array([1, 2, 3]);
    const pngHash = createHash("sha256").update(png).digest("hex");
    expect((await readDocument({ claim: claimFor({ contentType: "image/png", contentHash: pngHash }), model, fetch: bucket(() => new Response(png, { status: 200 })) })).failure).toBe("unreadable");
    const notPdf = new TextEncoder().encode("not a pdf");
    const notPdfHash = createHash("sha256").update(notPdf).digest("hex");
    expect((await readDocument({ claim: claimFor({ contentHash: notPdfHash }), model, fetch: bucket(() => new Response(notPdf, { status: 200 })) })).failure).toBe("unreadable");
  });

  it("reads exactly the lists the plane asks about before reading: the plan's list targets are CV_LIST_FIELDS (P251)", () => {
    const targets = (planFor("cv")?.targets ?? []).filter((target) => target.kind === "list").map((target) => (target as { fieldKey: string }).fieldKey);
    expect([...targets].sort()).toEqual([...CV_LIST_FIELDS].sort());
  });

  it("carries no line of the document beyond the words of each field", async () => {
    const report = await readDocument({ claim: claimFor(), model, fetch: bucket(() => new Response(PDF, { status: 200 })) });
    const everything = JSON.stringify(report);
    // The fixture's name and email are on the CV and in no field the plan reads.
    for (const word of ["Niloofar", "Hosseini", "example.test"]) expect(everything, word).not.toContain(word);
  });
});

describe("the reader's turn: claim, read, report", () => {
  function plane(claimed: ClaimedReading | null, accept = true): { intake: ReturnType<typeof httpReadingIntake>; reports: ReadingReport[]; claims: number } {
    const state = { reports: [] as ReadingReport[], claims: 0 };
    const fetchPlane: typeof globalThis.fetch = (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/internal/v1/readings/claims")) {
        state.claims += 1;
        expect(new Headers(init?.headers).get("x-service-cert")).toBe("reader");
        return Promise.resolve(claimed === null ? new Response(null, { status: 204 }) : new Response(JSON.stringify(claimed), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (/\/internal\/v1\/readings\/[^/]+\/report$/.test(url)) {
        state.reports.push(JSON.parse(typeof init?.body === "string" ? init.body : "null") as ReadingReport);
        return Promise.resolve(new Response(null, { status: accept ? 204 : 403 }));
      }
      return Promise.resolve(new Response(PDF, { status: 200 }));
    };
    const intake = httpReadingIntake({ baseUrl: "http://plane.test", holder: "reader-1", serviceToken: "reader", fetch: fetchPlane });
    return { intake, reports: state.reports, get claims() { return state.claims; } };
  }

  it("is idle on a 204, and reads and reports on a claim", async () => {
    const idle = plane(null);
    expect(await runOneTurn(idle.intake, () => Promise.reject(new Error("not called"))))
      .toEqual({ kind: "idle" });

    const busy = plane(claimFor());
    const result = await runOneTurn(busy.intake, (claim) => readDocument({ claim, model, fetch: bucket(() => new Response(PDF, { status: 200 })) }));
    expect(result.kind).toBe("read");
    expect(busy.reports).toHaveLength(1);
    expect(busy.reports[0]?.outcome).toBe("read");
    expect(busy.reports[0]?.leaseId).toBe("rl_1");
  });

  it("reports a performer that THREW as reader_fault, repeating nothing of the throw", async () => {
    const busy = plane(claimFor());
    const result = await runOneTurn(busy.intake, () => Promise.reject(new Error("Dear Hiring Manager — a line of the CV inside an error")));
    expect(result.kind).toBe("read");
    expect(busy.reports[0]).toEqual({ leaseId: "rl_1", outcome: "failed", failure: "reader_fault" });
    expect(JSON.stringify(busy.reports)).not.toContain("Hiring Manager");
  });

  it("says report_refused when the plane no longer holds the lease for it", async () => {
    const lapsed = plane(claimFor(), false);
    const result = await runOneTurn(lapsed.intake, (claim) => Promise.resolve({ leaseId: claim.leaseId, outcome: "failed", failure: "unreadable" }));
    expect(result).toEqual({ kind: "report_refused", documentId: "01JQDOC0000000000000000001" });
  });

  it("refuses a claim the contract's parser refuses, and treats an unreachable plane as idle", async () => {
    const malformed = httpReadingIntake({
      baseUrl: "http://plane.test",
      holder: "reader-1",
      fetch: () => Promise.resolve(new Response(JSON.stringify({ leaseId: "x" }), { status: 200, headers: { "content-type": "application/json" } })),
    });
    expect(await malformed.claim()).toBeNull();
    const unreachable = httpReadingIntake({ baseUrl: "http://plane.test", holder: "reader-1", fetch: () => Promise.reject(new Error("ECONNREFUSED")) });
    expect(await unreachable.claim()).toBeNull();
    expect(await unreachable.report("doc", { leaseId: "x", outcome: "failed", failure: "unreadable" })).toBe(false);
  });

  it("the supervisor runs a turn on demand and stops waiting for the one in flight", async () => {
    const busy = plane(claimFor());
    const supervisor = startReaderSupervisor({
      intake: busy.intake,
      perform: (claim) => readDocument({ claim, model, fetch: bucket(() => new Response(PDF, { status: 200 })) }),
      idleIntervalMs: 60_000,
    });
    const result = await supervisor.runOnce();
    expect(result.kind).toBe("read");
    await supervisor.stop();
  });
});

describe("an unreadable entry is reported with its words and nothing taken (P266)", () => {
  it("offers the entry, with every part to ask and the words the parts came back as — not held back, not counted as dropped", () => {
    const LINE = "Bachelor's in Business Studies, Azad University, 2012";
    const parts = [{ partKey: "awardTitle" }, { partKey: "institution" }, { partKey: "countryCode" }, { partKey: "grade" }];
    const reading: ListReading = {
      fieldKey: "education.prior_qualifications",
      sectionLines: 2,
      cut: { entries: [], none: null, checks: { outsideDocument: [], overlapping: [], linesOutsideSection: 0, unassignedSectionLines: 0 } } as unknown as ListReading["cut"],
      entries: [
        {
          index: 1,
          lines: 1,
          parts: [
            { partKey: "awardTitle", source: "document", status: "unreadable", reason: "3 of the entry's 3 parts came back as the same words: the line, not its parts." },
            { partKey: "institution", source: "document", status: "unreadable" },
            { partKey: "countryCode", source: "student", status: "student" },
            { partKey: "grade", source: "document", status: "missing" },
          ],
          fields: {},
          spans: {},
          partial: {},
          lowestConfidence: 0.8,
          dropped: null,
          unreadable: LINE,
        },
      ],
    };
    const wire = readingOf(reading, parts);
    expect(wire.dropped).toBe(0);
    expect(wire.entries).toEqual([{ index: 1, fields: {}, spans: {}, confidence: 0.8, toAsk: ["awardTitle", "institution", "countryCode", "grade"], student: ["countryCode"], unreadable: LINE }]);
  });
});
