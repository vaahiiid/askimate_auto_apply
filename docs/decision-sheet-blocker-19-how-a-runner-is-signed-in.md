# Decision sheet — blocker 19: how a runner is signed in when execute work arrives

**For:** Vahid · **Prepared:** 2026-09-10 · **Answerable in one sitting**
Companion to [B5](./decision-sheet-b5-hold-or-pass-through.md) and [B1](./decision-sheet-b1-retention-periods.md).
Recorded as blocker 19 in [`state-of-the-system.md`](./state-of-the-system.md) since P66 (ADR-0099).

> **Already decided, and not on the table** — Vahid, 2026-09-10:
>
> - *"We do not store a student's portal password. That was decided when the master brief was
>   written and nothing since has changed it."*
> - *"Anything requiring the student to act is a handoff, not a failure. Agent prepares, student
>   performs, agent resumes."*
>
> And the instruction that shapes §4 below: *"Treat 'the student authenticates in a handed-off
> session and the runner resumes with it' as an option to cost, not as a foregone conclusion. If it
> does not work, say why."*

---

## The question

> When the run reaches `execute` — a page of the application form to fill — the runner needs a
> browser session the portal accepts as the student's. **Where does that session come from?**

It is one question with a second folded inside it: *for a portal that has no login at all, is
there a session to worry about, and do we serve that portal?* §6 takes that one separately, because
the answer turns on a market fact rather than a design.

---

## 1 · What is already true, read from the tree

Everything below is what the code does today, not what a document says it should. The sheet is
only as good as this section.

**The order of steps is fixed by the orchestrator** (`packages/orchestrator/src/run.ts`,
`nextStep`):

```
interview → request_secret → create_account → validate → authorise → execute (one page per item) → hand_over_account
```

`request_secret` asks the student for a password and `create_account` uses it, **before** the
student has seen the preview they authorise. The comment on `accountStepFor` gives the reason:
*"a form cannot be filled without an account"* — which is true, but does not require the account to
exist before the yes. The preview (ADR-0059) hashes the plan, the documents and the destination; it
does not depend on an account existing.

**The password is consumed once, inside the Secure Plane** (ADR-0042). The student types it into
the secure frame; the fill agent types it into the registration form over CDP; the handle is spent.
The vault's ceiling is five minutes (ADR-0034). After `create_account` nothing anywhere holds it,
by design. `packages/secrets` already names a second purpose, **`portal_sign_in`** — *"signing in to
an account the student already has, with a password they already chose … it goes through exactly
the same channel and the same single-use destruction"* — and it is not in the published contract.
`scripts/contract-drift.test.ts` records that divergence as a fact with an owner rather than a
surprise, and nothing reachable asks for it.

**Creating the account signs the runner in.** The portal sets a session cookie in the runner's
browser context, exactly as it would for a person. `createPortalAccount` says so and has a seam for
it — a caller may supply a context that is *"kept open afterwards … the only session the run has"*.
The production entry point (`apps/browser-runner/src/main.ts`) does not use the seam: it opens a
context per work item, closes it with the item, and answers `needs_the_student` to every kind of
work but `create_account`. **So the session that `create_account` made dies with the item that made
it, and the next item arrives logged out with no way back.** That is blocker 19.

**The journey test bridges the gap two ways, both test-only.** It keeps one context across the
whole case (*"the runner's context for this case, opened once and kept"*), and on restart it signs
in by typing the password the test itself knows. Neither is a path a deployable has.

**Work is leased one page at a time** (ADR-0045, ADR-0047): the default lease is 120 seconds, a
lease names the page it holds, and the intent ledger says which pages are saved. A run may be
picked up by any runner for any page. Nothing forbids a runner keeping state between items; nothing
arranges for it either.

**Handoffs exist and are cheap to add to.** `student_handoff` (email verification) and
`hand_over_account` (ADR-0050) already stop the run, say what the student must do, and resume on
their word. ADR-0065 made a stopped run *say so*. A new handoff is a new reason on a step, not a
new mechanism.

**The approaches, and who is present** (ADR-0020 §2): `passwordless` (link or code the portal
emails; the student opens it), `student_chosen` (they type their own; we never learn it),
`portal_issued` (the portal emails them a credential; we never read it), `generated_ephemeral` (we
generate one, hold it for minutes, destroy it at handover — the only approach where we hold a
secret). `"unobserved"` blocks. **After `hand_over_account`, under every approach, we hold nothing
that signs in** — that is the point of the handover, and every option below has to respect that a
resume *after* handover means asking the student again.

