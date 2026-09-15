# ADR-0116 — A cancelled secure box is the student's stop: the run waits where it was until they carry on

**Status:** Accepted · 2026-09-15 · decides blocker 28 · continues 0053 (the student's stop is theirs), 0101 (the secure box) and 0114 (what a failed creation does; the loop this closes was found building it)
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-15. **Built in P138**, the same day; see *Built* below.

## Context

ADR-0114's build found a sibling of blocker 26: a secure box the student *cancels*.
`secret_cancelled` was read by the password step as "asked already" — only an expiry re-opened
the box — so `create_account` was handed out with no handle, refused `secret_unavailable` by
the runner, completed as no attempt, and handed out again on the next tick. The same loop for a
different lifecycle word, silent, because no password of theirs was involved. Raised as blocker
28 with three readings — a cancel re-opens the box as an expiry does; a cancel stops the run for
a person; a cancel is the student's stop — for his decision, not a reading to pick.

## Decision

In his words:

> *"Blocker 28: a cancel is the student's stop."*
>
> *"Not a reopen and not a person's problem. The student was shown a box and closed it. The only
> honest reading of that is that they do not want to do this now, and the system's answer should
> be to stop asking rather than to ask again in a different shape."*
>
> *"A reopen makes a cancel mean nothing, and a system where closing a box does not close it is
> one people learn to fight rather than use. Stopping for a person makes a student's ordinary
> decision into someone else's work, and a specialist reading 'the student closed the box' has
> nothing to do about it."*
>
> *"So: the run stops, the student is told plainly what stopped and that they can start it again
> when they want to, and nothing is offered to a runner until they do. The application is not
> abandoned — it waits where they left it."*
>
> *"Two things to get right in that."*
>
> *"The student must be able to restart without going back to the beginning. If cancelling means
> the case is dead, a cancel becomes an expensive mistake rather than an ordinary choice, and I
> would rather they closed the box than clicked through it."*
>
> *"And 'the student stopped' must be distinguishable in the record from 'the portal refused' and
> 'nobody was told'. Those three end in a stopped run and they are not the same thing, and a
> month later someone reading the case needs to know which it was."*

So:

1. **A cancelled box stops the run.** Nothing is asked again in another shape; nothing is offered
   to a runner; no person is asked to look. The case is not abandoned and the run is not ended.
2. **The student is told plainly** what stopped and how to carry on, once.
3. **They restart where they stopped**, not from the beginning: the same run, the same case, the
   same yes; a fresh box; nothing repeated.
4. **The record says which stop it was.** The student's stop has a status of its own; a portal's
   refusal is `escalated` with an intervention naming the attempt and the cause (ADR-0114); a stop
   nobody was told about is an intervention with no announcement — three different records for
   three different things.

## Consequences

- A seventh run status, `stopped_by_student`: not automatable (no worker tick, no runner claim),
  not held by a person (no intervention, no specialist queue), not terminal. Left for `running`
  when the student carries on, `abandoned` when they stop the case, and `escalated` when carrying
  on runs straight into something only a specialist can settle.
- The password step answers a cancelled request with the box again — but only when the run is
  asking, which after a cancel is only once the student has restarted.
- A cancel of the sign-in box on the resume path (ADR-0101 §3) is the same stop; the words are
  the same.

## Built — P138, 2026-09-15

Tests first, red: the domain's status machine, the orchestrator's step after a cancel, and the
driver on real Postgres — the stop, and the restart.

- **The status.** `WorkflowStatus` gains `stopped_by_student`; `isHeldByTheStudent` is the fourth
  set beside automatable, held by a person and terminal, and the partition test that refuses a
  status in none of them now counts four. The contract's `RUN_STATUSES` and the OpenAPI enum
  carry it.
- **The stop.** On its next tick the Run Driver reads the Secure Plane's `secret_cancelled` off
  the conversation log — the same lazy reading as an expiry — and, before any box would open,
  stops the run: one message (*"You closed the password box, so I have stopped there. Nothing has
  been sent … your application waits where you left it. Whenever you want to carry on, ask me to
  apply again and I will open the box once more."*), the status, the phase untouched. A stopped
  run re-derived by `advance` answers its stopped position and nothing else. `dueRuns` and the
  runners' pool both filter on the automatable statuses, so nothing automatic moves it.
- **The restart.** The student asks to apply again; `start` finds the run they stopped and carries
  it on as a restart: the decision opens a fresh box, and its checkpoint sets `running` in the
  same write, so no tick between the two reads the old cancel as a new one. The restart is the one
  decision that sees the cancelled request and goes on; the box it opens supersedes it in the
  log. Told after, and only when it carried on: *"Carrying on with your … application from where
  you left it. Nothing is repeated."* Closing the fresh box stops it again, in the same words.
- **The step.** `secretStepFor` answers a cancelled request with the box again, as it does an
  expired one. Until this it read "asked already" and moved on to `create_account` with nothing
  to spend — blocker 28's loop.
- **The demonstration client** shows the stop in its own words, not as a step to answer, and
  shows the choice of what to apply to again for a run the student stopped, with the heading
  saying it carries on where they left it; the same request restarts the same run.
- Not an intervention, by his word. The three records: `stopped_by_student`; `escalated` with an
  intervention whose text names the attempt and the cause; an intervention with `announced_at`
  null.
- Tests: the domain (one, the four sets and the transitions), the orchestrator (one), the driver
  on Postgres (two: the stop and the restart).
