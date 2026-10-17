# P318's mutations

Each file is one mutation of P318's change: the file mutated, the command run against it, its
exit status, whether the file was restored byte for byte, the text replaced and what replaced it,
and the test lines the run printed. All eighteen ran on the finished tree, after the last change
to the code they mutate. The harness is `p318-mutate-2.py` in the session's scratchpad. It is not
in the repository, and this directory is what it wrote.

**Killed: 17 of 18. Survived: 1 (13).**

- **01, a reviewed minor read as an adult** (disclosure reads the outstanding triggers alone, the
  first build's regression). The test that drives a reviewed minor's run to the passport goes red.
- **02, an approval that names no reading.** The binding test goes red.
- **03, a raising after the reading ignored.** The binding test and the rejection test go red.
- **04, content outrun since its raising, approved.** The binding test goes red.
- **05, a review the case does not wait on, approved.** The test of an adult's case approved for a
  minor goes red.
- **06, an outstanding raising not raised again** (a raising from before P318). Its test goes red.
- **07, a trigger raised before not raised again** (a minor turned adult). Its test goes red.
- **08, the yes weighed before the change is raised.** The "a person is checking" test goes red.
- **09, the hand-back held behind the review.** The hand-back test goes red.
- **10, AUTHORISED reached by a walk.** The test of a case voided while filling goes red.
- **11, a document handed over under a review.** The document-lock test goes red.
- **12, a value changed in place keeps its revision** (migration 0041's trigger emptied). The
  in-place test goes red.
- **13, the store overwrites at the revision given** (the store's own `GREATEST` removed).
  **Survived.** Migration 0041's trigger also fires on the store's upsert, so the revision still
  moves and the test cannot see the store's rule alone. The property holds by either; the store's
  rule is not tested on its own.
- **14, an approval clears whatever it covers** (the domain's comparison of `covers` with the
  raising taken out). Five domain tests go red.
- **15, the list missing a line that breaks** (the funding stage's line taken off). The gate goes
  red.
- **16, the list holding a line that does not occur** (a planted line). The gate, the shrink-only
  test and the "names what it waits on" test go red.
- **17, an approval overtakes a later rejection.** The rejection test goes red.
- **18, an update lowers the revision** (0041's second branch emptied). The in-place test goes
  red.
