# P13 — the deliberate regressions, and the five properties nothing was testing

**Date:** 2026-09-02 · **Governs:** [ADR-0051](./decisions/0051-the-student-supplies-through-the-conversation.md)

Twenty-two mutations across four rounds. Each was applied, then the file was
re-read **from disk** and the new text asserted present before any test ran —
a mutation that did not land and a suite that passes look identical, and P4
taught that lesson expensively. Restores are from a file copy, never
`git checkout`.

Round 1 ran nineteen. **Six survived.** One was already covered by a test written
between rounds; five were real holes, and closing them added **fifteen tests**.
Round 2 re-ran the five and all five were caught. Round 3 probed the two
remaining survivors to find out *why* they survive — which is the interesting
part of this audit and is written up in §3.

| # | The mutation | Caught by |
|---|---|---|
| **R1** | The pending reading is not rebuilt from the log — back to `newInterview` | 3 tests, including `survives a restart with the pending reading intact` |
| **R2** | A proposal is never closed, so the next question is never asked | `asks the NEXT question, because the first is answered`, and one more |
| **R3** | A confirmation is accepted whatever hash it carries | `REFUSES a confirmation whose hash is not the playback they were shown` |
| **R4** | The confirmed value is never written through the sanctioned store | 3 tests, including `writes the value through the sanctioned path when they agree` |
| **R5** | What the student says next is taken as a fresh answer, not a correction | `treats what they say next as a CORRECTION, never as agreement` |
| **R6** | Only the playback message is written, not the structured proposal | 3 tests, including `puts what it understood back to the student, deterministically` |
| **R7** | A correction leaves the old reading open forever | `treats what they say next as a CORRECTION, never as agreement` |
| **R8** | An unreadable answer is treated as understood | **survived** — see §3 |
| **R9** | Voiding leaves the case in `AUTHORISED`, so it can never be asked again | `REFUSES to put the case back while a mandatory review is outstanding` † |
| **R10** | The way back skips the gate, so the mandatory review is decorative | `PUTS THE CASE BACK, so the student can be asked again`, and one more † |
| **R11** | The outgrown authorisation is never voided | `VOIDS the approval and puts the case back when the content changes`, and one more |
| **R12** | A case whose approval is already gone is voided again | **survived** — see §3 |
| **R13** | The fill intent names only the page, not what was on it | the journey, 3 assertions |
| **R14** | The content hash is computed over an unsorted list | `does not depend on the ORDER the values arrive in` † |
| **R15** | The specialist is shown a hash instead of the page | `becomes UNCERTAIN, raises ONE intervention, and tells the student ONCE` |
| **R16** | A confirmation may carry a value of its own | `refuses a confirmation that carries a value of its own`, and one more † |
| **R17** | A proposal exchange need not name a field | `refuses a proposal exchange that names no field`, and one more † |
| **R18** | A page version may belong to no page | `refuses a page VERSION on a lease that names no page` † |
| **R19** | `isSecureEventKind` goes back to the complement of `message` | `answers isSecureEventKind from the LIST, not from 'is it a message'` † |
| **R20** | A rejection is written with the playback hash of what it rejected | `refuses a rejection that carries a playback hash` † |
| **R8b** | The second guard on the same property is removed instead | **survived** — see §3 |
| **R8c** | The third guard on the same property is removed instead | **survived** — see §3 |
| **R12b** | The domain lets an absent authorisation be voided | `refuses to void an authorisation that does not exist` |

† Caught by a test that **did not exist when the mutation was first run**. Those
are in §2.

## 1 · The phase's centrepiece had no test at all

`void_authorisation` is the whole answer to the re-authorisation problem, and the
constraint on it was explicit: *"do not invent a shortcut around the case
machine … the new ability to change confirmed information must not make the
existing authorisation guards decorative again."*

The implementation does the right thing — it emits `AuthorisationVoided` **and**
the move back to `AWAITING_STUDENT_AUTHORISATION`, routed through
`checkTransition` so every guard runs on the way back. But
`packages/domain/src/machine.test.ts` asserted only that voiding was *accepted*
and that the previous hash came through. **Both new properties were untested.**
R9 and R10 would both have passed against the suite as it stood.

Two tests now hold them:

- `PUTS THE CASE BACK, so the student can be asked again` — the events are
  exactly `[AuthorisationVoided, CaseStateChanged]`, from `AUTHORISED` to
  `AWAITING_STUDENT_AUTHORISATION`.
