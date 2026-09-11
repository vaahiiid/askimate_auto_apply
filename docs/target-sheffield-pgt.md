# Target 1 — University of Sheffield, PGT, September intake, direct application

**Selected by Vahid, 2026-09-08. Confirmed by Vahid, 2026-09-10:** *"Sheffield target confirmed."*
For the blueprint phase, not for the transport phase.
**Nothing in this document is an observation of Sheffield's site.** Everything about Sheffield below
is Vahid's, transcribed — either his description, or what he reports the institution's public pages
state, with the source URL and the date he retrieved it. What is measured is what a *discovery run*
would do, and that is measured from this repository's own code.

**The target file exists: [`targets/sheffield-pgt-2026-09.json`](../targets/sheffield-pgt-2026-09.json).**
It parses (`parseTarget`, checked 2026-09-10 without opening a browser) and **has not been run**.
The two fields that were Vahid's to supply — which course, and the intake year — were supplied by
him on 2026-09-11 and are in the file. The password question is closed the same day, by his direct
statement; see below.

## The target, as confirmed

| | |
|---|---|
| Institution | University of Sheffield |
| Route | Direct — the university's own Postgraduate Online Application Form. **Not UCAS.** |
| Level | Postgraduate taught master's |
| Course | **MSc Management and International Business** (Vahid, 2026-09-11). Course page, as he read it: https://sheffield.ac.uk/postgraduate/taught/courses/2026/management-and-international-business-msc |
| Intake | **September 2027** — `2027-09` in the file, so the submission key carries it. Vahid, 2026-09-11: *"the course page URL carries /2026/ — that is the page I read it from, not the intake. The intake is September 2027 and the key should carry that."* Earlier: *"there is no January or February intake — all PGT masters start in September, which makes intake modelling trivial for this target"* |
| Entry point | https://www.sheffield.ac.uk/postgradapplication |
| Public guidance | https://sheffield.ac.uk/postgraduate/taught/apply/applying |

## What the public pages state — sourced facts, per the Requirements Service's provenance rule

Each fact carries its source URL and retrieval date, the way `packages/requirements` records an
official-source page (`sourceUrl`, `retrievedAt`). **Stated by the institution, transcribed from
Vahid's message of 2026-09-10; not observed by this repository.** Discovery confirms or refutes each.

| # | Stated fact | Source | Retrieved |
|---|---|---|---|
| S1 | The form is in two parts. Part 1 is personal information, English language ability, previous education and employment, with mandatory fields marked `*` that must all be completed before Part 2 opens | https://sheffield.ac.uk/postgraduate/taught/apply/applying | 2026-09-10 |
| S2 | Part 2 is course selection. Up to three courses per application | same | 2026-09-10 |
| S3 | Supporting documents — evidence of previous qualifications, a personal statement — are uploaded into the relevant sections of the form | same | 2026-09-10 |
| S4 | The application is submitted only when *Submit Application* is clicked, and incomplete sections are prompted back at that point | same | 2026-09-10 |
| S5 | No application fee for PGT master's | same | 2026-09-10 |
| S6 | The entry point to the form | https://www.sheffield.ac.uk/postgradapplication | 2026-09-10 |

What each one means for the blueprint, if confirmed: S1 is a two-part form with a gate between the
parts, which the page walk (`#nextPage`) already models as pages with a `nextPageRef`; S3 is the
attachment path P73–P74 built, exercised for real; S4 is the submission boundary ADR-0014 stops
before; S5 removes the payment handoff.

## How the form will be read — attached inspection (P79)

