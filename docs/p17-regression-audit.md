# P17 — the deliberate regressions, and the two guards that turned out to be layered

**Date:** 2026-09-02 · **Governs:**
[ADR-0054](./decisions/0054-the-intent-is-durable-before-the-action.md)

Ten mutations. Each was applied, then the file was re-read **from disk** and the
new text asserted present before any test ran. Restores are from a file copy,
never `git checkout`.

Nine were caught. **One survived**, and following it to *why* is what produced
the test that now covers a race nothing else reaches. Two of the nine were
caught by something other than the test written for them, which is its own
finding and is §2.

The phase also found a defect in P16's own test file — §4 — which had been
failing intermittently depending on which other suites ran alongside it.

| # | The mutation | Caught by |
|---|---|---|
| **Q1** | The intent is never written at claim (the pre-P17 hole, restored) | 8+ assertions across both suites, including `completeIntent`'s own refusal |
| **Q2** | A `succeeded` intent may be re-opened | `REFUSES to re-open an action that succeeded` |
| **Q3** | An unfinished intent may be re-opened | `REFUSES to re-open an UNFINISHED intent` — contract only, see §2 |
| **Q4** | Work is handed out although its intent could not be opened | **survived** — see §1 |
| **Q4b** | as above, against the new test | `REFUSES the claim, and gives the lease back, when the ledger will not open` |
| **Q5** | The claim and the report key different intents (page version dropped) | `offers a CLEANLY FAILED page again` |
| **Q6** | `#unfinishedAction` is removed from `claimWork` | `stops the run and asks a person to look` — but NOT the no-duplicate test, see §2 |
| **Q7** | The intent is written BEFORE the lease is taken | 7 assertions; the double write collides with itself |
| **Q8** | Re-opening does not move `started_at` | `re-opens a CLEANLY FAILED intent, and the row says in-flight again` |
| **Q9** | `#beginIntent` always records and never re-opens | 5 assertions, including the primary key refusing the second row |
| **Q10** | The in-memory store's guard is relaxed while Postgres keeps its | both contract tests, on the in-memory run |

## 1 · Q4 — the refusal that had no test, and the race it exists for

`claimWork` takes the lease, opens the intent, and **refuses the claim if the
ledger will not open it** — releasing the lease rather than handing out work
whose attempt is unrecorded. Q4 deleted that refusal. **Every test passed.**

The reason is the shape this repository keeps finding: `#unfinishedAction` runs
earlier in the same method and already refuses every case the ledger would
refuse, so nothing in any suite produced a claim where `#beginIntent` could
answer `false`.

It is reachable, though. Between those two points another process can finish
the action — the work lease makes it unlikely, not impossible — and what happens
then is the entire question this phase is about. So the case was **built**: a
`RunDriver` wired to a real Postgres store with exactly one method replaced, a
`reopenIntent` that answers `false` as it would if somebody else had completed
the action a microsecond earlier.

Q4b against that test fails on `no work is handed out whose attempt could not be
recorded`, and the cascade behind it is the more telling part: `completeIntent`
throws *"was already completed as failed_cleanly and cannot now be succeeded"* —
the pre-existing defect ADR-0054 §3 describes, resurfacing the moment the
refusal is gone.

Building the driver needed one detail worth recording, because it has now cost
two files: a wrapper made with `Object.create(store)` or `{ ...store }` keeps
the prototype's methods bound to the wrong receiver, and every private-field
access throws `Receiver must be an instance of class`. A delegating object
literal is the only version that works. `consequential.test.ts` records having
hit the same trap.

## 2 · Two guards, layered — and each test only reaches one

Q3 and Q6 were both caught, and both by a *different* test from the one whose
name suggests it. That is not a formality; it changes what the suite is
actually proving.

**Q6 removed `#unfinishedAction` from `claimWork`** — the outer guard, the one
this phase was asked to reuse rather than replace. The no-duplicate integration
test *still passed*: `refuses to hand the SAME work to a second runner once the
lease lapses` was green with the guard deleted.

Because the inner guard held. With the outer check gone, `#beginIntent` still
tried to open a row that was already unfinished, `reopenIntent` refused it, and
the claim was released — so no second account, exactly as required. What was
lost was **visibility**: no intervention, no message to the student, and a run
that would sit for ever with nothing happening and nobody told. That is the
silent stop P10 exists to prevent, and it is what
`stops the run and asks a person to look` caught.

