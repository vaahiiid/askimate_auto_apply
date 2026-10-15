# ADR-0158 — A portal is learned once; a student's values are resolved per application against the live list

**Status:** Accepted in direction · approved by Vahid on 2026-10-13, in his own words (below), with
four of its five open points decided by him and the fifth, §4's ordering, his to choose · written
2026-10-12 (P297) for his approval, at his request · **nothing here is built yet** · his live run:
*"my live run uses today's code. It does not wait for ADR-0158."* (2026-10-14, below) · amends
[ADR-0156](./0156-ask-the-student-only-when-it-matters.md) §1, §3 and §4(a),
[ADR-0155](./0155-a-student-chooses-from-the-forms-own-list.md),
[ADR-0109](./0109-a-typeahead-mapping-names-the-value-the-form-submits.md) as amended in P290,
[ADR-0101](./0101-the-yes-comes-first-and-a-runner-is-signed-in-for-one-sitting.md) if §4's option
(a) is chosen, [ADR-0017](./0017-mapping-is-reviewed-data.md), and the rule at the head of
`packages/mapping/src/mapping.ts`

## Decided, in his words (2026-10-13)

Saved whole as sent: [`docs/run-a/p302-his-decisions-as-sent.txt`](../run-a/p302-his-decisions-as-sent.txt).

> *"ADR-0158: I approve the direction. On its five open points:*
> *1. A label with two values: the run never picks one. It asks the student before the run, showing
> both; if they cannot tell them apart, it stops for me.*
> *2. Pressing the escape is permitted only when both hold: the student accepted the escape rule at
> intake, and the live search at run time shows their exact words are not on the list.*
> *3. Equal maxima count as an exact match only when the kind is also the same: points with points,
> percentage with percentage.*
> *4. The subject search word is the student's exact subject wording, searched once. No exact match:
> the escape. The run never tries other words.*
> *5. The three orderings: explain each in one plain sentence with your recommendation. I will
> choose."*

What each settles below:
- **1 settles §2.1:** who settles a label with two values. The student is asked before the run,
  with both shown. If they cannot tell them apart, the run stops for him.
