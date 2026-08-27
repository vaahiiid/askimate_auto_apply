# `@askimate/aas-chat-integration` — RESEARCH BUILD, NOT PRODUCTION INTEGRATION

> ## ⚠ Read this before citing anything in here
>
> **This app was built against the ARCHIVED AskiMate codebase**, at
> `vaahiiid/Universitio` → `archive/askimate/`, which is AskiMate as it stood on **2026-06-18**.
>
> **The current production source for askimate.com is not accessible from this session.** See
> [`docs/production-repository-audit.md`](../../docs/production-repository-audit.md) for what was
> searched and what was found.
>
> Vahid, 2026-08-27: *"The archived AskiMate code inside the Universitio repository … is
> approximately 10 weeks behind the current production system and must not be treated as
> authoritative production source code."*

## What this therefore is, and is not

| It is | It is not |
|---|---|
| A working reference implementation of the secure secret channel on AskiMate's real stack shape — Express 5, the same middleware in the same order, the same JWT bearer auth, the same table shapes | The production integration |
| Evidence that the design is implementable and that its properties hold **on that stack** | Evidence that any property holds on askimate.com |
| A measured finding about `err.body` in Express 5 + body-parser 2.3.0 that is worth acting on wherever AskiMate runs | A statement that production has no logger, no APM and no error middleware — that was true of the archive, ten weeks ago |

**No statement of the form "production is secure", "the production integration is complete", or
"this is ready for deployment" is supported by anything in this directory.**

## What it contains

| File | What |
|---|---|
| `src/secret-routes.ts` | The secure endpoint: `POST`/`GET /api/askimate/secret/:requestId` |
| `src/app.ts` | The Express app with AskiMate's middleware stack, plus the body-blind error handler the archive does not have, plus `scrubParseErrorBody` |
| `src/bindings.ts`, `src/schema.ts` | Session binding. The table has **no plaintext column**, no encrypted one, no hash, no length |
| `src/chat-transport.ts` | `buildModelRequest` — the only funnel to the model. Copies `content`, and only `message` turns have one |
| `src/render-decision.ts` | `secure_control \| refuse`. There is **no `chat_message` outcome** |
| `public/` | The real secure control: password inputs in their own form, outside the chat composer |

## Running its tests

They need a real PostgreSQL, because the assertion is *"scan every column of every row"* and a
fake would make that vacuous.

```
pnpm run verify:integration      # starts a throwaway cluster, runs, tears it down
```

Without a database the suite **skips with an unmissable banner** naming what was not checked —
"the leak test did not run" must never look like "the leak test passed" — and
`AAS_REQUIRE_DATABASE=1` turns that skip into a failure.

## To make this real

Three things, all needing someone with access to the production repository:

1. Confirm the live app still has no request logger, no APM and no error middleware. Ten weeks is
   long enough for someone to have added `pino` while debugging, which would silently reopen the
   `err.body` leak.
2. Port the code into askimate.com's actual repository, registering the error handler **before**
   any logging middleware. Ordering is the one risk this code cannot control.
3. Add the directive turn kind to the real message pipeline. The archive has no tool-call protocol
   at all, so `request_secret` has nowhere to travel until one exists.
