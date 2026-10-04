# Step 2 of Vahid's own run — the batch for his signature (P283)

**Status: waiting on his signature.** Nothing here is on `main` as entry content. The batch is the
patch [`p283-step2-batch.patch`](./p283-step2-batch.patch), applied and signed in one commit, so
`main` never holds an entry no approval covers. An unsigned entry would stop his stack and turn CI
red (`loadCatalogueDirectory`, ADR-0055; the pin in `scripts/run-a-profile.test.ts`).

## What he decided, in his words (2026-10-04)

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
sha256:9726453bc7318fed5bbd43e3955c2488282a0622174d845b20096d1209fd1f32
```

Computed with `pnpm run catalogue hash docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json`
on the patched tree. Recomputed after applying the patch to a clean checkout of `c513afd`: the same
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
    "contentHash": "sha256:9726453bc7318fed5bbd43e3955c2488282a0622174d845b20096d1209fd1f32",
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

1. **The grade labels.** The 201 rows rest on his description, *"the 0.0–20.0 one, value equals
   label"*, not on a list read whole. If any label differs (for example `20` rather than `20.0`),
   that row is wrong and the others are not. His run uses **`19.5`**. Under the whole-list rule
   (P218), the full list he offered to send is what makes the rows read rather than inferred.
2. **His profile's words.** The rows key on these strings:
   - institution *Islamic Azad University*
   - country `IR`
   - award title *MSc*
   - grade scale *20-point* (`twenty_point`)
   - grade *19.5*

   A profile holding anything else (for example *19.50*, or *Azad University*) refuses at that
   box, loudly, before any page. It never types a wrong value.
3. **`IRAN Iran` left out.** It headed his "Azad" read and was taken as the country box's entry,
   not an institution. If it is an institution entry, it is one more identity row.

## What this was proven against

- The full census ran against the patched tree with a **temporary local approval** over the new
  hash: 3,269 tests, 162 files, green. Typecheck, lint and boundaries were green too. The approval
  was never committed.
- Fail-first: with the signed approval restored and the patched entry kept, `run-a-profile` went
  red. The message was *"signed at item 6 — the directory loads … expected false to be true"*. That
  is what `main` would show if the patch landed unsigned.
- Against the deterministic stand-in only. Nothing touched the portal.

## What the next action costs

Applying and signing costs nothing metered: no model call, no AWS. The run after it is his own act
on the real portal, as before. It is the step that spends whatever his stack spends per run.