The form is behind an account, and a blueprint of it is a precondition of the runner creating one
(ADR-0101 as amended in P79). So the first reading is made by a person: create the account, sign
in in a browser started for the purpose, and run `pnpm run inspect:attached sheffield --cdp …`
over the signed-in pages. Read-only, through their session, paced, values scrubbed from the
captures. The exact browser flags and the order of things are in
[the runbook](./runbook-discovery-handoff.md#attached-inspection--reading-a-form-behind-a-login).

## Step 5 — who reviews, decided

Vahid, 2026-09-10: *"Second reviewer for step 5: author Vahid Mohammadi, approver Iman Behravan."*

So the mapping set for this target is authored by Vahid Mohammadi and reviewed by Iman Behravan
(`reviewedBy`, never the author — ADR-0017), and the approval record in `approvals.json` for the
reviewed entry carries `authoredBy: "Vahid Mohammadi"`, `approvedBy: "Iman Behravan"`, the
canonical hash from `pnpm run catalogue hash`, the date, and a note of what was checked
(ADR-0057). The loader refuses an approval whose author and approver are the same person. The
approver's identity is asserted in that file, not authenticated — the same scope ADR-0048 §3
records for the one-operator model.

## The first read — 2026-09-10, eleven pages, zero failed

Made by Vahid on his machine through attached inspection (P79, fixed in P80). The record is
[`captures/sheffield-pgt-2026-09-10/`](./captures/sheffield-pgt-2026-09-10/README.md): `run.json`,
the tool's `blueprint.draft.json` unedited, and the account of what the form is. Against the
sourced facts above: **S1** is consistent with what was read — nine Part 1 pages of exactly the
kinds stated, the `*` convention for mandatory fields, and Part 2 behind them, unread; **S3** is
confirmed by structure — seventeen document slots inside the sections; **S2**, **S4** and **S5**
remain stated, not observed. The three-choices question is answered as far as the captures allow
in that README, and no further: Part 2 was not read, and it is what settles it. The
`portal_issued` question was open on the captures and is closed by Vahid's statement of
2026-09-11, in the next section.

## The thing to notice before discovery — `portal_issued`, to be confirmed by observation

**Answered 2026-09-11, by Vahid's direct statement, verbatim:** *"Password: student_chosen,
confirmed by observation not inference. I created the account myself and I typed the password I
chose. Sheffield did not email me one. Record it as my direct statement with today's date, and
close that question."* So: `student_chosen`. AUTH 1 yes, AUTH 2 no. The PGT form does not behave
like the sibling form. The question is closed on that statement and on nothing else — not on the
*Change Password* link the first read saw, which was consistent with both answers. What the
registration page read still gives is the `registration` and `login` locators the reviewed entry
needs, and AUTH 3, 6 and 7; it is no longer what settles the password. The paragraphs below are
kept as the question was asked, and what the code does under each answer.

Vahid, 2026-09-10: *"Sheffield's sibling form (Alternative Routes, /arpform/login.app) tells new
applicants that an email will be sent containing their login details. If the PGT form behaves the
same way, Sheffield is `portal_issued` under ADR-0020, not `student_chosen` — the portal mails a
credential we never read. That matters for blocker 19: under `portal_issued`, B's secure box carries
a credential the student relays from their own mail rather than a password they chose. Your
decision sheet already covers that case, and I want it confirmed by observation rather than assumed
from a sibling form."*

Recorded as a question for discovery (the target file carries it as a claim to observe), and what
the code does with the answer today, so nothing is assumed:

- `portal_issued` is one of the four approaches `chooseApproach` ranks (`packages/account`), and the
  orchestrator issues `create_account` under it with **no secure step**: there is no password for
  us to ask for, because the portal sends one to the student's own inbox, which this system cannot
  read (no mailbox capability, enforced by the boundary check).
- What is **not** built is the sign-in that follows. ADR-0101 built B — `portal_sign_in` through
  the secure box — as the *resume* path, for `student_chosen` through the secure channel only;
  `resumeStepFor` says in its own words that under `portal_issued` *"no password reached us through
  the secure channel and none can"* and hands a lost session to a specialist. Under `portal_issued`
  the first sign-in after creation is not a resume; it is the routine path, and the credential the
  box would carry is the one the student relays from their mail. The blocker-19 sheet covers that
  case (*"the same box carries the emailed code or credential instead of a password"*), and
  ADR-0101 recorded it without building it.
- So if observation confirms `portal_issued`, the decision that follows is Vahid's: whether B's box
  carries a relayed credential on the routine path. It is not made here, and the model is not
  adapted in advance of the observation — the same rule as the three-choices question below.

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
  ~~This repository has never measured that number, and I am not going to state one as though it
  had.~~ **P58 measures it.** `RequestTally` counts navigations against sub-resources on every run
  and writes both to `run.json`, so the next sentence about the cost of a run will be a measurement
  rather than a range.

**Host confinement:** only hosts on the target's `allowedHosts` are reachable; everything else is
aborted. That is a safety property and also a fidelity caveat — a page whose CDN or analytics host is
blocked may render differently from what a real applicant sees.

**~~No throttling.~~ Closed in P58 (ADR-0091).** Both gaps this paragraph named were made
preconditions by Vahid and are now built: robots.txt is read before the browser opens and obeyed at
every request, with the file kept verbatim in `robots.json`; and there is a **one-second floor**
between page requests that a target file may raise and nothing may lower. An unreadable robots.txt
allows nothing.

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

---

## The scoped run cannot be made from this environment

**Attempted 2026-09-08, after ADR-0091 landed. Sheffield was never contacted.**

Vahid authorised a scoped run of 10–15 public course pages once robots.txt and the delay floor
existed. They exist. The run did not happen, and the reason is on our side, not Sheffield's:

```
$ curl https://www.sheffield.ac.uk/robots.txt
curl: (56) CONNECT tunnel failed, response 403
```

The agent proxy's own status endpoint names it:

```
"kind": "connect_rejected",
"detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
"host": "www.sheffield.ac.uk:443"
```

**The request was refused by this environment's egress policy before it left the machine.** No packet
reached Sheffield, no robots.txt was read, and no page was fetched. Two attempts, both rejected at
the same point.

So the run needs one of:

- **this environment's network policy widened** to allow `www.sheffield.ac.uk` (and whatever host the
  Postgraduate Online Application Form lives on) — see
  https://code.claude.com/docs/en/claude-code-on-the-web for how an environment's policy is set; or
