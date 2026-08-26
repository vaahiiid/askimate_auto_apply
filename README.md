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
| **Phase** | 3 — Browser runtime and discovery |
| **Status** | ⚠️ Runner complete and verified · **awaiting network access** — see [access required](./docs/phase-3-access-required.md) |
| **Tests** | 390 passing · typecheck, lint and boundary checks green |
| **Infrastructure provisioned** | **None.** $0 spent against the AWS credit. |

Phase 0 is complete and approved — see [`docs/phase-0/README.md`](./docs/phase-0/README.md)
and the [decision records](./docs/decisions/).

```bash
pnpm install
pnpm run verify        # typecheck · lint · boundaries · tests
pnpm run walkthrough   # drive one case end to end and watch what happens
```

`pnpm run walkthrough` is the fastest way to see what has been built: it opens a
real case, blocks it on a missing document, forces human review of financial
evidence, captures an authorisation, voids it when the content changes, submits
once, refuses to submit twice, and then refuses to re-apply without an explicit
student instruction.

---

## What is in this repository right now

```
packages/
├── domain/           The domain core. Pure — zero I/O, zero dependencies.
│   ├── values.ts       ConfirmedValue vs ModelText vs ProposedValue — the wall
│   ├── state.ts        The approved case states
│   ├── transitions.ts  The transition table and its guards
│   ├── machine.ts      fold (derive state) + decide (propose events)
│   ├── events.ts       The append-only event log
│   ├── idempotency.ts  Submission identity — no duplicate submission
│   ├── reapplication.ts The student's decision to re-apply (ADR-0006)
│   ├── escalation.ts   Two-layer escalation; layer two is a hard gate
│   ├── requirements.ts Provenance, corroboration, the evidence bar
│   ├── minors.ts       Identity check, minor detection, the conditions gate
│   ├── retention.ts    Policy-driven retention — no default, ever
│   ├── recovery.ts     Pause at the failure point, alert, resume from checkpoint
│   ├── learning.ts     Intervention capture + the human validation gate
│   ├── tasks.ts        What the case is waiting on, and who must obtain it
│   └── audit.ts        What the system did, with redaction enforced
├── case-store/       Persistence port + in-memory implementation
│   └── contract.ts     The shared suite Postgres must also pass
├── profile/          The canonical student profile
│   ├── fields.ts       The canonical field registry, typed
│   ├── confirmation.ts THE ONLY PLACE ConfirmedValue IS MINTED
│   └── profile.ts      Confirmed-only writes + the typed resolver
├── documents/        The document vault
│   ├── validity.ts     Deterministic validity — the 31-day window
│   └── vault.ts        Storage port; refuses without a retention policy
└── blueprint/        The versioned Application Blueprint artefact

apps/
└── browser-runner/   Isolated Playwright runtime
    ├── safety.ts       The read-only guard — discovery cannot write
    ├── session.ts      Capability levels: read-only / fillable / submittable
    └── discovery.ts    Observations → draft blueprint

scripts/
├── check-boundaries.ts  Enforces the dependency-graph rules
└── walkthrough.ts       End-to-end demonstration

docs/
├── phase-0/          The five Phase 0 deliverables
└── decisions/        ADRs — the decision record (brief §12.8)

.github/workflows/    CI — present since the first commit of code
```

No infrastructure, no AWS, no database. Phase 1 runs entirely on a laptop.

---

## Phase plan

| Phase | Scope | Status |
|---|---|---|
| **0** | Inspect existing system · integration contract · repo structure · AWS plan | ✅ Complete, approved |
| **1** | Domain core — case model, state machine, event log, idempotency | ✅ Complete, verified |
| **2** | Canonical profile · document vault · deterministic validity engine | ✅ Complete, verified |
| **3** | Browser runtime · discovery · first Application Blueprint | ⚠️ Runtime done; live run blocked |
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
a changed layout, what an unexpected validation error means. It may equally reason about *how to
run the conversation* — what to ask next, when, and how to phrase it. The AI is **never** the
source of a value written into a form field. Every value originates from the student's confirmed
profile or a confirmed document. If a required field has no confirmed source, **the system stops
and asks.** It does not infer, estimate, or fill a plausible answer.

Enforced by the type system, not by instruction. Three kinds of value exist, and only one of them
can reach a form field:

| | | |
|---|---|---|
| `ModelText` | the model wrote it | ✗ cannot reach a form field |
| `ProposedValue` | the model interpreted what a human said or a document showed | ✗ cannot reach a form field |
| `ConfirmedValue` | a human confirmed it | ✓ the only thing that can |

