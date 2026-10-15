/**
 * The page reads the WHOLE log (P312, item 2). It asked for one page of 500
 * events and never read `hasMore`, so a conversation past event 500 was shown
 * cut at 500: the newest of what the student and the service said, never.
 *
 * The fake answers as the route does (routes.ts, GET .../events): `after` is
 * an exclusive ordinal, `limit` is clamped to 500, and `hasMore` is whether
 * one more row exists.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { readEvents } from "./transport.js";

function line(ordinal: number): unknown {
  return { ordinal, createdAt: "2026-10-15T00:00:00.000Z", kind: "message", actor: "assistant", content: `line ${String(ordinal)}` };
}

/** A log of `total` events served page by page; every request URL kept. */
function serveLog(total: number, override?: (after: number) => unknown): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      asked.push(input);
      const url = new URL(input, "http://page.test");
      const after = Number(url.searchParams.get("after") ?? "0");
      const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 500);
      const body =
        override?.(after) ?? {
          events: Array.from({ length: Math.max(0, Math.min(limit, total - after)) }, (_unused, index) => line(after + index + 1)),
          hasMore: after + limit < total,
        };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
    }),
  );
  return asked;
}

describe("the page reads the whole log, page by page (P312, item 2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads 1,200 events in order, following the cursor until no more remain", async () => {
    const asked = serveLog(1200);
    const read = await readEvents("c1");
    if (!read.ok) expect.unreachable(`refused: ${read.code}`);
    expect(read.value.map((event) => event.ordinal)).toEqual(Array.from({ length: 1200 }, (_unused, index) => index + 1));
    expect(asked.map((url) => new URL(url, "http://page.test").searchParams.get("after"))).toEqual(["0", "500", "1000"]);
  });

  it("reads a short log in one request, as before", async () => {
    const asked = serveLog(454);
    const read = await readEvents("c1");
    if (!read.ok) expect.unreachable(`refused: ${read.code}`);
    expect(read.value).toHaveLength(454);
    expect(asked).toHaveLength(1);
  });

  it("a page that fails fails the whole read: never a log cut short and shown as whole", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? new Response(JSON.stringify({ events: Array.from({ length: 500 }, (_unused, index) => line(index + 1)), hasMore: true }), { status: 200 })
            : new Response(JSON.stringify({ type: "about:blank", title: "x", status: 503, code: "service_unavailable" }), { status: 503 }),
        );
      }),
    );
    const read = await readEvents("c1");
    expect(read.ok).toBe(false);
  });

  it("a page that says there is more and does not move is refused, not read forever", async () => {
    serveLog(1200, () => ({ events: [], hasMore: true }));
    const read = await readEvents("c1");
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.code).toBe("contract_mismatch");
  });

  it("a page without hasMore is refused: the contract requires it", async () => {
    serveLog(10, () => ({ events: [line(1)] }));
    const read = await readEvents("c1");
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.code).toBe("contract_mismatch");
  });
});

describe("a read that never answers is bounded (the P312 review)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails as a read the page cannot use, so the reads queued behind it run", async () => {
    // The page's reads are serialised (item 6), so one that never settled
    // would hold every read after it. The bound is the fetch's own signal;
    // here it fires at once instead of after thirty seconds.
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), 5);
      return controller.signal;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_done, fail) => {
            init?.signal?.addEventListener("abort", () => fail(init.signal?.reason as Error));
          }),
      ),
    );
    const read = await readEvents("c1");
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.code).toBe("service_unavailable");
  });

  it("any other failure of the fetch is thrown, as it always was", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(readEvents("c1")).rejects.toThrow("Failed to fetch");
  });
});
