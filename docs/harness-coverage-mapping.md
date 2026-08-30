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

## The seven gaps, closed — the decision matrix (0.17.0)

Every property that `docs/harness-coverage-mapping.md` listed as having no
replacement, with its replacement, the level it is tested at, the real
components exercised, and the decision.

| # | Legacy property | Still relevant? | Replacement test | Level | Real components | Strength | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1a | `fail-closed` · refuses when the client does not support a secure control | **Yes** | `two-origin.test.ts` · refuses with `client_does_not_support_secure_control`, mounts NO frame, and stays blocked | browser | Chromium, both services, PostgreSQL, SSE | **Stronger** — also asserts no frame is mounted, no capability is minted, and the composer stays blocked | **Replace** |
| 1b | `fail-closed` · refuses on an insecure origin | **Yes** | same, `insecure_context` | browser | as above | **Stronger** — same reasons | **Replace** |
| 1c | `fail-closed` · refuses when the endpoint is unreachable | **Yes** | same, `endpoint_unreachable`; plus `NEVER fetches a bootstrap capability it cannot use` | browser | as above + `frame_tokens` | **Stronger** | **Replace** |
| 2 | `fail-closed` · does NOT auto-send the draft when the step finishes | **Yes** | `two-origin.test.ts` · does NOT auto-send the draft when the step finishes — Q4, the release case | browser | Chromium, cross-origin frame, outbox, SSE | **Stronger** — the release is driven by a real authoritative lifecycle rather than a same-origin card closing | **Replace** |
| 3 | `fail-closed` · restores the draft when a STALE client is refused | **Yes** | `two-origin.test.ts` · cannot submit a stale draft while the step is open — Q4; and · cannot be unblocked by a stale stream — Q10 | browser | Chromium, real 409 from the Conversation Service | **Equivalent** — same property, real guard, and Q10 adds the severed-stream case the legacy suite had no equivalent for | **Replace** |
| 4 | `fail-closed` · suspends draft persistence while a request is open | **Yes** | `two-origin.test.ts` · suspends draft persistence while a step is open, and clears an earlier one | browser | Chromium, `localStorage`, durable `secret_requested` | **Equivalent** — asserts the behaviour, not a flag | **Replace** |
| 5 | `fail-closed` · refuses an unverified email | **No — not yet** | none | — | — | — | **Retain legacy** |
| 6 | `quarantine` · the two routes are different paths, neither reachable at the other | **Yes** | `two-origin.test.ts` · plane separation (3 tests) | browser + integration | Both services, both databases, both `__Host-` sessions | **Stronger** — they are now different SERVICES on different ORIGINS with different DATABASES, and the test proves each returns 404 for the other's routes and rejects the other's cookie | **Replace** |
| 7 | `end-to-end` · the automation spends a handle and the plaintext reaches the runner | **Yes** | `two-origin.test.ts` · spending a handle through the internal API (2 tests) | integration | Secure Service, `EnvelopeVault`, PostgreSQL, outbox | **Stronger** — proves single-use, the audit row, the re-checked binding, ADR-0025 fail-closed, and that the response cannot carry the value | **Replace** |

### Why #5 is retained rather than replaced

`refuses an unverified email, as every other AskiMate route does` is a property
of an identity system this repository does not have. ADR-0038 delegates identity
to a managed OIDC provider; the conversation plane's `/dev/session` is a test
seam and the secure plane's session is minted from a frame token. There is no
`email_verified` claim anywhere to check, so a replacement test would assert
something no code does.

It is not obsolete — a deployed AskiMate will need it — so the legacy test stays
and the property stays on this list until identity is implemented.

### One legacy behaviour deliberately NOT preserved

The provisional path CANCELLED the secure request when `decideRendering`
refused. The real path does not, and must not:

- cancellation requires a secure session, which requires the bootstrap, which
  is exactly what a refusing client has declined to fetch;
- the authoritative lifecycle belongs to the Secure Interaction Service, and a
  client that has just reported it cannot display a password box is not a client
  that should decide nobody will be asked for the password.

So the request stays open, **the composer stays blocked**, and the TTL settles
it. Recorded here because it is a real semantic change and the safer of the two.

## The composer's authoritative semantics

Derived from `composerPolicy`, `openSecretRequest` and the lifecycle authority —
not from the legacy tests.

