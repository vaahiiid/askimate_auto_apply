# Decision sheet — the deferred state after the handover

**For:** Vahid · **Prepared:** 2026-09-12 · raised on his instruction with ADR-0107, not decided.
Recorded as **blocker 24** in [`state-of-the-system.md`](./state-of-the-system.md).

> **What raised it** — his words, deciding blocker 23: *"The deferred state must not be quietly
> forgotten. A student who authorised 'later' has an application with something outstanding. I
> do not know what the system does with that today and I suspect the answer is nothing. Tell me
> what exists and what does not, and raise it as its own item rather than folding it into this
> build. It is the difference between a student who knows what they owe and one who finds out
> from a rejection."*

## What exists today, from the code

- **The student is told once, at the handover.** `renderHandover` (`packages/account/src/
  ownership.ts`) lists, under *Before you submit, attach these yourself on the portal — I did
  not attach them*, every document slot that is the student's own act, per entry, and since
  ADR-0107 says beside each that the institution has been told it is coming later and the
  application is not complete until they attach it. The text is recorded with the handover
  (`checkHandoverComplete` keeps `presentedText`), so what they were told is on the record.
- **The preview said it before the yes** (ADR-0107), and the authorisation binds to it through
  the content hash.

## What does not exist

- **No record of the outstanding items as items.** The list is rendered into a message; nothing
  on the case or the run holds "certificate for entry 1: outstanding".
- **No state that says the application is incomplete.** The case reaches its terminal state
  through the student's own decision on the account handover (ADR-0050); what they still owe the
  portal is not a condition of that.
- **No later reminder, and no way to check.** After the handover the account is the student's,
  the runner's session is closed (ADR-0101), and this system has no sign-in with which to read
  the slot's marker (ADR-0106) later. It cannot know whether the certificate was attached; it can
  only ask the student.
- **Nothing that reaches the student after the conversation closes.** The interventions
  transport (ADR-0071) reaches specialists, not students.

So his suspicion is right: today the answer is nothing, beyond the one sentence at the handover.

## The options, priced

### A — the outstanding items are a record on the case, shown and closed by the student's word

The plan's deferred handoffs become durable items on the case at authorisation — one per slot
per entry, with what the portal was told — readable on the run (`GET …/runs`), listed at the
handover, and closed only when the student says they attached it (a decision in the
conversation, recorded). The case's conclusion is not held on it, but a case with open items
reads as *incomplete on the portal* wherever the run is read.

- **Costs to build:** a case-store table and migration, an item on the work state, a student
  decision kind, the readable state and the client's rendering, tests. Two phases.
- **What it does not do:** remind. It makes the debt visible and lets the student discharge it;
  it does not chase.

### B — A, plus a reminder the student agreed to

At the handover the student is offered a reminder — a date, a channel they already use with
this system — and the worker sends it once if the items are still open. Needs a channel to the
student outside the open conversation, which nothing today has.

- **Costs to build:** A, plus a student-facing transport (email is the only address the system
  holds, and it is the portal account's), consent recorded, a worker loop with a schedule, the
  retention of one more record. Three to four phases, and a product question about what the
  system may send to a student's inbox.

### C — the handover message only, as today, said better

Keep the one sentence, make it unmissable: repeat the list in the final message and in the
run's readable state as text.

- **Costs to build:** an afternoon.
- **Where it is wrong:** it is the state he named — a student who finds out from a rejection —
  with a longer message in front of it.

## My recommendation, and what it is not

**A** first, as the honest floor: the debt is a record, not a sentence, and the student closes
it by saying so. B is the version that actually reaches a student who has moved on, and it
needs a decision about sending anything to a student's inbox that this system has never made.
C is not a fix.

This is my recommendation. It is not your decision until you type it.

## What I need from you

- **A, B, C, or something else, in your words.**
- If B: whether this system may email a student at all, and at which address — the portal
  account's, or one they give for this.
