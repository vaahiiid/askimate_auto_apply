# ADR-0156 — Ask the student only when it matters

**Status:** Accepted · approved by Vahid on 2026-10-08, 17:11 UTC, in his own words, with three conditions (below) · written in P292 at the request of a message that spoke of him in the third person · amends ADR-0155 (§2, and where a choice is stored) · answers the question about ADR-0109 as amended, in his words · partly built: P293 built §3's mechanism and its first row, for his signature; the rest is not built (see the end)

## Decided, in his words (2026-10-08, 17:11 UTC)

Saved whole as he sent it: [`docs/run-a/p293-his-decisions-as-sent.txt`](../run-a/p293-his-decisions-as-sent.txt).
The time is the message's timestamp in the session record (17:11:44 UTC); the saved file holds no
time.

> *"ADR-0156: I approve it. A standing rule a student accepts at intake counts as the student having
> chosen it under my ADR-0109 amendment, on three conditions: the rule's wording is explicit when
> they accept it, every default applied under it appears in the final preview, and the student can
> withdraw it at any time."*

So the question §4 put to him is answered: **yes, on three conditions**, in his words:

1. *"the rule's wording is explicit when they accept it"*;
2. *"every default applied under it appears in the final preview"*;
3. *"the student can withdraw it at any time"*.

**How this ADR proposes to meet them (not his words; for the build to propose to him):**

1. The student accepts the sentence that will be applied, word for word, not a summary of it.
2. Every default applied under the rule is marked in the final preview as applied under it, beside
   the student's words, before anything is filled.
3. Withdrawn, the rule stops applying, and every field it settled becomes a question again. Before
   the run, that question is asked in §5's one sitting. **Open, his to decide:** what *"at any
   time"* means once the run has started or a page is saved. This ADR does not settle it.

**What his approval does not settle.** He wrote *"ADR-0156: I approve it."* He did not address
§4(a)'s choice between one escape rule and one rule per part, which this ADR leaves to him. It
stays **undecided**, and §4's build waits on it.

And of row 140, in his words: *"I confirm Option A, as the fallback for any portal where no signed
grading row exists yet."* And of the two questions the measure left: *"The two remaining questions
are both the Iranian 20-point scale, which almost every Iranian student will hit. I do not want
students asked about this. Build a signed mapping row "grade scale 20 → GPA 20" for Sheffield from
my existing read, for my signature. Then plan read R so a grade row can follow."* His target:
*"zero questions during the application for my case on Sheffield. Measure it again once these rows
are signed."*

## Why this exists

The message of 2026-10-08, 14:05 UTC, is saved whole as sent:
[`docs/run-a/p292-message-as-sent.txt`](../run-a/p292-message-as-sent.txt). It speaks of Vahid in
the third person, so its words are recorded here as **that message's**, not as his:

> *"Bigger issue. He is right that this is a product problem: for one education page his run would
> interrupt the student 7 times (4 choices + 3 stops). Treat this as the priority over further
> Sheffield work."*

Measured in P292 ([`p292-questions-measured.md`](../run-a/p292-questions-measured.md)): on his run,
with the P291 patch, today's code asks **7** questions for the education page alone. Those are the
doctorate's institution, award title and subject, the Master's subject, the doctorate's grading
system and grade, and a box too short for his award title. With the title corrected to "DBA", it
asks **6**.

Each of those is honest. ADR-0155 made sure no list is offered that nobody read, no entry is
picked for the student, and the escape is pressed only on their choice. But honest one at a time,
seven times, mid-run, is a product a student abandons. Most of those questions have only one
truthful answer, and the student would give it the same way every time.

## Decision (proposed in P292; approved in his words above, with his three conditions; §4(a)'s choice still his)

The rules below are the message's, each with what this ADR proposes for it.

### 1. A field is a question only when it can be answered wrongly

The message: *"A field is a question only if there are two or more genuine options AND our default
could misstate the student. Otherwise apply a lossless default and show it in the final preview he
already approves."*

- **Genuine options** are the entries the form's list holds for the student's words, as the form
  returned them, plus its escape. The count is the list's, never a judgement of likeness. A search
  that returned only the escape (*HHE* at Sheffield) has one option, so it is not a question.
- **The default could misstate the student** whenever the list holds any entry. The student's answer
  might be on it under another name, which nothing here can tell, and it will not guess. A
  standing rule from the student (§4) is their answer to that, given in advance.
