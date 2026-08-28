# Real Chat integration — data path, audit, and what is not closed

**Date:** 2026-08-27
**Status:** Built and tested. **Not connected to anything live.**
**Default password delivery:** **unchanged** — `student_types_into_portal`.
**Verification:** `pnpm run verify` → 44 files, 885 tests · `pnpm run verify:integration` → 2 files, 31 tests, against a real PostgreSQL 16, a real Chromium and the real Express stack.

---

## 1. Read this first: what I could and could not inspect

You asked me to inspect the actual AskiMate Chat. **The live askimate.com code is not in any
repository this session can reach.** `list_repos` returns exactly three:

| Repository | State |
|---|---|
| `vaahiiid/askimate_auto_apply` | this repo (AAS) |
| `vaahiiid/Universitio` | the monorepo — contains `archive/askimate/`, the entire pre-split AskiMate |
| `vaahiiid/ai-admissions-platform` | empty placeholder |

`archive/askimate/ARCHIVE-REPORT.md` records that on **2026-06-18** AskiMate was separated out of
Universitio into a standalone product at its own domain. So what I inspected is the **real AskiMate
codebase as it stood on 2026-06-18** — its real routes, real schema, real auth, real middleware —
and askimate.com has diverged from it for roughly ten weeks.

**What this means for §4 of your brief.** "Implement the actual endpoint" and "test the actual
configured application" are done against the real, verified stack, and the tests are real. They are
**not** run against the live deployment, because I cannot reach it. Every finding below is
labelled — **Measured** (I ran it), **Read** (it is in the archived source), or **Unverifiable
here** (needs someone with access to production).

The two things you asked me to close are closed *for that stack*. Confirming they hold on
askimate.com needs either the repository or an hour with someone who has it. That is §9.

---

## 2. The actual data path — **Read**, from the archived source

```
  ┌─ BROWSER ─ askimate-dashboard.tsx ────────────────────────────────────────┐
  │  fetch("/api/askimate/chat", { body: { message } })          ← plain POST │
  │  no streaming · no SSE for user chat · delta polling by last message id   │
  └──────────────────────────────┬───────────────────────────────────────────┘
                                 ▼
  ┌─ EXPRESS ─ services/api-server/src/app.ts ───────────────────────────────┐
  │  helmet → canonicalRedirect → compression → cors → cookieParser          │
  │  → express.json({limit:"16kb"}) on /api/askimate/ai                      │
  │  → express.json({limit:"10mb"}) everywhere else → router                 │
  │                                                                          │
  │  NO request logger.  NO APM.  NO error-handling middleware.              │
  └──────────────────────────────┬───────────────────────────────────────────┘
                                 ▼
  ┌─ ROUTE ─ askimate-chat.ts ───────────────────────────────────────────────┐
  │  db.insert(askimateMessages).values({ content: message })    ← VERBATIM  │
  │  emitAdminEvent("askimate-unread-changed", …)                            │
  └──────────────────────────────┬───────────────────────────────────────────┘
                                 ▼
  ┌─ ROUTE ─ askimate-ai.ts ─────────────────────────────────────────────────┐
  │  const { message, history } = req.body       ← history is CLIENT-SUPPLIED│
  │  safeHistory = history.slice(-10).map(h => h.content.slice(0,500))       │
  │  generateAiAnswer(message, safeHistory)      ← into the OpenAI prompt    │
  └──────────────────────────────────────────────────────────────────────────┘
```

### The nine points where a password could leak, and what is true at each

| # | Point | Finding | Status |
|---|---|---|---|
| 1 | **`askimate_messages.content`** — `text NOT NULL`, verbatim | The worst one. See below. | **Read** |
| 2 | **`history` replay into the prompt** | Client-supplied, re-sent every turn | **Read** |
| 3 | Request logging middleware | **None exists** — no `morgan`, `pino`, `winston` in any manifest | **Measured** (absence of dependency) |
| 4 | APM / error reporting | **None** — no Sentry, Datadog, New Relic, OpenTelemetry | **Measured** |
| 5 | Error-handling middleware | **None** — Express's default handler runs | **Measured** |
| 6 | `err.body` on a JSON parse error | **Carries the raw body. `JSON.stringify(err)` emits it in full.** | **Measured** |
| 7 | Frontend analytics (`window.dataLayer`, GA4/GTM) | Present; pushes event names, not message content | **Read** |
| 8 | `console.log` in existing routes | `askimate-auth.ts` logs emails and user ids into log lines | **Read** |
| 9 | Admin SSE (`emitAdminEvent`) | Carries conversation ids and a reason, not content | **Read** |

