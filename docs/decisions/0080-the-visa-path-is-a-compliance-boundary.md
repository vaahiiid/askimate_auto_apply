# ADR-0080 — The visa path is a compliance boundary, not a scheduling gap

**Status:** **Accepted** — decided by Vahid Mohammadi, 2026-09-08
**Amends:** [ADR-0021](./0021-application-requirements-are-not-visa-requirements.md) — the decision
stands; the reason recorded for it was weaker than the real one
**Continues:** [ADR-0073](./0073-a-declared-capability-with-no-production-caller-fails-the-build.md)

## Context

ADR-0021 draws the line between what a university asks for and what UKVI asks for, and it is right.
But it explains the line as a **product-scope and correctness** matter: conflating the two blocks a
valid application while the system waits for evidence of a rule that may never apply to that student.

That reasoning is true and insufficient. Asked in P45 whether `visa_document` should be marked
`out_of_scope` or `undetermined`, Vahid answered:

> The entire visa path is outside this system's scope until the OISC position is resolved, and that
> is a hard compliance boundary in the business plan, not a scheduling gap.
>
> `undetermined` would leave it open for someone to quietly decide later. `out_of_scope` says it is
> deliberately shut.

**The word OISC did not appear anywhere in this repository.** The strongest reason for the most
consequential boundary in the product lived only in the business plan.

## Why the difference matters

A product-scope reason and a compliance boundary permit different futures.

| | a later engineer could… |
|---|---|
| *"visa evidence is out of scope for the MVP"* | reasonably decide to add it, citing product value |
| *"the visa path is shut until the OISC position is resolved"* | not decide that at all — it is not theirs to decide |

Every "out of scope" citation in the code pointed at ADR-0021, which gives the first reason. That is
how a boundary erodes: not by anyone overruling it, but by everyone citing the version of it that
sounds like a priority call.

## Decision

**The visa path is closed on compliance grounds until the OISC position is resolved, and that is
what is recorded wherever the boundary is cited.**

1. **`undetermined` is never the right state for it.** An undetermined threshold, period or scope
   invites somebody competent to decide later. This is not waiting on a determination that an
   engineer or a founder can make; it is shut.
2. **`visa_document` and `bank_statement` are `out_of_scope`**, not undetermined, and their reasons
   name this record rather than restating a version of it.
3. **This ADR does not state what the OISC position is.** Whether and how AAS may act in the vicinity
   of immigration advice is a regulated question for someone competent, and ADR-0023's rule holds:
   an unresolved question blocks rather than being guessed. What is decided here is that the path is
   **shut while the question is open** — which is a decision that can be made without answering it.

## The finding this turned up

Registering the boundary meant asking what enforces it. ADR-0021 answers in its own words:

> `blocksApplication(requirement)` is the single line that keeps the visa journey out of the
> application journey.

**Nothing in production calls it.** `pnpm run reachability` says so as soon as the claim is made:

```
✗ blocksApplication — ADR-0021 says "the single line that keeps the visa journey out of the
  application journey", and NOTHING IN PRODUCTION CALLS IT.
```

The cause is not neglect. **Nothing in production carries a `Requirement` at all**:
`packages/requirements` has no dependents, and the catalogue's `requiredDocuments` are free-text
strings with no authority (ADR-0066, ADR-0070) rather than scoped requirements. There is no scope for
the line to read.

It is listed on the reviewed-unreachable register rather than wired. Giving it a caller would be a
control over unreachable code, which ADR-0071 declined for `attach_document` for exactly this
reason. **What makes the absence safe today is that the visa journey is not built — not that this
line is stopping it**, and the register now says that in those words.

This is the eighth consecutive phase to find a record asserting something production does not do, and
the second (after ADR-0073's own first run) where the check found it the moment the claim was
written down.

## Consequences

- The declared-but-unreachable surface goes from **six to seven**. It went up because something that
  was always unreachable is now *declared* — the register can only be honest about what it has been
  told to check, and this had never been entered.
- The number to watch when the Requirements Service phase lands: `blocksApplication` and
  `assessUsability` both close on it, so that phase takes the count down by two.
- Every future citation of "the visa path is out of scope" points here, and the reason it finds is
  the one that cannot be overturned by a product argument.
