# ADR-0012 — AWS region: eu-west-2 (London)

**Status:** **Accepted** — approved by Vahid, 2026-08-26. **Amended 2026-09-28 (P244):** the
residency reasoning applied to the model endpoint; see the last section.
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

## Amended 2026-09-28 (P244): the model endpoint must resolve to London, not merely be addressed there

Two Amazon Bedrock services serve Claude (ADR-0018, amended in P243). The Messages-API endpoint,
addressed as `bedrock-mantle.eu-west-2.api.aws`, lists eu-west-2 as "Global, EU" and not
"in-region only", and its documentation does not say how a request carrying a bare model id is
routed from a London base URL — whether it stays in the EU could not be established from the
record. The InvokeModel service, addressed as `bedrock-runtime.eu-west-2.amazonaws.com`, resolves
to the region named, and its cross-region inference profiles say in their id where a request may
go (`eu.` for the EU, `global.` for anywhere).

Vahid, 2026-09-28, in his words:

> *"You could not establish whether a bare id from a London base URL stays in the EU. ADR-0012
> chose London deliberately. An endpoint whose routing we cannot determine is not a place to send a
> student's CV."*

So the residency rule of this ADR reaches the model call: **a student's document goes only to an
endpoint whose routing is determined**, and London means the request resolves to London, or to a
profile that names the EU, not an address that carries the region's name. The model client calls
the InvokeModel service for that reason as much as for the list (ADR-0018). A model reachable in
eu-west-2 only through a `global.` profile is a decision to bring back here, not a default.
