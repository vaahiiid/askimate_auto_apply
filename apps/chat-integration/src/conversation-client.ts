/**
 * The browser's side of the Conversation Service.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Replace the provisional application's durable
 * conversation path with the actual Conversation Service."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Browser → Conversation Service → PostgreSQL → server-assigned ordinal
 *           → SSE → ConversationLog → React
 *
 * Three calls, and none of them invents a position:
 *
 *   `load`    GET  /v1/conversations/{id}/events   — the durable transcript
 *   `send`    POST /v1/conversations/{id}/messages — returns the placed event
 *   `stream`  GET  /v1/conversations/{id}/stream   — everything after
 *
 * ── Why `EventSource` and not `fetch` ─────────────────────────────────────
 *
 * The browser's own SSE client reconnects on its own and re-sends
 * `Last-Event-ID` carrying the last `id:` it saw. ADR-0035 chose SSE precisely
 * for that, and a hand-rolled `fetch` stream would mean reimplementing both.
 * The cost is that `EventSource` accepts no request headers — which is why the
 * session is a cookie (see the service's `session.ts`) and why the FIRST
 * connection passes its resume point as a query parameter: a fresh
 * `EventSource` after a page refresh has no header to put it in.
 *
 * ── Relative URLs, deliberately ───────────────────────────────────────────
 *
 * Same origin as the page (ADR-0030: the SECURE control is the cross-origin
 * one, not this). No base URL to configure, no CORS, no credentials mode, and
 * no preflight in front of the fail-closed message guard.
 */

import type { ConversationEvent, Ordinal } from "@askimate/aas-contracts";
import {
  SSE_EVENT_NAME,
  SSE_RESUME_EVENT_NAME,
  parseConversationEvent,
} from "@askimate/aas-contracts";

/** What `send` learned. Mirrors the endpoint's three outcomes and no more. */
export type SendResult =
  | { readonly outcome: "accepted"; readonly events: readonly ConversationEvent[] }
  | { readonly outcome: "held"; readonly requestId: string }
  | { readonly outcome: "failed" };

export interface StreamHandlers {
  /** A durable event. Already parsed; an unparseable frame never gets here. */
  readonly onEvent: (event: ConversationEvent) => void;
  /**
   * The stream's own account of where it is resuming from.
   *
   * Reported rather than assumed: if it is ahead of what the client holds there
   * is a HOLE, and a client that rendered on regardless would show a
   * conversation missing a turn. The handler backfills over `load`.
   */
  readonly onResume: (resumingAfter: Ordinal) => void;
}

/** The capability that lets a page start the secure frame. */
export interface Bootstrap {
  readonly requestId: string;
  readonly frameToken: string;
  readonly secureOrigin: string;
}

export interface ConversationTransport {
  /**
   * The durable transcript from `after` onwards, paged to the end.
   *
   * Takes an `AbortSignal` because a page can unmount mid-load — a student who
   * navigates away while a long conversation is still paging — and a fetch
   * nobody is waiting for should stop rather than run to completion and resolve
   * into a component that no longer exists.
   */
  readonly load: (after: Ordinal, signal?: AbortSignal) => Promise<readonly ConversationEvent[]>;
  readonly send: (content: string) => Promise<SendResult>;
  /** Opens the stream. Returns a function that closes it. */
  readonly stream: (after: Ordinal, handlers: StreamHandlers) => () => void;
  /**
   * Fetches the one-time capability for an open secure request.
   *
   * A GET, and the capability comes back in the RESPONSE BODY. Never a URL:
   * a capability in a URL reaches the Referer header, browser history, the
   * access log and any shared screenshot.
   */
  readonly bootstrap: (requestId: string) => Promise<Bootstrap | null>;
}

/**
 * A key per send, unique per attempt, 16–128 characters.
 *
 * Injected rather than read here, like the clock: this file is where every
 * message passes through, and an ambient `crypto.randomUUID()` in it is an
 * ambient source read in exactly the place the repository's lint rule exists to
 * keep clean. The mount supplies one, where reading an ambient source is
 * legitimate and visible.
 */
export type NewIdempotencyKey = () => string;

export interface ConversationTransportOptions {
  readonly conversationId: string;
  readonly newIdempotencyKey: NewIdempotencyKey;
  /** Overridable so a test can drive the transport without a browser. */
  readonly fetch?: typeof globalThis.fetch;
  readonly EventSource?: typeof globalThis.EventSource;
}

const PAGE = 200;