- **the run made somewhere with ordinary network access.** `pnpm run discover` is deliberately
  runnable anywhere: it needs a target file, Chromium, and outbound HTTPS. Nothing about discovery
  depends on where it runs.

~~**The target file does not exist yet either**~~ — it does, since 2026-09-10:
[`targets/sheffield-pgt-2026-09.json`](../targets/sheffield-pgt-2026-09.json), with the two entry
URLs Vahid supplied as seeds, `allowedHosts` of `sheffield.ac.uk`, `maxPages` 15 and `crawlDelayMs`
2000 (the floor is 1000; a target may ask to be slower). Not run.

### Which setting governs, and what widening it would allow — answered 2026-09-10

Vahid: *"Is the cloud environment's Network access setting the thing that governs this, and what
would changing it allow that Trusted does not? I would rather understand what I am opening than
open it and find out."*

**Yes, it is that setting.** Read from https://code.claude.com/docs/en/cloud-environments on
2026-09-10, and from this session's own proxy status:

- Every cloud session runs in an *environment*, and each environment sets one **Network access**
  level for the outbound connections its sessions can make: **None**, **Trusted**, **Full** or
  **Custom**. The default is **Trusted**: an allowlist of package registries, GitHub and cloud SDK
  hosts, and nothing else. `*.amazonaws.com` is on that list, which is why `s3.eu-west-2.amazonaws.com`
  was reachable in P58 and `www.sheffield.ac.uk` was refused at the egress proxy with a 403 to
  CONNECT. This environment behaves exactly as Trusted.
- **Custom** takes a domain list, one per line, with `*.` for every subdomain, and a checkbox to
  keep the Trusted defaults as well. The narrowest widening that lets the scoped run happen is
  Custom with `www.sheffield.ac.uk` and `sheffield.ac.uk` — or `*.sheffield.ac.uk`, since the host
  the form itself lives on is not known — with the defaults kept, so the session can still install
  packages.
- **Full** allows any domain. It would let the run happen too, and it opens outbound HTTPS from
  every process in every session of that environment to the whole internet. Discovery does not need
  it: the runner already aborts every request to a host outside the target's `allowedHosts` before
  it leaves the machine, so a page's off-host scripts and CDNs are blocked by the runner whether or
  not the proxy would let them through. Full buys nothing for this run that Custom does not.
- What the level does **not** touch, at any setting: GitHub (a separate proxy), the Anthropic API,
  and MCP connector traffic, which travels through Anthropic's servers. What it applies to: every
  process in the sandbox, including a browser the runner opens. The level is a property of the
  *environment*, so it applies to every session started in it, not only this one; the docs do not
  say whether a session already running picks up a change, so assume a new session is needed.
- Two things worth knowing before opening it. First, all outbound traffic from an Anthropic-hosted
  session passes through Anthropic's security proxy, which keeps *"a DNS-level audit trail of
  requested hostnames"*; the request Sheffield would see comes from Anthropic's egress, not from
  Vahid's address, while the User-Agent still names AskiMate-AAS-Discovery honestly. Second, the
  run's own preconditions do not change with the setting: robots.txt is read before the browser
  opens and an unreadable one allows nothing; the one-second floor stands; the session is read-only.

The alternative stands too: `pnpm run discover targets/sheffield-pgt-2026-09.json` runs anywhere
with Chromium and outbound HTTPS, and nothing about discovery depends on where it runs.
