# P314's mutations

Each file is one mutation of P314's change: the command run against it, its exit status, whether
the file was restored byte for byte, and the test lines the run printed. The harness is
`p314-mutate.py` in the session's scratchpad. It is not in the repository, and this directory is
what it wrote.

**Killed: 5 of 5.**

- **01, migration 0040 without the underscore.** The schema test and both driver tests go red with
  the refusal his run met.
- **02, migration 0040 dropping the check without adding it back.** The refusal controls go red:
  a check that took anything would be caught.
- **03, an unknown field key fed to the field-key loop.** The loop goes red, so it can see a
  refusal. The part-key loop showed the same before the fix, when it listed the seven claims.
- **04, an unreadable part's answer given no reason again** (row 197's second road, `interview.ts`).
  The driver test and two interview tests go red: the claim comes back word for word.
- **05, the reason kept after the part is read.** The interview test that reads the next claim goes
  red: the next question would open with the old "I could not read". The driver cannot show this,
  because it rebuilds the interview from the log on every request and the log does not carry the
  reason.
