# Decision sheet — a field the portal asks for that our own rules forbid us to hold

**For:** Vahid · **Prepared:** 2026-09-11 · ~~**Answerable in one sitting**~~
**✅ DECIDED — Vahid Mohammadi, 2026-09-11. Not A as written: the empty save is refused. "Use the
refusal the form offers", three conditions enforced, not noted. NOT YET BUILT — the expressibility
of each condition was answered first, as he asked; see "What was decided" below.**
Companion to [blocker 19](./decision-sheet-blocker-19-how-a-runner-is-signed-in.md) and
[B1](./decision-sheet-b1-retention-periods.md). Recorded as **blocker 20** in
[`state-of-the-system.md`](./state-of-the-system.md).

> **What raised it** — Vahid, 2026-09-11, on the dependencies output from the first real form:
> *"equalOpportunities.do carries checkboxes for dyslexia, blindness, deafness, wheelchair,
> autistic, mentalHealth, unseen, developmentCondition. Those are Article 9 special-category data
> on a real form we intend to fill. ADR-0077 made it impossible for extraction to produce such a
> field. Nothing has said what happens when a portal ASKS for one. That is a decision, not a
> defect, and it is mine. Do not design around it."*
>
> And his instinct, to be tested rather than assumed: *"the student answers those themselves and
> we never store the answer, but tell me if that breaks something I cannot see."*

> **Already decided, and not on the table:** ADR-0077 — no special-category field can be
> extracted, because the profile registry has none and a plan can name only an
> `OrdinaryFieldKey`. The DPIA determination of what *is* special-category is not made here; the
> statute's list is quoted in `packages/profile/src/categories.ts` and applied below to fields whose
> labels put them inside it beyond argument.

## What was decided — 2026-09-11, in Vahid's words

The dependency this sheet marked is settled by his observation: *"The empty save is refused …
saving Section G blank returns 'Please tick the box to say you have no disabilities, or tick a
disability'. The page will not advance unless something is ticked."* So option A as written
breaks, and the scope is every Article 9 field on the page, the ethnic-origin select included.

> *"We tick 'Prefer not to say' for disability and 'Information withheld' for ethnic origin.
> Those are not the student's answer and we must never present them as one. They are a stated
> refusal to route Article 9 data through us, made on a form that offers exactly that option and
> tells the student where the real answer belongs."*
>
> *"Three conditions, and I want all three enforced, not noted."*
>
> 1. *"The preview must say plainly what we did and why: that we did not answer these on the
>    student's behalf, what we entered instead, and that the university will ask again directly
>    after registration. If the student reads the preview and cannot tell that a question about
>    their health was left unanswered by us deliberately, the authorisation is not informed."*
> 2. *"The values must be reviewed constants at the mapping boundary with that rationale
>    attached, never sourced from a profile field. No path may exist by which a real answer
>    reaches those controls, whatever the student says in the conversation. Make it the same
>    shape as ADR-0077: refused at mapping, not checked at fill."*
> 3. *"And it must not be silent. If a future portal has no equivalent opt-out, the fill must
>    stop rather than pick something. Write that as the general rule — this decision is 'use the
>    refusal the form offers', not 'answer Article 9 fields with a safe default'."*
>
> *"Tell me if any of that is not expressible, and say so before building rather than
> approximating it."*

One fact from the capture, raised with the expressibility answer and not resolved here: the
captured `ethnicOriginCode` list has no *Information withheld* entry. Its opt-out option is
**`998 — Prefer not to say`**; *Information withheld* is the wording of the field's label, not of
any option in the list the tool read. Which one the dropdown shows is his to confirm from his
screen before the mapping names a value.

## The question

Sheffield's equal-opportunities page asks eleven disability checkboxes, a support-needs textarea
and an ethnic-origin select. Health and ethnic origin are two of the eight Article 9(1)
categories. The system cannot hold an answer to any of them: there is no profile field for one, and
nothing can add one without classifying it, and a classification of `special_category` makes it
unnameable. So when the runner reaches that page, **what happens to those fields?**

Two kinds of answer are on the table: the answer never enters this system, or it does. The second
kind is a reversal of ADR-0077 in everything but name, and this sheet says so where it applies.

## 1 · What is already true, read from the tree

**The page, as captured** (`captures/sheffield-pgt-2026-09-10/`, `equalOpportunities.do`):

| Field | Label, as the portal shows it | Category |
|---|---|---|
| `noDisability` | You do not have a disability nor are aware of any additional support requirements | health (a negative is still an answer) |
| `ratherNotSay` | Prefer not to say *(if you go on to register on a course you will have another opportunity to answer later)* | a declined answer |
| `dyslexia` … `otherDisability` (nine) | Learning difference such as dyslexia…; Blind or…; Deaf/deaf…; Physical impairment…; Social/communication conditions…; Mental health condition…; Long-term illness or health condition such as cancer, HIV…; Development condition…; An impairment… not listed above | health |
| `additionalSupport`, `supportNeeds` | additional support needs, and a description | health |
| `ethnicOriginCode` | Please select the term you feel describes your ethnic origin… *If you want to withhold this information, select 'Information withheld'* | racial or ethnic origin |

