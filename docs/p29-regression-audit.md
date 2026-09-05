# P29 — deliberate regression audit

Ten mutations against the step the run driver used to discard, the intervention it now raises, the
line the student reads, and the upstream refusal that makes the whole stop happen. Each was applied
to a file on disk, **read back from disk to prove the edit landed**, run against the control that
governs it, and restored from a byte copy taken before the edit — never from `git checkout`. Every
restore was confirmed byte-identical by `cmp`.

**Eight were caught on the first attempt. Two survived**, and the two are the useful part: they were
the same mutation applied to the P29 stop and to P28's, and both survived because a comment written
in P28 stated the wrong reason for a control that is nonetheless real. The comment is corrected and
both stops now carry the assertion that would have caught it.

| # | Mutation | File | Result | Caught by |
|---|----------|------|--------|-----------|
| R1 | The `specialist` hook is removed from `#decideOnce` | `run-driver.ts` | **CAUGHT** | driver e2e |
| R2 | The intervention is raised but the run is never stopped | `run-driver.ts` | **CAUGHT** ×4 | driver e2e, published route |
| R3 | The P29 stop falls through to `checkpointAfter` | `run-driver.ts` | **CAUGHT** ¹ | driver e2e |
| R4 | The P28 stop falls through to `checkpointAfter` | `run-driver.ts` | **CAUGHT** ¹ | driver e2e |
| R5 | The intervention's target stops naming WHICH reason | `run-driver.ts` | **CAUGHT** ×3 | driver e2e, source-as-data |
| R6 | `encountered` is emptied, so nothing says which artefact | `run-driver.ts` | **CAUGHT** ×2 | driver e2e |
| R7 | The stop is announced as a routine review | `run-driver.ts` | **CAUGHT** | driver e2e |
| R8 | Only the reason that was measured is handled | `run-driver.ts` | **CAUGHT** ×2 | driver e2e, source-as-data |
| R9 | The student is told once per poll rather than once | `run-driver.ts` | **CAUGHT** | driver e2e |
| R10 | `buildPreview` skips a missing document instead of refusing | `preview.ts` | **CAUGHT** | driver e2e |

¹ Survived first, and correctly — the control was real but the comment naming it was wrong, and no
assertion covered the property that actually holds. See below.

## R1 — the stranding, reproduced exactly

Removing the two-line hook puts the code back where P29 found it. The failure is the measurement
from ADR-0065 §1, verbatim:

```
× a run only a person can carry on
  → and the run STOPS rather than staying live: expected 'running' to be 'escalated'
```

## R2 — the difference between saying and doing

Deleting the `saveCheckpoint({status: "escalated"})` leaves the intervention raised and the student
told, and the returned position still *claims* `escalated` — so the intervention and message tests
pass. Three others do not:

```
× is no longer handed to the worker on every pass
  → an escalated run waits for a person, by ADR-0048: expected true to be false
× says so over the PUBLISHED route the student's client reads
  → what the client draws its banner from: expected 'running' to be 'escalated'
```

That is the whole reason the route test exists. A position object is not the run; the database is,
and the client reads the database.

## R3 and R4 — a survival that found a wrong comment

Both mutations replace `if (stop !== null) return stop;` with a bare call, so the decision falls
through to `checkpointAfter`. Both **survived**, and working out why produced the correction in
ADR-0065 §5.

P28 wrote, and P29's first draft repeated, that falling through *"would put the status back to
`running`"*. It would not: `saveCheckpoint` writes `input.status ?? from`
(`postgres-workflow.ts:166`), so omitting the status **preserves** it.

What actually happens is one step further out. The stop has already saved at `record.revision`;
`checkpointAfter` passes that same, now stale, revision; `saveCheckpoint` raises
`RunConcurrencyError`; and `#decide`'s retry loop re-reads and decides again. The second pass finds
the run already `escalated`, the raise is idempotent, and the answer comes out right — which is
exactly why every existing assertion passed.

It is still a defect. Every specialist stop would burn one of three attempts from a budget that
exists for two students clicking at once, and would write a second checkpoint for a step that is not
progress. So the property was given the assertion it never had, on **both** stops:

```
expect(revision, "the stop's own save, and nothing written on top of it").toBe(1);
```

Re-run, both mutations are caught:

```
× writes ONE checkpoint, and does not go round the concurrency retry
  → expected 2 to be 1
× STOPS a run whose log already shows the interview gave up
  → the stop saved once, and nothing was written on top of it: expected 2 to be 1
```

The lesson is P24's, from a new direction: a survival is a question about the code, not only about
the harness — and here the answer was that the code was right and the comment explaining it was not.
A comment that names the wrong reason is worse than no comment, because the next reader deletes the
control for the reason the comment gave.

## R8 — a fix that only handles what was measured

Narrowing the guard to `step.reason !== "preview_refused"` handles the document case and drops the
other four. It is the most plausible way this change could have been made too small, and it is why
the group carries a second, non-document reason:

```
× stops the SAME way for a reason that has nothing to do with documents
  → expected 'running' to be 'escalated'
× BUILDS no way to hold a document, which is what ADR-0022 and ADR-0023 gate
  → it stops on the hand-over itself, not on a reason it recognises
```

`portal_authentication_unobserved` is reached from a different branch of `nextStep`, before the
preview, with no document anywhere in it.

## R10 — what the stop is actually protecting

Making `buildPreview` skip a missing document rather than refuse it is the mutation that shows what
is at stake. The run does not strand; it **proceeds**:

```
× a run only a person can carry on
  → the orchestrator hands it over: expected 'authorise' to be 'specialist'
```

A student would have been shown a preview to authorise for an application whose passport had been
silently dropped. The stranding P29 fixed was the safe failure. This is the unsafe one, and the
refusal at `preview.ts:234` is what prevents it.

## What was not regressed, and why

- **The client's rendering of `escalated`.** Unchanged by P29 and already regressed in P28 (R9, R10
  there), in a real browser. Mutating it again would re-prove P28's control, not this one.
- **`toStoredPlan`'s `has_uploads` refusal.** A second, independent boundary on the same fact,
  exercised by `packages/mapping`'s own suite. P29 changed nothing about it.
- **The absence of document storage.** Asserted against the live schema rather than mutated: there
  is no table or column to remove, which is the point.
