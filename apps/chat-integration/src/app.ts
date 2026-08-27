/**
 * The Express app, assembled with AskiMate's ACTUAL middleware stack.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"Do not assume the framework defaults are safe. Test the
 * actual configured application."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every `app.use` below is transcribed from
 * `vaahiiid/Universitio` → `services/api-server/src/app.ts`, in the same order,
 * with the same options. That ordering is not decoration: `compression` before
 * `express.json` before the router is what decides whether a body is buffered,
 * and a test against a differently-ordered stack would be testing a different
 * program.
 *
 * ── What the audit of the real stack found ────────────────────────────────
 *
 * | Component | Present? | Would it see a body? |
 * |---|---|---|
 * | `morgan` / `pino-http` / `winston` | **absent** — no logging dependency in any manifest | — |
 * | Sentry / Datadog / New Relic / OpenTelemetry | **absent** | — |
 * | An `app.use((err, req, res, next))` handler | **absent** | Express's DEFAULT handler runs instead |
 * | `helmet`, `compression`, `cors`, `cookieParser` | present | headers and framing only |
 * | `express.json` | present, 16 kb on the AI route | parses into `req.body`; does not log |
 * | `express-rate-limit` | present | IP and count only |
 *
 * The good news is real: **AskiMate has no request logger and no APM**, so
 * there is no middleware writing bodies anywhere. That is a finding, not an
 * assumption — it is the absence of a dependency, checked in every manifest.
 *
 * ── The one thing the real stack is missing, and this adds ────────────────
 *
 * There is **no error-handling middleware** in the real app, so Express 5's
 * default handler runs on a throw. I expected that to be the leak, and it is
 * not — the finding turned out to be both narrower and more dangerous.
 *
 * Measured against Express 5 + body-parser 2.3.0, with a malformed JSON body
 * containing a password:
 *
 *   | Route out                | Contains the password? |
 *   |--------------------------|------------------------|
 *   | `err.message`            | **no** — names a position, not the content |
 *   | `err.stack`              | no                     |
 *   | `String(err)`            | no                     |
 *   | Express's default handler| no — it sends the stack |
 *   | **`err.body`**           | **YES — the raw body, verbatim** |
 *   | **`JSON.stringify(err)`**| **YES — `body` is an enumerable own property** |
 *
 * So the danger is not Express. It is **anything that serialises the error
 * object**, which is precisely what a structured logger does: `pino`,
 * `winston` with a JSON formatter, and every error-reporting SDK serialise
 * caught errors by walking their own properties. AskiMate has no logger today,
 * and adding one is a completely routine thing to do — at which point every
 * malformed password submission writes the password into the log store, with
 * nobody having made a decision about it.
 *
 * Two things follow, and both are implemented below:
 *
 *   1. an explicit error handler that logs the error's TYPE and nothing else;
 *   2. **`scrubParseErrorBody`, which deletes `err.body` before anything
 *      downstream can serialise it** — because a comment saying "do not log
 *      this error object" is exactly the instruction that gets lost.
 *
 * The scrub is the load-bearing half. A logger registered AFTER this handler
 * sees an error with no body on it. A logger registered BEFORE it still sees
 * the raw body, which is why the report names middleware order as a live risk.
 */

import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";

import type { SecretStore } from "@askimate/aas-secrets";

import type { SecretBindingStore } from "./bindings.js";
import { createChatRoutes, type ChatRoutesOptions } from "./chat-routes.js";
import { createSecretRoutes } from "./secret-routes.js";

export interface ChatAppOptions {
  readonly store: SecretStore;
  readonly bindings: SecretBindingStore;
  readonly jwtSecret: string;
  readonly now: () => Date;
  /** Static directory for the chat page and the secure control. */
  readonly publicDir?: string;
  /** See `SecretRoutesOptions.submitLimit`. Omit for the production value. */
  readonly submitLimit?: number;
  /**
   * The ordinary message endpoint, with its fail-closed guard.
   *
   * Optional so the secret channel can be mounted on its own — the guard is a
   * property of the message route, and a deployment that has not yet moved its
   * chat route here should not silently get a half-guarded one.
   */
  readonly chat?: Omit<ChatRoutesOptions, "bindings" | "jwtSecret" | "now">;
}