No label on the page carries the portal's `*` for mandatory. The page's save button has no
`validate()` handler (nationality's does). Whether the server accepts the page with nothing
ticked is **not observed**: the read was of empty forms, and nothing was saved. The portal's own
wording on `ratherNotSay` says the question can be answered later, at registration.

**Nothing in this system can hold an answer.** `ConfirmedValue`, the interview's `ask`, and the
`profile_field` mapping are all keyed by `ProfileFieldKey`; the registry has no health or
ethnicity field; adding one requires a line in `FIELD_CATEGORY`, and `special_category` there
makes it unnameable by a plan (ADR-0077, measured). So the student cannot answer these in the
conversation and have the answer land anywhere — not by policy, by type.

**A mapping set already has a way to say "not ours".** `ValueSource.student_handoff` — *"a
mapping, not an omission … the orchestrator knows this field is deliberately not automated"*.
`planFill` turns it into `plan.handoffs`; the preview prints *"You will complete these yourself:"*
and the labels (`preview.ts`); `validate.ts` leaves handed-off fields out of the required check.

**But a plan with any handoff cannot reach a runner.** `toStoredPlan` (`plan-transport.ts`)
refuses it outright: `has_handoffs`. The refusal is deliberate — a plan with parts silently
dropped *"will report itself complete having attached nothing"*. The consequence for this page:
map one checkbox as `student_handoff` and the **whole application is untransportable**. That
vocabulary was written for MFA, CAPTCHA and payment, where the run must stop; it was not written
for a field the run can pass over.

**An optional field with no mapping is passed over.** `planFill`: *"An OPTIONAL unmapped field is
not a problem: portals carry fields no applicant needs to complete, and leaving one blank is the
correct behaviour rather than a gap to fill."* None of these fields is marked required in the
draft. So with no mapping at all, the runner fills nothing there, saves the page, and moves on —
and the preview says nothing about it, because nothing was planned.

**A constant can be put in any field.** `ReviewedConstant` is *"a fixed value that is not the
student's data"*, constructible only from a mapping set two people reviewed. Nothing structural
stops a reviewer mapping `dyslexia` to a constant, or `ethnicOriginCode` to *Information
withheld*; the two-person review is the only control, and the blueprint has no field-level
category a check could refuse on.

**The account is the student's at the end** (ADR-0050): after the run, the account is handed over
and the student signs in themselves. Part 1 stays editable until the student submits (stated,
not observed: *"incomplete sections are prompted back"* at submit). So a field left blank is a
field the student can answer in their own browser, before they submit, without this system.

**Also on this form, and NOT on this sheet:** `sex` (personal page; not an Article 9 category),
and the nationality page's immigration radios and `refugeeStatus` (not Article 9; sensitive in
other ways, already in the ordinary flow). Named so the boundary of this decision is visible.

## 2 · The options

### A — Leave them to the student: unmapped, passed over, named in the preview

The reviewer maps none of these fields. The runner fills nothing on them, saves the page, and the
run continues. The student answers them in their own browser, after handover, before they
submit — the path the portal itself describes on `ratherNotSay`. This system never sees an answer.

**What it costs.** One small model change, which is yours: the preview must say which fields
were left for the student, and today it cannot without `student_handoff`, which blocks transport.
Either a new `ValueSource` kind — *left to the student; the run passes over it* — that plans to
nothing and prints one line in the preview, or the same words carried on the blueprint field.
Either is a phase. Without it, A is silent: the student authorises a preview that does not mention
the page, and reads *"filled"* about an application with a section they still owe. That silence is
the thing ADR-0059 exists to prevent, so A without the line is not A.

**What it depends on.** The server accepting the page with nothing ticked. Unobserved. If Sheffield
rejects the save, the runner's page walk stops at page 9 with a portal error — an intervention,
not a fill — and the answer is C′ below, not B. The first real fill settles this; nothing before
it can.

**What it forecloses.** Nothing. The student's answer is theirs, given to the university directly,
and this system holds no record that the question was even answered.

**What it breaks that is not visible from the instinct alone.** Two things. (1) The natural
reading of the existing vocabulary — *"student handoff"* — is the wrong one here, because it makes
the application untransportable; the reviewer has to be told to leave the fields unmapped, and a
check-boundaries rule or the new kind has to make the wrong reading impossible rather than
remembered. (2) *"Filled"* becomes *"filled except what only you can answer"*, and the run's
completion, the preview and the conversation's wording all have to say so.

