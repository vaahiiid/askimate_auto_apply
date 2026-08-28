# Legacy harness coverage mapping

**Status: the legacy harness is NOT retired, and must not be.**

> Vahid, 2026-08-28: *"Retire it only after the React path has browser-level
> coverage that is demonstrably equivalent or stronger for every property the
> harness currently proves… No coverage may simply disappear during
> retirement."*

This document is the precondition for that retirement, written before any
deletion so the decision rests on an inventory rather than an impression. It
maps every property the legacy suites prove to its replacement, and — more
importantly — names the properties that **have no replacement yet**.

## What "the legacy harness" now means

Not the vanilla JavaScript harness: that was retired in Phase D, and there has
been one React client since. What remains is the **provisional application** —
`apps/chat-integration`'s own Express routes (`chat-routes.ts`,
`secret-routes.ts`, `bindings.ts`, `schema.ts`) and the four suites that drive
them — which the Conversation Service and the Secure Interaction Service are
replacing.

Legacy suites, by count of assertions:

| Suite | Tests | What it is about |
| --- | ---: | --- |
| `fail-closed.test.ts` | 33 | The secure control in a real browser, and every failure path |
| `quarantine.test.ts` | 25 | The message guard, the route separation, the closed sets |
| `end-to-end.test.ts` | 12 | Whole-database and whole-log scans for a leaked password |
| `continuity.test.ts` | 5 | Rebuilding a conversation after a refresh |

## Replaced — the durable conversation path

These moved to the real service in this phase, and the replacement is stronger
in each case: it runs against the Conversation Service's own log rather than the
provisional app's tables.

| Legacy property | Replacement |
| --- | --- |
| `quarantine` · accepts a message when no secure request is open | `conversation-service/routes.test.ts` · sending a message; `conversation-service.test.ts` · sends through the service and adopts the ordinal it is given |
| `quarantine` · REFUSES a message while a secure request is open | `conversation-service.test.ts` · REFUSES a stale client's message even though the client thinks it may send |
| `quarantine` · refuses BEFORE reading the message | `conversation-service/routes.test.ts` · the guard runs before the body is read |
| `quarantine` · tells a stale client WHICH request is open | `conversation-client.test.ts` · reads a 409 as HELD, and carries nothing from the body |
| `quarantine` · REFUSES after a restart, when the process cache is empty | Structural: the Conversation Service's guard reads its own event log, and holds no cache to be empty. `lifecycle.test.ts` · survives a Conversation Service restart mid-flight |
| `quarantine` · releases the composer once the request reaches a terminal state | `conversation-service.test.ts` · releases only when the LOG says the step settled |
| `quarantine` · still refuses while the request is merely REQUESTED | `conversation-service.test.ts` · blocks a page that was already open when the step was written |
| `quarantine` · scopes the guard to ONE conversation | `conversation-service/routes.test.ts` · refuses another student's conversation |
| `quarantine` · requires authentication BEFORE the guard | `conversation-service/routes.test.ts` · refuses without a session |
| `quarantine` · REFUSES a free-text kind / reason / lifecycle | `conversation-service/schema.test.ts` · the CHECK constraints, read from `information_schema` |
| `quarantine` · round-trips events and keeps them in transcript order | `conversation-service.test.ts` · both clients agree on the order; `log.test.ts` · orders by ordinal, not by arrival |
| `quarantine` · a replayed write does not duplicate an item | `conversation-service/routes.test.ts` · does not duplicate events across a reconnect; `log.test.ts` · ignores an ordinal it already holds |
| `continuity` · rebuilds each secure step at its original position | `conversation-service.test.ts` · reconstructs the SAME transcript on a fresh page |
| `continuity` · restores nothing that was typed | `conversation-service.test.ts` · resumes after a refresh without losing or duplicating anything (the composer's value is a DOM value nothing persists) |
| `continuity` · rebuilds the expiry from the requests table | Structural: `secret_requested` carries its own `expiresAt` in the log, so there is no second table to rebuild it from |

## Replaced — the lifecycle push

| Legacy property | Replacement |
| --- | --- |
| `fail-closed` · lets the student send a real message the moment the password is accepted | `lifecycle.test.ts` · publishes a request and a receipt, and the guard follows the LOG |
| `fail-closed` · frees both ends when the student abandons the step | `conversation-service.test.ts` · releases only when the LOG says the step settled |
| `fail-closed` · shows the refusal IN the conversation, and leaves the request open | `conversation-service.test.ts` · a rejection does not release the composer; `log.test.ts` · is unaffected by a rejection |
| `quarantine` · DELETE marks it CANCELLED and reopens the ordinary message path | `lifecycle.test.ts` · a cancellation delivered through the internal append releases the guard |

## NOT replaced — and why the harness stays

Every row here is a property the React path does **not** yet prove. Each one is
a reason not to delete anything.

| Legacy property | What is missing |
| --- | --- |
| `fail-closed` · refuses when the client does not support it / on an insecure origin / when the endpoint is unreachable | The Secure Interaction Service has **no HTTP surface yet** — migrations, an outbox and an internal-append client, but no submit endpoint and no cross-origin control. `decideRendering` is proven in jsdom and in the legacy browser suite only. |
| `fail-closed` · rejects a confirmation mismatch ON THE SERVER | Same: there is no secure submit endpoint to reject against. |
| `fail-closed` · refuses a duplicate submission / an expired request / a different student / a different conversation | Same. These are properties of the secure submit route, which does not exist on the new plane. |
| `fail-closed` · requires authentication / refuses a forged token / refuses an unverified email | The secure plane's session and bootstrap (ADR-0033) are not implemented. |
| `fail-closed` · the composer stays live for typing but the send is blocked, losing nothing | Partly covered (`conversation-service.test.ts` asserts typing stays enabled), but the draft-preservation and no-auto-send behaviours are only proven against the legacy route. |
| `fail-closed` · suspends draft persistence while a request is open | Only proven in the legacy browser suite. |
| `fail-closed` · the secure control is a descendant of the transcript, in conversation order | The new browser test has no secure control to place, because the control belongs to the secure origin. |
| `end-to-end` · all 12 whole-database leak scans | These scan the provisional app's schema. The equivalent scan for the two new planes exists for the SECURE database (`secure-service/schema.test.ts`) but there is no end-to-end run that types a password into the new architecture, because nothing in it yet accepts one. |
| `quarantine` · a refused message reaches no log, no stdout and no stderr | Not yet asserted against the Conversation Service. |
| `quarantine` · the two routes are different paths, neither reachable at the other | There is only one route on the new plane so far. |

## The retirement condition

The legacy suites may be deleted when, and only when, every row in the section
above has a named replacement that runs against the new planes — which requires
at minimum:

1. the Secure Interaction Service's submit endpoint, session and cross-origin
   control (ADR-0030, ADR-0033);
2. a browser end-to-end run that types a real password into the new
   architecture and scans both databases and all captured output for it;
3. a log-and-stdout scan for a refused message on the Conversation Service.

Item 4 of this list — a test for the body-blind error handler in
`conversation-service/app.ts` — was **closed while writing this document**.
Listing the gap is what showed that the scrub had been written and never
exercised; `app.test.ts` now sends an unparseable body containing a marker and
asserts it reaches neither the response nor stdout, stderr or `console`, with a
canary so the scan cannot pass by capturing nothing. The session cookie's
`__Host-` attributes and signature checks are covered there too.

Until then the provisional app is the only thing proving those properties, and
deleting it would delete the proof rather than the code.
