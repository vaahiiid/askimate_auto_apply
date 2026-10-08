# Questions per application on his run, measured (P292)

**What it counts.** A question is a field, once per entry of a repeating page, at which the run
cannot go on without a human answer given during the application: a choice put to the student, a
stop for a person, or a value the form refuses that only the student can change. One stop message
that names two fields counts as two, because both need an answer. Questions asked once at intake
and kept on the profile are counted apart, per student. The definition is ADR-0156 §6's, proposed.

**How it was measured.** `scripts/questions-his-run.ts`, over `scripts/questions-per-application.ts`
(tested in `questions-per-application.test.ts`, which was made to fail once), run on the Sheffield
entry **with the P291 patch applied**: blueprint 0.2.33, mapping set 0.3.44,
`sha256:99799bf9…`, the parser's empty-string fix included. The patch was applied for the run and
removed after it, so `main` is unchanged. **TODAY** walks what the code does now: the real offer,
each answered with the form's escape (his own case), then the plan's remaining stops, then the
validator. **PROPOSED** classifies the same items by ADR-0156's rule. That rule is not built: it is
a reading of the same walk, not a run.

**What it cannot see.**
- **His profile.** It uses his two qualifications as P286 measured them from the 3 October
  intervention, with synthetic dates and the rest from `synthetic-profile.json`. His live profile
  is on his machine.
- **Deterministic rows the entry does not hold.** The grading system and grade below ask because
  no signed row maps them, and the measure does not invent one.
- **"DBA" as a stand-in.** For the long title, the intake run uses "DBA" as the short form. That
  is the word the message of 2026-10-08 says he is correcting to; the measure does not choose it
  for him.

Command, from the repository root, with the patch applied:

```
node_modules/.bin/tsx scripts/questions-his-run.ts docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json
node_modules/.bin/tsx scripts/questions-his-run.ts docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json DBA
```

## The award title as the intervention quoted it

```
Entry: blueprint 0.2.33, mapping set 0.3.44. Doctorate's award title: "Doctorate of Business Administration".

TODAY — 7 question(s) per application:
  institution-ts-control#0         choice  offered mid-run: 0 entries and "Not in list" for "HHE"
  degree#0                         choice  offered mid-run: 41 entries and "Not in list" for "Doctorate of Business Administration"
  subject#0                        choice  offered mid-run: 10 entries and "Not in list" for "International Business"
  subject#1                        choice  offered mid-run: 10 entries and "Not in list" for "International Business"
  gradingSystemId#0                person  stops for a person (no_matching_case): its escape leads nowhere (read), so it is not offered
  grade#0                          person  stops for a person (no_matching_case): the form records no escape for it, so it is not offered
  unlistedDegree#0                 fix     the form refuses it: "unlistedDegree" is 36 characters; the portal allows 28. The student should be asked to shorten it — it must not be truncated on their behalf.

PROPOSED (ADR-0156), no standing rules on the profile — 6 per application, asked together before the run; intake would ask: escape when not listed; short form of awardTitle
  degree#0                         choice  41 entries and the escape for "Doctorate of Business Administration", and no standing rule on the profile
  unlistedDegree#0                 fix     their words are 36 characters; the box takes 28, and no short form on the profile fits
  subject#0                        choice  10 entries and the escape for "International Business", and no standing rule on the profile
  subject#1                        choice  10 entries and the escape for "International Business", and no standing rule on the profile
  gradingSystemId#0                choice  its escape leads nowhere (read), so it is not offered, and no deterministic row maps it — asked before the run starts
  grade#0                          choice  the form records no escape for it, so it is not offered, and no deterministic row maps it — asked before the run starts

PROPOSED (ADR-0156), with the intake answers (escape when not listed; short form of awardTitle "DBA" — a stand-in for his own answer, never chosen for him) — 2 per application, asked together before the run:
  gradingSystemId#0                choice  its escape leads nowhere (read), so it is not offered, and no deterministic row maps it — asked before the run starts
  grade#0                          choice  the form records no escape for it, so it is not offered, and no deterministic row maps it — asked before the run starts
  settled without a question:
    institution-ts-control#0: one option, so no question: the escape with their own words, shown in the preview
    degree#0: the standing rule from intake: the escape with their own words, shown in the preview
    unlistedDegree#0: the standing short form from intake ("DBA")
    subject#0: the standing rule from intake: the escape with their own words, shown in the preview
    subject#1: the standing rule from intake: the escape with their own words, shown in the preview
```

## The award title as "DBA"

```
Entry: blueprint 0.2.33, mapping set 0.3.44. Doctorate's award title: "DBA".

TODAY — 6 question(s) per application:
  institution-ts-control#0         choice  offered mid-run: 0 entries and "Not in list" for "HHE"
  degree#0                         choice  offered mid-run: 41 entries and "Not in list" for "DBA"
  subject#0                        choice  offered mid-run: 10 entries and "Not in list" for "International Business"
  subject#1                        choice  offered mid-run: 10 entries and "Not in list" for "International Business"
  gradingSystemId#0                person  stops for a person (no_matching_case): its escape leads nowhere (read), so it is not offered
  grade#0                          person  stops for a person (no_matching_case): the form records no escape for it, so it is not offered

PROPOSED (ADR-0156), no standing rules on the profile — 5 per application, asked together before the run; intake would ask: escape when not listed
  degree#0                         choice  41 entries and the escape for "DBA", and no standing rule on the profile
  subject#0                        choice  10 entries and the escape for "International Business", and no standing rule on the profile
  subject#1                        choice  10 entries and the escape for "International Business", and no standing rule on the profile
  gradingSystemId#0                choice  its escape leads nowhere (read), so it is not offered, and no deterministic row maps it — asked before the run starts
  grade#0                          choice  the form records no escape for it, so it is not offered, and no deterministic row maps it — asked before the run starts

PROPOSED (ADR-0156), with the intake answers (escape when not listed) — 2 per application, asked together before the run:
  gradingSystemId#0                choice  its escape leads nowhere (read), so it is not offered, and no deterministic row maps it — asked before the run starts
  grade#0                          choice  the form records no escape for it, so it is not offered, and no deterministic row maps it — asked before the run starts
  settled without a question:
    institution-ts-control#0: one option, so no question: the escape with their own words, shown in the preview
    degree#0: the standing rule from intake: the escape with their own words, shown in the preview
    subject#0: the standing rule from intake: the escape with their own words, shown in the preview
    subject#1: the standing rule from intake: the escape with their own words, shown in the preview
```
