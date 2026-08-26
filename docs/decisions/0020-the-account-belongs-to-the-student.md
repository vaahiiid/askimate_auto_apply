# ADR-0020 — The account belongs to the student, and control is handed back

**Status:** **Accepted** — Vahid's decision, 2026-08-26
**Revised:** 2026-08-26 (later) — the preferred order of authentication approaches, §2
**Implements:** brief §7 (handoffs), §8 (no stored portal passwords), product rule 7
**Depends on:** [ADR-0004](./0004-branded-types-for-confirmed-values.md)

## The principle

> *"The application belongs to the student. The student's own email remains the account
> owner/contact. We may assist with account creation and application completion where authorised,
> but control must ultimately be handed back to the student."*

And, stated later and more sharply:

> *"AskiMate should never become the long-term credential holder for a student's university
> account."*

Everything below follows from those two sentences. The interesting design problem is not how to
create an account — it is how to make **not giving it back** something the system cannot do
quietly, and how to make **holding a password at all** something that requires a reason.

## The failure being prevented

A consultancy creates a portal account under an address it controls, keeps the password, and
thereafter the student cannot see their own application, cannot correspond with the university
directly, and cannot leave. That is not a hypothetical in this industry. It is a known pattern, and
nothing about it looks like a bug from the inside — every individual step is convenient.

So the controls are structural, not procedural.

## 1. The account's email is the student's own, and it is a `ConfirmedValue`

`PortalAccount.email` is `ConfirmedValue<string>`, which can only exist because the student
confirmed it (ADR-0004). There is no path that puts an AskiMate address there, because there is no
path that gets one confirmed as the student's own email.

`prepareAccountCreation` additionally refuses any address on one of our own domains. Belt and
braces, and the belt is the type.

## 2. There is a preferred order, and it is a function rather than a paragraph

> 1. *"If the university portal supports passwordless authentication, email verification, magic
>    links, or another official mechanism that does not require us to know the student's permanent
>    password, prefer that."*
> 2. *"If the portal requires a password during account creation… the password should be
>    automatically generated as a strong random credential… Treat it as an ephemeral credential only
>    if the portal technically requires it."*

"Prefer passwordless" is easy to write and easy to lose. The realistic way it gets lost is not that
someone disagrees with it — it is that the passwordless path is more work, the password path already
exists, and the password path is what gets used because it is the one that is written down.

So the ordering is data, the choice is a function over observed facts, and the function **refuses**
rather than falls through. `chooseApproach` walks this list and takes the first the portal supports:

| | Approach | Do we ever hold a secret? | Student present? |
|---|---|---|---|
| 1 | `passwordless` — a link or code the portal emails them | No | Yes, to open it |
| 2 | `student_chosen` — they type their own password | No | Yes |
| 3 | `portal_issued` — the portal emails them its own credential | No | Yes |
| 4 | `generated_ephemeral` — we generate one and hold it for minutes | **Yes** | No |

**For the record on authorship:** Vahid named 1 and 4 explicitly. 2 and 3 are derived from the same
principle rather than dictated — both are cases where the portal or the student already does the
thing and we simply must not get in the way, and both rank above 4 because under both we hold
nothing. If that ordering is wrong, this is the paragraph to argue with.

### The last two are separated by the student, not by the portal

This is the part that was wrong in the first implementation and that the tests caught. `2` and `3`
apply to *the same portal* — one that asks for a password at account creation. What separates them
is whether the student is at their keyboard to type it.

So `chooseApproach` takes `studentPresentAtCreation` as a second argument, and it has **no default**.
`false` is a real answer with a real consequence — we end up holding a secret — and a default would
make that consequence arrive without anyone having chosen it. When the plan does land on
`generated_ephemeral` because the student was not available, the plan says so in as many words:

> *the portal does let the applicant choose their own password, but the student will not be present
> at account creation to type it*

### "Unobserved" is not "no"

> *"Do not guess any portal behaviour that has not been observed."*

Each fact about a portal is `true | false | "unobserved"`, and `"unobserved"` **blocks**. If nobody
has established whether the portal offers a magic link, we do not get to conclude that it does not —
that is exactly the reasoning that would put us on the password path by default, and it would look
like a decision rather than an omission.

