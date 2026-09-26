# What stands between a person and `ready_to_submit`

**As of:** 2026-09-25 (P210) · **For:** Vahid · **Kept current:** every phase that closes an item
below strikes it here, and every report quotes this list's count beside the
declared-but-unreachable number.

The goal, in his words:

> *"A real person — me, on my own account, with my own real details — goes from an empty
> conversation to `ready_to_submit` on a Sheffield application, without anyone editing a file by
> hand. Not Niloofar. Not a seeded profile. A person answering questions in the chat. Work backwards
> from that and tell me what stands in the way. Not everything that is imperfect — only what actually
> blocks that sentence."*

And the three rules for the duration:

> *"Anything you find that does not block that goal gets a blocker row and no phase. Including
> things that are wrong. Including things that are wrong in an interesting way. Write it down and
> keep going. If a phase needs my signature, batch it — I would rather sign once at the end of a
> working path than seven times along it. And if I ask you a question that pulls you off this, say
> so."*

**This list was written by running the goal, not by reasoning about it.** Three profiles were pushed
through the plan, the validator, the preview and the interview's first move, against the signed
entry (`sha256:be3b0ae0…`), with the deterministic model client the service wires. Vahid, on
reading it: *"Items 1 and 2 are the sentence not even starting, and neither of us knew. The
interview escalates before it asks your name, and it says 'complete' while the plan sits on 23
blockers nobody asked about. Both were found by running it against an empty profile — the same
method that found every real thing this month."* Neither item is visible from the code's
description of itself; both are visible from its first move. The numbers below are that run's output. The
script was temporary and is not in the tree; every number it printed is reproducible from the
signed entry and the registry, and the tests each item carries will pin them.

---

## The list, in the order a person hits it

| # | What stops the sentence | Build | His act |
|---|---|---|---|
| ~~1~~ | ~~The interview escalates on its first turn~~ **Closed, P211: about a quarter of an hour by the clock, against 18 h estimated** | ~~18 h~~ | — |
| ~~2~~ | ~~The interview finishes and the plan still blocks on four fields nobody asked~~ **Closed, P212: about 5 minutes by the clock, against 3 h** | ~~3 h~~ | — |
| ~~3~~ | ~~The award title: the registry does not hold it, so `degree` refuses by design~~ **Closed, P213: 13:42 to 13:49 UTC, about 6 minutes, against 6 h; unsigned until item 6** | ~~6 h~~ | — |
| 4 | The education page refuses his real degree on four more boxes — **re-shaped in P214:** the shape is read and recorded; the rows for his values move into item 6, where his values will exist | ~2 h, at item 6 | his read (done, `1c13dbd`); a read of his own institution's lists at the real run if it is not Sheffield |
| ~~5~~ | ~~Part 2 is unread, and `ready_to_submit` today is the end of Part 1~~ **Closed, P217: the taught page is in the entry and fully mapped; the start date is not a question for this course, read from the markup** | ~~8 h~~ | done: three reads, one statement, one decision |
| 6 | The signature, and the run itself — **build done, P219:** the maps are the whole lists (P218); the account is created by the run, not by hand (ADR-0144), and the creation meets the consent notice before it types | ~1 h | the dedicated e-mail, its student id, one signature, his answers, his consent choice, his password, the run |
| | **Total remaining** | **14 h** (41 h estimated at the start; items 1, 2 and 3 closed in about an hour and a half together) | two reads, one signature, one run |

Forty-one hours of build is about five and a half working days. The items are ordered by when a
person meets them, which is also close to the build order: 1 and 2 are independent of everything;
3 precedes the qualification half of 1; 4 needs his read and his real values; 5 needs his read; 6
is last and is mostly his.

Each item is below with what was measured, what it takes, and what it deliberately does not
include.

---

### ~~1 · The interview escalates on its first turn — 18 h~~ CLOSED, P211

**Closed 2026-09-25 (P211), about a quarter of an hour by the clock — the previous commit at 12:52
UTC, the last edit at 13:05 — against 18 h estimated.** The estimate did not hold, and not by a
little: ADR-0140's composite machinery carried the walk, a list being a keyed sequence
of parts with two yes-or-no questions around each entry, and the log needed a key shape widened
(migration 0025), not a new event. Measured, reversed: on the signed entry's fourteen fields the
first action is `ask` for the e-mail; through the real driver a job is walked across ten
requests and one proposal is put for the whole list. The record of what was measured before
stays below as written.


**Measured.** An empty profile, the signed entry, `nextAction` with the deterministic client:

```
interview first action: escalate
  fieldKey: employment.history
  reason:   No question is defined for "employment.history". The agent will not
            improvise one for a field it does not understand.
```

