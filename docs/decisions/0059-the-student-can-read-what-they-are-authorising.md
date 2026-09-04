# ADR-0059 — The student can read what they are authorising

**Status:** **Accepted** — 2026-09-04
**Completes:** [ADR-0049](./0049-the-run-driver-drives-the-case-machine.md) §5 — *"a student's
authorisation is a decision, not a sentence"*. The decision existed; the student had no way to read
what it was about.
**Depends on:** [ADR-0014](./0014-discovery-cannot-submit.md) (the capability ladder this sits on),
[ADR-0058](./0058-a-case-opens-from-an-offer-the-student-accepted.md) (the journey this sits in the
middle of), [ADR-0051](./0051-the-student-supplies-through-the-conversation.md) (a playback must be
reproducible from the data)

## The measurement that produced this ADR

The brief's rule — *"show exactly what will be submitted, and capture the authorisation"* — is
implemented as ADR-0049 §5: the student's approval is a decision recorded through the case machine,
carrying the content hash of what they saw. Measured at `4b22a99`, after P21 made the journey
startable:

| Fact | Evidence |
|---|---|
| The orchestrator renders the preview | `run.ts` returns `{ kind: "authorise", preview, presentedText: renderPreview(check.preview) }` |
| The driver can read it | `RunDriver.previewHashFor` — its own comment says *"a read, for a surface that has to render the preview and send the hash back"* |
| Its only callers are tests | `grep previewHashFor` → 4 hits in `run-driver.test.ts`, 1 definition |
| **No route publishes it** | the service's route list has no preview resource |
| **The stop is silent** | every other pause appends a message — `pauseMessage`, `resumeMessage`, `reviewMessage`, `action.say`, `handoffMessageOf`. The `authorise` stop appends nothing |
| The decision route needs a hash a client cannot get | `POST .../runs/{runId}/decision` requires `contentHash`; `journey.test.ts` obtains it by re-deriving the preview in-process with `checkUsable` + `planFill` + `buildPreview` |

That last row is the whole finding. **The only code in this repository that completes an
authorisation is a test that rebuilds the preview from the blueprint, the mapping set and the
student's plan** — three things a browser will never hold and must never be given. So the
authorisation gate was passable by the test suite and by nothing else.

P21 opened the front door. This is the gate behind it, and it had no handle.

## The decision

**The rendered preview is a resource the student's own surface fetches, live, at the moment they
read it — and it is never written down.**

```
GET /v1/conversations/{conversationId}/runs/{runId}/preview
    → 200 { contentHash, hashAlgorithm, presentedText }
```

`presentedText` and `contentHash` come off **one** `authorise` step, so what is rendered and what
is hashed cannot come from two different renderings. That property was already promised by
`previewHashFor`'s comment; this makes it structural by returning both from one read.

### Why it is fetched rather than appended to the conversation log

The obvious alternative is to append the rendered preview as an assistant message. It would reuse
the client's existing rendering and the log's existing ordering. It is refused, for three reasons
the code already states:

1. **`SubmissionPreview.toJSON()` throws.** Not decoration — the boundary. Its own message says the
   plaintext *"must never reach a log, an event, a trace, telemetry, a diagnostic dump or an audit
   record"*. A conversation event is an event, and `message_bodies` is a durable record. Appending
   it is precisely the act that boundary exists to prevent.
2. **A stored copy can go stale, and staleness here is silent.** The decision route compares the
   student's `contentHash` against the preview the orchestrator would render **now**. A message
   written yesterday would still be on screen after a correction changed the content — the student
   would read one thing and send a hash for it, and be refused with no way to see why. Fetching
   live makes reading and hashing one act, and a changed application produces a changed page rather
   than a stale one.
3. **It would add retention surface for nothing.** The preview is wholly derived from the confirmed
   profile and reviewed artefacts, both already stored. A second plaintext copy of the student's
   data would need its own redaction and its own retention answer — and retention is UNAPPROVED
   (0 of 10 document types).

So the preview stays a **projection**, computed on demand, `Cache-Control: no-store`, never
persisted, never logged.

### What the response deliberately does not carry

Not the `SubmissionPreview` object. The route calls `renderPreview` and returns text, because
serialising the object is the thing that throws — and a route that reached for the structured form
would either crash or have to defeat the guard. Text is also what the student authorises: the hash
is over the canonical content, and the sentence they read is the rendering of it.

### The stop is no longer silent

When the case first reaches `AWAITING_STUDENT_AUTHORISATION`, the driver appends one ordinary
assistant message saying the application is ready to approve. It carries **no preview content** —
it is a pointer, not a copy, so the reasons above are untouched.

Written off the single hop into that state, so it is written once. Every other pause in this system
announces itself; this one not announcing was an inconsistency, and the consequence was a student
sitting in front of a conversation that had gone quiet at the one moment it needed them.

### Why `previewHashFor` is replaced rather than joined

`previewFor` returns `{ contentHash, presentedText }`. Keeping the narrower method beside it would
mean two reads that recompute the same situation and could answer differently after a change
between them. It had no production callers, so replacing it costs nothing.

## What this does NOT change

- **Nothing is submitted.** The capability ladder of ADR-0014 is untouched — no session in this
  path has a `submit` — and the run still stops at `ready_to_submit`.
- **The hash comparison is unchanged.** `recordDecision` still re-renders and refuses a mismatch.
  This ADR gives the student a way to *obtain* the hash; it does not weaken what is done with it.
- **No model output becomes a consequential action.** The rendered preview is deterministic and
  model-free — `renderPreview` is a pure function of the preview — so what the student approves is
  reproducible from the data, exactly as ADR-0051 requires of a playback.
- **The React client is not built here.** It still cannot reach any run endpoint. That is the next
  phase, and it was impossible before this one: a UI cannot render a preview no route serves.

## Consequences

- **The journey is completable by an HTTP client for the first time.** `journey.test.ts` no longer
  re-derives the preview; it fetches the route, which is the proof that a browser could.
- **`packages/preparation` gains no new caller in the conversation service.** The route reads
  `presentedText` off the step the orchestrator already produced, so the rendering stays in one
  place and the plane boundary is unchanged.
- **One more surface holds student plaintext in a response.** It is authenticated, owner-checked,
  `no-store`, and its body is never logged — the same posture as every other route that carries
  confirmed profile values.