`chooseApproach` refuses with the list of unanswered questions, and the orchestrator turns that into
a specialist step. A portal nobody has looked at is not a portal we create accounts on.

### Handover is checked before the approach is

`chooseApproach` asks *"can the account be handed back cleanly?"* first, ahead of everything else,
including ahead of the unobserved check. A portal we cannot hand an account back from is not a
portal to create an account on, however convenient its login turns out to be. The refusal says so
plainly, and it is not a trade-off to weigh against convenience.

### The ranking is enforced, not advised

Without a gate, `chooseApproach` would be a suggestion: a caller could choose `passwordless`, ignore
it, and generate a password anyway. So `mintCredentialUnder(plan, …)` refuses unless the plan says
we may hold one — and it takes the whole plan rather than a boolean, because a boolean is something
a caller passes and a plan is something a caller has to have.

## 2a. The temporary password is generated, and is an object rather than a string

> *"Ideally, the generated password should never be exposed to a human operator… Never log it, put
> it into events, traces, screenshots, backups, analytics or ordinary application storage. Never
> make it retrievable by an AskiMate operator."*

A string gets logged. It gets serialised into an event, appears in an error message, a stack trace,
a Playwright trace, a support ticket, a database backup — and every one of those is a copy of a live
credential to a real person's university account, sitting somewhere nobody is thinking about.

`EphemeralCredential`:

- **generates its own secret, and has no other constructor.** There is no `create({ secret })`. A
  password a person chose — typed into a config, pasted into an issue, reused from somewhere else —
  cannot enter the system, because no function accepts one. A `@ts-expect-error` test asserts this,
  so adding such a constructor makes the directive unused and fails the build.
- hands the secret to a **callback** (`useTo`), never to a variable in the caller's scope, so the
  ordinary way of using it leaves no copy behind and does not run the task at all once the
  credential is dead
- redacts itself through **every** serialisation route JavaScript offers — `toJSON`, `toString`, and
  Node's `inspect`, which is what `console.log` uses. `Object.keys` returns nothing.
- **expires**, with no default expiry, and destroys itself on expiry rather than merely refusing —
  so a clock that later goes backwards cannot resurrect it
- can be destroyed explicitly, idempotently, and is destroyed at handover
- counts how often it was used, which is an audit signal: a rising number is a smell
- **refuses a portal policy that would make it weak** rather than honouring it. A portal capping
  passwords at eight characters is a fact a specialist should see; quietly generating an
  eight-character credential is how a weak one gets created with nobody having chosen to.

It is deliberately **not** `Brand<string>`. A branded string is still a string, and
`JSON.stringify` would happily write it out.

**What this does not claim:** the secret is in memory while it is alive, and `useTo` passes it to a
function that could keep it. That is unavoidable — something has to type it into a login form, and
no type system stops a callback being `(secret) => secret`. Nor does it stop an operator with a
debugger attached to the process. The claim is narrower and still worth having: **nothing an
operator can reach through the product — a record, a log, an event, a trace, an export — contains
it**, and the accidental copy, the one nobody decided to make, does not happen.

## 3. Handover is a checklist with no partial credit

Every item is a fact about the student's ability to get in **without us** — not about what we did.
"We sent them an email" is not on the list; "they can reset their password" is.

| | |
|---|---|
| `emailVerifiedByPortal` | the portal verified their own address — which they did, because we cannot |
| `studentInformed` | they know the account exists and where it is |
| `askimateRetainsNoAccess` | no live session, no stored token, no second factor pointing at us |
| `studentConfirmedAccess` | they said they are in |
| `passwordResetCompleted` | they set their own password through the portal's own reset flow |
| `temporaryCredentialDestroyed` | anything we held is gone |

All but one is an account the student cannot fully control. Recording that as "handed over" would be
the exact outcome this design exists to prevent, written down as a success. So it is
all-or-nothing, and the refusal lists everything outstanding at once rather than one at a time.

`studentConfirmedAccess` is the only item that cannot be inferred. Everything else is observable
from outside; that one is the student saying "yes, I'm in".

