# ADR-0157 — While he is the sole founder, his signature serves other students, with compensating controls in its place

**Status:** Accepted · approved by Vahid on 2026-10-13, in his own words (below) · written
2026-10-12 (P297) for his approval, at his request · **nothing in its Decision is built yet** ·
amends [ADR-0118](./0118-one-signature-admits-one-account.md) §2 and its "What this deliberately
gives up", [ADR-0057](./0057-approval-binds-to-content-not-to-claims.md) property 4, and
[ADR-0017](./0017-mapping-is-reviewed-data.md) §1

## Approved, in his words (2026-10-13)

Saved whole as sent: [`docs/run-a/p302-his-decisions-as-sent.txt`](../run-a/p302-his-decisions-as-sent.txt).

> *"ADR-0157: I approve it."*

And, the same message, a rule that belongs to it, because it is about serving students other than
himself:

> *"Reasoned facts (AUTH 8) may stand for my own account only. Before any other student is served,
> every auth fact the account chooser relies on must be observed. Record this as a rule."*

**The rule is his sentence above, as he wrote it.** Today nothing admits another student
(ADR-0118), so it holds by construction. Building this ADR must enforce it, refusing such an
admission where a fact the chooser reads is not observed. That is part of this ADR's build, not yet
done.

**What "observed" means here is not yet his word, and it matters.** P300's per-fact sources
(`packages/account/src/authentication.ts`) have three kinds:
- `observed`: a read or a run named;
- `stated`: a person's own words, with who and when;
- `reasoned`: from the design.

If "observed" in his rule means the type's `observed` kind, these Sheffield facts would not pass,
because each rests on his own statement or try (`stated`):
- AUTH 1 and 2, his words of 2026-09-11;
- AUTH 4, his observations of 2026-10-01;
- AUTH 7, his try of 2026-10-12, whose source he confirmed as "stated".

AUTH 7 could then never pass on Sheffield. The run never presses a reset (P301), and by his words
of the same message, *"Reads never open a reset page."*

If "observed" includes a person's own observation in their own words, those four pass and only a
`reasoned` fact (AUTH 8) does not. **Which he means is his to say;** until he says, this ADR
records his sentence, and no reading of it.

**Priority, in his words, same message:** *"After the sheet, ADR-0158 and my live run come
first."* So this ADR is built after those.

## Why this exists

His message of 2026-10-12, 08:53 UTC, is saved whole as sent:
[`docs/run-a/p297-his-decisions-as-sent.txt`](../run-a/p297-his-decisions-as-sent.txt). Its first
decision, in his words:

> *"I am the only reviewer from now on. I am alone. Do not record my second signature as a second
> review. Propose an amendment to ADR-0118 for my approval: while I am the sole founder, my
> signature is enough to serve other students, with compensating controls that you propose
> (stricter automated checks; every student-specific value marked in the preview and approved by
> the student)."*

That message holds two kinds of thing, and this ADR keeps them apart:

- **Decided, in his words, and built in P297.** *"I am the only reviewer from now on … Do not
  record my second signature as a second review."* What P297 built under those words is recorded
  on ADR-0118 as what changed in the code; ADR-0118's own §2 text stands until this ADR is
  decided. Since ADR-0118 the only test of a second person was that two name strings differed, so
  an approval signed "vahid mohammadi" for content authored by "Vahid Mohammadi", "Vahid", his
  email, or signed by him for content authored by an agent, admitted **any applicant** (measured in
  P297: those four pairs, each `any_applicant`). Now an approval loaded by the service or the CLI
  must name the one account it admits, whatever names it carries; who may sign for any applicant
  is named by code, never by the file, and production names nobody.
- **Fixed in P297, a defect, not his words.** A second record in `approvals.json` for content
  already signed replaced the first in silence; it is refused now (`packages/catalogue`).
- **Proposed, and his to decide.** Whether his single signature may serve students other than
  himself. That is this ADR.

## What ADR-0118 says now, in his words

> *"Nothing reaches a real student on a one-signature approval."* … *"Say plainly that a second
> reviewer is a precondition of serving a real student, not an improvement."*

