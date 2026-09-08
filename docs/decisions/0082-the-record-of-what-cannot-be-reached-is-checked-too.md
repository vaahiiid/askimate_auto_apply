# ADR-0082 — The record of what cannot be reached is checked too

**Status:** **Accepted** — 2026-09-08
**Completes:** [ADR-0073](./0073-a-declared-capability-with-no-production-caller-fails-the-build.md) — which
made the build ask the question, and left the document answering it by hand

## Context

ADR-0073 turned P37's method into a check. Since P39 the build has asked, of every capability a
decision calls enforced, *does anything in production call it?* — and the register in
`scripts/check-reachability.ts` has carried the answer, with a reason and what would close it for
each of the ones that cannot be reached. Every phase report since has quoted its number.

`docs/state-of-the-system.md` §4 answered the same question for a person. The README says of it:

> **▶ State of the system — the standing account.** What is built, what is live, what is stubbed,
> what is declared but unreachable … **Start here.**

Nothing reconciled the two. They had drifted, in both directions at once.

## What was found

**`checkMinorGate` was in the register and in no row of the document.** One of the seven, and not an
incidental one: it is ADR-0011's gate on an application involving a **minor** — a mandatory-review
category. The register says plainly why it cannot be reached (its one blocking condition is at the
submission stage, and submission is out of scope by ADR-0014) and that the *trigger* which stops a
case for review, `suggestsMinority`, is a different thing and *is* enforced. None of that reached the
document. A reader of the standing account would have counted the rows, got the right total by
coincidence, and believed the minors gate was enforced.

**`packages/notify` sat under the heading "Declared but unreachable" with a cell that began
"Reachable."** It is: set `AAS_SPECIALIST_WEBHOOK_URL` on the worker and the specialist notice runs.
The row said so, under a heading asserting the opposite, and had done since P36.

A row that argues with its own heading is worse than a missing one. A missing row reads as an
oversight; this one reads as reviewed — somebody looked, wrote a true sentence, and filed it under
the false claim. Every reader after that inherits the filing, not the sentence.

Neither finding is a code defect. Neither would ever have failed a build. **That is the argument for
this decision:** the register is checked and the prose was not, so the prose is where a false record
now accumulates. Eight consecutive phases have found a record asserting something production does not
do, and the record doing it this time is the one describing the check.

## Decision

**§1 — The document's register table is checked against the register, in both directions.**
`scripts/unreachable-is-documented.test.ts` imports `CAPABILITIES` and asserts that the set of
symbols named in the first column of §4's table A equals the set the register marks unreachable.
Missing one fails. Naming one the register never entered fails. Naming one the register calls
*reachable* fails.

**§2 — The two granularities are separated rather than merged.** The register asks about **one
symbol** and answers with **one caller**. Some things genuinely cannot be reached and are not
expressible as that question: a package with no dependents, a *branch* of an enforced function, a
research build. Those live in table B, which the check does not police, and each says why it is not a
register entry.

`recommendWait` is the case that forced the distinction. The symbol is **enforced** — the run driver
calls it. Its `next_intake` branch cannot be reached, because the catalogue port resolves a blueprint
by id and cannot list. Putting the symbol in table A would be false; deleting the note would lose a
real fact. It belongs in B.

**§3 — No row may contradict the heading it sits under.** A row under the unreachable heading
asserting reachability fails the check. `packages/notify` moves to *Built, but never run against
anything real*, where its own sentence is true.

**§4 — The register is importable without running.** `main()` now runs only when the script is the
program. Without that, importing the register to check the document would run the whole check as a
side effect and leak its `process.exitCode` into the suite — a test file able to fail for a reason it
never asserts.

## What this deliberately does NOT do

- **It does not generate the table.** The generated version would be a worse document. *"Why it is
  kept"* is a judgement — ADR-0019's constraint-before-the-thing, ADR-0071's refusal to add a caller
  over unreachable code — and a generator would either drop it or force it into the register, which
  is a checker and not a place to argue. The document keeps its prose and loses only the freedom to
  disagree.
- **It does not check table B.** Policing prose about packages and branches would mean inventing a
  second register at a granularity nothing else uses, to check sentences no build can verify. The
  honest position is that A is checked and B is not, said out loud in the document.
- **It does not extend the check to every document.** The README's counts and the ADR index's
  narrative are also hand-written and also drift. This is the one the README calls the standing
  account, and it is the one that was wrong. Widening it is a phase, not a footnote.
- **It changes no capability's status.** Nothing became more or less reachable. The register's answer
  was right throughout; it was the document that was wrong.

## Consequences

- Five deliberate regressions, each verified from disk: deleting the `checkMinorGate` row fails 2;
  listing the enforced `recommendWait` fails 3; inventing a row fails 2; restoring the
  `packages/notify` contradiction verbatim fails 1; calling `main()` unconditionally fails 1.
- The fifth is recorded with its limit. With the register **passing**, removing the guard and running
  `main()` on import left the suite green at 7/7 — the check ran, printed into the test output, and
  set no exit code. It only bit when the register was *also* failing, and then it failed this file
  for a reason the file never asserted. So the guard is asserted in the source as well, which is what
  closes it. Coverage that exists only in the case where the defect has already done harm is not
  coverage of the defect.
- **The declared-but-unreachable surface is unchanged at seven.** Nothing here is a capability.
