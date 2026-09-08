# ADR-0085 — A published demonstration is guarded on what it shows

**Status:** **Accepted** — 2026-09-08
**Completes:** [ADR-0072](./0072-a-decision-is-enforced-where-it-is-made.md) — which found one
demonstration that could not be wrong, fixed that one, and left four others in the same state

## Context

P37 found `pnpm run walkthrough` printing **REFUSED** through nine consecutive steps and exiting 0.
ADR-0072 gave that script per-step expectations, and `walkthrough.test.ts` made them load-bearing.

The precedent was never applied to the rest. `package.json` publishes twelve commands. Five —
`interview-demo`, `extraction-demo`, `catalogue`, `interventions`, `inspect-discovery` — had **no
guard of any kind**.

P51 ran all five. **Every one behaves correctly today.** That is not the reassurance it sounds like:
it is the same sentence that was true of the walkthrough the day before it rotted.

## Exit code is not the property

The walkthrough's defect **passed** an exit-code check. Nine refusals, status 0. So a guard that only
runs a command and looks at its status reproduces the failure it is supposed to catch.

Each command is therefore asserted on what it exists to *show*:

| command | the property |
|---|---|
| `extraction-demo` | an honest reader **accepted**, and an inventing one **discarded** |
| `interview-demo` | the interview both asks and refuses — a gate shown only by things passing through it is not shown |
| `catalogue` | with no argument it **refuses** and says how to call it, rather than exiting 0 having done nothing |
| `interventions` | the same for a missing service credential, and it must not print a credential while explaining that one is absent |
| `inspect-discovery` | its usage contract; it needs a discovery run directory and this repository has none that is not a fixture |

**`extraction-demo`'s two halves are not symmetric, and the second is the one that matters.** A run
where the honest reader is refused is P37's shape — visible, embarrassing, harmless. A run where the
**inventing** reader is *accepted* means ADR-0016's guarantee, that an extracted value must quote the
document, has stopped holding. It would exit 0 and look like a working demo. The regression proving
that case is the reason this file exists.

## A defect found by writing the guard

`extraction-demo`'s closing line read:

> `0 readings accepted, 8 discarded. Nothing was shown to the student.`

as the last line of a **three-section** demo whose first section accepted nine. Read on its own — and
the last line of a long run *is* the line read on its own — it says the demonstration accepted
nothing.

I misread it exactly that way, in this repository, while looking for demonstrations that report a
refusal as a success, and reported a defect that was not there before checking the sections above it.
The tally now names the reader it counts and states the honest section's total beside it, because the
**contrast is the demonstration** and a summary that reports one half is worse than no summary.

## Decision

**§1 — Every published command that can run unattended is guarded on its property**, in
`scripts/demonstrations.test.ts` or a file of its own.

**§2 — The list cannot go stale in the direction that matters.** A command added to `package.json`
and guarded nowhere fails the check. `discover` and `inspect` are excluded **by name**: both drive a
real browser at a real portal, which this repository has never had and which is blocker 1.

**§3 — A summary line names its scope.** A tally printed at the end of a multi-section run says which
section it counts.

## What this deliberately does NOT do

- **It does not re-implement each demo's assertions in the test.** ADR-0072's reasoning holds: the
  expectations belong next to the narrative they are about. These check the *shape* of the output —
  that both halves of a contrast are present — not the content of each line.
- **It does not guard `discover` or `inspect`.** A guard that cannot run is worse than none, because
  it appears in the list as coverage.
- **It does not extend the walkthrough** to the paths added since P37 — the escalated-run resume, the
  refusal wordings, the second-attempt exchange, retention and expiry. Those are exercised by
  `scripts/p18`–`p21` and `journey.test.ts`. A walkthrough that narrates everything narrates nothing,
  and widening it is a decision about what the demo is *for*, not a gap to be filled.

## Consequences

- Four deliberate regressions, each verified from disk: making the honest reader confabulate fails
  four tests; making the **inventing** reader honest fails the one named for it; reverting the tally
  line fails by name; adding an unguarded command to `package.json` fails by name.
- P49's guard was extended in passing. It compared the index's stated Accepted count against a
  **hand-written map** of numbers to words that ran 78 to 84; this ADR is the eighty-fifth, and it
  failed with *"no spelling for 85"*. A list needing extension whenever the thing it counts grows is
  the defect ADR-0082 through ADR-0084 removed, so the spelling is computed. The guard failing loudly
  rather than passing is why it was noticed at all.
- **The declared-but-unreachable surface is unchanged at seven.** Nothing here is a capability.
