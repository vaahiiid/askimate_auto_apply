# Questions per application on his run, measured again (P293)

**Why again.** His words, 2026-10-08, 17:11 UTC (the message's timestamp in the session record)
([`p293-his-decisions-as-sent.txt`](./p293-his-decisions-as-sent.txt)): *"Target: zero questions
during the application for my case on Sheffield. Measure it again once these rows are signed."*
The row is **not signed yet**, so this is the measure on the entry **as it will be if he signs it**:
the P293 patch applied for the run and removed after it. It is measured again, on `main`, once
he signs.

**What it counts.** As in P292 ([`p292-questions-measured.md`](./p292-questions-measured.md)),
ADR-0156 §6: a field, once per entry of a repeating page, at which the run cannot go on without a
human answer given during the application. Intake questions are counted apart, per student.

**How it was measured.** `scripts/questions-his-run.ts` over `scripts/questions-per-application.ts`,
unchanged since P292, on the Sheffield entry with the P293 patch applied: blueprint 0.2.33, mapping
set 0.3.45, `sha256:a7312c27…`. TODAY walks the code as it is: the real offer, each answered with
the form's escape (his own case), then the plan, then the validator. PROPOSED classifies the same
items by ADR-0156's rules, which are approved and **not built**: a reading of the same walk, not a
run.

**What it cannot see** (as in P292): his live profile (his two qualifications as P286 measured
them, synthetic dates); rows the entry does not hold; and "DBA" is a stand-in for his own short
form, never chosen for him.

Command, from the repository root, with the patch applied:

```
pnpm exec tsx scripts/questions-his-run.ts docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json
pnpm exec tsx scripts/questions-his-run.ts docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json DBA
```

## The award title as the intervention quoted it

```
Entry: blueprint 0.2.33, mapping set 0.3.45. Doctorate's award title: "Doctorate of Business Administration".

TODAY — 6 question(s) per application:
  institution-ts-control#0         choice  offered mid-run: 0 entries and "Not in list" for "HHE"
  degree#0                         choice  offered mid-run: 41 entries and "Not in list" for "Doctorate of Business Administration"
  subject#0                        choice  offered mid-run: 10 entries and "Not in list" for "International Business"
  subject#1                        choice  offered mid-run: 10 entries and "Not in list" for "International Business"
  grade#0                          person  stops for a person (no_matching_case): the form records no escape for it, so it is not offered
  unlistedDegree#0                 fix     the form refuses it: "unlistedDegree" is 36 characters; the portal allows 28. The student should be asked to shorten it — it must not be truncated on their behalf.

PROPOSED (ADR-0156), no standing rules on the profile — 5 per application, asked together before the run; intake would ask: escape when not listed; short form of awardTitle
  degree#0                         choice  41 entries and the escape for "Doctorate of Business Administration", and no standing rule on the profile
  unlistedDegree#0                 fix     their words are 36 characters; the box takes 28, and no short form on the profile fits
  subject#0                        choice  10 entries and the escape for "International Business", and no standing rule on the profile
  subject#1                        choice  10 entries and the escape for "International Business", and no standing rule on the profile
  grade#0                          choice  the form records no escape for it, so it is not offered, and no deterministic row maps it — asked before the run starts

PROPOSED (ADR-0156), with the intake answers (escape when not listed; short form of awardTitle "DBA" — a stand-in for his own answer, never chosen for him) — 1 per application, asked together before the run:
  grade#0                          choice  the form records no escape for it, so it is not offered, and no deterministic row maps it — asked before the run starts
  settled without a question:
    institution-ts-control#0: one option, so no question: the escape with their own words, shown in the preview
    degree#0: the standing rule from intake: the escape with their own words, shown in the preview
    unlistedDegree#0: the standing short form from intake ("DBA")
    subject#0: the standing rule from intake: the escape with their own words, shown in the preview
    subject#1: the standing rule from intake: the escape with their own words, shown in the preview
```

## The award title "DBA"

```
Entry: blueprint 0.2.33, mapping set 0.3.45. Doctorate's award title: "DBA".

TODAY — 5 question(s) per application:
  institution-ts-control#0         choice  offered mid-run: 0 entries and "Not in list" for "HHE"
  degree#0                         choice  offered mid-run: 41 entries and "Not in list" for "DBA"
  subject#0                        choice  offered mid-run: 10 entries and "Not in list" for "International Business"
  subject#1                        choice  offered mid-run: 10 entries and "Not in list" for "International Business"
  grade#0                          person  stops for a person (no_matching_case): the form records no escape for it, so it is not offered

PROPOSED (ADR-0156), no standing rules on the profile — 4 per application, asked together before the run; intake would ask: escape when not listed
  degree#0                         choice  41 entries and the escape for "DBA", and no standing rule on the profile
  subject#0                        choice  10 entries and the escape for "International Business", and no standing rule on the profile
  subject#1                        choice  10 entries and the escape for "International Business", and no standing rule on the profile
  grade#0                          choice  the form records no escape for it, so it is not offered, and no deterministic row maps it — asked before the run starts

PROPOSED (ADR-0156), with the intake answers (escape when not listed) — 1 per application, asked together before the run:
  grade#0                          choice  the form records no escape for it, so it is not offered, and no deterministic row maps it — asked before the run starts
  settled without a question:
    institution-ts-control#0: one option, so no question: the escape with their own words, shown in the preview
    degree#0: the standing rule from intake: the escape with their own words, shown in the preview
    subject#0: the standing rule from intake: the escape with their own words, shown in the preview
    subject#1: the standing rule from intake: the escape with their own words, shown in the preview
```

## Before and after the row

| | Award title | Today | Proposed, no standing rules | Proposed, with the intake answers |
|---|---|---|---|---|
| P292, without the row | 36 characters | 7 | 6 | 2 |
| **P293, with the row** | 36 characters | **6** | **5** | **1** |
| P292, without the row | *DBA* | 6 | 5 | 2 |
| **P293, with the row** | *DBA* | **5** | **4** | **1** |

The P292 figures are from [`p292-questions-measured.md`](./p292-questions-measured.md). In every
column the row removes `gradingSystemId#0` and nothing else. What still asks in every column is
`grade#0`, the doctorate's grade: the form records no escape for it, and no signed row maps a grade
for an institution not on the list. Read R ([`p293-reads.md`](./p293-reads.md)) is what that row
would rest on.

## What "zero during the application" still needs

- **The grade row**, after read R, signed. With it, the last column would read **0**: projected
  by taking `grade#0` from the lists above, not measured, because the row does not exist. It is
  measured once it does.
- **ADR-0156's build**, approved and not built: the standing rules on the profile, the intake
  questions in their exact wording, the preview's marks, withdrawal at any time, and the one
  sitting before the run. Until it is built, the code is the TODAY column: with the grade row too,
  that would be **5** questions mid-run with the long title and **4** with *DBA* (projected the same
  way). They are the four offers, and the box too short for the long title.
