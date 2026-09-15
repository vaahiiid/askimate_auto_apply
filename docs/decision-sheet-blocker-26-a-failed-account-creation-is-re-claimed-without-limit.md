# Decision sheet — blocker 26: a failed account creation is re-claimed without limit, and cannot succeed once the secret is spent

**For:** Vahid · **Prepared:** 2026-09-15 · **Answerable in one sitting.** **Answered 2026-09-15: C, and the number is two — ADR-0114; built in P137.** Recorded as **blocker 26**
in [`state-of-the-system.md`](./state-of-the-system.md); raised in P121
([`runbook-local-stack.md`](./runbook-local-stack.md), *Found by driving the journey through it*).

> **What raised it** — observed on the P121 journey through the five real processes: the Runner
> reported `create_portal_account` failed; the Worker's next tick re-offered the intent; the Runner
> re-claimed it about twice a second; the Secure Service refused each use as `already_spent`.
> Nothing caps the attempts, backs off, or asks the student for the password again. The run never
> succeeds from there and never stops trying.

> **Already decided, and not on the table:** the password crosses once, single-use, and is never
> retrievable (ADR-0043, 0101); a failed creation that established nothing happened reopens the
> intent as `failed_cleanly` (ADR-0054), which is what makes the re-offer correct in itself; a
> creation met by a second factor or a CAPTCHA stops for the student (ADR-0101 §6). What is undecided
> is what happens after a clean failure whose secret is already spent.

## The facts, from the code

- The plane's ledger reopens an intent whose outcome was `failed_cleanly` and offers it again on the
  Worker's next tick (`reopenIntent`, ADR-0054). That is right for a failure with a cause that
  passes — a page that did not load — and wrong for one that cannot: the secret handle was spent
  on the first attempt, so every later attempt is refused by the Secure Service before it types.
- The Runner reports `secret_unavailable`, which is a session-ending failure (the contract's
  list), so the run's session is released each time; the plane records the loss, the Worker
  re-offers, and the loop runs at the Worker's tick.
- The student is told nothing: no intervention is raised, because the failure is "clean".

## Options

| | What it means | Where it lands |
|---|---|---|
| **A · Cap and stop** | The plane counts attempts per intent; after N (two? three?) it stops re-offering, raises an intervention for a person, and tells the student the account could not be created | The ledger and the run driver; one number to choose, and the intervention's text |
| **B · Ask again** | On `secret_unavailable` (or the Secure Service's `already_spent`), the plane opens the secure box again, as the resume path does (ADR-0101 §3), and the intent waits for a fresh password rather than being re-offered spent | The run driver's failure handling; the student's page already shows the box for the resume path |
| **C · Both** | B first — the student can try again once — and A as the ceiling, so a portal that refuses every time still stops for a person | Both of the above |

## What I would choose, and why

**C.** B is the honest response to the specific failure — the secret is gone, and the only source of
another is the student — and it is the path that already exists for a session lost mid-run. A alone
leaves a student whose first attempt failed for a passing reason (the portal was slow) with no way
to try again except a person. B alone loops if the portal refuses every attempt, which is the
observed shape with a different cause. The number in A matters less than its existence; two is
enough to tell a passing failure from a persistent one, and the intervention says which attempt
failed and why.

## What it needs from you

Which option, in your words; and for A or C, the number. Nothing is built until then.