**The one real portal** (`docs/phase-3-discovery-report.md`): QA Higher Education's Salesforce
Experience Cloud portal. An account is required *in its own words*. The login page is a stock
Salesforce `LoginForm` with a forgot-password link. Whether the applicant portal has a CAPTCHA is
**unobserved** — the marketing site has reCAPTCHA on its enquiry forms; the portal page never
rendered. MFA on the portal: unobserved. **The blueprint records where the login is
(`AuthenticationModel.loginUrl`) and not what its fields are** — no locators for an email box and a
password box exist anywhere in the tree, because nothing has ever needed to sign in.

---

## 2 · The options

Five shapes, costed against what is in the tree. §3 puts them side by side.

### A — One continuous signed-in episode: create the account and fill the form in one sitting

Two changes, and they belong together.

**A1 — move `authorise` before `request_secret` and `create_account`.** The student reads the
preview and says yes; *then* they are asked to choose a password; *then* the account is created and
the form is filled, back to back. The preview does not need the account, so the hash is unaffected.
Consent order improves as a side effect: today a student is asked for a password for an account
before they have seen what will be typed under it.

**A2 — the runner keeps the context that `create_account` signed in, and claims the next page in
it.** The seam already exists (`createPortalAccount`'s supplied context). The runner holds, per
run, one sensitive context for a bounded idle time — I would propose ten minutes, and that is a
number for you to set, not a fact — and the Run Driver hands the next page of a run to the holder
that has its session, when that holder asks. In memory only; nothing is written; the context is
closed when the run's pages are saved, when the bound lapses, or when the process stops. ADR-0047
still holds: a lease still names one page, the ledger still says which pages are done, and any
runner may still pick up a run — it will just arrive logged out (see B).

**What it costs.** Two to three phases. A1 is an orchestrator change with its tests, an amendment
to ADR-0049/ADR-0050's step narrative, and a journey re-ordered. A2 is the runner's entry point
learning `execute`, holding contexts keyed by run, and the driver preferring the session holder;
plus the journey losing its test-only bridges. Slice d of the attachment path (ADR-0099) is the
same work.

**What it forecloses.** Nothing about credentials: no password, no cookie, no token is stored
anywhere. What it *does* is pin a run to one runner for the minutes it takes to fill, which is a
scheduling preference, not a lock — a crashed runner's run is claimable by the next one, logged
out. **A does not, on its own, answer the resume case**: a crash mid-fill, a portal session that
times out, a page that needs a second sitting. For those it needs B.

**Where it does not apply.** A portal that puts MFA or a CAPTCHA on *registration* stops A at
`create_account`, as it stops everything else; that is ADR-0020's *"then every login is a
handoff"*, and discovery has not observed it either way for QA HE.

### B — Ask again, through the secure channel: `portal_sign_in`

When execute work needs a session and no runner holds one, the run opens a secure step with purpose
`portal_sign_in`. The student types the password they chose into the same secure frame; the fill
agent types it into the portal's login form over CDP, single use, five-minute ceiling; the runner
carries on in that context. **The password is never stored — it is asked for, once, each time it
is needed, and destroyed.** This is the mechanism ADR-0042 built, pointed at a login form instead of
a registration form.

**What it costs.** Two phases. `portal_sign_in` enters the published contract (the divergence the
drift test records gets decided); a `sign_in` reason on the secure request and a performer that
types into the login form; **login-form locators in the blueprint**, which is a discovery item —
the blueprint knows the login URL and not the boxes. For `passwordless` and `portal_issued`
portals the same box carries the emailed code or credential instead of a password (the student
relays it; we never read their mail). For a portal that emails a one-time code at login, the same.

**What it forecloses.** Nothing. It is a handoff, which the constraint says is not a failure, and
it is the only shape that works after `hand_over_account` — once the account is theirs, the only
way back in is to ask them.

**Where it does not apply.** Under `generated_ephemeral` there is no password the student knows;
B cannot ask for one. That approach is last-ranked for exactly this reason, and under it A is the
whole design: create, fill, hand over, destroy, in one episode. And B cannot pass an app-based
push MFA or a CAPTCHA at login — those need C or a person.

**A cost to weigh honestly.** Each B sign-in is one more time a chatbot asks a student for a
university password. ADR-0020 and `secretStepFor` say why that is a cost in itself: *"someone who
is asked for a university password by a chatbot that did not have to ask has learned that being
asked is normal, which is precisely the lesson a phishing attempt relies on."* B is right as the
resume path and wrong as the routine path. That is the reason A comes first.

### C — The student authenticates in a handed-off session, and the runner resumes with it

Costed as asked, and it needs one thing said before the cost: **the session has to be in our
browser.** A portal session is a cookie bound to the browser that logged in. If the student logs
in on their own device, the session is there, not here, and the only way to move it is to export
the cookie and import it into the runner — which is a stored bearer credential to their account,
credential-theft-shaped, `HttpOnly` by the portal's choice, and the one thing brief §8 forbids in
substance if not in letter. So C in its honest form is: **the student drives the runner's browser
for the login.** That is co-browsing — a live screencast of the runner's page streamed to the
student through the secure origin, their keystrokes and clicks forwarded to it, for as long as the
login takes.

**What it buys.** Everything B cannot: a CAPTCHA, an authenticator-app push, a login form whose
shape discovery never captured, a portal-issued credential the student would rather type than
relay. Under C we never learn the password either — it passes through our input pipe to the
portal, which is the same trust the fill agent already has under ADR-0042.

**What it costs.** Many phases and a new product surface. A CDP screencast and input-forwarding
service inside the Secure Plane (it must not run in the Conversation Plane, which may not touch a
browser); a viewer in the student's page; a runner pinned to a person's pace, minutes at a time,
with leases to match; latency and a support burden; and a security review of its own, because
streamed frames are page contents and ADR-0025 says nothing sensitive reaches a trace — they
would have to be streamed and never stored. It is also the only option that turns the runner into
something a student watches, which changes what "the runner is the most likely thing to be
compromised" (ADR-0042) means.

**What it forecloses.** Nothing technically. Practically, it forecloses shipping the direct route
this year if it is the *first* thing built, because it is the largest thing on this sheet by a
wide margin.

**Verdict on C as asked:** it works, in exactly one form, and that form is a remote desktop with a
consent screen. It is the right answer for the portals B cannot pass, and it is not the right
*first* answer, because nothing observed yet says QA HE needs it.

### D — Persist the session between work items

Write the runner's cookies (`storageState`) into the envelope vault between pages, read them back.
**Rejected, on the constraint and on the numbers.** A session cookie is a bearer credential to the
student's account — it is the password's effect without the password's name — and the vault's
five-minute ceiling could not bridge the authorise wait in any case. It would solve only the
crash-between-consecutive-pages case, which A2 solves in memory without storing anything.

### E — Reset the password to get back in

Trigger the portal's forgot-password; the student receives the email and sets a new password.
**Not an option on its own**: the student sets the new password *in their own browser*, which
signs *them* in, not us; getting our runner in is then B. It is the recovery route when a student
has forgotten their password, and under `generated_ephemeral` it is already how handover completes
(`passwordResetCompleted`, ADR-0050 §4). Listed so nobody reaches for it as a fourth path.

---

## 3 · Side by side

| | **A — one sitting** | **B — ask again** | **C — co-browse** | **D — persist cookie** |
|---|---|---|---|---|
| Stores a credential | No | No | No | **Yes** (a bearer token) |
| Student acts | Once: yes, then password | Once per sign-in (a handoff) | Once per sign-in, at a screen | No |
| Works after handover | No — by design | **Yes** | **Yes** | No |
| Works after a crash | No | **Yes** | **Yes** | For five minutes |
| Passes CAPTCHA / app MFA | No | No | **Yes** | No |
| Under `generated_ephemeral` | **Yes** — the only shape | No | Not needed | No |
| Discovery it needs | None new | Login-form locators | None new | None |
| Size | 2–3 phases | 2 phases | Many; a new surface | 1, and rejected |
| Changes an accepted ADR | Step order (0049/0050 narrative) | Contract purpose set | 0037 topology, 0025 | Brief §8 |

---

## 4 · Recommendation

**A as the design, B as the resume path. C deferred until a target portal demands it. D rejected.
E is recovery, not a path.**

In one paragraph: the student says yes to the preview, chooses a password, and the runner creates
the account and fills every page in one signed-in sitting that lives in its memory and nowhere
else. If that sitting is lost — a crash, a timeout, a portal that logs the runner out, a second
sitting after handover — the run stops and asks the student to sign in once more through the same
secure box, and the fill agent types it once and destroys it. Nothing is stored at any point.
Every time the student is asked, it is because there was no other way in, and the run says so.

**Why A before B and not the reverse.** B alone would work today with fewer changes to the
orchestrator. It would also ask every student for their password twice on every application —
once to create, once to fill — and more on a multi-sitting fill. That is the phishing-normalisation
cost ADR-0020 names, paid routinely, to avoid a re-ordering the preview already permits. A pays it
only on the exceptional path.

**Why A1 (the re-order) and not A2 alone.** Without A1 the signed-in session waits on the
student's authorisation, which can take a day. No portal session survives that, so A2 alone would
route almost every run through B anyway.

**What would change my recommendation.** Discovery observing MFA or a CAPTCHA on QA HE's
*registration or login* page. Then A stops at `create_account` for that portal, B cannot pass the
login, and C moves from "deferred" to "the first target needs it" — at which point the honest
question is whether the direct route to that portal is worth a remote-desktop surface, or whether
that portal is an agent-handoff route (the student creates the account; we fill under B where the
login has no second factor). That is a decision for the day discovery says so, not for today.

**The counter-argument to weigh.** A pins a run to one runner for minutes and re-orders a flow
that four ADRs narrate. If you would rather not touch the order, B-first is a legitimate choice
with the cost stated above, and A2 can follow later.

---

## 5 · What each option means for the attachment path

Slices d and e of ADR-0099 (the runner's entry point performing execute work with the document
source; the `attach_document` intent and the `TransmissionRecord`) need a runner that performs
`execute`. **A2 is that runner.** Under any option above, the document hand-over built in P66 is
unchanged: the plane still answers a sixty-second URL only after the gates, under the lease.

---

## 6 · Portals with no login — what fraction of the direct-application route?

**I cannot tell from here, and I would rather say so than give you a number.** What the repository
knows is two targets, and both are behind an account:

- **QA Higher Education (Ulster Birmingham)** — an account is required, in the portal's own words
  (`phase-3-discovery-report.md` §A3). 103 read-only discovery runs saw zero file inputs *because
  the application is behind a login*.
- **University of Sheffield, PGT** — behind an account *as your description of it implies*
  (`target-sheffield-pgt.md`); unverified, no run made.

What I know from outside the repository, offered as background and not as an observation: the
platforms UK universities run direct applications on — Salesforce Experience Cloud, Ellucian
Banner, Tribal SITS e:Vision, Unit4, Technolutions Slate — are account-based without exception I
am aware of, and UCAS is account-based. Forms with no login exist, and they are enquiry forms,
short-course bookings and the occasional college — not the postgraduate direct application this
product is built around. **My expectation is that "no login" is an edge case of the direct route,
not half of it, and that expectation is not measured.** Two ways to measure it, either of which
you could commission: a read-only discovery sweep of the login boundary across a list of target
institutions (the runbook's `maxPages` 10–15 pattern, which costs nothing but runs), or a desk
count against the institutions in the AskiMate knowledge base.

**What serving it would cost, if you decide to.** Small and separate from A–C: `ClaimedWork`
carries an account's email and approach, and `accountDetail` answers null when there is no
account, so execute work is never handed out for an open portal. Making the account optional on
the wire is one phase. **What I recommend:** do not build it on an expectation. Leave the refusal
explicit — a run on an open portal stops and says so, as it does today — and build the shape the
day a real open-portal target is in the catalogue.

---

## 7 · What I need from you

Four things, each a sentence in your words:

1. **A1** — may `authorise` move before `request_secret` and `create_account`?
2. **A2** — may a runner hold a signed-in browser context across consecutive page items of one
   run, in memory only, for a bounded idle time (and what bound)?
3. **B** — is a second ask through the secure box, purpose `portal_sign_in`, single use, the
   resume path? This puts `portal_sign_in` into the published contract.
4. **Open portals** — serve now, or refuse explicitly until a real target appears?

C needs no decision today unless you want it recorded as the plan for a portal with a second
factor. D needs a no, which the constraint already gives.

**What does not wait on any of this:** the document transport, the gates, the hand-over, the
preview — all built. What waits: slices d and e, and the first fill a deployable runner performs.