`askimateRetainsNoAccess` is new, and it comes from *"After successful handover, AskiMate must not
retain operational access to the account."* It applies under **every** approach including the ones
where we never held a password, because a signed-in browser session is operational access whether or
not a credential was involved.

### Two items apply only where there was a password

The last two rows apply only under `generated_ephemeral`. Under the other three approaches there is
no password of ours to displace and nothing of ours to destroy.

"Some items do not apply" is exactly the shape of a loophole, so what matters is how it is reached.
The approach is not a string a caller picks: it comes from `chooseApproach`, which refuses without
observations. Dropping `passwordResetCompleted` therefore requires discovery to have **observed** a
portal with passwordless sign-in. You cannot claim the item is inapplicable — you have to have found
a portal where it is. And the two items that are the *outcome* rather than the mechanism —
`studentConfirmedAccess` and `askimateRetainsNoAccess` — are on every list and no approach can drop
them.

## 4. A case cannot finish while an account is outstanding

`mayConcludeCase` refuses while any account is in a stage other than `handed_over` or
`not_required`. `handover_due` — meaning *we meant to* — is refused, because that is precisely the
state this check exists to catch.

## 5. We never intercept a verification code or a reset link

Never intercept, suppress or bypass MFA, email verification, or password recovery.

Concretely, that means **this system has no capability to read a mailbox** — not a disabled one,
none. The dependency-boundary check forbids `packages/account` from importing `imap`, `imapflow`,
`mailparser`, `@aws-sdk/client-ses` or `googleapis`, because a mail client here would be the
mechanism for exactly that. Where a code is needed, the run pauses and asks the student. It does not
go and look.

The password reset is the portal's own mechanism on purpose. It reaches their email, and we are not
in it.

## What the student is told, and when

Both texts are rendered deterministically, like the submission preview and for the same reason.

**Before creation:** that the account uses their own email so the university writes to them, what
will happen about signing in, that the account and application are theirs — and, under
`generated_ephemeral`, that a generated password will be used and that they will set their own
afterwards via "Forgot password".

**At handover:** where to sign in and with which address; under `generated_ephemeral`, to use
"Forgot password" now, that the reset link goes to an inbox only they can read, and that once done
the temporary password is gone.

The middle paragraph of both texts **differs by approach**, and that is not cosmetic. Telling a
student we will set a temporary password when we will not is a small lie that makes the handover
text later make no sense — and under the three approaches where we hold nothing, the honest thing to
say at handover is *"I have never had a password for this account and I do not have one now… I have
closed the session I was using."*

## This is a model, not a certainty

Vahid: *"If the actual portal has a different authentication mechanism, do not assume this model will
work unchanged. Discovery should determine the portal's real behaviour and you should then tell me
what must be adapted."*

Recorded, and this is now the main thing discovery is for. `chooseApproach` **cannot run** until
these eight questions are answered, and it names the unanswered ones:

1. Does the applicant choose their own password at account creation?
2. Does the portal generate a credential and send it to the applicant?
3. Does the portal offer passwordless sign-in — a magic link, an emailed code, or similar?
4. Must the email address be verified before the application form is reachable?
5. Is MFA or a one-time code required at any point?
6. Is a CAPTCHA present, and on which pages?
7. Does "Forgot password" work, and does the reset go to the account's own address?
8. Can control be handed back cleanly — no lingering session, no second factor bound to us?

`authenticationQuestions()` returns exactly this list, so the runbook, the discovery gap analysis
and the code cannot drift apart.

Things discovery may find that would change this:

- **The portal will not accept a password we choose** — some send their own initial credential to
  the applicant's email, which we cannot read. That is now `portal_issued` and it is *built*, not a
  gap: account creation becomes a student handoff, and we hold nothing. It still needs them present.
- **MFA is mandatory from account creation** — then every login is a handoff, and a run cannot
  proceed unattended at all.
- **The account is created by the university, not the applicant** — some partner portals issue
  credentials after an enquiry. Then there is no account creation step and this ADR mostly does not
  apply.
- **Email verification must be completed before the form is reachable** — then the run pauses
  earlier than modelled here, and the ordering in `AccountStage` needs a look.

None of these are guesses to build against now. Discovery answers them — and the shape of the answer
is already typed, so answering them is filling in eight fields rather than redesigning anything.