- **2 settles §2.2:** what permits the escape's press. Both conditions must hold: the student
  accepted the escape rule at intake (ADR-0156 §4(a)'s standing rule), and the live search shows
  their exact words are not on the list. A preview yes alone does not permit it.
- **3 settles §2.3:** equal maxima are an exact match only with the same kind, points with points
  and percentage with percentage. So §3's signed vocabulary must say each entry's kind as well as
  its maximum. §3's choice between a table and a rule is not among his five points. The table is
  the form that can carry a kind, so this ADR reads his point 3 as needing it. That reading is
  mine, and his to correct.
- **4 settles §4's search word:** the student's exact subject wording, searched once. No exact
  match on what comes back means the escape, under point 2's two conditions. No other word is ever
  tried.

**His own live run, 2026-10-14, in his words** ([as sent](../run-a/p309-his-decisions-as-sent.txt)):
*"P302 item 2: my live run uses today's code. It does not wait for ADR-0158."* So on his run the
subject search types the recorded word and the escape is pressed on his choice recorded in the
chat, as today's code does (P302 item 2). Point 5 below, the ordering, is still his to choose for
the build. That it no longer moves his live run's account creation is my reading of his words.

**Point 5, the ordering (§4), explained for his choice, one sentence each:**
- **(a) The account first:** the student says yes to creating their account on its own, and the
  run creates it, reads the lists inside it and only then shows the application for their yes, so an
  account with their e-mail and a password exists before they have approved the application.
- **(b) Signed out:** the run reads the lists without any account, which works only where the
  portal answers a visitor, and on Sheffield it cannot read the grading, grade and subject lists,
  which load in a way the read-only guard refuses.
- **(c) An account of ours:** the run reads the lists through an AskiMate account on each portal,
  so the student's words are typed into the portal under a name that is not theirs, which the
  portal's terms may not allow.

**Recommended: (a).** It is the only one of the three that serves Sheffield's lists whole without an
account of ours. Its cost is real, and the student accepts it on its own yes. ADR-0101 A1 changes to
"the account's yes comes first", and the fill after the preview signs in again, as the resume path
does today (ADR-0101 B). (Written in P302; since P309 his live run does not wait for ADR-0158, by
his words above.) For his own live run it would also move the account's creation, which
today comes after his yes on the preview, to before it. Measure (b) only where one read would
settle it. This supersedes §4's earlier "measure (b) first". **His choice; nothing is built until he
makes it.**

## Why this exists

His message of 2026-10-12, 08:53 UTC, saved whole as sent:
[`docs/run-a/p297-his-decisions-as-sent.txt`](../run-a/p297-his-decisions-as-sent.txt). In his
words:

> *"The direction is partly wrong and I want it corrected now. AskiMate is a global platform. The
> system must learn a portal's pages once, then apply for any student quickly after the interview.
> Per-country reads and signed rows for every portal and every country do not scale."*

> *"Propose a Proposed ADR that separates:*
> *- Portal structure (pages, fields, escapes, limits, order): learned once per portal, signed by
> me once.*
> *- Each student's values (institution, subject, award title, grading system, grade): resolved at
> run time against the live list by a deterministic rule. Exact match to the student's own words:
> pick it. No exact match: the escape plus their exact words. Where the escape is a dead end
> (Sheffield's grading system): the matching listed entry if the student's stated scale matches
> one exactly, otherwise ask before the run. No guessing ever. Every value recorded per
> application, marked in the preview, approved by the student.*
> *Say what this removes (country re-keying of the 43 rows, row 145's checker defect if it no
> longer matters, per-country reads) and what safety it costs, honestly."*

What drives the time today, from the record (P297, measured): Sheffield's entry carries **489**
option rows on the six fields his rule covers (institution 43, grading system 4, grade 213, award
title 41, subject 94, subject search 94). Each is a signed key → value pair keyed on a student's
words; the grading system and the grade are also keyed on the student's institution, and one
escaped branch on the country, which is why row 143 exists. One hash covers the whole entry, so
each new institution or grading list is new reads, new rows and a new signature: ten signatures
between the first (`3575eb1e`, 2026-09-16) and the tenth (`34760af4`, 2026-10-10), 23 days 14 hours
apart by commit time, and an eleventh waiting. Sheffield is 31 days past its first capture and has
reached no stage beyond it ([`docs/onboarding/sheffield-pgt.json`](../onboarding/sheffield-pgt.json)).

## Decision (proposed in P297; its direction approved in his words above, 2026-10-13)

### 1. What is structure, learned once and signed once

Pages and their order; fields, locators, input types, limits; which list follows which choice,
what loads it and which presses open it (`optionsAfter`); each list's escape and the box it opens;
whether an escape leads nowhere; the advance and save controls; and **the portal's own vocabularies
that are not a student's words**: the country box's names for each ISO code (231 rows on
Sheffield's education page), and, for a grading-system list, which entries name which maximum
(§3). Signed once per portal, re-signed only when the portal changes.

### 2. What is a student's value, resolved per application

The institution, subject, award title, grading system and grade. None of them is a row in the
entry. Each is resolved against **the list the portal shows for this student**, under the choices
this student's application has already made (their country; their institution), by his rule:

1. **Exact match: pick it.** An entry whose label is, character for character, the student's own
   words. Not a case-folded match: Sheffield's subject list holds `business studies and economics`
   and `Business Studies and Economics` as two entries with two values. The value the form submits
   is recorded beside the label and never trimmed: one of Sheffield's subject values,
   `GCE Applied Business Advanced `, ends in a space its label does not show (CLAUDE.md). Matches
   are counted as distinct (label, value) pairs: the subject list's two identical *Business
   Administration* entries are one. **Exactly one** must match. Where one label carries two values
   (*Sheffield International College*, `SCH40484` and `SHE0512`), nothing tells the student which is
   theirs, so it is a question before the run whose answer is not the student's to know; today a
   signed row chooses `SHE0512`, with no reason recorded. Who settles such a case is **undecided,
   his to say**. *Decided 2026-10-13: his point 1 above.*
2. **No exact match: the escape plus their exact words**, in the box the escape opens, within its
   limit. This presses the escape without a choice recorded on an offer, which ADR-0109 as amended
   in his words forbids today (*"the runner may choose the form's escape entry when, and only when,
   the student has chosen it. Never otherwise, and never as a fallback when nothing matches"*).
   Under this ADR the record that permits the press is the student's yes on the preview line that
   says it (§5), or ADR-0156's standing rule where he has accepted one. Which of the two is **his
   to say**. *Decided 2026-10-13, his point 2 above: the intake rule AND a live search showing the
   exact words are not on the list; a preview yes alone does not permit it.* Words that do not fit the box are a question before the run (ADR-0156 §5 stands).
3. **The escape leads nowhere** (Sheffield's grading system): the listed entry that names the
   maximum the student stated, using the portal's signed vocabulary of maxima (§3). That is this
   ADR's reading of his *"the student's stated scale matches one exactly"*: equal maxima, not equal
   words, because no label on the list is a student's phrasing. Two different scales can share a
   maximum, so whether equal maxima is "matches exactly" is **his to say**. *Decided 2026-10-13,
   his point 3 above: only with the same kind.* The stated maximum comes
   from the profile: a scale the student stated in words ("out of 10", P297) names it; a token
   names it through a signed table of its own (`twenty_point` → 20, `gpa_4` → 4, `percentage` →
   100; `uk_honours` names none). Exactly one entry, or a question before the run.
4. **No escape at all** (Sheffield's grade): an exact match of the grade as the student stated it,
   or a question before the run. *"2:1"* is not *"2.1"*, and *"17/20"* is not *"17.0"*. Entries
   that are not grades (*"Still waiting for grade"*, *"Failed to complete course"*) are picked only
   by their exact text.

**No guessing ever**: nothing ranks and nothing offers "did you mean".

### 3. A dead-end escape needs the portal's own vocabulary of maxima, signed once

Sheffield's grading-system labels do not state scales the way a student does: *"GPA 20 (e.g.
16.5/20)"* is the only one that names one, and the UK entries name degree types (*"UK Bachelors
Degree (BA, BSc)"*). So "the stated scale matches" needs something signed that says which entries
name which maximum:

- **a label table**: `"GPA 20 (e.g. 16.5/20)"` → 20, signed as structure. A label the table does
  not hold is a question before the run until it is signed, so a new country's grading list brings
  new labels to sign, one per grading system, not one per grade.
- **a label rule**, signed once: an entry names maximum N when its label says `/N` or `out of N`.
  Written that simply it fails on the one label it was written for: *"GPA 20 (e.g. 16.5/20)"*
  also holds 16.5, and a rule that refused labels with a second number would refuse it; a rule
  that ignored an "e.g." clause would work, and is itself a judgement about text. Either way it is a
  number read off a label at run time.

**Recommended: the table.** It is exact, it is read by the person who signs it, and its cost is
one signature per grading system the portal shows, which is small beside today's one row per
grade. Under the rule as first written, every Iranian student on the twenty-point scale (his case
among them) would be asked a question the signed row answers today. His choice.

### 4. When the lists are read: before the preview, after any review, and recorded

The values must be settled before the student's yes, because that yes binds each value
(`preview.ts`: the hash covers each field's typed text), and a value picked after it would be one
the student never approved. So a **resolution pass** runs after the interview and before the
preview.

**It runs only after every mandatory review is cleared.** A case that raises financial evidence or
a minor (ADR-0011) waits for its human review before the pass touches the portal, and a case whose
minor conditions are not met never reaches it. Today nothing reaches a portal before authorisation
(ADR-0101), so the review always comes before any portal contact; the pass must keep that order,
not invert it.

**What it does.** It drives the portal's own controls: it chooses the student's country, types the
student's institution words into the search and reads what comes back, chooses the institution,
reads the grading systems, reads the grades; for the subject, it types into the subject search and
presses the search button, as the blueprint's `optionsAfter` says (Sheffield loads subjects only
after a press, and today the word typed is a signed row, `business` or `international`, for all 94
subjects). Which word is typed for the subject, the student's whole words or a part of them, is
**undecided, his to say** (*decided 2026-10-13, his point 4 above: the student's exact wording,
searched once*); a portal that truncates its labels (*"Business Studies With Humaniti"*)
can never equal a student's words, so for such a list exact matching means the escape. It **never
saves, never presses an advance or a submit**, and presses only the blueprint's `optionsAfter`
presses. It records what each list showed and what it was shown under (the rule *"a read prints
the country it was made under"* becomes a property of every recorded resolution), per application,
beside today's choices (`entry_choices`).

At the fill, the runner selects the resolved entry only if the live list still holds it **with the
same label and the same value**; today a select is checked by value alone, and that changes. A
moved list is drift, and the run stops at that box.

**The ordering problem this makes.** Sheffield's lists sit behind its login, and the account is
created only after the student's yes (ADR-0101, ADR-0144). Three ways through, his choice:

- **(a)** the student authorises the account's creation first, on its own yes, then the
  resolution pass runs on their own account, then the preview of the application. This reverses
  ADR-0101 A1, in his words: *"today we ask a student for their university password for an
  account they have not yet agreed to have created, to submit an application they have not yet
  seen. That order is wrong even if it cost us nothing to keep."* Under (a) the student chooses a portal
  password before seeing the application; the portal learns their email before they approve it;
  an account exists for a student who then declines; and because a runner's session is held for
  one sitting with a short bound (ADR-0101 A2), the fill after the preview signs in again (ADR-0101
  B), so the resume sign-in becomes the routine path unless that bound changes.
- **(b)** read the lists signed out, if the portal answers without a session. Sheffield's
  institution search is a GET (`education.js`); whether it answers signed out is not measured. Its
  grading systems, grades and subjects load by POST, which the read-only guard refuses today, so
  (b) alone cannot serve Sheffield's dead-end grading list.
- **(c)** a reading account of ours per portal. The student's institution words are typed into
  the portal under an account that is not theirs; the portal's terms decide whether that is
  allowed.

Recommended (P297; superseded in P302 by the recommendation of (a) under "Decided" above): measure
(b) first, from his browser (a signed-out search, one read). Where it does
not answer, (a) or (c) is a decision about ADR-0101 and about the portal's terms, and both are his.

### 5. Marked in the preview, approved by the student

Each resolved value prints with how it was resolved: *exactly as you said it, on the form's list*;
*not on the form's list: sent in your own words*; *the form's 20-point entry, for your scale "out
of 20"*; and, under ADR-0157 (approved 2026-10-13, not built), the source of every other line too. The hash takes
the mark **and the resolved label** into its line, as well as the value: today it hashes the value
alone, so a list that kept a value and changed its label would not void the student's yes.

## What this removes

- **The 43 institution rows and their country re-key** (row 143): the institution is resolved
  under the student's country, read with it. No re-key, no read T per country.
- **The 213 grade rows and the 4 grading-system rows**, and the 203 waiting in P296's patch:
  replaced by §2.3–4 and §3.
- **The 94 subject-search rows** (each subject's search word): replaced by the pass's search,
  whose word is his to say (§4).
- **Per-country reads for the student's values** (R, R2, T1, T2 were made only to sign rows).
- **Row 145's checker defect stops mattering for Sheffield**, because no signed row keyed on an
  institution follows a country-keyed row any more. It stays latent in `chainPartOf` for any
  future signed switch row until the check is removed with the rows; removing it is part of
  building this.
- **Row 144** (a chained row's scale key unchecked): no signed grade row to check.
- **A signature per student's institution or grading list.** Structure is signed when the portal
  changes, and §3's table when a new grading system appears.

## What it costs, honestly

1. **No human sees the pair before a student's data is typed.** Under this ADR the pair is the
   portal's own (the label it shows, the code it submits), read live, and the student approves the
   label. A student cannot judge a code; a portal that shows a label beside the wrong code is
   believed. The check lost was never whole: of the 489 pairs he signed, 203 grade pairs (Islamic
   Azad University, grading system 6) rest on a description of the list, with 5 confirmed by a line
   passed through, until P296's patch, which R2 confirms, is signed.
2. **The judgements a signer makes are gone, so they become questions.** *"2:1"* → *"2.1"*, a UK
   bachelor's → *"UK Bachelors Degree (BA, BSc)"*, and *Sheffield International College* →
   `SHE0512` are signed judgements today. Under exact matching each is a question before the run,
   and the last has no answer the student can give (§2.1). By the rule as written (read, not
   measured), Run A's synthetic student (a Sheffield BSc, 2:1) would be asked two questions the
   signed rows answer today: the grading system and the grade. The deterministic match of ADR-0156
   §3 is narrowed from "a signed row" to "an exact match on the live list, or the signed table of
   §3".
3. **The portal is touched for every student before the preview**: the student's words are typed
   into its search before they approve anything, after any mandatory review (§4), and (a), (b) and
   (c) each cost something different.
4. **A read-only pass that drives a portal's controls is a new capability.** It never saves and
   never presses advance, and it presses exactly the blueprint's `optionsAfter` presses; but it runs
   the portal's own scripts, which POST, and the network guard permits same-host POSTs during a fill
   by design (blocker 53). The click guard's own check for a submit control cannot see one on
   Sheffield's buttons (row 155), so the allow-list is the whole guarantee there until that is
   fixed.
5. **Lists move.** A value resolved at the pass may be gone at the fill. The label-and-value check
   stops it as drift, and the student is asked again; with §5's hash taking the label, a changed
   label voids the yes too.
6. **The rule replaces a reviewer's eyes with exact text.** It refuses rather than picks, so it
   fails safe, but it fails often: every near-miss is a question. Questions per application under
   this rule have not been measured for any country, Iran included: the rule is not built, and no
   list under India, Nigeria, Pakistan, Bangladesh or a Gulf state has been read. P298's plan asks
   for those reads.

## What it would amend

- **ADR-0156 §3** (Accepted, in his approval): *"A deterministic match is a signed mapping row …
  A rule nobody signed is not a match."* Becomes: a deterministic match is an exact match on the
  live list under §2, or an entry of §3's signed table.
- **ADR-0156 §1 and §4(a)**: the escape becomes the answer whenever nothing matches, which §1 and
  the standing rule of §4(a) (accepted at intake, worded explicitly, withdrawable) govern today;
  §2.2 above says what would permit the press: decided by him as point 2 (2026-10-13).
- **ADR-0109 as amended in P290**, in his words: *"never as a fallback when nothing matches"*.
  §2.2 makes the escape exactly that, under his point 2: the intake rule and a live search, never
  a preview yes alone; and the value the form submits is the one the live list pairs with the exact label,
  recorded at the pass, checked by label and value at the fill.
- **ADR-0155**: offers come from the list the resolution pass read, not only from lists on file.
- **ADR-0101 A1, A2 and B**, if §4's (a) is chosen.
- **ADR-0017 and `mapping.ts`'s rule** *"MAPPING IS REVIEWED DATA. IT IS NEVER INFERRED AT RUN
  TIME."*: unchanged for the mapping (which box a profile field feeds is still reviewed data);
  the five values in §2 stop being mapping and become resolutions, made by a signed rule and
  recorded.

## What it must not weaken

The case binding at the transmission gate, the authorisation content hash (§5 adds to it and
removes nothing), and the mandatory-review categories: §4's pass runs only after their review, and
never for a case whose minor conditions are not met.

## His words of 2026-10-15, recorded as design (P313, row 195)

In his words (`docs/run-a/p313-his-message-as-sent.txt`, item 7): *"For the record, as design: with
the real model, the interview understands free answers ("United Kingdom" as yes, "Feb 2016 - Dec
2016" as start and end) and plays back its reading for confirmation. Matching to a form's list stays
exact, after normalising case, spaces and numbers ("20" = "20.0"); a near match is only ever
suggested, never chosen."*

They change two things this ADR and others record, and are newer than them:

- **Case, spaces and numbers.** §2.1 says *"Not a case-folded match"*, and his own words of
  2026-10-12 above say *"Exact match to the student's own words: pick it … No guessing ever."* His
  words of 2026-10-15 keep the match exact *after* normalising case, spaces and numbers.
- **A near match.** ADR-0155, ADR-0156 and §2 here say nothing offers "did you mean". His words of
  2026-10-15 allow a near match to be suggested, never chosen.

Nothing of it is built. What stands in the way, and my recommendation, is row 195: it touches what
goes on the form (submitting) and, for the model, money and a student's personal data, so it is his.

## Not built

All of it. Approving it would make the next build: the resolution pass (one of §4's three, his
choice), the record per application, the label-and-value check at the fill, §3's table (or rule, his
choice), the preview marks and the hash line, and the removal of the rows and of the checks that
guard them. Five things in it are his to say before it can be built: who settles a label with two
values (§2.1), what permits the escape's press (§2.2), whether equal maxima is an exact match
(§2.3), the subject's search word (§4), and the ordering (§4 (a), (b) or (c)). The first four were
decided by him on 2026-10-13 (above); the ordering is still his to choose.