export function createChatApp(options: ChatAppOptions): Express {
  const app = express();
  app.set("trust proxy", 1);

  app.get("/api/healthz", (_req, res) => {
    res.send("ok");
  });

  // ── Transcribed from the real app, in the real order ────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          // `formAction: 'self'` matters more here than anywhere else in the
          // app: it is what stops an injected <form action="https://…"> from
          // being a route by which the password control posts elsewhere.
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      frameguard: { action: "deny" },
      noSniff: true,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      hidePoweredBy: true,
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      "Permissions-Policy",
      ["camera=()", "microphone=()", "geolocation=()", "interest-cohort=()"].join(", "),
    );
    next();
  });

  app.use(compression({ level: 6, threshold: 1024 }));
  app.use(cors({ origin: (_origin, callback) => callback(null, false), credentials: true }));
  app.use(cookieParser());

  // ── Body limits ─────────────────────────────────────────────────────────
  //
  // 4 kb on the secret route, tighter than the 16 kb the real app puts on the
  // AI route. A password is at most a couple of hundred bytes; anything larger
  // arriving here is not a password, and refusing it early means the parser
  // never holds a large buffer that a heap dump could catch.
  app.use("/api/askimate/secret", express.json({ limit: "4kb" }));
  app.use("/api/askimate/ai", express.json({ limit: "16kb" }));
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  app.use(
    "/api",
    createSecretRoutes({
      store: options.store,
      bindings: options.bindings,
      jwtSecret: options.jwtSecret,
      now: options.now,
      ...(options.submitLimit === undefined ? {} : { submitLimit: options.submitLimit }),
    }),
  );

  if (options.chat !== undefined) {
    app.use(
      "/api",
      createChatRoutes({
        ...options.chat,
        bindings: options.bindings,
        jwtSecret: options.jwtSecret,
        now: options.now,
      }),
    );
  }

  if (options.publicDir !== undefined) {
    app.use(express.static(options.publicDir));
  }

  // ── The body-blind error handler ────────────────────────────────────────
  //
  // Registered last, as Express requires. Four arguments, because Express
  // identifies an error handler by arity and a three-argument function here
  // would silently never run — the classic way this middleware fails to exist.
  //
  // It names the error's TYPE and nothing else. In particular it does not
  // touch `err.body`, which `body-parser` populates with the raw request body
  // on a JSON syntax error — the exact field that would carry a half-typed
  // password into a response or a log line.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    // FIRST, before anything else touches the error object.
    scrubParseErrorBody(error);

    const kind = error instanceof Error ? error.name : "UnknownError";
    // Logged as a type, deliberately not as a message and never as the object.
    // `console.error(error)` here would be the ordinary thing to write and
    // would print `err.body` under `util.inspect`.
    console.error(`[ASKIMATE-SECRET] request failed: ${kind}`);
    if (res.headersSent) return;
    res.status(400).json({ status: "secret_rejected", reason: "malformed_request" });
  });

  return app;
}

/**
 * Deletes the raw request body that `body-parser` attaches to a parse error.
 *
 * On a malformed JSON request, `body-parser` sets `err.body` to the raw text it
 * failed to parse — **verbatim, including a password the student was halfway
 * through typing** — and `body` is an enumerable own property, so
 * `JSON.stringify(err)` emits it in full. Measured, not assumed; see the table
 * at the top of this file.
 *
 * Exported because AskiMate's own app should call it at the top of whatever
 * error handling it has, whether or not it adopts `createChatApp`. It is
 * deliberately tolerant of anything: a frozen object, a non-object, a null.
 *
 * **Ordering matters and cannot be fixed from here.** This scrubs the error on
 * its way through THIS handler. A request logger registered earlier in the
 * chain sees the error first and still has the raw body. Any logging
 * middleware must therefore be registered after this one — which is a fact
 * about deployment, not something a function can enforce.
 */
export function scrubParseErrorBody(error: unknown): void {
  if (typeof error !== "object" || error === null) return;
  if (!("body" in error)) return;
  try {
    delete (error as { body?: unknown }).body;
  } catch {
    // A frozen error object cannot be scrubbed. Overwriting is the next best
    // thing, and if that fails too the error is left alone rather than the
    // request being turned into a crash.
    try {
      (error as { body?: unknown }).body = "[scrubbed]";
    } catch {
      /* nothing more can be done safely */
    }
  }
}
