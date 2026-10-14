/**
 * The page reads the date a submission made by hand was recorded as made on
 * (P308, his addition to D7): taken when it is the stated date, refused when
 * it is anything else, and absent from an older service reads as none.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { readRun } from "./transport.js";

function serve(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }))),
  );
}

const EMPTY = { run: null, pending: null, ownActs: [], consent: null };

describe("the run reading's submitted date (P308)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes the date as stated", async () => {
    serve({ ...EMPTY, submitted: { on: "2026-10-14" } });
    const read = await readRun("c1");
    if (!read.ok) expect.unreachable(`refused: ${read.code}`);
    expect(read.value.submitted).toEqual({ on: "2026-10-14" });
  });

  it("reads none from an older service, and none from null", async () => {
    serve(EMPTY);
    const older = await readRun("c1");
    if (!older.ok) expect.unreachable(`refused: ${older.code}`);
    expect(older.value.submitted).toBeNull();
    serve({ ...EMPTY, submitted: null });
    const none = await readRun("c1");
    if (!none.ok) expect.unreachable(`refused: ${none.code}`);
    expect(none.value.submitted).toBeNull();
  });

  it("refuses the whole read for a date it cannot trust, rather than showing a wrong one", async () => {
    for (const bad of [{ on: "14/10/2026" }, { on: 20261014 }, "2026-10-14", { at: "2026-10-14" }]) {
      serve({ ...EMPTY, submitted: bad });
      const read = await readRun("c1");
      expect(read.ok, JSON.stringify(bad)).toBe(false);
      if (!read.ok) expect(read.code).toBe("contract_mismatch");
    }
  });
});
