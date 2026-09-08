# Target 1 — University of Sheffield, PGT, September intake, direct application

**Selected by Vahid, 2026-09-08.** For the blueprint phase, not for the transport phase.
**Nothing in this document is an observation of Sheffield's site.** Everything about Sheffield below
is Vahid's, transcribed. What is measured is what a *discovery run* would do, and that is measured
from this repository's own code.

## The target, and why

University of Sheffield · postgraduate taught master's · September intake · applying **direct**
through Sheffield's own Postgraduate Online Application Form. **Not UCAS.**

Vahid: chosen *"for what it removes from the first blueprint, not for prestige"*:

| what it removes | why it matters here |
|---|---|
| References not normally required at application for PGT | The whole third-party path stays out of the first run — B1 row 4 and the referee notice obligation (ADR-0078) |
| Documents uploaded **inside** the form | Transport is genuinely exercised rather than stubbed |
| No application fee | No payment handoff |
| A single September intake | `intake` is one value, not a choice |
| Each course choice has its own explicit Submit button | The submission boundary is clean |

## The open question discovery must settle — and must not be pre-empted

Sheffield allows **up to three course choices per application, each submitted separately.**

The submission key is `(studentId, institutionId, courseId, intake, attemptOrdinal)` — see
[ADR-0006](./decisions/0006-reapplication-requires-explicit-student-instruction.md) and the `claimSubmissionKey`
armed at case-open in P38.

**Is Sheffield's shape three cases, or one case with three targets?**

Vahid: *"Find out whether Sheffield's shape is three cases or one case with three targets, and
report what you find before deciding. **Do not adapt the model to fit what you expect.**"*

That instruction is recorded here rather than only in a conversation because the failure it guards
against is a quiet one: the key already has a `courseId` in it, so *three cases* is the reading the
existing model makes easy, and a discovery run could be written — or read — to confirm it. The
finding is reported first; the model changes after, or does not.

## What a discovery run would actually do to the portal — measured from the code

Vahid: *"Do not run discovery against the live portal until you tell me what a discovery run would
actually do to it — how many requests, whether an account is created, whether anything is
submitted."* **No run has been made.** This is read out of `apps/browser-runner`.

### Does it create an account? No — and not as policy

`DiscoverySession` (`session.ts`) has **no `fill`, no `click`, no `submit`**. Not "must not use":
the methods do not exist on the type, so code that types into a field or presses a control does not
compile against it. `PlaywrightDiscoverySession.open` additionally refuses any capability other than
`read_only`.

### Does it submit anything? No

Every request the browser makes — including ones the page's own scripts start — passes through one
`context.route("**/*")` handler. `decideDiscoveryRequest` permits **`GET`, `HEAD`, `OPTIONS` and
nothing else**; anything else is `route.abort("blockedbyclient")`, which fails the request **before
it leaves the machine**. A blocked request is recorded as a finding, because a portal that POSTs on
page load is something a specialist must know.

### How many requests?

Two numbers, and only the first is bounded:

- **Page visits: at most `maxPages`**, a required field on the target file, validated as an integer
  between 1 and 200. The Ulster/QA target used **45**.
- **Sub-resources per page: unbounded.** Each visited page pulls its own CSS, JavaScript, images and
  fonts as ordinary `GET`s, and those are permitted. `maxPages` does not count them. A realistic
  university page is 30–80 requests, so a 45-page run is plausibly **1,500–4,000 GETs** in total.
  This repository has never measured that number, and I am not going to state one as though it had.

**Host confinement:** only hosts on the target's `allowedHosts` are reachable; everything else is
aborted. That is a safety property and also a fidelity caveat — a page whose CDN or analytics host is
blocked may render differently from what a real applicant sees.

**No throttling.** There is no delay between navigations and no `robots.txt` check anywhere in the
runner. A run is a sequential crawl at browser speed from one IP. Worth deciding on before a run,
not after.

**It identifies itself honestly**, deliberately (brief §7):
`Mozilla/5.0 (compatible; AskiMate-AAS-Discovery/0.1; +https://askimate.com/bot) read-only
application-form discovery`. Discovery does not disguise itself as an ordinary browser.

**It records a lot locally:** a Playwright trace with screenshots and snapshots, a video of the run,
and every observed page captured to disk for offline replay.

### The limitation that decides whether a run is worth making

**Read-only discovery can only see what an unauthenticated visitor sees.** The previous target
established this the expensive way: *103 discovery runs saw zero file inputs, because the
application is behind a login* (blocker 1, `state-of-the-system.md`).

If Sheffield's Postgraduate Online Application Form is behind an account — as Vahid's description of
it implies — then a read-only run reaches the course and prospectus pages and **not the form**. It
would therefore produce a draft blueprint of the wrong pages, and it **would not answer the
three-choices question**, because that structure lives inside the authenticated application.

Seeing the form needs an account and a fill-capable session. That is a different capability with real
side effects, it is blocker 4 (*an account — QA HE sandbox, or a consenting applicant*), and it is
not something to slide into under the word "discovery".

**Recommendation, for Vahid to accept or reject:** do not spend a read-only run on the application
form. If one is made, make it a small, deliberately scoped run of the public course pages — say
`maxPages` of 10–15 — to confirm the entry point, the intake wording and where the login boundary
falls, and expect it to answer nothing about the form itself.
