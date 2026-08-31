# P5 — the deliberate regressions, and the two tests they forced

Ten regressions against the work-intake mechanism (ADR-0045), each applied to a
clean tree, **proved to have applied** by reading the file back from disk and
asserting both that the content changed and that the new text is present, then
gated on a named check and required to fail. Every file was restored
byte-for-byte afterwards and `git diff` checked.

| | The regression | Detected by |
| --- | --- | --- |
| **R1** | The lease upsert drops `WHERE expires_at <= now`, so a LIVE lease can be stolen | `run-driver` — *refuses a SECOND claim on a live lease, in the store itself* |
| **R2** | `release` stops checking the lease id, so any caller may release any lease | `run-driver` — three tests, including *records the outcome as evidence* |
| **R3** | An `uncertain` report completes the intent, closing the uncertainty window | `run-driver` — *leaves the uncertainty window OPEN when the runner could not tell* |
| **R4** | The claim path fabricates the work instead of asking the orchestrator | `run-driver` — *offers nothing when the CHECKPOINT says browser work but the orchestrator does not* |
| **R5** | The claim route accepts a caller when no `authoriseService` is configured | `run-driver` — *REFUSES a claim from a caller with no service certificate* |
| **R6** | `ClaimedWork` grows a `password` field | `check-boundaries` — the work-contract rule |
| **R6b** | `ClaimedWork` grows a free-text `portalMessage` field | `tsc` — `NO_WORK_FIELD_IS_FREE_TEXT`, which is not vacuous |
| **R7** | A thrown performer is reported as a CLEAN failure rather than uncertain | `work-intake` — *reports a THROWN performer as uncertain, never as a clean failure* |
| **R8** | The runner casts the claim response instead of parsing it | `check-boundaries` — the intake rule |
| **R9** | `parseWorkReport` accepts a `failed` with no reason | `run-driver` — *hands work out and takes a report back, over real HTTP* |

## The two that were NOT detected first time, and what that revealed

This is the part worth reading. **R1 and R4 were both recorded as `NOT DETECTED`
on the first run**, and in both cases the mechanism was sound — the *tests* were
reaching the right answer through the wrong guard.

**R1 — the guarantee nothing tested.** Removing `WHERE work_leases.expires_at <=
$now` from the upsert lets a live lease be taken over, and every existing test
still passed. The reason: the candidate query already excludes leased runs with
a `LEFT JOIN`, so the claim path never reached the store for a run somebody
held. That join is an *optimisation* — it stops a busy pool walking the same
held runs on every poll. The **guarantee** is the upsert's predicate, and it is
the one that holds when two claimers pass the join at the same instant, which is
exactly when it matters. A store-level test now claims twice and requires the
second to be refused.

**R4 — nothing proved the orchestrator was the authority.** Every "no work" path
in the suite reached its answer through the candidate query's phase filter, so a
claim path that trusted the checkpoint outright would have passed all of them.
The new test makes a checkpoint **lie**: a run whose interview is unfinished, with
its phase forced to `creating_account`. That is not a contrived state — a
checkpoint is a cache of position and the log wins every disagreement, which is
what `resumeRun`'s reconciliation exists for. The claim must offer nothing, and
must take no lease on the way to finding out.

R4 also surfaced something about the code: the first version of the regression
replaced only `browserWorkFor` and was caught anyway, by `accountWorkFrom`
returning null for a step with no account details. Defence in depth is welcome,
but a regression that a second guard absorbs proves nothing about the first, so
the regression was widened to bypass both — which is what the claim path
trusting a phase would actually look like.

> The general lesson, and it is the same one the P4 audit records about the
> apply-proof: a passing suite is evidence only about the paths the tests
> actually take. Both of these were **the harness working** — the point of
> breaking something on purpose is to find out which guard your tests are
> really standing on.

## What is deliberately not regression-tested here

**That `execute` work cannot be claimed.** It cannot, because `WORK_KINDS` has
one member and `browserWorkFor` answers `null` for it — but that is a stated gap
rather than a defect to detect, and it is recorded in three places that a change
would have to pass through: ADR-0045's closing section, the `WORK_KINDS` comment,
and a drift test that asserts `execute` is a step kind and is *not* a work kind.
A phase that adds it deletes that test in the same diff, which is where the
decision belongs.
