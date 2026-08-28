/**
 * The transport, isolated — because the browser test cannot see this.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS, which is a finding rather than a design.
 *
 * I regressed `conversationTransport.send` to overwrite the server's ordinal
 * with `1` — a client creating a durable position, the exact thing the
 * architecture forbids — and every one of the fourteen browser tests passed.
 *
 * They passed because the SSE stream delivers the same event moments later at
 * its REAL ordinal, and `admitDurable` merges it in. The stream repairs what
 * the response got wrong, so end-to-end assertions cannot tell a correct
 * response-adoption from a broken one.
 *
 * That is worth knowing in itself: the durable path is defended twice over.
 * But "a second mechanism happens to cover it" is not the same as "the first
 * mechanism is right", and a test suite that cannot distinguish them would let
 * the response path rot silently until something disabled the stream.
 *
 * So these tests drive the transport with an injected `fetch` and an injected
 * `EventSource`, where each path can be observed on its own.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import type { ConversationEvent } from "@askimate/aas-contracts";
import { SSE_EVENT_NAME, SSE_RESUME_EVENT_NAME } from "@askimate/aas-contracts";

import { conversationTransport } from "./conversation-client.js";

const CONVERSATION = "01JBXQ8Z9WKTQ6M4H2NPB00001";
const AT = "2026-08-28T10:00:00.000Z";

function said(ordinal: number, content: string): ConversationEvent {
  return { kind: "message", ordinal, createdAt: AT, actor: "student", content };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": status === 409 ? "application/problem+json" : "application/json" },
  });
}

/** Records what was requested, and answers from a script. */
function recordingFetch(answer: (url: string, init?: RequestInit) => Response): {
  fetch: typeof globalThis.fetch;
  calls: { url: string; init?: RequestInit }[];
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    // `String(input)` would render a `Request` as "[object Object]", and the
    // lint rule is right that the URL assertions below would then compare
    // against nothing useful. The transport only ever passes a string, so this
    // narrows rather than converts — and throws if that ever stops being true.
    if (typeof input !== "string") throw new TypeError("the transport passes string URLs");
    const url = input;
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    return Promise.resolve(answer(url, init));
  }) as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}

/** A stand-in EventSource that a test can push frames into. */
class FakeEventSource {
  public static last: FakeEventSource | null = null;
  public readonly url: string;
  public closed = false;
  readonly #listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  public constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }

  public addEventListener(name: string, handler: (event: MessageEvent<string>) => void): void {
    const existing = this.#listeners.get(name) ?? [];
    existing.push(handler);
    this.#listeners.set(name, existing);
  }

  public close(): void {
    this.closed = true;
  }

  /** Delivers a frame the way the browser would. */
  public emit(name: string, data: unknown): void {
    for (const handler of this.#listeners.get(name) ?? []) {
      handler(new MessageEvent(name, { data: JSON.stringify(data) }));
    }
  }
}