**Q3 relaxed `reopenIntent` to re-open unfinished intents** — the inner guard.
Only the store contract test failed. The integration test could not see it,
because `#unfinishedAction` stops the run before `reopenIntent` is ever reached.

So the two guards genuinely defend different things:

| | prevents the duplicate | raises the intervention |
|---|---|---|
| `#unfinishedAction` (driver) | yes | **yes — only this one** |
| `reopenIntent`'s SQL guard (store) | yes | no |

Both are load-bearing and neither is redundant, which is worth knowing before
somebody tidies one away as belt-and-braces. Recording it also keeps the
integration test honest about its own reach: it proves *no second account*, and
it does not by itself prove *through which mechanism*.

## 3 · What the mutations confirm about the phase's actual claim

Q1 is the one that matters most, because it restores the exact state the system
was in when P16 shipped: the intent written on report, nothing written at claim.
Under Q1 the P17 crash tests fail on `the claim recorded that it was about to
act: expected [] to have a length of 1`, and the P16-era behaviour returns — the
lease lapses and the work is handed to an heir.

That is the before-and-after of this phase, stated as a test result rather than
as an argument.

## 4 · A P16 defect found on the way: two suites, one port

`scripts/runner-supervisor.test.ts` bound port **4907**. That is
`run-driver.test.ts`'s `PORT + 4`, which it uses for one of its servers — and
`run-driver.test.ts` derives ports as far as `PORT + 60`, so 4901–4963 is
effectively reserved without any single file saying so.

When the two files ran together, `refuses a bootstrap for a request that is NOT
open in this conversation` reached the *supervisor suite's* Conversation Service
instead of its own and got a **401 where it expected a 404** — a failure that
appeared and vanished with the file scheduling. It was not caught by
`pnpm run verify` or by CI, both of which run the whole suite in an order where
the two do not overlap; it showed up here only because the regression rounds run
narrow subsets.

Confirmed against the committed `318db36` before changing anything, so it is
P16's and not P17's. The suite now binds **4980**, with the reserved range
written down where the next person will look.

## 5 · An intermittent red build, finally reproduced — and my first diagnosis was wrong

`pnpm run verify` failed once during this phase on
`apps/chat-integration/src/two-origin.test.ts` — *"expected 'I was in the
middle of this' to be 'and I can still type more'"* — and passed on the next
three runs. That is the shape of a failure that gets called a browser flake and
forgotten, so it was chased instead.

**It reproduces on the committed `318db36`**, so it is neither P16's nor P17's,
and it is not one test: eight runs of `apps/chat-integration` produced two
failures across **three different tests** in that file (`— Q2`, `— Q4`, `— Q9`).
The file on its own passed four times out of four.

The obvious explanation is that `#chat-input` is a controlled React input, so a
one-shot `inputValue()` lands between `fill` setting the DOM and React
re-rendering from state. The test directly below the first failure already says
exactly that and polls its precondition for that reason. **That explanation is
wrong**, and the way it was disproved is the useful part: converting the
assertions to `expect.poll` with a ten-second timeout **did not fix them** — the
polls ran out, still reporting the old value.

A poll that times out after ten seconds is not losing a re-render race. The page
is starved. Several Chromium instances run in parallel across that directory's
suites, and under that load a page can take well over ten seconds to process an
input event.

| what was run | result |
|---|---|
| the file alone, 4 runs | no failures |
| `apps/chat-integration`, 8 runs | 2 failures, 3 different tests |
| the same, polling at 10s, 8 runs | 2 failures — **the polls timed out** |
| the same, polling at 30s, 6 runs | no failures |
| `pnpm run verify`, 3 runs | no failures |

The three assertions that a draft *is* something now poll at thirty seconds,
matching the 20s `waitFor`s the file already uses everywhere else. The three
that assert a field is *empty* were deliberately left as one-shot reads: polling
for `""` would pass on the first tick, before the value it exists to rule out
could ever appear.

Recorded at length because the first fix was plausible, cheap, well-precedented
in the same file, and did not work — and shipping it with a confident comment
would have left a wrong explanation in the codebase and the build still red one
run in six.

---

*Ten mutations, nine caught, one survivor now tested. Two guards found to be
layered rather than redundant, one cross-suite port collision closed, and one
long-standing intermittent failure reproduced, misdiagnosed, and then measured.*
