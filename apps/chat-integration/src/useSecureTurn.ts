/**
 * The container that owns the conversation, and owns nothing else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Treat the existing tested TypeScript security modules as
 * the single authority. Do not duplicate rendering, transcript, open-request,
 * composer, or security decisions in new client code."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this file is, and what it deliberately is not ────────────────────
 *
 * The vanilla harness hand-copied five decisions into browser JavaScript:
 * whether to render a control, how to order the transcript, whether a request
 * is open, what the composer may do, and what a rejection means. Five copies of
 * a rule is five chances to drift, and one of them had already drifted — the
 * harness closed the card on every rejection but a mismatch, while
 * `openSecureRequest` says a rejection closes nothing.
 *
 * So this hook decides none of those. It calls `decideRendering`,
 * `projectTranscript`, `openSecureRequest` and `composerPolicy`, and its own
 * body contains no rule that could disagree with them. What it adds is the part
 * those pure functions cannot have: the turn list, and the three network calls
 * that move a request between lifecycle states.
 *
 * ── What is NOT in this state ─────────────────────────────────────────────
 *
 * The password, and the composer draft. Neither is here, and neither can be:
 *
 *   - The password lives inside `SecureControl`'s submit handler and dies when
 *     it returns. This hook is handed a HANDLE, or a reason code.
 *   - The draft lives in the composer's DOM element. An uncontrolled input for
 *     the same reason the password field is uncontrolled — a student who types
 *     a password into the wrong box has made a mistake, and a controlled input
 *     would turn that mistake into React state that an error boundary or a
 *     state-serialising reporter can read. Uncontrolled, it is a DOM value that
 *     nothing snapshots.
 *
 * ── Durable events come from the server. Nothing else does ────────────────
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"The client must never create a durable ordinal… The
 * browser may temporarily use local rendering state, but every durable event
 * must ultimately come from the server with its server-assigned ordinal."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This hook used to append with `ordinal: previous.length + 1`. It now holds a
 * `ConversationLog` from `@askimate/aas-conversation`, which keeps the two
 * kinds of thing apart by type: durable events, which arrived from the server
 * with the server's ordinal, and provisional entries, which have a client-local
 * id and no position at all. There is no expression in this file that produces
 * an ordinal, because there is no shape here with a field to put one in.
 *
 * ── PROVISIONAL ───────────────────────────────────────────────────────────
 *
 * Nothing here is a UI decision. This file contains no markup, no copy and no
 * styling; it is the state machine that a real AskiMate interface would drive.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";


import type {
  ChatSendResponse,
  ConversationEvent,
  Ordinal,
  RejectionReason,
} from "@askimate/aas-contracts";
import { SECRET_LIFECYCLES, parseRejectionReason } from "@askimate/aas-contracts";
import type { Bootstrap, ConversationTransport, SendResult } from "./conversation-client.js";
import {
  EMPTY_LOG,
  addProvisional,
  admitAllDurable,
  admitDurable,
  composerPolicy,
  decideRendering,
  durableEvents,
  durableSecretRequest,
  openSecretRequest,
  openSecretRequestInLog,
  projectLog,
  retireProvisional,
  type ClientCapabilities,
  type ComposerPolicy,
  type ConversationLog,
  type TranscriptItem,
  type UnpositionedEvent,
} from "@askimate/aas-conversation";

/**
 * A turn as it arrives, with the prompt still unchecked.
 *
 * `decideRendering` takes an `UncheckedSecretPrompt` precisely because a
 * directive comes off a network and its `channel` is a claim rather than a
 * fact. Typing the incoming turn as a `ChatTurn` here would assert that claim
 * before anything had checked it.
 */
export type ReceivedTurn = {
  /**
   * Where the server put it, and when the server says it happened.
   *
   * OPTIONAL, and its absence is not an error. A turn that arrives placed is a
   * durable event and is admitted at that position. A turn that arrives
   * unplaced is something we can draw but cannot cite, so it is drawn
   * PROVISIONALLY and superseded the moment the placed version arrives.
   *
   * ONE field carrying BOTH, deliberately. The ordinal and the timestamp are
   * the same fact from the same authority; a shape with two optional fields
   * would permit "the server said where but not when", and the obvious way to
   * fill that gap is `new Date()` — a client clock stamped onto a durable
   * event. There is no such state to be in.
   *
   * The one thing that never happens is the client supplying the number
   * itself. A missing position is a missing fact, not a gap to fill in.
   */
  readonly placed?: { readonly ordinal: Ordinal; readonly createdAt: string };
} & (
  | { readonly kind: "message"; readonly actor: "student" | "assistant" | "mentor" | "system";
      readonly content: string | null }
  | { readonly kind: "secret_status"; readonly requestId: string;
      readonly lifecycle: (typeof SECRET_LIFECYCLES)[number]; readonly handle?: string }
  | { readonly kind: "secret_rejected"; readonly requestId: string;
      readonly reason: RejectionReason }
  | {
      readonly kind: "directive";
      readonly directive: "request_secret";
      readonly prompt: UncheckedIncomingPrompt;
    }
);

