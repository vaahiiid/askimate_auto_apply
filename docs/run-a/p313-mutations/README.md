# P313's mutations

Each file is one mutation of P313's code, the command run against it, its exit status, whether the
file was restored byte for byte, and the test lines the run printed. A name ending
`.green-it-survived.txt` means the tests stayed green with the code broken. The harness is
`p313-mutate.py` in the session's scratchpad. It is not in the repository, and this directory is
what it wrote. The run started after P313's second review was fixed: 35 mutations, all restored.

**Killed: 30 of 35.** Mutation 17 (an abandoned run not read as a stop) survived the first run. No
test covered a run a person set aside before P278 with its case left open. That test was added
(`run-driver.test.ts`, "a run a person set aside before P278…"), and the rerun killed it. Both
files are kept: `17-…first-run.green-it-survived.txt` and `17-….txt`.

**Survived: five. Each guard stays, and each is a second check behind one that is tested.**

- **02, `#askTheStudent`'s check.** Every caller now checks first: the advance path returns
  through `#windDown`, `#askAfterWriting` checks at its top (29, killed), and the presses are
  refused in `recordDecision` (03, killed).
- **05, `runFor` dropping a non-hand-back decision.** `#pendingDecision` is called with
  `handBackOnly` on a stopped application (06, killed), so it returns nothing to drop.
- **09, `#sayWhatArrived`'s check.** Its caller on the message path, `#askAfterWriting`, checks
  first (29, killed). Its other caller is `reportReading`, a CV reading reported after the stop.
  What that reading should do is his to decide (row 196, point 11), so no test asserts it.
- **31, the check inside `#putTheQuestion`'s lock.** It closes the window between the second
  model call in `answerStudent` (`nextAction` composing a composite's next part) and the write.
  The race test holds the first model call, where the check after the model (30, killed)
  answers. No test holds the second.
- **32, the check in `#putToTheStudent`.** The confirm branch of `nextAction` makes no model
  call, so the only window before the playback's write is the one 30 closes.
