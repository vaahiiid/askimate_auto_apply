/**
 * @vitest-environment jsdom
 */
/**
 * The React client, driven through its own state machine.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Treat the existing tested TypeScript security modules as
 * the single authority. Do not duplicate rendering, transcript, open-request,
 * composer, or security decisions in new client code."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These tests are about the SEAM. `projectTranscript`, `openSecureRequest`,
 * `composerPolicy` and `decideRendering` are each tested in transcript.test.ts
 * and fail-closed.test.ts; what is unproven until here is that the client
 * actually asks them, and does what they answer — which is exactly where the
 * vanilla harness diverged.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
// `act` comes from Testing Library, not from React directly. Importing it from
// React left `IS_REACT_ACT_ENVIRONMENT` unset, and every delivery printed
// "The current testing environment is not configured to support act(...)" —
// which means the wrapper was not actually flushing the update it claimed to.
// The assertions still passed, because Testing Library's own `fireEvent` was
// flushing them a moment later. A green test whose synchronisation is doing
// nothing is a green test for the wrong reason.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { SecretPrompt, SecretRequestId } from "@askimate/aas-secrets";
import type { ConversationEvent } from "@askimate/aas-contracts";

import { ChatView, DRAFT_KEY } from "./ChatView.js";
import { parseIncomingTurn, useSecureTurn, type SecureTurnTransport } from "./useSecureTurn.js";

const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";
const CONVERSATION_ID = 77;
const REQUEST_ID = `sr_${"a".repeat(32)}` as SecretRequestId;
const NOW = new Date("2026-08-28T10:00:00Z");

const PROMPT: SecretPrompt = {
  requestId: REQUEST_ID,
  channel: "secure_control",
  title: "Create a password for your university application",
  explanation: "This goes straight to the university. I never see it.",
  requiresConfirmation: true,
  portalHost: "apply.example.ac.uk",
  expiresAt: new Date(NOW.getTime() + 300_000),
  observedRules: [],
};

const DIRECTIVE = { kind: "directive", directive: "request_secret", prompt: PROMPT } as const;

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom always has storage; a failure here is not the test's business.
  }
});

/**
 * Mounts the real view over the real hook, with the network replaced.
 *
 * Deliberately NOT a bare `renderHook`. The seam under test includes the view's
 * reading of the policy, and a hook tested in isolation would let the view
 * disagree with it silently — which is the whole class of bug this phase is
 * about.
 */
