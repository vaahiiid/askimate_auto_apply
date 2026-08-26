# Phase 0 · Deliverable 3 — Repository and Project Structure

**Date:** 2026-08-26
**Status:** Proposal — requires Vahid's approval
**Repository:** `vaahiiid/askimate_auto_apply` (currently empty)

---

## 1. Shape: pnpm monorepo, TypeScript, Node

Same shape as `vaahiiid/Universitio`, deliberately. The team already knows pnpm workspaces,
Drizzle, Zod and the `@workspace/*` import convention. Reusing a familiar layout means the
unfamiliar parts of this project — the state machine, the blueprint model, browser automation —
get the team's full attention.

Where the existing repo has habits worth keeping, I keep them. Where it has habits that would be
dangerous at these stakes (§6), I change them and say why.

---

## 2. Proposed layout

```
askimate_auto_apply/
├── package.json                 pnpm workspace root
├── pnpm-workspace.yaml          incl. minimumReleaseAge: 1440  ← copied from Universitio
├── tsconfig.base.json           strict: true (stricter than Universitio — see §6)
├── .github/workflows/ci.yml     ← exists from commit #1
│
├── apps/
│   ├── orchestrator-api/        HTTPS API. The ONLY public inbound surface.
│   │                            /v1/application-cases, outbound webhooks, handoff endpoints.
│   ├── orchestrator-worker/     SQS consumer. Executes tasks. Owns the state machine loop.
│   ├── browser-runner/          Isolated Playwright container. See §4 — this one is special.
│   └── review-console-api/      Human specialist API: inspect, approve, escalate.
│
├── packages/
│   ├── domain/                  ★ Pure. Zero I/O. Case model, state machine, events,
│   │                              idempotency, task model. Phase 1 lives entirely here.
│   ├── case-store/              Postgres + Drizzle. Append-only event log. Derived state.
│   ├── profile/                 Canonical profile. Confirmed-only writes. Typed field resolver.
│   ├── documents/               S3+KMS vault. Extraction, confirmation, validity engine.
│   ├── requirements/            Requirements w/ provenance, confidence, revalidate-by.
│   ├── blueprint/               Blueprint schema, versioning, drift detection.
│   ├── mapping/                 Canonical field → university field. CONFIGURATION, not code.
│   ├── adapters/
│   │   ├── contract/            The RouteAdapter interface + the shared contract test suite.
│   │   ├── assisted-manual/     Adapter #1. Permanent fallback. Never removed.
│   │   └── direct-portal/       Adapter #2. Browser automation.
│   ├── handoff/                 Pause/resume. Resumable tokens with TTL.
│   ├── authorisation/           Append-only ledger. Content hashing. Void-on-change.
│   ├── audit/                   Structured audit events. PII redaction by default.
│   ├── llm/                     ★ The ONLY module allowed to call a model. See §3.
│   ├── config/                  Env + Secrets Manager loading, validated with Zod.
│   └── testing/                 Fixtures, recorded portal interactions, test factories.
│
├── infra/                       AWS CDK (TypeScript — same language as everything else)
│
└── docs/
    ├── phase-0/                 These five documents
    ├── decisions/               ADRs — the decision record required by brief §12.8
    └── blueprints/              Reviewed Application Blueprints, versioned, human-readable
```

### Why `apps/` and `packages/` rather than Universitio's `services/` and `lib/`

Universitio has two deployables and a handful of shared libraries. AAS has **four deployables
with genuinely different security postures** — in particular `browser-runner`, which must run
with no database access and no application secrets. The `apps/` vs `packages/` split makes
"what is deployed, and with which IAM role" the top-level question, which is the right one to
foreground here.

---

## 3. Making brief §3.1 impossible to violate — by construction

The brief's hardest requirement:

> The AI must **never** be the source of a value that goes into a form field. […] Enforce this
> structurally, not by instruction. Make it impossible for model-generated text to reach a form
> field by construction.

Instructions and code review do not achieve this — a tired engineer at 6pm defeats them. **The
type system does.** Two branded types that share no conversion path:

```ts
// packages/domain/src/values.ts

declare const brand: unique symbol;

/** A value confirmed by the student and read from the profile. Safe to submit. */
export type ConfirmedValue<T> = T & { readonly [brand]: "confirmed" };

/** Text produced by a language model. NEVER safe to submit. */
export type ModelText      = string & { readonly [brand]: "model-generated" };
```

The only constructor for `ConfirmedValue<T>` lives in `packages/profile`, and it only runs
against a row that carries a confirmation record:

```ts
// packages/profile — the ONLY place ConfirmedValue is minted
export function resolveField<K extends ProfileFieldKey>(
  profile: ConfirmedProfile, key: K,
): ConfirmedValue<ProfileFieldType<K>> | FieldUnavailable { … }
```

The adapter interface then accepts nothing else:

```ts
// packages/adapters/contract
fillSection(caseRef: CaseRef, section: SectionRef,
            values: ReadonlyMap<FieldRef, ConfirmedValue<unknown>>): Promise<FillResult>;
```

And `packages/llm` — the only module permitted to import an AI SDK — returns `ModelText`,
which has no path to `ConfirmedValue`. Passing model output to `fillSection` is a **compile
error**, not a code-review catch.

The escape hatch the brief demands is the `FieldUnavailable` branch: when a required field has
no confirmed source, the resolver returns it, the orchestrator raises a task, and **the system
stops and asks the student.** It cannot infer, estimate, or fill a plausible answer, because
there is no type it could construct to do so.

Enforced additionally by lint rule: only `packages/llm` may import an AI SDK. CI fails
otherwise. Belt and braces — the types are the real control.

