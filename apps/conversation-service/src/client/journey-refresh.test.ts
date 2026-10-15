/**
 * The page's reads are bounded, and it draws while the stream keeps sending
 * (P312, item 6). It opened its stream before its first read and with no
 * lower bound, so the service replayed the whole log, one frame per event; every
 * frame started a refresh of three reads; and a refresh drew only if no newer
 * one had started — so the page stayed blank until the replay drained, and
 * blank for as long as frames kept coming.
 *
 * The real `journey.ts`, in node: a document with one element (the
 * transcript), a stream and a service faked at the network boundary, each
 * answering as the real one does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeElement {
  children: unknown[] = [];
  textContent = "";
  className = "";
  type = "";
  scrollHeight = 0;
  readonly dataset: Record<string, string> = {};
  /** `drawTranscript` empties the list, appends each line, then scrolls: a draw ENDS at the scroll. */
  constructor(private readonly onDrawn?: (children: readonly unknown[]) => void) {}
  set scrollTop(_value: number) {
    this.onDrawn?.(this.children);
  }
  get scrollTop(): number {
    return 0;
  }
  replaceChildren(...nodes: unknown[]): void {
    this.children = nodes;
  }
  append(...nodes: unknown[]): void {
    this.children.push(...nodes);
  }
  addEventListener(): void {}
  setAttribute(): void {}
}

function line(ordinal: number): Record<string, unknown> {
  return { ordinal, createdAt: "2026-10-15T00:00:00.000Z", kind: "message", actor: "assistant", content: `line ${String(ordinal)}` };
}

/** One page, one fake service, one fake stream: what a test needs to say what happened. */
interface Harness {
  readonly log: Record<string, unknown>[];
  readonly reads: Map<string, number>;
  /** The transcript's length at each draw, in order. */
  readonly draws: number[];
  stream(): { readonly url: string; emit(event: Record<string, unknown>): void };
}

async function pageOver(events: number, latencyMs = 1): Promise<{ client: { start(now: () => Date): Promise<void>; refresh(): Promise<void> }; harness: Harness }> {
  vi.resetModules();
  // Imported BEFORE `document` exists, so the page's own auto-start does not run.
  const { client } = await import("./journey.js");
  const log = Array.from({ length: events }, (_unused, index) => line(index + 1));
  const reads = new Map<string, number>();
  const draws: number[] = [];
  const transcript = new FakeElement((children) => draws.push(children.length));
  const opened: FakeEventSource[] = [];

  class FakeEventSource {
    readonly url: string;
    readonly #listeners: ((event: { data: string }) => void)[] = [];
    constructor(url: string) {
      this.url = url;
      opened.push(this);
      // The route's backfill: every event after the bound, one frame each.
      const from = Number(new URL(url, "http://page.test").searchParams.get("lastEventId") ?? "0");
      setTimeout(() => {
        for (const event of log) if (Number(event["ordinal"]) > from) this.emit(event);
      }, 0);
    }
    addEventListener(_name: string, listener: (event: { data: string }) => void): void {
      this.#listeners.push(listener);
    }
    close(): void {}
    emit(event: Record<string, unknown>): void {
      for (const listener of this.#listeners) listener({ data: JSON.stringify(event) });
    }
  }

  const answer = (body: unknown): Promise<Response> =>
    new Promise((done) => setTimeout(() => done(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })), latencyMs));
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      const url = new URL(input, "http://page.test");
      const path = url.pathname;
      reads.set(path, (reads.get(path) ?? 0) + 1);
      if (path === "/v1/conversations") return answer({ conversations: [{ id: "c1", title: null, createdAt: "2026-10-15T00:00:00.000Z", lastOrdinal: log.length }] });
      if (path === "/v1/conversations/c1/events") {
        const after = Number(url.searchParams.get("after") ?? "0");
        const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 500);
        const page = log.filter((event) => Number(event["ordinal"]) > after);
        return answer({ events: page.slice(0, limit), hasMore: page.length > limit });
      }
      if (path === "/v1/conversations/c1/runs") return answer({ run: null, pending: null, ownActs: [], consent: null });
      if (path === "/v1/conversations/c1/documents") return answer({ documents: [], documentTypes: [] });
      if (path === "/v1/application-targets") return answer({ targets: [] });
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
  vi.stubGlobal("document", {
    getElementById: (id: string) => (id === "transcript" ? transcript : null),
    createElement: () => new FakeElement(),
  });
  return {
    client,
    harness: {
      log,
      reads,
      draws,
      stream: () => {
        const source = opened.at(-1);
        if (source === undefined) throw new Error("no stream opened");
        return source;
      },
    },
  };
}

