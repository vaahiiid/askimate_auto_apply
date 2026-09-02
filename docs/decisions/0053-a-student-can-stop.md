# ADR-0053 — A student can stop

**Status:** **Accepted** — Vahid, 2026-09-02, settling all four decisions. ·
**Completes:** the symmetry [ADR-0032](./0032-cancellation-is-its-own-lifecycle.md) established for
one secure step, at the level of the case ·
**Constrained by:** [ADR-0050](./0050-the-account-lifecycle-completes-through-the-students-own-decision.md)
(handover is non-optional), [ADR-0020](./0020-the-account-belongs-to-the-student.md) ·
**Related:** ADR-0006, ADR-0008, ADR-0014, ADR-0022, ADR-0041, ADR-0048, ADR-0052

## Context — measured on `9a5e197`

**A student can start an application. They cannot stop one.**

| Mechanism | State | Reachable? |
|---|---|---|
| `CaseCancelled` — `packages/domain/src/events.ts:329` | defined, folded by `machine.ts:264` | **no producer** |
| `CANCELLED` — a terminal state, permitted from almost every state by `ALLOWED_TRANSITIONS` | defined | **unreachable**: not on `CASE_SPINE`, and `nextCaseHop` is the only thing issuing `transition` |
| `void_authorisation` reason `student_revoked` | defined | **never issued** — production issues `content_changed` only, 19 sites |
| Run status `abandoned` | defined | reachable **only** by a specialist adjudicating a *stuck* run (`run-driver.ts:2111`) |
| A student-facing stop route | — | **does not exist**: the six `/v1/…` routes are events, messages, runs, decision, secure-request bootstrap, stream |

The asymmetry is sharpest at the secure step. ADR-0032 gave the student a way to cancel **one
password prompt**, and it is fully implemented and reachable (`routes.ts:305`,
`settle(…, "secret_cancelled")`). Its reasoning is worth re-reading, because it is this ADR's
reasoning one level up:

> *"The two are identical only to the guard. They differ to everyone else who reads the log … A
> conversation-driven product whose model must decide what to say next cannot afford to be told less
> than the system knows."*

**A student may cancel the password prompt. They may not cancel the application it was for.**

### Why this is urgent NOW, and was not before P14

Until P14 the client was the scheduler. `#decide` was reachable from `start` and `advance`, `advance`
had no route, and the only production trigger was the student's browser re-POSTing `/runs`. **Closing
the tab was a de facto stop.** It was never designed as one, nothing recorded it, and the student was
told nothing — but the system did stop acting.

