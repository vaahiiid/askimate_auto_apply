# ADR-0053 — A student can stop

**Status:** **Proposed** — drafted 2026-09-02. Not to be acted on until approved. ·
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

## The decisions I need from you

### Decision 1 — the shape of a cancellation (**this is the material one**)

**A — Wind down, then conclude.** A new non-terminal state (`WINDING_DOWN`, or reuse
`AWAITING_HANDOFF`) that stops new work immediately, allows the outstanding handover to complete, and
reaches `CANCELLED` only when the account is handed back. Honours ADR-0050 exactly; costs a new state
and a return edge, and a student who never completes the handover leaves a case that never concludes —
which is already true of every finished case today.

**B — Cancel immediately; the account becomes a specialist's problem.** Transition straight to
`CANCELLED` and raise an intervention for the outstanding account. Simple and immediate for the
student; converts every cancellation into human labour, which is precisely what ADR-0008 says the
specialist layer must not become.

**C — Refuse to cancel until the handover is done.** "You can stop, once you've taken your account
back." Keeps the machine simple; makes the stop button conditional, which for a student who wants out
*now* is close to not having one. I think this is the wrong answer for a consent mechanism.

**My recommendation is A**, on the ADR-0050 argument: the account is the student's, handover is
non-optional, and a stop that stranded it would be a stop that lied. But A adds a case state, and this
repository has been careful about that — ADR-0050 declined to add a terminal state on exactly this
kind of reasoning — so it is yours to settle rather than mine.

### Decision 2 — does cancelling void the authorisation?

`student_revoked` exists as a void reason and has never been issued. If a cancelled case can later be
re-applied (ADR-0006 permits `instruct_reapplication` on a terminal case), an authorisation that
survived cancellation would be an approval of content the student walked away from.

**My recommendation: yes** — cancelling issues `void_authorisation` with `student_revoked`, which
gives that declared reason its first writer and means no fill work can be handed out for a cancelled
case even if one somehow reached the pool.

### Decision 3 — who may cancel

**My recommendation: the student, through their own session**, on the existing decision route rather
than a new surface — the same mechanism P11 established for `authorise` and P12 for `confirm_handoff`,
carrying the hash of the message they were shown. A specialist can already abandon a stuck run through
an intervention; that path stays as it is and is not widened.

Whether a **specialist** may cancel on a student's behalf (a phone call, an email) is a product
question I should not answer for you.

### Decision 4 — what the student is told

The message must be true about all three limits above. My proposal, for your wording:

> *"I've stopped work on your Leeds application. Two things you should know: the account you created
> at Leeds is yours and still exists — I'll help you take control of it — and the parts of the form I
> already filled in are still saved there. Nothing has been submitted."*

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

*Nothing in this ADR is implemented. It is a draft for a decision, not a decision.*
