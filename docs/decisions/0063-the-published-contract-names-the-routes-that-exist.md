# ADR-0063 — The published contract names the routes that exist

**Status:** **Accepted** — 2026-09-04
**Completes:** [ADR-0060](./0060-the-conversation-service-owns-the-student-surface.md) — the client
codes against this document, so a document that describes routes nobody serves is a client that
404s
**Depends on:** [ADR-0033](./0033-sessions-are-httponly-cookies.md),
[ADR-0037](./0037-service-topology-and-deployment.md),
[ADR-0038](./0038-identity-is-delegated-to-a-managed-oidc-provider.md),
[ADR-0048](./0048-a-specialist-resolution-completes-an-intent.md),
[ADR-0056](./0056-verification-is-established-at-login.md)

## The measurement that produced this ADR

`scripts/contract-drift.test.ts` has guarded the seam between the contracts package and the domain
since P13. It loads both OpenAPI documents. **It never read `paths`.**

Every check in it compares an *enum* — lifecycle words, run phases, credential purposes. Nothing
compared the operations. So while the vocabulary was pinned in three directions at once, the route
table drifted for twenty-three phases with no control looking at it at all.

An audit of the real Express routers against both documents found **six** discrepancies, and reading the resulting diff found a **seventh**:

| # | Discrepancy | Since |
|---|---|---|
| 1 | `GET /health` published; the real endpoint is `GET /healthz` at the app root | always |
| 2 | The server base was `…/v1` while internal paths carried their own `/internal/v1`, resolving to `…/v1/internal/v1/…` — which nothing serves, and `/healthz` could not be expressed at all | always |
| 3 | `GET /v1/conversations/{id}/secure-requests/{id}/bootstrap` served with no schema — a **public, session-authenticated** route | P4 |
| 4 | `POST /internal/v1/cases/{caseId}/review` unpublished | P11 |
| 5 | `GET /internal/v1/interventions` and `POST /internal/v1/interventions/{id}/resolution` unpublished | P11 |
| 6 | `POST /internal/v1/secret-requests/{requestId}/frame-tokens` unpublished, and the Secure Plane's `GET /healthz` too | P4 |
| 7 | `secure.v1.yaml`'s `security` default indented **inside `components:`**, where OpenAPI ignores it — so the document declared no authentication on its three student-facing operations, including the one that carries a secret | always |

"Internal routes are deliberately unpublished" is not the explanation for 4–6: three *other*
internal routes were published. The family was simply never added.

## The decision

**Every route a plane serves is in that plane's document, or is named as an exception with the
decision that made it one.**

### The guard reads the router, not the source

`routesOf()` walks the real Express layer stack. A regex over `router.get("…")` reads what a file
says; this reads what the process would serve, including anything a nested router mounts that no
grep would attribute to the right prefix.

It is built with **every optional surface supplied** — `auth`, `issueSessionFor`, `publicDir` —
because the route set depends on configuration, and checking the minimal app would let an
unpublished surface hide behind an unset option.

An absent or empty layer stack **throws**. An empty set would agree with an empty contract, and both
comparisons would go green while the service served whatever it liked.

### The base URL is the origin, and every path is literal

The conversation document mixed two conventions under one `/v1`-suffixed base. It now names the
origin, and every published path is exactly the path the process serves — the shape
`secure.v1.yaml` already used and was right about. That is not cosmetic: it is what makes a
mechanical comparison possible at all, and `/healthz` at the root cannot be expressed any other way.

### A document covers a PLANE, not a process

`secure.v1.yaml` publishes `POST /internal/v1/secret-fills` and says of it *"Served by the Secure
Plane's FILL AGENT, not by this service."* So the secure comparison is against the union of
`apps/secure-service` and `apps/secure-filler`. The document was already right about this; the
guard now models it.

### A default belongs where OpenAPI reads it

Discrepancy 7 is not a route problem and the path guard would never have found it. `security` under
`components:` is not a field; a scheme parked there is a scheme nothing applies. Moved to the
document level, and two new assertions in `openapi.test.ts` close the class:

- every operation resolves to a real requirement — its own, or a document default that exists;
- `components.security` is undefined.

The existing "leaves exactly the intended operations unauthenticated" test looked for an explicit
`security: []` and so could not see an operation that declared **nothing at all** — the more
dangerous shape, because absence reads as an oversight rather than a decision.

Nothing was ever exposed: the service authenticates those routes with the `__Host-` secure cookie
and the two-origin browser suite proves it. The contract was wrong, and the contract is what a
reviewer reads and a generated client builds against.

### What stays unpublished, and why

Named one at a time in `UNPUBLISHED`, with the ADR that decided it — not skipped by a pattern. A
pattern would silently swallow the next route that matched it, which is how these gaps got in.

| Route | Why it is not an operation |
|---|---|
| `GET /auth/login` | ADR-0056 — a redirect the browser follows. No JSON either way; following the chain and holding the cookie is the browser's job. |
| `GET /auth/callback` | as above |
| `POST /dev/session` | ADR-0038 — mounted only under `AAS_DEV_SESSION`, which configuration **refuses in production**. Publishing a route that mints a session for any subject named in its body would put an attack in the contract. |

The exceptions are asserted as data: an exception naming a route that is no longer served fails, and
so does one whose reason cites no ADR.

## Consequences

- A route added without a schema fails CI. So does a schema for a route nobody serves.
- The bootstrap capability is described for the first time. It is a **capability, not a secret** —
  `openapi.test.ts` already drew that line — so it may appear in a response body, and the existing
  "no capability travels in a URL" guard still covers where it may not go.
- `/healthz` is published in both documents and is unauthenticated in both. `openapi.test.ts`'s
  list of intended-open operations gains the secure plane's and corrects the conversation plane's.
- Two public names with no consumer were removed rather than documented:
  `ConversationEventStore.isOrdinalCollision` (zero callers anywhere, including tests) and the
  barrel export of `handoverChecklistFrom` (no importer; the function stays, with its one internal
  caller). Both are the same shape as the drift above — a published surface nothing uses.
