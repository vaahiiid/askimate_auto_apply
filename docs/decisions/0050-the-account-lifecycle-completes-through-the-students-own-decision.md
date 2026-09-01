# ADR-0050 — The account lifecycle completes through the student's own decision

**Status:** **Accepted** — decided by Vahid, 2026-09-01 ·
**Date:** 2026-09-01 · **Supersedes:** nothing ·
**Amends:** [ADR-0020](./0020-the-account-belongs-to-the-student.md) §3 ·
**Related:** ADR-0004, ADR-0008, ADR-0014, ADR-0031, ADR-0041, ADR-0047, ADR-0048, ADR-0049

## Context

P11 gave the run driver the case machine and gave the student a way to make the
one decision that is theirs. It ended with two steps still unreachable, named in
ADR-0049 §6, and with the note that `mayConcludeCase` "still means no case can
finish".

Measured on `main` at `006f091`:

| The run asks | What resolved it |
|---|---|
| `student_handoff` — "open the email and follow the link" | **nothing** |
| `hand_over_account` — "here is your account back" | **nothing** |

And underneath them, the reason both were unreachable:

- **`AccountStage` never moved.** `accountCreated` derived `active` or
  `awaiting_email_verification` from a portal observation and there was no
  function anywhere that produced any other stage. `handover_due` and
  `handed_over` were words in a union that nothing wrote.
- **`HandoffRequired` and `HandoffCompleted` were folded and never produced.**
  `fold` has consumed them into `openHandoffToken` since the machine was
  written; no intent created either.
- **`mayConcludeCase` had no caller, and could not have had one.** It refuses
  any account not `handed_over` or `not_required`, and no account could be
  `handed_over`.

The three are one gap. An account that cannot change stage cannot be handed
back, and a case that cannot hand an account back cannot finish — which is the
rule ADR-0020 §4 exists to enforce, enforcing itself into a deadlock.

## Decision

### 1 · The student's fact arrives as a student decision, unchanged from P11

No new mechanism. `StudentDecision` is the closed set P11 built, and it shipped
saying that `student_handoff` and `hand_over_account` "need exactly this
mechanism pointed at the account lifecycle, and they are the next phase". They
did, and it cost **one member**: `confirm_handoff`.

The decision arrives on the student's own authenticated session, on the route
that already exists, and it carries a hash and nothing else.

#### Why the member does not name what was confirmed

The obvious shape is a member per thing — `confirm_email_verified`,
`confirm_password_reset`, `confirm_account_access`. Every one of those puts the
**subject** of the confirmation in the client's hands, and the subject is
exactly what must not come from there: a client that could name the handoff
could confirm a password reset the student never did.

A case has at most one open handoff — `decide` refuses a second — so what was
confirmed is already a fact the server holds. The student's message is *"I have
done the thing you asked"*; the case says what was asked. That is the rule
`parseSecureAppend` and `parseResolutionSubmission` both follow, applied to the
one field somebody would otherwise have been tempted to send.

It also means `mfa`, `otp`, `captcha` and `payment` need no new member when
their turn comes.

### 2 · The authoritative record is the handoff event pair

`require_handoff` and `complete_handoff` are new intents on the case machine.
The events they produce already existed.

- The **token** is derived from the case and the kind, not minted. The run
  raises a handoff every time it decides, because deciding is what it does on
  every poll — so a fresh token per decision would open a second handoff every
  time. Raising twice is one handoff; `decide` answers `accepted` with **no
  events** for a token already open, and that is what makes a poll silent.
- A **different** handoff while one is open is refused rather than silently
  replacing it. Two things only the student can do, one of which the system has
  forgotten it asked for, is how somebody ends up waiting on something nobody is
  going to tell them about.
- `HandoffCompleted` gained `handoffKind`, and `fold` gained `raisedHandoffs`
  and `completedHandoffs`. "Has the student verified their email?" is a question
  about the whole log, not about what is open now.

`HandoffRequired.handoffKind` also gained `email_verification`,
`password_reset` and `account_handover`. The run vocabulary could already say
`email_verification` and the case vocabulary could not, and the nearest member
was `identity_verification` — proving you receive mail at an address is not
proving who you are, and recording one as the other would put a claim about
identity in the audit log that nobody made.

### 3 · `handover_due` is derived, and nothing stores a stage

`AccountStage` has never been persisted and does not start being. A stored stage
is a second answer to *"where is this account"*, and this repository has already
had two models of one thing come apart — ADR-0041 exists because of it, and
ADR-0047 turned on the same principle for page progress.

The derivation reads four things that were already authoritative: the confirmed
profile, the reviewed portal observations, the intent ledger, and the case log.

```
handed_over                  the checklist passed
awaiting_email_verification  the portal emailed them; no completion recorded
handover_due                 the application is done and the account is ours
active                       usable, and not yet theirs
```

"The application is done" is the run having **filled** the portal — not having
been authorised. An authorised run has typed nothing yet, and handing the
account back before the form is filled would mean asking the student to change
the password we are about to sign in with.

A consequence worth stating plainly, because it changes what a finished run
looks like: **`ready_to_submit` is now reached only once the account is the
student's again.** A run that reported itself ready while still holding their
credentials had skipped part of the work.

### 4 · The proof of receipt, where the portal does not verify — Vahid, 2026-09-01

