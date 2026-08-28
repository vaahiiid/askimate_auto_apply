/**
 * The client log: what the server placed, and what the browser is drawing.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Two concurrent writers cannot receive the same durable
 * ordinal… Reconnect does not duplicate durable events… Two clients observing
 * the same conversation converge on the same ordering… The client no longer
 * depends on `previous.length + 1` for durable event identity."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Properties 6, 7 and 8 have a server half, proven against real PostgreSQL in
 * `apps/conversation-service`, and a CLIENT half, proven here. The server can
 * be perfect and a browser that appends every frame it receives will still
 * double an event across a reconnect — so the rule lives in one place, and this
 * is where it is checked.
 */

import { describe, expect, it } from "vitest";

import type { ConversationEvent } from "@askimate/aas-contracts";

import {
  EMPTY_LOG,
  addProvisional,
  admitAllDurable,
  admitDurable,
  describesSame,
  durableEvents,
  openSecretRequestInLog,
  projectLog,
  retireProvisional,
} from "./log.js";
import { renderKey } from "./transcript.js";

const AT = "2026-08-28T10:00:00.000Z";

function said(ordinal: number, content: string): ConversationEvent {
  return { kind: "message", ordinal, createdAt: AT, actor: "student", content };
}

function requested(ordinal: number, requestId: string): ConversationEvent {
  return {
    kind: "secret_requested",
    ordinal,
    createdAt: AT,
    requestId,
    channel: "secure_control",
    expiresAt: "2026-08-28T10:05:00.000Z",
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Property 6 (client half): a reconnect cannot duplicate a durable event
// ───────────────────────────────────────────────────────────────────────────

describe("admitting what the server placed", () => {
  it("ignores an ordinal it already holds — property 6, in the browser", () => {
    // A resumed stream overlaps by design: the service backfills from
    // `Last-Event-ID` and THEN subscribes, and a live frame can race the
    // backfill. Both deliveries carry the same ordinal, and the second is not
    // new information.
    const once = admitAllDurable(EMPTY_LOG, [said(1, "hello"), said(2, "again")]);
    const twice = admitAllDurable(once, [said(1, "hello"), said(2, "again")]);

    expect(durableEvents(twice)).toHaveLength(2);
    expect(durableEvents(twice).map((event) => event.ordinal)).toEqual([1, 2]);
  });

  it("ignores a re-delivery even when its BODY differs", () => {
    // Same position, different text. Whatever this is — a redaction that
    // arrived late, a bug upstream — appending it would put two events at one
    // ordinal, and an ordinal identifies a position uniquely. The first one
    // wins and nothing is duplicated.
    const held = admitDurable(EMPTY_LOG, said(1, "original"));
    const after = admitDurable(held, said(1, "different"));

    expect(durableEvents(after)).toHaveLength(1);
    expect(durableEvents(after)[0]).toMatchObject({ content: "original" });
  });

  it("orders by ordinal, not by arrival — property 7, in the browser", () => {
    // Two clients on one conversation: one is live, one reconnected and got
    // its backfill after a live frame had already landed. Same events, opposite
    // arrival order, and they must agree — otherwise the same conversation
    // reads differently in two tabs of the same browser.
    const live = admitAllDurable(EMPTY_LOG, [said(1, "a"), said(2, "b"), said(3, "c")]);
    const reconnected = admitAllDurable(EMPTY_LOG, [said(3, "c"), said(1, "a"), said(2, "b")]);

    expect(durableEvents(reconnected)).toEqual(durableEvents(live));
    expect(durableEvents(reconnected).map((event) => event.ordinal)).toEqual([1, 2, 3]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Property 8: a rendering position is not a durable ordinal
// ───────────────────────────────────────────────────────────────────────────

describe("what the client draws on its own", () => {
  it("gives a provisional entry no position at all — property 8", () => {
    const drawn = addProvisional(EMPTY_LOG, {
      localId: "local-1",
      event: { kind: "message", actor: "student", content: "typing" },
    });

    // Nothing durable: the log's own list is what a resume cursor would be
    // taken from, and this entry is not in it.
    expect(durableEvents(drawn)).toEqual([]);
    const item = projectLog(drawn)[0];
    expect(item?.position).toEqual({ placement: "provisional", localId: "local-1" });
    // No `ordinal` key anywhere on it, not even one holding `undefined` — a
    // key that exists is a key `JSON.stringify` emits and a consumer reads.
    expect(Object.keys(item?.position ?? {})).not.toContain("ordinal");
  });

  it("keeps provisional and durable keys in different spaces", () => {
    // If both flattened to "1", React would reuse one item's DOM node for the
    // other. For a secure step that means a settled request wearing a live
    // control's element — a form a student could still submit to.
    expect(renderKey({ placement: "durable", ordinal: 1 })).not.toBe(
      renderKey({ placement: "provisional", localId: "1" }),
    );
  });

  it("draws the durable events first, then what it is drawing", () => {
    const log = addProvisional(admitDurable(EMPTY_LOG, said(1, "placed")), {
      localId: "local-1",
      event: { kind: "message", actor: "student", content: "unplaced" },
    });

    expect(projectLog(log).map((item) => item.position)).toEqual([
      { placement: "durable", ordinal: 1 },
      { placement: "provisional", localId: "local-1" },
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Reconciliation: the echo becomes the event
// ───────────────────────────────────────────────────────────────────────────

describe("reconciling an echo with the event it becomes", () => {
  it("retires the echo when the same happening arrives placed", () => {
    // The student sees their message immediately; the server writes it and
    // says where. Without this, the transcript shows it twice — once as the
    // echo and once as the real event — which is the failure mode a client
    // that renders optimistically usually ships with.
    const drawn = addProvisional(EMPTY_LOG, {
      localId: "local-1",
      event: { kind: "message", actor: "student", content: "when does term start?" },
    });
    const placed = admitDurable(drawn, said(4, "when does term start?"));

    expect(projectLog(placed)).toHaveLength(1);
    expect(projectLog(placed)[0]?.position).toEqual({ placement: "durable", ordinal: 4 });
  });

  it("matches a secure event by its request, not by its position", () => {
    const drawn = addProvisional(EMPTY_LOG, {
      localId: "local-1",
      event: { kind: "secret_received", requestId: "sr_1", handle: "sh_1" },
    });
    const placed = admitDurable(drawn, {
      kind: "secret_received",
      ordinal: 9,
      createdAt: AT,
      requestId: "sr_1",
      handle: "sh_1",
    });

    expect(projectLog(placed)).toHaveLength(1);
  });

  it("does NOT retire an echo of a different happening", () => {
    const drawn = addProvisional(EMPTY_LOG, {
      localId: "local-1",
      event: { kind: "message", actor: "student", content: "mine" },
    });
    const placed = admitDurable(drawn, said(1, "somebody else's"));

    expect(projectLog(placed)).toHaveLength(2);
  });

  it("retires by local id, for a server that normalised what it stored", () => {
    // Trimming, truncating, redacting: the stored body may not equal what was
    // sent, so `describesSame` would miss. The id the client minted is the
    // reconciliation that cannot miss, which is why `send` uses both.
    const drawn = addProvisional(EMPTY_LOG, {
      localId: "local-1",
      event: { kind: "message", actor: "student", content: "  padded  " },
    });
    const placed = retireProvisional(admitDurable(drawn, said(1, "padded")), "local-1");

    expect(projectLog(placed)).toHaveLength(1);
    expect(projectLog(placed)[0]?.position).toEqual({ placement: "durable", ordinal: 1 });
  });

  it("treats two events of different kinds as different happenings", () => {
    expect(
      describesSame(
        { kind: "secret_received", requestId: "sr_1", handle: "sh_1" },
        { kind: "secret_cancelled", requestId: "sr_1" },
      ),
    ).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Openness over the whole log
// ───────────────────────────────────────────────────────────────────────────

describe("openness, over everything the student can see", () => {
  it("is open while the durable directive stands", () => {
    const log = admitDurable(EMPTY_LOG, requested(1, "sr_1"));
    expect(openSecretRequestInLog(log)).toBe("sr_1");
  });

  it("closes on a provisional settlement the server already confirmed", () => {
    // `submitted()` draws this after a 200 from the secure endpoint. The
    // legacy response carries no ordinal, so the entry is provisional — but the
    // transition is a fact, and the composer must not stay blocked behind a
    // step the student has finished. The server's own 409 remains the real
    // boundary either way.
    const open = admitDurable(EMPTY_LOG, requested(1, "sr_1"));
    const settled = addProvisional(open, {
      localId: "local-1",
      event: { kind: "secret_received", requestId: "sr_1", handle: "sh_1" },
    });

    expect(openSecretRequestInLog(settled)).toBeNull();
  });

  it("does not let a settlement for ANOTHER request release this one", () => {
    // The rule `openSecretRequest` exists to state, asked here of a log whose
    // two entries have different placements — which is the arrangement that
    // would tempt a client into comparing positions instead of requests.
    const open = admitDurable(EMPTY_LOG, requested(1, "sr_live"));
    const noise = addProvisional(open, {
      localId: "local-1",
      event: { kind: "secret_cancelled", requestId: "sr_lapsed" },
    });

    expect(openSecretRequestInLog(noise)).toBe("sr_live");
  });

  it("is unaffected by a rejection, provisional or durable", () => {
    const open = admitDurable(EMPTY_LOG, requested(1, "sr_1"));
    const rejected = addProvisional(open, {
      localId: "local-1",
      event: { kind: "secret_rejected", requestId: "sr_1", reason: "confirmation_mismatch" },
    });

    expect(openSecretRequestInLog(rejected)).toBe("sr_1");
  });

  it("re-opens nothing when a retired echo is removed", () => {
    // Retiring the echo of a settlement whose durable version has landed must
    // not leave the request looking open again — the composer would re-block
    // for a step that is finished.
    const open = admitDurable(EMPTY_LOG, requested(1, "sr_1"));
    const echoed = addProvisional(open, {
      localId: "local-1",
      event: { kind: "secret_received", requestId: "sr_1", handle: "sh_1" },
    });
    const placed = admitDurable(echoed, {
      kind: "secret_received",
      ordinal: 2,
      createdAt: AT,
      requestId: "sr_1",
      handle: "sh_1",
    });

    expect(placed.provisional).toEqual([]);
    expect(openSecretRequestInLog(placed)).toBeNull();
  });
});
