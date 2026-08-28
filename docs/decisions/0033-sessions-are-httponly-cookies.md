# ADR-0033 — Sessions are `HttpOnly` cookies, and the secure plane mints its own

**Status:** **Accepted** — delegated technical authority, 2026-08-28
**Extends:** [ADR-0030](./0030-the-secure-control-runs-on-its-own-origin.md)

## What was wrong

A bearer token in `localStorage` is readable by **any** script on the origin: a dependency, an
injected script, a tag. Storing a session credential somewhere every script can read it defeats the
purpose of having a session credential. It is also the single most common finding in web
authentication reviews, and it has a well-established fix.

## The decision

**Session credentials are `HttpOnly`, `Secure`, `SameSite=Lax` cookies with the `__Host-` prefix. No
session token is ever readable by JavaScript, on any plane.**

```
Set-Cookie: __Host-session=…; HttpOnly; Secure; SameSite=Lax; Path=/
```

`__Host-` forbids a `Domain` attribute, which means the cookie is bound to exactly one host and cannot
be set or read by a sibling subdomain. That is deliberate: a domain-wide `.askimate.com` cookie would
be sent to every subdomain, so any one of them becoming compromised — a marketing site, a status page,
a staging host — would put the session at risk.

Consequence: **the conversation plane and the secure plane hold separate sessions**, because a
`__Host-` cookie cannot be shared. That is the correct outcome, not an inconvenience.

## How the secure plane authenticates the student

The frame must know *which student* is answering, not merely which request. A high-entropy request id
is a capability, and a capability in a URL leaks — through `Referer`, browser history, server access
logs, and the parent page's DOM. An attacker who learned a request id could otherwise set the
student's portal password to a value they chose.

So: **a one-time token exchange, never through a URL.**

1. The conversation plane calls the secure plane's internal API to open a request. It receives
   `{ requestId, prompt, frameToken }`. `frameToken` is single-use, bound to the request, and expires
   in seconds.
2. The frame is rendered at `https://secure.askimate.com/control/:requestId`. The URL carries no
   credential.
3. The frame signals `ready` by `postMessage`.
4. The parent replies with `frameToken` **by `postMessage`** — never a URL, never a query string, so
   it appears in no history entry, no `Referer` header and no access log.
5. The frame `POST`s it to its own origin and exchanges it for a `__Host-` cookie. The token is
   consumed.

`Referrer-Policy: no-referrer` on the conversation plane, so even the frame's own `src` request
carries no referrer.

## The residual, stated honestly

A **fully compromised conversation plane** can render a frame for the student and can therefore drive
a secure step. What it cannot do is read the value the student types — that is what ADR-0030 buys, and
it is the property that matters. A compromised parent could instead render a *fake* form of its own
and phish; no web mechanism prevents that, and it is tracked as T13 in the threat model, mitigated by
presentation consistency rather than by code.

## Cross-site considerations

`app.askimate.com` and `secure.askimate.com` are different **origins** but the same **site**. Cookie
blocking and storage partitioning in Safari and Chrome target cross-*site* embedding, so a
`SameSite=Lax` cookie is sent to the framed secure plane normally. This is a deliberate reason to keep
both planes under one registrable domain rather than using an unrelated domain for the secure plane.

## CSRF

`SameSite=Lax` plus an `Origin` header check on every state-changing request. The secure plane
additionally requires `Sec-Fetch-Site: same-origin` on its submit endpoint.