/**
 * A prompt as it arrives, with the channel still a claim rather than a fact.
 *
 * Under ADR-0030 the real client never receives the title, explanation or
 * portal host: the Secure Interaction Service holds them and renders them
 * inside its own document. This PROVISIONAL same-origin client still shows
 * them itself, so it keeps them here — in a client-side map, deliberately not
 * on any event, so nothing a model wrote about a password reaches the log.
 */
export interface UncheckedIncomingPrompt {
  readonly requestId: string;
  readonly channel: string;
  readonly expiresAt: Date;
  readonly title: string;
  readonly explanation: string;
  readonly portalHost: string;
  readonly requiresConfirmation: boolean;
}

/** The result of trying to send an ordinary message. */
export type SendOutcome =
  | { readonly outcome: "accepted" }
  /** The server has an open secure request. The draft is untouched. */
  | { readonly outcome: "held"; readonly requestId: string }
  /** Anything else — a dropped connection, a 500. The draft is untouched. */
  | { readonly outcome: "failed" };

/**
 * The three network calls this container makes.
 *
 * Injected as one object so a test can drive the whole state machine without a
 * server, and so it is visible in one place that the container never posts
 * anything but a message id, a message body and a delete.
 */
export interface SecureTurnTransport {
  /**
   * `POST /api/askimate/ai` — the PROVISIONAL app's synchronous message route.
   *
   * Superseded by `SecureTurnInput.conversation`, which posts to the real
   * Conversation Service. Kept while the legacy harness still has coverage the
   * React path has not replaced; see `docs/harness-coverage-mapping.md`.
   */
  readonly send: (input: {
    readonly conversationId: number;
    readonly content: string;
  }) => Promise<{ readonly ok: boolean; readonly body: unknown }>;
  /** `DELETE /api/askimate/secret/:requestId`. Resolves true on a 200. */
  readonly cancel: (requestId: string) => Promise<boolean>;
}

export interface SecureTurnInput {
  readonly conversationId: number;
  /**
   * What this client can do, read at the moment a directive arrives.
   *
   * A function rather than a value, for the same reason `now` is one: both are
   * facts about the environment at the instant of the decision, not constants
   * fixed when the container was built. A page whose connection drops between
   * mount and directive should report `endpointReachable: false` then, not the
   * answer it would have given a minute earlier.
   */
  readonly capabilities: () => ClientCapabilities;
  readonly transport: SecureTurnTransport;
  /**
   * The real Conversation Service, when there is one.
   *
   * ═════════════════════════════════════════════════════════════════════
   * Vahid, 2026-08-28: *"Replace the provisional application's durable
   * conversation path with the actual Conversation Service."*
   * ═════════════════════════════════════════════════════════════════════
   *
   * When supplied, the DURABLE path is entirely the service's: the transcript
   * is loaded from it, messages are posted to it, and every durable event
   * arrives over its stream carrying the ordinal it was written at. The hook
   * still draws provisional entries — that is what makes the UI feel immediate
   * — but it places none of them.
   *
   * Optional only because the provisional app still mounts the hook without
   * one while its harness coverage is being replaced. It is not a fallback
   * mode with different rules: `send` behaves identically on both paths,
   * because both produce the same `SendResult` and the hook has one branch for
   * it rather than two.
   */
  readonly conversation?: ConversationTransport;
  /**
   * The clock, injected — required, not defaulted.
   *
   * A `now = () => new Date()` default here would be an ambient clock read in
   * the one file where every expiry decision passes through, and the repository
   * lint rule that forbids exactly that caught it. The page supplies its own
   * clock at the mount, where reading one is legitimate and visible.
   */
  readonly now: () => Date;
}

