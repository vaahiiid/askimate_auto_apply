# His six reads and the GPA 20 row, as one entry patch for one signature (P293)

**Status: built, not signed.** Nothing here is on `main` as entry content. The batch is the patch
[`p293-for-signature.patch`](./p293-for-signature.patch), applied and signed in one commit, so
`main` never holds an entry no approval covers. It **supersedes** P291's patch
([`p291-for-signature.md`](./p291-for-signature.md)), which was never signed: it is that patch
with one more row, so one signature covers both.

## What he asked, in his words (2026-10-08, 17:11 UTC)

Saved whole as he sent it: [`p293-his-decisions-as-sent.txt`](./p293-his-decisions-as-sent.txt).
The time is the message's timestamp in the session record (17:11:44 UTC); the saved file holds no
time.

> *"The two remaining questions are both the Iranian 20-point scale, which almost every Iranian
> student will hit. I do not want students asked about this. Build a signed mapping row "grade
> scale 20 → GPA 20" for Sheffield from my existing read, for my signature. Then plan read R so a
> grade row can follow."*

And of ADR-0156, which this row is the first piece of: *"ADR-0156: I approve it."* (with three
conditions, recorded in the ADR). The read R plan is [`p293-reads.md`](./p293-reads.md).

## The row

On `gradingSystemId`, whose list follows the institution box. Its switch over the institution
gains one branch, taken **only** when the plan has put the form's escape, *Not in list*, into the
institution box for that entry. Taken, it replaces the cases, because the form then shows the list
that follows the escape. It is keyed on the country his read was made under, Iran:

```json
"escaped": {
  "fieldRef": "institution-ts-control",
  "then": {
    "kind": "switch",
    "path": "countryCode",
    "cases": {
      "IR": {
        "kind": "part",
        "path": "gradeScale",
        "then": {
          "kind": "option",
          "options": {
            "twenty_point": "6"
          }
        }
      }
    }
  }
}
```

So a student who states the twenty-point scale, for a qualification in Iran at an institution
Sheffield does not list, is entered as `6`, *GPA 20 (e.g. 16.5/20)*. Nothing is asked. The escape
itself is still pressed only on the student's recorded choice (ADR-0109 amended, ADR-0156): the row
follows that choice and never makes it. Any other scale, any other country, or the same institution
without the escape chosen, refuses as before.

## What it rests on

His read of 2026-10-06 (P291, read 2), made with Iran as the country (his read 1 is headed
*"UNTOUCHED (country Iran only)"*, and the reads after it are on the same page), the grading list
with *Not in list* chosen as the institution, as the console printed it
([`p291-six-reads-as-sent.txt`](../captures/sheffield-pgt-2026-09-10/reads/p291-six-reads-as-sent.txt),
lines 20 and 21):

```
[["","Select a grading system..."],["Not in list","Not in list"],
 ["6","GPA 20 (e.g. 16.5/20)"]]
```

P291's patch already records it as `gradingSystemId`'s list after the institution's escape
(`listsAfter`, entries `["6"]`; the prompt and the escape are not entries).

**Compared line by line.** The two lines were cut from his message file at its own line breaks,
nothing else (`sed -n 20,21p`). They were then compared with the patched entry by
`scripts/read-against-entry.ts … gradingSystemId <file> "(escaped)"`. Its output, as printed:

```
3 line(s) in /tmp/claude-0/-home-user-askimate-auto-apply/67805469-31b8-5441-91e9-e4b6086c06f7/scratchpad/p293-grading-after-institution-escape.json; 3 match the entry's options for gradingSystemId, 0 differ or are missing, 0 could not be read as a line.
1 value(s) sent by gradingSystemId's rows under "(escaped)": 1 held by a line of this file, 0 not.
This compares a FILE with the entry. Whether the file is the form's own output — exported, not retyped,
not rebuilt by a loop — it cannot tell; only where the file came from can say that.
exit 0
```

The tool's "line(s)" counts `[value, label]` pairs when the file is JSON: the two text lines of his
message hold **3 pairs, and 3 of 3 match** the entry's options. The one value the row sends, `6`, is
held by a pair passed through from his read: **1 of 1**.

## The code it needs, on `main` (P293, unsigned code, no entry content)