- `REFUSES to put the case back while a mandatory review is outstanding` — a
  correction that raises `financial_evidence` is **refused**, with
  `transition_refused` / `mandatory_review_outstanding`.

The second is the one that matters. It is the difference between the design in
ADR-0051 §7 and a shortcut that would have let a case slide back to the
authorisation gate without passing through it. Written as a refusal, because a
guard that never refuses anything in a test is a guard nobody has checked.

## 2 · Five CHECK constraints and two pure functions nobody was exercising

Round 1's other survivors were all the same shape: **a rule stated in a place no
test ever pushed against.**

**The three new CHECK constraints in migration 0008, and one in 0009.**
`schema.test.ts` inserted one legal row of each new kind — which proves the
constraints admit what they should, and nothing about what they refuse. R16, R17
and R18 each replaced a constraint's predicate with `(true)` and the suite stayed
green. Five refusal tests now exist, and they cover both directions of each
equivalence: a confirmation may not carry a value **and** a proposal may not
lack one; a message may not name a field **and** an exchange must. R20 was added
in round 2 for the third constraint, which round 1 had not probed at all.

**`pageFillTarget`'s `.sort()`.** The sort exists because the Application Plane
holds a `FillPlan` and the lease payload holds a `StoredFillPlan`, and
instruction order is an artefact of how each was built. Removing it changed no
integration test: both sides happen to walk fields in the same order *today*.
Stability under reordering is a property of the function, so it needed a unit
test rather than another journey assertion —
`packages/orchestrator/src/page-target.test.ts`, six tests, including that the
target changes when one value changes and that a value moved between two fields
is not the same content.

**`isSecureEventKind`.** `contracts.test.ts` asserted that the *array*
`SECURE_EVENT_KINDS` omits the proposal kinds. It said nothing about the
*predicate*, so the complement — `kind !== "message"` — could come back inside
the function with the array left intact. The new test asks the predicate about
every kind in the vocabulary.

The pattern across all seven: **the assertion was one level away from the thing
that could break.** An array is not the predicate over it; a legal insert is not
the constraint; a journey that computes a hash once cannot tell you the hash is
stable.

## 3 · Two mutations that survive, and why that is the right answer

R8 and R12 survived round 1, survived the tests written for them, and survive on
purpose. Round 3 was run to establish that rather than to assume it.

**R12 — "a case whose approval is already gone is voided again."**
`#voidOutgrownAuthorisation` returns early when `authorisedContentHash` is
undefined. Delete the early return and nothing changes: `decide` refuses the
intent with `invalid_intent`, and the caller's `if (!decision.accepted) return;`
catches it. The early return is a fast path, not a rule. **R12b** proves where
the rule actually lives — loosening the domain's own refusal is caught
immediately by `refuses to void an authorisation that does not exist`.

**R8 — "an unreadable answer is treated as understood."** This one is
over-determined. Three independent guards stand between an unreadable answer and
a written proposal:

1. `answerStudent` returns when `outcome.kind !== "understood"`;
2. `#putToTheStudent` returns when `state.pending === undefined` — and
   `receiveAnswer`'s `not_understood` outcome carries a state with no `pending`;
3. `#putToTheStudent` returns when the composed action is not a `confirm` — and
   `nextAction` on a state with no pending composes an `ask`.

R8, **R8b** and **R8c** remove them one at a time. All three survive, because
each of the other two still holds. No single-point mutation can break this
property, which is the strongest thing a regression run can say about one.

The property is asserted directly anyway — `writes NOTHING when it could not
read the answer at all` — because the guarantee is worth stating in the suite
even where no mutation can violate it, and because the branch also documents the
honest limitation that an unreadable answer leaves no event and so does not
count towards `MAX_ATTEMPTS_PER_FIELD`.

This is the third phase running in which a mutation was caught somewhere other
than where it was aimed (P11's `determineAge`, P12's R1 and the token
idempotence, and now these two). The recurring lesson is the same: **an
integration test sitting downstream of several guards cannot tell you which one
is load-bearing.** Only a mutation can, and only if you then go and find out
why it survived.

## 4 · What the round-1 run would have concluded on its own

Thirteen of nineteen detected, six survivors. Reported without §2 and §3 that
reads like a good result with a few gaps. It was not: **five genuine properties
of this phase had no test**, including the one the phase exists to deliver, and
they were invisible to a green suite of 1766 tests.

The suite is now 1782 tests across 90 files, all green against a real PostgreSQL.
