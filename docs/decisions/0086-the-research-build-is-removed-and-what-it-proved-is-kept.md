# ADR-0086 — The research build is removed, and what it proved is kept

**Status:** **Accepted** — decided by Vahid Mohammadi, 2026-09-08
**Retires:** `apps/chat-integration`, built across P26–P36 against the archived AskiMate codebase

## The decision

> **Remove it.** Its value was evidence that the secure channel works on AskiMate's real stack shape,
> and that evidence is recorded in the ADR trail. Keeping the code costs a quarter of the serialised
> lane and an intermittent red, and produces no new evidence. Record in the ADR what it demonstrated
> and when, so removing the code does not remove the finding.
>
> — Vahid, 2026-09-08

## What it demonstrated, and when

`apps/chat-integration` was a React client and Express shim built against the AskiMate codebase as it
stood in late June 2026 — ten weeks stale by the time it was removed. It was never a deployable
(ADR-0037's five are unchanged) and was never the production integration, which is still blocked on
access to the live source.

| when | what it established |
|---|---|
| **P26** | A React client drives the **real** Conversation Service — not a stub — over the published contract |
| **P27** | Two browsers on one conversation converge: the multi-client proof SSE was chosen for (ADR-0035) |
| **P32** | The secure step mounts as a **cross-origin iframe** in a real browser, and the handshake completes |
| **P33** | The two-origin credential journey end to end, with fourteen security regressions, in a real Chromium |
| **P34** | `decideRendering` wired into the real cross-origin path rather than asserted in isolation |
| **P35** | The composer and draft semantics, Q1–Q10, answered against the real architecture |
| **P36** | Plane separation, and an automation handle spent through the internal API |

**It also produced one measured finding that changed production code:** `err.body` — an error shape
the client depended on that the service did not send. That is recorded where it belongs, in the
decisions that acted on it.

**The evidence stands. The code was not producing more of it.** Ten weeks after the codebase it
mirrors moved on, a passing run said only that the research build still agreed with itself.

## What was NOT allowed to go with it

The removal was checked before it was made, and it was not clean. **Four properties asserted in
`two-origin.test.ts` were about the two DEPLOYABLES**, not about the research build — it imported
`createConversationApp` and `createSecureApp` and made assertions about them:

- the Conversation Service has **no route that accepts a secret**, and a `secret` field smuggled into
  a message body reaches no text-ish column of the whole plane;
- the Secure Service has **no route that accepts an ordinary message**;
- the two `__Host-` session cookies are **not interchangeable** across the planes;
- a client that **POSTs directly while a secure step is open** is refused, and nothing is stored.

An ADR recording *"we demonstrated this once"* is not a check that fails the day it stops being true,
and that difference is this repository's method (ADR-0072, ADR-0073). So they moved to
`scripts/plane-separation.test.ts`, which boots both real services, launches **no browser**, and runs
in four seconds. Two deliberate regressions against production code prove they still bite: removing
the open-secret-request guard in `routes.ts` fails the fourth by name; giving the Conversation Service
a `/v1/frame-sessions` route fails the first.

## What the removal found

**The production client's `postMessage` had no wildcard-origin rule over it.** `check-boundaries.ts`
forbids `postMessage(x, "*")` in a named list of files, and that list held the secure service's
control client and the **research build's** `SecureFrame.tsx`. `apps/conversation-service/src/client/
journey.ts` — which mounts the real frame and posts the real handshake in the deployed service — was
never in it. The one `postMessage` a student's browser actually makes was unchecked, and only taking
the research build away surfaced it. The list now names `journey.ts`.

Three boundary rules that read only research-build files were **deleted rather than left dormant**.
Each was wrapped in `if (existsSync(…))`, so removing the app would have silently turned them into
rules that check nothing — a guard that cannot run is worse than none, because it appears in the list
as coverage (ADR-0085 §2).

## What is deliberately NOT carried across

Two `two-origin.test.ts` properties need a real browser **and** a real secure frame:

- *"keeps the password out of every postMessage that crosses the boundary"*
- *"NEVER fetches a bootstrap capability it cannot use"*

Both are about the **client's** behaviour, and the client they were written for is the one being
removed. The production client is a different implementation of the same design, so the assertions do
not transfer by moving a file. Rebuilding them against `journey.ts` needs a two-origin browser
harness that does not exist — `student-client.test.ts` configures a `secureOrigin` with nothing
listening on it. **That is a phase, and it is recorded as an open one rather than pretended away.**

## Consequences

- Four of the seventeen files in the serialised browser lane are gone — **a quarter of it** (ADR-0081).
- The intermittent SSE reconnect failure recorded as open in P52 lived in this app. It goes with it,
  and the two fixes made while chasing it — observations attributed by conversation rather than by
  array index, and an assertion asking for the first connection rather than the last — were committed
  in `ca5345d` and are removed with the file they were in. **The cause was never established**, and
  nothing here claims it was.
- The declared-but-unreachable surface is **unchanged at seven**: `apps/chat-integration` was listed
  in the standing account's table B, which the register does not track, not in the register itself.
