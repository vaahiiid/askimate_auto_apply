/**
 * The contract, exercised — and the invalid payloads it must refuse.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Add deliberate negative tests proving invalid or
 * secret-bearing payloads are rejected."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The positive cases here are cheap. The negative ones are the point: every
 * parser in this package is a fail-closed boundary, and a boundary that has
 * only ever been shown valid input has not been tested.
 */

import { describe, expect, it } from "vitest";

import type { ConversationEvent } from "./events.js";
import {
  eventCarriesContent,
  parseConversationEvent,
} from "./events.js";
import { PROBLEM_STATUS, PROBLEM_TITLES, parseProblem, problemTypeFor } from "./problems.js";
import { parseFrameInbound, parseFrameOutbound } from "./frame.js";
import { parseLastEventId, renderSseFrame, SSE_EVENT_NAME } from "./sse.js";
import {
  EVENT_KINDS,
  PROBLEM_CODES,
  REJECTION_REASONS,
  SECRET_LIFECYCLES,
  SECURE_EVENT_KINDS,
  isTerminalLifecycleWord,
  parseRejectionReason,
  parseSecretLifecycle,
} from "./vocabulary.js";

const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";
const REQUEST_ID = `sr_${"a".repeat(32)}`;
const HANDLE = `sh_${"b".repeat(32)}`;
const AT = "2026-08-28T10:00:00.000Z";

const MESSAGE: ConversationEvent = {
  kind: "message",
  ordinal: 1,
  createdAt: AT,
  actor: "student",
  content: "when does term start?",
};
const REQUESTED: ConversationEvent = {
  kind: "secret_requested",
  ordinal: 2,
  createdAt: AT,
  requestId: REQUEST_ID,
  channel: "secure_control",
  expiresAt: "2026-08-28T10:05:00.000Z",
};
const RECEIVED: ConversationEvent = {
  kind: "secret_received",
  ordinal: 3,
  createdAt: AT,
  requestId: REQUEST_ID,
  handle: HANDLE,
};

// ───────────────────────────────────────────────────────────────────────────
// The structural property the whole model exists for
// ───────────────────────────────────────────────────────────────────────────

