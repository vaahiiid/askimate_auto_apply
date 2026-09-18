# ADR-0125 — The stop finishes its own job: a cancellation concludes at the stop when nothing is outstanding, and says plainly when it is not finished

**Status:** Accepted · 2026-09-18 · corrects the reachability of [ADR-0053](./0053-a-student-can-stop.md)'s second act · keeps [ADR-0065](./0065-a-run-only-a-person-can-carry-on-stops-and-says-so.md) whole · found by Vahid walking the failure path in Run A
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-18. **Built in P158**, the same day.

## Context — a stop that said it had stopped, and had not

ADR-0053 made a cancellation two acts, deliberately and for a good reason. The student's stop is
immediate and unguarded — *"a stop button with a precondition is not a stop button"* — so it enters
`WINDING_DOWN` at once. Concluding is guarded: `CANCELLED` is terminal, and a terminal case refuses
every intent except `instruct_reapplication`, so concluding while a portal account is still in our
hands would make `complete_handoff` permanently refusable and strand an account created in the
student's name on a real university's portal.

Both acts were right. Only one of them was reachable for every run.

The second act lived in `#windDown`, which runs **only on an advance**. The Worker advances runs
whose status is `running` or `suspended`; `uncertain` and `escalated` runs wait for a PERSON, by
design (ADR-0065). So a run a specialist was holding could be stopped and could never conclude. The
case sat in `WINDING_DOWN` for ever, while the message the stop had already sent told the student
*"I have stopped work on your application"* — a sentence about a case that was, in the system's own
record, still open.

Vahid hit this in Run A and it cost him a morning. He stopped an escalated run, was told it had
stopped, and then found the re-application refused with `reapplication_refused`, whose one cause is
an unconcluded prior case.

## The method, which is the part worth keeping

> *"Record that this was found by a person walking the failure path, that the first diagnosis was
> wrong, and that the corrected one came from changing one variable on the fixture. That method is
> the thing worth keeping."*

The first diagnosis was wrong. It blamed a missing write to `workflow_runs.status`, and it was
reasoned from reading the code rather than from running it. Four resume sequences were built on it
and all four failed on his machine: *"Four sequences that failed on my machine is the pattern to
break."*

The corrected diagnosis came from **changing one variable and reproducing**. The same two calls were
run against the signed fixture catalogue, with everything held constant except the prior case's
state, and the identical 409/200/403 appeared. That exonerated the ADR-0118 gate — Vahid's own
hypothesis, which he offered as a guess and asked to be tested rather than believed — and located
the defect precisely: not the guard, not the gate, not the run status, but the fact that the second
act of the cancellation had no reachable caller for that run.

A test written from a reading asserts what the reader believed. A test written from a reproduction
asserts what happened. The four sequences are what the first kind costs.

## Decision 1 — the stop performs both acts, and the escalation rule stays whole

> *"Option one. The stop finishes its own job. Your reasoning is mine: the escalation rule was
> deliberate and it should stay whole."*

The alternative — teaching the Worker to advance `escalated` runs so that `#windDown` would run —
would have bought a stop at the cost of ADR-0065: a run a person is holding would move without the
person. It was rejected for that reason and ADR-0065 is unchanged.

Instead the second act moved out of `#windDown` and into `#concludeCancellation`, which **both**
`#cancel` and `#windDown` call. The name is not new; `#cancel`'s own comment had promised it since
P15, and nothing had ever defined it. `WINDING_DOWN` is still always entered first, in the same
append as the cancellation, because the guard that protects the account is on the way *out* of it
and a one-act cancellation would skip it.

## Decision 2 — only when nothing is outstanding, and enforced rather than assumed

> *"One condition. When the cancel performs both transitions, it must do so only when nothing is
> outstanding — you said that and I want it enforced, not assumed."*

Taking "enforced" seriously found a second defect underneath the first.

The guard in `checkTransition` that refuses `WINDING_DOWN → CANCELLED` while an account is
outstanding reads `context.outstandingObligations`, and the comment beside it says it lives in the
machine *"rather than in the driver"* because *"this repository has already learned what happens to
rules that live in a caller"*. But `decide` — the only sanctioned way to move a case — built its
guard context from the case alone and **never supplied that field**. The guard could only ever be
reached by calling `checkTransition` directly, which only its own unit test did. The rule was in the
caller after all, and had been since P15.

So the obligations now travel on the transition intent, `decide` passes them to the guard, and the
field's absence at `CANCELLED` is a **refusal** rather than a pass:

- `obligations_outstanding` — the caller asked, and something is owed. Names what.
- `obligations_unknown` — nobody asked. A caller that has not established what a case owes has not
  established that it owes nothing, and only the second fact may conclude a cancellation.

Two kinds rather than one, because they are two different facts and a wrong label is worse than
none: folding the second into the first would have the system report an account it never looked for.

Every other transition ignores the field, absent or not, so no existing caller had to learn a new
argument.

## Decision 3 — the message says which, and never "stopped" for something unfinished

> *"If something is outstanding, the case winds down as it does now and the message says so:
> stopped, but not yet finished, because of what. A student should never read 'stopped' and later
> find it was not."*

The cancellation message now has a third input, and it is a union — `{ concluded: true }` or
`{ concluded: false, outstanding }` — not a list with a length check. A stop that found nothing owed
but was refused the transition for some other reason would, under a length check, be announced as
finished when it was not: the precise failure this phase exists to remove. This is the same reasoning
ADR-0053 §3 gave for making `StudentDecision` a union.

- Concluded: *"Nothing was submitted, and nothing is outstanding — this application is closed."*
- Not concluded: *"It is stopped, but it is not finished: the account at … is still in my hands, and
  I have to give you control of it before we are done. I will come back to you about that, and I
  will tell you when it is finished."*

The second sentence makes a promise, so the promise is kept: when the handover finally clears the
obligation and `#windDown` concludes, the student is told that it is finished. Before this phase
that conclusion happened silently, in a log no student can read.

The outstanding thing is **named, not enumerated**. Every member of the list comes from
`mayConcludeCase`, whose only source is the portal account, so one sentence in the student's terms is
the whole list — rather than `acct_… on portal.example.ac.uk is "created" and has not been handed
back`, which is a record, not a sentence. A second source of obligations would make that wording
untrue, and the note on `#outstandingObligations` says so at the other end.

## What this deliberately does not change

- **ADR-0065.** A run a person is holding still waits for the person. Nothing here advances it.
- **The two acts.** `WINDING_DOWN` is still entered first and always, and the guard on the way out
  is still the thing that protects an account created in a student's name.
- **The account sentence.** It still says the account *"was created in your name"* even when the
  student made it themselves and declared it (ADR-0110) — blocker 38, open and untouched here.
- **The open intervention.** A stop that concludes leaves a specialist's intervention open on a run
  whose case is now closed. Closing it would mean writing a resolution under a `specialistId` for an
  adjudication no specialist made, which is the class of record the integrity phases (ADR-0082 to
  ADR-0084) spent their time removing. Raised as blocker 43 and left for a decision.

## Consequences

- A stop concludes at the stop, whatever the run's status, when nothing is owed. The path that was
  unreachable for `escalated` and `uncertain` runs is reachable for every run.
- `decide` can no longer conclude a cancellation by omission. A caller that forgets to establish the
  obligations is refused by name.
- A student is never told an application has stopped when work on it is still outstanding, and is
  told when the last of it is done.
- Four resume sequences reasoned from reading failed on a real machine; the fix and its tests came
  from reproduction. The tests drive the stop the way a student does — one decision, no advance —
  because the advance is what hid the defect.
