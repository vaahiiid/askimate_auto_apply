# P30 — deliberate regression audit

P30 changed no behaviour, so its regressions are of a different shape from the phases before it. They
attack the two directions the settled boundary could be broken: **joining the declarations up** (the
dangerous change), and **taking one of them away** (losing what the phase measured).

Eight mutations. Each was applied to a file on disk, **read back from disk to prove the edit landed**,
run against the control that governs it, and restored from a byte copy taken before the edit — never
from `git checkout`, and every restore confirmed byte-identical by `cmp`.

**All eight were caught.**

| # | Mutation | File | Result | Caught by |
|---|----------|------|--------|-----------|
| G1 | The planner joins the declarations up: an upload is planned only if a page also declares it | `plan.ts` | **CAUGHT** ×2 | `check-boundaries`, and driver e2e |
| G2 | The catalogue entry's advisory list is made authoritative and blocks the run | `run-driver.ts` | **CAUGHT** | driver e2e |
| G3 | `renderOffer` stops telling the student which documents are needed | `target.ts` | **CAUGHT** | driver e2e |
| G4 | `targetOf` stops carrying the entry's list into the target at all | `target.ts` | **CAUGHT** | driver e2e |
| G5 | The interview's `request_document` capability is deleted as dead code | `interview.ts` | **CAUGHT** | driver e2e |
| G6 | `planFill` ignores the one authoritative declaration | `plan.ts` | **CAUGHT** ×2 | driver e2e |
| G7 | Discovery stops recording the file inputs it saw | `discovery.ts` | **CAUGHT** | browser-runner discovery |
| G8 | `ambiguousGroups` joins its key with a printable separator | `target.ts` | **CAUGHT** | catalogue |

## G1 — the dangerous change, and why a structural guard is the right control

G1 is the change a reasonable engineer would make while tidying up: two reviewed fields carry the
word "document", so make the planner consult both. It is the failure ADR-0021 names in another
context — a rule with no evidence behind it defaulting into blocking, by omission.

The point worth recording is that **against the shipped fixture this mutation is behaviourally
silent.** The fixture's page declares `passport` and its mapping maps `passport`, so joining them up
changes nothing anyone could observe there. It is caught behaviourally only because P30 added an
entry whose page declares nothing:

```
× plans an upload from the MAPPING alone, in both directions
  → no page declaration, and the upload is still planned: expected [] to deeply equal [ 'passport' ]
```

and structurally, whatever the fixtures happen to say:

```
✗  packages/mapping/src/plan.ts mentions `requiredDocuments`. An upload is planned from a reviewed
   MAPPING (ADR-0017), never from a declaration that happens to share the name.
```

A guard that does not depend on a fixture agreeing with itself is the one that survives the next
fixture.

## G2 — the other dangerous change, caught by a test written two phases ago

Making `CatalogueEntry.requiredDocuments` block is the change the phase brief specifically warned
against — *"if the catalogue entry says passport, the system must collect passport"*. It is caught,
and by a test P28 wrote for a different reason and P29 strengthened:

```
× does NOT reach the interview for a document, and the run says so
  → and the run is still live: expected 'escalated' to be 'running'
```

That test exists because P28 measured the entry's list being ignored and kept the measurement instead
of patching it. Two phases later it is the control that stops the measurement being "fixed" in the
wrong direction. Keeping an inconvenient measurement paid.

## G5 and G7 — the two things it would be easy to delete

`request_document` looks like dead code: nothing reaches it, `recordDocument` has no caller, and
`collectedDocuments` can never become non-empty. Deleting it would destroy the evidence of what the
interview was designed to do, and would have to be rebuilt if the product decision in ADR-0066 §6 is
answered in the affirmative.

`BlueprintPage.requiredDocuments` looks like dead data for the same reason — P30 proved nothing plans
from it. But G7 shows it is not unowned: discovery's own suite asserts that a portal's file inputs are
recorded, which is what a specialist authoring a mapping set reads. **Inert is not the same as
unused**, and that distinction is most of what ADR-0066 says.

## G8 — a control that could not be reviewed

Found by reading `target.ts` for this phase, not by looking for it. `ambiguousGroups` joins the three
identity refs with U+0000 — correctly, because a separator that can occur in a ref would let
`("a", "b|c")` and `("a|b", "c")` collide and hide an ambiguity the student must be shown. It was
written as a **raw NUL byte** in the first 8 KB of the file, which is git's binary heuristic, so every
diff of the file holding both of ADR-0058's gates read `Binary files differ` — including this phase's
own edit to it.

Escaping it to `\u0000` leaves the runtime string identical and makes the file text again. The
separator now has the test it never had:

```
× cannot be made to collide by a ref that contains the separator
  → AssertionError: expected [ Array(1) ] to deeply equal [ Array(1) ]
```

(The assertion message is itself unreadable, because the expected value contains the NUL — which is
the same problem one level out, and a fair illustration of it.)

## What was not regressed, and why

- **The `check-boundaries` rule itself.** Deleting a rule from the boundary checker cannot be caught
  by anything except the checker, which is the same for every rule in that file. What can be proved is
  that the rule fires when the thing it forbids appears, and G1 proves exactly that.
- **`renderOffer`'s wording.** Whether the offer line should stay, change or disappear is the product
  decision in ADR-0066 §6. G3 pins that the student is told *something*; it deliberately does not pin
  the sentence, because pinning a sentence nobody has decided on would make the decision by accident.

## A harness fault, found and fixed

The first attempt at G2 used a replacement that **contained** the text it replaced. `mutate.py` wrote
the file and only then asserted that the old text was gone — so the assertion failed, the runner
short-circuited on the non-zero exit, and **the restore never ran**. A mutated `run-driver.ts` sat on
disk until `git status` showed it.

Nothing was lost, because the byte copy existed and `cmp` confirmed the restore. But the harness was
wrong in the way that matters: it could leave a half-applied mutation behind on the path where it
reports failure. It now validates the whole replacement in memory and writes only once that has
passed, so a rejected mutation cannot touch the file at all.

Third phase running that reading the filesystem back — rather than trusting the harness — is what
caught a harness problem. P25 had a snapshot restored over a fix; P27 had the same; this one is the
same lesson from the failure path instead of the success path.

## And an environment fault, recorded rather than absorbed

The container restarted mid-phase. Redis came back up started by hand as plain `redis-server --port
56379`, and three tests failed:

```
× the shared envelope cache > passes verify() against a correctly configured server
× the shared envelope cache > REFUSES a server that would evict under memory pressure
× the Secure Service and the Fill Agent SHARE a cache > both start against the same real Redis
```

Those are not flakes and they are not P30's. `RedisEnvelopeCache.verify()` refuses a server whose
`maxmemory-policy`, `appendonly` or `save` would let ciphertext reach disk or be evicted
(secure-plane-deployment.md §3.2), and the hand-started server had stock defaults for all three. The
CI workflow starts Redis with `--save "" --appendonly no --maxmemory-policy noeviction`; restarting it
the same way and re-running the full suite gave **105 files, 2136 tests, zero skipped, all passing**.

Written down because the tempting reading was the wrong one: a refusal that fires is the control
working. Treating an unconfigured Redis as permission to skip the proof is exactly what the standing
instruction forbids.
