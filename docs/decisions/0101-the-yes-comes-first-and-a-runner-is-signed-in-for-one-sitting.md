# ADR-0101 — The yes comes first, and a runner is signed in for one sitting

**Status:** **Accepted** — decided by Vahid Mohammadi, 2026-09-10
**Decides:** blocker 19, framed in
[`decision-sheet-blocker-19-how-a-runner-is-signed-in.md`](../decision-sheet-blocker-19-how-a-runner-is-signed-in.md)
**Amends:** [ADR-0049](./0049-the-run-driver-drives-the-case-machine.md) and
[ADR-0050](./0050-the-account-lifecycle-completes-through-the-students-own-decision.md)'s step
narrative (the account asks now follow the authorisation); [ADR-0045](./0045-the-runner-pulls-leased-work.md)
(a runner may keep a signed-in context between consecutive items of one run)
**Applies:** [ADR-0020](./0020-the-account-belongs-to-the-student.md) §2,
[ADR-0034](./0034-the-vault-is-ephemeral.md) (the five-minute ceiling),
[ADR-0042](./0042-the-credential-is-consumed-inside-the-secure-plane.md),
[ADR-0065](./0065-a-run-only-a-person-can-carry-on-stops-and-says-so.md)

## The decisions, in his words

Six, answering the sheet's §7 and its options by letter, plus one requirement the sheet did not
list. Quoted so that what is recorded here is what was typed.

**A1 — the order.**

> *"Yes. Authorise moves before request_secret and create_account. The consent argument decides
> it on its own, before any of the session reasoning: today we ask a student for their university
> password for an account they have not yet agreed to have created, to submit an application they
> have not yet seen. That order is wrong even if it cost us nothing to keep."*

**A2 — the session.**

> *"Yes, in memory only, and the bound is five minutes, not ten. Match the vault's ceiling from
> ADR-0034. Two different timeouts for two sensitive things is how someone eventually applies the
> wrong one. If five minutes turns out to be too short in practice, tell me with the measurement
> and I will reconsider it — do not quietly widen it."*

**B — the resume path.**

> *"Yes, portal_sign_in through the secure box, single use, as the resume path only. Your
> phishing-normalisation argument is the reason it is the resume path and not the routine one, and
> I want that reasoning in the ADR rather than the mechanism alone. A future phase that finds B
> simpler than A must meet the argument, not just the design."*

**Open portals.**

> *"Refuse explicitly. Do not build for them. Your expectation that they are an edge case is
> unmeasured and you marked it as an expectation, which was right. Leave the refusal where it is
> and build the shape the day a real open-portal target is in the catalogue."*

**C — co-browsing.**

> *"Record it as the plan for a portal with a second factor, so the day discovery finds one we
> start from your analysis rather than from scratch. Do not build it."*

**D — a persisted cookie.**

> *"No, as the constraint already gives."*

**The requirement that was not on the list.**

> *"Your recommendation rests on QA HE having no CAPTCHA and no MFA at registration or login, and
> the sheet says both are unobserved. So the plan is sound and its main premise is untested.
> Before slices d and e, make the system detect that condition rather than assume it. If a runner
> meets a CAPTCHA or a second factor where A expects neither, it must stop and say which it met,
> not fail as a fill error. That refusal is the signal that moves C from deferred to needed, and I
> would rather it arrive as a stated refusal than as a confusing failure months from now."*

## Context

Blocker 19 was found in P66 (ADR-0099): the runner's entry point performed `create_account` only,
and execute work had no production performer, because the browser session that account creation
signs in dies with the work item that made it and the password that would sign in again was
consumed once inside the Secure Plane (ADR-0042). The sheet costed five shapes. This ADR records
what was decided and what the decisions require of the code.

## 1 · The yes comes first — built in this phase (P69)

`nextStep` now derives the step in this order:

```
interview → validate → authorise → request_secret → create_account → [email verification] → execute (per page) → hand_over_account → ready_to_submit
```