const settle = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

describe("the page's reads are bounded, and it draws while the stream keeps sending (P312, item 6)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a load over 1,200 events opens its stream after the last event it read, and makes a bounded number of reads", async () => {
    const { client, harness } = await pageOver(1200);
    await client.start(() => new Date("2026-10-15T10:00:00Z"));
    await settle(300);
    expect(harness.stream().url).toBe("/v1/conversations/c1/stream?lastEventId=1200");
    expect(harness.reads.get("/v1/conversations/c1/runs") ?? 0, "one read, not one per event").toBeLessThanOrEqual(2);
    expect(harness.draws.at(-1), "the whole log is drawn").toBe(1200);
    await client.refresh();
  }, 30_000);

  it("a burst of 50 frames during a read costs at most two more reads", async () => {
    const { client, harness } = await pageOver(10, 5);
    await client.start(() => new Date("2026-10-15T10:00:00Z"));
    await settle(100);
    const before = harness.reads.get("/v1/conversations/c1/runs") ?? 0;
    for (let index = 0; index < 50; index += 1) {
      const event = line(harness.log.length + 1);
      harness.log.push(event);
      harness.stream().emit(event);
    }
    await settle(200);
    expect((harness.reads.get("/v1/conversations/c1/runs") ?? 0) - before).toBeLessThanOrEqual(2);
    expect(harness.draws.at(-1), "and what it draws is the log after the burst").toBe(60);
    await client.refresh();
  }, 30_000);

  it("draws while the stream keeps sending, and each draw holds what was read", async () => {
    const { client, harness } = await pageOver(5, 10);
    await client.start(() => new Date("2026-10-15T10:00:00Z"));
    await settle(80);
    const drawnBefore = harness.draws.length;
    const timer = setInterval(() => {
      const event = line(harness.log.length + 1);
      harness.log.push(event);
      harness.stream().emit(event);
    }, 2);
    await settle(300);
    clearInterval(timer);
    const during = harness.draws.slice(drawnBefore);
    expect(during.length, "drawn while frames kept arriving").toBeGreaterThan(1);
    expect(during.at(-1)!, "and later draws hold more of the log").toBeGreaterThan(during[0]!);
    // The read in flight and the one queued behind it finish before the
    // fakes are taken away (the P312 review: left running, they failed on the
    // real fetch and a missing document, as unhandled rejections).
    await client.refresh();
  }, 30_000);

  it("a first read the student's own send overtakes still bounds the stream: it opens after the last event read", async () => {
    // The P312 review: the bound came from what was DRAWN, and an overtaken
    // read draws nothing, so the stream opened from the beginning.
    const { client, harness } = await pageOver(5, 40);
    const started = client.start(() => new Date("2026-10-15T10:00:00Z"));
    // The conversation is listed first (one answer, 40 ms); the first read
    // runs after it, and the act lands inside that read.
    await settle(60);
    expect(harness.reads.get("/v1/conversations/c1/runs"), "the first read is under way").toBe(1);
    const act = client.refresh();
    await started;
    await act;
    expect(harness.stream().url).toBe("/v1/conversations/c1/stream?lastEventId=5");
    await client.refresh();
  }, 30_000);

  it("a read in flight when the student acts does not draw; the read the act started does (P221, kept)", async () => {
    // Only the page's own acts overtake a read in flight; a frame never does.
    const { client, harness } = await pageOver(5, 40);
    await client.start(() => new Date("2026-10-15T10:00:00Z"));
    await settle(150);
    const drawnBefore = harness.draws.length;
    const sixth = line(6);
    harness.log.push(sixth);
    harness.stream().emit(sixth);
    await settle(10);
    harness.log.push(line(7));
    await client.refresh();
    expect(harness.draws.slice(drawnBefore), "only the act's read drew, and it read all seven").toEqual([7]);
  }, 30_000);

  it("an act during a read's LAST read (the form's targets) still stops it drawing", async () => {
    // The overtaken check ran before the targets were read; P312 checks again
    // after them, so an act during that read is newer than what it would draw.
    const { client, harness } = await pageOver(5, 40);
    await client.start(() => new Date("2026-10-15T10:00:00Z"));
    await settle(150);
    const drawnBefore = harness.draws.length;
    const sixth = line(6);
    harness.log.push(sixth);
    harness.stream().emit(sixth);
    await settle(60);
    harness.log.push(line(7));
    await client.refresh();
    expect(harness.draws.slice(drawnBefore), "only the act's read drew").toEqual([7]);
  }, 30_000);
});