describe("only a message can carry what a student typed", () => {
  it("has exactly one content-bearing kind, checked at runtime too", () => {
    // The compile-time claim is `ONLY_MESSAGES_CARRY_CONTENT` in events.ts.
    // This exists so the property is visible in a test list rather than only in
    // the type checker, where a reader has to know to look.
    expect(eventCarriesContent(MESSAGE)).toBe(true);
    for (const kind of SECURE_EVENT_KINDS) {
      const event = { ...REQUESTED, kind } as unknown as ConversationEvent;
      expect(eventCarriesContent(event), kind).toBe(false);
    }
  });

  it("reports content-bearing for a message and for nothing else", () => {
    expect(eventCarriesContent(MESSAGE)).toBe(true);
    expect(eventCarriesContent(REQUESTED)).toBe(false);
    expect(eventCarriesContent(RECEIVED)).toBe(false);
  });

  it("strips a content field smuggled onto a secure event", () => {
    // The wire is untrusted. A server that had been compromised, or simply
    // written wrongly, could send this; the parser is what makes the schema's
    // CHECK constraint hold on the client side of the connection too.
    const smuggled = parseConversationEvent({
      kind: "secret_requested",
      ordinal: 2,
      createdAt: AT,
      requestId: REQUEST_ID,
      channel: "secure_control",
      expiresAt: AT,
      content: MARKER,
    });
    expect(smuggled).not.toBeNull();
    expect(JSON.stringify(smuggled)).not.toContain(MARKER);
    expect(eventCarriesContent(smuggled!)).toBe(false);
  });

  it("keeps a redacted body as null rather than dropping the event", () => {
    // ADR-0031: the event survives an erasure so ordinals stay dense and the
    // transcript keeps its shape. A deleted row would leave a hole.
    const redacted = parseConversationEvent({
      kind: "message",
      ordinal: 4,
      createdAt: AT,
      actor: "student",
      content: null,
      redactedAt: AT,
    });
    expect(redacted?.kind).toBe("message");
    expect(redacted?.kind === "message" ? redacted.content : "x").toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Fail closed
// ───────────────────────────────────────────────────────────────────────────

describe("an unknown value is refused, never guessed at", () => {
  it("drops an event kind this build has never heard of", () => {
    expect(parseConversationEvent({ kind: "secret_exfiltrated", ordinal: 1, createdAt: AT }))
      .toBeNull();
  });

  it("drops a rejection reason outside the closed set", () => {
    expect(parseRejectionReason("because-i-said-so")).toBeNull();
    expect(
      parseConversationEvent({
        kind: "secret_rejected",
        ordinal: 1,
        createdAt: AT,
        requestId: REQUEST_ID,
        reason: "server_error",
      }),
    ).toBeNull();
  });

  it("drops a lifecycle word the store does not know", () => {
    expect(parseSecretLifecycle("secret_probably")).toBeNull();
  });

  it("drops an event with no ordinal, a zero ordinal, or a fractional one", () => {
    for (const ordinal of [undefined, 0, -1, 1.5, "2", null]) {
      expect(
        parseConversationEvent({ kind: "message", ordinal, createdAt: AT, actor: "ai", content: "x" }),
        String(ordinal),
      ).toBeNull();
    }
  });

  it("drops a message whose actor is not a role in the conversation", () => {
    expect(
      parseConversationEvent({
        kind: "message", ordinal: 1, createdAt: AT, actor: "administrator", content: "x",
      }),
    ).toBeNull();
  });

  it("distinguishes a redacted body (null) from a missing one (undefined)", () => {
    // Collapsing the two would let a malformed event render as a redaction,
    // which reads to a student as "someone deleted my message".
    expect(
      parseConversationEvent({ kind: "message", ordinal: 1, createdAt: AT, actor: "student" }),
    ).toBeNull();
  });

  it("drops a handle on any lifecycle but secret_received", () => {
    // A handle on a cancellation would make a dead request look live.
    expect(
      parseConversationEvent({
        kind: "secret_cancelled", ordinal: 1, createdAt: AT, requestId: REQUEST_ID, handle: HANDLE,
      })!.kind,
    ).toBe("secret_cancelled");
    expect(JSON.stringify(
      parseConversationEvent({
        kind: "secret_cancelled", ordinal: 1, createdAt: AT, requestId: REQUEST_ID, handle: HANDLE,
      }),
    )).not.toContain(HANDLE);
  });

  it("drops garbage rather than throwing on it", () => {
    for (const junk of [null, undefined, "a string", 42, [], () => undefined]) {
      expect(parseConversationEvent(junk)).toBeNull();
    }
  });
});


// ───────────────────────────────────────────────────────────────────────────
// Problems
// ───────────────────────────────────────────────────────────────────────────

describe("the error contract", () => {
  it("has a fixed title and status for every code, and no free text anywhere", () => {
    for (const code of PROBLEM_CODES) {
      expect(PROBLEM_TITLES[code], code).toBeTypeOf("string");
      expect(PROBLEM_STATUS[code], code).toBeGreaterThanOrEqual(400);
      // A title with a placeholder is a title someone fills in from input.
      expect(PROBLEM_TITLES[code], code).not.toMatch(/[{}$%]|\bnull\b|undefined/);
    }
  });

  it("rebuilds title and status from the code, ignoring whatever was sent", () => {
    // A server that sent a hostile title cannot make a client render it: the
    // client looks the wording up by code rather than trusting the document.
    const parsed = parseProblem({
      type: "https://evil.test/", title: MARKER, status: 200,
      code: "not_found", instance: "req_1",
    });
    expect(parsed?.title).toBe(PROBLEM_TITLES.not_found);
    expect(parsed?.status).toBe(404);
    expect(parsed?.type).toBe(problemTypeFor("not_found"));
    expect(JSON.stringify(parsed)).not.toContain(MARKER);
  });

  it("drops a problem code this build does not know", () => {
    expect(parseProblem({ code: "teapot", instance: "req_1" })).toBeNull();
  });

  it("carries pointers, never values, on a validation failure", () => {
    const parsed = parseProblem({
      code: "validation_failed", instance: "req_1", pointers: ["/content"],
    });
    expect(parsed).toMatchObject({ code: "validation_failed", pointers: ["/content"] });
    // A "pointer" that is a sentence is a message wearing a pointer's name.
    expect(parseProblem({
      code: "validation_failed", instance: "req_1",
      pointers: [`content was ${MARKER}`],
    })).toBeNull();
  });

  it("names the open request on a refusal, and nothing from the refused body", () => {
    const parsed = parseProblem({
      code: "secret_request_open", instance: "req_1",
      requestId: REQUEST_ID, expiresAt: AT,
    });
    expect(parsed).toMatchObject({ requestId: REQUEST_ID, expiresAt: AT });
    expect(Object.keys(parsed!)).toEqual(
      expect.arrayContaining(["type", "title", "status", "code", "instance"]),
    );
    expect(JSON.stringify(parsed)).not.toContain(MARKER);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The cross-origin boundary
// ───────────────────────────────────────────────────────────────────────────

describe("the frame protocol", () => {
  const PARENT = "https://app.askimate.com";
  const SECURE = "https://secure.askimate.com";
  const WINDOW = { name: "the frame" };
  const EXPECT = {
    expectedOrigin: SECURE,
    expectedSource: WINDOW,
    expectedRequestId: REQUEST_ID,
  };

  const status = { v: 1, kind: "secret_status", requestId: REQUEST_ID,
    lifecycle: "secret_received", handle: HANDLE };

  it("accepts a well-formed status from the right origin and the right frame", () => {
    expect(parseFrameOutbound({ origin: SECURE, source: WINDOW, data: status }, EXPECT))
      .toMatchObject({ kind: "secret_status", lifecycle: "secret_received", handle: HANDLE });
  });

  it("refuses a message from ANY other origin, including a prefix match", () => {
    for (const origin of [
      PARENT,
      "https://secure.askimate.com.evil.test",   // defeats startsWith
      "https://secure-askimate.com",             // defeats an unescaped dot
      "http://secure.askimate.com",              // defeats a scheme-blind check
      "null",
    ]) {
      expect(parseFrameOutbound({ origin, source: WINDOW, data: status }, EXPECT), origin)
        .toBeNull();
    }
  });

  it("refuses a message from a DIFFERENT window on the right origin", () => {
    // A nested or sibling frame on the same origin is still not the frame we
    // rendered, and origin alone cannot tell them apart.
    expect(parseFrameOutbound({ origin: SECURE, source: { other: true }, data: status }, EXPECT))
      .toBeNull();
  });

  it("refuses a message naming a different request", () => {
    expect(parseFrameOutbound(
      { origin: SECURE, source: WINDOW, data: { ...status, requestId: `sr_${"9".repeat(32)}` } },
      EXPECT,
    )).toBeNull();
  });

  it("refuses a protocol version it does not implement, rather than adapting", () => {
    for (const v of [0, 2, "1", undefined]) {
      expect(parseFrameOutbound({ origin: SECURE, source: WINDOW, data: { ...status, v } }, EXPECT))
        .toBeNull();
    }
  });

  it("refuses a handle on any lifecycle but secret_received", () => {
    for (const lifecycle of ["secret_requested", "secret_expired", "secret_cancelled"] as const) {
      expect(parseFrameOutbound(
        { origin: SECURE, source: WINDOW, data: { ...status, lifecycle } }, EXPECT,
      ), lifecycle).toBeNull();
    }
  });

  it("carries no secret on any message shape, however one is smuggled in", () => {
    for (const kind of ["ready", "resize", "secret_status", "secret_rejected", "cancelled"]) {
      const parsed = parseFrameOutbound({
        origin: SECURE,
        source: WINDOW,
        data: {
          v: 1, kind, requestId: REQUEST_ID, height: 200,
          lifecycle: "secret_received", handle: HANDLE, reason: "expired",
          // Everything an attacker or a careless refactor might attach:
          password: MARKER, secret: MARKER, content: MARKER, plaintext: MARKER,
        },
      }, EXPECT);
      expect(JSON.stringify(parsed), kind).not.toContain(MARKER);
    }
  });

  it("accepts the bootstrap token only from the parent, and only once shaped right", () => {
    const inboundExpect = { ...EXPECT, expectedOrigin: PARENT, expectedSource: WINDOW };
    const token = "t".repeat(43);
    expect(parseFrameInbound(
      { origin: PARENT, source: WINDOW, data: { v: 1, kind: "bootstrap", requestId: REQUEST_ID, frameToken: token } },
      inboundExpect,
    )).toMatchObject({ kind: "bootstrap", frameToken: token });

    // Not from anywhere else…
    expect(parseFrameInbound(
      { origin: "https://evil.test", source: WINDOW, data: { v: 1, kind: "bootstrap", requestId: REQUEST_ID, frameToken: token } },
      inboundExpect,
    )).toBeNull();
    // …and no other inbound kind exists at all.
    expect(parseFrameInbound(
      { origin: PARENT, source: WINDOW, data: { v: 1, kind: "secret_status", requestId: REQUEST_ID } },
      inboundExpect,
    )).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SSE
// ───────────────────────────────────────────────────────────────────────────

describe("the event stream", () => {
  it("uses the ordinal as the SSE id, which is what makes resumption work", () => {
    const frame = renderSseFrame(RECEIVED);
    expect(frame).toContain(`id: ${String(RECEIVED.ordinal)}`);
    expect(frame).toContain(`event: ${SSE_EVENT_NAME}`);
    expect(frame.endsWith("\n\n")).toBe(true);
  });

  it("reads Last-Event-ID strictly, because it is client-supplied", () => {
    expect(parseLastEventId("41")).toBe(41);
    expect(parseLastEventId(" 41 ")).toBe(41);
    expect(parseLastEventId("0")).toBe(0);
    for (const hostile of [
      "41abc",       // parseInt would accept this
      "0x29",        // and this
      "-1",
      "1e3",
      "41; DROP",
      "9007199254740993", // beyond Number.MAX_SAFE_INTEGER
      "",
      "   ",
      null,
      undefined,
    ]) {
      expect(parseLastEventId(hostile), String(hostile)).toBeNull();
    }
  });

  it("never renders a secret, because no event can hold one", () => {
    const smuggled = { ...RECEIVED, content: MARKER } as unknown as ConversationEvent;
    const parsed = parseConversationEvent(smuggled)!;
    expect(renderSseFrame(parsed)).not.toContain(MARKER);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Agreement with the domain
// ───────────────────────────────────────────────────────────────────────────

describe("the wire vocabulary is internally coherent", () => {
  it("names every lifecycle word as an event kind, plus message and rejection", () => {
    // The lifecycle words ARE event kinds; there is no separate `lifecycle`
    // field on a secure event, because two fields describing one fact can
    // disagree.
    for (const word of SECRET_LIFECYCLES) {
      expect(EVENT_KINDS as readonly string[], word).toContain(word);
    }
    expect([...EVENT_KINDS].sort()).toEqual(
      [...SECRET_LIFECYCLES, "message", "secret_rejected"].sort(),
    );
  });

  it("has three terminal words and marks exactly those terminal", () => {
    const terminal = SECRET_LIFECYCLES.filter(isTerminalLifecycleWord);
    expect([...terminal].sort()).toEqual(
      ["secret_cancelled", "secret_consumed", "secret_expired"].sort(),
    );
  });

  it("has no duplicate member in any closed set", () => {
    for (const [name, members] of [
      ["EVENT_KINDS", EVENT_KINDS],
      ["REJECTION_REASONS", REJECTION_REASONS],
      ["SECRET_LIFECYCLES", SECRET_LIFECYCLES],
      ["PROBLEM_CODES", PROBLEM_CODES],
    ] as const) {
      expect(new Set(members).size, name).toBe(members.length);
    }
  });
});
