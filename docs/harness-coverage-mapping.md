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

## Replaced — the secret-entry path itself (0.16.0)

The Secure Interaction Service now exists, so the properties that were blocked
on it have replacements. Each one is now proven against the REAL architecture —
a cross-origin document on its own origin — rather than a same-origin React
component in the conversation page.

| Legacy property | Replacement |
| --- | --- |
| `fail-closed` · refuses when the client cannot show it / on an insecure origin / when the endpoint is unreachable | `SecureFrame.tsx` renders an error state when the frame never says `ready`; `two-origin.test.ts` exercises the real load. **Partial** — see below. |
| `fail-closed` · rejects a confirmation mismatch ON THE SERVER | `secure-routes.test.ts` · REFUSES a mismatched confirmation, and logs a CODE not a value; `two-origin.test.ts` · shows a rejection, keeps the step open |
| `fail-closed` · refuses a duplicate submission rather than replacing the secret | `secure-routes.test.ts` · REFUSES a duplicate submission — one authoritative receipt only; and the simultaneous case |
| `fail-closed` · refuses a submission to an expired request | `secure-routes.test.ts` · the `expiresAt` check, and the vault's own TTL ceiling in `vault.test.ts` |
| `fail-closed` · refuses a submission from a different student / conversation | `secure-routes.test.ts` · refuses a session for ANOTHER request; wrong_conversation |
| `fail-closed` · requires authentication at all | `secure-routes.test.ts` · refuses without a session |
| `fail-closed` · keeps the box open on a mismatch and clears both fields | `two-origin.test.ts` · shows a rejection, keeps the step open, and keeps the composer shut |
| `fail-closed` · survives a page refresh: the box reopens and holds nothing | `two-origin.test.ts` · survives a refresh mid-step: a NEW capability, and nothing typed comes back |
| `fail-closed` · the secure control is inline in the conversation, in order | `two-origin.test.ts` · the frame is a descendant of `#transcript` |
| `fail-closed` · contains no secret store, and no way to reach one | Structural and stronger: the conversation plane is a DIFFERENT ORIGIN and a different process. `check-boundaries.ts` forbids the packages; the browser forbids the read. |
| `end-to-end` · the marker leaks nowhere, across every column | `two-origin.test.ts` · scans every text-ish column of BOTH databases, the vault, every request body, every URL and every postMessage |
| `end-to-end` · scrubs the body off a parse error | `secure-routes.test.ts` · writes NOTHING of a malformed JSON body — the err.body case; `conversation-service/app.test.ts` for the other plane |
| `quarantine` · a refused message reaches no log, no stdout and no stderr | `secure-routes.test.ts` · stdout and stderr captured across a malformed submission |

## NOT replaced — and why the harness stays

| Legacy property | What is missing |
| --- | --- |
| `fail-closed` · refuses when the client does not support it, on an insecure origin, or when the endpoint is unreachable | `decideRendering` is proven in jsdom and in the legacy browser suite. The REAL client no longer consults it: a cross-origin iframe either loads or does not, and `SecureFrame` reports "could not be loaded" after a timeout. The three capability refusals — no secure control, insecure context, endpoint unreachable — have no equivalent browser coverage on the new path. |
| `fail-closed` · does NOT auto-send the draft when the secure step finishes | Only proven against the legacy route. |
| `fail-closed` · restores the draft when a STALE client is refused by the server | The behaviour exists (the composer's DOM value is never written), and only the legacy suite proves it end to end. |
| `fail-closed` · suspends draft persistence while a request is open | `ChatView` still does this; only the legacy browser suite asserts it. |
| `fail-closed` · refuses an unverified email, as every other AskiMate route does | Email verification is part of ADR-0038's identity delegation, which is not implemented. |
| `quarantine` · the chat route will not accept a secret submission, and vice versa; the two routes are different paths | Structurally true and stronger now — they are different SERVICES on different origins with different databases — but there is no test that names it on the new planes. |
| `end-to-end` · the automation spends a handle and the plaintext reaches the runner | `POST /internal/v1/secret-uses` is implemented and unit-covered, and no test drives a real automation through it. |

## The retirement decision, 2026-08-28

**Nothing was deleted.** The mapping above shows that the secret-entry path now
has browser-level coverage on the real architecture — which was the stated
precondition — but seven properties still have no replacement, and four of them
are behaviours of the composer and the draft that a student would notice
immediately if they broke.

Deleting `fail-closed.test.ts` today would delete the only proof of those seven.
The correct order is unchanged and now much shorter:

1. Port the four composer/draft properties to `two-origin.test.ts`. They are
   about the CONVERSATION plane, so nothing blocks them but the work.
2. Decide what replaces the three capability refusals now that the client no
   longer decides whether it can render a control — the frame either loads or
   reports that it did not. This may be a deliberate reduction in scope rather
   than a test to write, and it is Vahid's call, not mine.
3. Drive `POST /internal/v1/secret-uses` from the automation runner.
4. Then, and only then, delete the legacy suites and the provisional app.

`SecureControl.tsx` and the provisional `/api/askimate/*` routes remain mounted
and remain tested. `ChatView` renders the cross-origin frame when a bootstrap
capability exists and falls back to the provisional control otherwise, so both
paths are live and both are covered.
