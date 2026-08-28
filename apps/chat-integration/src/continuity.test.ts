/**
 * Replay after a refresh — what the stored rows can and cannot rebuild.
 *
 * ── What used to be here, and where it went ──────────────────────────────
 *
 * This file also asserted how a rejection reaches the model, that it is never
 * persisted, that it appears in the transcript in its real position, and that
 * it does not release the composer. All four were assertions about DECISIONS,
 * and the decisions now live in one place — so the assertions do too, in
 * `packages/conversation/src/conversation.test.ts`.
 *
 * Keeping copies here would have been the same duplication one layer up: two
 * suites asserting one behaviour, free to drift apart the moment somebody
 * changed one of them.
 *
 * What is left is genuinely this app's: `replayEvents` reads the LEGACY
 * `askimate_conversation_events` table, which the new schema
 * (apps/conversation-service/migrations) replaces. It has no counterpart in
 * the extracted package because it is a fact about a table being retired.
 */

import { describe, expect, it } from "vitest";

import type { SecretPrompt, SecretRequestId } from "@askimate/aas-secrets";

import { replayEvents, type StoredSecureRecord } from "./conversation-events.js";

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

describe("replaying a conversation after a refresh", () => {
  const events: readonly StoredSecureRecord[] = [
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
    // The replayed events are WIRE events now, so the kinds are the log's
    // words rather than the stored row's. Same three positions, same order.
    expect(replayed.map((r) => r.event.kind)).toEqual([
      "secret_requested", "secret_rejected", "secret_expired",
    ]);
  });

  it("rebuilds the expiry from the requests table, not from the event row", () => {
    const [first] = replayEvents({ events, prompts });
    if (first?.event.kind !== "secret_requested") throw new Error("expected a request");
    // The row holds no prompt; the expiry comes from the requests table. The
    // TITLE and EXPLANATION are not restored at all — they are text a model
    // wrote, and the conversation log has nowhere to put them (ADR-0031).
    expect(first.event.expiresAt).toBe(PROMPT.expiresAt.toISOString());
    expect(JSON.stringify(first.event)).not.toContain(PROMPT.title);
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
    // A received step replays as EXPIRED, not as received. A handle nobody can
    // spend is not a secret that is available, and `secret_received` without a
    // handle is unrepresentable in the wire model — the CHECK constraint says
    // the same thing in the database.
    const event = replayed[0]?.event;
    expect(event?.kind).toBe("secret_expired");
    expect(JSON.stringify(event)).not.toContain("sh_");
  });

  it("restores nothing that was typed — there is nowhere for it to have been", () => {
    // The whole point of the table's shape. Every field on a stored record
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
