# ADR-0004 — Branded types make model output unable to reach a form field

**Status:** Proposed · awaiting Vahid's approval
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