Before: the account asks sat between the interview and validation, so a student chose a password
and had an account created before reading the preview. The change is one move in
`packages/orchestrator/src/run.ts`: `accountStepFor` is consulted twice. **Its refusals stay early**
— an unobserved portal, no confirmed email, an account that cannot be handed back go to a
specialist before the student is asked for anything, because a yes given to an application we
cannot get into is a yes wasted, and none of those refusals is the student's to answer. **Its asks
come after the authorisation** — the password box, the creation, the email-verification handoff,
and, once the form is filled, the handover (ADR-0050). `ready_to_submit` is still reached only
once the account is the student's again.

The preview (ADR-0059) hashes the plan, the documents and the destination and does not depend on
an account, so the hash a student authorises is unchanged by the move. The authorisation is
captured through the driver exactly as before (ADR-0049); only what follows it changed.

**What this changes for a student:** they read what will be typed, say yes to it, and only then
are asked to choose a password for an account that will be created in their name. The secure
channel's own script already says the password *"is used once, to set up your account"*; it is
now asked for at the moment that is true.

## 2 · One sitting, in memory, five minutes — P71 (slice d)

A runner that creates the account keeps the sensitive browser context the portal signed in, and
claims the next page of the same run in it. The Run Driver prefers the holder that has the
session when that holder asks. The context is held **in memory only**, closed when the run's pages
are saved, when the process stops, or when it has been idle for **five minutes** — the vault's
ceiling (ADR-0034), on Vahid's rule that two sensitive lifetimes must not differ. That number is
the vault's constant, referenced, not a second constant. If it proves too short, the measurement
goes to Vahid; the bound is not widened.

ADR-0047 holds: a lease still names one page; the intent ledger still says which pages are saved;
any runner may still claim a run — it arrives logged out, which is §3.

**Built in P71 (2026-09-10).** `SessionHold` (`apps/browser-runner/src/session-hold.ts`) keeps
the sensitive browser context a run's account was created in, keyed by run, in memory, and
closes it once it has been idle for `SECURE_HOLD_CEILING_SECONDS` — one constant in
`packages/contracts`, from which the vault's `VAULT_TTL_CEILING_SECONDS` is now defined rather
than a second literal beside it, so the two lifetimes cannot drift apart. The runner's entry point
performs `execute` through `runnerPerformer`: the held page, attached as a fillable session
confined to the portal's host, `fillApplication`, and the disclosure source of ADR-0099. A claim
names the runs the runner holds a session for — `sessions`, required on the wire — and the Run
Driver offers such a run to its holder first, and offers `execute` to nobody else: the run waits
for its holder, or for §3. The hold is released when the run's last page is saved, on a challenge
(§6), when the student is needed, and when the process stops. `fillApplication` leaves the
register: the runner reaches it. The resume path followed in P72 (§3); until then the journey's
restart test signed in by a cheat it marked as such.

## 3 · `portal_sign_in` is the resume path, and the reason is recorded — P72

When execute work needs a session and no runner holds one — a crash, a timeout, a portal that
logged the runner out, a second sitting, any page after the handover — the run opens a secure step
with purpose `portal_sign_in`. The student types the password they chose into the same secure
frame; the fill agent types it into the login form over CDP; the handle is single-use and
destroyed. `portal_sign_in` enters the published contract, closing the divergence
`scripts/contract-drift.test.ts` records.

**Why it is the resume path and not the routine one — the argument a future phase must meet.**
B is simpler than A: it needs no re-ordering and no session held anywhere, and it works today's
shape. It is not the design, for this reason, already in ADR-0020 and in `secretStepFor`'s own
comment:

> *A student being shown a password box is a moment of trust, and the realistic damage is not a
> leak — it is asking for one when we did not need it. Someone who is asked for a university
> password by a chatbot that did not have to ask has learned that being asked is normal, which is
> precisely the lesson a phishing attempt relies on.*

