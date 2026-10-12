# Time to onboard a portal

Vahid, 2026-10-12, in his words ([the message](../run-a/p297-his-decisions-as-sent.txt)):

> *"Measure one more thing from now on: the time it takes to onboard a new portal. That is the
> number that decides whether we are global."*

So every portal onboarded from 2026-10-12 has a record here, and every phase report carries the
number the record gives. Ulster Birmingham (QA Higher Education), the earlier target, has none: it
stopped at its registration page on 2026-08-26, and no capture's `run.json` of it is committed, so it
has no T1 to start a clock from.

## The stages

A stage is reached when something that can be re-read says so: a commit, or a capture's own
`run.json`. The record names the marker; `scripts/portal-onboarding-time.ts` reads the time from
the marker and never from the record, because a number in a record is read from the marker, not
written from recollection. It refuses a commit that is not a hash in HEAD's history, a T0 that is
not the commit adding the record's target file, a T1 that is not that target's first committed
capture, and a stage reached before the one it rests on: T3 on T2, T4 and T5 on T3, T6 on T5. T4
and T5 have no order between them: a portal can be run live before it is rehearsed.

| Stage | Reached when |
|---|---|
| **T0** target opened | the commit that adds the portal's target file |
| **T1** first capture | the first capture's `run.json`, its `startedAt` |
| **T2** structure complete | every page from sign-in or registration to the page carrying the final-submit control is observed and in the blueprint, and no structural question is left among its unobserved claims. A student's own values are not structure. |
| **T3** structure signed | the commit of the first signature over a structure that is complete |
| **T4** rehearsed | a synthetic student run in a browser through every page, to before submission, on a replay of the portal's own pages |
| **T5** live to the line | a run on a real account through every page, to before final submission, every save read back |
| **T6** a second student | T5, for a student other than the signer |

**Time to onboard** is T5 − T1: from the first capture to a run through every page. Whether the
run must also have created the account is not in T5's definition; Run A's account was made by hand.
**Global** is T6 − T1, because a portal that serves one person has not been onboarded for
anybody else. Until a stage is reached, the script prints how long it has been since T1, at the
time of the commit it runs on.

## What it cannot see

- **Person-time.** How long each of his sittings took is recorded only once (the reads of
  2026-10-11, about six minutes, in his words). The stages measure elapsed calendar time.
- **Agent time.** Phase clock lines exist for some phases only, and are not summed here.
- **Whether a stage's definition is met.** The record says a stage is reached by naming a marker;
  the script checks that the marker exists and that the stages are in order, not that the work
  behind it is what the stage asks. That judgement is in the record, and the record says why.

## The records

- [`sheffield-pgt.json`](./sheffield-pgt.json): Sheffield PGT.