The class of error the second reviewer was the only control against, also in his words:

> *"a field mapped to a plausible wrong source, which every test passes and no gate refuses"*

P297 measured that sentence still true. Six plausible wrong sources were made in memory on the
signed Sheffield set: forename from the family name, surname from the given name, country of birth
from nationality, a residence's start month from its end date's month (`to.date.month`), an award
year from the end date's year (`end.date.year`), and living in the UK from a residence flag. Each
was run through `checkUsable` and planned with the Run A synthetic profile (method: P297's scratch
`wrong-source-2.mts`; its first version built the two date sources on parts that do not exist, and
was redone). All six are **usable** and the plan refuses none. On that profile the name swap types
the other name, with nothing to say so; the country and the year type the same text as the signed
set, because the profile holds the same value in both sources; the residence month and the flag are
not planned for it. The content hash changes when one is made after the signature; nothing refuses
one signed in.

## Decision (proposed in P297; approved in his words above, 2026-10-13)

### 1. A founder's signature is its own kind of admission

An approval may carry `servesOtherStudents: { underAdr: "0157" }`. It is accepted only when its
signer is the founder named in code (`Vahid Mohammadi`, one constant, not a list a file can
extend), and it yields a new admission, **`founder_signed`**, never `any_applicant`. So:

- `catalogue check` prints *"admits other students on the founder's signature alone (ADR-0157):
  the compensating controls are its condition"*, never *"a second person's signature"*;
- every place that admits a student today (the listing, the offer, the start, the re-application,
  the 14 later lookups) admits under `founder_signed` **only while every control in §2 holds for
  that entry**, and refuses with a worded reason naming the control that failed;
- the one-account approval stays exactly as it is for everything he signs without the field.

### 2. The compensating controls, each a gate in code

Each is chosen against the one error a second reviewer caught: a box fed from a plausible wrong
source.

**(a) Every student-specific value is marked in the preview, and the mark is what the student
approves.** Today a value from a signed row (`student_confirmed`) prints as `label: text` with no
mark; constants and choices are marked (`preview.ts`). Under this ADR every line a student's data
fills says where it came from: *the answer you gave to "…"*, *from your CV*, *you chose this from
the form's list*. And the authorisation hash takes the mark into its line (today it hashes the
field and the typed text only, `preview.ts:659`), so the student's yes binds the source as well as
the value. A student cannot judge a portal's code; they can see that the box asking their surname
holds the answer they gave to "What is your given name?".

**(b) No handle reaches the student.** Rows 141 and 150: at least 24 of 75 handle-labelled boxes
(row 150's method; 32 by the P296 review's) reach the
preview by their handle (`grade: 19.5`). Under this ADR a preview with a line labelled by a handle
is refused before it is shown, so (a)'s mark is never beside a label the student cannot read.

**(c) A placement walk, run on every entry before it is served.** Synthetic profiles are planned
through the entry, and each box's planned text is compared with a **placement table**: box → the
profile field and part that feeds it, signed with the entry. One profile cannot do it: a yes or no
cannot be unique across eleven residence and status flags, and on the Run A profile the
nationality and the country of birth are both `IR`. So the walk uses several profiles, chosen so
that every two sources of the same kind differ in at least one of them, and every box behind a
condition is reached by at least one. A swap of two sources then needs two coordinated edits (the mapping and the
table), and a mapping edited alone is refused. Today nothing relates which profile field feeds
which box (P297, map 1).

**(d) Kinds must agree.** A box whose captured label or input type names one kind of thing (a
date, a name, a country, a yes or no, an email) may be fed only by a profile field of that kind,
and two boxes on one page fed by the same field and part are refused unless the placement table
names both. Said plainly: its kind clause catches **none** of the six wrong sources above, because
each keeps its kind (a name for a name, a date for a date, a country for a country, a yes or no
for a yes or no), and that is what makes them plausible. Its same-source clause catches each of
the six as measured, because each points a box at a source another box on the page already
reads. Neither clause catches a **two-sided swap** (forename and surname exchanged together): only
(c) does, and (c) catches all six only if the placement table is right and the profiles in (c)
reach and separate every pair.