A switch could not say *"after the escape"* before P293. Now it can, and `checkUsable` refuses a
branch the plan could not honour or no read supports (`escaped_branch_invalid`). It refuses when:

- the escaped field is not before it on the same page;
- the escaped field records no escape, or its escape is read to lead nowhere;
- the escaped field is filled by no profile mapping, so its escape is never chosen;
- the form may hide the escaped field;
- the branch names values with no option rule;
- the branch carries an `absent` arm anywhere, which would render a value the student never
  stated;
- **the values are not in the list read after that escape**, where the field's list follows the
  escaped field;
- where the field's list follows **another** field, the values are not in every list read after
  that field set to what **its own** row after the same escape renders. If it has no such row, what
  it then holds is not known, and the branch is refused. Sheffield's grade follows the grading
  system, so a grade row can rest only on a grade list read after GPA 20, never on the options
  gathered for Islamic Azad University. Read R is what it will rest on.

A branch that names the form's own escape is refused first, as `escape_named` (ADR-0109).

Each condition has a case in `mapping.test.ts`. With the check disabled as a whole, those cases went
red; the three rules added after the review below (no `absent` arm, `escape_named` first, the lists
read after the followed field narrowed) were then disabled one at a time, and each one's
test went red. The renderer (including the branch's precedence over the cases), the parser and both
plan paths were each disabled once in the same way, and their tests went red. The branch is part of
the parsed entry, so it is hashed and signed with the rest.

## What his run will do with it

Measured on the patched entry; recorded whole in
[`p293-questions-measured.md`](./p293-questions-measured.md). In every column the row removes the
doctorate's grading system and nothing else. Today's code, which does not yet build ADR-0156's
standing rules, asks **6** questions with the award title as the intervention quoted it and **5**
with *DBA* (P292: 7 and 6). Under ADR-0156 with the intake answers, it asks **1**: the doctorate's
grade (P292: 2).

**The grade still stops for a person.** The form records no escape for it, and no row maps a grade
for an institution not on the list. Read R is planned for that row.

**What the preview shows.** `scripts/catalogue.ts preview` plans the synthetic profile with no
choices. Its University of Sheffield BSc never reaches the branch, so `what-will-be-typed.md`
changes only in its version line. The walk that shows the branch is the test in
`run-a-profile.test.ts`: his two qualifications through the real offer, each answered with the
escape, then the plan. It types `6` for the doctorate's grading system, a qualification in Iran;
without his choice of the institution's escape it refuses as before.

## What the patch changes

Blueprint 0.2.32 → **0.2.33**, mapping set 0.3.43 → **0.3.45**. 0.3.44 was P291's, never signed.
The same eight files as P291's patch:

- P291's content, unchanged: the six reads, and the parser's fix for the empty string, which moves
  the hash. See [`p291-for-signature.md`](./p291-for-signature.md), *What the patch changes* and
  *Two faults*.
- **The row**, in the entry and in the mapping draft, with its note and a line in the set's notes.
- **`run-a-profile.test.ts`**: the new hash, and the walk now expects `6` for the doctorate's
  grading system and only the grade to stop.
- **`sheffield-draft.test.ts`**: the version, and one older hypothetical (P118) that makes the
  institution box a constant. With a constant, the box's escape is never chosen, so the check
  refuses the GPA 20 row as resting on nothing. The hypothetical now drops that row with the box's
  mapping.
- **`what-will-be-typed.md`**: regenerated by its command; only the version line changed.

## The new hash

```
sha256:a7312c27f983d9ce8498a8a0e333626c46a53c7de892ffcc1fbc41156cc4ff67
```

Computed with `pnpm run catalogue hash docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json`
on the patched tree. On `main`, with P293's code, the signed entry still hashes to
`sha256:effa83b5…`: the new parsing leaves an entry without the branch exactly as it was.

## How to sign: one commit

```sh
git apply docs/run-a/p293-for-signature.patch
# then edit docs/run-a/catalogue/approvals.json — replace the one entry (see below)
pnpm run catalogue hash docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json   # must print the hash above
git add -A docs/run-a docs/captures/sheffield-pgt-2026-09-10 scripts/run-a-profile.test.ts scripts/sheffield-draft.test.ts packages/catalogue/src/parse.ts packages/catalogue/src/catalogue.test.ts
git commit
```

The approval file keeps **one** entry; the test asserts exactly one:

```json
[
  {
    "contentHash": "sha256:a7312c27f983d9ce8498a8a0e333626c46a53c7de892ffcc1fbc41156cc4ff67",
    "authoredBy": "Vahid Mohammadi",
    "approvedBy": "Vahid Mohammadi",
    "approvedAt": "<when you sign, UTC>",
    "ownAccountOnly": { "studentId": "5774ff16-ff9c-424a-882f-42d0f304968b" },
    "note": "<your words>"
  }
]
```

## What the adversarial review found, and what was done

A review in four lenses ran read-only over the code, this patch and the records: when the branch
is taken, the check, record integrity, and the hard stops. 21 agents in all. It reported **17
findings**, each then given to a separate agent told to refute it: **8 stood and 9 were refuted**.
Several were refuted only because the fix had already landed in the files the verifier read. They
come to **13 distinct issues**, and all 13 were acted on, refuted or not:

| Issue | What was done |
|---|---|
| The row fired for an unlisted institution in **any country**, but his read was made under Iran. | The branch is keyed on `countryCode` `IR`; any other country refuses. **This changed the row and the hash.** |
| A case naming the value **won over** a chosen escape, though the form then shows the list after the escape. | The branch now takes precedence once the escape is in. |
| The rule for a list that follows another field accepted a list read after **any** value of it. | Narrowed to the lists read after the value that field's own row after the same escape renders, held by every one; refused when there is no such row. |
| An `absent` arm inside the branch could render a value the student never stated, unseen by the check. | Refused. |
| A branch naming the field's own escape was reported as a missing read. | `escape_named` is now reported first. |
| The R2 paragraph said 5 of 203 grade rows are confirmed, against P286's 203 of 203 and his approval note. | The plan now sets out the disagreement and its sources, and says the split's file was never committed. |
| ADR-0156 gave its own reading of his three conditions under the heading for his words. | His conditions are quoted alone; the ADR's reading is labelled as not his words. Mid-run withdrawal is recorded as open, his to decide. |
| "Approved as written" read as settling §4(a), one escape rule or one per part. | Marked **undecided**; §4's build waits on it. |
| The new counts appeared without saying the row is unsigned. | Every record outside the measure says they hold if he signs; `main` asks what P292 measured. |
| His sentence was cut at "existing read." in three code comments. | Quoted whole. |
| The row's note gave his read joined onto one line as "as the console printed it". | The note now holds lines 20 and 21 byte for byte. **This changed the hash again.** |
| "3 of 3 lines" for a file of two text lines. | Said as 3 pairs on two lines. |
| 17:11 UTC had no stated source. | The session record's timestamp, 17:11:44 UTC, now named. |

**What the check still cannot see:** the country a list after the escape was read under.
`listsAfter` records only the escaped field's value. The row is keyed on Iran because the read was;
a later row for another country must be keyed the same way, and nothing enforces it yet.

The hash moved twice in this phase, from `9f0d73ae…` (before the review) to `a7ca31af…` (keyed on
Iran) to the one above. Neither earlier hash was committed or put to him.

## What this was proven against

- **The whole suite on the patched tree**, under a **temporary local approval** over the new hash,
  never committed: **3,338 of 3,338 tests, 166 files, green** (`vitest run`, 2026-10-08, from
  18:25 UTC, 635 s, against real PostgreSQL and Redis), on this patch as it stands. The script that
  ran it applied the patch and the approval, then restored the signed approval and removed the
  patch; afterwards `approvals.json` differed from the signed file by nothing. Two earlier runs, on
  the hashes this phase passed through: `9f0d73ae…` (before the review) 3,337 of 3,337;
  `a7ca31af…` (keyed on Iran, the note not yet byte for byte) 3,338 of 3,338.
- **Fail-first:** with the signed approval restored and the patched entry kept, `run-a-profile`
  went red: *"signed at item 6 — the directory loads … expected false to be true"*. That is what
  `main` would show if the patch landed unsigned.
- **The patch applies** on `main` with P293's code (`git apply --check`). Applied, it hashes to the
  hash above; removed, the entry hashes to `effa83b5…` again.
- The deterministic stand-in and the fixture portal only. Nothing touched Sheffield.

## What signing costs

Nothing metered: no model call and no AWS. The walk after it is his, on his own account.