function transport(fetchImpl: typeof globalThis.fetch) {
  return conversationTransport({
    conversationId: CONVERSATION,
    newIdempotencyKey: () => "an-idempotency-key-long-enough",
    fetch: fetchImpl,
    EventSource: FakeEventSource as unknown as typeof globalThis.EventSource,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Sending: the response is adopted exactly as it arrived
// ───────────────────────────────────────────────────────────────────────────

describe("what `send` does with the server's answer", () => {
  it("returns the SERVER's ordinal, unaltered", async () => {
    // 412, not 1 and not 3. A number no client could arrive at by counting, so
    // an implementation that computed one instead of reading one is visible.
    const { fetch: fetchImpl } = recordingFetch(() => jsonResponse(201, said(412, "carrying on")));
    const result = await transport(fetchImpl).send("carrying on");

    expect(result.outcome).toBe("accepted");
    if (result.outcome !== "accepted") return;
    expect(result.events.map((event) => event.ordinal)).toEqual([412]);
    expect(result.events[0]?.createdAt).toBe(AT);
  });

  it("treats a 200 replay exactly like a 201 first write", async () => {
    // The contract says both carry the same event at the same ordinal, which is
    // what makes an idempotent retry safe. A client that distinguished them
    // would have to decide which one to believe.
    const { fetch: fetchImpl } = recordingFetch(() => jsonResponse(200, said(9, "once only")));
    const result = await transport(fetchImpl).send("once only");
    expect(result).toEqual({ outcome: "accepted", events: [said(9, "once only")] });
  });

  it("sends an Idempotency-Key, once per attempt", async () => {
    const { fetch: fetchImpl, calls } = recordingFetch(() => jsonResponse(201, said(1, "hello")));
    await transport(fetchImpl).send("hello");
    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.["Idempotency-Key"]).toHaveLength("an-idempotency-key-long-enough".length);
  });

  it("reads a 409 as HELD, and carries nothing from the body", async () => {
    const { fetch: fetchImpl } = recordingFetch(() =>
      jsonResponse(409, {
        type: "https://askimate.com/problems/secret_request_open",
        title: "A secure step is open on this conversation",
        status: 409,
        code: "secret_request_open",
        requestId: `sr_${"a".repeat(32)}`,
        expiresAt: AT,
      }),
    );
    const result = await transport(fetchImpl).send("PASSWORD-IN-THE-WRONG-BOX");
    expect(result).toEqual({ outcome: "held", requestId: `sr_${"a".repeat(32)}` });
  });

  it("fails rather than guessing when the answer is not an event", async () => {
    // A 201 whose body is unparseable is NOT an acceptance. Returning
    // `accepted` with an invented event would put something in the transcript
    // the log does not contain.
    const { fetch: fetchImpl } = recordingFetch(() => jsonResponse(201, { nonsense: true }));
    expect(await transport(fetchImpl).send("x")).toEqual({ outcome: "failed" });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Loading: paged to the end, parsed, never guessed
// ───────────────────────────────────────────────────────────────────────────

describe("what `load` reads", () => {
  it("follows `hasMore` to the end rather than stopping at one page", async () => {
    // A conversation longer than a page. Stopping early would silently truncate
    // a transcript, which looks exactly like the hole this design prevents.
    let page = 0;
    const { fetch: fetchImpl, calls } = recordingFetch(() => {
      page += 1;
      return page === 1
        ? jsonResponse(200, { events: [said(1, "a"), said(2, "b")], hasMore: true })
        : jsonResponse(200, { events: [said(3, "c")], hasMore: false });
    });
    const events = await transport(fetchImpl).load(0);
    expect(events.map((event) => event.ordinal)).toEqual([1, 2, 3]);
    // The second page asked from where the first ended, not from 0 again.
    expect(calls[1]?.url).toContain("after=2");
  });

  it("drops an event it cannot parse instead of rendering a guess", async () => {
    const { fetch: fetchImpl } = recordingFetch(() =>
      jsonResponse(200, {
        events: [said(1, "real"), { kind: "from_a_newer_service", ordinal: 2 }],
        hasMore: false,
      }),
    );
    const events = await transport(fetchImpl).load(0);
    expect(events.map((event) => event.ordinal)).toEqual([1]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Streaming: the resume point, and what reaches the handlers
// ───────────────────────────────────────────────────────────────────────────

describe("what `stream` opens and reports", () => {
  it("names the resume point in the URL when there is one", () => {
    // A fresh EventSource sends no `Last-Event-ID` — the API takes no headers —
    // so the first connection has nowhere else to say where it got to.
    const { fetch: fetchImpl } = recordingFetch(() => jsonResponse(200, {}));
    transport(fetchImpl).stream(41, { onEvent: () => undefined, onResume: () => undefined });
    expect(FakeEventSource.last?.url).toContain("lastEventId=41");
  });

  it("names no resume point when there is nothing to resume after", () => {
    const { fetch: fetchImpl } = recordingFetch(() => jsonResponse(200, {}));
    transport(fetchImpl).stream(0, { onEvent: () => undefined, onResume: () => undefined });
    expect(FakeEventSource.last?.url).not.toContain("lastEventId");
  });

  it("reports the resume frame, so a gap can be backfilled", () => {
    const { fetch: fetchImpl } = recordingFetch(() => jsonResponse(200, {}));
    const seen: number[] = [];
    transport(fetchImpl).stream(0, {
      onEvent: () => undefined,
      onResume: (after) => seen.push(after),
    });
    FakeEventSource.last?.emit(SSE_RESUME_EVENT_NAME, { resumingAfter: 7 });
    expect(seen).toEqual([7]);
  });

  it("delivers parsed events and drops unparseable frames", () => {
    const { fetch: fetchImpl } = recordingFetch(() => jsonResponse(200, {}));
    const seen: number[] = [];
    transport(fetchImpl).stream(0, {
      onEvent: (event) => seen.push(event.ordinal),
      onResume: () => undefined,
    });
    FakeEventSource.last?.emit(SSE_EVENT_NAME, said(1, "kept"));
    FakeEventSource.last?.emit(SSE_EVENT_NAME, { kind: "unknown_to_this_client", ordinal: 2 });
    FakeEventSource.last?.emit(SSE_EVENT_NAME, said(3, "also kept"));
    expect(seen).toEqual([1, 3]);
  });

  it("closes the connection when asked, and not before", () => {
    const { fetch: fetchImpl } = recordingFetch(() => jsonResponse(200, {}));
    const close = transport(fetchImpl).stream(0, {
      onEvent: () => undefined,
      onResume: () => undefined,
    });
    expect(FakeEventSource.last?.closed).toBe(false);
    close();
    expect(FakeEventSource.last?.closed).toBe(true);
  });
});
