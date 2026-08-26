# Phase 0 · Deliverable 4 — AWS Bootstrap Plan and Cost Model

**Date:** 2026-08-26
**Status:** Proposal — requires Vahid's approval
**Budget:** ~$1,000 in AWS credits

> **All figures are estimates** based on published on-demand list prices for **eu-west-2
> (London)**, rounded, and exclusive of tax. They are planning numbers, not quotes. Where a
> number drives a recommendation I have shown the arithmetic so you can check it.

---

## 1. Headline: I disagree with one assumption in the brief, and it changes the plan

Brief §9 states:

> Browser automation is the dominant cost driver. Model the cost per application run explicitly
> before Phase 6 and report it.

I modelled it now rather than at Phase 6, because getting this wrong shapes the architecture.
**At MVP volume, browser automation is not the dominant cost — it is close to a rounding error.**

Fargate at 1 vCPU / 2 GB in eu-west-2 costs about **$0.0543 per hour**:

```
  1 vCPU × $0.04456/vCPU-hr  = $0.04456
  2 GB   × $0.004865/GB-hr   = $0.00973
                               ─────────
                               $0.05429 per hour
```

An eight-minute application run therefore costs:

```
  $0.05429 × (8 ÷ 60) = $0.0072   ← seven-tenths of one US cent
```

Even at **500 runs per month**, browser compute is **$3.62/month**. Against a $1,000 credit, it
is immaterial.

### What actually dominates

Two things, in this order:

**1. AI inference for navigation reasoning — the true per-run cost driver.**
Brief §3.1 has the AI reason about *how to get through a page*: identifying controls, deciding
which button advances, interpreting validation errors, recovering from layout changes. That is
plausibly 20–40 model calls per run, and if screenshots are used for visual grounding, each call
carries an image. A realistic range is **$0.10–$0.50 per run** — i.e. **15× to 70× the Fargate
cost of the same run.**

This matters more than the ratio suggests, because **model API spend does not draw on AWS
credits** if you call OpenAI or Anthropic directly. It comes out of cash. Unless you use
**Amazon Bedrock**, in which case it does draw on the credits (subject to §6).

**2. Always-on infrastructure, especially NAT Gateway.**
A NAT Gateway costs $0.048/hour = **$35/month whether or not anything uses it** — roughly
**ten times** the monthly browser compute at 500 runs. It is the single largest avoidable line
item in a naive setup, and it is easy to provision without noticing.

### What I recommend instead

Not a change to the plan — a change to where the attention goes:

- **Instrument model-call cost per run from Phase 3**, tagged by case and by phase, so the real
  per-run figure is measured rather than estimated. This is the number to watch.
- **Use Bedrock for navigation inference** so that spend draws on credits rather than cash —
  subject to confirming credit eligibility (§6, and Open Question 5).
- **Avoid NAT Gateway until student data is actually in the system** (§4).
- Do not optimise browser compute. There is nothing there to win.

I am flagging this rather than quietly re-planning, per brief §12.6. If you would still prefer
the formal cost model deferred to Phase 6, say so and I will re-run it then with measured data —
but the architectural consequences above are worth acting on now.

---

## 2. Region: eu-west-2 (London) — and this is a compliance decision, not a latency one

**APPROVED by Vahid, 2026-08-26: eu-west-2 (London).**

The system stores **passports and bank statements** belonging to students applying to UK
universities. Under UK GDPR this is special-category-adjacent personal data with real
consequences if mishandled. Keeping the vault, the database, the audit log and the browser
traces in a UK region:

- keeps the primary data residency story simple ("all student data is stored in London");
- avoids international transfer analysis for the core system;
- aligns with what UK universities and partner portals will expect if they ever ask.

eu-west-2 costs roughly 5–10% more than us-east-1. On a ~$100/month footprint that is $5–10/month.
**That is the cheapest compliance insurance available on this project** and I would not trade it
for the saving.

✅ **Confirmed.** All AAS infrastructure is provisioned in eu-west-2. Student documents, the case
store, the audit log and browser traces all stay in London.

---

## 3. Phase 1 requires no AWS spend at all

Brief §9: *"Do not spend credits on idle infrastructure."* Taken literally, that means the first
thing to decide is what **not** to provision.

