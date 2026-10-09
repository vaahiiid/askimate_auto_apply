# His reads, the GPA 20 row, and the country each read was made under: one patch, one signature (P294)

**Status: built, not signed.** Nothing here is on `main` as entry content. The batch is the patch
[`p294-for-signature.patch`](./p294-for-signature.patch), applied and signed in one commit, so
`main` never holds an entry no approval covers. It **supersedes** P293's patch
([`p293-for-signature.md`](./p293-for-signature.md)), which was never signed and **no longer passes
the check on `main`**: since P294, the GPA 20 row rests on a read that must record the country it
was made under, and P293's did not. Sign this one, not that.

## What he asked, in his words (2026-10-09, 09:21 UTC)

Saved whole as he sent it: [`p294-his-decisions-as-sent.txt`](./p294-his-decisions-as-sent.txt).
The time is the message's timestamp in the session record (09:21:08 UTC); the saved file holds no
time.

> *"Also: before any second portal, the Iran key must not depend on someone setting it by hand.
> Record the country a read was made under in the reads record itself, and make the check refuse a
> mapping row whose key does not match the country of the read it rests on."*

His two other decisions in that message (§4(a), one rule; withdrawal) are recorded in ADR-0156 and
change nothing in this patch.

## What the patch adds to P293's

P293's patch is in this one unchanged except for what follows. P293's content includes P291's
reads, the parser's empty-string fix, and the GPA 20 row keyed on Iran. For it, see
[`p293-for-signature.md`](./p293-for-signature.md) and [`p291-for-signature.md`](./p291-for-signature.md).

**Two of his reads now carry the country they were made under** (`under`), blueprint 0.2.33 →
**0.2.34**:

| Read | Recorded under |
|---|---|
| `institution-ts-control`'s search for `HHE` (only the escape) | `institutionCountry-ts-control` = `IRAN` |
| `gradingSystemId`'s list after *Not in list* as the institution (`6`, GPA 20) | `institutionCountry-ts-control` = `IRAN` |

**Where Iran comes from: entered by hand in P294.** These two reads did not print the country. I
entered `IRAN` from what states it beside them:
- his reads file heads read 1 *"1 — UNTOUCHED (country Iran only)"*
  ([`p291-six-reads-as-sent.txt`](../captures/sheffield-pgt-2026-09-10/reads/p291-six-reads-as-sent.txt),
  line 4);
- the plan the reads followed ([`p290-reads.md`](./p290-reads.md)) asks for Iran as the country.

*Iran* is the label of the country box's entry `IRAN`. So until the reads planned next replace it
with the country each read prints ([`p294-reads.md`](./p294-reads.md)), the country the GPA 20 row is
checked against is itself a record set by hand. The check now stops a key that does not match it,
but the record is only as good as that heading. The entry's notes say so.

**What it does not record.** The subject's two searches carry no country: the subject's list
follows its search box only, so no country is a condition of it.

**The mapping set, 0.3.45 → 0.3.46**, only because it is reviewed against the new blueprint
version. No row changed: the GPA 20 row was already keyed on `IR`.

## What the check now does with it (on `main`, P294's code, no entry content)

- **A read must record what it was made under.** A search or a list on a field whose list follows
  fields that offer a choice (the country box, the institution box) is refused unless it records
  what each of them held, apart from the one it is read after (`read_under_invalid`). So the country
  can no longer be left out and set by hand later. The subject's search box offers no choice and is
  not required.
- **A row taken after an escape** (the GPA 20 row), on a field whose list depends on that escape, is
  refused unless it is keyed, through the part of the entry that fills each, for every field of the
  chain its reads record (`countryCode` for the country box, and any field between). Each key must
  render the value a read was made under, and the values under it must be held by every read made
  under that. Where the list follows another field (the grade after the grading system), that
  field's own row after the same escape says what it holds, key by key. A list on the page whole
  does not depend on the escape and is checked against its own options, as in P293.
- **A row on a list that follows another field** (the institution box) is refused if a read
  recording that field's value holds the row's value and the row is not keyed for it. A list read
  after that field counts as made under its value; a read made after an escape is left to the check
  above. If no row of the entry's own can say which country a key names, a row resting on such a
  read is refused, and a constant is keyed for nothing.
