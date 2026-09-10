# ADR-0100 — The page decides whether it can show the secure step before it asks for the capability

**Status:** **Accepted** — 2026-09-10
**Continues:** [ADR-0086](./0086-the-research-build-is-removed-and-what-it-proved-is-kept.md), closing the
two properties it left open. **Applies** [ADR-0030](./0030-the-secure-control-runs-on-its-own-origin.md)
and [ADR-0033](./0033-the-secure-frame-bootstrap-and-postmessage-protocol.md); **amends** ADR-0086's
section *"What is deliberately NOT carried across"*.

## Context

ADR-0086 retired the research build and named two of its properties that could not move with a file,
because they need a real browser **and** a real secure frame:

- *"keeps the password out of every postMessage that crosses the boundary"*
- *"NEVER fetches a bootstrap capability it cannot use"*

It recorded them as a phase. This is that phase, and building it found three things the record did
not know.

**The production page framed a path the Secure Plane does not serve.** Since P25 (`ba132cf`) the
student page set the frame's `src` to `/v1/secret-requests/{requestId}/control`. The Secure
Interaction Service serves the control document at `/control/{requestId}` — the path
`secure.v1.yaml` publishes and the header of `packages/contracts/src/frame.ts` describes. The
contract-drift guard (ADR-0063) compares the document against the service's router, and the page is
not a router, so nothing compared the two. The frame answered 404 on the production path from P25 to
P67 — forty-two phases — and the journey that would have noticed typed the password by `fetch`,
exactly the fetch-shaped stand-in ADR-0086 said was not the client.

**`decideRendering` had no caller on the production path.** It is one of the six conversation
decisions `check-boundaries.ts` allows exactly one implementation of, it was written for this
architecture, and the page went straight to `bootstrapSecureStep`. So a page on an insecure origin,
or one that could not reach the secure plane, minted a one-time frame token for a frame it would
never mount — the second property, failing quietly.

**One of the three capabilities could not be observed before the mint.** `endpointReachable` needs
the secure origin, and the only route that told the page the origin was the bootstrap — the mint
itself. A decision made before the fetch would have had to *claim* reachability, which is a record
asserting more than what happened.

## Decision

### 1. The decision comes before the mint, over what the page can observe

`mountSecureFrame` consults `decideRendering` **before** `bootstrapSecureStep`. Each capability is
observed rather than claimed:

| Capability | What the page reports | Why it is true |
| --- | --- | --- |
| `supportsSecureControl` | `true` | This build is the one that contains `mountSecureFrame` and speaks frame protocol v1. It cannot be false of the code that is running |
| `secureContext` | `window.isSecureContext` | The browser's own word |
| `endpointReachable` | a probe of the secure origin | See §2. A network failure is the only "no" |

The step's channel and expiry come from `durableSecretRequest` over the events the server returned —
never from anything the page drew for itself. `now` is the one clock the page reads, handed to
`start` by the bundle's entry point, and it is read for this decision alone.

### 2. A read that names the secure origin and mints nothing

`GET /v1/secure-origin` answers `{ secureOrigin }` on a student's session, or 503 when the deployment
has no secure plane. It carries no capability and stores nothing. The page then probes
`${secureOrigin}/healthz` with `mode: "no-cors"`, `credentials: "omit"` and `cache: "no-store"`: the
answer is opaque — the page learns that the request completed and nothing else, which is exactly the
question. This is the second absolute URL the page fetches, beside the bucket PUT (ADR-0092), and the
transport's header says so.

### 3. A refusal is a code and a fixed sentence, and it cancels nothing

A refusal is rendered as `<p id="secure-refusal" data-reason="…">` carrying `refusalText(reason)`
from `packages/conversation`, chosen from a table and never assembled. No frame is mounted, so no
password box exists anywhere on the page, and the composer stays shut because the log still shows
the step open. The page holds nothing that could cancel the request and should not: a client that
cannot show a password box is not the one to decide nobody will be asked for the password. The TTL
settles it.

### 4. The frame's path is the contract's

`secureControlPath(requestId)` lives in `packages/contracts/src/frame.ts`, beside the protocol it is
step 2 of. The page calls it; `scripts/contract-drift.test.ts` holds it to `secure.v1.yaml` — rendered
for a request id it must match exactly one published GET with the id in the `{requestId}` slot, and
the id must stay one path segment. A path the page writes for itself is what this replaces.

### 5. The journey types the password into the real frame

`scripts/journey.test.ts` now builds the student page and the secure control from the tree, serves
them from their planes, and opens the student's own browser context on the page. The secure step is
taken the way a student takes it: the frame mounts from the secure origin, the password is typed into
it, the Secure Plane's outbox delivers `secret_received` to the conversation log through
`internalAppend` — the same deliverer `background.ts` runs — and the page learns the step is settled
from the log, not from the frame. Every request the browser makes, from the page and from the frame,
is recorded on the same `wire` as the service-to-service calls, so *"put the password on exactly ONE
wire"* now sees the browser's wires too.

The two properties are rebuilt inside that step, on the real request:

- *REFUSES to open the password box on an insecure page, and mints NOTHING* — `isSecureContext` is
  overridden before any page script runs; the refusal shows with its code and its fixed sentence; no
  frame, no `type="password"`, the composer shut; no bootstrap request left the browser and the Secure
  Plane's `frame_tokens` count for the request is unchanged.
- *takes the student's password through the REAL frame, and no postMessage carries it* — every
  message the page receives is captured in a capture-phase listener installed before load; the list
  carries `ready`, `secret_received` and the request id, and not the password.

`endpoint_unreachable` is covered where it occurs naturally: `student-client.test.ts` names a secure
origin nothing listens on, and its secure-step test now asserts the refusal with that code and no
frame. `client_does_not_support_secure_control` cannot be produced by this build and is covered by
`decideRendering`'s own tests.

## Consequences

- The secure step works on the production path. It did not before this phase, and no test said so.
- A page that cannot show the step mints nothing, and says so in a sentence a student can act on.
- `decideRendering` has a production caller, and the six-decision rule now guards a function that
  is reached.
- One more published route on the conversation plane, and one more cross-origin request from the
  page — both content-free.
- `docs/harness-coverage-mapping.md` is a 0.17.0 record and names `two-origin.test.ts` for rows 1a–1c
  and R2; it is left as the record of that version. This ADR is where those rows are now honoured.

## What was built

- `apps/conversation-service/src/client/journey.ts` — the decision before the mint; the refusal
  element; the clock handed to `start`; the frame's path from the contract
- `apps/conversation-service/src/client/transport.ts` — `readSecureOrigin`, `probeSecureOrigin`
- `apps/conversation-service/src/routes.ts` — `GET /v1/secure-origin`; published in
  `conversation.v1.yaml`
- `packages/contracts/src/frame.ts` — `secureControlPath`; the drift guard's assertion over it
- `scripts/journey.test.ts` — the real page, the real control, the real frame, the real outbox; the
  two properties; `typeThePassword` by `fetch` removed
- `apps/conversation-service/src/student-client.test.ts` — the `endpoint_unreachable` refusal on
  the real path

## What was not built

- A `client_does_not_support_secure_control` browser case. This build cannot report it, and a test
  that forced the constant would be testing the override.
- Cancellation from a refusing page. Deliberately — §3.