**(e) Untouched.** The case binding at the transmission gate, the authorisation content hash's
existing inputs, and the mandatory-review categories (financial evidence, minors) are not touched
by any of the above; (a) adds to the hash, it removes nothing from it. The founder signature does
not clear a mandatory review: a case that raises financial evidence or a minor still waits for a
human review, and that reviewer is him. One tightening is proposed there too, because he is now
the only person who can give that review: an approving review with a blank `reviewerId` is refused
(today `""` passes, `routes.ts:505-568`).

### 3. While he is the sole founder

The field lapses in his words: when he says a second person has joined, an approval carrying it
is refused until a second reviewer signs. Nothing in the code can know who has joined; it knows
the constant, and the constant is changed by a commit that cites his words.

### 4. What approving this does not do

It does **not** serve a real student. Serving another student also needs, each his to give:

- lifting the standing stop recorded in `docs/state-of-the-system.md` (*"Any real student data
  path. Fixtures and synthetic data only, by standing instruction"*);
- a deployment: nothing is deployed (no database or compute in AWS), and AWS spend is his act;
- the model credentials (blocker list, `docs/state-of-the-system.md`);
- the identity the admission compares: under OIDC a `students.id`, which a recreated database
  mints anew (row 74).

## What it gives up, honestly

ADR-0118's sentence would stop being true, and that is the point of the ADR, so here is what goes
with it:

- **One person's reading of the form stays the only judge of what each box means.** The
  placement table (c) is signed by him alone. A box he reads wrongly and records wrongly in the
  table passes every control above, exactly as it passes today.
- **The student becomes the second reader**, through (a). A student reads their own values and
  the marks beside them, not the form's labels against its code; they catch a surname in the
  given-name box, not a "date of award" box fed the end date when both are dates they gave.
- **The controls are only as good as the sentinel profiles and the kind table.** A field they do
  not cover is uncaught, as it is today.
- **The founder signature is asserted, not authenticated.** §1's check compares the `approvedBy`
  string in `approvals.json` with a constant, which is the same name-string test P297 retired as
  a test of a second person. Every commit in this repository is authored as him (CLAUDE.md), so an
  approval written by anyone who can write the file, an agent at his instruction included, reads
  exactly like one he wrote, and under this ADR it would serve every student. No check that a
  record came from him exists; blocker 11 (an authenticated specialist identity) is open.

## Records this would change, when approved

The sentence *"a second reviewer is a precondition of serving a real student"* stands on fourteen
lines (P297: `git grep -n 'precondition of serving'` printed seventeen outside this ADR, and three
of them are another sentence, about the language page: the draft mapping set's line 59, the
signed entry's line 30613 and the distance document's line 124). They are in `README.md`,
`docs/decisions/README.md`, `docs/what-was-skipped-to-get-it-standing.md` §1,
`docs/state-of-the-system.md` (its opening and blocker 2), `docs/what-run-a-proved.md`,
`docs/what-a-controlled-live-run-needs.md`, `docs/distance-to-a-reviewed-sheffield-run.md` (line
177), the review pack, the draft mapping set's line 5, the signed entry's `$comment`, ADR-0118
(twice), and the journal (`docs/where-we-are.md`), which stays as the record of its day. Each of
the others would say what replaced it and point here. *Approved 2026-10-13; these records change
when the Decision is built, because until then the precondition is what holds in code: nothing
serves another student. They are left as they stand until that build, which comes after the sheet,
ADR-0158 and his live run, at his word.* The entry's `$comment` sits outside its
content hash (measured in P297: the hash is unchanged with the comment rewritten), so it can be
changed without his signature, and his signature does not cover it.

## Not built

Everything under "Decision". Built in P297 and not part of this proposal: the refusal of
an approval with no account named whatever its names, the refusal of a second record for signed
content, and `catalogue check`'s line for an admission no file can now produce.
