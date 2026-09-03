# P20 — deliberate regression audit

Twelve mutations, each applied to a source file on disk, **read back from disk to
prove the edit landed**, run against the suites that should catch it, and then
restored from a byte copy taken before the edit — never from `git checkout`,
because a restore that consults version control cannot distinguish "put back"
from "was never changed".

Ten were caught on the first pass. Two survived, both for reasons worth
recording; both are now caught.

| # | Mutation | File | Result | Caught by |
|---|----------|------|--------|-----------|
| R1 | The registry is not consulted when the artefact claims to be reviewed | `loader.ts` | **CAUGHT** | unit, e2e |
| R2 | The approval is keyed by descriptive metadata, not content | `loader.ts` | **CAUGHT** | unit, e2e |
| R3 | `canonicalText` keeps insertion order instead of sorting keys | `canonical.ts` | **CAUGHT** ¹ | unit |
| R4 | The canonical form sorts arrays, so page order stops being content | `canonical.ts` | **CAUGHT** | unit, e2e |
| R5 | Dates are passed through as strings instead of coerced | `parse.ts` | **CAUGHT** | unit |
| R6 | A closed set accepts any string | `parse.ts` | **CAUGHT** | unit |
| R7 | The registry allows an author to approve their own artefact | `registry.ts` | **CAUGHT** | unit |
| R8 | An approval replaces the integrity gates instead of adding to them | `loader.ts` | **CAUGHT** | unit |
| R9 | Production accepts the fixture catalogue | `config.ts` | **CAUGHT** | e2e |
| R10 | The registry returns any approval it holds, ignoring the hash | `registry.ts` | **CAUGHT** | unit, e2e |
| R11 | The approvals **file** may name the same person twice | `files.ts` | **CAUGHT** | e2e |
| R12 | An absent optional and an empty string canonicalise differently | `parse.ts` | **CAUGHT** ¹ | unit |

¹ Survived the first pass. See below.

## The two that survived, and what they were hiding

### R3 — a control shadowed by an identical control

Removing the key sort from `canonicalText` changed nothing any test could see.
Not because key ordering was untested — there is a test for it — but because
`toCanonical` sorts keys **as well**, and every assertion reached `canonicalText`
through it. The mutation was in a branch that, for those callers, could not
change the answer.

This is the sixth consecutive phase in which the same shape has appeared: a
check that looks load-bearing, shadowed by another that gets there first. The
method that finds it is always the same — follow a survivor to *why* it
survived, rather than reaching for another assertion.

Both sorts are kept. `canonicalText` is exported and takes a `Canonical`, which
a caller can build by hand without going through `toCanonical`, so its own sort
is a real defence rather than a redundant one. What was missing was a test that
reaches it directly, and that is what was added.

### R12 — a normalisation nobody had written down

`optionalText` maps an empty string to absent, so `campus: ""` and a missing
`campus` produce the same artefact and the same hash. Removing that made them
hash differently, and no test noticed.

The property matters more than it looks. Two tools saving the same artefact
disagree about whether to write an empty optional or omit it, and if those
hashed differently a reformat would silently need a fresh approval — which
teaches a reviewer to re-approve without reading, the exact habit ADR-0057's
canonical form exists to prevent. It is now asserted at the level it holds:
parse both spellings, hash both, compare.

## What the exercise confirmed about the design

R1 and R2 are the two ways the central claim of ADR-0057 could be false, and
both are caught by the tamper suite rather than by a test written for them:

- **R1** makes the artefact's own `status` load-bearing again. It is caught
  because the tamper tests deliberately leave `status: "reviewed"`,
  `reviewedBy` and `reviewedAt` intact — so an implementation that consulted
  them would accept every forgery in the list.
- **R2** keys the approval by `blueprintId` and `version`. It is caught by the
  impostor test, which builds a document sharing *every* descriptive field with
  an approved one and differing only in a removed mapping.

R8 is the one that would have been easiest to justify in review and is the most
dangerous. An approval is not a substitute for coherence: two people can approve
a mapping set pinned to the wrong blueprint version, and the pin check is what
catches that. Deleting the integrity gates because "the registry already
approved it" would trade a check on the world for a check on a signature.

## Scope note

The artefact used throughout is the **gated TEST portal fixture** — a real
artefact this repository owns and runs, used to prove the technical pipeline.
No university blueprint was invented, no discovery evidence fabricated, no
reviewer identity made up, and no approval seeded for content nobody reviewed.
The approvals written in tests are computed from the content under test and name
`test-specialist-a` / `test-specialist-b`, which appear nowhere outside tests.
