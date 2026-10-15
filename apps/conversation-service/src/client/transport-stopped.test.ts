/**
 * The page reads whether the application is stopped, and whether the stop has
 * concluded (P313, his findings 2 and 3): taken when it is the service's
 * shape, refused when it is anything else, and absent from an older service
 * reads as not stopped.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { readRun } from "./transport.js";

function serve(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }))),
  );
}

const EMPTY = { run: null, pending: null, ownActs: [], consent: null, submitted: null };

describe("the run reading's stop (P313)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes a stop, winding down or concluded", async () => {
    for (const concluded of [false, true]) {
      serve({ ...EMPTY, stopped: { concluded } });
      const read = await readRun("c1");
      if (!read.ok) expect.unreachable(`refused: ${read.code}`);
      expect(read.value.stopped).toEqual({ concluded });
    }
  });

  it("reads not stopped from an older service, and from null", async () => {
    serve(EMPTY);
    const older = await readRun("c1");
    if (!older.ok) expect.unreachable(`refused: ${older.code}`);
    expect(older.value.stopped).toBeNull();
    serve({ ...EMPTY, stopped: null });
    const none = await readRun("c1");
    if (!none.ok) expect.unreachable(`refused: ${none.code}`);
    expect(none.value.stopped).toBeNull();
  });

  it("refuses the whole read for a stop it cannot read, rather than drawing a stop button or a new application on a guess", async () => {
    for (const bad of [true, "concluded", { concluded: "yes" }, {}, { finished: true }]) {
      serve({ ...EMPTY, stopped: bad });
      const read = await readRun("c1");
      expect(read.ok, JSON.stringify(bad)).toBe(false);
      if (!read.ok) expect(read.code).toBe("contract_mismatch");
    }
  });
});