Phase 1 is the domain core — case model, state machine, task model, append-only event log, audit
log, idempotency. The brief specifies it as *"entirely internal, fully testable with no external
systems."*

That is achievable with **Postgres in Docker on a laptop and in CI**. No RDS, no VPC, no Fargate,
no account bootstrap at all.

**Recommendation: provision nothing until Phase 2.** Weeks of Phase 1 development at **$0**
against the credit. The AWS account can be prepared in parallel whenever convenient — it is not
on the critical path, and it does not gate anything.

---

## 4. Bootstrap plan by phase

### Phase 1 — nothing

Local Docker Postgres. GitHub Actions for CI (free tier is ample for a private repo at this
size). **$0/month.**

### Phase 2 — the minimum that stores documents

Triggered by the document vault. Provision only:

| Resource | Purpose |
|---|---|
| **S3** — one bucket, versioned, public access blocked | Document vault |
| **KMS** — customer-managed key | Vault encryption (brief §8) |
| **RDS** `db.t4g.micro`, 20 GB gp3, single-AZ, private subnet | Case store |
| **Secrets Manager** | DB credentials, HMAC keys |
| **CloudWatch Logs** | Audit + application logs, PII-redacted |
| **VPC** — 2 AZs, S3 **Gateway** endpoint (free) | Networking |

Still **no Fargate, no ALB, no NAT** — the API runs locally against real S3/RDS during
development.

**≈ $25/month.**

### Phase 3 — first deployed compute

| Resource | Purpose |
|---|---|
| **ECR** | Container images incl. Playwright |
| **ECS Fargate** — `orchestrator-api`, `orchestrator-worker` (0.25 vCPU / 0.5 GB each) | Long-running services |
| **ECS Fargate** — `browser-runner`, on-demand (1 vCPU / 2 GB) | Discovery + execution runs |
| **SQS** + DLQs | Durable task queue |
| **ALB** | Public ingress for `orchestrator-api` |

**Networking decision — this is where the money is.**

The conventional pattern (private subnets + NAT Gateway) costs **$35/month before a single byte
moves**. The alternative — Fargate tasks in public subnets with `assignPublicIp: ENABLED`,
security groups permitting **no inbound traffic**, and the database in a private subnet reachable
only from the task security group — costs the public-IPv4 charge instead:

```
  $0.005/hr × 730 × 2 always-on tasks = $7.30/month     (browser tasks are ephemeral: negligible)
```

**Saving: roughly $28/month, or ~$340 over a year of the credit.**

The security difference is real but narrow: with no inbound rules the task is not reachable from
the internet either way; what changes is defence-in-depth if a security group were ever
misconfigured.

**Recommendation, staged deliberately:**

- **Phases 3–4 — public subnets, no NAT.** During discovery and blueprint work there is no real
  student data in the system. Take the saving.
- **From Phase 5 — private subnets + a single NAT Gateway ($35/month).** Before any real
  student's passport or bank statement is in the vault, move to the conventional posture. Budget
  for it from that point.

This is a genuine trade-off with a defensible line drawn at "when real student data arrives",
rather than a saving taken and quietly forgotten. If you would rather pay the $35 from day one
for a simpler story, that is a reasonable call — it costs about $175 across the likely project
duration. **Tell me which you prefer; I will not decide this one silently.**

### Phases 4–7 — no new infrastructure

Requirements, mapping, fill/authorise, submit, and the second university all run on what Phase 3
established. Costs rise only with the number of runs, and per §1 that curve is very flat on the
AWS side.

---

## 5. Steady-state monthly cost

**Phases 3–4 (public subnets, no NAT):**

| Line item | Monthly |
|---|---|
| RDS `db.t4g.micro` + 20 GB gp3 | $16 |
| Fargate — `orchestrator-api` (0.25 / 0.5) | $10 |
| Fargate — `orchestrator-worker` (0.25 / 0.5) | $10 |
| Fargate — `browser-runner` (500 runs × 8 min) | $4 |
| ALB (incl. modest LCU) | $20 |
| Public IPv4 (2 always-on tasks) | $7 |
| S3 (vault + traces/videos) | $3 |
| KMS (2 CMKs) | $2 |
| Secrets Manager (~6 secrets) | $3 |
| CloudWatch Logs | $5 |
| ECR | $1 |
| SQS | <$1 |
| **Total** | **≈ $82/month** |

