# ADR-0012 — AWS region: eu-west-2 (London)

**Status:** **Accepted** — approved by Vahid, 2026-08-26
**Answers:** Phase 0 Open Question 7

## Decision

All AAS infrastructure is provisioned in **eu-west-2 (London)**.

## Reasoning

The system stores passports and bank statements belonging to students applying to UK
universities. Keeping the document vault, the case store, the audit log and the browser traces in
a UK region keeps the data residency story simple — "all student data is stored in London" — and
avoids international transfer analysis for the core system.

eu-west-2 costs roughly 5–10% more than us-east-1. On a ~$100/month footprint that is $5–10/month,
which is the cheapest compliance insurance available on this project.

## Consequences

- All cost figures in [the AWS plan](../phase-0/04-aws-bootstrap-plan.md) are eu-west-2 list prices.
- Infrastructure-as-code pins the region; a second region would be a deliberate, reviewed decision.
- Should a service AAS needs be unavailable in eu-west-2, that becomes an explicit decision to
  bring back rather than a silent fallback to another region.
