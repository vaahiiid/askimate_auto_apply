# What was skipped to get this standing — read this before you trust the review record

**For:** the developer who inherits this repository · **Written:** 2026-09-16 (P144), at Vahid's
instruction · **Kept current:** every phase that cuts or restores an item below updates this file.

Vahid, 2026-09-16, on why this file exists:

> *"My goal now is to get the whole thing standing and working end to end, so that a professional
> developer can later sit down with a system that runs rather than a system on paper. It is not to
> put this in front of a real student. That comes after the developer, not before."*
>
> *"I would rather a developer inherits a working system with an honest list of what was skipped
> than a half-built one with a clean review record."*

This is that list. Everything on it was cut **deliberately, by him, in his words**, and each entry
says what the cut leaves uncaught. Nothing here is closed by being listed. An item leaves this file
when the thing it names has been done, not when it stops mattering to the current goal.

## 1 · The mapping set was reviewed by one person, and that person approved their own project's work

**What the record used to require.** A mapping set — *which profile field goes into which box of the
university's form, in what format* — reached a run only after two people had signed it: an author
and a second person who was not the author. Three copies of that rule were enforced in code
(ADR-0017 §1, ADR-0057 property 4). Blocker 2 named a specific second reviewer, and a review pack
of 216 rows was written for his sitting.

**What it is now.** One signature: Vahid's. He authored nothing of the artefact directly — the
draft was written from his words and his reads of the live portal — and he approves it himself.
Decided 2026-09-16, [ADR-0118](./decisions/0118-one-signature-admits-one-account.md):

> *"Drop it to one: I approve, and I am the only signature."*

**What that leaves uncaught — say it plainly.** A field mapped to a **plausible wrong source**: a
mapping that names a real profile field, in a real format, for the wrong box. `date_of_birth` typed
into the passport-expiry row. The postcode's inward half in the outward box. The second nationality
where the first belongs. **Every test passes it**, because the tests check that the set is coherent
and that what it names exists, not that it is right. **No gate refuses it**, because the gates check
signatures, hashes, blueprint versions and field categories, not meaning. The one control against
it was a second person reading the set against the form, and there is now nobody doing that.

**What is enforced instead, so the cut cannot reach a student.** An approval signed by its author is
accepted only when it names the one account it admits, and the running system refuses every other
student at the listing, the offer, the start, and every later lookup of the entry for a bound case
(`not_for_this_applicant`, 403). A single signature admits Vahid's own account and nothing else.
That is in the code, not in anyone's memory — his words: *"my memory of this conversation is not a
control."*

**A second reviewer is a precondition of serving a real student, not an improvement.** Before any
account but his runs against a reviewed set, a second person reads the set against the form and
signs it — then, and only then, the approval admits any applicant. Blocker 2 in
[`state-of-the-system.md`](./state-of-the-system.md) stays open with this sentence in it.

## The cut of 2026-09-16 — accepted by Vahid, all of it

Vahid asked what else on the list is the same shape: work that only matters for serving a real
student, not for getting this standing. The open items were sorted into three (the sort is
reproduced below the table), and he decided, in his words: *"The cut is accepted, all of it. This
is the most useful thing you have written in a while and I want the reasoning kept where the next
developer reads it: **the goal changed, the list did not, and a week of work was on it out of habit
rather than need.**"*

What the cut leaves and what makes each drop safe is in ADR-0119. In one line each:

- **Own-act mechanism, built (ADR-0119).** Nineteen required boxes on the language and education
  pages are handed to the student for Run A rather than mapped; the preview says so under each
  page; the record keeps *filled*, *handed* and *never mapped* apart. Mapping them is a precondition
  of serving a real student, not of Run A.
- **Blocker 29, done now.** A list longer than the form's blocks stops the fill by name. *"A
  history that silently drops a period is the exact class of error this system exists to refuse."*
- **Blocker 30, kept with its two-line note.** *"Half a day, and the case it protects is a student
  we are not serving yet."*
- **Cut outright:** confirming the thirteen labels and fifty markers before the run; keeping the
  review pack current (frozen, with a line at its top); further attached reads of pages already
  read; decision sheets for second-group items; the set's notes addressed to a reviewer.

The table that follows is the sort as it was put to him, kept so the reasoning is readable.

| Item | Where it lives | Why it is the same shape | What cutting it would leave uncaught |
|---|---|---|---|
| Iman's review sitting: the thirteen fields read from the screenshots, the fifty mandatory markers to confirm, the three flagged items | Distance item 6; the review pack | The fill on his own account finds a missed mandatory field loudly — Sheffield refuses to open Part 2 — so the confirmation before the run buys nothing the run does not | Nothing for his account; the same uncaught mapping class as above for anyone else |
| The Requirements Service's two-person rule on knowledge-base entries (`packages/requirements`, `approve()` refuses the submitter) | Blocker 10's path | It guards evidence for a real student's application requirements, and the AskiMate integration it sits behind is Run B | Untouched by ADR-0118 on purpose; if cut, a requirement one person invented would count as evidence |
| Blocker 29: a fifth period of residence in three years is dropped silently | Blocker 29 | Only bites a student with five periods in the window; his synthetic profile has fewer | A real student's residence history typed short, with nobody told |
| Blocker 30: the condition language cannot say what Sheffield's script says (better-of-two nationalities, OR across nationality and residence) | Blocker 30 | Only bites a second nationality of a different class, or a UK national resident abroad; neither is his account. **He raised this one day earlier as a product defect** — *"true of Run A and not of the product"* — so it is the same shape by the test he just gave and not by the one he gave then | A hidden required box on the nationality page, silently wrong rather than loudly missing |
| Blocker 8: the DPA 2018 Sch. 1 appropriate policy document | Blocker 8 | Binds only when a special-category document type is added, and no real student's data is held | Already off the path; listed so the shape is complete |
| Blocker 17: the vault's service role, CORS rule and lifecycle in AWS | Blocker 17 | Needed for a real document to leave; Run A on the international path attaches none | A document path that has never run against a real bucket; and it is AWS spend, which is his act |
| Blocker 11: authenticated specialist identity | Blocker 11 | Its own condition for mattering is a second specialist existing at all | Nothing today |

**Not the same shape, and named so nobody cuts them by analogy:** the robots.txt rule and the
one-second floor (his preconditions, *"not revisiting"*); the case binding at the transmission
gate, the authorisation content hash and the mandatory-review categories (hard stops); blocker 25,
the institution box, which his own account's run will hit on the education page; Bedrock (blocker
3), which the product needs even though the deterministic client stands the journey up without it.

## How to read this list in a month

If an item above is still here and the system is in front of anyone but Vahid's own account,
something has gone wrong with the process, not with the item. The gate in ADR-0118 is built so
that the first item cannot be the one that goes wrong silently; the others rely on this file being
read. Read it.