- **Shown in the final preview.** Every default is marked there for what it is, beside the
  student's words, on the page they approve before anything is filled. Proposed wording: `Not in
  list, with your own words — your standing rule from intake`. P290's attribution is extended, not replaced.

### 2. The only lossless default is the escape with the student's exact words

The message: *"The lossless default is always the portal's escape plus the student's own exact
words. Never pick or rank a nearby listed entry (ADR-0155's honesty rule stands)."*

- The default **never** chooses a listed entry, ranks one, or offers "did you mean". ADR-0155
  stands.
- **No lossless default exists** where the escape leads nowhere (Sheffield's grading system, row
  140), where the form records no escape (Sheffield's grade), or where the student's words do not
  fit the box the escape opens and no short form does. Those remain questions (§5).

### 3. A deterministic match is not a question

The message: *"A deterministic match is not a question (profile grade scale 20 → "GPA 20")."*

- A **deterministic match** is a signed mapping row that renders the value from the student's own
  stated answer. It must be a row in the entry, signed like any other. A rule nobody signed is not
  a match.
- The example needs such a row: *an institution not on the list, on the twenty-point scale →
  grading system `6`*. Read G of P291 already shows `6` as the only system after the institution's
  escape. The grade then needs a row mapping *19.5* to the list's *19.5*, which rests on the grade
  list read with the institution escaped. That read is planned (`docs/run-a/p292-reads.md`).
- Until those rows are signed, the measure counts both fields as questions, and it does not count
  rows that do not exist.

### 4. Questions about the student's own answers are asked once, at intake, and kept on the profile

The message: *"Questions that are not portal-specific (short form of award title; "if my
institution is not listed, use Not in list") are asked once at intake and stored as standing rules
on the profile, reused across all portals."*

**Proposed:**

- **Two standing rules, in the student's own words, with intake provenance:**
  - **(a) The escape.** Proposed wording: `Where my exact words are not on a form's list, use the
    form's 'Not in list' with my own words.` It is proposed as **one** rule covering institution, subject and award
    title. Making it one rule per part is the alternative, and that is his choice: **undecided**
    after his approval of 2026-10-08, which did not address it.
  - **(b) Short forms for small boxes.** For example an award title's short form, asked only when a
    signed entry has a box the full words will not fit.
- **Changeable by asking.** They change the way any confirmed answer does (ADR-0154), and they are
  shown wherever they are applied (§1).

**How this amends ADR-0155 on where a choice is stored.** ADR-0155 stores a choice *"with the
application, not the profile"*. Under this proposal that splits along one line:

- **What is about this form stays with the application.** Which entry of *this* form's list a
  student chose, and the press it permits, stay in `entry_choices`, one row per application, as
  today.
- **What is about the student's own answers, true on every form, moves to the profile.** Standing
  rules (a) and (b) are statements about the student, not about Sheffield's list.
- **Every default applied under a standing rule is still recorded per application**, in
  `entry_choices`, naming the standing rule as its source. The press of the escape is then
  permitted by a record, as ADR-0109 as amended requires, in his words: *"The record of that choice
  is what permits the press, so a run with no recorded choice refuses the escape exactly as it does
  today."*

**The one question this leaves for him.** In his words, ADR-0109 as amended lets the runner choose
the escape *"when, and only when, the student has chosen it."* Does a standing rule given at intake
count as the student having chosen it?

- **This ADR proposes yes.** The student gave the rule in their own words, for exactly this case,
  and every application it is applied to shows it in the preview they approve before anything is
  filled.
- **If he says no,** each escape stays a question, and the measure on his run says **6** per
  application, not 2.

### 5. What remains is asked together, before the run starts

The message: *"Any remaining questions are asked together before the run starts, never mid-run."*

- **Proposed timing.** After the interview and before the first action on the portal, every
  remaining question is put in one sitting. This amends ADR-0155 §2, which offers one at a time
  as the plan meets them.
- **A question that depends on an earlier answer** (the grade, after the grading system) follows
  in the same sitting, as soon as that answer is given. It never waits for the run.
- **For the grading system**, the question is the message's Option A: the list read after the
  institution's escape, *GPA 20*, and *"None of these — pass it to a person"* in place of the
  dead-end escape. A choice of *None of these* stops before the run, not during it.

### 6. The measure: questions per application

The message: *"Add a measure: questions per application."*

