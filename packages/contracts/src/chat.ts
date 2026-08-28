/**
 * What the message endpoint answers.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"move `ChatSendResponse` out of `chat-routes.ts` into
 * `packages/contracts`, so browser code no longer imports a wire type from a
 * server module."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * It lived in an Express route module, and the browser imported it from there.
 * That is a real coupling, not a tidiness complaint: a client bundle importing
 * from a file that also imports `express` and `jsonwebtoken` depends on a
 * bundler's tree-shaking to keep a server framework out of the browser. A wire
 * type belongs where the wire is described.
 *
 * ── WHICH endpoint this describes ─────────────────────────────────────────
 *
 * `POST /api/askimate/ai` — the provisional chat integration's synchronous
 * message route, which answers inline because it has no event stream. It is
 * NOT the Conversation Service's `POST /v1/conversations/{id}/messages`: that
 * endpoint is specified in `openapi/conversation.v1.yaml`, returns the written
 * event bare, and refuses with RFC 9457 problem+json like every other failure
 * on that service. The two were briefly implemented as if they shared this
 * shape, and the divergence is recorded in `apps/conversation-service`.
 */

import type { ConversationEvent } from "./events.js";

/**
 * A closed union. The refusal carries the open `requestId` and its expiry so a
 * stale client can re-synchronise and re-render the step — and so it knows to
 * KEEP the draft rather than clear it. A client that cleared optimistically
 * would destroy the very message this design exists to preserve.
 *
 * `accepted` carries the EVENTS the server wrote, each with the server's
 * ordinal. The client does not compute a position and does not invent one: it
 * is told.
 *
 * A LIST, not one event. A single request can cause the server to append more
 * than one durable event — the student's message and, on a synchronous
 * endpoint, the assistant's answer — and a client that received only the first
 * would have to place the second itself. That is precisely the invention this
 * response exists to remove, so the shape has no way to omit one. A service
 * that appends exactly one returns exactly one; a client that receives its
 * replies on the event stream instead gets a list of one either way.
 */
export type ChatSendResponse =
  | { readonly status: "accepted"; readonly events: readonly ConversationEvent[] }
  | {
      readonly status: "refused";
      readonly reason: "secret_request_open";
      readonly requestId: string;
      readonly expiresAt: string;
    };

/**
 * COMPILE-TIME: no member of this response names a position of its own.
 *
 * The only ordinals in this shape are the ones inside the `ConversationEvent`s,
 * which came out of the database. There is deliberately no top-level `ordinal`
 * or `createdAt` a caller could set and a handler could echo — the shortcut
 * that would let a client propose where its message goes.
 *
 * A constraint, not a computation: `AssertNever<T extends never>` fails because
 * a constraint is violated, whereas a conditional type that merely evaluates to
 * `never` fails at nothing. That mistake made an earlier assertion in
 * `events.ts` vacuous until a regression caught it.
 */
type AssertNever<T extends never> = T;
type NamesAPosition<T> = T extends unknown
  ? Extract<keyof T, "ordinal" | "createdAt"> extends never
    ? never
    : T
  : never;
export type NO_POSITION_ON_THE_RESPONSE_ITSELF = AssertNever<NamesAPosition<ChatSendResponse>>;
