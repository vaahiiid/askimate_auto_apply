# Step 2 of Vahid's own run — the batch for his signature (P283)

**Status: stopped before the signature (P284), and re-cut.** The first cut (`sha256:9726453b…`) was never signed: its grade note said the list was "read" when it rested on a summary, and its notes carried the wrong date. The re-cut has the same rows and true notes. Nothing here is on `main` as entry content. The batch is the
patch [`p283-step2-batch.patch`](./p283-step2-batch.patch), applied and signed in one commit, so
`main` never holds an entry no approval covers. An unsigned entry would stop his stack and turn CI
red (`loadCatalogueDirectory`, ADR-0055; the pin in `scripts/run-a-profile.test.ts`).

## What he decided, in his words (2026-10-04)

**Whose words these are is for him to confirm before he signs.** They came in a message of
2026-10-04 12:08 UTC, written in the first person. The message of 14:19 UTC that stopped the
signature speaks of Vahid in the third person (*"Vahid sent the full list and I paraphrased it to
you"*). CLAUDE.md: a decision is his only if he typed it in his own words.

- Institution: *"Islamic Azad University → UNI30764"*.
- Grading system: *"6"*. Grade: *"19.5"*. Award title: *"MSc"*.
- Subject: *"Not in list, with the real subject typed in the free-text box … Same escape case as
  the institution, and the same rule: mine to choose, by hand."*
- Doctorate: *"institution not on the list at all; the whole entry by hand."*

## What the patch changes

Blueprint 0.2.31 → **0.2.32**, mapping set 0.3.42 → **0.3.43**. Six files: the entry, its two
drafts, the read file `what-will-be-typed.md`, and the two tests that pin them.

| Box | Before | After |
|---|---|---|
| `institution-ts-control` | 9 rows (Sheffield's) | **+34**: every entry of his "Azad" read except `IRAN Iran`, as identity rows (label → value). *Islamic Azad University → UNI30764* is among them. |
| `gradingSystemId` | Sheffield's four, by level | **+1 option, +1 case**: `6` "GPA 20 (e.g. 16.5/20)". When institution is *Islamic Azad University* and grade scale is *20-point*, the box gets `6`. |
| `grade` | System 7's nine | **+199 options** (0.0 to 20.0 in tenths; "2.1" and "2.2" were already in the list). **+1 case**: *Islamic Azad University*, grade scale *20-point*, grade → the same text, plus the two non-grades. |
| `subject` / `subjectSearch` | One "business" search, 85 results | **+10**: his whole "international" read, as identity rows, searched with `international`. *International Business* is not among them, so it is **not mapped**: it is his escape. |
| Escapes recorded | none on these selects | `subject` and `gradingSystemId`: "Not in list". `degree`: "" (the empty entry opens its box). Institution: unchanged, "Not in list". |
| Registration (P261, row 117) | AUTH 4 and 5 "not observed" | The measured answer and the registration-button reading. The two lines of `p261-registration-measured.patch`, now inside this batch. |

Every row added is an identity: the key is the portal's own text for the entry it names
(ADR-0153). `checkUsable` checks this since P282 (`row_not_identity`) and passes on the patched
entry.

## What the plan does with it

Measured through the real parser, `checkUsable` and `planFill` on the patched entry. The
education entries were his as described; the dates were synthetic.

- **His Master's alone:** typed `IRAN`, `UNI30764`, `MSc`, `6`, `19.5`. **Two blockers:** `subject`
  and `subjectSearch` for *International Business*. That is the escape case, as he decided.
- **With the doctorate:** **eight blockers**. The doctorate's institution (*HHE*), degree, subject,
  grading system and grade, plus the Master's subject twice. The Master's still types as above.
  The student's message explains the escapes (P279, P280).

So the run still **stops before any page is filled** (`nextStep`, row 133). Every blocker is a
part he enters by hand, which is the walk he chose.

## The new hash

```
sha256:effa83b50811afce46d70fd3aba1af56f9e7af7fb94a979985b791463b11b727
```

Computed with `pnpm run catalogue hash docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json`
on the patched tree. Re-cut in P284; recomputed after applying the patch to a clean checkout of `3090d42`: the same
hash, and the six files byte-identical to the tested ones.

## How to sign: one commit

```sh
git apply docs/run-a/p283-step2-batch.patch
# then edit docs/run-a/catalogue/approvals.json — replace the one entry (see below)
pnpm run catalogue hash docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json   # must print the hash above
git add -A docs/run-a docs/captures/sheffield-pgt-2026-09-10 scripts/run-a-profile.test.ts scripts/sheffield-draft.test.ts
git commit
```

The approval file keeps **one** entry. The test asserts exactly one, so the old entry goes out in
the same commit:

```json
[
  {
    "contentHash": "sha256:effa83b50811afce46d70fd3aba1af56f9e7af7fb94a979985b791463b11b727",
    "authoredBy": "Vahid Mohammadi",
    "approvedBy": "Vahid Mohammadi",
    "approvedAt": "<when you sign, UTC>",
    "ownAccountOnly": { "studentId": "5774ff16-ff9c-424a-882f-42d0f304968b" },
    "note": "<your words>"
  }
]
```

The `note` is his to write. The `studentId` is the one the current signature admits and the test
pins. If his run is under another student, the test changes with it, and the patch is cut again.

## Before he signs: three things only he can confirm

1. **The grade labels: still not passed through whole.** P283's rows were built from a summary.
   The list sent in P284 to correct it was six lines and `[… through …]`.
   - Every line that was sent matches: the placeholder, the two non-grades, `0.0`, `0.1` and
     `20.0`.
   - So **5 of the 203 rows are confirmed, and 198 rest on the description**, `19.5` among them.
   - Nothing sent differs from what was built, so there is nothing to rebuild.
   - The entry's grade note now says exactly this, so a signature over it signs what is true.
   - What closes it is the form's own output: the `inspect:attached` file from that read, or the
     console output pasted unedited, all 204 lines. `scripts/read-against-entry.ts` then compares
     it line by line, and every row the entry sends, under that institution, against the read:
     `pnpm exec tsx scripts/read-against-entry.ts docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json grade <file> "Islamic Azad University"`.
     On the shortened list it reports 5 confirmed and 198 not, and exits 1.
   - Signing on 5 of 203 is his call to make, not the agent's.
2. **His profile's words.** The rows key on these strings:
   - institution *Islamic Azad University*
   - country `IR`
   - award title *MSc*
   - grade scale *20-point* (`twenty_point`)
   - grade *19.5*

   A profile holding anything else (for example *19.50*, or *Azad University*) refuses at that
   box, loudly, before any page. It never types a wrong value.
3. **`IRAN Iran` left out: confirmed** in the message of 2026-10-04 14:19 UTC. It is the country
   box's entry, caught because the agent's selector `.ts-dropdown [data-value]` was not scoped to
   one box. The reason is written into the institution row's note and the capture record, so
   nobody adds it later as something missed.

## What this was proven against

- The full census ran against the patched tree with a **temporary local approval** over the new
  hash: 3,269 tests, 162 files, green (the second run; the first had Redis down and is not counted). Typecheck, lint and boundaries were green too. The approval
  was never committed.
- Fail-first: with the signed approval restored and the patched entry kept, `run-a-profile` went
  red. The message was *"signed at item 6 — the directory loads … expected false to be true"*. That
  is what `main` would show if the patch landed unsigned.
- Against the deterministic stand-in only. Nothing touched the portal.

## What the next action costs

Applying and signing costs nothing metered: no model call, no AWS. The run after it is his own act
on the real portal, as before. It is the step that spends whatever his stack spends per run.