- **What it counts.** A question is a field, once per entry of a repeating page, at which the run
  cannot go on without a human answer given during the application: a choice put to the student, a
  stop for a person, or a value the form refuses that only the student can change. One stop message
  naming two fields counts as two.
- **What it counts apart.** Questions asked once at intake are counted per student.
- **How it is computed and reported.** `scripts/questions-per-application.ts` computes it from the
  real offer, plan and validator. A phase report states it whenever it changes for a run that
  exists.

**Measured on his run** (P291 patch; his qualifications as P286 measured them; nothing invented):

| Award title | Today | Proposed, no standing rules | Proposed, with the intake answers | Asked once at intake |
|---|---|---|---|---|
| As the intervention quoted it (36 characters) | **7** | 6 | **2** | 2: the escape rule; a short form |
| *DBA* | **6** | 5 | **2** | 1: the escape rule |

What still asks, with the intake answers given:

| Field | Why it still asks |
|---|---|
| `gradingSystemId`, the doctorate | Its escape leads nowhere (row 140), so there is no lossless default, and no signed row maps an unlisted institution's twenty-point scale to `6`. Asked before the run, as Option A. |
| `grade`, the doctorate | The form records no escape, and no signed row maps a grade for an institution not on the list. The read that would let one rest on the form is planned. |

Both are closed by a signed row, not by a question, if he approves §3 and signs them. The measure
does not count rows that do not exist.

**Measured again in P293, on the entry as it will be if he signs the row** (the P293 patch
applied for the run and removed after;
[`p293-questions-measured.md`](../run-a/p293-questions-measured.md)): **6** today (**5** with
*DBA*), **5** (**4**) without standing rules, **1** with the intake answers. In every column the
row removes the doctorate's grading system and nothing else. What still asks is the grade. **Until
he signs, §3's rule holds on `main`:** the row does not exist there, and the measure is P292's,
7 (6), 6 (5) and 2.

## Consequences

- **On his run.** From 7 questions mid-run, as measured, to 2 asked together before it. Two
  questions are asked once at intake and reused on every other portal.
- **The risk.** A student whose answer *is* on a list under another name, and who gave rule (a),
  is entered as *Not in list* with their own words. That is the claim the rule makes, in the
  student's words, and the preview shows it before anything is filled. Nothing picks the listed
  entry for them, and nothing hides that it was not picked.
- **What it does not change:**
  - no listed entry is ever picked for a student;
  - the escape is pressed only on a record;
  - a dead-end escape is never offered as a way through (row 140);
  - the student approves everything in the preview.

## Built, and not built

**Built in P293:**

- **The branch a switch takes after a form's escape** (`escaped: { fieldRef, then }`). It is taken
  only when the plan has put the form's escape into `fieldRef` for that entry, which only the
  student's recorded choice does (ADR-0109 as amended), and then in place of the cases, because the
  form shows the list that follows the escape. The row follows the escape; it never makes it.
- **Its check, `escaped_branch_invalid`.** `checkUsable` refuses a branch the plan could not honour
  or no read supports. That includes an `absent` arm inside it, and a row on a field whose list
  follows another field (Sheffield's grade) when no list was read after that field set to what its
  own row after the same escape renders.
- **§3's first row, *grade scale 20 → GPA 20*,** for a qualification in Iran, the country his read
  was made under, in a patch for his signature
  ([`p293-for-signature.md`](../run-a/p293-for-signature.md)). **Not signed**, so not on `main` as
  entry content.

**Waiting on a read:** §3's second row, the grade after the institution's escape. Read R is
planned ([`p293-reads.md`](../run-a/p293-reads.md)), and the check refuses the row until a grade
list read after the grading system is recorded.

**Not built:**

- §4's standing rules on the profile, with their intake questions in the exact wording the student
  accepts (condition 1);
- the preview's marks for every default applied under them (condition 2);
- withdrawal at any time (condition 3);
- §5's one sitting before the run.

Estimate, given now that he has approved it: **three phases of about four hours each.**

1. The standing rules on the profile, their intake questions and withdrawal, with a test for every
   sentence that promises an action. It waits on his two open choices above: one escape rule or
   one per part, and what *"at any time"* means once the run has started.
2. The defaults recorded per application under a standing rule, as `entry_choices` naming the rule
   as their source, and the preview's marks.
3. The one sitting before the run, in place of ADR-0155 §2's offers one at a time.

Each phase states its own estimate when it starts.
