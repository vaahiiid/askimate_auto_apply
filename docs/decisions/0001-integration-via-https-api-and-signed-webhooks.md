# ADR-0001 — Integration via HTTPS API and signed webhooks

**Status:** **Accepted** — approved by Vahid, 2026-08-26
**Date:** 2026-08-26
**Detail:** [Phase 0 · Deliverable 2](../phase-0/02-integration-contract-proposal.md)

## Context

AskiMate runs on Replit; AAS will run on AWS. There is no VPC to peer and no IAM to federate.
The live askimate.com codebase was not available for inspection, so the integration must stay
correct without knowing its internals.

## Decision

AAS exposes a versioned HTTPS API. AskiMate calls `POST /v1/application-cases` to open a case,
authenticated by HMAC-SHA256 request signing and deduplicated by a required `Idempotency-Key`.
AAS pushes state changes to an AskiMate webhook, signed and at-least-once, carrying a monotonic
`event_seq`.

**`GET /v1/application-cases/{id}` is the authoritative source of state; webhooks are a latency
optimisation only.** AskiMate reconciles on a schedule and after every restart.

The trigger payload carries a required, non-nullable `request_evidence` object. AAS returns
`422` without it.

## Consequences

- Product rule 1 (explicit request before consequential action) becomes an enforced precondition
  rather than a policy. Every case can answer "who asked, when, in what words" from stored data.
- Replit restarts cannot silently desynchronise state, because reconciliation is pull-based.
  This exists specifically because the inventory found AskiMate has no durable queue.
- Student documents never transit AskiMate — students upload directly to AAS via pre-signed S3
  URLs. Smaller PII surface, simpler GDPR position.
- AskiMate must build ~4 small pieces: a signing client, a webhook receiver, a reconciliation
  poller, and a case-state UI. Estimated 2–4 days, contingent on seeing that codebase.
- Two HMAC secrets to manage and rotate.

## Alternatives rejected

**Shared database** — rejected. Couples the two systems at their most brittle layer, requires
cross-cloud DB access, gives AAS bugs a blast radius inside live AskiMate records, and
structurally undermines the browser-runtime isolation the brief requires in §8.

**SQS in both directions** — right mechanism, wrong boundary. Would require Replit to hold
long-lived AWS credentials and run a poller it has no worker process for, and removes the
synchronous response the student-facing UX needs. **SQS is adopted inside AAS**, between
orchestrator and workers, where it belongs.