### B — The student answers in the conversation; the answer passes through and is not stored

**Not available in this architecture, and this sheet says so rather than costing a version of it
that does not exist.** Every value the runner types is, by design, in three places before the
keystroke: the **preview** the student reads and authorises (ADR-0059; the content hash covers it,
and the hash is the audit record B1 keeps for six years), the **stored fill plan** in Postgres
(`StoredFillPlan`, the work item a runner claims), and the **conversation's event log** (the
answer arrives as a message). "Never store" would need a fourth channel that bypasses the preview
— which means the student authorises something they did not read — and a plan that carries a
value the ledger cannot see. B is therefore *"hold health and ethnicity data under the same
retention as everything else, on an explicit-consent basis, and reverse ADR-0077"*. That is a
DPIA-level decision with a cost in every layer, and it buys the student nothing they do not get
from A.

**Rejected as costed. Recorded so nobody re-derives it as "just pass it through".**

### C — A fixed non-answer, as a reviewed constant: *Prefer not to say* / *Information withheld*

Technically the cheapest: the constant path exists, two people review it, the page saves with
something in it.

**What it costs.** It answers a health question and an ethnicity question **on the student's
behalf**, without asking them. *Prefer not to say* is a choice the person makes; made for them, it
is our choice recorded against their name at a university. The label on `ratherNotSay` also shows
the cost of declining is nil — they are asked again at registration — so a constant buys nothing
the blank does not, and takes a decision that is not ours.

**Rejected as a default.** One narrow variant survives:

**C′ — the student's own instruction, only if the page will not save blank.** If the first real
fill shows the server rejects an empty page, the student is asked, in the conversation, whether
they want the run to tick *Prefer not to say* / *Information withheld* for them, and their
instruction is recorded as a decision — the way `ReapplicationInstructed` records one. Their
instruction reveals nothing about their health or origin; it is a preference about the form, not
an answer to the question. It still needs the preview line from A, and it needs the mandatory
finding first. **Not built until that finding exists.**

### D — Refuse targets whose forms ask Article 9 questions

**Rejected.** Every UK HE application form carries an equal-opportunities section, because HESA
asks the institutions for it. D forecloses the product, not a target.

### E — Hand the whole page to the student mid-run

A page-level handoff: the run stops at page 9, the student completes it in their own browser, the
run resumes on page 10. Same outcome as A for the data; the mechanics are heavier — a new
`HandoffPoint` kind, a new `student_handoff` reason in the orchestrator's closed set, and the
resume path (B of blocker 19: sign in again through the secure box, because the five-minute
context is gone). It gains over A only if the page cannot be saved blank **and** the student
refuses C′. **Kept as the fallback behind C′, not built.**

## 3 · Side by side

| | A — leave to the student | B — pass through unstored | C — fixed non-answer | C′ — non-answer on the student's instruction | E — page handoff |
|---|---|---|---|---|---|
| Does the answer enter this system? | **No** | Yes, everywhere a value goes | No answer exists | No (an instruction, not an answer) | No |
| ADR-0077 | Kept | **Reversed** | Kept | Kept | Kept |
| Preview honesty | Needs one line (a phase) | Shows the value | Shows the constant | Shows the instruction | Shows a stop |
| Transport today | Passes, if unmapped | — | Passes | Passes | Refused (`has_handoffs`) |
| Depends on | Page saves blank | — | — | Page does NOT save blank | Page does NOT save blank |
| Who decides the answer | The student, at the university | The student, to us | **Us** | The student, as a preference | The student, at the university |
| Cost | One small model change + the wording | Every layer + a DPIA | Two reviewers | A recorded decision + A's line | Three model changes + resume |

## 4 · Recommendation

**A.** The student answers those themselves, at the university, and we never hold the answer —
his instinct, and it holds. Two things make it honest rather than silent, and both are yours:

1. **The preview names what was left for the student.** A `ValueSource` kind that plans to nothing
   and prints *"Left for you to answer on the portal: …"* — or your words — with the labels. Small,
   one phase, and the mapping-set parser can then **refuse `student_handoff` on a field the reviewer
   classifies special-category**, so the wrong reading cannot be written. That is the structural
   form: the same shape as ADR-0077, at the mapping boundary instead of the extraction boundary.
   It needs a field-level category on the blueprint for a check to refuse on; without it the only
   control on a constant in `dyslexia` is that two people read it.
2. **The first real fill establishes whether the page saves blank.** If it does not, C′ — the
   student's own instruction — not B, and E behind it. Nothing is built for that case until the
   finding exists.

**What I would not do.** Map any of these to a constant without the student's instruction; carry
an answer through the conversation on the argument that it is "not stored"; or leave A silent.

**What I could not see from the tree, and say plainly.** Whether Sheffield's server requires the
page. The portal's own label suggests not. Everything above that depends on that reading is marked
as depending on it.
