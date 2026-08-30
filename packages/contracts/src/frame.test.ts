/**
 * The cross-origin boundary: what a receiver must refuse.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WRITTEN BECAUSE A REGRESSION WAS NOT CAUGHT.
 *
 * I replaced `envelope.origin !== expected` with a `startsWith` prefix test —
 * the exact mistake the comment in `frame.ts` warns about — and every test in
 * the repository still passed. The rule was documented and unenforced.
 *
 * `https://secure.askimate.com.evil.test` starts with `https://secure.askimate`
 * and is a completely different site that anyone can register. So does
 * `https://secure.askimate.com.attacker.io`. A prefix comparison, or a regular
 * expression with an unescaped dot, admits all of them.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import { FRAME_PROTOCOL_VERSION } from "./vocabulary.js";
import { parseFrameInbound, parseFrameOutbound } from "./frame.js";

const PARENT = "https://app.askimate.com";
const SECURE = "https://secure.askimate.com";
const REQUEST = `sr_${"a".repeat(32)}`;
const HANDLE = `sh_${"b".repeat(32)}`;

/** Stand-ins for window references. Compared by identity, never by shape. */
const PARENT_WINDOW = { name: "parent" };
const FRAME_WINDOW = { name: "frame" };

const inbound = {
  expectedOrigin: PARENT,
  expectedSource: PARENT_WINDOW,
  expectedRequestId: REQUEST,
};
const outbound = {
  expectedOrigin: SECURE,
  expectedSource: FRAME_WINDOW,
  expectedRequestId: REQUEST,
};

function bootstrap(): unknown {
  return { v: FRAME_PROTOCOL_VERSION, requestId: REQUEST, kind: "bootstrap", frameToken: "t".repeat(43) };
}
function received(): unknown {
  return {
    v: FRAME_PROTOCOL_VERSION,
    requestId: REQUEST,
    kind: "secret_status",
    lifecycle: "secret_received",
    handle: HANDLE,
  };
}

describe("the origin must match EXACTLY", () => {
  /** Every one of these starts with, contains, or resembles a real origin. */
  const LOOKALIKES = [
    "https://app.askimate.com.evil.test",
    "https://app.askimate.com.attacker.io",
    "https://app.askimate.co",
    "https://app-askimate.com",
    "http://app.askimate.com",
    "https://evil.test/app.askimate.com",
    "https://appXaskimate.com",
    "null",
    "",
  ];

  it("refuses every lookalike parent origin on the inbound message", () => {
    // The bootstrap is the ONE message the frame accepts. A frame that took it
    // from a lookalike origin would hand its session to whoever asked.
    for (const origin of LOOKALIKES) {
      expect(
        parseFrameInbound({ origin, source: PARENT_WINDOW, data: bootstrap() }, inbound),
        origin,
      ).toBeNull();
    }
    // And accepts the real one, so the test is not passing by refusing all.
    expect(
      parseFrameInbound({ origin: PARENT, source: PARENT_WINDOW, data: bootstrap() }, inbound),
    ).not.toBeNull();
  });

  it("refuses every lookalike frame origin on the outbound message", () => {
    for (const origin of LOOKALIKES.map((value) => value.replace("app.", "secure."))) {
      expect(
        parseFrameOutbound({ origin, source: FRAME_WINDOW, data: received() }, outbound),
        origin,
      ).toBeNull();
    }
    expect(
      parseFrameOutbound({ origin: SECURE, source: FRAME_WINDOW, data: received() }, outbound),
    ).not.toBeNull();
  });

  it("refuses a message from the RIGHT origin but the WRONG window", () => {
    // Another frame on the page — an ad, a widget, a nested iframe — can be
    // served from the same origin. The source check is what distinguishes the
    // window we rendered from any other.
    const impostor = { name: "another frame on the page" };
    expect(
      parseFrameOutbound({ origin: SECURE, source: impostor, data: received() }, outbound),
    ).toBeNull();
    expect(
      parseFrameInbound({ origin: PARENT, source: impostor, data: bootstrap() }, inbound),
    ).toBeNull();
  });

  it("refuses a message for a DIFFERENT request", () => {
    const other = { ...(received() as Record<string, unknown>), requestId: `sr_${"c".repeat(32)}` };
    expect(
      parseFrameOutbound({ origin: SECURE, source: FRAME_WINDOW, data: other }, outbound),
    ).toBeNull();
  });

  it("refuses a message from a different protocol version", () => {
    // A mismatch is refused, not adapted. Adapting is how a field means one
    // thing on one side of the boundary and another on the other.
    const old = { ...(received() as Record<string, unknown>), v: FRAME_PROTOCOL_VERSION + 1 };
    expect(
      parseFrameOutbound({ origin: SECURE, source: FRAME_WINDOW, data: old }, outbound),
    ).toBeNull();
  });
});

describe("what a message may carry", () => {
  it("refuses a handle on any lifecycle but a receipt", () => {
    // A handle smuggled onto a cancellation would make a dead request look
    // live, and the parent would report a credential that no longer exists.
    for (const lifecycle of ["secret_cancelled", "secret_expired", "secret_consumed"]) {
      const smuggled = { ...(received() as Record<string, unknown>), lifecycle };
      expect(
        parseFrameOutbound({ origin: SECURE, source: FRAME_WINDOW, data: smuggled }, outbound),
        lifecycle,
      ).toBeNull();
    }
  });

  it("refuses an unknown lifecycle and an unknown rejection reason", () => {
    const unknownLifecycle = {
      v: FRAME_PROTOCOL_VERSION, requestId: REQUEST,
      kind: "secret_status", lifecycle: "secret_exfiltrated",
    };
    expect(
      parseFrameOutbound({ origin: SECURE, source: FRAME_WINDOW, data: unknownLifecycle }, outbound),
    ).toBeNull();

    const unknownReason = {
      v: FRAME_PROTOCOL_VERSION, requestId: REQUEST,
      kind: "secret_rejected", reason: "because-i-said-so",
    };
    expect(
      parseFrameOutbound({ origin: SECURE, source: FRAME_WINDOW, data: unknownReason }, outbound),
    ).toBeNull();
  });

  it("drops every field the protocol does not name", () => {
    // The parser REBUILDS the message from known fields rather than passing
    // the received object through. Anything extra — a password someone added
    // to the payload — does not survive the crossing even if it was sent.
    const extra = {
      ...(received() as Record<string, unknown>),
      password: "A-PASSWORD-SOMEONE-ADDED",
      explanation: "some free text",
    };
    const parsed = parseFrameOutbound(
      { origin: SECURE, source: FRAME_WINDOW, data: extra },
      outbound,
    );
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain("A-PASSWORD-SOMEONE-ADDED");
    expect(JSON.stringify(parsed)).not.toContain("some free text");
  });

  it("refuses a bootstrap with no token, and one that is not a string", () => {
    for (const frameToken of [undefined, "", 42, null, {}]) {
      const message = { ...(bootstrap() as Record<string, unknown>), frameToken };
      expect(
        parseFrameInbound({ origin: PARENT, source: PARENT_WINDOW, data: message }, inbound),
      ).toBeNull();
    }
  });

  it("refuses anything that is not an object", () => {
    for (const data of ["a string", 42, null, undefined, []]) {
      expect(
        parseFrameOutbound({ origin: SECURE, source: FRAME_WINDOW, data }, outbound),
      ).toBeNull();
    }
  });
});