P14 removed that, deliberately and correctly (ADR-0052 §8: *"closing the browser must never prevent
the system from progressing"*). The Background Worker now advances every eligible run on its own
clock. The implicit stop is gone and **nothing replaced it.**

This also sits directly against product rule 1, which this repository makes structural rather than
aspirational — `CaseOpened.requestEvidence` is required so that *"a case cannot exist without evidence
that a student asked for it"* (`events.ts:68`): **explicit request before consequential action;
silence is not consent.** P14 made the system act on silence. The rule is enforced at the beginning of
a case and nowhere else.

### What the system does autonomously, precisely

Being exact matters, because overstating this would be its own kind of dishonesty. Of the ten
`RunStep` kinds, five are gated on a student action — `interview`, `request_secret`, `authorise`,
`student_handoff`, `hand_over_account`. `create_account` is gated behind `request_secret`, so it
cannot happen without the student typing a password.

**`execute` is not gated.** After the student authorises, filling their data into a real university
portal — page after page — needs no further student act. Today that still waits on a runner polling,
and `runOneTurn` has no loop, so the window is not yet fully open in this repository.

**That is the ordering argument.** The runner supervisor is the obvious next piece of plumbing, and
building it before this one would open a window of autonomous consequential action with no way to
close it. Cancellation should come first, not because it is harder, but because the other order is
the wrong one.

## The trap: cancellation is not a transition

The naive implementation — issue `{ kind: "transition", to: "CANCELLED" }` — is wrong, and wrong in a
way that would pass its own tests and silently defeat an accepted decision.

`decide` refuses **every** intent on a terminal case except `instruct_reapplication`
(`machine.ts:362`), and `CANCELLED` is terminal (`state.ts:118`). So the moment a case is cancelled:

- `complete_handoff` is refused → **the account can never be handed back**;
- `void_authorisation` is refused;
- nothing further can be recorded about the case at all.

ADR-0050 exists to make handover **non-optional**. A cancellation that strands the student's account —
an account created in their name, on a real portal, whose credential this system may hold — would
defeat the rule that phase was built to enforce, while reporting success.

**Cancelling must stop new work without abandoning the student's account.** That is the constraint, and
it is what makes this an architectural decision rather than a route.

## What cancellation cannot do, and must never imply

Stated first, because a cancellation that over-promises is worse than none:

- **It cannot un-create a portal account.** The account exists in the student's name at the
  university. ADR-0020 says it is theirs; it stays theirs.
- **It cannot un-fill a page.** Data already written to the portal is in the portal. The intent ledger
  records what was saved; nothing here reaches back through a browser to undo it.
- **It is not erasure.** "Stop working on this" and "delete my data" are different requests with
  different lawful bases. Erasure is bound up with the retention schedule, which is externally blocked
  (0 policies, 12 unresolved, UNAPPROVED) and must not be quietly conflated with a stop button.

What a student is told when they cancel must therefore be true about all three. Getting that message
right is part of this phase, not a detail after it.

## The decisions, as settled

### §1 · The shape — wind down, then conclude (**decision 1: option A**)

**Settled by Vahid, 2026-09-02.** A student must be able to stop *immediately*, and cancellation must
not bypass ADR-0050's non-optional handover. So cancelling is two acts separated in time:

```
  any non-terminal state ──cancel_case──▶ WINDING_DOWN ──(obligations clear)──▶ CANCELLED
                                              │
                                              └── no return edge. Ever.
```

**`WINDING_DOWN` is a new, explicit case state.** Vahid: *"Do not silently overload an existing state
if it would make the lifecycle ambiguous."* The tempting reuse is `AWAITING_HANDOFF`, and it would be
exactly that ambiguity — that state means *"a healthy case is waiting on its account handover"*, and a
reader could no longer tell it from *"the student stopped and we are finishing our obligations"*.
Those call for different messages, different urgency and different analytics, which is ADR-0032's
argument for `secret_cancelled` one level up.

**What `WINDING_DOWN` means, exactly:** no further consequential work will be started; the obligations
already owed to the student — today, the account handover — are still being met.

- **Entering it is never refused.** Every non-terminal state may transition to it, with no guard. A
  stop button with a precondition is not a stop button.
- **Leaving it goes one place only.** `WINDING_DOWN → CANCELLED`, and that transition IS guarded:
  refused while any obligation is outstanding.
- **There is no way back.** A student who changes their mind re-applies, which ADR-0006 already
  models as `instruct_reapplication` on a concluded case — the one intent a terminal case admits.

**`CANCELLED` becomes the first terminal state this system can actually reach.** ADR-0050 §7 declined
to make one reachable, on the grounds that `CONFIRMED` means the portal confirmed a submission and
submission is out of scope. That reasoning does not apply here: `CANCELLED` means the student stopped,
which is a fact this system holds entirely and can state truthfully.

**How the guard learns whether obligations are outstanding.** `GuardContext` gains one field,
`outstandingObligations`, supplied by the run driver from `mayConcludeCase` — the same shape
`authorisedContentHash` already has: a fact the driver establishes and the domain guards on. The
account stage is *derived* from the case log and the intent ledger (ADR-0050) and cannot be computed
from the case alone, so the domain cannot fetch it. Putting the check only in the driver was the
alternative and is weaker: it would make "a cancelled case cannot conclude while it owes the student
an account" a rule one caller remembers rather than one the machine enforces.

### §2 · Cancelling voids the authorisation (**decision 2**)

**Settled.** `AuthorisationVoided` with reason **`student_revoked`** — which gives that declared,
never-issued reason its first writer, and makes it the authoritative reason for a void on
cancellation.

One detail worth stating because it is easy to get wrong: `cancel_case` emits the void **without** the
return transition that `void_authorisation` emits. Voiding on a healthy case moves it back to
`AWAITING_STUDENT_AUTHORISATION` so the student can be asked again (ADR-0051 §7); voiding on a
cancellation must not, because there is nothing to ask. One decided act, three events, and the
transition in it goes to `WINDING_DOWN`.

### §3 · Who may cancel (**decision 3**)

**The student, through the existing `StudentDecision` mechanism.** No separate cancellation surface —
one new member on the closed set, which is what ADR-0041 exists to keep true and what
`confirm_handoff` and `confirm_value` each cost before it.

**`cancel` carries no content hash, and that is deliberate.** Every other member does, because each is
agreement to something the student was *shown* and the hash binds which thing. A stop is not agreement
to content; it is a refusal of all of it. Requiring a hash would mean a student could only stop
immediately after the system had spoken — a stop button that works only when the system is talking is
not a stop button. `StudentDecision` therefore becomes a discriminated union rather than gaining an
optional field, so a `cancel` carrying a meaningless hash and a `confirm_value` missing a meaningful
one are both unrepresentable.

**Specialist cancellation on a student's behalf: refused, and the existing authority already decides
it.** Vahid asked whether existing mechanisms determine this. They do, and the answer is no:

> ADR-0048 §3, approved by Vahid on 2026-09-01: *"`specialistId` is **asserted, not authenticated**
> — the record is honest about who claimed to resolve it, not proof of who did … acceptable only for
> the current controlled single-operator model."*

A cancellation is a **consent decision**, and the audit trail already distinguishes a `student` actor
from a `specialist` one precisely so that question can be answered later. Letting an unauthenticated
asserted identity terminate a student's application on their behalf would record a consent act against
an identity nobody verified. The condition that would change this is the one ADR-0048 already names —
authenticated individual identity — and it is a release blocker there for the same reason it is a
blocker here.

So this is **not** a new deferred decision; it is an existing one applied. A specialist can still
abandon a *stuck run* through an intervention (`resolveIntervention`, outcome `abandon`), which is a
different act about a different subject: that adjudicates automation that cannot proceed, and does not
claim the student asked to stop.

### §4 · What the student is told (**decision 4**)

**Settled: completely honest and explicit**, distinguishing stopping future work from erasure or
reversal, and never implying that an account, saved data or a completed portal action has been undone.

The message this phase ships:

> *"I've stopped work on your {institution} application, and I won't start anything new on it.*
>
> *Two things I want to be straight with you about, because stopping does not undo them. The account
> at {institution} was created in your name and still exists — it is yours, and I'll help you take
> control of it before we finish. Anything I already filled in on their form is still saved there;
> I cannot remove it, and you can change it yourself once you have the account.*
>
> *Nothing was submitted. If you want your data deleted rather than just stopped, tell me — that is a
> separate request and I'll pass it to a person."*

The last sentence is load-bearing and is why decision 4 mattered. **Erasure is not cancellation.** It
has a different lawful basis and is bound up with the retention schedule, which is externally blocked
(0 policies, 12 unresolved, stamped UNAPPROVED). A stop button that quietly implied deletion would be
the most damaging thing this phase could ship.

## What this phase would NOT do

- **No erasure, and no retention change.** Blocked externally, and a different request.
- **No un-fill.** Nothing reaches back into a portal to clear a page.
- **No runner supervisor.** Named here only because the ordering argument depends on it: it comes
  after this, not before.
- **No specialist-initiated cancellation** unless decision 3 says otherwise.

## Alternatives to this whole phase, and why I am not recommending them

- **The runner supervisor.** The obvious next plumbing, and it opens the autonomous-consequential-
  action window this ADR exists to make closable. Wrong order.
- **The learning loop** (ADR-0008 part 2). `interventions.lifecycle` is still only ever written
  `"captured"`; `canTransitionLifecycle` and `asReusable` still have no production callers. But
  learning needs real interventions to learn from and there have been none.
- **The alerting transport.** Needs a vendor decision from you, and the queue it would consume is
  reliable and current as of P14. Lower stakes than a student who cannot stop.
- **Deployment infrastructure.** Real — there is still no Dockerfile, no IaC and no service entry
  point anywhere — but it is execution of a decided architecture, and a system a student cannot stop
  is not one to deploy first.
- **Documents.** Externally blocked on the retention schedule.

---

*Accepted 2026-09-02. P15 implements it.*
