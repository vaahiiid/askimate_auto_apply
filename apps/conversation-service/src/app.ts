/**
 * The conversation plane, as one origin.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0030 / ADR-0037: the conversation UI and the Conversation Service share
 * an origin (`app.askimate.com`). The SECURE control is the cross-origin one.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * That is why this app serves the client as well as the API. The alternative —
 * a page on one origin calling the service on another — would need CORS with
 * credentials on every route including the stream, and would put a
 * cross-origin preflight in front of the fail-closed message guard. Same
 * origin means the session cookie is simply attached, `EventSource` works
 * without `withCredentials`, and there is no preflight to misconfigure.
 *
 * ── What this adds over `createConversationRoutes` ────────────────────────
 *
 * The routes are the contract. This is the deployment around them: the session
 * cookie that turns a browser into a caller, the static client, and the
 * body-blind error handler. Kept apart so a test can mount the routes with a
 * stub caller and a browser can mount the whole thing.
 */

import express from "express";
import type { Express, NextFunction, Request, Response } from "express";

import type { ConversationEvent } from "@askimate/aas-contracts";

import type { ConversationEventStore } from "./event-store.js";
import { createConversationRoutes, type ConversationRoutesOptions } from "./routes.js";
import type { SecureRequestOpener } from "./secure-requests.js";
import { createAuthRoutes, type AuthRoutesOptions } from "./auth-routes.js";
import { readSession, setSession } from "./session.js";

export interface ConversationAppOptions {
  readonly store: ConversationEventStore;
  /** Signs the `__Host-` session cookie. */
  readonly sessionSecret: string;
  /** True when this student may read and write this conversation. */
  readonly authorise: (studentId: string, conversationId: string) => Promise<boolean>;
  readonly now: () => Date;
  /** Static root for the built client. Omit to serve the API alone. */
  readonly publicDir?: string;
  readonly authoriseService?: ConversationRoutesOptions["authoriseService"];
  readonly answer?: ConversationRoutesOptions["answer"];
  readonly pollIntervalMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly maxStreamMs?: number;
  readonly mintFrameToken?: ConversationRoutesOptions["mintFrameToken"];
  /**
   * The one client for the Secure Interaction Service (P4).
   *
   * ═════════════════════════════════════════════════════════════════════
   * Supplying this is how a deployment gets BOTH halves of the secure step
   * from one place: the run driver opens the request through it, and the
   * bootstrap endpoint mints the frame capability through it.
   *
   * They are wired together rather than separately because they must name the
   * same secure service. Two independent wirings can drift — a deployment
   * that opened requests against one service and minted frame tokens against
   * another would answer `not_found` for every bootstrap, and the failure
   * would look like an expiry rather than a misconfiguration.
   * ═════════════════════════════════════════════════════════════════════
   *
   * `mintFrameToken` still wins if both are given, so a test can substitute
   * one half without standing up the other.
   */
  readonly secureRequests?: SecureRequestOpener;
  readonly secureOrigin?: string;
  /** Starts and advances application runs (P1). Omit to serve conversations alone. */
  readonly runs?: ConversationRoutesOptions["runs"];
  /**
   * The reviewed targets a student may be offered (ADR-0058, Gate 1).
   *
   * Omit and no target can be offered, so no case can open — which is the safe
   * direction for a deployment that has not resolved a catalogue.
   */
  readonly targets?: ConversationRoutesOptions["targets"];
  /**
   * Mints a session for a subject. PROVISIONAL, and mounted only when supplied.
   *
   * ADR-0038 delegates identity to a managed OIDC provider, so there is no
   * sign-in route here and there should not be one. A browser test needs a
   * logged-in page, and this is the seam it uses — named, optional, and absent
   * unless a caller passes it, so it cannot be mistaken for the real thing or
   * left on by default.
   */
  readonly issueSessionFor?: (req: Request) => string | null;
  /**
   * Sign-in, when this deployment has an identity provider (ADR-0038).
   *
   * Optional so every existing test can build an app without one. A deployment
   * WITHOUT it has no way for a student to sign in at all, which is why
   * `conversationConfigFrom` requires it in production.
   */
  readonly auth?: AuthRoutesOptions;
}