Under B-as-routine every student is asked for their university password at least twice per
application — once to create the account, once to fill — and once more for every further sitting.
Under A they are asked once, and a second time only when there was no other way in, and the run
says so. Every avoidable ask is a lesson in the wrong direction. **A phase that proposes B where A
would do has to show why the extra ask is unavoidable, not that B was less work.**

**Where B does not apply.** Under `generated_ephemeral` there is no password the student knows.
Under a portal with a second factor or a CAPTCHA at login, B cannot pass; that is §5.

**Built in P72 (2026-09-10).** The plane knows a session is gone from the runners' own reports
and the one ceiling: each report that could only have come from a signed-in browser — an
account created, a sign-in done, a page saved — records who and until when in `run_sessions`
(migration 0019), and the runner's `SESSION_ENDING_FAILURES` (the contract's list, read by both
ends) erase it. Past the ceiling, or erased, `nextStep` takes the resume path instead of
`execute`, and only where there is an account to sign back in to: `request_secret` with purpose
`portal_sign_in`, typed once (the portal is the check), with `describeSignInResume` as the
explanation the student reads inside the frame — the one reason it is happening, that it is the
exception, and what happens to the password. Then the `sign_in` step and work kind: the login
form the reviewed blueprint records (`authentication.login`, new and optional, so no reviewed
hash moved), the handle, no plan; `signInToPortal` in the runner types the email, has the fill
agent type the password, submits, and asks the page — a refusal is `portal_refused`, a code
after acceptance is `second_factor_met`; the context it signed in is the run's held session
(§2), and the fill follows to that runner. Which request is the sign-in's is read from the log's
own times against the ledger's: a request opened after the account existed can only be the
resume path's. A sign-in writes no intent — the Secure Plane's lifecycle records the one thing it
spends, and repeating one creates nothing. Where the path cannot apply — the student typed their
password into the portal themselves, no password ever reached us, or the blueprint records no
login form — the run says so to a specialist before any box is opened. `portal_sign_in` entered
the published contract and `portal_password_reset` left it, so the domain's purposes and the
contract's agree and `scripts/contract-drift.test.ts` now asserts the agreement it had recorded
as a divergence since P27. The journey's restart is driven through this path in full: an empty
hold, the plane looked at from past the ceiling, the second ask in the real frame, a real sign-in
by the production performer, page two and not page one.

## 4 · Open portals are refused, explicitly

A portal with no login is not served. `accountDetail` answers null with no account, execute work
is not handed out, and the run stops and says so through ADR-0065's machinery rather than
pretending. The shape — an account optional on the wire — is one phase, built the day a real
open-portal target is in the catalogue and not before. The sheet's §6 records why the fraction is
unmeasured and how to measure it.

## 5 · Co-browsing is the plan for a portal with a second factor — recorded, not built

If discovery observes MFA, an authenticator push, or a CAPTCHA at a target portal's registration
or login, A stops at `create_account` and B cannot pass the login. The plan for that day, so it is
started from the sheet's analysis and not from scratch:

- **The session must be in the runner's browser.** A session in the student's own browser cannot
  be moved without exporting a cookie, which is a stored bearer credential and what brief §8
  forbids in substance.
- **So the student drives the runner's browser for the login.** A CDP screencast of the runner's
  page streamed to the student's page through the secure origin, with keystrokes and clicks
  forwarded, for the duration of the login only. The service that does this lives in the Secure
  Plane, never the Conversation Plane (ADR-0037); frames are streamed and never stored (ADR-0025).
- **What it costs.** A new deployable surface with its own security review; a runner pinned to a
  person's pace with leases to match; a viewer in the student page; latency and support.
- **What decides it.** The stated refusal of §6, arriving from a real portal. Until then it is not
  built, and the honest alternative for such a portal is an agent-handoff route: the student
  creates the account, and we fill under B where the login has no second factor.

## 6 · A runner that meets a CAPTCHA or a second factor stops and says which — P70