`emailVerifiedByPortal` is on every checklist in ADR-0020 §3. It is not really
about verification: it is the only external proof that **the student can receive
mail at the account's address** — the recovery route, without which "the account
is theirs" is a claim rather than a fact.

On a portal that does not verify addresses there is no such verification to
have, and the item could never become true. Under the checklist as written, **no
account on such a portal could ever be handed over, and no case involving one
could ever conclude.** That is a deadlock, not a safety property, and ADR-0020
did not decide it: it frames the item as *"the portal verified their own address
— which they did, because we cannot"*, assuming portals verify.

Where it bites is narrower than it looks, and the trace is the reason the fix is
what it is — three of the four approaches already prove receipt by other means:

| Approach | How receipt is already proved |
|---|---|
| `passwordless` | they sign in with an emailed link or code |
| `portal_issued` | the portal emails them the credential |
| `generated_ephemeral` | `passwordResetCompleted` is already required |
| `student_chosen` | **nothing in the flow ever emails them** |

So on a portal where discovery observed `emailVerificationRequired: false`,
`emailVerifiedByPortal` is **replaced** by `passwordResetCompleted`. The
portal's own password reset also reaches their inbox. The count of proofs of
receipt stays at one and it is still the portal's email that provides it — only
the mechanism changes.

**Rejected: dropping the item.** Mechanically it mirrors the existing
approach-based exemption, but that one drops items *because the risk does not
exist* — there is no password to displace. Here the risk still exists and only
the check would be gone.

**Rejected: leaving the deadlock.** Safest reading of ADR-0020, and it makes a
real class of portal permanently unfinishable.

`applicableItems` therefore takes the observation as well as the approach, and
`checkHandoverComplete` now takes the whole **plan** rather than an approach —
the same reason `mintCredentialUnder` does (ADR-0020 §2): a boolean is something
a caller passes, and a plan is something a caller has to have. The plan carries
`basedOn`, so which items apply is decided from the discovery observations
themselves rather than from two arguments a caller could pass inconsistently.

### 5 · Two confirmations where two facts are needed

The checklist is all-or-nothing over **independent** facts. Where both the reset
and the confirmation of access apply, they are raised in sequence — reset first,
then access — and each is its own handoff with its own message and its own hash.

One confirmation covering both would record a student who pressed *"yes, I'm
in"* as having also completed a password reset they never did. That is the
"some items do not apply" loophole in a new dress.

The order matters: the confirmation is about the account **after** the reset.
Asked the other way round, a student would confirm they can sign in with a
password we chose, and then change it.

### 6 · What the student is shown, and what the hash binds

`hand_over_account` carries two lists for a reason. The full checklist is the
**gate** and includes our items — that we have told them, that we retain no
access. The student is shown only the items they can act on.

Showing them the gate would be showing somebody a to-do list containing "the
student has been told the account exists". It is also unstable in a way that
matters: telling them is what makes `studentInformed` true, so the message would
change the moment it was sent — and a confirmation is bound by a hash of exactly
what they were shown. **The message a student confirms has to be the message
they read.** This was found by the journey test, which returned `409
content_changed` on a confirmation the student had just been sent.

### 7 · No new case state, and `AWAITING_HANDOFF` stays unreached

Vahid, 2026-09-01: **no terminal state is added.**

No terminal state (`CONFIRMED`, `CANCELLED`, `FAILED_PERMANENT`) is reachable
without submitting, and submission is a later phase. `CONFIRMED` means the
portal confirmed a submission; reaching it any other way would be untrue.
A case therefore rests at `AUTHORISED` with its account handed back, and
"concludable" means `mayConcludeCase` answering `true` — an account-level gate,
which is what ADR-0020 §4 always said it was. A finished case is already
distinguishable: account stage `handed_over`, run step `ready_to_submit`.

`AWAITING_HANDOFF` — a state the machine has for exactly this — is deliberately
**not** used. Moving a case there takes it off `CASE_SPINE`, and `nextCaseHop`
will not walk a case that has left the spine back onto it: "whatever put a case
there decides" (ADR-0049 §1). Using it would need an `AWAITING_HANDOFF →
AUTHORISED` edge the transition table does not have, and would buy nothing —
nothing gates on the state, the handoff events carry the fact, and the run's
phase already says precisely what is being waited on. If a future phase wants
the case state to be that precise, it is a transition-table change with its own
ADR.

## Consequences

- **`mayConcludeCase` has a caller.** `RunDriver.mayConclude` asks it about the
  account the run derives, and the P7 journey ends by asserting it answers
  `true`. It is the first time in the repository's history that it could.
- **A run is not finished until the account is back.** `ready_to_submit` now
  follows the handover rather than preceding it. Two existing tests asserted the
  old order and were changed deliberately.
- **The student is asked twice on a non-verifying portal**, and once on a
  verifying one. That is the cost of §5 and it is the right way round.
- **`generated_ephemeral` accounts cannot yet be handed over.** Nothing in this
  service holds that credential — the runner mints it, uses it through `useTo`
  and lets it expire — so nothing here can truthfully say it is gone.
  `temporaryCredentialDestroyed` stays `false` and the account stays
  outstanding, which is the safe direction. Closing it needs the runner to
  report the destruction, and that is a later phase.
- **A handoff does not expire.** `HandoffRequired.expiresAt` is required by the
  event and nothing reads it. A student who has not followed a verification link
  by Friday has not lost the right to; what an expiry would buy is a way to stop
  asking, and stopping asking is a product decision nobody has made.
