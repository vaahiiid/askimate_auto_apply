# Phase 0 — Inspect and Bootstrap

**Status:** ✅ Complete · awaiting Vahid's approval before Phase 1
**Date:** 2026-08-26

Per the master brief §11, Phase 0 is *"inspect the existing AskiMate repository, produce an
architecture baseline and a proposed integration contract, propose the new repo structure and
AWS bootstrap plan. No application code. No changes to the existing system."*

**No application code has been written. Nothing in the existing repository has been changed.**
The `vaahiiid/Universitio` repository was cloned read-only and inspected; not one byte was
modified.

---

## The five deliverables

| # | Document | What it answers |
|---|---|---|
| 1 | [Existing System Inventory](./01-existing-system-inventory.md) | What actually exists today, confirmed by reading the code |
| 2 | [Integration Contract Proposal](./02-integration-contract-proposal.md) | Three options for how AskiMate and AAS talk, with a recommendation |
| 3 | [Repository and Project Structure](./03-repository-structure-proposal.md) | How the new system is laid out, and how brief §3.1 is enforced by types |
| 4 | [AWS Bootstrap Plan and Cost Model](./04-aws-bootstrap-plan.md) | What to provision, when, and what it costs against the $1,000 credit |
| 5 | [Open Questions](./05-open-questions.md) | What I need from you, ordered by what blocks Phase 1 |

Confirmed decisions are recorded as ADRs in [`docs/decisions/`](../decisions/).

---

## The five findings that matter most

### 1. The live AskiMate codebase is not on GitHub — and Phase 0 is still complete

AskiMate was separated out of the Universitio monorepo on **2026-06-18** into a standalone
product at askimate.com. The three visible repositories are: this one (empty),
`ai-admissions-platform` (an **empty placeholder**, 0 KB, no branches), and `Universitio` — which
contains the *pre-split archive* of AskiMate plus the platform it grew out of.

So I inspected the AskiMate codebase **as it stood on 2026-06-18**, plus the database, auth, and
infrastructure it still shares. I have not seen whatever askimate.com has become since.

Everything in these documents is labelled **Confirmed** (I read it) or **Assumed** (inferred,
needs your confirmation). Nothing assumed is presented as fact.

**This blocks less than it appears to.** It affects the exact endpoint shapes in Deliverable 2 —
which is precisely why I recommended the integration option that stays correct without that
knowledge. It does not block Phase 1, which the brief designed to be self-contained.

### 2. There is no document vault — and that is genuinely good news

Student CVs are written to `uploads/cvs/` on the container's **local disk**: unencrypted,
ephemeral on Replit (a redeploy loses them), with no expiry metadata, no verification state, and
no link to a student account. There is no student document storage of any other kind.

The brief's hardest data requirement — deterministic validity, the 31-day financial-evidence
window — therefore has **nothing to migrate from and nothing to stay compatible with.** AAS owns
the vault outright, greenfield, from Phase 2. That removes what would otherwise have been the
single most awkward part of this project. It also means Phase 2 must budget for the *whole*
vault, with no reuse.

### 3. Hosting is Replit, not GCP — which forces a cleaner boundary

The brief says the existing product runs on Google Cloud Platform. Compute and hosting are
actually **Replit**; the GCP part is object storage only, and it is *Replit's* GCS reached
through a local sidecar, not a GCP project you control.

This is directionally consistent with the brief (AAS on AWS, AskiMate stays put) but changes the
*nature* of the boundary: there is no VPC to peer and no IAM to federate. The integration must be
a plain authenticated HTTPS contract — which is also the cleanest and most testable option.

### 4. The "AI never invents facts" rule is already the house style

From the existing `chatService.ts`, unprompted:

> `openai_semantic` and `bm25_fallback` were removed because they implied that OpenAI itself
> produced the study-abroad answer. **Study-abroad answers are NEVER LLM-generated without a KB
> anchor.**

The brief's §3.1 is the *same principle*, raised from prompt-enforced to
compile-time-enforced. That is an upgrade in rigour, not a change in philosophy — and it means
the team will recognise the reasoning rather than resist it.

### 5. Browser automation is *not* the dominant cost — and I recommend acting on that now

Brief §9 assumes it is. Modelled properly, an 8-minute Fargate run costs **$0.007**; even 500
runs/month is **$3.62**. The real drivers are **AI inference for navigation reasoning**
($0.10–$0.50 per run, 15–70× the compute) and **always-on infrastructure**, where a NAT Gateway
alone costs $35/month whether used or not.

Consequences worth acting on: instrument model-cost per run from Phase 3; prefer **Bedrock** so
that spend draws on AWS credits rather than cash; and defer NAT Gateway until real student data
exists. Full working in [Deliverable 4 §1](./04-aws-bootstrap-plan.md).

**The AWS credit is not this project's constraint.** At ~$82–110/month it gives 9–11 months of
runway, covering Phases 0–7. Engineering time is the constraint.

---

## What I need to start Phase 1

Three answers. Details in [Deliverable 5](./05-open-questions.md).

1. **Approve three structural decisions** — integration Option B; AAS owns the confirmed profile;
   the repo structure and its divergences from Universitio.
2. **Define the identity of a submission** — needed to make duplicate submission *structurally*
   impossible rather than merely unlikely. I have proposed a model.
3. **Confirm the case state machine** — I have proposed the states; it is product definition, so
   it is your call.

**Nothing else is required to begin.** No AWS account, no credentials, no university access, no
legal answers. Phase 1 runs against Docker Postgres locally and provisions **$0** of infrastructure.

Per brief §13, I am stopping here and awaiting your approval.
