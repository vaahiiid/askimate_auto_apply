# ADR-0072 — A decision is enforced where it is made, and a demonstration that cannot fail is not evidence

**Status:** **Accepted** — 2026-09-06
**Amends:** [ADR-0005](./0005-contract-first-openapi.md) (the generation claim),
[ADR-0008](./0008-recovery-first-escalation-and-the-learning-loop.md) (the alerting transport, now built)
**Completes:** [ADR-0006](./0006-reapplication-requires-explicit-student-instruction.md) §1–§5 in the state machine
**Audit:** [`p37-adr-audit.md`](../p37-adr-audit.md)

## The decision

Two things, from one audit of ADRs 0005–0021:

1. **`machine.ts` calls `decideReapplication`.** The re-application intent carries who is asking and
   does not propose an ordinal; the gate returns it.
2. **`scripts/walkthrough.ts` declares what it expects of every step, exits non-zero when a step
   disagrees, and runs inside `pnpm run verify`.**

## Why an audit at all

Five consecutive phases found an older ADR asserting a guarantee the code did not provide — ADR-0038
on verified email (P19), ADR-0045 §4 on crash detection (P17), ADR-0022 on storage (P31) and on the
application context (P34), and the `documentRef` layering (P35). At five, that stops being
coincidence and becomes a property of how this repository accumulated: decisions were written
carefully, implementations moved, and nothing compared the two afterwards.

The audit's method was two questions per named artefact: *does it do what the ADR says?* and *does
anything in production call it?* **The second question found almost everything.**

## 1 · One gate, not two

`decideReapplication`'s doc comment has read *"The single gate. `machine.ts` calls this; nothing else
may increment an attempt ordinal"* since Phase 1. `machine.ts` imported only the **type**, checked
that the ordinal increased by exactly one, and accepted everything else.

Four of ADR-0006's five rules were therefore enforced only by a function nothing called:

- only a **student** may ask — `automatic_retry`, `specialist` and `operator` were all accepted;
- the prior case must have **concluded**;
- the instruction must carry the student's **own words**;
- the wait recommendation must have been **shown before** the instruction.

ADR-0041's failure inside the domain: one decision, two implementations, the weaker one on the path.

**Not exploitable today**, because nothing in production can reach the intent at all (see §3). That
is the reason to fix it now rather than later: whoever builds the re-application path will read that
comment and trust it, and the constraint should be true before the thing it constrains exists
(ADR-0019).

### Two shapes worth naming

**`priorCaseConcluded` is derived, not passed.** `decide` already refuses every other intent on a
terminal case, so the case's own state is the honest answer and a caller cannot disagree with it.

**The intent no longer carries `newAttemptOrdinal`.** The gate returns it. A caller that proposed one
would be a second opinion about the one number ADR-0006 says may only increase by one — and the
previous code's only check was on exactly that number, which is how it came to be the only rule
enforced.

## 2 · A demonstration with no expectations cannot be wrong

`pnpm run walkthrough` is what the README calls *"the fastest way to see what has been built"*. It
was refusing **nine consecutive steps** and exiting 0.

Two later decisions caused it, neither of them wrong. ADR-0058 made a case open directly into
`READY_TO_PREPARE`, turning the script's "Mark ready" step into a self-transition and giving every
later step the wrong state. And capturing an authorisation became the act that *moves* a case to
`AUTHORISED`, so submitting straight from `AWAITING_STUDENT_AUTHORISATION` is correctly refused. The
script also never retried the authorisation transition after the mandatory financial-evidence review
it exists to demonstrate — so the gate was shown being requested and never shown being satisfied.

**The defect is not the drift; the drift is normal. The defect is that nothing could notice.** The
script printed refusals, called them output, and exited successfully.

So `apply` now takes a third argument — `"accepted"` or `"refused"` — and that argument is not
documentation. A step marked `"refused"` is one the script exists to show being refused: the
financial-evidence gate, the submission that collides with itself, the automatic retry that may not
create an attempt. A step marked `"accepted"` is one the narrative depends on. Disagreement is
collected and printed with the domain's own refusal text, and the process exits 1.

`scripts/walkthrough.test.ts` runs the real script in a real process and fails on a non-zero exit.
The expectations stay **in** the walkthrough, next to the narrative they are about, rather than being
restated in the test — somebody editing the story has to look at them.

### Why not delete the walkthrough instead

It was the honest alternative: 2,182 tests cover this domain, and a demo is not a test. It stays
because it is the only artefact that reads the case machine as a **story** — a reviewer who wants to
know what the product does reads it in two minutes, and no test file does that. What was wrong was
that it had authority without accountability. It now has both.

## 3 · What this deliberately does NOT fix

Two findings are recorded and left open, because they are one piece of work and doing half of it
would be worse than doing none.

**`claimSubmissionKey` has no production caller.** ADR-0006 calls the database's unique key *"the
second line of defence"* against duplicate submission; it is never armed. `POST /v1/conversations`
lets a student open a second conversation, request the same target, and receive a second case with
the same `(studentId, institutionId, courseId, intake, attemptOrdinal: 1)`. Nothing today submits
(ADR-0014) and no live portal is connected, so the blast radius is currently nil — and at the first
live run it is the failure the brief names as characteristic and catastrophic.

**The re-application path does not exist.** `decideReapplication` and `recommendWait` are called only
by the walkthrough. There is no route, no `StudentDecision` member and no driver path.

They are one phase because closing the first without the second replaces a silent duplicate with a
silent dead end: a student whose case concluded would be refused a second case and have no way to
ask for one. This repository has spent four phases removing exactly that shape, and it will not add
one back as a side effect of a fix.

**The next phase closes both**, and everything it needs is decided: `recommendWait` already composes
the advice, `StudentDecision` is already a hash-bound union so "the recommendation was shown" is
provable the same way P22 proves "the preview was shown", and `decide` already admits the intent on
a terminal case.

## 4 · Corrections to older records

**ADR-0005** claimed validators and clients are *"generated from it, never hand-written"*. There is
no generator in this repository and never was. What holds spec and server together is ADR-0063's
drift check against the real Express router — stronger in the direction that matters, because a
generated client matches the spec and says nothing about whether the server does. Corrected in place,
not reworded away.

**ADR-0008** said the alerting transport was *"not built, and explicitly not claimed"*. Built in P36
(ADR-0071). A dated note was added rather than the sentence edited, so what was true when the
decision was taken survives.

## 5 · What held

Recorded because a clean result is a result. Thirteen of the seventeen records audited hold as
written, and the ones checked hardest were the standing hard stops.

**Minors.** The trigger is raised from `suggestsMinority` on a confirmed date of birth, and the code
carries the record of getting this wrong once — a first version used `determineAge`, which returns
`requires_identity_check` for any merely stated date of birth and raised the trigger on every case in
the system. Nothing concludes "adult" from absent, unparseable or merely stated evidence. No
parental-consent requirement is hardcoded. `checkMinorGate` has no production caller and that is
correct: its one blocking condition is at the submission stage, which does not exist.

**Financial evidence.** `isFinancialField` is read on every mandatory-review derivation, and the
walkthrough now demonstrates the gate being *satisfied by a review* rather than merely requested.
