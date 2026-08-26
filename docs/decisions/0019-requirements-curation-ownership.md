# ADR-0019 — A human specialist curates requirements, through the AskiMate knowledge workflow

**Status:** **Accepted** — Vahid's decision, 2026-08-26
**Confirms and locates:** [ADR-0009](./0009-requirements-provenance-and-verification.md)

## The decision

> *"Requirements should be curated by a human specialist through the AskiMate/requirements knowledge
> workflow. Where possible, requirements should also be checked against the university's official
> website or official application portal. The system must preserve provenance, retrieval date and
> verification status. Critical requirements must continue to follow the approved evidence bar…
> Conflicts must escalate rather than being resolved automatically. Do not invent a new authority
> hierarchy that bypasses these rules."*

ADR-0009 already defines the *rules*. This ADR answers the question it left open: **who does the
curating, and through what.**

## Who

A **human specialist**, through the **existing AskiMate knowledge workflow** — not a new review tool
built for this system.

That is the right call for a reason worth writing down: AskiMate already runs exactly this loop.
`kb_pending_entries` (with `status`, `approvedBy`, `ingestedAt`/`rejectedAt`) → human approval →
`kb_entries`. It was found in the Phase 0 inspection and cited in ADR-0008 as the precedent for the
learning loop's approval gate. Reusing it means the operational question *"who actually reviews
these?"* has a known answer and a known person, rather than a hypothetical one and a console nobody
opens.

## What is unchanged

Everything in ADR-0009, and none of it is softened:

- **Two independent channels.** A curated, human-reviewed entry, and a direct check against the
  university's own site or portal. Neither is authoritative alone.
- **The official channel produces evidence, not truth.** A machine reading a page is interpreting
  it, and gets the same treatment as every other machine interpretation in this system.
- **The evidence bar scales with consequence.** `critical` needs corroboration — both channels,
  agreeing, fresh. Being wrong about "needs a personal statement" costs an email; being wrong about
  the 31-day financial window costs a visa.
- **Conflicts escalate.** At every criticality. The system does not prefer a channel and does not
  prefer the fresher source.
- **Provenance, retrieval date and verification status are preserved** on every requirement, and an
  excerpt hash detects a page reworded without the number moving.

Vahid's closing instruction — *"Do not invent a new authority hierarchy that bypasses these rules"* —
is the operative one. Anything that would let a requirement reach an application decision without
passing the gate in `packages/domain/src/requirements.ts` is out of scope, including anything that
looks like a shortcut for a specialist in a hurry.

## What this ADR does not build

The **Requirements Service** — the fetcher, the curated store, and the review surface — is still not
built, and this ADR does not build it. What exists is the gate they must pass through, so none of
them can bypass it.

That ordering was deliberate and it holds: the constraint ships before the thing it constrains.

## Consequences

- The Requirements Service, when built, is an **adapter onto AskiMate's existing knowledge
  workflow**, not a parallel system with its own idea of approval. The integration contract
  (ADR-0001) is the seam.
- The official-source check needs network access to university sites, which the current environment
  does not have (see `docs/phase-3-access-required.md`). It is blocked by the same thing discovery
  is, and unblocked by the same fix.
- A requirement with only one channel verified is usable for `material` and `procedural` decisions
  and **not** for `critical` ones. That asymmetry is the design working, not a gap to close by
  relaxing the bar.
