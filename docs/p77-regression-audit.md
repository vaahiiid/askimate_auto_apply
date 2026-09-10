# P77 — deliberate regression audit: the attachment path, and the destination inside the yes

Eleven mutations against the gates P73–P75 built or moved: the transmission gate's case and host
checks, the destination inside the preview's hash and its deployment reading, the driver's one
reading of the deployment, the runner's own refusals before a byte is fetched, the wire's HTTPS rule,
the settlement's case filter, the hand-over's hash comparison, and the executor's gate call. Each
was applied to a file on disk, **read back from disk to prove the edit landed** (`cmp` against a
byte copy taken first), run against the tests that govern it, and restored from that copy — never
from `git checkout` — with the restore confirmed byte-identical. The runner and its results are
reproduced below verbatim from the run of 2026-09-10.

**Ten of eleven were caught. One was not, and it is the interesting one.**

| # | Mutation | File | Result | Caught by |
|---|----------|------|--------|-----------|
| M1 | `mayTransmit` no longer checks the case | `disclosure.ts` | **CAUGHT** ×3 | the two cross-case refusals, and the executor's |
| M2 | `hostMatches` answers yes to any host | `disclosure.ts` | **CAUGHT** ×2 | "a different portal, even a plausible one"; the executor's |
| M3 | `portalHost` leaves the preview's hash | `preview.ts` | **CAUGHT** ×3 | re-pointed hash changes; the deployment test; the orchestrator's P74 re-ask |
| M4 | The preview ignores the deployment and names the observed host | `preview.ts` | **CAUGHT** ×19 | preparation, the driver's P74 group and sandbox test, **the whole journey** |
| M5 | `deploymentOf` never names a deployment | `run-driver.ts` | **CAUGHT** ×16 | the driver's P74 group and sandbox test, **the whole journey** |
| M6 | The runner fetches a document whose record names another case | `document-source.ts` | **CAUGHT** | "REFUSES a record about another case before fetching a byte" |
| M7 | The runner accepts bytes that do not hash to what the plane said | `document-source.ts` | **CAUGHT** | "REFUSES bytes that do not hash to what the plane said" |
| M8 | A plain-HTTP retrieval URL is accepted on the wire | `work.ts` | **CAUGHT** | "REFUSES a retrieval that is not an HTTPS GET" |
| M9 | The settlement no longer requires the transmission's case to be this run's | `run-driver.ts` | **CAUGHT** | "…writes what left — for this case only" |
| M10 | The hand-over no longer compares the preview's hash with the yes | `run-driver.ts` | **NOT CAUGHT** | — (see below) |
| M11 | The executor attaches whatever `mayTransmit` refused | `execute.ts` | **CAUGHT** ×5 | every refusal in the executor's gate group, and the drift/refusal distinction |

## M4 and M5 — the journey is the test

Making the preview name the observed host (M4), or making the driver stop reading the deployment
(M5), fails the journey from its fourth test onward — nineteen and sixteen failures — because the
journey's entry *is* a deployment: a reviewed fixture blueprint run against a served portal on
`127.0.0.1`. The student's yes over a preview naming `gated.portal.test` does not cover it, the run
stops at the yes, and nothing after that step can happen. That is P74's defect, reproduced on
demand: before P74 the preview named the observed host, and the journey passed only because it had
never carried a document. The unit tests catch the same two mutations in one assertion each; the
journey catches them the way a real run would, by stopping.

## M1, M2, M11 — the same gate, both sides of the plane

M1 and M2 remove a check from `mayTransmit`, and both the disclosure package's own tests and the
executor's fail — the executor calls the same function, on the runner's side, at the moment of
attaching. M11 removes the executor's *use* of the answer, and five executor tests fail while the
disclosure package's all pass: the gate still refuses, the runner no longer listens. Three
mutations, two layers, and the failure lists say which layer each one broke.

## M10 — the mutation nothing behavioural can catch

The document hand-over (`documentForWork`) checks, at step 3, that the preview built now hashes to
the `AuthorisationCaptured` it found in the case log. Removing that comparison fails **no test**,
and the reason is not a missing test. Step 2, one screen above, asks the orchestrator for the run's
situation, and the orchestrator's own assessment already compares the same log's yes with the same
preview — built from the same blueprint, the same held documents and the same deployment reading
— and answers `authorise`, not `execute`, when they disagree. Step 2 refuses that as
`not_executing` before step 3 is reached. M3, M4 and M5 show that comparison working: every one of
them stops the run at the yes.

So step 3 is a second reading of a fact the first reading already refused on. It can differ from
the first only in a race between the two reads, which no deterministic test can stage. The honest
options were three: delete it, assert it against the source, or keep it and say what it is. It is
kept — a substitution has to get past two readings rather than one, and the cost is a hash of a
preview already built — and the comment above it now says exactly what this audit measured: that
it adds nothing a test can see. That is the same answer P32 gave for M4 there, in the other
direction: a property that lives in redundancy rather than in a type, recorded as redundancy.

## What this audit did not mutate

- The runner's `parseWorkDocument` refusals other than the scheme (M8): each has a line in the
  contracts suite already.
- The page's intent key seeing its attachments (P73): the driver's P73 group asserts the key and
  the re-offer directly, and the `pageFillTarget` tests state the property in the orchestrator.
- The `attach_document` intent's reachability: `check-reachability` fails the build if the
  driver stops opening it.

## The runner

```
for each mutation: cp file file.bak; apply the one replacement (assert it occurs exactly once);
cmp file file.bak must differ; vitest run <governing files>; cp file.bak file; cmp must match
```

Governing files: M1–M2 `disclosure.test.ts` + `orchestrator.test.ts`; M3 `preparation.test.ts` +
`orchestrator.test.ts`; M4 those two + `run-driver.test.ts` + `journey.test.ts`; M5
`run-driver.test.ts` + `journey.test.ts`; M6–M7 `document-source.test.ts`; M8 `contracts.test.ts`;
M9–M10 `run-driver.test.ts`; M11 `orchestrator.test.ts`. Real PostgreSQL and Redis for the driver
and the journey, as in CI's integration job.
