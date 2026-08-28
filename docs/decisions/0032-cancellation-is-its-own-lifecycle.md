# ADR-0032 — Cancellation is its own lifecycle, not a kind of expiry

**Status:** **Accepted** — delegated technical authority, 2026-08-28
**Amends:** the Phase C/D decision to reuse `secret_expired` for a student-initiated cancellation

## What was decided before, and why it was reasonable

Phase C added `DELETE /askimate/secret/:requestId` and recorded the outcome as `secret_expired`, on
the reasoning that the lifecycle word already meant *"the TTL passed, OR the student abandoned it"*.
That was a sound call for a research build: no new state, no new closing rule, and the guard behaves
identically either way.

## Why it is wrong for production

The two are identical **only to the guard**. They differ to everyone else who reads the log:

| Reader | `secret_expired` | `secret_cancelled` |
|---|---|---|
| The model | "That timed out — shall I ask again?" | "No problem. Would you rather set it yourself on the portal?" |
| The student | Something failed | They made a choice, and it was honoured |
| Product analytics | A latency or attention problem | A trust or comprehension problem |
| An incident review | Possibly systemic | Definitely not |

Collapsing them destroys the distinction at the point of writing, which is the only point at which it
is still recoverable. A conversation-driven product whose model must decide what to say next cannot
afford to be told less than the system knows.

## The decision

`secret_cancelled` is a distinct terminal lifecycle, admitted by the same `CHECK` constraint as the
others and treated exactly like `secret_expired` by every guard.

```
secret_requested ──▶ secret_received ──▶ secret_consumed
       │  │
       │  ├──▶ secret_expired     (the TTL passed)
       │  └──▶ secret_cancelled   (the student abandoned it)
       └──▶ secret_rejected       (does NOT close — the request stays open)
```

## What does not change

- **A rejection still closes nothing.** A mistyped confirmation leaves the request open and the box on
  screen. Phase D removed the divergence where the client closed on a rejection while the server still
  held the request open; that fix stands.
- **Only a lifecycle transition closes a request.** A client cannot decide on its own that a step is
  over.
- Both terminal states release the composer identically. The guard treats "open" as
  `secret_requested`, unexpired — nothing else.