export interface SecureTurnState {
  /**
   * The DURABLE events, in ordinal order. Every one came from the server.
   *
   * Deliberately not "everything on screen": a caller that wants what the
   * student can see wants `items`. This list is the one that may be used as a
   * position — to resume a stream, to page, to compare with another client —
   * and it contains nothing this browser made up.
   */
  readonly events: readonly ConversationEvent[];
  /** Everything drawn: the durable events, then whatever we are drawing. */
  readonly items: readonly TranscriptItem[];
  /** The whole log, for a caller that needs to tell the two apart. */
  readonly log: ConversationLog;
  /**
   * The capability for the OPEN secure request, once fetched.
   *
   * Null while there is no open step, and null while the fetch is in flight —
   * the frame is not rendered until this exists, because a frame with no token
   * would sit on screen waiting for a bootstrap that never comes.
   */
  readonly bootstrap: Bootstrap | null;
  /** The prompt to draw, or null when nothing is open. From `openSecretRequest`. */
  readonly openPrompt: UncheckedIncomingPrompt | null;
  /** Fixed refusal text from `decideRendering`. Never assembled from input. */
  readonly refusal: { readonly reason: RejectionReason; readonly say: string } | null;
  readonly composer: ComposerPolicy;
  readonly receive: (turn: ReceivedTurn) => void;
  readonly submitted: (handle: string) => void;
  /**
   * A lifecycle word the SECURE FRAME reported. A UX accelerator only.
   *
   * ═════════════════════════════════════════════════════════════════════
   * Vahid, 2026-08-28: *"The browser's postMessage lifecycle notification may
   * improve UX but must never become the authority for the server-side
   * guard."*
   * ═════════════════════════════════════════════════════════════════════
   *
   * What this does is DRAW a provisional entry, so the card closes the instant
   * the student succeeds instead of a round trip later. What it does not do is
   * settle anything: the authoritative transition is written by the Secure
   * Interaction Service through the internal append, reaches the conversation
   * log, and arrives here on the stream with an ordinal. Until it does, the
   * Conversation Service's own guard still refuses ordinary messages — so a
   * frame that lied, or a lifecycle push that failed, changes what the student
   * SEES and nothing about what the server ALLOWS.
   */
  readonly frameLifecycle: (lifecycle: string, handle?: string) => void;
  readonly rejected: (reason: RejectionReason) => void;
  readonly cancel: () => void;
  readonly send: (content: string) => Promise<SendOutcome>;
  /**
   * True once the durable transcript has been loaded from the service.
   *
   * A page that has not loaded yet and a conversation that is genuinely empty
   * look identical in `events`, and they are not the same thing: the first must
   * not let a student send into a conversation whose open secure step it has
   * not seen. Distinguished here rather than inferred from an empty list.
   */
  readonly loaded: boolean;
}