**This is the single most important structural decision in the repository**, and it is why
`packages/domain` and `packages/llm` are separate packages rather than folders: package
boundaries are enforceable by the dependency graph in a way that folders are not.

---

## 4. `browser-runner` is deliberately quarantined

Brief §8: browser automation executes untrusted page content and must run "in isolated
containers with no access to application secrets or the primary database."

Structural consequences, not conventions:

- `browser-runner` **does not depend on `case-store`.** Not "should not" — the dependency is
  absent from its `package.json`, so it cannot import it.
- It receives a **task envelope** over SQS containing only what that run needs, and returns
  results the same way. It never holds a DB connection string.
- Its IAM task role can write traces/screenshots to **one S3 prefix** and read **one SQS queue**.
  Nothing else. No Secrets Manager access.
- Portal credentials never reach it (brief §8 forbids storing student portal passwords at all —
  the session-handoff pattern in `packages/handoff` is how authentication happens instead).

A CI check asserts `browser-runner`'s transitive dependency set excludes `case-store`,
`profile`, and `documents`. If someone adds the import, the build fails.

---

## 5. Phase mapping — what gets built when

| Phase | Packages touched | Needs AWS? |
|---|---|---|
| **1 — Domain core** | `domain` (+ `case-store` local Postgres) | **No.** Docker Postgres locally. |
| **2 — Profile & documents** | `profile`, `documents` | Yes — S3, KMS. |
| **3 — Browser & discovery** | `browser-runner`, `blueprint`, `adapters/direct-portal` | Yes — Fargate, ECR. |
| **4 — Requirements & mapping** | `requirements`, `mapping` | No new. |
| **5 — Fill → authorise** | `adapters/*`, `authorisation`, `review-console-api` | No new. |
| **6 — Submit & confirm** | `adapters/*`, `orchestrator-worker` | No new. |
| **7 — Second university** | `docs/blueprints/` + `mapping` **config only** | No new. |

**Phase 7 is the test of the whole design.** If adding a second university requires a code change
anywhere in `apps/`, the abstraction has failed. The layout is arranged so that a second target
is a new blueprint document plus new mapping configuration — data, not code, exactly as brief
§3.2 requires.

**Phase 1 requires no AWS spend at all.** That is a deliberate scheduling choice — see
[04 — AWS Bootstrap Plan](./04-aws-bootstrap-plan.md).

---

## 6. Where I diverge from Universitio's conventions, and why

| Convention | Universitio | AAS | Reason |
|---|---|---|---|
| `minimumReleaseAge: 1440` | ✅ | ✅ **keep** | Genuinely good supply-chain defence. Copy verbatim. |
| Decision records | `.agents/memory/` | `docs/decisions/` ADRs | Same good habit, formalised. Brief §12.8 requires it. |
| Threat model in repo | ✅ | ✅ **keep** | Current and useful. Same practice here. |
| `tsconfig` strictness | partial (`strict` not set) | **`strict: true`** | The branded types in §3 need it to be reliable. |
| Migrations | `drizzle-kit push --force` | **versioned, reviewed, forward-only** | `--force` can drop a column with no review. Unacceptable on passport/financial data. |
| Node version | unpinned | **pinned** (`.nvmrc` + `engines`) | Playwright is sensitive to runtime version drift. |
| CI | none | **from commit #1** | See below. |
| Tests | none | required per brief §10 | See below. |
| OpenAPI contract | built, used for 1 endpoint | **used properly** | Free at greenfield; this is the AskiMate↔AAS seam. |
| Auth | one shared admin credential | **named reviewers** | Ledger entries must be attributable to a person. |
| Session tokens | JWT in `localStorage` | **HttpOnly cookies** | An AAS session can authorise a submission. |

### On CI and tests — the honest version

Deliverable 1 §8 found **no CI and zero tests** in the existing codebase. I am not going to
soften that, and I am also not going to treat it as carelessness: for a marketing site plus a
chat assistant, manual QA and a post-deploy smoke test are a defensible trade-off, and the
security work in that repo shows a team that thinks carefully when stakes are visible.

The stakes here are different. This system submits university applications. A regression does
not show a wrong blog image — it submits a wrong application, or submits twice.

So CI ships **with the first commit**, before there is any code to protect. Retrofitting CI onto
a codebase is a miserable job that never gets prioritised; adding it to an empty repository costs
an hour. Every phase gate is then automatic:

```yaml
# .github/workflows/ci.yml — on every push and PR
typecheck  →  lint  →  unit  →  integration (Dockerised Postgres)
           →  adapter contract tests (recorded fixtures, no live portals)
           →  build  →  dependency-boundary checks (§3, §4)
```

Brief §10 requires failure-scenario coverage — auth failure, missing document, conflicting
information, stale requirements, layout change, timeout/retry, **duplicate submission**, partial
submission, and crash-recovery mid-run. Those live in `packages/testing` as fixtures and are
replayed in CI. No test ever touches a live university portal (brief §10, and I will not do it
without your explicit written go-ahead and a safe target).

---

## 7. Naming

`@askimate/aas-*` — e.g. `@askimate/aas-domain`, `@askimate/aas-case-store`.

Distinct from Universitio's `@workspace/*` so that if the two repositories ever share a
toolchain or a developer's editor, there is no ambiguity about which system a package belongs
to. Small thing; cheap now, annoying later.

---

## 8. What I need from Vahid

1. **Approve this structure** (or tell me what to change).
2. **Confirm the divergences in §6** — particularly versioned migrations and CI-from-day-one.
   Both cost a little time up front and are painful to add later.

No AWS access or credentials are required to begin Phase 1.

---

*Deliverable 3 of 5. Continue to [04 — AWS Bootstrap Plan](./04-aws-bootstrap-plan.md).*
