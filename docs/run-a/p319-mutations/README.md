# P319's mutations

Each file is one change made to P319's code on purpose, the tests that read it run, and the code
put back. A mutation is killed when the test command exits non-zero. Each file says the mutation,
the command, its exit status, whether the file was restored byte for byte, and the failing tests as
vitest printed them.

The harness (`p319-mutate.py`, in the session's scratchpad, not in the repository) ran in a scratch
worktree holding the same files as `main`'s working tree at the time, checked file by file with
`cmp` before the run. It ran each distinct test command once unmutated first:
`00-baseline.txt`, seven commands, each exit 0.

**Result: 22 mutations, 22 killed, 22 restored byte for byte.** Counted from the files:
`grep -l "^exit: 1"` and `grep -l "restored byte for byte: True"` over `[0-9][0-9]-*.txt` each
list 22, and the baseline holds seven `exit: 0`.

| # | What was broken | Killed by |
|---|---|---|
| 01 | the minors fingerprint taken over the date of birth alone | his answer 1's test |
| 02 | a list choice left out of the minors fingerprint | his answer 11's test |
| 03 | a box the entry leaves empty reopened as if it said ask | the derivation and checker tests |
| 04 | "The funding has been confirmed" offered after a no | his answer 6's tests |
| 05 | a near match chosen | his answer 5's test |
| 06 | the form's own words not used | the in-form-words tests |
| 07 | the recorded line in our words, not the form's | the playback test |
| 08 | a no that drops the stage | the assemble tests |
| 09 | a demand rebuilt without what the entry asks | the demand test and the case-begin tests |
| 10 | no check when a case begins | the case-begin tests |
| 11 | the check on every resume | "not on every resume" |
| 12 | a case-begin demand kept once the held answer no longer needs it (review) | the moot-demand test |
| 13 | a ruled-out value not refused | his answer 6's tests |
| 14 | the checker blind to a part asked in the form's words | the checker test |
| 15 | `absent: "ask"` rendering an empty value | the format test |
| 16 | the parser dropping `ask` | the catalogue test |
| 17 | a box the form does not require reopened (review) | the derivation test and the unasked-ask gate |
| 18 | a value outside the part's own list offered (review) | the vocabulary test |
| 19 | the unasked-ask gate passing everything (review) | the unasked-ask gate |
| 20 | the "You said" line in our labels (review) | the "You said" test |
| 21 | "confirmed" told only when said exactly (review) | the "however they say it" test |
| 22 | "not confirmed" told it means yes (review) | the "however they say it" test |

The test each one failed is in its file, as vitest printed it.

## What changed since the first run, and why

The first run (16 mutations) is not kept; these files replace it.

- **Mutation 11 survived the first time.** Breaking the case-begin check so it ran on every resume
  failed no test. The test meant to catch it started the application a second time while a person
  held the run, and a held run returns before the check, so the second start never reached it. The
  test was reordered so the second start comes while the run is live, and it then killed the
  mutation. The assertion on the run's status added at the same time was wrong (the position
  is read after the decide) and was taken out.
- **Mutation 12 changed.** It broke the sentence said before a question asked when a case begins.
  P319's review found that sentence claimed more than the entry says, and it was removed (row 217).
  Mutation 12 now breaks the review's mend for a demand the held answer no longer needs.
- **Mutations 17 to 22 are new**, one or more for each of the review's code fixes
  (`docs/run-a/p319-review-findings.txt`).
- **Mutations 10 and 11** now break `if (record.revision === 0)`, the condition the review's
  fix put in place of `if (!resumed)`.