Before the name. Before anything. `requiredFieldsFor` hands the interview fourteen fields, three of
which are list-valued (`employment.history`, `education.prior_qualifications`, `residence.history`)
and have no `FieldSpec`; `nextAction` looks for an undefined field **before** it looks for a question
it can ask (`packages/interview/src/interview.ts`, the `undefinedField` branch). So the very first
thing a real person meets is a stop for a specialist. This is P197's held class — *"the five
list-valued keys plus `education.highest_qualification`"* — meeting the goal head-on.

**What it takes.** ADR-0113 is the design, decided by him on 2026-09-15 and not built: *"Entry by
entry, not a CV block … one entry at a time, one part at a time … 'none' is a confirmation."* The
build is:

- a **list mode** in the interview: an item is a composite (ADR-0140's parts), asked part by part;
  after the last part, *"another?"*; on *no*, the whole list is rendered deterministically and put for
  one confirmation, because the whole list is what enters the profile; on *none*, an empty list is
  confirmed (ADR-0111's zero-times page);
- the walk **kept across requests** in the driver, as ADR-0140 did for parts — the item index rides
  on the part key (`0.employer`) so `value_part_read` and `partsReadFrom` need no new event;
  measured through the real driver, not reasoned, because that is where P192 found the drop;
- **three specs**: `employment.history` (employer, employer address, position, start, end as
  *current* or a date, duties; basis and referee optional), `residence.history` (country, from, to),
  and `education.prior_qualifications` (level, subject, institution, country, start, end with its
  kind stated by the student, award date optional, grade, grade scale — **and the award title from
  item 3**). `level` and `gradeScale` are free strings in the registry today; the parsers read them
  from closed lists and refuse anything else, because `gradingSystemId` keys on the level's exact
  text and a free spelling would refuse to render three pages later.

**Estimate:** 12 h for the machinery, the driver, the employment and residence specs and their
tests; 6 h for the qualification spec, which waits on item 3. **Not included:** the seven UK-status
claims scoped by residence (ADR-0113's scope note — *"Run B, not a shape change"*), a pasted CV, a
model composing anything.

### ~~2 · The interview finishes and the plan still blocks on four fields nobody asked — 3 h~~ CLOSED, P212

**Closed 2026-09-25 (P212), 13:27 to 13:32 UTC, about 5 minutes, against 3 h estimated.** The interview's worklist is now
the static list plus the field behind every `value_unavailable` blocker, derived at the moment of
asking; the silent form is a named specialist stop, unreachable by construction and kept. Measured
red first at both levels — the orchestrator's step was `complete`, and through the real driver the
assistant said nothing — and green after. The record of what was measured before stays below.


**Measured.** A profile holding exactly the fourteen fields `requiredFieldsFor` returns, and
nothing else:

```
blockers value_unavailable (23): fundingNationality countryOfBirth permanentResidence
  previousCountry1 dateFromMonth1 … dateToYear4
interview first action: complete
```

The plan blocks on every set-read field whose value is absent, required box or not
(`packages/mapping/src/plan.ts`, the `profile_field` case). The interview asks only for fields
behind a box marked `required` (`packages/orchestrator/src/run.ts`, `requiredFieldsFor`). Five
set-read fields fall in the gap — `identity.nationality`, `identity.country_of_birth`,
`residence.country`, `residence.history`, `residence.uk_entry_date` — and four of them blocked on
that profile. So once the interview has asked its last question it answers `complete`; `nextStep`
keeps returning `interview` because the plan still blocks; the driver puts no question for a
`complete` (`#askTheStudent` returns on anything but an `ask`) and raises nothing (the escalation
path takes only `escalate` and `request_document`). **The run sits, and nothing says so** — blocker
35's mechanism on a second path.

**What it takes.** The interview asks what the plan blocks on: `requiredFields` derived from the
set's profile-field sources on the pages the run visits, not from the `required` marker alone — so
the two can never disagree — and a guard in `nextStep` that turns *interview says complete while
`value_unavailable` blockers remain* into a named specialist stop, so the silent shape is
unreachable rather than merely unlikely. Test fails first on today's fourteen-field profile.

**Estimate:** 3 h. **Not included:** blocker 35 itself (`fix_content` with unmapped boxes), which
this goal does not reach once every box on the path is mapped.

### ~~3 · The award title — 6 h~~ CLOSED, P213

**Closed 2026-09-25 (P213), 13:42 to 13:49 UTC, about 6 minutes, against 6 h estimated.** ADR-0142: `Qualification.awardTitle`,
stated by the student, distinct from `level`; the interview asks it as its own part; the Sheffield
`degree` map is `part awardTitle → option` over the select's forty-one titles, label to value. The
entry moved to `sha256:55759f10…` (mapping set 0.3.37) and is unsigned until item 6, as he asked.
The record of what was measured before stays below.


**Measured.** With a full profile the plan still refuses `degree`:

```
degree: not_derivable  BLOCKER 71 — do not add rows here. This box asks for the
  AWARD TITLE the student holds …
validation: violations 1 (degree: required)
preview: refused plan_incomplete
```

By design, since P209 and his seventh signature. The path out is written in blocker 71:
*"`education.prior_qualifications` needs an `award_title` part of its own — the title as awarded,
stated by the student and distinct from `level`."*

**What it takes.** An ADR (the award title is the student's stated field; a level never determines
it); `Qualification.awardTitle` in the registry, required, with the fixture and the ten files that
build a `Qualification` literal updated; the `degree` mapping becomes an `option` rule keyed on the
title **as Sheffield's own select prints it** — forty-two rows derived from the blueprint's captured
options, so *BSc* → its value and *Bachelor of Science* refuses, per his rule that a value we did
not get from the student is not supplied by us; the P150 and draft tests flipped from *refuses by
design* to *typed for a stated title*; the entry re-hashed. The interview question for the title
(item 1's qualification spec) says *"as printed on your certificate — BSc, BA, BEng"* and reads from
a closed list of the portal's titles; a title the list does not carry is asked again, not guessed.

**Estimate:** 6 h. **Signature:** batched into item 6. **Not included:** any other of the six
partial maps (`decision-sheet-the-six-partial-maps.md`), and the accounting page over the
forty-five option maps he agreed to — neither blocks the sentence.

### 4 · The education page refuses his real degree on four more boxes — RE-SHAPED, P214

**His read is in (`1c13dbd`, 2026-09-25) and is evidence of the shape, not of his rows** — his own
words: the institution chosen is not his, because the real-person run comes later on a clean
account. Read against the 2026-09-10 capture it repeats the same institution (so the per-institution
grading-system difference is still unread — blocker 77), shows a second system's grade list without
recording which system (blocker 78), and repeats the subject results and titles. Every education row
chosen to match the synthetic profile now says so in the entry. **The rows for his values are item
6's**, about 2 h once his values exist, plus a read of his institution's lists if it is not
Sheffield. The estimate below stays as written for the record.


**Measured.** A plausible real shape — a non-UK bachelor's on a 20-point scale — refuses on:

```
institution-ts-control: no_matching_option  (1 entry mapped, from one search, "Sheff")
subjectSearch, subject: no_matching_option  (1 of 87 subjects mapped)
grade:                  no_matching_option  (4 of 9 grades, for grading system 7 only)
```

And `gradingSystemId` is keyed on `level` alone — *"UK Bachelors Degree (BA, BSc)" = 7* — which is
right for a UK degree and wrong for any other: the portal's grading systems are looked up **per
institution** (`getGradingSystemsForCountry.do`, P81, P132), and the grade list follows the system.
The signed entry holds the values one synthetic profile needed and nothing else (blocker 25, P149,
option C *"as far as one reviewer typed"*).

**What it takes.** **His read, on his own account, read-only** (the runbook's *reading a page the
way the runner sees it*): the institution box's entries for his search, the grading systems the
portal offers for that institution, and the grade list for the system he holds — about an hour,
the same shape as P102 and P132. Then mapping rows for **his values only**: the institution entry
(1 row), the subject (1 row, keyed on the words he states), the grading system (1 row — keyed on
`gradeScale` rather than `level` if his degree is not UK, which is a rule change of one line and
its test), the grade (the list for his system). Own-account-only signature covers exactly that.

**Estimate:** 5 h build. **Not included:** blocker 25's option B — the interview step that shows a
portal's entries for the student to choose from — which is what a *second* person needs and this
goal does not; the other 86 subjects; other institutions. If his degree is from the University of
Sheffield, this item collapses to the grade row and its read.

### ~~5 · Part 2 — 8 h + one read, possibly one decision~~ CLOSED, P217

**Closed 2026-09-25 (P217).** Three reads of his, one statement, one decision, and the page is in
the entry and fully mapped: the study mode in his words, the window, the course entry, the
qualification, and the funding from the registry's new closed vocabulary (ADR-0143). The last
box, `startDate`, turned out not to be a question for this course: both start-date rows are hidden
in the markup and their own tooltips say they are shown only for a course with several or flexible
starts. The page-by-page read exits 0 on both parts. Entry `sha256:80d99170…`, blueprint 0.2.31, set
0.3.41, unsigned until item 6. Rows 79–87 for what was found on the way. 18:08 to 18:12 utc, about 3 minutes from his third capture commit.


**His three inputs are in and built:** the study mode in his words (a reviewed constant), the
second read (`526174c`) with the course chosen — the course entry and the qualification list
loaded, the start-date list did not — and the funding decision (ADR-0143). Seven maps landed;
the page-by-page read names one blocker, `startDate`. One more in-place read with the
qualification chosen, Save not pressed, and the box is mapped in minutes. Entry `sha256:27f5b6c9…`,
blueprint 0.2.30, set 0.3.40, unsigned until item 6. Rows 83–86. 17:37 to 17:51 utc, about 14 minutes from his second capture commit.


**His read is in (`581070e`) and the taught page is in the entry** (blueprint 0.2.29, set 0.3.39,
entry `sha256:34e8e737…`, unsigned). The page-by-page read now names, in the artefact itself, the
five boxes that stand: `studyTerm` (his statement of the study mode, in the target file, in his
words), `qualification` and `startDate` (his next read with the course chosen in the typeahead —
a client-side choice, not a save — which also yields the course entry's value), and
`fundingSourceKnown` and `fundingStage` (the funding decision his reading asked for; the registry
holds a free-text source and a sponsor, not a stage and not a "don't know yet"). About 3 h of build
once those three land. Rows 79–82 for what was found and is not on the path. The estimate below
stays as written for the record.


**Measured.** `ready_to_submit` is reached after every page of the blueprint is filled
(`packages/orchestrator/src/run.ts`, `state.filled`). The blueprint is Part 1: nine form pages,
two navigation pages, *"Part 2 (course choice) not read"* (capture README). The portal's own line
at the end of Run A — *"You have now completed all the required fields in this section and can now
return to the overview to make your course choices"* — is the boundary. The target file carries
the course and intake; no page reads them.

**What it takes.** **His read of Part 2, on his account, read-only**: its pages and controls, how
a course is chosen, whether each course choice has its own Submit, whether Part 1 locks after the
first — the questions the capture README already names. Then the blueprint pages for what he reads,
curated as Part 1's were; mapping rows — the course and intake as reviewed constants from the
target, the course-supporting-documents slots as handoffs (P100's shape); the page-by-page read
regenerated; `ready_to_submit` then moves to the end of Part 2 without a code change, because it is
the end of the blueprint.

**The risk, named.** The README records the open question: *"one application with three targets"*
against *"one case, one course"*. If Part 2 is a form of its own with its own Submit and Part 1 is
shared, the case model may need to change before Part 2 can be mapped, and that is his decision in
his words, not mine. This estimate assumes it does not; if his read says otherwise, this item stops
and says so.

**Estimate:** 8 h build. **Not included:** submission, three course choices, a second course.

### 6 · The signature, and the run — 1 h + his

**No build of substance.** One paragraph in the runbook for this run. The run itself:

1. **The seeded rows go.** His `students` row on his machine (`af398e01…`, the one the approval
   admits) holds Niloofar's seeded profile. *"Not Niloofar"* means those `profile_entries` are
   deleted first — the runbook already gives the command. The row itself stays, or the approval
   admits nobody.
2. **One signature** over items 3, 4 and 5 together: one hash, computed by him.
3. **The conversation**, from empty: the interview asks; he answers with his real details; each
   value is confirmed. His `contact.email` must be the address his Sheffield account holds, because
   sign-in uses it (blocker 31).
4. The plan, the preview, his yes; the existing-account sign-in through the consent path (47,
   decided); the fill; the handover; `ready_to_submit`. **Nothing submitted, and nothing here
   submits.**

**Estimate:** 1 h build; his run about an hour.

---

## What this list deliberately excludes, and why

Each of these is real. None of them stops the sentence. Each has a blocker row (§6 of
`state-of-the-system.md`) and no phase.

- **A model (blocker 3).** The interview composes its questions and parses its answers
  deterministically; a person who answers plainly needs no Bedrock client. `wiring.ts` wires
  `DeterministicModelClient` in every path and stays so.
- **Blocker 25's interview step (option B)** and the accounting page over the forty-five option
  maps. Needed for a second person; not for him.
- **Blocker 35** — `fix_content` naming unmapped boxes — unreachable once every box on the path is
  mapped. Its sibling on the interview path is item 2.
- **Blocker 32** — a cleanly failed page re-offered without limit. Reached only if a page fails.
- **Blocker 63** — an address with no postcode. Reached only if his address has none.
- **The English page.** Nineteen boxes, eighteen marked required, none mapped — and skippable by
  the portal's own words (ADR-0119), so the plan does not block on it. Whether Sheffield later
  demands it of him is a fact about his application, not about `ready_to_submit`.
- **Marketing and other-documents pages.** Unmapped, nothing required, unvisited.
- **`residence.history` beyond four periods.** The page carries four rows; a fifth period would be
  typed nowhere. New row, below.
- **The approval admits one `students.id`.** If his local database is ever recreated, the row gets
  a new UUID and the signed entry admits nobody until the approval is re-signed. Not a defect;
  a fragility worth a row so the run does not start on a fresh database.
- **Blockers 58, 59, 62, 65, 70, 2 (a second reviewer), the guardian route, a created account, a
  second portal, a real student who is not him.** Outside the sentence by its own words.

---

## What needs his hand, batched

- ~~**Two reads on his account, read-only**~~ — both made (items 4 and 5, 2026-09-25).
- **A dedicated e-mail address**, made by him, for the account the run creates (ADR-0144). He
  registers nothing by hand.
- ~~**A fresh `students` row's id** in `approvals.json`, and **one signature** at the end~~ — given
  2026-09-25 (4e05911): `7b46e6fe…`, admitting `5774ff16-…` only.
- **His answers** in the chat, **his consent choice** when the run asks it, **his password** in the
  secure box, and about an hour for the run. The sequence is `docs/run-a/item-6-runbook.md`.

## The two lines every report carries

- *Declared-but-unreachable: four.*
- *Distance to the goal: one item, its build done, the run his; four struck; item 4's rows folded into item 6.* — this file's list, by count.
  Struck items move to a "What moved" section below as they close; the count in every report is
  the number not yet struck.

## What moved

- **2026-09-25 (P210):** the list written, measured against the signed entry. Nothing struck.
- **2026-09-25 (P211):** item 1 struck — the interview collects a list entry by entry (ADR-0113 built). About a quarter of an hour by the clock against 18 h. Five items, 23 h remain, and the remaining estimates are now suspect in the same direction.
- **2026-09-25 (P212):** item 2 struck — the interview asks what the plan blocks on; *complete while blocked* is a named stop. 13:27 to 13:32 utc, about 5 minutes against 3 h. Four items, 20 h remain.
- **2026-09-25 (P213):** item 3 struck — the award title in the registry (ADR-0142), `degree` typed from it; entry `55759f10…` unsigned until item 6. 13:42 to 13:49 utc, about 6 minutes against 6 h. Three items, 14 h remain.
- **2026-09-25 (P214):** item 4 re-shaped on his read — the shape recorded, the synthetic-chosen rows marked in the entry, the rows for his values folded into item 6. Two rows (77, 78). Entry `26aafb1b…`, unsigned.
- **2026-09-25 (P215):** item 5 half built on his read — the taught page in the entry, one map, five boxes named as waiting on his study-mode statement, his read with a course chosen, and the funding decision. Rows 79–82. Entry `34e8e737…`, unsigned.
- **2026-09-25 (P216):** item 5 all but one box — the course, the qualification, the study mode and the funding mapped on his three inputs (ADR-0143); `startDate` waits on one read. Rows 83–86. Entry `27f5b6c9…`, unsigned.
- **2026-09-25 (P217):** item 5 struck — the start date is not a question for this course; the taught page fully mapped; the read exits 0 on both parts. Row 83 closed, row 87. Entry `80d99170…`, unsigned. One item remains: the signature over everything, and the run.
- **2026-09-25 (P218):** item 6, build half — the education and funding maps as the whole lists read (a `switch` rule for two-part keys; rows 78 closed, 85 widened). Entry `7b46e6fe…`, unsigned. Left for the run: the clean account, its id, one signature, his answers.
- **2026-09-25 (P219):** item 6, build done — the account is the run's to create (ADR-0144, amending 0110 §2 for this run); the creation meets the consent notice before it types, proven fail-first on the fixture; the ledger keeps the last completion's code (migration 0008). Rows 88, 89. Entry `7b46e6fe…`, unchanged, unsigned. 19:27 to 20:13 utc, about 46 minutes, inside item 6's hour. Left: his acts, in the runbook.
- **2026-09-25 (P221):** the run started and stopped on its first question — the page lost the confirmation button to an older read landing last (reproduced fail-first, fixed); two sentences corrected. Row 90. The run continues from the same conversation.
- **2026-09-26 (P222):** his signature over `7b46e6fe…` was on file since the evening of the 25th (4e05911); the interval test flipped to assert the load and the one account it admits.