There is no conversion function between them. See
[ADR-0004](./docs/decisions/0004-branded-types-for-confirmed-values.md) and
[ADR-0007](./docs/decisions/0007-agent-led-conversational-intake.md).

**2. Discovery produces a blueprint; execution runs against the blueprint.**
The first encounter with a portal runs in discovery mode and produces a versioned, reviewable
**Application Blueprint**. Execution then runs deterministically against it. The AI handles only
deviations, and every deviation is logged as blueprint drift. No university's flow is hard-coded
into the orchestration engine — adding the second university is a data exercise, not a rewrite.

---

## Non-negotiable rules

- **The student never fills in a form.** Not the university's, and not one of ours. The agent
  interviews them conversationally, works out what is missing, asks for it progressively, requests
  documents when needed, confirms what it understood, and completes the application itself. The
  only two things asked of the student are a handoff (MFA, OTP, CAPTCHA, payment, a legal
  declaration) and approving the exact content before submission — neither of which is
  form-filling. See [ADR-0007](./docs/decisions/0007-agent-led-conversational-intake.md).
- **Autonomy means autonomous execution, never autonomous invention.** "The student must never
  fill in a form" does not license the agent to guess in order to avoid asking. When something is
  genuinely unavailable, the agent still stops — it just stops by asking a question rather than by
  presenting a form field.
- **Failure pauses; it does not restart and it does not fail the case.** When the AI cannot safely
  proceed it stops at the exact point of failure, raises a high-priority escalation, and a
  specialist unblocks that specific problem — then the workflow resumes from its checkpoint.
  Everything already completed stays available and auditable. The specialist is a **recovery
  layer, not the primary operator**, and the student is never handed the form because automation
  failed. See [ADR-0008](./docs/decisions/0008-recovery-first-escalation-and-the-learning-loop.md).
- **The AI never changes its own production behaviour.** Every human intervention is captured —
  what the AI met, what it expected, where it failed, what the specialist did, what worked, and
  where. That record cannot influence anything until a human has validated *and* published it.
  Capture is automatic; use is gated.
- **Explicit request before consequential action.** The system may suggest applying. It may never
  begin applying because a conversation crossed a threshold. Silence is not consent.
- **Extract, then confirm, then store.** Only confirmed information enters the profile.
- **Requirements carry provenance, and the evidence bar scales with consequence.** Every
  requirement records where it came from, when it was retrieved, who reviewed it, and whether it
  has been corroborated. A `critical` requirement — visa rules, financial evidence, anything
  concerning a minor — needs **both** a human-reviewed knowledge-base entry **and** an
  official-source check, agreeing and fresh. Where the sources conflict the system never picks one:
  it escalates. See [ADR-0009](./docs/decisions/0009-requirements-provenance-and-verification.md).
- **Never conclude "adult" from unverified evidence.** Under-18 status is a legal safeguard, so
  absence of evidence that someone is a minor is not evidence that they are an adult. A stated date
  of birth raises the question; only a document-verified one answers it. What a minor's application
  requires is *determined*, never assumed.
  See [ADR-0011](./docs/decisions/0011-minor-detection-and-the-minor-workflow.md).
- **No document is stored without a configured retention policy.** There is no default and no
  fallback to "keep indefinitely" — an unconfigured document type fails loudly at storage time.
  See [ADR-0010](./docs/decisions/0010-policy-driven-document-retention.md).
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

Requires Node (see `.nvmrc`) and pnpm. **No AWS account, no credentials, no database.**

```bash
corepack enable
pnpm install

pnpm run verify        # everything CI runs: typecheck · lint · boundaries · tests
pnpm run test:watch    # tests on change
pnpm run walkthrough   # drive one case end to end
```

### Why `typecheck` is part of the test suite, not just a build step

The guarantee in [ADR-0004](./docs/decisions/0004-branded-types-for-confirmed-values.md) — that
model-generated text cannot reach a university form field — is enforced by the **compiler**, not at
runtime. `packages/domain/src/values.test.ts` contains `@ts-expect-error` assertions covering every
route an engineer might try: passing model output directly, coercing it with `String()`, laundering
it through a template literal or a string method, and hand-building the `ConfirmedValue` shape.

If anyone ever adds a conversion path, those directives stop being errors, TypeScript reports them
as unused, and **the build fails**. A runtime test cannot check "this code does not compile" — so
the compiler is part of the test suite.

### Structure

See [the structure proposal](./docs/phase-0/03-repository-structure-proposal.md) for the full
layout and the reasoning behind each divergence from the Universitio repository.
