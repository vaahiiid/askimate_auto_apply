# ADR-0134 — A guard runs where the fill runs, and labels what it records instead of guessing at it

**Status:** Accepted · 2026-09-21 · decided by Vahid in his own words, after P181 read the code · restores what [ADR-0014](./0014-discovery-cannot-submit.md) and [ADR-0091](./0091-robots-txt-is-read-obeyed-and-kept.md) already claimed, on the path [ADR-0046 §6](./0046-a-fill-plan-crosses-as-value-and-provenance.md) — *the session is passed in, because the form is behind a login* — and [ADR-0101 §2](./0101-the-yes-comes-first-and-a-runner-is-signed-in-for-one-sitting.md) make production take
**Built in P182**, the same day. Closes blockers 51 and 52; raises blocker 53.

## Context — three weeks of a guard that was not there

P181 was asked a question about a dropdown: had the fill session refused a POST the page made by
itself, and so left the institution box unwired? The answer was worse than yes.

`decidePreparationRequest` has no method rule, by design — a portal saves drafts by POST and a guard
that refused writes would refuse the work. It refuses on a host off the allow-list, and on a URL
under a submission endpoint the blueprint records. But the `context.route` handler that runs it
lived inside `PlaywrightPreparationSession.open`, and **nothing a deployable runs calls `open`**.
ADR-0046 §6 puts the form behind a login, so the fill attaches to the context the sign-in already
holds, and `attach` installed no handler. `SessionHold.open` installed none either. Four route
handlers exist in the repository and not one of them was on the context a real fill runs in.

So for three weeks a real fill had no host allow-list on the page's own requests, no robots.txt on
its subresources, and an empty `WriteLog` — while the guard's own file described all three. Nothing
printed the false summary, by luck rather than design: `summarise()`'s only caller was a test.

The check that exists for exactly this class of defect passed, and says why in its own header:
*a function called only by another function that nothing calls passes here.*

Vahid, 2026-09-21:

> **"Install it on the attached context. Not as a new rule — as the rule the system already claims.
> And until it is in, nothing the system prints may say 'the portal saved nothing'."**

## Decision

**1 · The guard is installed on the context, by whichever door opens it.** `guardContext` is called
by `attach` and by `open` alike: host allow-list, robots.txt on every request rather than only on
navigations, forbidden endpoints, and the record of everything state-changing. `attach` became
asynchronous for it, because a handler installed after the first request has gone is not a guard.

**2 · Once per context, with the logs on the context.** A run fills page after page in one held
context and builds a session per page item. Playwright runs only the most recently added handler
for a route, so stacking one per session would leave the older sessions' logs silently empty —
precisely the failure this ADR exists to remove. The logs belong to the context, which is also the
truer scope: *what did this run send* is a question about the run, not about one page of it.

**3 · A log that nobody armed reports nothing.** `WriteLog.arm()` is called as the handler goes on.
An unarmed log answers *"NOTHING WATCHED this run's network… it says nothing about what was sent or
what the portal stored"*, and cannot say *the portal saved nothing*. This is the same distinction
P179 drew for lookups, where `undefined` and `[]` are kept apart, and it is what makes rule 1 stay
true if a later path forgets to install the guard.

**4 · A page reading a lookup is told from a page writing, by NAVIGATION — and the answer is a
label, not a refusal.** `request.isNavigationRequest()`. A portal saves a page by submitting that
page's form, which navigates; a widget asking what institutions exist does not. Every
state-changing request is still permitted, as before; each is now recorded as `navigation` or
`background`, and the run's summary says how many of each.

Two alternatives were considered and refused, in Vahid's words:

> *"Option 1 costs a re-sign for every lookup a page grows; option 3 reads the size of what may be
> the student's data to decide whether it is. Neither is worth it while 2 works."*

Option 1 was a reviewed list of lookup endpoints in the blueprint — accurate where knowledge exists,
but it puts a signature in the way of every page the portal changes. Option 3 was a body-size
ceiling; a rule that must measure the student's data to decide whether it is the student's data is
the wrong rule. Option 2 needs neither a list nor a body, and it would have classified the
10 September `POST getGradingSystemsForCountry.do` correctly with nobody naming anything.

**5 · The runner can see what the page did, and never what it said.** The lookup watcher records
every method on the portal's own host, not GET alone — query parameters by name and whether each
arrived empty, never their values; a status; a count when the body is a JSON list. And a
`pageerror` listener counts the times the page's own script threw. **The count only.** An uncaught
error on a form page can quote the value that caused it.

## The caveat, unchanged and load-bearing

**None of this tells a draft save from a submission.** It cannot: a portal's own JavaScript can post
a form with no control clicked, and reading an HTTP request cannot separate *saving* from *sending*.
The navigation label does not attempt it and must never be read as attempting it.

The submission guarantee is where it has always actually been — **the type and the click guard**.
`FillableSession` has no `submit`, so there is nothing to call; only the controls the plane sent may
be clicked; and a control whose accessible name reads like a submission is refused even if something
put it on the allow-list. The network layer keeps the run on-target and makes what it did visible.
That is its whole job, and the sentence it may print about what it did is now earned.

## Consequences

- A real fill is contained as the record has claimed since ADR-0014, and a test goes through
  `attach` — the door production uses — so the gap cannot silently reopen.
- The run's summary distinguishes *nothing was sent*, *nobody was watching*, and *this much was
  sent, this much of it navigating*.
- A box that finds nothing can now say: what the page asked by any method, whether the page's own
  script failed, and what this run's own guard refused while the box was being filled.
- **`forbiddenEndpoints` is installed and always empty** (blocker 53). The blueprint's
  `SubmissionModel` records a page reference and a control, and no URL, so no submission endpoint
  exists for the runner to refuse. Decision 4 of ADR-0014's network layer is a mechanism with no
  input, and this ADR says so rather than letting the file imply otherwise.
- Robots refusals on the fill path now carry `rule: "robots"`. Without it `portalAttemptedWrite`
  would have read a disallowed stylesheet as the portal attempting a write — the P58 correction,
  which the fill path's copy of the handler had never had.