export function useSecureTurn(input: SecureTurnInput): SecureTurnState {
  const [log, setLog] = useState<ConversationLog>(EMPTY_LOG);
  /**
   * Prompt text, keyed by request, held OUTSIDE the event list.
   *
   * The provisional control renders the title and explanation itself, and they
   * are free text a model wrote. Putting them on an event would be exactly the
   * thing `CHECK ((kind = \'message\') = (body_id IS NOT NULL))` forbids in the
   * database, so they live here instead — and disappear entirely when the
   * secure origin takes over rendering.
   */
  const [prompts, setPrompts] = useState<ReadonlyMap<string, UncheckedIncomingPrompt>>(new Map());
  const [refusal, setRefusal] = useState<SecureTurnState["refusal"]>(null);
  /**
   * The request the SERVER says is open, learned from a 409.
   *
   * This is not a second opinion about openness — it is the same fact from the
   * other end. A client that has been open in a tab across a restart, or that
   * missed a directive, has an empty transcript and a live request; the 409
   * tells it so. Held separately from the turn list because there is no turn to
   * append: we know a request exists, and we do not know its prompt, so
   * inventing a directive turn would put a card on screen with no content.
   */
  const [serverOpenRequestId, setServerOpenRequestId] = useState<string | null>(null);

  const { conversationId, capabilities, transport } = input;
  const conversation = input.conversation;
  const now = input.now;
  // No service means nothing to load: the provisional path's transcript is
  // whatever arrives through `receive`, and it is ready at once.
  const [loaded, setLoaded] = useState(conversation === undefined);

  const items = useMemo(() => projectLog(log), [log]);
  const events = useMemo(() => durableEvents(log), [log]);
  // The ONE authority. Both this client and the server call the same function
  // over the same event shape, which is why they cannot disagree about whether
  // a step is open — the class of bug Phase D found twice by hand.
  const openRequestId = useMemo(() => openSecretRequestInLog(log), [log]);
  const openPrompt = openRequestId === null ? null : (prompts.get(openRequestId) ?? null);

  // ── RENDERING openness vs AUTHORITATIVE openness ─────────────────────────
  //
  // `openRequestId` above merges durable events with what this browser is
  // drawing, and that is right for RENDERING: the secure frame should close the
  // instant the student succeeds, not a round trip later.
  //
  // It is WRONG for the composer, and this was a real defect. A provisional
  // `secret_received` — drawn from the frame's own postMessage — made
  // `openRequestId` null, so the composer reopened on the browser's word before
  // the Secure Interaction Service had published anything. The server refused
  // the resulting message with a 409, so nothing unsafe was ever accepted; but
  // the student saw a live composer for a step the log still showed open, and
  // "provisional UI must never override server authority" is the rule.
  //
  // So the gate reads the DURABLE log only. A step is open until an
  // authoritative transition says otherwise — Secure Service → outbox →
  // Conversation Service → log → SSE — and `serverOpenRequestId`, learned from
  // a 409, blocks in addition. Either one blocks; neither can unblock the
  // other.
  //
  // ── And why the PROVISIONAL path is different ────────────────────────────
  //
  // Only when a Conversation Service is present. The provisional app has no
  // durable log — its turns arrive through `receive` without ordinals and are
  // all drawn provisionally — so a durable-only gate would never block there at
  // all. On that path `receive` IS how the server speaks to the client, so the
  // merged view is the authoritative one available; on the real path it is
  // not, and the distinction is which of the two is the server's word.
  const durablyOpen = useMemo(() => openSecretRequest(log.durable), [log]);
  const authoritativelyOpen = conversation === undefined ? openRequestId : durablyOpen;
  const composer = composerPolicy({
    awaitingSecret: authoritativelyOpen !== null || serverOpenRequestId !== null,
  });

  /**
   * Draws something the server has not placed, and returns its local id.
   *
   * The id is for RETIREMENT, not for position: it is how this hook says "the
   * echo I drew a moment ago is now the real event" or "that never happened".
   * It is generated from a counter rather than a clock or a random source
   * because it must be unique within this mount and must not be mistaken for
   * anything durable — and because a `crypto.randomUUID` here would be a second
   * ambient-source read in a file where the lint rule already caught the first.
   */
  const nextLocalId = useRef(0);
  const draw = useCallback((event: UnpositionedEvent): string => {
    nextLocalId.current += 1;
    const localId = `local-${String(nextLocalId.current)}`;
    setLog((previous) => addProvisional(previous, { localId, event }));
    return localId;
  }, []);

  /**
   * Takes an event the SERVER placed, at the position the SERVER gave it.
   *
   * `admitDurable` is what deduplicates by ordinal, orders by ordinal, and
   * retires the local echo the event supersedes. None of those three rules is
   * restated here, for the same reason none of the five decisions is.
   */
  const admit = useCallback((event: ConversationEvent): void => {
    setLog((previous) => admitDurable(previous, event));
  }, []);

  /**
   * Draws it durably when the server placed it, provisionally when it did not.
   *
   * Two branches, and neither computes a position. No cast is needed and none
   * is written: spreading an unpositioned member and adding exactly the two
   * fields it is missing reconstitutes the `ConversationEvent` member, and the
   * compiler agrees — the lint rule that forbids a redundant assertion is what
   * proved it, after I wrote one out of caution.
   */
  const record = useCallback(
    (event: UnpositionedEvent, placed: ReceivedTurn["placed"]): void => {
      if (placed === undefined) {
        draw(event);
        return;
      }
      admit({ ...event, ordinal: placed.ordinal, createdAt: placed.createdAt });
    },
    [admit, draw],
  );

  const receive = useCallback(
    (turn: ReceivedTurn): void => {
      if (turn.kind === "message") {
        record({ kind: "message", actor: turn.actor, content: turn.content }, turn.placed);
        return;
      }
      if (turn.kind === "secret_rejected") {
        record(
          { kind: "secret_rejected", requestId: turn.requestId, reason: turn.reason },
          turn.placed,
        );
        return;
      }
      if (turn.kind === "secret_status") {
        if (turn.lifecycle === "secret_requested") return;
        record(
          turn.lifecycle === "secret_received"
            ? { kind: "secret_received", requestId: turn.requestId, handle: turn.handle ?? "" }
            : { kind: turn.lifecycle, requestId: turn.requestId },
          turn.placed,
        );
        return;
      }

      const decision = decideRendering({
        step: { channel: turn.prompt.channel, expiresAt: turn.prompt.expiresAt },
        capabilities: capabilities(),
        now: now(),
      });

      if (decision.render === "refuse") {
        // ── FAIL CLOSED, and then close the request ─────────────────────
        //
        // The directive is NOT appended. `projectTranscript` would map it to a
        // `secure_control` item and the view would try to draw a card this
        // client has just established it cannot draw.
        //
        // Instead: the model is told, in a code from the closed set, that the
        // step failed and why — otherwise it waits for a submission that will
        // never come. And the server-side request is CANCELLED, because a live
        // request that no client can service would block this conversation's
        // composer for the whole TTL and produce nothing but 409s.
        setRefusal({ reason: decision.reason, say: decision.say });
        // DRAWN, not admitted — even though this turn may have arrived placed.
        // The refusal is this client's own conclusion about its own
        // capabilities; the server has not been told and has written nothing.
        // Admitting it at the directive's ordinal would put a different event
        // at a position the log has already given to the directive, which is
        // the client and the server disagreeing about the log's contents.
        draw({
          kind: "secret_rejected",
          requestId: turn.prompt.requestId,
          reason: decision.reason,
        });
        void transport.cancel(turn.prompt.requestId).then((cancelled) => {
          // Only on a confirmed 200. Drawing the status turn on a failed
          // delete would tell the transcript a request was closed that is still
          // open on the server, which is the divergence this whole phase is
          // about. If the delete failed, the TTL closes it and the composer
          // stays guarded by the server's 409 until then.
          if (cancelled) {
            draw({ kind: "secret_cancelled", requestId: turn.prompt.requestId });
          }
        });
        return;
      }

      setRefusal(null);
      // The prompt TEXT goes in the side map; the EVENT carries only the
      // request, the channel and the expiry — which is exactly what the real
      // conversation plane will ever have.
      setPrompts((previous) => new Map(previous).set(turn.prompt.requestId, turn.prompt));
      record(
        {
          kind: "secret_requested",
          requestId: turn.prompt.requestId,
          channel: decision.step.channel,
          expiresAt: decision.step.expiresAt.toISOString(),
        },
        turn.placed,
      );
    },
    [capabilities, draw, now, record, transport],
  );

  const submitted = useCallback(
    (handle: string): void => {
      // A lifecycle transition, which is the only thing `openSecureRequest`
      // accepts as closing a request. The handle is opaque and safe to hold.
      if (openRequestId === null) return;
      // Drawn. The submission went to the Secure Interaction Service, which
      // writes the durable `secret_received` on its own plane and delivers it
      // through the internal contract; this browser learns its ordinal when the
      // event comes back, and `describesSame` retires this echo then. Nothing
      // here guesses where it landed.
      draw({ kind: "secret_received", requestId: openRequestId, handle });
      setServerOpenRequestId(null);
    },
    [draw, openRequestId],
  );

  const frameLifecycle = useCallback(
    (lifecycle: string, handle?: string): void => {
      if (openRequestId === null) return;
      // Drawn, never admitted. It has no ordinal because the conversation log
      // has not placed it — and it cannot, because this browser is not what
      // writes to that log.
      if (lifecycle === "secret_received") {
        draw({ kind: "secret_received", requestId: openRequestId, handle: handle ?? "" });
        return;
      }
      if (
        lifecycle === "secret_cancelled" ||
        lifecycle === "secret_expired" ||
        lifecycle === "secret_consumed"
      ) {
        draw({ kind: lifecycle, requestId: openRequestId });
      }
    },
    [draw, openRequestId],
  );

  const rejected = useCallback(
    (reason: RejectionReason): void => {
      // Appended, and NOTHING ELSE. In particular the request is not closed:
      // `openSecureRequest` deliberately ignores a rejection, so a mistyped
      // confirmation leaves the card exactly where it was and the student
      // simply tries again. The harness closed the card here for every reason
      // but a mismatch, which released the composer while the server still had
      // the request open — see docs/composer-during-secure-turn.md.
      if (openRequestId === null) return;
      draw({ kind: "secret_rejected", requestId: openRequestId, reason });
    },
    [draw, openRequestId],
  );

  const cancel = useCallback((): void => {
    // `??` rather than a second null test afterwards: the linter pointed out
    // that once both have been ruled out the result cannot be null, so the
    // extra guard was unreachable code pretending to be caution.
    const requestId = openRequestId ?? serverOpenRequestId;
    if (requestId === null) return;

    void transport.cancel(requestId).then((cancelled) => {
      if (cancelled) {
        // ADR-0032: cancellation is its own word. It behaves identically to
        // expiry for every guard — both terminal, both release the composer —
        // and it reads differently to the model, the student and analytics.
        draw({ kind: "secret_cancelled", requestId });
        setServerOpenRequestId(null);
        return;
      }
      // The request is still open. Say so as a rejection, which by design does
      // not close it — the card stays and the student can still finish.
      draw({ kind: "secret_rejected", requestId, reason: "endpoint_unreachable" });
    });
  }, [draw, openRequestId, serverOpenRequestId, transport]);

  const send = useCallback(
    async (content: string): Promise<SendOutcome> => {
      // No guard of its own. The caller is a composer whose `send` the policy
      // above has already set to "blocked"; a second rule here would be a
      // second place for the answer to be wrong. The authority that actually
      // matters is the server's, and it is consulted below.
      //
      // ── The echo goes up BEFORE the round trip ────────────────────────
      //
      // So the student sees their message immediately, on a slow connection.
      // It is provisional: no ordinal, no timestamp, and it is retired either
      // by the durable event that supersedes it or by the failure that means it
      // never happened. What it is NOT is the transcript's idea of position —
      // an echo drawn at `previous.length + 1` would have claimed a slot that
      // a concurrently-arriving server event also claims.
      const echo = draw({ kind: "message", actor: "student", content });

      // ── ONE send path, two transports ────────────────────────────────
      //
      // The real service and the provisional route produce the same
      // `SendResult`, so everything below this line is identical on both. A
      // branch here would be a second place for "what does accepted mean" to
      // be answered, and the whole reason this phase exists is that answers
      // kept in two places drift.
      const result =
        conversation !== undefined
          ? await conversation.send(content)
          : await legacySend(transport, conversationId, content);

      if (result.outcome === "accepted") {
        // EVERY event the server wrote, each at the position the server gave
        // it. The student's message comes back placed and retires the echo by
        // `describesSame`; anything else the server wrote arrives placed in the
        // same list rather than after a locally-computed number.
        //
        // The SAME event usually also arrives on the stream a moment later, and
        // that is not a problem to solve here: `admitDurable` ignores an
        // ordinal it already holds, so response-then-stream and
        // stream-then-response both end with one copy.
        setLog((previous) =>
          // `retireProvisional` as well as the admission, because the server is
          // free to normalise what it stored — trimming, truncating, redacting.
          // A normalised body would not match the echo, and the echo would
          // linger next to the real message. Retiring by the id we minted is
          // the only reconciliation that cannot miss.
          retireProvisional(admitAllDurable(previous, result.events), echo),
        );
        setServerOpenRequestId(null);
        return { outcome: "accepted" };
      }

      // Refused or failed: the echo is retired, because the message did not
      // happen. The TEXT is untouched — it is still in the composer's DOM
      // value, which nothing here has ever read from or written to.
      setLog((previous) => retireProvisional(previous, echo));

      if (result.outcome === "held") {
        // This client was stale. The message is NOT appended, NOT retried and
        // NOT queued.
        setServerOpenRequestId(result.requestId);
        return { outcome: "held", requestId: result.requestId };
      }

      return { outcome: "failed" };
    },
    [conversation, conversationId, draw, transport],
  );

  // ── The durable path: load, then stream ──────────────────────────────────
  //
  //   load  → the transcript the service holds, with its ordinals
  //   stream → everything after, each frame carrying `id: <ordinal>`
  //
  // In that order, and the order is load-bearing. Opening the stream first and
  // loading after would race: a live event could be admitted before the
  // backfill that precedes it, and while `admitDurable` sorts by ordinal so
  // the RESULT would still be right, the window in between would render a
  // conversation with a hole in it.
  //
  // ── The resume point is a LOCAL, not a ref off the state ─────────────────
  //
  // It was a ref assigned during render, and that was wrong in a way the
  // browser caught and no adapter test could have. `backfill` calls `setLog`;
  // React applies that on a later render; the stream is opened in the SAME
  // microtask, before any render has happened. So the ref still read 0, the
  // page opened every stream from the beginning, and a refresh re-sent the
  // whole conversation — correct on screen, because `admitDurable` deduplicates
  // by ordinal, and wrong on the wire, which is where it costs.
  //
  // The watermark below is advanced by the code that learns the ordinals, at
  // the moment it learns them, with no render in between.
  useEffect(() => {
    if (conversation === undefined) return undefined;

    // ── An AbortController, not a `let live = true` ────────────────────
    //
    // Two reasons, and the second is the real one. First, the compiler cannot
    // see that a plain boolean is ever reassigned from inside a callback, so it
    // narrows it and the lint rule correctly reports every later check as
    // always-true — a flag whose checks are provably dead is not a flag.
    // Second and better: the signal actually CANCELS the in-flight load. A
    // student who navigates away mid-page should stop the request, not have it
    // run to completion and resolve into a component that is gone.
    const controller = new AbortController();
    const closers: (() => void)[] = [];

    // The highest DURABLE ordinal this connection knows about. Advanced only
    // by events the server placed, so it is always a real log position and
    // never something this browser computed.
    let watermark = 0;
    const observe = (ordinal: number): void => {
      if (ordinal > watermark) watermark = ordinal;
    };

    const backfill = async (after: number): Promise<void> => {
      const durable = await conversation.load(after, controller.signal);
      if (controller.signal.aborted) return;
      for (const event of durable) observe(event.ordinal);
      setLog((previous) => admitAllDurable(previous, durable));
    };

    void (async () => {
      await backfill(0);
      if (controller.signal.aborted) return;
      setLoaded(true);
      closers.push(conversation.stream(watermark, {
        onEvent: (event) => {
          if (controller.signal.aborted) return;
          observe(event.ordinal);
          admit(event);
        },
        onResume: (resumingAfter) => {
          // The stream has told us where it is starting. If that is AHEAD of
          // what we hold, the events in between will never arrive on this
          // connection and the transcript would silently be missing them —
          // so they are fetched over the paged endpoint instead. This is the
          // one thing `conversation.resume` exists for.
          if (!controller.signal.aborted && resumingAfter > watermark) {
            void backfill(watermark);
          }
        },
      }));
    })();

    return () => {
      controller.abort();
      for (const close of closers) close();
    };
    // `conversation` and `admit` only. Deliberately NOT `events` or `log`:
    // this effect owns a long-lived connection, and re-running it on every
    // event is how a stream becomes a reconnect loop.
  }, [admit, conversation]);

  // ── The bootstrap for the open step ──────────────────────────────────────
  //
  // Fetched when a secure request opens, and dropped when it settles. It is a
  // capability, so it is held for as short a time as the UI allows: in state
  // for the life of one open step, never in storage, never in a URL, and never
  // written to anything that outlives the mount.
  // ── The open step's channel and expiry, as PRIMITIVES ────────────────────
  //
  // Extracted here so the effect below can depend on two strings rather than on
  // the whole log. Depending on `log` re-ran the effect on EVERY event — which
  // minted a fresh one-time frame token each time, replaced the `Bootstrap`
  // object, and remounted the iframe underneath a student who was typing. The
  // browser tests caught it: the form never stabilised long enough to fill.
  const openStep = useMemo(
    () => (openRequestId === null ? null : durableSecretRequest(log, openRequestId)),
    [log, openRequestId],
  );
  const openChannel = openStep?.channel ?? null;
  const openExpiresAt = openStep?.expiresAt ?? null;

  // ── The environment readers, in refs ─────────────────────────────────────
  //
  // `capabilities` and `now` are functions the MOUNT supplies, and the mount
  // writes them inline — so a new function identity arrives on every render.
  // Listing them in the effect's dependencies re-ran the effect every render,
  // which called `setBootstrap`, which caused a render. React reported
  // "Maximum update depth exceeded" and the iframe never mounted.
  //
  // They are read through refs instead. That is correct as well as convenient:
  // both are meant to be read AT THE MOMENT OF THE DECISION, not captured when
  // the container was built, and a ref gives exactly that without making the
  // decision's identity part of the effect's.
  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  const nowRef = useRef(now);
  nowRef.current = now;

  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  useEffect(() => {
    if (conversation === undefined || openRequestId === null) {
      setBootstrap(null);
      setRefusal(null);
      return undefined;
    }

    // ── CAN this client show the step at all? Asked BEFORE anything else ──
    //
    // ═════════════════════════════════════════════════════════════════════
    // `decideRendering` was written for exactly this architecture — its own
    // comment says the signature is "the widest one the architecture permits"
    // under ADR-0030 — and the real path was not calling it. The provisional
    // path did; the cross-origin path went straight to fetching a capability.
    // That is how three refusal reasons ended up with no coverage: nothing
    // consulted them.
    // ═════════════════════════════════════════════════════════════════════
    //
    // Asked before the bootstrap is fetched, so a client that cannot render the
    // step never obtains a capability it has no use for. A one-time token
    // minted for a frame that will never mount is a token sitting unspent.
    const decision =
      openChannel === null || openExpiresAt === null
        ? null
        : decideRendering({
            step: { channel: openChannel, expiresAt: new Date(openExpiresAt) },
            capabilities: capabilitiesRef.current(),
            now: nowRef.current(),
          });

    if (decision !== null && decision.render === "refuse") {
      // ── FAIL CLOSED, and DO NOT cancel ────────────────────────────────
      //
      // The provisional path cancelled the request here, because it held a
      // token that let it. This client cannot: cancellation requires a secure
      // session, which requires the bootstrap, which is precisely what it has
      // just declined to obtain. And it should not be able to — the
      // authoritative lifecycle belongs to the Secure Interaction Service.
      //
      // So the request stays OPEN in the conversation log, the composer stays
      // BLOCKED, and the TTL settles it. That is a deliberate change from the
      // legacy behaviour and it is the safer of the two: a client that cannot
      // show a password box also cannot be trusted to decide that nobody
      // should be asked for the password.
      setRefusal({ reason: decision.reason, say: decision.say });
      setBootstrap(null);
      return undefined;
    }

    setRefusal(null);
    let live = true;
    void conversation.bootstrap(openRequestId).then((capability) => {
      if (live) setBootstrap(capability);
    });
    return () => {
      live = false;
    };
    // PRIMITIVES only. `openChannel` and `openExpiresAt` change when the step
    // does and not when any other event arrives, so exactly one bootstrap is
    // fetched per step.
  }, [conversation, openChannel, openExpiresAt, openRequestId]);

  return {
    events, items, log, loaded, bootstrap, openPrompt, refusal, composer,
    receive, submitted, frameLifecycle, rejected, cancel, send,
  };
}