export function createConversationApp(options: ConversationAppOptions): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.get("/healthz", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  // Before the routes: the JSON body parser, with the same limit the contract
  // declares. `413` from here is the contract's `payload_too_large`.
  app.use(express.json({ limit: "64kb" }));

  // Before the session-authenticated routes: signing in cannot require a
  // session. Mounted only when configured.
  if (options.auth !== undefined) {
    app.use(createAuthRoutes(options.auth));
  }

  if (options.issueSessionFor !== undefined) {
    app.post("/dev/session", (req: Request, res: Response): void => {
      const subject = options.issueSessionFor?.(req) ?? null;
      if (subject === null) {
        res.status(400).json({ error: "no subject" });
        return;
      }
      setSession(res, subject, options.sessionSecret);
      res.status(204).end();
    });
  }

  app.use(
    createConversationRoutes({
      store: options.store,
      // ── The cookie IS the credential ──────────────────────────────────
      //
      // Not a bearer header. `EventSource` cannot send one, so a header-based
      // scheme would leave the stream either unauthenticated or authenticated
      // by a token in the URL. See `session.ts`.
      authenticate: (req) => {
        const studentId = readSession(req, options.sessionSecret);
        return studentId === null ? null : { studentId };
      },
      authorise: async (caller, conversationId) =>
        await options.authorise(caller.studentId, conversationId),
      now: options.now,
      ...(options.authoriseService === undefined
        ? {}
        : { authoriseService: options.authoriseService }),
      // ── Who answers a student's message ─────────────────────────────
      //
      // The run driver interviews them (ADR-0051). An explicit `answer` still
      // wins, so a deployment or a test can substitute one — but the DEFAULT
      // is the interview, because a service that appended the student's words
      // and did nothing with them is what P13 exists to end.
      ...(options.answer !== undefined
        ? { answer: options.answer }
        : options.runs === undefined
          ? {}
          : {
              answer: async (input: {
                readonly conversationId: string;
                readonly event: ConversationEvent;
              }): Promise<void> => {
                await options.runs?.answerStudent(input);
              },
            }),
      ...(options.pollIntervalMs === undefined
        ? {}
        : { pollIntervalMs: options.pollIntervalMs }),
      ...(options.heartbeatIntervalMs === undefined
        ? {}
        : { heartbeatIntervalMs: options.heartbeatIntervalMs }),
      ...(options.maxStreamMs === undefined ? {} : { maxStreamMs: options.maxStreamMs }),
      ...(options.mintFrameToken !== undefined
        ? { mintFrameToken: options.mintFrameToken }
        : options.secureRequests === undefined
          ? {}
          : {
              mintFrameToken: (requestId: string): Promise<string | null> =>
                // Bound at call time, never cached: a capability held here
                // between requests would be a capability at rest in the one
                // plane ADR-0037 keeps free of them.
                (options.secureRequests as SecureRequestOpener).mintFrameToken(requestId),
            }),
      ...(options.secureOrigin === undefined ? {} : { secureOrigin: options.secureOrigin }),
      ...(options.runs === undefined ? {} : { runs: options.runs }),
      ...(options.targets === undefined ? {} : { targets: options.targets }),
    }),
  );

  if (options.publicDir !== undefined) {
    app.use(express.static(options.publicDir));
  }

  // ── The body-blind error handler ────────────────────────────────────────
  //
  // Four arguments, because Express identifies an error handler by arity and a
  // three-argument function here would silently never run.
  //
  // It names the error's TYPE and nothing else. In particular it does not touch
  // `err.body`, which `body-parser` populates with the RAW REQUEST BODY on a
  // JSON syntax error — the exact field that would carry a half-typed password
  // into a log line or a response.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (typeof error === "object" && error !== null && "body" in error) {
      delete (error as { body?: unknown }).body;
    }
    // The error's TYPE, and nothing else. `console.error(error)` here would be
    // the ordinary thing to write and would serialise the whole object —
    // including the raw body deleted just above, on any error that still
    // carried one.
    const kind = error instanceof Error ? error.name : "UnknownError";
    console.error(`conversation-service error: ${kind}`);
    if (res.headersSent) return;
    res.status(500).type("application/problem+json").json({
      type: "https://askimate.com/problems/internal_error",
      title: "Something went wrong",
      status: 500,
      code: "internal_error",
    });
  });

  return app;
}
