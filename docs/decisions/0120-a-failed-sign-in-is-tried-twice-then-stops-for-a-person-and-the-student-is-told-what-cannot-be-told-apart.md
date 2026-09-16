# ADR-0120 — A failed sign-in is tried twice, then stops for a person; the student is told which attempt failed, and told when a wrong password cannot be told from a portal fault

**Status:** Accepted · 2026-09-16 · closes the sign-in half of blocker 26 · applies 0114 to the resume path of 0101 §3 · continues 0116 (a cancel is the student's stop, unchanged)
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-16. **Built in P151**, the same day; see *Built* below.

## Context

P150 traced the sign-in path's failure shape from the code for his second flag before Run A.
It was ADR-0114's blocker 26 again, unsolved for the sign-in: the secure box's handle is spent
the moment the password is typed into the login field; a wrong password, a portal error or a
browser fault after that point loses the session; the step asks again; a fresh box opens by
itself, without limit and without a count; and no message says the password was refused — that
wording existed only for account creation. A student who mistyped once could not tell that from
a portal fault, and a student who had forgotten their password would loop until they gave up.
And until the Secure Plane's outbox delivered `secret_consumed`, the dead handle was handed to
the next runner, which the plane refused as `already_spent` — silently.

## Decision

In his words:

> *"The sign-in failure shape is blocker 26 again, unsolved."*
>
> *"You have just described, for sign-in, exactly what we fixed for account creation: a box that
> reopens without limit, no attempt count, and no message saying the password was refused.
> ADR-0114 capped creation at two and told the student why. Sign-in has neither."*
>
> *"It is worse than creation's was in one way. The wording that says a password was refused
> exists only for creation, so on sign-in the student sees the same box with the same signed-out
> explanation and no reason. A student who mistypes once cannot tell that from a portal fault,
> and a student who has genuinely forgotten their password loops until they give up."*
>
> *"And it is my password on Run A, on the one path that has never run against the real portal.
> If I mistype it, what I will see is the box again, which is the least informative thing it
> could do."*
>
> *"So: apply ADR-0114's shape to sign-in. Two attempts, then stop for a person, with the student
> told which attempt failed and what the portal said. If the reason cannot be distinguished — a
> wrong password from a portal error — say so to the student rather than guessing, and say so
> in the record too."*
>
> *"Do that before step 3. I would rather Run A's first unknown be the portal than our own retry
> loop."*

So, for a sign-in through the secure box (ADR-0101 §3, and the start of a run on an account
the student holds, ADR-0110):

1. **The attempts are counted**, since the session was last live. A hand-out the runner could not
   use is not an attempt (ADR-0114's rule). The handle each attempt was handed is named, and is
   offered to nobody whatever the outbox has delivered.
2. **The first failure:** the student is told which attempt failed and why, that there will be one
   more, and that the box opens again because we do not keep the password. The box opens again.
3. **The second failure:** the run stops for a person. The intervention names the attempt, the
   runner's code, and — where the code is the login form still showing — that a wrong password
   and a portal fault cannot be told apart from the record. The student is told the same, in
   their words, and that a person will look. The number is two; no third attempt is made.
4. **What cannot be distinguished is said, not guessed.** The runner reports `portal_refused` when
   the page is still the login form after the submit, which a wrong password and a portal fault
   both produce. The words to the student and the words to the person say so; neither picks one.
5. A cancelled box remains the student's stop (ADR-0116), unchanged.

## Built — P151, 2026-09-16

Tests first, red — the orchestrator's step handed the dead handle to the sign-in, and the
driver's three cases had no mechanism — then:

- **The count and the spent handle** live in `run_sign_in_failures` (migration 0021), one row
  per run: attempts made since the last live session, the `sr_…` id the last attempt was handed,
  and the runner's code. `RunSessionStore.signInFailed` writes it from the report;
  `RunSessionStore.record` — a live session — clears it, so a later loss is a new episode of two.
  A table of its own because `run_sessions` is deleted when a session is lost, which is when a
  failed sign-in is reported, and because a sign-in has no intent on purpose (ADR-0101 §3).
- **The state and the step.** `RunState.session.signInFailed` carries the three facts through the
  one writer, `withSession`. `signInSecretOf` answers nothing for the request a failed sign-in
  spent, whatever lifecycle the log shows, so the step asks again rather than hand a dead handle
  to the next runner; the driver's guard against a second box treats that request as settled,
  as it did the creation's.
- **What follows a failed sign-in** (`#afterFailedSignIn`): a password the runner could not use is
  told and the box reopens, nothing counted; the first attempt is told in the student's words as
  *the first of two*, with the reason and that the box opens again; the second raises an
  intervention (`authentication_failure` for the login form still showing, `timeout_exhausted`
  otherwise) whose text names *the second of two attempts*, the code, and that a wrong password
  and a portal fault cannot be told apart, tells the student the same, and sets `escalated`,
  which `claimWork` never offers and on which no box opens.
- **The words.** `portal_refused` on a sign-in reads *"the portal did not sign me in, and from
  where I stand I cannot tell whether the password was not the one it holds or the portal itself
  went wrong"*; the first attempt's message adds *"check it carefully, since I cannot"*.
- Tests: the orchestrator's step (spent request → ask again; unspent → sign in); the driver on
  real Postgres (the first failure told and the box again with the dead handle offered to nobody;
  the unusable password not counted; the second failure stopped, recorded, told, never offered).

## Consequences

- Run A's first unknown on the sign-in is the portal, not this system's retry loop: a mistyped
  password shows him one plain message, one more box, and then a stop that says what it knows.
- Nothing here touches the transmission gate, the authorisation content hash, or the
  mandatory-review categories; the password still crosses once per attempt and is never held.
