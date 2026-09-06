# ADR-0005 — Contract-first OpenAPI at the AskiMate↔AAS boundary

**Status:** **Accepted** — approved by Vahid, 2026-08-26
**Date:** 2026-08-26
**Detail:** [Phase 0 · Deliverable 1 §10](../phase-0/01-existing-system-inventory.md)

## Context

Universitio already contains a working contract-first pipeline: an OpenAPI 3.1 spec in
`lib/api-spec/` plus an `orval` config generating both a typed react-query client and Zod
validators.

It describes **exactly one endpoint** — `GET /healthz`. The ~60 real routes are called through
hand-written fetch code instead. Read charitably: someone set the tooling up correctly and the
team never adopted it, most likely because retrofitting a spec over 60 existing routes is a
large, unrewarding job with no immediate payoff.

## Decision

AAS is contract-first from its first endpoint. The AskiMate↔AAS contract is defined in OpenAPI;
request/response validators and any client are generated from it, never hand-written.

> ### ⚠️ Corrected 2026-09-06 (P37, [ADR-0072](./0072-two-decisions-enforced-by-nothing.md))
>
> **The second half of that sentence is not true and never became true.** There is no `orval`, no
> `openapi-typescript` and no generator of any kind in this repository. `packages/contracts/src/`
> is hand-written TypeScript and `packages/contracts/openapi/*.yaml` are hand-written documents.
>
> What holds the two together is [ADR-0063](./0063-the-published-contract-names-the-routes-that-exist.md):
> `scripts/contract-drift.test.ts` checks the published `paths` against the **real Express router**
> and every published enum against the code's own closed sets. P27 built it after measuring six
> discrepancies that had accumulated, and it is stronger than generation would have been in the one
> direction that matters here — a generator produces a client that matches the spec, and says
> nothing about whether the SERVER does.
>
> The first half of the decision stands and is honoured: the contract is written first, it is
> versioned, and a breaking change is a spec diff in review. Only the mechanism differs, and it
> differs deliberately. Recorded rather than quietly reworded, because "generated, never
> hand-written" is the kind of sentence a future reader would otherwise rely on.

## Consequences

- At greenfield the discipline is free — there is no retrofit cost to avoid.
- The boundary that benefits most from a machine-checked schema gets one: it is the seam between
  two systems, two clouds, and eventually two teams.
- **It partly compensates for not having seen the askimate.com codebase.** A published, versioned
  schema lets the AskiMate side be built against a precise contract rather than prose.
- Breaking changes become visible in review as spec diffs.