export function conversationTransport(
  options: ConversationTransportOptions,
): ConversationTransport {
  const base = `/v1/conversations/${encodeURIComponent(options.conversationId)}`;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const Source = options.EventSource ?? globalThis.EventSource;

  return {
    load: async (after, signal) => {
      // Paged to the end. `hasMore` is the server's word for "ask again", and
      // stopping at the first page would silently truncate a long conversation
      // — which looks exactly like the hole this design works to prevent.
      const collected: ConversationEvent[] = [];
      let cursor = after;
      for (;;) {
        const response = await doFetch(
          `${base}/events?after=${String(cursor)}&limit=${String(PAGE)}`,
          { headers: { Accept: "application/json" }, ...(signal === undefined ? {} : { signal }) },
        );
        if (!response.ok) break;
        const body = (await response.json().catch(() => null)) as {
          events?: unknown;
          hasMore?: unknown;
        } | null;
        const page = Array.isArray(body?.events) ? body.events : [];
        for (const raw of page) {
          // Parsed, never trusted. An unknown kind — a client older than the
          // service, which ADR's versioning rules call routine — is DROPPED
          // rather than rendered from a guess.
          const event = parseConversationEvent(raw);
          if (event !== null) {
            collected.push(event);
            if (event.ordinal > cursor) cursor = event.ordinal;
          }
        }
        if (body?.hasMore !== true || page.length === 0) break;
      }
      return collected;
    },

    send: async (content) => {
      const response = await doFetch(`${base}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          // Required by the contract. A retry of the SAME attempt must carry
          // the same key, which is why it is minted once per call here rather
          // than inside a retry loop that would mint a new one and append twice.
          "Idempotency-Key": options.newIdempotencyKey(),
        },
        body: JSON.stringify({ content }),
      });

      if (response.status === 409) {
        // problem+json, per the contract. The refusal names the OPEN REQUEST
        // and nothing from the body — the client keeps its draft on the
        // strength of this, and an echo here is how a refused password would
        // reach a client-side log.
        const problem = (await response.json().catch(() => null)) as {
          code?: unknown;
          requestId?: unknown;
        } | null;
        return problem?.code === "secret_request_open" && typeof problem.requestId === "string"
          ? { outcome: "held", requestId: problem.requestId }
          : { outcome: "failed" };
      }

      if (!response.ok) return { outcome: "failed" };

      // 201 on a first write, 200 on an idempotent replay. Both carry the SAME
      // event at the SAME ordinal, so the client treats them identically —
      // which is the property that makes the retry safe to make.
      const event = parseConversationEvent(await response.json().catch(() => null));
      return event === null ? { outcome: "failed" } : { outcome: "accepted", events: [event] };
    },

    bootstrap: async (requestId) => {
      const response = await doFetch(
        `${base}/secure-requests/${encodeURIComponent(requestId)}/bootstrap`,
        { headers: { Accept: "application/json" }, cache: "no-store" },
      );
      if (!response.ok) return null;
      const body = (await response.json().catch(() => null)) as Partial<Bootstrap> | null;
      return typeof body?.requestId === "string" &&
        typeof body.frameToken === "string" &&
        typeof body.secureOrigin === "string" &&
        body.secureOrigin.length > 0
        ? { requestId: body.requestId, frameToken: body.frameToken, secureOrigin: body.secureOrigin }
        : null;
    },

    stream: (after, handlers) => {
      // The query parameter, for the first connection only. Every RECONNECT
      // after this carries the browser's own `Last-Event-ID`, which the service
      // prefers — it is what this connection actually received, rather than
      // what the page believed before the connection existed.
      const url = after > 0 ? `${base}/stream?lastEventId=${String(after)}` : `${base}/stream`;
      const source = new Source(url);

      source.addEventListener(SSE_RESUME_EVENT_NAME, (message) => {
        const frame = safeParse((message as MessageEvent<string>).data);
        const resumingAfter = (frame as { resumingAfter?: unknown } | null)?.resumingAfter;
        if (typeof resumingAfter === "number") handlers.onResume(resumingAfter);
      });

      source.addEventListener(SSE_EVENT_NAME, (message) => {
        const event = parseConversationEvent(safeParse((message as MessageEvent<string>).data));
        if (event !== null) handlers.onEvent(event);
      });

      // No `onerror` handler that closes the source. `EventSource` reconnects
      // by itself, and closing it here would turn a dropped connection into a
      // dead page — the failure ADR-0035's resumability exists to survive.
      return () => {
        source.close();
      };
    },
  };
}

function safeParse(data: unknown): unknown {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}