/**
 * The PROVISIONAL route, expressed as the same result the real service gives.
 *
 * Here rather than inside the hook so there is exactly one place that knows
 * what `ChatSendResponse` means, and so the hook's `send` has no branch whose
 * two halves could answer "was this accepted" differently. Deleted with the
 * legacy route.
 */
async function legacySend(
  transport: SecureTurnTransport,
  conversationId: number,
  content: string,
): Promise<SendResult> {
  const { ok, body } = await transport.send({ conversationId, content });
  const response = body as Partial<ChatSendResponse> | null;

  if (ok && response?.status === "accepted") {
    const written = (response as Extract<ChatSendResponse, { status: "accepted" }>).events;
    return { outcome: "accepted", events: Array.isArray(written) ? written : [] };
  }
  if (response?.status === "refused" && response.reason === "secret_request_open") {
    const requestId = (response as Extract<ChatSendResponse, { status: "refused" }>).requestId;
    return { outcome: "held", requestId };
  }
  return { outcome: "failed" };
}

/** The real transport, for a page talking to a real server. */
export function browserTransport(authToken: string): SecureTurnTransport {
  return {
    send: async (input) => {
      const response = await fetch("/api/askimate/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ conversationId: input.conversationId, content: input.content }),
      });
      const body: unknown = await response.json().catch(() => null);
      return { ok: response.ok, body };
    },
    cancel: async (requestId) => {
      const response = await fetch(`/api/askimate/secret/${requestId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      return response.ok;
    },
  };
}

/**
 * Turns a directive as it arrives on the wire into one this container accepts.
 *
 * Two conversions, both at the edge rather than inside the state machine:
 * `expiresAt` is an ISO string in JSON and a `Date` in the type, and the reason
 * on an incoming rejection is narrowed to the closed set. A turn that cannot be
 * understood is dropped rather than guessed at.
 *
 * Note what is NOT read: `conversationId`. The harness took it off the prompt,
 * which `SecretPrompt` does not declare — the value only existed because a test
 * spread it in. The conversation is the container's, passed in once.
 */
export function parseIncomingTurn(raw: unknown): ReceivedTurn | null {
  if (typeof raw !== "object" || raw === null) return null;
  const turn = raw as Record<string, unknown>;
  const placed = readPlacement(turn);

  switch (turn["kind"]) {
    case "message": {
      // `actor`, not `sender`: the wire model names a ROLE IN THE CONVERSATION,
      // and "user"/"ai" were a client's words for the same two roles. `student`
      // and `assistant` are the log's, so the client speaks the log's.
      const actor = turn["actor"] ?? turn["sender"];
      const content = turn["content"];
      if (content !== null && typeof content !== "string") return null;
      const normalised =
        actor === "user" ? "student" : actor === "ai" ? "assistant" : actor;
      if (
        normalised !== "student" && normalised !== "assistant" &&
        normalised !== "mentor" && normalised !== "system"
      ) {
        return null;
      }
      return { ...placed, kind: "message", actor: normalised, content };
    }
    case "directive": {
      if (turn["directive"] !== "request_secret") return null;
      const prompt = turn["prompt"];
      if (typeof prompt !== "object" || prompt === null) return null;
      const fields = prompt as Record<string, unknown>;
      const expiresAt = fields["expiresAt"];
      const parsed =
        expiresAt instanceof Date
          ? expiresAt
          : typeof expiresAt === "string"
            ? new Date(expiresAt)
            : null;
      if (parsed === null || Number.isNaN(parsed.getTime())) return null;
      const requestId = fields["requestId"];
      if (typeof requestId !== "string" || requestId.length === 0) return null;
      return {
        ...placed,
        kind: "directive",
        directive: "request_secret",
        // `channel` stays whatever the server said it was. `decideRendering`
        // is what checks it, and it checks it first.
        prompt: {
          requestId,
          channel: typeof fields["channel"] === "string" ? fields["channel"] : "",
          expiresAt: parsed,
          title: typeof fields["title"] === "string" ? fields["title"] : "",
          explanation: typeof fields["explanation"] === "string" ? fields["explanation"] : "",
          portalHost: typeof fields["portalHost"] === "string" ? fields["portalHost"] : "",
          requiresConfirmation: fields["requiresConfirmation"] !== false,
        },
      };
    }
    case "secret_status": {
      const lifecycle = turn["lifecycle"];
      // Narrowed against the store's own list, for the same reason the reason
      // code is narrowed against its: a lifecycle word reaches the model, and
      // an unrecognised one would reach it unchecked.
      if (
        typeof lifecycle !== "string" ||
        !(SECRET_LIFECYCLES as readonly string[]).includes(lifecycle)
      ) {
        return null;
      }
      const handle = turn["handle"];
      const statusRequest = turn["requestId"];
      return {
        ...placed,
        kind: "secret_status",
        requestId: typeof statusRequest === "string" ? statusRequest : "",
        lifecycle: lifecycle as (typeof SECRET_LIFECYCLES)[number],
        ...(typeof handle === "string" ? { handle } : {}),
      };
    }
    case "secret_rejected": {
      const reason = parseRejectionReason(turn["reason"]);
      if (reason === null) return null;
      const rejectedRequest = turn["requestId"];
      return {
        ...placed,
        kind: "secret_rejected",
        requestId: typeof rejectedRequest === "string" ? rejectedRequest : "",
        reason,
      };
    }
    default:
      return null;
  }
}

/**
 * The position the server gave this turn, or nothing.
 *
 * Both fields or neither — a turn that names an ordinal without a timestamp, or
 * a timestamp without an ordinal, is treated as UNPLACED and drawn
 * provisionally. Half a placement is not a placement, and completing it here
 * would mean this file writing one of the two values the server owns.
 *
 * The ordinal is validated the same way `parseConversationEvent` validates one:
 * an integer, at least 1. Ordinals are dense and 1-based, so `0`, `-3` and
 * `2.5` are not positions that could have come out of the log — accepting one
 * would put an event in an order nothing agrees with, and, if it ever reached a
 * `Last-Event-ID`, resume a stream from a place that does not exist.
 */
function readPlacement(turn: Record<string, unknown>): Pick<ReceivedTurn, "placed"> {
  const ordinal = turn["ordinal"];
  const createdAt = turn["createdAt"];
  if (
    typeof ordinal !== "number" ||
    !Number.isInteger(ordinal) ||
    ordinal < 1 ||
    typeof createdAt !== "string" ||
    createdAt.length === 0
  ) {
    return {};
  }
  return { placed: { ordinal, createdAt } };
}