**From Phase 5 (private subnets + single NAT):** add $35, drop $7 of public IPv4 →
**≈ $110/month.**

### Against the $1,000 credit

| Period | Configuration | Burn |
|---|---|---|
| Phase 1 (weeks 1–4) | nothing provisioned | **$0** |
| Phase 2 | storage + DB only | ~$25/mo |
| Phases 3–4 | + compute, no NAT | ~$82/mo |
| Phase 5 onward | + NAT, private subnets | ~$110/mo |

A realistic schedule — one month at $0, one at $25, three at $82, the rest at $110 — gives
roughly **9 to 11 months of runway**, which comfortably covers Phases 0 through 7.

**The AWS credit is not the constraint on this project.** Engineering time is. That is worth
knowing, because it means architectural decisions should be made on correctness and
maintainability grounds, not to shave $10/month.

**Two things could change that**, and both are outside AWS's control:

1. **Model API spend** (§1), if billed outside Bedrock — it comes from cash, not credits, and at
   500 runs/month at $0.30/run it is **$150/month**, i.e. larger than the entire AWS bill.
2. **Credit expiry or service exclusions** (§6).

---

## 6. Credit mechanics — please check these two things

AWS credits are not simply $1,000 of arbitrary spend.

1. **Expiry.** Activate credits typically expire 12–24 months from issue. If these were issued
   some time ago, the usable window may be materially shorter than the project.
2. **Service exclusions.** Credit programmes commonly exclude certain services. **Whether
   Amazon Bedrock is covered is the single most consequential item**, because §1 identifies model
   inference as the largest per-run cost. If Bedrock is covered, routing navigation inference
   through it converts the project's biggest variable cost from cash into credit. If it is not,
   the model-provider choice should be made on price and capability instead.

Both are visible in the AWS Billing console under **Credits**. I cannot see them from here.
Raised as Open Question 5 — **not blocking**, but it changes the model-hosting recommendation.

---

## 7. Bootstrap checklist (Phase 2, when we get there)

Everything below is **Infrastructure as Code — AWS CDK in TypeScript**, in `infra/`. No manual
console changes: the brief's auditability requirements apply to infrastructure too, and a
console click leaves no reviewable record.

1. Dedicated AWS account for AAS, separate from anything else.
2. Root account: MFA on, access keys deleted, never used again.
3. IAM Identity Center for human access. No long-lived IAM users.
4. Billing alerts at **$100, $250, $500, $750** of credit consumed. Non-negotiable — a runaway
   Fargate loop is exactly the failure this catches.
5. CloudTrail on, logging to a dedicated bucket.
6. VPC, 2 AZs, S3 Gateway endpoint.
7. KMS CMKs with key rotation enabled.
8. S3 vault: versioning on, public access blocked, TLS-only bucket policy, lifecycle rules.
9. RDS in private subnets, encrypted with CMK, automated backups, deletion protection on.
10. Secrets Manager entries; **no secret ever in code, logs, prompts, or the repository**.
11. GitHub Actions → AWS via **OIDC**, not stored access keys.
12. Per-app IAM task roles, least privilege — `browser-runner` gets one SQS queue and one S3
    prefix and nothing else (see [03 §4](./03-repository-structure-proposal.md)).

**None of this is needed to start Phase 1.**

---

## 8. What I need from Vahid

1. ~~Approve eu-west-2 (London) as the region.~~ ✅ **Approved 2026-08-26.**
2. **Choose the Phase 3–4 networking posture:** public subnets without NAT (~$28/month cheaper,
   staged to private subnets at Phase 5), or private subnets with NAT from the start.
3. **Check the credit expiry date and whether Bedrock is covered** (§6).
4. **Confirm you are happy that Phase 1 provisions nothing** and that AWS account setup can
   happen in parallel, off the critical path.

Only item 4 relates to Phase 1, and it requires no action from you — just agreement.

---

*Deliverable 4 of 5. Continue to [05 — Open Questions](./05-open-questions.md).*
