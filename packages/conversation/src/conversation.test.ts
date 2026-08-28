/**
 * The five decisions, exercised together.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"verify that the client and server can consume the same
 * implementation without changing behaviour."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These are the tests that used to live in three places: `transcript.test.ts`
 * and `continuity.test.ts` in the chat app, and an openness block in the
 * contract package. One implementation now, so one place to assert about it.
 */

import { describe, expect, it } from "vitest";

import type { ConversationEvent } from "@askimate/aas-contracts";

import { openSecretRequest } from "./openness.js";
import { composerPolicy } from "./composer.js";
import { decideRendering, refusalText } from "./rendering.js";
import { projectTranscript } from "./transcript.js";
import { SECURE_STEP_SENTENCE, buildModelRequest, persistableContent } from "./model-context.js";

const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";
const REQUEST_ID = `sr_${"a".repeat(32)}`;
const HANDLE = `sh_${"b".repeat(32)}`;
const AT = "2026-08-28T10:00:00.000Z";
const NOW = new Date(AT);
const LATER = "2026-08-28T10:05:00.000Z";

const MESSAGE: ConversationEvent = {
  kind: "message", ordinal: 1, createdAt: AT, actor: "student",
  content: "when does term start?",
};
const REQUESTED: ConversationEvent = {
  kind: "secret_requested", ordinal: 2, createdAt: AT,
  requestId: REQUEST_ID, channel: "secure_control", expiresAt: LATER,
};
const RECEIVED: ConversationEvent = {
  kind: "secret_received", ordinal: 3, createdAt: AT, requestId: REQUEST_ID, handle: HANDLE,
};
const ALL_CAPABLE = {
  supportsSecureControl: true, secureContext: true, endpointReachable: true,
} as const;