### Point 1 is the one that matters

`askimate_messages.content` is `text NOT NULL`, holds every turn verbatim, and is read back into
`history`, which the client sends to `/api/askimate/ai`, which interpolates it into the model's
prompt.

**So a password that becomes a chat message is not stored once. It is:**

1. written to `askimate_messages.content` as plain text;
2. read back by the dashboard on every load;
3. sent to the server in `history` on every subsequent turn;
4. **interpolated into the model's prompt each time**, for as long as it stays in the last ten turns.

There is no redaction anywhere on that path, and **no mechanism for removing a message once
written**. That is the finding that makes the secure control necessary rather than merely tidy.

### Point 6 — where my first guess was wrong

I expected Express's default error handler to leak a half-typed password from a malformed request,
because `SyntaxError` used to embed the offending input in its message. **Measured against Express 5
+ body-parser 2.3.0, it does not:**

| Route out | Contains the password? |
|---|---|
| `err.message` | **no** — names a position, not the content |
| `err.stack` | no |
| `String(err)` | no |
| Express's default handler's HTML response | no — it sends the stack |
| **`err.body`** | **YES — the raw body, verbatim** |
| **`JSON.stringify(err)`** | **YES — `body` is an enumerable own property** |

The danger is therefore not Express. It is **anything that serialises the error object**, which is
exactly what `pino`, `winston` with a JSON formatter, and every error-reporting SDK do to a caught
error. AskiMate has no logger today, and adding one is a completely routine thing to do — at which
point every malformed password submission writes the password into the log store, with nobody
having made a decision about it.

Fixed two ways: `scrubParseErrorBody` deletes `err.body` before anything downstream can serialise
it, and the dependency-boundary check forbids every logger and APM package in this app.

---

## 3. What was built

| Piece | File | What it is |
|---|---|---|
| Secure endpoint | `apps/chat-integration/src/secret-routes.ts` | `POST/GET /api/askimate/secret/:requestId`, AskiMate's own JWT bearer auth, rate-limited 10/hour |
| The app | `src/app.ts` | AskiMate's middleware, same order, same options — plus the body-blind error handler they do not have |
| Session binding | `src/bindings.ts`, `src/schema.ts` | `askimate_secret_requests`. **No plaintext column, no encrypted one, no hash, no length.** |
| Model funnel | `src/chat-transport.ts` | `buildModelRequest` — the only path to the model; can only read `content`, and only `message` turns have one |
| Render decision | `src/render-decision.ts` | `secure_control | refuse`. **No `chat_message` member.** |
| The control | `src/SecureControl.tsx`, `src/ChatView.tsx`, `public/index.html` | Real password inputs, own `<form>` outside the composer, composer send blocked while open (typing stays live) |

### Three structural choices worth naming

**The directive turn has no text field.** A `SecretPrompt` is delivered as
`{ kind: "directive", directive: "request_secret", prompt }`, and `buildModelRequest` copies
`content` only from `message` turns. There is no branch that could copy a typed value, because
there is no field to copy it from.

**The fallback is a value that does not exist.** `RenderDecision` is `secure_control | refuse`. A
client that wanted to send the password as a chat message would have to write that code itself,
where a reviewer would see it. A `@ts-expect-error` test pins the absence.

**The chat input is disabled while a box is open.** Not to force the student's hand — they can
always cancel — but because an enabled text box beside a password prompt is an invitation to type
the password into it. That is the single most likely leak in the whole design, and it is the
student's own hands, not our code. Every refusal message ends with *"Do not type a password into
the chat."*

---

## 4. Every place plaintext exists, and for how long

