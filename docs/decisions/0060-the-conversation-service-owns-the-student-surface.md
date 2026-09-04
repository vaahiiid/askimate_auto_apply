# ADR-0060 — The Conversation Service owns the student surface, and the journey is readable

**Status:** **Accepted** — 2026-09-04
**Settles:** where the student-facing client lives, a question ADR-0039 answered for the *services*
and left open for the *client*
**Depends on:** [ADR-0033](./0033-sessions-are-httponly-cookies.md) (the `__Host-` cookie decides the
origin), [ADR-0037](./0037-service-topology-and-deployment.md) (plane separation),
[ADR-0059](./0059-the-student-can-read-what-they-are-authorising.md) (the last route the journey
was missing)

## The question

P22 completed the last consequential gate. Every step of the student journey now exists over HTTP,
and none of it is reachable from a browser. The obvious next move is a client — and the obvious
place is `apps/chat-integration`, because it already holds a React client that talks to this service.

It is the wrong place, and the repository already says so in six independent voices.

## `apps/chat-integration` is not the student surface

| Evidence | Where |
|---|---|
| *"⚠ RESEARCH BUILD — NOT THE PRODUCTION INTEGRATION"*, built against the **archived** AskiMate codebase of 2026-06-18 | its own `index.ts` and `README.md` |
| *"Research-only … not part of the product's behaviour and must not imply that it is"* | ADR-0028 |
| *"conversation-service/ ← was chat-integration"* — the rename already happened for the server half | ADR-0039 |
| `ChatView.tsx`, `browser-entry.tsx`, `public/index.html` → **"Provisional surface. Discard. Replaced by the real dashboard"** | `docs/phase-e-integration-audit.md` §5 |
| *"PROVISIONAL — not an AskiMate interface … Every element, class name and sentence below is a placeholder"* | `ChatView.tsx` |
| No `bin.ts`, no `main.ts`, absent from the five deployables | `docs/deployables.md` |

Three further facts make it unusable rather than merely unintended:

**It cannot hold the session.** The session is `__Host-aas-session`, minted by *this* service. The
`__Host-` prefix is browser-enforced: `Secure`, `Path=/`, and **no `Domain`** — so the cookie is
bound to exactly one origin. `conversation-client.ts` already states the consequence: *"Relative
URLs, deliberately. Same origin as the page."* A client served from anywhere else has no session at
all. `apps/chat-integration`'s own auth is a JWT bearer over `askimate_users` — a second identity
system.

**It is already a second source of truth.** It declares `askimate_users`, `askimate_conversations`,
`askimate_messages`, `askimate_secret_requests` and `askimate_conversation_events`, and ADR-0041
records that `replayEvents` reads that **legacy** event table. Putting the application journey there
would put it behind a second identity system and a second log.

**It can represent two of the nine things the journey needs.** Conversations and messages. Not
reviewed targets, offers, explicit requests, runs, workflow state, the preview, or hash-bound
authorisation — it has no notion of a run at all.

## The decision, part one: the client belongs to this service

**A plane's browser client lives inside the app that serves its origin.** That is not a new rule; it
is the one the Secure Service already follows: `control-client.ts` is bundled by `build-control.ts`
into a directory served by that service's own `express.static`, and its comment says *"Not
committed, for the same reason the chat client's bundle is not."*

The Conversation Service mints the session, serves every `/v1` route the journey uses, is one of the
five deployables, and already has `express.static(publicDir)` behind `AAS_PUBLIC_DIR` — with no
source tree building into it. That absence is the gap, not the client's location.

## The decision, part two: read before render

Before any client is written, the journey has to be **startable and readable**. Measured at
`68f4497`, against the implemented route list:

| Missing | Status |
|---|---|
| `POST /v1/conversations` | **published in `conversation.v1.yaml`, not implemented** |
| `GET /v1/conversations` | **published, not implemented** |
| `GET /v1/conversations/{id}` | **published, not implemented** |
| any read of run state | **does not exist anywhere** |

Every conversation in this repository is created by a raw `INSERT INTO conversations` in a test.
There is no production path to the first step of the journey.

The fourth is the one that matters most, and it is a boundary question rather than a convenience.
`POST .../runs` is the only way to learn where a run stands, and it needs an `offerHash`. So a
client that reloads the page must keep the run id, the step and the offer hash **in browser storage**
to know what to draw — which makes the client a durable holder of workflow identity. That is exactly
the second source of truth this ADR refuses. A read removes the reason to cache.

```
GET /v1/conversations/{conversationId}/runs  →  200 { run: ConversationRun | null }
```

`null` is a real answer — *"you have not started one"* — and distinct from `404`, which stays
reserved for a conversation that is not yours. The body is the **same `ConversationRun` projection
the POST returns**, produced by the same coordinator method, so there is one shape and one place
that decides it.

### It reads and does not act

The read computes the run's situation and writes nothing: no checkpoint, no case hop, no event, no
announcement. `#situation` was already side-effect-free — `previewFor` depends on that — and the new
method adds no write of its own. A `GET` that advanced a run would make merely *looking at* an
application a consequential act, which is the inverse of every rule in ADR-0058 and ADR-0059.

## What the client may and may not do, once it exists

Stated here because the routes above are what make it enforceable:

- It **renders** what the server returned and **collects** explicit decisions.
- It **does not determine workflow state** — it reads `status`, `phase` and `step`, and never infers
  them from the transcript.
- It **does not invent executable target state** — targets come from `GET /v1/application-targets`,
  which is Gate 1's output and nothing else.
- It **does not derive application content** — it displays `presentedText` exactly as served and
  returns the `contentHash` exactly as received (ADR-0059).
- **Free text is never a consequential action.** A message is a message; every consequential act
  goes through a structured decision endpoint carrying a hash.

## Consequences

- **The journey becomes startable from a browser for the first time.** `journey.test.ts` creates its
  conversation over HTTP instead of by SQL, which is the proof that a client could.
- **`apps/chat-integration` is not extended.** It stays where it is, doing what it does: proving the
  secure channel on the archived AskiMate stack shape. Its retirement is a separate decision and
  nothing here depends on it.
- **No sixth deployable.** The client is an asset directory this service serves, exactly as the
  secure control is for its own plane.