describe("whether a secure step is open", () => {
  it("is open once requested and nothing has settled it", () => {
    expect(openSecretRequest([MESSAGE, REQUESTED])).toBe(REQUEST_ID);
  });

  it("is NOT closed by a rejection", () => {
    // The subtle one. A mismatch leaves the request at `secret_requested` on the
    // server; a client that closed here would release its composer against a
    // request the server still holds open, and collect a 409 on the student's
    // next message. Phase D found exactly that bug in the previous client.
    const rejected: ConversationEvent = {
      kind: "secret_rejected", ordinal: 3, createdAt: AT,
      requestId: REQUEST_ID, reason: "confirmation_mismatch",
    };
    expect(openSecretRequest([REQUESTED, rejected])).toBe(REQUEST_ID);
  });

  it("is closed by every terminal transition, and by receipt", () => {
    for (const kind of ["secret_received", "secret_consumed", "secret_expired", "secret_cancelled"] as const) {
      const settling =
        kind === "secret_received"
          ? RECEIVED
          : ({ kind, ordinal: 3, createdAt: AT, requestId: REQUEST_ID } as ConversationEvent);
      expect(openSecretRequest([REQUESTED, settling]), kind).toBeNull();
    }
  });

  it("ignores a settlement naming a DIFFERENT request", () => {
    // Two requests can exist in one conversation. Closing on any settlement
    // would let a stale one release the live one's guard.
    const other: ConversationEvent = {
      kind: "secret_expired", ordinal: 3, createdAt: AT, requestId: `sr_${"c".repeat(32)}`,
    };
    expect(openSecretRequest([REQUESTED, other])).toBe(REQUEST_ID);
  });

  it("tracks the LATER request when one supersedes a settled one", () => {
    const later: ConversationEvent = { ...REQUESTED, ordinal: 5, requestId: `sr_${"d".repeat(32)}` };
    expect(openSecretRequest([REQUESTED, RECEIVED, later])).toBe(later.requestId);
  });

  it("is closed in an ordinary conversation with no secure step at all", () => {
    expect(openSecretRequest([MESSAGE])).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The transcript
// ───────────────────────────────────────────────────────────────────────────

describe("the transcript drops nothing and reorders nothing", () => {
  it("produces exactly one item per event, in order, carrying its ordinal", () => {
    const events = [MESSAGE, REQUESTED, RECEIVED];
    const items = projectTranscript(events);
    expect(items).toHaveLength(events.length);
    // Every position is DURABLE and carries the server's ordinal. The shape is
    // the point: a bare `1` would be indistinguishable from a number a client
    // computed, and that indistinguishability is what let the React container
    // pass off `previous.length + 1` as a log position for a whole phase.
    expect(items.map((item) => item.position)).toEqual([
      { placement: "durable", ordinal: 1 },
      { placement: "durable", ordinal: 2 },
      { placement: "durable", ordinal: 3 },
    ]);
    expect(items.map((item) => item.render)).toEqual([
      "message", "secure_control", "secret_status",
    ]);
  });

  it("puts the secure step BETWEEN the messages around it, not at the end", () => {
    // A `continue` in an earlier client skipped every non-message turn, which
    // is what pushed the secure request out of the conversation and into a
    // panel below the composer.
    const after: ConversationEvent = { ...MESSAGE, ordinal: 3, actor: "assistant", content: "ok" };
    const items = projectTranscript([MESSAGE, REQUESTED, after]);
    expect(items[1]?.render).toBe("secure_control");
  });

  it("gives only the message item free text, and keeps a redaction as null", () => {
    const redacted: ConversationEvent = { ...MESSAGE, ordinal: 4, content: null, redactedAt: AT };
    const items = projectTranscript([REQUESTED, RECEIVED, redacted]);
    const withContent = items.filter((item) => "content" in item);
    expect(withContent).toHaveLength(1);
    expect(withContent[0]).toMatchObject({ render: "message", content: null });
  });

  it("carries a rejection as a CODE, never as a sentence", () => {
    const rejected: ConversationEvent = {
      kind: "secret_rejected", ordinal: 4, createdAt: AT,
      requestId: REQUEST_ID, reason: "confirmation_mismatch",
    };
    const [item] = projectTranscript([rejected]);
    expect(item).toMatchObject({ render: "secret_rejected", reason: "confirmation_mismatch" });
    expect(JSON.stringify(item)).not.toMatch(/did not match|try again/i);
  });

  it("keeps every settling kind distinguishable, including cancellation", () => {
    // ADR-0032. Identical to the guard, different to the model, the student
    // and analytics — so the transcript has to be able to tell them apart.
    const kinds = ["secret_consumed", "secret_expired", "secret_cancelled"] as const;
    const items = projectTranscript(
      kinds.map((kind, index) => ({
        kind, ordinal: index + 1, createdAt: AT, requestId: REQUEST_ID,
      })),
    );
    expect(items.map((item) => (item.render === "secret_status" ? item.lifecycle : null)))
      .toEqual([...kinds]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The composer
// ───────────────────────────────────────────────────────────────────────────

describe("the composer policy", () => {
  it("blocks sending while a step is open, and never blocks typing", () => {
    expect(composerPolicy({ awaitingSecret: true })).toEqual({
      typing: "live", send: "blocked", draftPersistence: "suspended",
    });
  });

  it("releases sending, and draft persistence, once nothing is open", () => {
    expect(composerPolicy({ awaitingSecret: false })).toEqual({
      typing: "live", send: "enabled", draftPersistence: "normal",
    });
  });

  it("agrees with the openness derivation, which is the pairing that matters", () => {
    // The client and the server both compute `awaitingSecret` this way. One
    // function, one answer — which is the structural fix for the divergence
    // Phase D found by hand.
    const open = openSecretRequest([MESSAGE, REQUESTED]) !== null;
    const closed = openSecretRequest([MESSAGE, REQUESTED, RECEIVED]) !== null;
    expect(composerPolicy({ awaitingSecret: open }).send).toBe("blocked");
    expect(composerPolicy({ awaitingSecret: closed }).send).toBe("enabled");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Rendering
// ───────────────────────────────────────────────────────────────────────────

describe("whether this client can show the step", () => {
  const step = { channel: "secure_control", expiresAt: new Date(LATER) };

  it("renders when every capability holds and the step has not expired", () => {
    expect(decideRendering({ step, capabilities: ALL_CAPABLE, now: NOW })).toMatchObject({
      render: "secure_control",
    });
  });

  it("checks the channel FIRST, before anything else is examined", () => {
    // A step for a channel this code does not know must not be examined
    // further — its other fields might not mean what they appear to. Every
    // capability is false here too, and the channel still wins.
    const decision = decideRendering({
      step: { channel: "sms", expiresAt: new Date(LATER) },
      capabilities: { supportsSecureControl: false, secureContext: false, endpointReachable: false },
      now: NOW,
    });
    expect(decision).toMatchObject({ render: "refuse", reason: "unknown_channel" });
  });

  it("refuses each capability failure with its own fixed text", () => {
    const cases = [
      [{ ...ALL_CAPABLE, supportsSecureControl: false }, "client_does_not_support_secure_control"],
      [{ ...ALL_CAPABLE, secureContext: false }, "insecure_context"],
      [{ ...ALL_CAPABLE, endpointReachable: false }, "endpoint_unreachable"],
    ] as const;
    for (const [capabilities, reason] of cases) {
      const decision = decideRendering({ step, capabilities, now: NOW });
      expect(decision, reason).toMatchObject({ render: "refuse", reason });
      if (decision.render === "refuse") {
        expect(decision.say).toBe(refusalText(reason));
        // Every refusal tells the student the one thing that matters.
        expect(decision.say.toLowerCase()).toContain("do not type a password into the chat");
      }
    }
  });

  it("refuses a step that expired before it could be drawn", () => {
    expect(
      decideRendering({ step, capabilities: ALL_CAPABLE, now: new Date("2026-08-28T10:06:00Z") }),
    ).toMatchObject({ render: "refuse", reason: "prompt_expired" });
  });

  it("has no outcome that would collect a password as a chat message", () => {
    // Not a branch somebody forgot to remove — a value the union does not have.
    const outcomes = new Set<string>();
    for (const capabilities of [
      ALL_CAPABLE,
      { ...ALL_CAPABLE, supportsSecureControl: false },
      { ...ALL_CAPABLE, secureContext: false },
      { ...ALL_CAPABLE, endpointReachable: false },
    ]) {
      outcomes.add(decideRendering({ step, capabilities, now: NOW }).render);
    }
    expect([...outcomes].sort()).toEqual(["refuse", "secure_control"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The model funnel
// ───────────────────────────────────────────────────────────────────────────

describe("what reaches the model", () => {
  it("gives a secure request one fixed sentence and nothing from the step", () => {
    const request = buildModelRequest({ utterance: "ok", events: [REQUESTED] });
    expect(request.history).toEqual([{ role: "assistant", content: SECURE_STEP_SENTENCE }]);
    expect(JSON.stringify(request)).not.toContain(REQUEST_ID);
  });

  it("gives a receipt a word and an opaque handle, and a rejection a code", () => {
    const rejected: ConversationEvent = {
      kind: "secret_rejected", ordinal: 4, createdAt: AT,
      requestId: REQUEST_ID, reason: "already_submitted",
    };
    const request = buildModelRequest({ utterance: "ok", events: [RECEIVED, rejected] });
    expect(request.history.map((entry) => entry.content)).toEqual([
      `[secret_received · ${HANDLE}]`,
      "[secret_rejected · already_submitted]",
    ]);
  });

  it("names every settling kind, so the model knows which ending happened", () => {
    const request = buildModelRequest({
      utterance: "ok",
      events: (["secret_consumed", "secret_expired", "secret_cancelled"] as const).map(
        (kind, index) => ({ kind, ordinal: index + 1, createdAt: AT, requestId: REQUEST_ID }),
      ),
    });
    expect(request.history.map((entry) => entry.content)).toEqual([
      "[secret_consumed]", "[secret_expired]", "[secret_cancelled]",
    ]);
  });

  it("sends nothing for a redacted body, rather than a blank turn", () => {
    // A blank turn is a gap the model would try to explain.
    const redacted: ConversationEvent = { ...MESSAGE, content: null, redactedAt: AT };
    expect(buildModelRequest({ utterance: "ok", events: [redacted] }).history).toEqual([]);
  });

  it("omits mentor and system messages, which are not the model's turn", () => {
    const mentor: ConversationEvent = { ...MESSAGE, actor: "mentor", content: "a human replied" };
    expect(buildModelRequest({ utterance: "ok", events: [mentor] }).history).toEqual([]);
  });

  it("cannot carry a secret, however one is smuggled onto an event", () => {
    const smuggled = { ...RECEIVED, content: MARKER, explanation: MARKER } as ConversationEvent;
    const request = buildModelRequest({ utterance: "ok", events: [MESSAGE, REQUESTED, smuggled] });
    expect(JSON.stringify(request)).not.toContain(MARKER);
  });

  it("bounds the history and each entry, so one long turn cannot crowd out the rest", () => {
    const many: ConversationEvent[] = Array.from({ length: 30 }, (_unused, index) => ({
      kind: "message", ordinal: index + 1, createdAt: AT,
      actor: "student", content: "x".repeat(2000),
    }));
    const request = buildModelRequest({ utterance: "y".repeat(9000), events: many });
    expect(request.history).toHaveLength(10);
    for (const entry of request.history) expect(entry.content.length).toBe(500);
    expect(request.message.length).toBe(2000);
  });

  it("refuses to persist anything that is not a message", () => {
    expect(persistableContent(MESSAGE)).toBe("when does term start?");
    for (const event of [REQUESTED, RECEIVED]) {
      expect(persistableContent(event), event.kind).toBeNull();
    }
  });
});
