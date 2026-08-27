# ADR-0004 — Branded types make model output unable to reach a form field

**Status:** **Accepted** — approved by Vahid, 2026-08-26
**Date:** 2026-08-26
**Detail:** [Phase 0 · Deliverable 3 §3](../phase-0/03-repository-structure-proposal.md)

## Context

Brief §3.1: *"The AI must never be the source of a value that goes into a form field. […]
Enforce this structurally, not by instruction. Make it impossible for model-generated text to
reach a form field by construction."*

Instructions, comments and code review do not achieve this. A tired engineer at 6pm defeats all
three. The existing AskiMate enforces the same principle by **prompt**, which is weaker than
what the brief demands here.

## Decision

Two branded types in `packages/domain` with **no conversion path between them**:

- `ConfirmedValue<T>` — minted **only** by `packages/profile`, and only from a row carrying a
  confirmation record.
- `ModelText` — returned by `packages/llm`, the only module permitted to import an AI SDK.

`RouteAdapter.fillSection` accepts `ReadonlyMap<FieldRef, ConfirmedValue<unknown>>` and nothing
else. Passing model output to it is a **compile error**.

When a required field has no confirmed source, the resolver returns `FieldUnavailable`, the
orchestrator raises a task, and the system stops and asks the student. There is no type it could
construct to guess instead.

Backed by a lint rule (only `packages/llm` may import an AI SDK) and a CI dependency-boundary
check. The types are the real control; those are belt and braces.

## Consequences

- Requires `strict: true` in TypeScript — stricter than Universitio's current config. Justified.
- The AI can still reason freely about *navigation* — which control to click, how to recover from
  a changed layout — which is exactly the separation brief §3.1 draws.
- New engineers cannot violate the rule accidentally. The build stops them.
- This is the single most important structural decision in the repository.

---

## Amendment, 2026-08-27 — the brand alone was not enough

**A measured correction.** The guarantee was described as compile-time enforced by the branded
types plus the `@ts-expect-error` directives in `values.test.ts`. That description was **incomplete
in a way that mattered**, and it was found by deliberately weakening the guarantee:

```ts
export function trustTheModel<T>(text: ModelText): ConfirmedValue<T> {
  return text as unknown as ConfirmedValue<T>;
}
```

Added to `packages/domain`, this **compiled cleanly and failed no test.**

The `@ts-expect-error` directives test one specific illegal *assignment*. A conversion *function*
that casts through `unknown` leaves that assignment just as illegal — the directives stay used, the
build stays green, and the property is gone.

**A brand cannot defend itself against a cast.** Only a rule about where casts may appear can.

### The rule, now enforced

`scripts/check-boundaries.ts` fails the build if any non-test file outside `packages/profile` casts
to `ConfirmedValue` — in its plain form, a qualified form (`Domain.ConfirmedValue`), or a
dynamic-import form (`import("@askimate/aas-domain").ConfirmedValue`). All three were tested against
the check; the first version of the rule caught only the plain form, and the qualified one walked
past it.

`applyConfirmation` in `packages/profile` remains the single sanctioned mint.

### The guarantee therefore has two halves

| Half | Prevents |
|---|---|
| Branded types + `@ts-expect-error` | an **accidental** assignment compiling |
| The boundary check | a **deliberate** cast being added anywhere else |

Neither is sufficient alone. That is now stated in both places rather than assumed in one.
