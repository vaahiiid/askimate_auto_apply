# AskiMate — Application Automation System (AAS)

A system that takes a student who has **explicitly decided** to apply to a university and carries
that application from preparation, through execution, to **final submission**, with as little
human involvement as is technically and legitimately possible.

This is a **new, separate system**. It does not replace or modify the existing AskiMate
conversational assistant at [askimate.com](https://askimate.com).

```
Existing AskiMate  →  student decides to apply  →  AAS  →  prepare  →  execute  →  submit  →  result
```

---

## Current status

| | |
|---|---|
| **Phase** | 0 — Inspect and bootstrap |
| **Status** | ✅ Complete · **awaiting approval before Phase 1** |
| **Application code** | **None.** Phase 0 is inspection and proposal only. |
| **Infrastructure provisioned** | **None.** $0 spent against the AWS credit. |

👉 **Start here: [`docs/phase-0/README.md`](./docs/phase-0/README.md)**

---

## What is in this repository right now

```
docs/
├── phase-0/          The five Phase 0 deliverables + an executive summary
└── decisions/        ADRs — the decision record required by the brief (§12.8)
```

That is all. No source, no infrastructure, no dependencies — by design.

---

## Phase plan

| Phase | Scope | Status |
|---|---|---|
| **0** | Inspect existing system · integration contract · repo structure · AWS plan | ✅ Complete, awaiting approval |
| **1** | Domain core — case model, state machine, event log, idempotency | ⏸ Blocked on approval |
| **2** | Canonical profile · document vault · deterministic validity engine | Not started |
| **3** | Browser runtime · discovery · first Application Blueprint | Not started |
| **4** | Requirements with provenance · eligibility · field mapping | Not started |
| **5** | Fill · validate · preview · capture authorisation *(stops before submit)* | Not started |
| **6** | Submit · capture confirmation · status polling | Not started |
| **7** | Second university — proves the abstraction holds | Not started |

Phases run strictly in order. A phase does not begin while the previous one is incomplete,
failing, unverified, or awaiting a decision.

---

## The two principles that govern the design

**1. Navigation is separated from data.**
The AI may reason about *how to get through a page* — which control advances, how to recover from
a changed layout, what an unexpected validation error means. The AI is **never** the source of a
value written into a form field. Every value originates from the student's confirmed profile or a
confirmed document. If a required field has no confirmed source, **the system stops and asks the
student.** It does not infer, estimate, or fill a plausible answer.

This is enforced by the type system, not by instruction — see
[ADR-0004](./docs/decisions/0004-branded-types-for-confirmed-values.md).

**2. Discovery produces a blueprint; execution runs against the blueprint.**
The first encounter with a portal runs in discovery mode and produces a versioned, reviewable
**Application Blueprint**. Execution then runs deterministically against it. The AI handles only
deviations, and every deviation is logged as blueprint drift. No university's flow is hard-coded
into the orchestration engine — adding the second university is a data exercise, not a rewrite.

---

## Non-negotiable rules

- **Explicit request before consequential action.** The system may suggest applying. It may never
  begin applying because a conversation crossed a threshold. Silence is not consent.
- **Extract, then confirm, then store.** Only confirmed information enters the profile.
- **Reuse is never automatic if validity is in question.** Every document with an expiry or
  validity condition is checked by deterministic date logic **before** any AI confidence system is
  involved. Silently reusing a stale bank statement is the exact failure this system exists to
  prevent.
- **Two-layer escalation.** Layer one is confidence-based. Layer two ignores confidence entirely:
  **financial evidence, and anything involving a minor, are escalated for mandatory human review
  every time.**
- **Duplicate submission must be structurally impossible**, not merely unlikely.
- **Nothing is invented** — not qualifications, grades, work experience, achievements, documents,
  requirements, deadlines, or answers.
- **Never bypass or defeat** identity verification, MFA, OTP, CAPTCHA, payment, or legal
  declarations. Each is a deliberate handoff to the student.
- **No student portal passwords are stored.** Authentication happens through session handoff.
- **No secrets** in prompts, logs, source code, or this repository.

---

## Development

Nothing to run yet. Phase 1 will introduce a pnpm/TypeScript monorepo requiring only Node and
Docker (for local Postgres) — **no AWS account and no credentials.** See
[the structure proposal](./docs/phase-0/03-repository-structure-proposal.md).