function mount(
  overrides: Partial<SecureTurnTransport> = {},
  capabilities = { supportsSecureControl: true, secureContext: true, endpointReachable: true },
): {
  readonly sent: { conversationId: number; content: string }[];
  readonly cancelled: string[];
  readonly receive: (turn: unknown) => void;
  readonly turns: () => readonly unknown[];
  /** Only what the server placed. Positions are legitimate to read from here. */
  readonly durable: () => readonly ConversationEvent[];
  /** Only what the client is drawing. Nothing here has a position. */
  readonly drawn: () => readonly unknown[];
  readonly send: (content: string) => Promise<unknown>;
} {
  const sent: { conversationId: number; content: string }[] = [];
  const cancelled: string[] = [];
  /** The stand-in server's `last_ordinal`, advanced two per accepted send. */
  let sentOrdinal = 1;

  const transport: SecureTurnTransport = {
    send: async (input) => {
      sent.push({ ...input });
      // A stand-in server that PLACES what it wrote. `reply: "noted"` was the
      // old shape: a bare string the client had to find a position for, which
      // is what it used to do with `previous.length + 1`.
      const base = sentOrdinal;
      sentOrdinal += 2;
      return await Promise.resolve({
        ok: true,
        body: {
          status: "accepted",
          events: [
            {
              kind: "message",
              ordinal: base,
              createdAt: NOW.toISOString(),
              actor: "student",
              content: input.content,
            },
            {
              kind: "message",
              ordinal: base + 1,
              createdAt: NOW.toISOString(),
              actor: "assistant",
              content: "noted",
            },
          ],
        },
      });
    },
    cancel: async (requestId) => {
      cancelled.push(requestId);
      return await Promise.resolve(true);
    },
    ...overrides,
  };

  let receive: (turn: unknown) => void = () => undefined;
  let turns: readonly unknown[] = [];
  let durable: readonly ConversationEvent[] = [];
  let drawn: readonly unknown[] = [];
  let send: (content: string) => Promise<unknown> = async () => Promise.resolve(undefined);

  function Harness(): React.JSX.Element {
    const state = useSecureTurn({
      conversationId: CONVERSATION_ID,
      capabilities: () => capabilities,
      transport,
      now: () => NOW,
    });
    receive = (raw) => {
      const parsed = parseIncomingTurn(raw);
      if (parsed !== null) state.receive(parsed);
    };
    turns = state.events;
    durable = state.log.durable;
    drawn = state.log.provisional.map((entry) => entry.event);
    send = state.send;
    return <ChatView state={state} conversationId={CONVERSATION_ID} authToken="a-token" />;
  }

  render(<Harness />);
  return {
    sent,
    cancelled,
    receive: (turn) => {
      act(() => {
        receive(turn);
      });
    },
    turns: () => turns,
    durable: () => durable,
    drawn: () => drawn,
    send: async (content: string) => {
      let outcome: unknown;
      await act(async () => {
        outcome = await send(content);
      });
      return outcome;
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// The transcript, and who decides what is in it
// ───────────────────────────────────────────────────────────────────────────

describe("the secure request takes its place in the conversation", () => {
  it("renders the control BETWEEN the messages around it, not beside them", () => {
    const client = mount();
    client.receive({ kind: "message", actor: "assistant", content: "before" });
    client.receive(DIRECTIVE);
    client.receive({ kind: "message", actor: "assistant", content: "after" });

    const transcript = screen.getByTestId("transcript");
    const order = Array.from(transcript.children).map((child) =>
      child.getAttribute("data-testid") ?? child.className,
    );
    expect(order).toEqual(["turn", "secure-control", "turn"]);
  });

  it("blocks SENDING while the request is open, and never blocks typing", () => {
    const client = mount();
    client.receive(DIRECTIVE);

    expect(screen.getByTestId<HTMLButtonElement>("chat-send").disabled).toBe(true);
    expect(screen.getByTestId<HTMLInputElement>("chat-input").disabled).toBe(false);
    expect(screen.getByTestId("chat-input").getAttribute("data-typing")).toBe("live");
    expect(screen.getByTestId("chat-input").getAttribute("data-send")).toBe("blocked");
  });

  it("releases sending once the secret is received", async () => {
    const client = mount();
    client.receive(DIRECTIVE);
    client.receive({
      kind: "secret_status", requestId: REQUEST_ID,
      lifecycle: "secret_received", handle: "sh_x",
    });

    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>("chat-send").disabled).toBe(false);
    });
    expect(screen.queryByTestId("secure-control")).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The rejection contract — the rule the harness got wrong
// ───────────────────────────────────────────────────────────────────────────

describe("a rejection is a turn, and closes nothing", () => {
  it("leaves the card and the block in place after a mismatch", () => {
    const client = mount();
    client.receive(DIRECTIVE);
    client.receive({ kind: "secret_rejected", requestId: REQUEST_ID, reason: "confirmation_mismatch" });

    // The card is still there — the student mistyped, and retrying is the point.
    expect(screen.getByTestId("secure-control")).toBeTruthy();
    // And the composer is still blocked, because the SERVER still has the
    // request open. The harness released it here for every reason but this one.
    expect(screen.getByTestId<HTMLButtonElement>("chat-send").disabled).toBe(true);
    expect(screen.getByTestId("rejection").getAttribute("data-rejected")).toBe(
      "confirmation_mismatch",
    );
  });

  it("leaves it in place for a reason the student cannot retry, too", () => {
    // `already_submitted` leaves the row at `secret_requested` on the server —
    // see secret-routes.ts. A client that closed here would release its
    // composer and then collect a 409 on the student's next message.
    const client = mount();
    client.receive(DIRECTIVE);
    client.receive({ kind: "secret_rejected", requestId: REQUEST_ID, reason: "already_submitted" });

    expect(screen.getByTestId("secure-control")).toBeTruthy();
    expect(screen.getByTestId<HTMLButtonElement>("chat-send").disabled).toBe(true);
  });

  it("carries a code, never a sentence — the wording is chosen in the view", () => {
    const client = mount();
    client.receive(DIRECTIVE);
    client.receive({ kind: "secret_rejected", requestId: REQUEST_ID, reason: "confirmation_mismatch" });

    expect(JSON.stringify(client.turns())).not.toContain("did not match");
    expect(screen.getByTestId("rejection").textContent ?? "").toContain("did not match");
  });

  it("drops a reason that is not in the closed set rather than passing it on", () => {
    const client = mount();
    client.receive(DIRECTIVE);
    client.receive({ kind: "secret_rejected", requestId: REQUEST_ID, reason: "because-i-said-so" });

    expect(screen.queryByTestId("rejection")).toBeNull();
    expect(JSON.stringify(client.turns())).not.toContain("because-i-said-so");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Cancellation, through the real endpoint
// ───────────────────────────────────────────────────────────────────────────

describe("abandoning the step", () => {
  it("deletes the request and closes it through a LIFECYCLE transition", async () => {
    const client = mount();
    client.receive(DIRECTIVE);

    fireEvent.click(screen.getByTestId("secure-cancel"));

    await waitFor(() => {
      expect(client.cancelled).toEqual([REQUEST_ID]);
    });
    await waitFor(() => {
      expect(screen.getByTestId("status").getAttribute("data-lifecycle")).toBe(
        "secret_cancelled",
      );
    });
    // Released — and released the only way `openSecureRequest` allows, which is
    // a status turn. Nothing here decides on its own that a request is closed.
    expect(screen.getByTestId<HTMLButtonElement>("chat-send").disabled).toBe(false);
    expect(screen.queryByTestId("secure-control")).toBeNull();
  });

  it("does NOT close it when the delete failed, because it is still open", async () => {
    const client = mount({ cancel: async () => await Promise.resolve(false) });
    client.receive(DIRECTIVE);

    fireEvent.click(screen.getByTestId("secure-cancel"));

    await waitFor(() => {
      expect(screen.getByTestId("rejection")).toBeTruthy();
    });
    expect(screen.getByTestId("rejection").getAttribute("data-rejected")).toBe(
      "endpoint_unreachable",
    );
    // Still open, still blocked. A client that announced a closure it had not
    // achieved is the divergence in the other direction.
    expect(screen.getByTestId("secure-control")).toBeTruthy();
    expect(screen.getByTestId<HTMLButtonElement>("chat-send").disabled).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Failing closed when the control cannot be shown
// ───────────────────────────────────────────────────────────────────────────

describe("a directive this client cannot service", () => {
  it("shows fixed refusal text, tells the model, cancels, and frees the student", async () => {
    const client = mount({}, {
      supportsSecureControl: true,
      secureContext: false,
      endpointReachable: true,
    });
    client.receive(DIRECTIVE);

    expect(screen.getByTestId("refusal").getAttribute("data-reason")).toBe("insecure_context");
    // No card was drawn, so no directive turn was appended — a `secure_control`
    // item with nothing able to render it is worse than none.
    expect(screen.queryByTestId("secure-control")).toBeNull();
    // The model is told, in a code, so the run does not wait forever.
    expect(screen.getByTestId("rejection").getAttribute("data-rejected")).toBe("insecure_context");
    // And the server-side request is closed, so the conversation is not held
    // behind a 409 for the whole TTL for a step nobody can complete.
    await waitFor(() => {
      expect(client.cancelled).toEqual([REQUEST_ID]);
    });
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>("chat-send").disabled).toBe(false);
    });
  });

  it("refuses an unknown channel FIRST, before reading anything else", () => {
    const client = mount();
    client.receive({
      kind: "directive",
      directive: "request_secret",
      prompt: { ...PROMPT, channel: "sms" },
    });

    expect(screen.getByTestId("refusal").getAttribute("data-reason")).toBe("unknown_channel");
    expect(screen.queryByTestId("secure-control")).toBeNull();
  });

  it("refuses a prompt that expired before it could be drawn", () => {
    const client = mount();
    client.receive({
      kind: "directive",
      directive: "request_secret",
      prompt: { ...PROMPT, expiresAt: new Date(NOW.getTime() - 1000) },
    });

    expect(screen.getByTestId("refusal").getAttribute("data-reason")).toBe("prompt_expired");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The draft, which is what the student actually loses if this is wrong
// ───────────────────────────────────────────────────────────────────────────

describe("nothing destroys what the student typed", () => {
  it("holds a send while a request is open, transmitting NOTHING and keeping the text", () => {
    const client = mount();
    client.receive(DIRECTIVE);

    const input = screen.getByTestId<HTMLInputElement>("chat-input");
    fireEvent.change(input, { target: { value: "will my offer still stand?" } });
    fireEvent.submit(screen.getByTestId("composer"));

    expect(client.sent).toEqual([]);
    expect(input.value).toBe("will my offer still stand?");
    expect(screen.getByTestId("hint").textContent ?? "").toContain("still be here");
  });

  it("keeps the text when the SERVER refuses, and blocks send on the server's word alone", async () => {
    // No directive was ever delivered: this client's transcript is empty and it
    // still must not send. The 409 is the only thing that knows.
    const client = mount({
      send: async () =>
        await Promise.resolve({
          ok: false,
          body: {
            status: "refused",
            reason: "secret_request_open",
            requestId: REQUEST_ID,
            expiresAt: PROMPT.expiresAt.toISOString(),
          },
        }),
    });

    const input = screen.getByTestId<HTMLInputElement>("chat-input");
    fireEvent.change(input, { target: { value: "a genuine question" } });
    fireEvent.submit(screen.getByTestId("composer"));

    await waitFor(() => {
      expect(screen.getByTestId("hint").textContent ?? "").toContain("still here");
    });
    expect(input.value).toBe("a genuine question");
    // Not appended to the transcript either — a refused message is not history.
    expect(JSON.stringify(client.turns())).not.toContain("a genuine question");
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>("chat-send").disabled).toBe(true);
    });
  });

  it("keeps the text when the connection drops", async () => {
    let attempts = 0;
    const client = mount({
      send: async () => {
        attempts += 1;
        return await Promise.resolve({ ok: false, body: null });
      },
    });

    const input = screen.getByTestId<HTMLInputElement>("chat-input");
    fireEvent.change(input, { target: { value: "still mine" } });
    fireEvent.submit(screen.getByTestId("composer"));

    await waitFor(() => {
      expect(screen.getByTestId("hint").textContent ?? "").toContain("still here");
    });
    expect(input.value).toBe("still mine");
    // The attempt was made and failed — the draft survived a real failure
    // rather than a path where nothing was tried. `client.sent` is empty here
    // because this test replaces the transport's `send` outright.
    expect(attempts).toBe(1);
    expect(client.sent).toEqual([]);
  });

  it("clears only on acknowledgement", async () => {
    const client = mount();
    const input = screen.getByTestId<HTMLInputElement>("chat-input");
    fireEvent.change(input, { target: { value: "when does term start?" } });
    fireEvent.submit(screen.getByTestId("composer"));

    await waitFor(() => {
      expect(input.value).toBe("");
    });
    expect(client.sent).toEqual([
      { conversationId: CONVERSATION_ID, content: "when does term start?" },
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Containment: browser storage
// ───────────────────────────────────────────────────────────────────────────

describe("no draft reaches browser storage while a request is open", () => {
  it("removes an existing draft the moment the card opens", () => {
    window.localStorage.setItem(DRAFT_KEY, "typed a moment before the card appeared");
    const client = mount();
    client.receive(DIRECTIVE);

    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("writes nothing while suspended, however much is typed", () => {
    const client = mount();
    client.receive(DIRECTIVE);

    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: MARKER } });

    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(JSON.stringify(window.localStorage)).not.toContain(MARKER);
  });

  it("persists again once the step has settled, so the feature is not simply broken", async () => {
    const client = mount();
    client.receive(DIRECTIVE);
    client.receive({
      kind: "secret_status", requestId: REQUEST_ID,
      lifecycle: "secret_received", handle: "sh_x",
    });

    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>("chat-send").disabled).toBe(false);
    });
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "ordinary text" } });
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe("ordinary text");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// What the container is, and is not, holding
// ───────────────────────────────────────────────────────────────────────────

describe("the container holds no secret", () => {
  it("never sees a password: the only value it is handed is a handle", async () => {
    const client = mount();
    client.receive(DIRECTIVE);

    fireEvent.change(screen.getByTestId("secure-password"), { target: { value: MARKER } });
    fireEvent.change(screen.getByTestId("secure-confirmation"), { target: { value: MARKER } });

    // Typed, not yet submitted: it is in the DOM element and nowhere else.
    expect(JSON.stringify(client.turns())).not.toContain(MARKER);
    expect(document.body.innerHTML).not.toContain(MARKER);

    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>("secure-password").value).toBe(MARKER);
    });
    // And the ordinary send path has carried nothing at all.
    expect(JSON.stringify(client.sent)).not.toContain(MARKER);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The wire boundary
// ───────────────────────────────────────────────────────────────────────────

describe("parsing a turn off the wire", () => {
  it("turns an ISO expiry into a Date, because the type says Date", () => {
    const parsed = parseIncomingTurn({
      kind: "directive",
      directive: "request_secret",
      prompt: { ...PROMPT, expiresAt: PROMPT.expiresAt.toISOString() },
    });
    expect(parsed?.kind).toBe("directive");
    if (parsed?.kind === "directive") {
      expect(parsed.prompt.expiresAt).toBeInstanceOf(Date);
      expect(parsed.prompt.expiresAt.getTime()).toBe(PROMPT.expiresAt.getTime());
    }
  });

  it("keeps NOTHING off the prompt but the fields it names", () => {
    // The vanilla harness did, and the field only existed because a test spread
    // it in. `SecretPrompt` has no such member.
    const parsed = parseIncomingTurn({
      kind: "directive",
      directive: "request_secret",
      prompt: { ...PROMPT, expiresAt: PROMPT.expiresAt.toISOString(), conversationId: 999 },
    });
    if (parsed?.kind !== "directive") expect.unreachable("should parse");
    else {
      const asRecord = parsed.prompt as unknown as Record<string, unknown>;
      // STRONGER than before the extraction. The parser used to SPREAD the
      // incoming prompt, so an unexpected field rode along unread. It now
      // constructs the prompt field by field, so `conversationId` — and
      // anything else a server invents — simply is not there.
      expect(asRecord["conversationId"]).toBeUndefined();
      expect(Object.keys(asRecord).sort()).toEqual([
        "channel", "expiresAt", "explanation", "portalHost",
        "requiresConfirmation", "requestId", "title",
      ].sort());
    }
  });

  it("drops a lifecycle word the store does not know", () => {
    expect(parseIncomingTurn({ kind: "secret_status", lifecycle: "secret_probably" })).toBeNull();
  });

  it("drops an unparseable expiry rather than treating it as now", () => {
    expect(
      parseIncomingTurn({
        kind: "directive",
        directive: "request_secret",
        prompt: { ...PROMPT, expiresAt: "not a date" },
      }),
    ).toBeNull();
  });

  it("drops a turn kind it has never heard of", () => {
    expect(parseIncomingTurn({ kind: "run_arbitrary_thing" })).toBeNull();
    expect(parseIncomingTurn(null)).toBeNull();
    expect(parseIncomingTurn("a string")).toBeNull();
  });
});

// A named export so the file is not mistaken for dead weight if the suite is
// filtered. `vi` is imported for parity with the sibling test file's style.
export const REACT_CLIENT_TESTS_PRESENT = typeof vi === "object";

// ───────────────────────────────────────────────────────────────────────────
// Property 8: the client no longer places anything itself
//
// Vahid, 2026-08-28: *"The client no longer depends on `previous.length + 1`
// for durable event identity."* `packages/conversation/src/log.test.ts` proves
// the rule; these prove the REAL hook obeys it, through the real view.
// ───────────────────────────────────────────────────────────────────────────

describe("who places a durable event", () => {
  it("adopts the server's ordinals for both events it wrote", async () => {
    const client = mount();
    await client.send("when does term start?");

    // The stand-in server placed them at 1 and 2. A client computing its own
    // would have produced the same two numbers here — which is exactly why the
    // next test matters more than this one.
    expect(client.durable().map((event) => event.ordinal)).toEqual([1, 2]);
    expect(client.durable().map((event) => (event.kind === "message" ? event.content : null)))
      .toEqual(["when does term start?", "noted"]);
    // The echo is gone: one message on screen, not two.
    expect(client.drawn()).toEqual([]);
    expect(screen.getAllByTestId("turn")).toHaveLength(2);
  });

  it("takes the server's positions even when they are nothing like a count", async () => {
    // The discriminating case. This conversation is being resumed: the log
    // already holds hundreds of events, so the next message lands at 412, not
    // at 1. `previous.length + 1` would have said 1 — a number that looks like
    // a position, is not one, and would resume a stream from the beginning if
    // it ever reached a `Last-Event-ID`.
    const client = mount({
      send: async () =>
        await Promise.resolve({
          ok: true,
          body: {
            status: "accepted",
            events: [
              {
                kind: "message", ordinal: 412, createdAt: NOW.toISOString(),
                actor: "student", content: "carrying on",
              },
            ],
          },
        }),
    });
    await client.send("carrying on");

    expect(client.durable().map((event) => event.ordinal)).toEqual([412]);
  });

  it("gives a locally-drawn turn no ordinal at all", () => {
    // A directive arrives the way the harness sends one: with no position,
    // because the provisional transport has none to give. It is drawn, and it
    // has no `ordinal` key — not one holding `undefined`, none.
    const client = mount();
    client.receive(DIRECTIVE);

    expect(client.durable()).toEqual([]);
    expect(client.drawn()).toHaveLength(1);
    for (const entry of client.drawn()) {
      expect(Object.keys(entry as object)).not.toContain("ordinal");
      expect(Object.keys(entry as object)).not.toContain("createdAt");
    }
  });

  it("admits a turn that DOES arrive placed, at the position it names", () => {
    const client = mount();
    client.receive({
      kind: "message",
      actor: "assistant",
      content: "placed",
      ordinal: 7,
      createdAt: NOW.toISOString(),
    });

    expect(client.durable().map((event) => event.ordinal)).toEqual([7]);
    expect(client.drawn()).toEqual([]);
  });

  it("draws — never places — a turn whose position is only half given", () => {
    // An ordinal without a timestamp. Accepting it would leave the client to
    // supply the missing half, and the obvious way to do that is `new Date()`:
    // a browser clock stamped onto a durable event. `placed` carries both or
    // neither precisely so that state cannot be reached.
    const client = mount();
    client.receive({ kind: "message", actor: "assistant", content: "half", ordinal: 7 });

    expect(client.durable()).toEqual([]);
    expect(client.drawn()).toHaveLength(1);
  });

  it("refuses an ordinal that could not have come out of the log", () => {
    // Ordinals are dense and 1-based. `0` is not a position; nor is `-3`, nor
    // `2.5`. Admitting one would order the transcript against something nothing
    // agrees with — and, through `Last-Event-ID`, resume from a place that does
    // not exist.
    for (const ordinal of [0, -3, 2.5]) {
      const client = mount();
      client.receive({
        kind: "message", actor: "assistant", content: "bogus",
        ordinal, createdAt: NOW.toISOString(),
      });
      expect(client.durable(), `ordinal ${String(ordinal)}`).toEqual([]);
      expect(client.drawn()).toHaveLength(1);
      cleanup();
    }
  });

  it("does not duplicate a durable event a reconnect re-delivers", () => {
    // Property 6, through the real hook: the service backfills from
    // `Last-Event-ID` and then subscribes, and the two can overlap by a frame.
    const client = mount();
    const frame = {
      kind: "message", actor: "assistant", content: "once",
      ordinal: 3, createdAt: NOW.toISOString(),
    };
    client.receive(frame);
    client.receive(frame);

    expect(client.durable()).toHaveLength(1);
    expect(screen.getAllByTestId("turn")).toHaveLength(1);
  });

  it("keeps nothing on screen for a message the server refused", async () => {
    // The echo is retired, because the message did not happen. What survives is
    // the TEXT, and it survives in the composer's DOM value — which this hook
    // has never read from or written to.
    const client = mount({
      send: async () =>
        await Promise.resolve({
          ok: false,
          body: {
            status: "refused",
            reason: "secret_request_open",
            requestId: "sr_00000000000000000000000000000001",
            expiresAt: NOW.toISOString(),
          },
        }),
    });
    const outcome = await client.send("held back");

    expect(outcome).toMatchObject({ outcome: "held" });
    expect(client.durable()).toEqual([]);
    expect(client.drawn()).toEqual([]);
    expect(screen.queryAllByTestId("turn")).toHaveLength(0);
  });

  it("keeps nothing on screen when the send fails outright", async () => {
    const client = mount({
      send: async () => await Promise.resolve({ ok: false, body: null }),
    });
    const outcome = await client.send("never arrived");

    expect(outcome).toMatchObject({ outcome: "failed" });
    expect(client.turns()).toEqual([]);
  });
});
