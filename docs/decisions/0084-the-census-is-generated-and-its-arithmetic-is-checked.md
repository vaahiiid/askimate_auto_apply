# ADR-0084 — The census is generated, and its arithmetic is checked

**Status:** **Accepted** — 2026-09-08
**Continues:** [ADR-0083](./0083-an-adr-and-the-lists-of-it-must-agree.md) — the third record-integrity
finding in as many phases, and the one that ends the thread by removing the record rather than checking it

## Context

`state-of-the-system.md` §7 carried a per-area test table by hand. P50 measured it against a real run.

**Six of twenty rows were wrong**, every one understating:

| area | stated | actual |
|---|---|---|
| `packages/domain` | 351 | **373** |
| `apps/conversation-service` | 292 | **330** |
| `packages/documents` | 52 | **67** |
| `packages/profile` | 39 | **46** |
| `packages/case-store` | 139 | **143** |
| `packages/extraction` | 23 | **27** |

**And `scripts` — 264 tests — had no row at all.** The largest single area outside the top three was
invisible, folded into a line that read *"everything else | ~346"*.

## The part that needed no run at all

**The table did not add up to its own stated total.**

```
its rows summed to               1,824
plus its own "everything else"    ~346
                                ------
                                 2,170
against its own stated total     2,306
```

A hundred and thirty-six tests unaccounted for, in a document the README says to read first, for
weeks. Detecting the six wrong rows needs a suite run. **Detecting this needs addition**, and nothing
had ever added up the table it was reading.

**The tilde is the mechanism.** `~346` cannot be wrong. No reader could tell 346 from 482 and no
check could either, because the table was not claiming to be exact. An approximation in a record is
not modesty about precision; it is an assertion that cannot be falsified, sitting in a document whose
entire purpose is to be checkable.

## Decision

**§1 — The table is generated.** `pnpm run census` runs the suite, groups every test file by the
workspace it lives in, and rewrites §7 between two markers. Areas below twenty tests fold into
*everything else*, which is an **exact** figure.

**§2 — Its arithmetic is asserted, and that costs nothing.** `scripts/census.test.ts` adds the rows
up and compares them with the stated total, refuses a tilde, refuses a row naming a directory that
does not exist, and refuses a table with its markers removed. None of this needs a run.

**§3 — CI runs the census as its integration suite, and fails if the committed one is stale.** A
generated number nobody regenerates decays exactly as a hand-written one — §2's guard checks that the
table *adds up*, not that anyone has re-run it, and that gap was found mid-phase when the table said
2,313 against a suite of 2,314. The integration job's `vitest run` becomes `pnpm run census`, which
**is** that run (with a default reporter as well as the JSON one, so a red job still prints test
names), followed by `git diff --exit-code` on the document. It costs no extra suite run, and it is the
only place the whole suite runs against a real database — the only run whose numbers are the true
ones.

**§4 — The generator survives a red suite, and says so.** The first version threw on a non-zero exit
and deadlocked instantly: the census guard fails while the table is stale, so the suite is red, so
the census cannot run, so the table stays stale. That is not an edge case — it is the **normal** case,
because the reason to run a census is that the suite changed and the table did not. The report is now
read either way, the table is written, the failing files are named, and the exit code is passed
through. It never reports a green suite it did not get.

## Why this generates and ADR-0082 refused to

Two phases ago the same question was asked about the declared-but-unreachable table, and the answer
was **no**. That table's second column is *"why it is kept"* — a judgement citing ADR-0019's
constraint-before-the-thing and ADR-0071's refusal to add a caller over unreachable code. A generator
would either drop it or force it into a checker, which is not a place to argue.

This table has no such column. It is twenty area names and twenty integers, and **there is nothing in
it a person knows that a run does not**. A number a person must recount by hand to verify is a number
that will be wrong.

Same question, opposite answer, and the content is the reason. That is the rule the two decisions
establish together: **generate what is arithmetic, check what is judgement, and never confuse them.**

## What this deliberately does NOT do

- **It does not generate the headline counts** in the README and §1. They are three numbers a phase
  already touches, and threading a generator into two more documents to save three edits would add
  more machinery than it removes.
- **It does not run the census in `verify`.** The census runs the whole suite, and making `verify`'s
  suite run the suite is a loop. The guard runs *in* the suite; the generator is a command.
- **It does not claim the six wrong rows were anyone's negligence.** They were true once. That is what
  a hand-maintained number is: correct at the moment it is written and decaying from then on.

## Consequences

- The table gains `scripts` (264) and `packages/conversation` (52), neither of which it had ever
  listed, and *everything else* falls from an approximate 346 to an exact 98.
- Four deliberate regressions, each verified from disk: altering one count fails the arithmetic;
  restoring the tilde fails two; renaming an area to one that does not exist fails by name; removing
  the marker fails by name.
- The fourth is recorded with a correction. It first failed as a **collection crash** — vitest
  reported "no tests", which fails the run without saying why — because the section lookup asserted at
  module scope. That is the P47 mistake inside the fix for a different one. The absence is now a value
  and the marker has its own named test.
- **The declared-but-unreachable surface is unchanged at seven.** Nothing here is a capability.