| Location | Maximum lifetime | Who can reach it |
|---|---|---|
| The student's keyboard and browser input | until they submit or the page closes | them |
| The HTTPS request body to `/api/askimate/secret/:id` | one request | TLS; **not logged** — measured |
| `req.body.password` inside the route handler | one call frame | that function, ~40 lines |
| `SecretEntry.#secret` in the in-memory store | **≤ 5 minutes** (TTL), or until spent | only `SecretStore.use` |
| The `task` callback in `secret-fill.ts` | **one `fill()` call** | that callback, ~9 lines |
| Chromium's password input, untraced and unrecorded context | until the page closes | the page |

**It is in no database column, no log line, no event, no analytics payload, no model prompt, and no
chat transcript.** Each of those is asserted against the real artefact, not against our code.

### Every component that can access plaintext

Four, and they are countable:

1. the student's browser (their own password);
2. `secret-routes.ts`'s POST handler, for one call frame;
3. `InMemorySecretStore`, in a `#private` field of a non-exported class;
4. the callback in `apps/browser-runner/src/secret-fill.ts`, for one `fill()`.

Nothing else in the system has a route to it. `packages/llm` cannot depend on the secrets package
and cannot name its identifiers — a source-level check, because a deep relative import resolves
fine and pnpm never hears about it.

---

## 5. What the LLM can and cannot access — **Measured**

**Can see:**

- `sh_…` — 32 random hex characters. Not a hash, not a prefix. Two students choosing the same
  password get unrelated handles.
- Four words: `secret_requested`, `secret_received`, `secret_consumed`, `secret_expired`.
- The fixed sentence `[A secure password box was shown to the student.]`.
- The request metadata it wrote itself.

**Cannot see, and has no capability that would obtain it:**

- The password, in any encoding.
- Its length, a hash, a masked preview, a strength score. None exists as a field anywhere.
- Any function resolving a handle. `getSecret` does not exist and the build fails if one appears.

Asserted by taking the object `buildModelRequest` actually produces and searching it — and by
asserting it *does* contain `secret_received` and the handle, so the test is not passing by sending
the model nothing at all.

---

## 6. Adversarial test results

Marker: `SECRET-PASSWORD-DO-NOT-LEAK-123!`

### `end-to-end.test.ts` — 12 tests, real browser + real Postgres + real Express

| # | Assertion | Result |
|---|---|---|
| 1 | All ten lifecycle steps complete | ✅ |
| 2 | The control renders `type="password"` inputs; chat input disabled | ✅ |
| 3 | **Exactly one request in the whole session carried the marker** — the secure POST | ✅ |
| 4 | The turn list, and `buildModelRequest`'s output, contain no marker | ✅ |
| 5 | …but do contain `secret_received` and the handle | ✅ |
| 6 | Handle spent through the sensitive capability, then unusable | ✅ |
| 7 | **Every column in `information_schema`** of type text/varchar/json/jsonb, in every row | ✅ no marker |
| 8 | The binding row *does* hold `secret_received` and `sh_…` | ✅ |
| 9 | Captured console + stdout + stderr — non-empty, and marker-free | ✅ |
| 10 | A malformed body with the marker: the response and the log carry neither | ✅ |
| 11 | **`JSON.stringify(err)` DOES leak it** — the finding, pinned | ✅ demonstrated |
| 12 | `scrubParseErrorBody` removes it, including from a frozen error | ✅ |

### `fail-closed.test.ts` — 19 tests

All nine scenarios you named, and in every one the password did not reach the chat:

| Scenario | Behaviour |
|---|---|
| Secure control unsupported | refuse · `client_does_not_support_secure_control` |
| Insecure origin | refuse · `insecure_context` |
| Secure endpoint unavailable | refuse · `endpoint_unreachable` |
| Endpoint returns an error | box closes, warns, no fallback |
| Password ≠ confirmation | rejected **on the server**, box stays open, both fields cleared |
| Connection interrupted mid-submission | box closes, warns, no fallback |
| Page refresh | box gone, fields empty; server still says `secret_requested` |
| Duplicate submission | `409 already_submitted` — the first secret untouched |
| Secret already consumed | `unknown_handle` |
| Secret expired | `409 expired`, row marked `secret_expired` |

