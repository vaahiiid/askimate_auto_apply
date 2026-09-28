import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DOCX_CONTENT_TYPE, PDF_CONTENT_TYPE } from "@askimate/aas-extraction";
import { DeterministicModelClient } from "@askimate/aas-llm";

import { contentTypeOf, measureDocument, renderMeasurement } from "./measure-cv-reading.js";

const PDF = new Uint8Array(readFileSync(new URL("../packages/extraction/src/fixtures/cv.pdf", import.meta.url)));
const DOCX = new Uint8Array(readFileSync(new URL("../packages/extraction/src/fixtures/cv.docx", import.meta.url)));

const ROOT = resolve(join(import.meta.dirname, ".."));
const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Runs the published command the way `pnpm run measure-cv` does. */
function run(args: readonly string[], env: NodeJS.ProcessEnv = {}): { readonly code: number | null; readonly out: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "scripts", "measure-cv-reading.ts"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 180_000,
    env: { ...process.env, ...env },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}`.replace(COLOUR, "") };
}

describe("the published command, spawned the way Vahid runs it (P240)", () => {
  it("REFUSES to run bare, and says what it wants", () => {
    const bare = run([]);
    expect(bare.code).toBe(2);
    expect(bare.out).toContain("usage:");
    expect(bare.out).toContain("--live");
  }, 60_000);

  it("reads the fixture CV through the stand-in and prints a report carrying nothing of it", () => {
    const report = run([join(ROOT, "packages", "extraction", "src", "fixtures", "cv.pdf")]);
    expect(report.code, report.out).toBe(0);
    expect(report.out).toContain("cut: 2 entries · 2 read whole");
    expect(report.out).toContain("No model was called");
    for (const word of ["Niloofar", "Pardis", "Valiasr", "Data analyst"]) expect(report.out, word).not.toContain(word);
  }, 120_000);

  it("REFUSES --live when Bedrock is not configured, rather than measuring against the stand-in", () => {
    const live = run(["--live", join(ROOT, "packages", "extraction", "src", "fixtures", "cv.pdf")], {
      AAS_BEDROCK_REGION: "",
      AAS_BEDROCK_MODEL_INTERVIEW: "",
      AAS_BEDROCK_MODEL_INTERPRETATION: "",
      AAS_BEDROCK_MODEL_DOCUMENT_EXTRACTION: "",
      AAS_BEDROCK_MODEL_NAVIGATION: "",
    });
    expect(live.code).not.toBe(0);
    expect(live.out).toContain("Bedrock is not configured");
    expect(live.out).not.toContain("entries:");
  }, 60_000);

  it("on the failure path, still says what left the client — here nothing, because it failed before a call (P243)", () => {
    // A file that does not exist fails inside the run, after the client is
    // built and before any request. No network is reached: nothing was called,
    // and the report says exactly that instead of a banner's claim.
    const failed = run(["--live", join(ROOT, "no-such-directory", "no-such-cv.pdf")], {
      AAS_BEDROCK_REGION: "eu-west-2",
      AAS_BEDROCK_MODEL_INTERVIEW: "anthropic.claude-sonnet-5",
      AAS_BEDROCK_MODEL_INTERPRETATION: "anthropic.claude-sonnet-5",
      AAS_BEDROCK_MODEL_DOCUMENT_EXTRACTION: "eu.anthropic.claude-sonnet-4-6",
      AAS_BEDROCK_MODEL_NAVIGATION: "anthropic.claude-sonnet-5",
    });
    expect(failed.code).toBe(1);
    expect(failed.out).toContain("nothing has been called yet");
    // The id he tried first, flagged before the run by its shape — not by a call.
    expect(failed.out).toContain("has the shape of an InvokeModel id");
    expect(failed.out).toContain("called: No request left the client (built for https://bedrock-mantle.eu-west-2.api.aws/anthropic, service bedrock-mantle)");
    expect(failed.out).toContain("usage: 0 call(s)");
    expect(failed.out).toContain("no-such-cv.pdf");
  }, 60_000);
});

describe("the CV reading measured, structure only (P240)", () => {
  // The fixture is a synthetic CV. The point of these tests is the SHAPE of
  // the measurement, and that it carries nothing of the document: Vahid runs
  // it on real people's CVs, and what comes back to the record is counts.
  it("counts the sections, the entries and the parts read, through the deterministic stand-in", async () => {
    const measured = await measureDocument({ name: "cv.pdf", contentType: PDF_CONTENT_TYPE, contents: PDF }, new DeterministicModelClient());
    expect(measured.pages).toBe(1);
    const jobs = measured.lists.find((list) => list.fieldKey === "employment.history");
    expect(jobs).toMatchObject({ sectionFound: true, entriesFound: 2, entriesReadWhole: 2, none: null });
    expect(jobs?.cut).toMatchObject({ outsideDocument: 0, overlapping: 0, unassignedSectionLines: 0, linesOutsideSection: 0, letter: null });
    expect(jobs?.entries.map((e) => [e.from, e.to, e.dateRanges, e.letterLines])).toEqual([
      [3, 8, 0, 0],
      [9, 14, 0, 0],
    ]);
    expect(jobs?.entries[0]?.read).toEqual(["position", "employer", "employerAddress", "startDate", "end", "duties"]);
    expect(jobs?.entries[0]?.missing, "basis is optional and not on the fixture").toEqual(["basis"]);
    const studied = measured.lists.find((list) => list.fieldKey === "education.prior_qualifications");
    expect(studied).toMatchObject({ sectionFound: true, entriesFound: 1, entriesReadWhole: 1 });
  });

  it("says a section was not found rather than reading nothing silently", async () => {
    const empty = new TextEncoder().encode("PK");
    await expect(measureDocument({ name: "x.docx", contentType: DOCX_CONTENT_TYPE, contents: empty }, new DeterministicModelClient())).rejects.toThrow();
    const measured = await measureDocument({ name: "cv.docx", contentType: DOCX_CONTENT_TYPE, contents: DOCX }, new DeterministicModelClient());
    expect(measured.lists.every((list) => list.sectionFound)).toBe(true);
  });

  it("carries no value, no span and no line of the document — in the report or its rendering", async () => {
    const measured = await measureDocument({ name: "cv.pdf", contentType: PDF_CONTENT_TYPE, contents: PDF }, new DeterministicModelClient());
    const everything = `${JSON.stringify(measured)}\n${renderMeasurement(measured)}`;
    for (const word of ["Niloofar", "Hosseini", "Pardis", "Valiasr", "Nikan", "Tehran", "Data analyst", "Computer science"]) {
      expect(everything, word).not.toContain(word);
    }
    expect(renderMeasurement(measured)).toContain("cut: 2 entries · 2 read whole");
  });

  it("reports the cut of a prose CV with a cover letter — ranges, detectors and what the stand-in could not read — carrying nothing of it", async () => {
    // The stand-in cuts the prose CV at its date ranges and reads no part of
    // it (no labels): the report shows the cut working and the reading not,
    // which is exactly what a free run is for.
    const prose = new TextEncoder().encode(readFileSync(new URL("../packages/extraction/src/fixtures/cv-prose.txt", import.meta.url), "utf8"));
    const measured = await measureDocument({ name: "cv-prose.docx", contentType: DOCX_CONTENT_TYPE, contents: prose }, new DeterministicModelClient()).catch(() => null);
    // A .docx it is not; the text extractor path is covered elsewhere. Measure the text directly.
    expect(measured).toBeNull();
    const text = readFileSync(new URL("../packages/extraction/src/fixtures/cv-prose.txt", import.meta.url), "utf8");
    const { PlainTextExtractor } = await import("@askimate/aas-extraction");
    const asText = await new PlainTextExtractor().textOf({ documentId: "m", documentType: "cv", contents: new TextEncoder().encode(text) });
    const { measureText } = await import("./measure-cv-reading.js");
    const report = await measureText("cv-prose.txt", "text/plain", asText, new DeterministicModelClient());
    const jobs = report.lists.find((list) => list.fieldKey === "employment.history");
    expect(jobs?.section).toEqual({ from: 15, to: 23 });
    expect(jobs?.cut.letter).toEqual({ from: 4, to: 9 });
    expect(jobs?.entries.map((e) => [e.from, e.to, e.dateRanges, e.letterLines])).toEqual([
      [16, 18, 1, 0],
      [20, 22, 1, 0],
    ]);
    expect(jobs?.entriesReadWhole, "the stand-in reads labels, and prose has none").toBe(0);
    const rendered = renderMeasurement(report);
    expect(rendered).toContain("cover letter: lines 4–9");
    for (const word of ["Pardis", "Nikan", "Hiring Manager", "poetry"]) expect(rendered, word).not.toContain(word);
  });

  it("reads a document's kind from its name, and refuses the rest", () => {
    expect(contentTypeOf("/tmp/my-cv.PDF")).toBe(PDF_CONTENT_TYPE);
    expect(contentTypeOf("cv.docx")).toBe(DOCX_CONTENT_TYPE);
    expect(contentTypeOf("cv.doc")).toBeUndefined();
    expect(contentTypeOf("scan.jpg")).toBeUndefined();
  });
});
