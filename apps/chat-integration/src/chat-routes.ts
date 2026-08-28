/**
 * The ordinary message endpoint, and the guard that closes it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"keep server-side fail-closed protection as a backup
 * boundary"* … *"fix the binding lookup/open-request behaviour so the guard
 * cannot fail open after restart."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this is, and what it is NOT ──────────────────────────────────────
 *
 * This is the LAST line, not the first. The first line is in the browser: while
 * a secure request is open the composer accepts typing but its send is inert,
 * so no bytes leave at all. That prevention is what makes the normal path safe
 * and is what stops a password reaching this process in the first place.
 *
 * This guard exists for the four cases where the client is not to be believed:
 *
 *   1. a STALE client that has not learned a request is open;
 *   2. a client whose JS guard threw partway;
 *   3. a DIRECT API call that never ran the client at all;
 *   4. a MALICIOUS client.
 *
 * In all four it refuses without persisting and without telling the model.
 *
 * ── The honest limit ──────────────────────────────────────────────────────
 *
 * By the time this code runs, the bytes have crossed the wire and body-parser
 * has put them in `req.body`. **Refusing is not un-receiving.** If a request
 * logger is ever registered ahead of this route it will see them. That is the
 * same live risk `app.ts` already documents, and it is why prevention rather
 * than quarantine is the primary mechanism.
 *
 * ── Why the guard reads the database ──────────────────────────────────────
 *
 * `openRequestFor` is authoritative and asynchronous. The synchronous
 * cache-only lookup (`findSync`) must never be used here: a cache miss on the
 * SECRET route means "refuse", which is safe, but a cache miss HERE would mean
 * "nothing is open", which leaves the message path available at exactly the
 * moment a student is most likely to type a password into it. Same staleness,
 * opposite consequence. See `bindings.ts`.
 */

import type { NextFunction, Request, Response, Router } from "express";
import { Router as makeRouter } from "express";
import jwt from "jsonwebtoken";

import type { SecretBindingStore } from "./bindings.js";
import type { ChatSendResponse, ConversationEvent } from "@askimate/aas-contracts";
import type { UnpositionedEvent } from "@askimate/aas-conversation";
import { buildModelRequest, persistableContent } from "@askimate/aas-conversation";
import type { AskimateUserPayload } from "./secret-routes.js";

// `ChatSendResponse` is imported, not declared. It used to be declared HERE,
// in a module that also imports `express` and `jsonwebtoken`, and the browser
// imported it from here — a client bundle depending on a bundler's
// tree-shaking to keep a server framework out of the page. A wire type belongs
// where the wire is described, so it lives in `@askimate/aas-contracts` now.
// `scripts/check-boundaries.ts` fails the build if it comes back.

export interface ChatRoutesOptions {
  readonly bindings: SecretBindingStore;
  readonly jwtSecret: string;
  readonly now: () => Date;
  /**
   * Appends a durable event and returns it AT THE POSITION THE SERVER GAVE IT.
   *
   * This replaced `persist`, which returned `void` and left the route to make
   * up `ordinal: 1` for the response — a number that looked like a log position
   * and was not one. The route cannot know where an event lands; only whatever
   * owns the log does, so it is what answers.
   *
   * `body` is handed over rather than dug out: it is `persistableContent` of
   * the event, which is the text of a message and `null` for everything else.
   * An adapter is therefore never in a position to write a body for an event
   * that must not have one — the same property the database states as
   * `CHECK ((kind = 'message') = (body_id IS NOT NULL))`.
   */
  readonly append: (input: {
    readonly conversationId: number;
    readonly event: UnpositionedEvent;
    readonly body: string | null;
  }) => Promise<ConversationEvent>;
  /** Where an accepted turn would go to the model. Never called for a refusal. */
  readonly askModel: (request: ReturnType<typeof buildModelRequest>) => Promise<string>;
  /** Prior turns, for history. */
  readonly historyFor: (conversationId: number) => Promise<readonly ConversationEvent[]>;
}

function getUser(req: Request, jwtSecret: string): AskimateUserPayload | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (token.length === 0) return null;
  try {
    return jwt.verify(token, jwtSecret) as AskimateUserPayload;
  } catch {
    return null;
  }
}

export function createChatRoutes(options: ChatRoutesOptions): Router {
  const router = makeRouter();

  router.post("/askimate/ai", (req: Request, res: Response, next: NextFunction): void => {
    void (async (): Promise<void> => {
      const user = getUser(req, options.jwtSecret);
      if (user === null) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const body = req.body as unknown;
      const conversationId = readNumber(body, "conversationId");
      if (conversationId === null) {
        res.status(400).json({ error: "conversationId required" });
        return;
      }

      // ── THE GUARD ───────────────────────────────────────────────────────
      //
      // Before the message is read for any purpose. Deliberately ahead of
      // reading `content`, so there is no branch in which the text is pulled
      // out of the body, held in a variable, and then discarded — the value
      // never enters scope on the refused path at all.
      const open = await options.bindings.openRequestFor(conversationId, options.now());
      if (open !== null) {
        // Not persisted. Not sent to the model. Not echoed back — the response
        // names the OPEN REQUEST, never anything from the body, because an
        // echo is how a refused password ends up in a client-side log.
        const refusal: ChatSendResponse = {
          status: "refused",
          reason: "secret_request_open",
          requestId: open.requestId,
          expiresAt: open.expiresAt.toISOString(),
        };
        res.status(409).json(refusal);
        return;
      }

      const content = readField(body, "content");
      if (content === null || content.length === 0) {
        res.status(400).json({ error: "content required" });
        return;
      }

      // ── The server places it. The route does not ────────────────────────
      //
      // The event is built WITHOUT an ordinal and without a timestamp — the
      // type has no field for either — and `append` returns it placed. What
      // comes back is the only version of this event anyone is told about.
      const utterance: UnpositionedEvent = { kind: "message", actor: "student", content };
      const written: ConversationEvent[] = [
        await options.append({
          conversationId,
          event: utterance,
          body: persistableContent(utterance),
        }),
      ];

      const history = await options.historyFor(conversationId);
      const reply = await options.askModel(
        buildModelRequest({ utterance: content, events: history }),
      );

      // The answer is a durable event too, and the client is told where it
      // went. Returning only the text would have left the client to place it,
      // which is the invention this whole change removes.
      if (reply.length > 0) {
        const answer: UnpositionedEvent = { kind: "message", actor: "assistant", content: reply };
        written.push(
          await options.append({
            conversationId,
            event: answer,
            body: persistableContent(answer),
          }),
        );
      }

      const accepted: ChatSendResponse = { status: "accepted", events: written };
      res.status(200).json(accepted);
    })().catch(next);
  });

  return router;
}

function readField(body: unknown, key: string): string | null {
  if (typeof body !== "object" || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readNumber(body: unknown, key: string): number | null {
  if (typeof body !== "object" || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