Session binding — a handle is refused for: a different student (`403 not_your_request`), a different
conversation (`403 wrong_conversation`), a different case, a different purpose, a different target
host. Unauthenticated and forged-token requests are `401`; unverified email is `403`. A request
belonging to someone else returns **byte-identical** output to one that never existed.

### Regressions run to prove the tests are not vacuous

| Regression | Caught? |
|---|---|
| The control falls back to chat on a dropped connection | ✅ 1 test fails |
| The chat input is left enabled while a box is open | ✅ 3 tests fail |
| The server trusts the UI's confirmation check | ✅ 1 test fails |
| The error handler logs the error object | ✅ 2 tests fail |
| `console.log(req.body)` added to the endpoint | ✅ boundary check fails |
| A logger added to the app's manifest | ✅ boundary check fails |

### Two vacuous assertions I found in my own tests and fixed

- **The log scan captured zero bytes.** It hooked `process.stdout.write`, but vitest replaces the
  `console` methods, which is what application code calls. It passed while scanning an empty
  string. Now hooks both, and drives a path that actually logs.
- **The two test files shared one database** and dropped each other's tables. Vitest runs files in
  parallel, so this was a real intermittent failure — and an intermittent failure in a leak test is
  worse than no test, because people re-run it until it passes. Each file now owns a database.

---

## 7. Remaining risks

| Risk | Severity | Status |
|---|---|---|
| **Middleware ordering** — a request logger registered *before* the error handler still sees the raw `err.body` | **Medium — cannot be fixed from code** | `scrubParseErrorBody` runs in our handler; a logger earlier in the chain sees it first. A deployment fact, not something a function can enforce. |
| **The live askimate.com stack is unverified** | **Medium — open** | Everything here is against the 2026-06-18 archive. See §1 and §9. |
| Existing routes log freely (`askimate-auth.ts` logs emails into log lines) | Low–Medium | Not on the password path, but it is the house habit that would produce a leak if the secure endpoint were written the same way. |
| A callback keeps a copy of the secret | Medium | One call site, 9 lines. No type system prevents it. |
| A `SecretConsumer` that lies | Medium | No default and no overload without one, so a caller cannot *forget*. Not proof against deliberate subversion. |
| Heap residue after the reference is dropped | Low | Inherent to the runtime. |
| Frontend analytics (`dataLayer`) | Low | Pushes event names only today. A future `dataLayer.push({ message })` would be a leak; nothing structural prevents it. |
| The integration tests need PostgreSQL | Low | Missing one **skips with an unmissable banner** naming what was not checked; `verify:integration` turns the skip into a failure. |

---

## 8. Is the real AskiMate Chat integration production-ready?

**No — and the gap is specific, small, and not in this code.**

Ready:

- The endpoint, the binding, the store, the control, the funnel and the fail-closed behaviour are
  built and tested against the real stack.
- The two things you asked me to close are closed *for that stack*: the control refuses rather than
  falls back, and the endpoint's request bodies reach no log, no response, no telemetry and no
  database row — measured, not assumed.

Not ready, and all three need someone with access to production:

1. **Confirm the live app still has no request logger, no APM and no error middleware.** This is
   the whole basis of finding #3–#5. Ten weeks is long enough for someone to have added `pino`
   while debugging, which would silently re-open the `err.body` leak.
2. **Port the code into askimate.com's actual repository** and register the error handler *before*
   any logging middleware. Ordering is the one risk this code cannot control.
3. **Add the directive kind to askimate.com's real message pipeline.** The archived app has no
   tool-call protocol at all; `ChatTurn` is the shape I built, and the live app's equivalent has to
   carry a turn that has no text field.

**Estimated: a day's work for someone with the repository, most of it verification rather than
code.**

---

## 9. What I have NOT done

Per your instruction:

- The default password delivery is **unchanged** — `student_types_into_portal`, where AskiMate
  holds nothing at all. `askimate_secure_channel` is still never chosen automatically.
- No live university portal was touched. The only hosts in any test are `127.0.0.1`.
- No account created, no registration attempted, no live fill, nothing submitted.
- No production infrastructure exists for any of this.
- Nothing was connected to askimate.com.
