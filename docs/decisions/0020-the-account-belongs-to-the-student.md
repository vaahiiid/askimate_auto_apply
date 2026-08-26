# ADR-0020 — The account belongs to the student, and control is handed back

**Status:** **Accepted** — Vahid's decision, 2026-08-26
**Implements:** brief §7 (handoffs), §8 (no stored portal passwords), product rule 7
**Depends on:** [ADR-0004](./0004-branded-types-for-confirmed-values.md)

## The principle

> *"The application belongs to the student. The student's own email remains the account
> owner/contact. We may assist with account creation and application completion where authorised,
> but control must ultimately be handed back to the student."*

Everything below follows from that. The interesting design problem is not how to create an account —
it is how to make **not giving it back** something the system cannot do quietly.

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

## 2. A temporary password is an object, not a string

A string gets logged. It gets serialised into an event, appears in an error message, a stack trace,
a Playwright trace, a support ticket, a database backup — and every one of those is a copy of a live
credential to a real person's university account, sitting somewhere nobody is thinking about.

`EphemeralCredential`:

- redacts itself through **every** serialisation route JavaScript offers — `toJSON`, `toString`, and
  Node's `inspect`, which is what `console.log` uses
- **expires**, with no default expiry, and destroys itself on expiry rather than merely refusing —
  so a clock that later goes backwards cannot resurrect it
- can be destroyed explicitly, idempotently, and is destroyed at handover
- counts how often it was read, which is an audit signal: a rising number is a smell

It is deliberately **not** `Brand<string>`. A branded string is still a string, and
`JSON.stringify` would happily write it out.

**What this does not claim:** the secret is in memory and `reveal()` returns it. Something has to
type it into a login form. What is removed is the *accidental* copy — the one nobody decided to
make. `reveal()` is conspicuous by name and its call sites are countable.

## 3. Handover is a checklist with no partial credit

Every item is a fact about the student's ability to get in **without us** — not about what we did.
"We sent them an email" is not on the list; "they can reset their password" is.

| | |
|---|---|
| `emailVerifiedByPortal` | the portal verified their own address — which they did, because we cannot |
| `studentInformed` | they know the account exists and where it is |
| `passwordResetCompleted` | they set their own password through the portal's own reset flow |
| `temporaryCredentialDestroyed` | anything we held is gone |
| `studentConfirmedAccess` | they said they are in |

Four out of five is an account the student cannot fully control. Recording that as "handed over"
would be the exact outcome this design exists to prevent, written down as a success. So it is
all-or-nothing, and the refusal lists everything outstanding at once rather than one at a time.

The last item is the only one that cannot be inferred. Everything else is observable from outside;
that one is the student saying "yes, I'm in".

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

**Before creation:** that the account uses their own email so the university writes to them, that a
temporary password will be used to complete the application, that they will set their own password
afterwards via "Forgot password", and that the account and application are theirs.

**At handover:** where to sign in, with which address, to use "Forgot password" now, that the reset
link goes to an inbox only they can read, and that once done the temporary password is gone.

## This is a model, not a certainty

Vahid: *"If the actual portal has a different authentication mechanism, do not assume this model will
work unchanged. Discovery should determine the portal's real behaviour and you should then tell me
what must be adapted."*

Recorded. Things discovery may find that would change this:

- **The portal will not accept a password we choose** — some send their own initial credential to
  the applicant's email, which we cannot read. Then account creation is a student handoff, not an
  automated step, and the flow is simpler but needs them present.
- **MFA is mandatory from account creation** — then every login is a handoff, and a run cannot
  proceed unattended at all.
- **The account is created by the university, not the applicant** — some partner portals issue
  credentials after an enquiry. Then there is no account creation step and this ADR mostly does not
  apply.
- **Email verification must be completed before the form is reachable** — then the run pauses
  earlier than modelled here, and the ordering in `AccountStage` needs a look.

None of these are guesses to build against now. Discovery answers them.