Before slices d and e. The runner detects, at registration, at login and during a fill, that the
page is asking for something the plan assumed absent — a CAPTCHA, a one-time code, an
authenticator prompt — and the work item ends with a **stated refusal naming which**, never a
generic fill failure. The refusal is a closed code on the wire, the run stops through ADR-0065's
machinery and the student is told a person must act, and the record names the portal and the
condition. That record is the signal that moves §5 from recorded to needed.

**Built in P70 (2026-09-10).** Two codes on the wire, `captcha_met` and `second_factor_met`, in
the closed `WorkFailure` set and the published contract. The runner reads the page for a challenge
at four points: the registration form before a character is typed and before the Secure Plane is
asked to spend the handle; the page the portal answers a registration with, where a second factor
means the account may now exist; the application form before the fill; and the page a fill was
bounced to, so a sign-in gated by a code is named as such rather than as "needs the student". The
detector (`apps/browser-runner/src/challenge.ts`) keeps discovery's vocabulary and drops its loosest
rules on purpose — discovery's `input[name*=code]` fires on a postcode box, and a signal that stops a
live run must not — so it looks for a widget or its response field, a one-time-code field by
autocomplete, name, id or label, and not a bare script tag. The asymmetry is deliberate: a challenge
it misses fails the way it always did; one it sees stops with the reason named.

On the plane, `reportWork` gives the code a home. Found while building it: **since P5 every failure
a runner reported was recorded as `failed_cleanly` and the code discarded** — `needs_the_student`
did nothing, and a challenged registration would have been offered again on the next poll and met
the same challenge, the confusing failure the requirement names. Now a challenge raises an
intervention through the one stop mechanism (ADR-0048, ADR-0065): reason `new_portal_behaviour` for
a CAPTCHA, `authentication_failure` for a second factor; `encountered` names the challenge, the
action, the page and what the reviewed observation had recorded, and for a creation met by a second
factor that the account MAY ALREADY EXIST; one fixed message to the student per code; status
`escalated`, which `claimWork` never offers. Every other failure is exactly as it was. The fixture
portal presents both — a widget the POST refuses without, and a code asked for after the form is
accepted — and both are met by the real runner in a real browser.

## Consequences

- Consent order is right: the yes precedes the password and the account.
- A student is asked for their password once on the ordinary path, and every further ask is a
  stated exception.
- No password, cookie or token is stored anywhere, under any of the four paths.
- The recommendation's premise — no CAPTCHA, no second factor at QA HE — becomes something the
  system reports rather than assumes.
- ADR-0050's narrative *"an authorised run has typed nothing yet"* is still true, and now also:
  an authorised run has no account yet.

> **Known consequence, recorded 2026-09-10 (P79).** A1 puts the yes before the account, and the
> yes is over a preview rendered from a reviewed blueprint of the form. So a reviewed blueprint of
> the form is a precondition of the system creating the account — and a blueprint of a form
> behind a login needs an account to see it. Neither of us saw the loop when A1 was decided.
> Vahid: *"The loop is a consequence of A1 and neither of us saw it. Moving the yes before account
> creation was right and I would decide it the same way again, but it means a blueprint is a
> precondition of the account that a blueprint needs an account to see. Record that as what it is:
> a known consequence of a decision, not a defect, and the reason attached inspection exists."*
> The way through is not the runner: a person creates the account and signs in by hand, and
> **attached inspection** (`pnpm run inspect:attached`, `apps/browser-runner/src/attached-inspection.ts`)
> reads the signed-in form read-only over CDP and writes the draft. The first blueprint of a form
> behind a login is made that way; the account the runner creates comes after the review, as A1
> requires.

## What was built in P69

- `packages/orchestrator/src/run.ts` — the account asks after the authorisation; the refusals
  before it.
- `packages/orchestrator/src/orchestrator.test.ts` — the order asserted; every account test starts
  from an authorised run.
- The journey and the driver's tests re-ordered to the flow a student now takes.
- The decision sheet marked decided; blocker 19 closed in the state document.

## What follows

P70 (§6), P71 (§2, slice d) and P72 (§3) are built. Slice e follows. Nothing in §5 is built.
