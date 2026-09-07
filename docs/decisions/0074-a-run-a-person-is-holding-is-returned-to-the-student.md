# ADR-0074 — A run a person is holding is returned to the student, never restarted

**Status:** **Accepted** — approved by Vahid, 2026-09-07
**Completes:** [ADR-0048](./0048-recovery-interventions-and-the-specialist-plane.md) ·
[ADR-0065](./0065-a-run-only-a-person-can-carry-on-stops-and-says-so.md) — the stop was built; the
return was not

## Context

P29 made a run that only a person can carry on stop and say so. P36 made that stop reach a
specialist. Neither answered the question the student asks next: **they come back.**

They come back to a 500. `RunDriver.start` looked for a run in `running` or `suspended` before
deciding whether to resume; an escalated run is neither, so it fell through to `startRun`, which
refused a run id that already existed and threw `RunAlreadyExistsError`. The route turned that into
an internal error.

The student had been told, in their own conversation, at the moment it stopped:

> I have stopped and asked a person to check it. Nothing you have given me is lost, and you do not
> need to do anything — I will tell you as soon as it moves again.

Vahid, 2026-09-07:

> When a specialist reviews a case, there is no handoff to a separate conversation or a different
> person. The student stays where they were. Throwing on `start` is the opposite of that promise.

## Decision

**A run a person is holding is returned to the student in the state it is in.** The student stays in
the same conversation; nothing is created; nothing is decided on their behalf.

1. **`start` returns it.** `#heldPosition` answers from the durable record: the run's own id, its
   status, its checkpoint's phase, and `step: "specialist"`. `resumed: true`, always — nothing was
   created, they came back to something already theirs.

2. **The orchestrator is not asked.** It answers *"what should this run do next"* from the profile,
   the plan and the case, and none of those is why the run stopped — so its answer would name a step
   the run is not going to take. Re-deriving would also write a checkpoint for a run whose next move
   belongs to somebody else. `runFor` makes the same substitution, so the read and the start cannot
   disagree about a student's own application.

3. **Their questions still land.** The message route consults no run: it appends, then offers the
   message to the interview, which is not running. Asserted rather than assumed, because a guard
   placed one layer too high would silently take it away.

4. **Advancing is refused with a stated reason.** `authorise` and `confirm_handoff` — the two
   decisions that move an application — now reach the student as **409 `specialist_reviewing`**
   instead of a 404. A 404 tells them their application does not exist, for a state that clears
   itself.

5. **Stopping is never refused.** `cancel` returns before that refusal is reached. ADR-0053: *"a
   stop button that only worked at certain steps would not be one"* — and a student who wants out
   while somebody is looking at their case is exactly who a stop button is for. `confirm_value` is
   not refused either: answering a question about their own details is not advancing an application.

### `isHeldByAPerson`, and why it is a predicate

`uncertain` and `escalated` are the two statuses a run enters when it stops for a person. The
question *"is a person holding this?"* was being asked in four places in three spellings — two SQL
`IN` lists, a `status === "running" || status === "suspended"` in `start`, and a comment. The
spelling that mattered was **the one that was missing**, which is how this defect existed at all.

The three sets — automatable, held by a person, terminal — now partition `WorkflowStatus`, and a
test asserts the partition rather than three memberships, so a seventh status cannot land in none of
them. `WorkLeaseStore` builds its `IN (…)` from `AUTOMATABLE_STATUSES` rather than a literal.

## What this deliberately does NOT do

**It does not add a guard to `advance`.** One was written first and it failed five tests that
re-advance a stopped run on purpose — which is how "the pause is idempotent" is proved
(`idempotencyKeyFor` raises nothing new, `announcedAt` announces nothing new) and how the interview's
attempt limit is proved durable. Re-deriving a held run is already a no-op that re-stops it, and the
rule that nothing automatic *picks one up* lives where the picking happens.

The measurement is recorded in the code rather than the conclusion alone, because the next person to
reach for that guard should see what it costs.

**It does not move the mandatory-review refusal.** A run stopped for a financial-evidence or minor
review is `escalated` too, and `recordDecision`'s domain refusal is reachable in exactly that case —
P11's regression pass found that swallowing it changed nothing precisely because nothing else reached
it. A guard placed before `decide` would take that coverage back and make this coordinator the thing
that refuses a mandatory-review approval. It is not, and must not become it.

So the classification happens **after** the domain has refused. `decide` still decides; `#refusal`
only chooses the name the caller gets, when the true and useful thing to say is "a person is looking
at this". A regression that swallows the domain's refusal still fails.

**It does not change the terminal rules.** `escalated` was never terminal — `escalated → running` is
an allowed move and is what `resolveIntervention` performs. That is the whole reason the promise
"I will tell you as soon as it moves again" can be kept.

## Consequences

- A student whose application stopped for a specialist can reload, ask a question, and be told
  truthfully what is happening — where before the first of those was a 500.
- `specialist_reviewing` joins the closed problem vocabulary at 409, carrying no extension members:
  *why* a person is looking is a matter for the intervention record and the specialist, and ADR-0071
  already decided that detail does not travel to where it is not needed.
- Five deliberate regressions, all caught: `start` falling through again fails 2; the refusal going
  back to a bare reason fails 2; refusing a cancellation while held fails 1; swallowing the domain's
  refusal fails 1; putting `escalated` into `AUTOMATABLE_STATUSES` fails 4, across the partition
  test, the worker queue and both new refusals.
- The declared-but-unreachable surface is **unchanged at six**. This phase added no capability that
  waits on anything.
