/**
 * The registration e-mail question's two answers reach the page (P312,
 * item 5). The server has sent `labels` on that `confirm_handoff` since P306;
 * the page's reader built every hashed decision in one generic branch that
 * never read them, so the page drew one button in its own words and never
 * the "No".
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { readRun } from "./transport.js";

function serve(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }))),
  );
}

const HASH = `sha256:${"e5".repeat(32)}`;
const LABELS = { yes: "Yes, it has arrived", no: "No, it has not arrived" };
const reading = (pending: unknown): unknown => ({ run: null, pending, ownActs: [], consent: null });

describe("a handoff question's two answers (P312, item 5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the server's two answers on a confirm_handoff", async () => {
    serve(reading({ decision: "confirm_handoff", contentHash: HASH, labels: LABELS }));
    const read = await readRun("c1");
    if (!read.ok) expect.unreachable(`refused: ${read.code}`);
    expect(read.value.pending).toEqual({ decision: "confirm_handoff", contentHash: HASH, labels: LABELS });
  });

  it("reads a confirm_handoff without labels as a one-answer handoff, as the hand-back is", async () => {
    serve(reading({ decision: "confirm_handoff", contentHash: HASH }));
    const read = await readRun("c1");
    if (!read.ok) expect.unreachable(`refused: ${read.code}`);
    expect(read.value.pending).toEqual({ decision: "confirm_handoff", contentHash: HASH });
    expect(read.value.pending !== null && "labels" in read.value.pending).toBe(false);
  });

  it("refuses labels on any decision but confirm_handoff", async () => {
    for (const decision of ["confirm_value", "authorise"]) {
      serve(reading({ decision, contentHash: HASH, labels: LABELS }));
      const read = await readRun("c1");
      expect(read.ok, decision).toBe(false);
      if (!read.ok) expect(read.code).toBe("contract_mismatch");
    }
  });

  it("refuses malformed labels rather than drawing one button in their place", async () => {
    const bad: unknown[] = [null, "Yes", [], {}, { yes: "Y" }, { no: "N" }, { yes: "", no: "N" }, { yes: "Y", no: "" }, { yes: 1, no: "N" }, { yes: "Y", no: "N", maybe: "M" }];
    for (const labels of bad) {
      serve(reading({ decision: "confirm_handoff", contentHash: HASH, labels }));
      const read = await readRun("c1");
      expect(read.ok, JSON.stringify(labels)).toBe(false);
      if (!read.ok) expect(read.code).toBe("contract_mismatch");
    }
  });

  it("refuses a decision it does not know, and a hash that is not a string, rather than drawing a button that cannot be answered", async () => {
    for (const pending of [
      { decision: "confirm_everything", contentHash: HASH },
      { decision: "confirm_handoff" },
      { decision: "confirm_handoff", contentHash: 42 },
    ]) {
      serve(reading(pending));
      const read = await readRun("c1");
      expect(read.ok, JSON.stringify(pending)).toBe(false);
      if (!read.ok) expect(read.code).toBe("contract_mismatch");
    }
  });
});