- **A row on a list that follows the country box directly** (the institution box) is refused if a
  read recording a country holds its value and the row is not keyed for that country. A row resting
  on no read that records one is not held: nothing says which country it was. **On `main` that is all
  43 institution rows.** Counted by `scripts/rows-held-to-a-country.ts`, which counts the distinct
  values the institution box's option rows send: 43, held by a country-recorded read: 0. By the
  row's note, 34 came from the search *'Azad'* under Iran and 9 from *'Sheff'* under the United
  Kingdom; the note says that search returned ten institutions, two of them sharing a label, one
  mapped. Read T ([`p294-reads.md`](./p294-reads.md)) re-reads both with the country printed. Then
  the rows are re-keyed on `countryCode` from T's own lines, and the check holds them. Simulated on
  a scratch copy, with the two searches built from the entry's own options and not from a read, the
  check refuses all 43 as not keyed on `countryCode`.
- **A read's record itself** is also refused if it names a field its list does not follow, the
  field it is already read after, the same field twice, or a value that field does not offer.
- **The offer** shows a search or a list that records what it was made under only to an entry the
  plan sets the same way. A list read under Iran is never shown to a qualification elsewhere; there
  the value goes to a person, as for any list nobody read.

Seen to refuse on the real entry, on a scratch copy of the patched entry:

```
read made under France:
escaped_branch_invalid: … gradingSystemId keys "IR" ("institutionCountry-ts-control" is "IRAN"), but no list after that escape was read with "institutionCountry-ts-control" set to "IRAN".
row keyed on France:
escaped_branch_invalid: … gradingSystemId keys "FR" ("institutionCountry-ts-control" is "FRANCE"), but no list after that escape was read with "institutionCountry-ts-control" set to "FRANCE".
```

And P293's patch as committed, applied to P294's code:

```
escaped_branch_invalid: … gradingSystemId takes the escape of "institution-ts-control", whose list follows "institutionCountry-ts-control", but rests on no read that records what "institutionCountry-ts-control" held (under), so the row cannot be held to the "institutionCountry-ts-control" it was read under.
```

## What his run will do with it

Unchanged from P293, measured again on the patched entry
([`p293-questions-measured.md`](./p293-questions-measured.md); the two outputs differ from P293's
only in their version line):

- **today:** 6 questions with the award title as quoted, 5 with *DBA*;
- **under ADR-0156 with the intake answers:** 1, the doctorate's grade.

His run is Iranian, so the country rule changes nothing for it. The row is unchanged and already
applied only to Iran (its only key is `IR`). What P294 adds is that the check now refuses a key that
the read's recorded country does not match.

## The new hash

```
sha256:4368de005c63497779c08886da479964c940dec97b68c49e04598ac397983464
```

Computed with `pnpm run catalogue hash docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json`
on the patched tree. On `main`, with P294's code, the signed entry still hashes to `effa83b5…`.

## How to sign: one commit

```sh
git apply docs/run-a/p294-for-signature.patch
# then edit docs/run-a/catalogue/approvals.json — replace the one entry (see below)
pnpm run catalogue hash docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json   # must print the hash above
git add -A docs/run-a docs/captures/sheffield-pgt-2026-09-10 scripts/run-a-profile.test.ts scripts/sheffield-draft.test.ts packages/catalogue/src/parse.ts packages/catalogue/src/catalogue.test.ts
git commit
```

The approval file keeps **one** entry; the test asserts exactly one:

```json
[
  {
    "contentHash": "sha256:4368de005c63497779c08886da479964c940dec97b68c49e04598ac397983464",
    "authoredBy": "Vahid Mohammadi",
    "approvedBy": "Vahid Mohammadi",
    "approvedAt": "<when you sign, UTC>",
    "ownAccountOnly": { "studentId": "5774ff16-ff9c-424a-882f-42d0f304968b" },
    "note": "<your words>"
  }
]
```

## What the adversarial review found, and what was done

Five lenses ran read-only: the country rule on escaped branches, the row-country rule, the offer
and the comparison script, record integrity, and his two decisions as recorded. 26 agents in all.
They reported **21 findings**. Each was given to a separate agent told to refute it: **13 stood and 8
were refuted.** Several were refuted only because the fix had already landed. I acted on every
finding about code or a record's accuracy, refuted or not. The rule that went into this patch is the
reworked one. Each answer has a test, and each test went red with its piece disabled. One of them,
that the reads a row rests on agree, was disabled before the required record existed; that record now
refuses the same case earlier, so the agreement check stands behind it for a field that offers only
an escape.

