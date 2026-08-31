/**
 * The two readings of a log's secret step, tested together.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `openSecretRequest` answers "is a step open?" — the composer guard's
 * question. `latestSecretRequest` answers "where did the last one get to?" —
 * the Run Driver's. They read the same events and must not drift, which is why
 * they live in one file under one boundary rule.
 *
 * The comment on `openSecretRequest` records what happened when two readings of
 * this log DID exist in two places: a lapsed request released a live one's
 * guard. Every "stale" test below is that defect, in the other reading.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import type { ConversationEvent } from "@askimate/aas-contracts";

import { latestSecretRequest, openSecretRequest } from "./openness.js";

const AT = "2026-08-31T10:00:00.000Z";
const LATER = "2026-08-31T10:05:00.000Z";

let ordinal = 0;
const next = (): number => (ordinal += 1);

const message = (content: string): ConversationEvent => ({
  kind: "message",
  ordinal: next(),
  createdAt: AT,
  actor: "student",
  content,
});
const requested = (requestId: string): ConversationEvent => ({
  kind: "secret_requested",
  ordinal: next(),
  createdAt: AT,
  requestId,
  channel: "secure_control",
  expiresAt: LATER,
});
const received = (requestId: string, handle: string): ConversationEvent => ({
  kind: "secret_received",
  ordinal: next(),
  createdAt: AT,
  requestId,
  handle,
});
const consumed = (requestId: string): ConversationEvent => ({
  kind: "secret_consumed",
  ordinal: next(),
  createdAt: AT,
  requestId,
});
const expired = (requestId: string): ConversationEvent => ({
  kind: "secret_expired",
  ordinal: next(),
  createdAt: AT,
  requestId,
});

describe("whether a secure step is open", () => {
  it("is open once requested and closed once settled", () => {
    expect(openSecretRequest([message("hi"), requested("sr_1")])).toBe("sr_1");
    expect(openSecretRequest([requested("sr_2"), consumed("sr_2")])).toBeNull();
  });

  it("does not let a STALE request's settlement release a live one", () => {
    expect(
      openSecretRequest([requested("sr_3"), expired("sr_3"), requested("sr_4"), consumed("sr_3")]),
    ).toBe("sr_4");
  });
});

describe("the latest secret request, and where it got to", () => {
  it("reports nothing when the log has no secret step", () => {
    expect(latestSecretRequest([message("hello")])).toBeNull();
  });

  it("reports an open request as requested, with no handle", () => {
    const found = latestSecretRequest([requested("sr_a")]);
    expect(found).toEqual({ requestId: "sr_a", lifecycle: "secret_requested" });
  });

  it("carries the handle once the student has answered", () => {
    const found = latestSecretRequest([requested("sr_b"), received("sr_b", "sh_b")]);
    expect(found).toEqual({
      requestId: "sr_b",
      lifecycle: "secret_received",
      handle: "sh_b",
    });
  });

  it("keeps a settled request settled, so the driver does not ask again", () => {
    const found = latestSecretRequest([
      requested("sr_c"),
      received("sr_c", "sh_c"),
      consumed("sr_c"),
    ]);
    expect(found?.lifecycle).toBe("secret_consumed");
  });

  it("does not let a STALE request's settlement move a live one", () => {
    const found = latestSecretRequest([
      requested("sr_d"),
      expired("sr_d"),
      requested("sr_e"),
      consumed("sr_d"),
    ]);
    expect(found).toEqual({ requestId: "sr_e", lifecycle: "secret_requested" });
  });

  it("does not carry a handle across a new request", () => {
    // A handle belongs to the request it was minted for. Carrying one over
    // would hand an automation a handle for a request nobody answered.
    const found = latestSecretRequest([
      requested("sr_f"),
      received("sr_f", "sh_f"),
      requested("sr_g"),
    ]);
    expect(found).toEqual({ requestId: "sr_g", lifecycle: "secret_requested" });
    expect(found).not.toHaveProperty("handle");
  });

  it("agrees with the guard about which request is live", () => {
    // The drift check. Whenever the guard says a step is open, the driver's
    // reading must name the same request and call it unsettled.
    const log = [requested("sr_h"), expired("sr_h"), requested("sr_i")];
    const open = openSecretRequest(log);
    const latest = latestSecretRequest(log);
    expect(latest?.requestId).toBe(open);
    expect(latest?.lifecycle).toBe("secret_requested");
  });
});
