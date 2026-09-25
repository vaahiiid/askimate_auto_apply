# ADR-0144 — We create the account, the student does not; the item-6 run starts from nothing, and a verification link is the student's act in chat

**Status:** Accepted · 2026-09-25 · amends 0110 §2 for the item-6 run · continues 0020 §5 (the mailbox is never read), 0114 (two attempts, then a person), 0131 (a consent notice is answered only with the student's own choice)
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-25, on reading that item 6 had been framed as starting on an account he would register by hand. Built in P219 inside item 6 of the list to `ready_to_submit`; no seventh item.

## Context

The list in `docs/what-stands-between-a-person-and-ready-to-submit.md` had item 6 — the signature
and the run — starting on *"the clean account under a dedicated e-mail"*, which read as an account
he would register himself before the run. That contradicted a decision he had made earlier in the
week and had not written into an ADR: the system creates the student's account; the student does
not.

Account creation was already the orchestrator's default. `create_account` is the step a run takes
when the student has not recorded an existing account (ADR-0110), the runner's `createPortalAccount`
was proven on the fixture portal, and the driver's ADR-0114 shape — two attempts, then a person —
was built around it. What was missing was measured, not reasoned: the runner's creation had no
branch for the portal's consent notice. The sign-in had one (ADR-0131), because attempt 1 of Run A
met the notice at the sign-in button with the password already typed. On Sheffield the registration
form and the sign-in form are one page under one notice, so a creation would have met the same
notice at the same kind of press — and reported `uncertain`, with the password spent, which the
fixture test written first showed before the fix.

His question was whether creation is buildable into item 6 or is a seventh item, what it depends
on, and what Sheffield's registration does about a verification link, which nobody here has read.

## Decision

In his words:

> *"On the account: you have item 6 starting on an account I register by hand. That contradicts a
> decision I made earlier in the week — we create the account, the student does not."*
>
> *"And if it IS the verification link: my position has not changed. We tell the student in chat to
> open their mailbox and confirm, and they press a button saying they have. We never touch the
> mailbox. That keeps ADR-0020 §5 whole."*
>
> *"I would rather item 6 be the real thing — a person with nothing, who ends with an account and
> a filled application. If that costs another item, say so and I will take it. If it turns out
> account creation genuinely cannot be in this run, say why, and I will register by hand for this
> one and we do it properly for the next."*

And, from earlier the same day, what the run needs from him:

> *"I will make a dedicated e-mail. Tell me when you need it and what else the clean account needs
> from me at that point."*

So:

1. **The item-6 run starts from no account.** The system creates it, on the dedicated e-mail he
   makes, with a password only he has typed, through the secure channel (ADR-0020, ADR-0042). ADR-0110
   §2 — *"the run enters my existing account"* — is amended for this run and this run only: the
   account is still his, still the one an `ownAccountOnly` approval names (ADR-0118), and it comes
   to exist by the run rather than before it. Nothing in ADR-0110's refusal of a synthetic applicant
   changes: the details typed are his own real ones, by his own authorisation (*"me, on my own account, with my own real details"*).
2. **A verification link, if the portal sends one, is his act, in chat.** The mechanism exists and is
   unchanged: a portal whose entry records `emailVerificationRequired` leaves the account at
   `awaiting_email_verification`, and the run hands off with the reason `email_verification` — the
   student is told *"I cannot read your email, so I will wait until you tell me it is done"*, and
   says so in the chat. The mailbox is never read (ADR-0020 §5). Sheffield's entry records
   `emailVerificationRequired: false`, on his own observation of 2026-09-11 (AUTH 4: *"went
   straight into the form. No email had to be opened, no link clicked"*). If that observation was
   wrong, the run stops at the handoff and asks him; it does not stop for a person, and it does not
   look in the mailbox.
3. **The creation meets the consent notice before it types anything.** The runner checks the
   registration form's submit control for something standing over it before a character goes in.
   If that something is the notice and no choice of the student's is on record, the creation stops
   with `consent_banner_met` — nothing typed, no password spent, no account attempted. With a choice
   on record it presses the path the entry names and reads the portal's record back, exactly as the
   sign-in does (ADR-0131, P169), and only then types. The question the student is then asked is the
   same question in the creation's words: *"Before I can create your account on …"*.
4. **The ledger keeps the code the last completion closed with, attempt or not.** ADR-0122's list
   holds only the attempts made, on the line ADR-0114's count draws; a creation that met the notice
   is not an attempt and appeared nowhere. Migration 0008 adds `last_failure` to the intent row so
   the driver can derive the creation's `consentChoiceNeeded` from durable state, as it derives the
   sign-in's from its session record — and never from a runner's memory.

## What this decides, and what it does not

- It decides the item-6 run's starting point and the shape of the creation's consent path. It does
  not decide that the consent question is put to the student *before* the runner meets the notice;
  today the runner meets it, types nothing, and the question follows. Asking up front, on the
  blueprint's word alone, would be a reading rather than a measurement, and is his to decide.
- It does not read Sheffield's registration beyond the three boxes and one button on page 0 and
  his observation. What the portal does with a duplicate e-mail, and whether a created account lands
  on `personal.do` — which is how the runner reads success, by the path changing — are rows in
  `state-of-the-system.md`, not phases.
- It does not change the two hard rules that hold at every step: no other real student's data,
  and nothing submitted.

## What it costs

No seventh item. P219, by the clock, is inside item 6's build; the run itself remains his acts once:
the dedicated e-mail, the local stack on the catalogue, a fresh `students` row whose id goes into the
approval, one signature, his answers in the chat, his consent choice when asked, his password in the
secure box, and the run to `ready_to_submit`. The runbook is `docs/run-a/item-6-runbook.md`.
