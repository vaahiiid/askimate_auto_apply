# ADR-0035 — Event delivery is resumable SSE over the log

**Status:** **Accepted** — delegated technical authority, 2026-08-28
**Extends:** [ADR-0031](./0031-one-conversation-event-log.md)

## The decision

`GET /v1/conversations/:id/stream` is a Server-Sent Events endpoint whose events **are** rows of the
conversation log. Each SSE frame carries `id: <ordinal>`, so a dropped connection reconnects with the
browser's own `Last-Event-ID` header and the server resumes from that ordinal.

Polling `GET /v1/conversations/:id/events?after=<ordinal>` remains as a documented fallback and as the
first-load path. Both endpoints return the same projection of the same table, so there is one
correctness argument rather than two.

## Why not polling alone

A two-second poll is simple and it is what the legacy client did. Its costs are real and they compound:

- **Latency floor.** The student waits up to 2 s for a reply that already exists, and the same again
  for a secure step to visibly settle.
- **Load proportional to open tabs, not to activity.** Ten thousand idle conversations are ten
  thousand requests every two seconds, each with authentication, a database round trip and a TLS
  handshake amortised over nothing.
- **It cannot express "nothing happened" cheaply.** Every poll is a full request whether or not there
  is news.

## Why SSE rather than WebSockets

The traffic is one-directional: the server has news, the client sends messages over ordinary `POST`.
WebSockets buy bidirectionality we do not need and cost a second protocol to authenticate,
load-balance, terminate and observe.

SSE is plain HTTP. It carries the session cookie, works through every proxy that handles HTTP/1.1
chunked responses, reconnects automatically, and — the property that matters here — has resumption
built into the protocol via `Last-Event-ID`. Because the log is append-only with dense ordinals, that
maps onto our data model exactly, with no cursor bookkeeping of our own.

## Operational notes

- HTTP/2 or HTTP/3 at the edge, so the six-connections-per-origin limit of HTTP/1.1 does not bite when
  a student opens several tabs.
- A heartbeat comment every 15 s so idle connections are not reaped by intermediaries.
- Connection count is a first-class capacity metric; SSE holds a connection per active conversation.
- The secure plane has **no** stream. It reports through `postMessage` only (ADR-0030), so there is no
  second channel to secure.
