# ADR-0061 — The run says what it is waiting for

**Status:** **Accepted** — 2026-09-04
**Completes:** [ADR-0060](./0060-the-conversation-service-owns-the-student-surface.md) — the read it
added told a client *where* the run stood, and not *what to do about it*
**Depends on:** [ADR-0049](./0049-the-run-driver-drives-the-case-machine.md) §5 (the decisions),
[ADR-0050](./0050-the-account-lifecycle-completes-through-the-students-own-decision.md) (the
handover confirmation), [ADR-0051](./0051-the-student-supplies-through-the-conversation.md) (the
playback a reading is confirmed against), [ADR-0059](./0059-the-student-can-read-what-they-are-authorising.md)

## The measurement that produced this ADR

P23 made the journey readable. Working through what a client would actually do at each state
found one decision it **could not form at all**.

Three of the four student decisions carry the hash of what the student was looking at:

| Decision | The hash the route compares against | Could a client obtain it? |
|---|---|---|
| `confirm_value` | the open proposal's `playbackHash` | yes — it is on the `value_proposed` event |
| `authorise` | `step.preview.contentHash` | yes, since ADR-0059 — the preview route serves it |
| `confirm_handoff` | `hashOfText(handoffMessageOf(step))` | **no** |
| `cancel` | none (ADR-0053) | n/a |

`confirm_handoff`'s hash is over a message the **orchestrator renders**, not over anything in the
conversation log. A client could only produce it by re-implementing `handoffMessageOf` — a
`packages/orchestrator` function — and `hashOfText`, and then being right about which message in the
transcript it applied to.

And `RunDriver.handoffHashFor` already existed, **public**, saying in its own comment:

> *"Public because the client needs the same number to send back, and it must come from the SERVICE:
> a client that computed its own would be hashing whatever it decided to display."*

One caller: a test. No route. This is the third time the same shape has been found — `previewHashFor`
in P22, `previewFor`'s ancestor before it — a method written for a surface that did not exist yet,
which then never got one.

`journey.test.ts` was hashing the last message in the conversation. That worked and **would not work
in a client**: "the last message" stopped being the handoff message the moment ADR-0059 made the
authorisation announcement an assistant message too.

## The decision

**`GET /v1/conversations/{id}/runs` says what the run is waiting for, and the hash that decision must
carry.**

```
200 { run: ConversationRun | null,
      pending: { decision, contentHash } | null }
```

`decision` is one of `confirm_value`, `authorise`, `confirm_handoff` — the three that are
*prompted*. `pending` is `null` when the run is working and nothing is being asked.

### Every hash comes from the source the validator uses

This is the whole design, and the reason it is one read rather than three routes:

| `decision` | Source | The validator that compares against it |
|---|---|---|
| `confirm_value` | `openProposal(log).playbackHash` | `#confirmValue` |
| `authorise` | `step.preview.contentHash` | `#authorisationIntent` |
| `confirm_handoff` | `hashOfText(handoffMessageOf(step))` | `#handoffIntent` |

The handoff is published under **both** of `#handoffIntent`'s conditions — the case holds an open
handoff token **and** the step is asking for one. `handoffHashFor` checked only the second.

**Measured honestly: that omission is currently unreachable.** Deleting the token check from the new
read broke no test, and probing the state directly showed why — completing the handoff in the case
log moves the step straight past `student_handoff` without the run being advanced, because the
account's handoff stage is *derived* from `HandoffCompleted` rather than remembered. The token and
the step move together.

The check is kept regardless, and the reason is not defensiveness. **This read has to agree with the
validator by construction, not by the coincidence that two things happen to move together today.**
A step that ever became sticky — cached on a checkpoint, say — would separate them, and the symptom
would be a client offered a decision the route immediately refuses `not_asked`. An unreachable
branch that mirrors a validator is cheaper than a read that is right by luck.

The position and the pending decision are computed from **one** `#situation`. Two would be two
derivations able to disagree between the calls.

### Why `cancel` is deliberately absent

ADR-0053 makes a stop available at every step and it carries no hash: *"a stop button that only
worked at certain steps would not be one."* So it is not something a run *waits* for. A client
offers it always, because the architecture says so — not because a read mentioned it.

### What this does not do

It does not tell the client what to *render*. `pending` names a decision and a hash; the words the
student reads are the conversation's messages and, for an authorisation, the preview route's
`presentedText`. A read that also carried prose would be a second place the student's screen came
from.

It does not make the read consequential. `runFor` still writes nothing — no checkpoint, no hop, no
event, no announcement — and the pending computation adds only reads.

It does not weaken any gate. The decision route validates exactly as before, against freshly
computed state. `pending` is an *offer to the client of what will be accepted*, and a client that
sends something else is refused by the same code as always.

## Consequences

- **A client can now form every student decision without computing a hash.** That was the last
  interaction the published API could not represent, and it was found by reconstructing the journey
  rather than by writing a screen and discovering it.
- **`handoffHashFor` is removed.** Its one caller was a test, and keeping a second derivation beside
  the read would be exactly the drift this ADR closes.
- **`journey.test.ts` stops hashing anything.** It reads what the run is waiting for and sends that,
  which is what a browser will do.
- **The client work is unblocked.** With ADR-0060's reads and this, a client can reconstruct its
  whole view from the server and act only through structured decisions.
