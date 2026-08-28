/**
 * A refused attempt must not stall the conversation, and a refresh must not
 * leave a hole in it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Phase C. Two properties:
 *
 *   1. A rejection reaches the model as a CODE, so it knows to offer another
 *      attempt. Before this, the client set a `window` variable and pushed no
 *      turn at all — the model never learned, and the conversation stopped.
 *
 *   2. A refresh rebuilds the secure step IN PLACE from content-free rows,
 *      and rebuilds nothing that was typed.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import type { SecretPrompt, SecretRequestId } from "@askimate/aas-secrets";

import { buildModelRequest, persistableContent, type ChatTurn } from "./chat-transport.js";
import { replayEvents, type ConversationEvent } from "./conversation-events.js";
import { openSecureRequest, projectTranscript } from "./transcript.js";

const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";
const REQ = "sr_0123456789abcdef0123456789abcdef" as SecretRequestId;

const PROMPT: SecretPrompt = {
  requestId: REQ,
  channel: "secure_control",
  title: "Create a password for your university application",
  explanation: "This goes straight to the university. I never see it.",
  requiresConfirmation: true,
  portalHost: "apply.example.ac.uk",
  expiresAt: new Date("2026-08-27T10:05:00Z"),
  observedRules: [],
};

describe("a rejection reaches the model, so the conversation can continue", () => {
  it("renders as a code and nothing else", () => {
    const request = buildModelRequest({
      utterance: "ok",
      turns: [{ kind: "secret_rejected", reason: "confirmation_mismatch" }],
    });
    expect(request.history.map((h) => h.content)).toEqual([
      "[secret_rejected · confirmation_mismatch]",
    ]);
  });

  it("carries nothing the student typed, on any reason", () => {
    const reasons = [
      "confirmation_mismatch", "empty", "unknown_request", "expired",
      "already_submitted", "not_your_request", "wrong_conversation",
      "endpoint_unreachable", "prompt_expired",
      "client_does_not_support_secure_control", "insecure_context", "unknown_channel",
    ] as const;
    for (const reason of reasons) {
      const request = buildModelRequest({
        utterance: "ok",
        turns: [{ kind: "secret_rejected", reason }],
      });
      const all = request.history.map((h) => h.content).join(" ");
      expect(all).toBe(`[secret_rejected · ${reason}]`);
      expect(all).not.toContain(MARKER);
    }
  });

  it("is never persisted as a message", () => {
    expect(persistableContent({ kind: "secret_rejected", reason: "expired" })).toBeNull();
  });

  it("appears in the transcript in its real position", () => {
    const turns: readonly ChatTurn[] = [
      { kind: "message", sender: "ai", content: "I can create your account." },
      { kind: "directive", directive: "request_secret", prompt: PROMPT },
      { kind: "secret_rejected", reason: "confirmation_mismatch" },
    ];
    expect(projectTranscript(turns).map((i) => i.render)).toEqual([
      "message", "secure_control", "secret_rejected",
    ]);
  });

  it("carries a code, NOT a display sentence", () => {
    const items = projectTranscript([{ kind: "secret_rejected", reason: "expired" }]);
    const item = items[0];
    if (item?.render !== "secret_rejected") throw new Error("expected a rejection item");
    expect(item.reason).toBe("expired");
    // A display string on the turn is a field someone later assembles from
    // input. The sentence is chosen at render time from a fixed table.
    expect(Object.keys(item)).not.toContain("say");
    expect(Object.keys(item)).not.toContain("message");
  });
});

describe("a rejection does NOT release the composer", () => {
  it("leaves the request open after a mismatch, so the student can retry", () => {
    // The subtle one. A mismatch leaves the request in `secret_requested` on
    // the server. If the client treated the rejection as closure it would
    // re-enable sending while a live request is still open — exactly the
    // divergence the server-side guard exists to catch.
    const open = openSecureRequest(
      projectTranscript([
        { kind: "directive", directive: "request_secret", prompt: PROMPT },
        { kind: "secret_rejected", reason: "confirmation_mismatch" },
      ]),
    );
    expect(open).toEqual(PROMPT);
  });

  it("closes only on a lifecycle transition, which only the store can make", () => {
    for (const lifecycle of ["secret_received", "secret_consumed", "secret_expired"] as const) {
      expect(
        openSecureRequest(
          projectTranscript([
            { kind: "directive", directive: "request_secret", prompt: PROMPT },
            { kind: "secret_rejected", reason: "confirmation_mismatch" },
            { kind: "secret_status", lifecycle },
          ]),
        ),
      ).toBeNull();
    }
  });
});

describe("replaying a conversation after a refresh", () => {
  const events: readonly ConversationEvent[] = [
    { conversationId: 7, ordinal: 1, kind: "directive", requestId: REQ },
    { conversationId: 7, ordinal: 2, kind: "secret_rejected", requestId: REQ,
      reasonCode: "confirmation_mismatch" },
    { conversationId: 7, ordinal: 3, kind: "secret_status", requestId: REQ,
      lifecycle: "secret_received" },
  ];
  const prompts = new Map([[REQ, PROMPT]]);

  it("rebuilds each secure step at its original position", () => {
    const replayed = replayEvents({ events, prompts });
    expect(replayed.map((r) => r.ordinal)).toEqual([1, 2, 3]);
    expect(replayed.map((r) => r.turn.kind)).toEqual([
      "directive", "secret_rejected", "secret_status",
    ]);
  });

  it("rebuilds the prompt from the requests table, not from the event row", () => {
    const [first] = replayEvents({ events, prompts });
    if (first?.turn.kind !== "directive") throw new Error("expected a directive");
    expect(first.turn.prompt).toEqual(PROMPT);
    // Proof it came from the prompt map: with no prompt available, the event
    // is dropped rather than rendered from a placeholder.
    expect(replayEvents({ events, prompts: new Map() })).toHaveLength(2);
  });

  it("does NOT restore a handle — it would resolve to nothing after a restart", () => {
    // Replaying a stale handle would tell the model a secret is available when
    // the store that held it is gone.
    const replayed = replayEvents({
      events: [{ conversationId: 7, ordinal: 1, kind: "secret_status", requestId: REQ,
                 lifecycle: "secret_received" }],
      prompts,
    });
    const turn = replayed[0]?.turn;
    if (turn?.kind !== "secret_status") throw new Error("expected a status");
    expect(turn.handle).toBeUndefined();
  });

  it("restores nothing that was typed — there is nowhere for it to have been", () => {
    // The whole point of the table's shape. Every field on a ConversationEvent
    // is an id, an ordinal, or a value from a closed set.
    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(MARKER);
    for (const event of events) {
      for (const value of Object.values(event)) {
        expect(String(value)).not.toContain(MARKER);
      }
    }
  });

  it("drops an event whose payload is missing rather than inventing one", () => {
    expect(
      replayEvents({
        events: [{ conversationId: 7, ordinal: 1, kind: "secret_status", requestId: REQ }],
        prompts,
      }),
    ).toEqual([]);
    expect(
      replayEvents({
        events: [{ conversationId: 7, ordinal: 1, kind: "secret_rejected", requestId: REQ }],
        prompts,
      }),
    ).toEqual([]);
  });
});
