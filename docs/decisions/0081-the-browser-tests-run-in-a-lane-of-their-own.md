# ADR-0081 — The browser tests run in a lane of their own

**Status:** **Accepted** — approved by Vahid Mohammadi, 2026-09-08
**Continues:** [ADR-0072](./0072-a-decision-is-enforced-where-it-is-made.md) — a demonstration that
cannot fail is not evidence; neither is a suite that fails for reasons nobody acts on

## Context

Two full-suite runs in five failed, each on a different browser test, each of which passed 4/4 when
run on its own. `two-origin.test.ts` had diagnosed the shape in its own comments long before:

> The page is STARVED: several Chromium instances run in parallel across this directory's suites,
> and under that load a page can take well over ten seconds to process an input event.

It fixed its own instance by retrying the input. That was right for that test and wrong as a
strategy. Vahid, 2026-09-08:

> A suite that goes red for reasons that turn out not to matter teaches everyone to discount red, and
> the cost lands on the day a real failure arrives and gets waved through. Two in five is well past
> that threshold. **Fix the contention rather than the assertions.**

## What was measured

On the four-CPU container the suite runs in, sampling once a second through a full run:

| | before |
|---|---|
| peak concurrent browsers | **3** |
| peak Chromium processes | **21** |
| peak load average | **5.13** (of 4 CPUs) |

A browser file run **on its own** peaks at one browser and six or seven processes. So the contention
is between files, not inside them: Vitest schedules test files across workers, and three or four
browser files landing together saturates the machine.

The browser files sum to **87 seconds** of the suite's **242 seconds** of work, so they are not the
critical path and can be serialised without becoming one.

## Decision

**The seventeen test files that launch a browser run in a lane of their own, one at a time, while
the other ninety-six keep all their parallelism.**

`vitest.workspace.ts` defines two projects: `unit` (everything else, parallel) and `chromium` (the
browser files, serial).

| | after |
|---|---|
| peak concurrent browsers | **1** |
| peak Chromium processes | **7** |
| peak load average | **3.13** |
| full-suite wall time | 119s → **176s** |

**Five consecutive full runs, clean**, against two failures in the five before.

## Three things this cost, and what they taught

**`fileParallelism: false` cannot be set on a workspace project at all.** It was set anyway, and it
did nothing: the lane still ran about three files at once and still peaked at three browsers.
Vitest lists `fileParallelism` in `NonProjectOptions`, alongside `maxWorkers` and `coverage` — it is
a root-level setting, and a project carrying it is ignored at runtime with no warning. The config
loader accepted it, the measurement showed it doing nothing, and only `tsc` said why. That order is
the lesson: the lane had *looked* serialised while doing nothing, which is the exact state the phase
set out to leave, and the thing that made it look serialised was a setting that had no effect.

`poolOptions.forks.singleFork` is a project setting and is what made the measured difference. It is
now the only serialising setting, and the guard asserts both that it is present and that
`fileParallelism` is *absent* — a plausible-looking belt-and-braces re-addition is worse than
nothing, because it stops the next person looking further.

**A project that `extends` a config MERGES its `include` rather than replacing it.** The first
attempt left `include` in `vitest.config.ts`, and the browser lane matched all 113 test files instead
of its 17: every file ran in both lanes, the run went from 2,283 tests to 4,274, and the load average
got *worse*. File selection now lives in one place, and `vitest.config.ts` says why it is not there.

**Grepping for `chromium.launch` finds twelve of the seventeen.** Five launch through a
`PlaywrightDiscoverySession` or `PlaywrightInspectionSession`, and each was measured spawning eight
Chromium processes. The narrow predicate was not a smaller truth; it was a wrong one. The guard
follows one level of first-party imports.

## What this deliberately does NOT do

- **It does not touch a single assertion or timeout.** No test was made more patient to accommodate
  the load; the load was removed. If a test still fails, the failure is about the code.
- **It does not claim the suite is now deterministic.** Five clean runs is evidence, not proof. What
  changed is measurable — three browsers to one, load 5.13 to 3.13 — and the claim is limited to
  that.
- **It does not retire `two-origin.test.ts`'s retry.** That helper handles a dropped input event,
  which is a different failure from a late one and is not fixed by removing contention.

## Consequences

- The suite takes about a minute longer and stops going red for reasons nobody acts on. That trade
  is the point: red has to mean something.
- `BROWSER_TEST_FILES` is a list, and `browser-lane.test.ts` checks it in both directions — a file
  that starts launching a browser and is not added rejoins the contention silently, and a listed file
  that stops launching one is serialised for nothing.
- The declared-but-unreachable surface is **unchanged at seven**. Nothing here is a capability.