| Issue | What was done |
|---|---|
| The country was checked only one field up; a read recording the country two fields up (a region between) was never compared. | Every field of the chain a read records is held: the row keyed for each, through the part that fills it. |
| A read after the escape with no country was simply left out of the check. | Every read must record what the fields its list follows held, where they offer a choice (`read_under_invalid`), and all the reads a row rests on must agree on it. |
| The chained check asked for a grade list under every grading system any country's row renders, so a France grading row would have refused the Iran grade row. | Checked key by key. |
| A row on the institution box was held only by a search's record, not by a list read after the country box. | A list read after the field it follows counts as made under that value; a list read after an escape is left to the escaped branch's check. |
| A country box no part→option row fills made the row check skip silently. | Refused, for a row resting on a read recording it; a constant is keyed for nothing. |
| The country rule refused a list on the page whole, which does not depend on the escape. | Applied only where the list depends on the escape; P293's check against the field's options otherwise. |
| A read recorded without `under` was offered to every country. | The record is now required, so that cannot be built. |
| The comparison script matched a record that left out the country. | It compares every field of the chain the file printed. |
| The sheet and the entry's notes said the country was "not set by hand" and "his". | Said as it is: entered by hand in P294 from read 1's heading and the plan; R and T print it. |
| ADR-0156's end still pointed to P293's files, and a heading still called §4(a) his to make. | Repointed, P294's build added, the heading corrected. |
| "43 rows (measured)" was attached to a forecast, without its method. | Counted by `scripts/rows-held-to-a-country.ts`, its output quoted; the forecast marked as a simulation. |
| The plan said every read records what it was made under; L does not. | Said of R and T only. |
| The sheet said the rule stops the row reaching anyone else, which P293's `IR` key already did. | Said what P294 adds: a key the read's country does not match is refused. |
| His preview change to a listed entry was in no plan. | Added to ADR-0156's not built and to phase 2, with ADR-0155's change of a recorded choice as its prerequisite. |
| The interim for the saved-page case read as decided. | Marked as this ADR's proposal, his to decide. |
| His case 4 turns on a submission the system does not observe. | Recorded as a question his decision raises, his to decide when the build reaches it. |
| The reading of withdrawal paraphrased "the page". | It now quotes his cases as he put them. |

Refuted and left as they were: that ADR-0020 blocks going back after handover (it forbids keeping
access, not returning), that his case 4's scope sentence was lost (it is quoted whole), and that
ADR-0156 gives two routes for one request (it names a correction and a withdrawal as different
requests).

## What this was proven against

- **The whole suite on the patched tree**, under a **temporary local approval** over the new hash,
  never committed, on the code as committed: **3,349 of 3,349 tests, 166 files, green** (`vitest
  run`, 2026-10-09, from 10:35 UTC, 689 s, against real PostgreSQL and Redis, nothing else running).
  The script applied the patch and the approval, then restored the signed approval and removed the
  patch; afterwards `approvals.json` differed from the signed file by nothing.
- **The run before it went red, and why it was re-run.** At 10:16 UTC, on the same code and patch,
  with 26 review agents and a records test run on the machine at the same time, one file failed,
  `apps/browser-runner/src/preparation.test.ts`. Three tests had `Hook timed out in 10000ms`, and
  a fourth read `GB is not offered`. Run alone, that file passed 52 of 52 on `main`, and again on
  the patched tree under the temporary approval. The whole suite then passed with nothing else
  running. So the timeouts came with the load, but the cause was not established beyond that. If it
  recurs on a quiet machine, that browser hook's ten seconds is the thing to look at. Its report is
  kept at `p294-patched2-vitest.json` in the session's scratchpad.
- **An earlier run, before the review's rework** of the rule: 3,346 of 3,346 on the same patch.
- **Fail-first:** with the signed approval restored and the patched entry kept, `run-a-profile`
  went red, as `main` would be if the patch landed unsigned.
- **The patch applies** on `main` with P294's code (`git apply --check`). Applied, it hashes to the
  hash above; removed, the entry hashes to `effa83b5…` again.
- The deterministic stand-in and the fixture portal only. Nothing touched Sheffield.

## What signing costs

Nothing metered: no model call and no AWS. The walk after it is his, on his own account.
