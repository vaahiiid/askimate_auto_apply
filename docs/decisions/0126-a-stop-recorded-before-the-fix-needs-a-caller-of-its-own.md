# ADR-0126 — A stop recorded before the fix needs a caller of its own: the repair, scoped to `WINDING_DOWN` and refused everywhere else

**Status:** Accepted · 2026-09-18 · completes [ADR-0125](./0125-the-stop-finishes-its-own-job.md) for cases that stopped before it · found by Vahid pulling P158 and re-running the two calls
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-18. **Built in P159**, the same day.

## Context — the fix was right, and it arrived too late for his case

P158 gave the second act of a cancellation a second caller: `#cancel` performs it at the stop, so a
run a person is holding no longer has to wait for an advance that will never come. That is the right
fix and it works.

It does not reach a case whose stop is already in the past. Vahid pulled 412d001, restarted the
stack, refreshed the session, ran the same two calls, and got the same 403. In his words:

> *"So the fix does not reach the case that was already stuck at WINDING_DOWN when it landed. That
> makes sense if the fix changes what a new cancel does and nothing re-examines a case already
> half-cancelled. But it means every case that stopped before 412d001 stays stuck for ever, and one
> of them is mine."*

He is right, and the reason is exact rather than probable. A case sitting at `WINDING_DOWN` has no
caller left at all:

- the **Worker** advances `dueRuns`, which filters on `AUTOMATABLE_STATUSES` — `running` and
  `suspended`. An `escalated` run is not in that set, by ADR-0065's deliberate design;
- a **runner** is offered nothing: `claimWork` withholds every stopped case;
- the **student** cannot stop it a second time: `WINDING_DOWN` goes one place, and `decide` answers
  `refused` rather than appending a second stop.

Established here, not inferred: the reproduction builds a case stopped exactly the way `#cancel`
stopped one before 412d001 — the first act alone, straight through the domain — and then asserts all
three doors shut on it.

## The alternative he asked to be told about, and why it is not the answer

> *"or tell me the honest alternative is that this case is abandoned and I start yet another
> conversation. I would take the second if it is the truthful one; I am not looking for a fifth
> workaround."*

Abandoning it is truthful but not necessary, and it is not free: the case would stay at
`WINDING_DOWN` for ever, holding the student's ability to re-apply against that course, because the
one cause of `reapplication_refused` is an unconcluded prior case. A fresh conversation walks around
the record rather than finishing it, and this repository has spent three phases removing records
that assert more than what happened.

What is missing is a **caller**, not a design. So the decision is to supply the caller and nothing
else.

## Decision — the repair is the missing caller, and is scoped so it can be nothing more

`RunDriver.finishStoppedCase(conversationId)`, reached from
`scripts/local-stack.sh finish-stopped <conversationId>` through the service's own binary.

Three properties, and each of them is a refusal of something a repair tool is otherwise tempted to
do:

1. **It refuses any case that is not at `WINDING_DOWN`**, naming where the case actually is. The one
   state it acts on is the state the student's own stop put the case in, so it can never move a live
   application — asserted against a real running case, not a fixture shaped to be refused.
2. **It performs no transition of its own.** It runs the ordinary advance, which runs `#windDown`,
   which runs `#concludeCancellation`, which asks `decide`. The obligations guard therefore applies
   here exactly as it does everywhere else, and a case that still owes the student their portal
   account is **not** concluded by running this — it reports what is owed and leaves the case alone.
   That is Vahid's P158 condition holding on the repair as well as on the stop.
3. **It says which happened.** The result is a union, so `concluded: false` cannot be read as
   success by an operator skimming output — the same reasoning `StopConclusion` carries one level up.

It is idempotent: a case already `CANCELLED` is reported, not re-written, and nothing is appended.

## Why it lives in the service, not in a script of its own

A separate script would be a second composition root, and a second composition root is a second set
of rules about which catalogue a case is judged against — the class of drift ADR-0041 exists to
prevent. The repair is a subcommand of the binary that already owns the driver, beside `migrate`,
and `scripts/local-stack.sh` passes it the running service's own env file so it cannot be pointed at
a different database by accident.

It is dispatched **above** the identity-provider block, so a stopped case can be finished without an
OIDC provider being reachable. Nothing in the repair uses one.

## Consequences

- Every case stopped before 412d001 can be finished without abandoning it, through the same guard as
  every other path.
- The class is not strictly closed by P158, which is why the command stays in the repository rather
  than being a throwaway: a stop that lands with no blueprint on the binding cannot establish its
  obligations and so does not conclude, and a case that legitimately waits for a handover concludes
  on an advance that an `escalated` run will still never get. Both end at `WINDING_DOWN` with no
  caller, and both are what this command is for.
- The repair does not close the specialist's intervention (blocker 43, open). A case finished this
  way can still have a row in a person's queue describing work that will not happen.
- What this does NOT do is read a student's database on their behalf. The state of a particular case
  is a fact in the operator's Postgres, and the runbook gives the query rather than this repository
  guessing at the answer.