| Question | Answer | Where it is decided |
| --- | --- | --- |
| Typing while a step is open | **Always live.** `ComposerPolicy.typing` is the literal `"live"`, so "disabled" is not a value the policy can return | `packages/conversation/src/composer.ts` |
| Sending while a step is open | **Blocked**, and the server refuses independently with a 409 | `composerPolicy` + the Conversation Service guard |
| An existing draft when the composer blocks | **Untouched.** Nothing clears it, nothing queues it | `ChatView.onSubmit` returns before reading the value |
| A blocked composer submitting a stale draft | **Impossible.** The handler returns before the value is read, so no bytes leave | same |
| Releasing the draft when the step finishes | **Never.** Releasing a buffer would transmit a password typed into the wrong box, with no human in the loop | there is no code that does it, and Q4 proves it |
| Draft persistence while a step is open | **Suspended, and an earlier draft is removed** — storage outlives the five-minute TTL | `ChatView` effect on `draftPersistence` |
| What UNBLOCKS the composer | **Only a durable event in the conversation log.** Secure Service → outbox → Conversation Service → log → SSE | `useSecureTurn`: the gate reads `openSecretRequest(log.durable)` |
| What a `postMessage` from the frame does | **Closes the card only.** It draws a provisional entry, which affects RENDERING and never the gate | `frameLifecycle` draws; the gate ignores provisional entries |
| A rejection | **Settles nothing.** The step stays open so the student can retry | `openSecretRequest` ignores `secret_rejected` |
| Two clients | **Converge**, because both read the same durable log | Q9 |

**This was a real defect, found by a deliberate regression.** The gate read the
MERGED view — durable plus provisional — so the browser that submitted reopened
its own composer on its own `postMessage`, before the Secure Service had
published anything. Nothing unsafe was ever accepted, because the server refused
with a 409; but the student saw a live composer for a step the log still held
open, and "provisional UI must never override server authority" is the rule. The
gate now reads the durable log only.

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

## The retirement decision, 2026-08-30

### Deleted

Seven `it` blocks from `apps/chat-integration/src/fail-closed.test.ts`, and
nothing else. Each was removed only after a deliberate regression proved its
replacement fails when the property is broken:

| Deleted legacy test | Replacement | Regression that proved detection |
| --- | --- | --- |
| refuses when the client does not support it | `two-origin` · refuses with `client_does_not_support_secure_control` | G7 — the refusal branch removed; the assertion names the missing code |
| refuses on an insecure origin | `two-origin` · refuses with `insecure_context` | G7 |
| refuses when the secure endpoint is unreachable | `two-origin` · refuses with `endpoint_unreachable` | G7 |
| keeps the composer LIVE for typing but blocks the send | `two-origin` Q2 + Q4; `conversation.test.ts` for `composerPolicy` itself | G1 — the blocked-send guard removed; the password appears in a request body |
| does NOT auto-send the draft when the step finishes | `two-origin` Q4, the release case | G2 — the buffer released on reopen; the draft appears in a request body |
| restores the draft when a STALE client is refused | `two-origin` Q4 + Q10 | G1, and Q10's severed-stream case |
| suspends draft persistence while a request is open | `two-origin` · suspends draft persistence, and clears an earlier one | G3 — the persistence guard removed; the draft appears in `localStorage` |

`fail-closed.test.ts` goes from 33 tests to 26.

### Retained, and why

- **`fail-closed.test.ts` (26 tests)** — one property has no replacement at all
  (`refuses an unverified email`), and the remainder were mapped to replacements
  in 0.16.0 without a per-test regression run in this session. The rule is a
  demonstrated failing replacement per deletion, so they stay until each has one.
- **`quarantine.test.ts`, `end-to-end.test.ts`, `continuity.test.ts`** — same
  reason.
- **The provisional app** (`chat-routes.ts`, `secret-routes.ts`, `bindings.ts`,
  `SecureControl.tsx`) — it is what those 26 tests drive.

### Still uncovered

**One property.** `refuses an unverified email, as every other AskiMate route
does` — ADR-0038's identity delegation is not implemented, so there is no
`email_verified` claim for any test to assert on. Not obsolete; deferred.

### The next deletion, when someone does it

For each remaining legacy test: name its replacement, break the property, watch
the replacement fail, restore, then delete that `it` block. The mapping above
already names most of the replacements; what is missing is the regression run.
