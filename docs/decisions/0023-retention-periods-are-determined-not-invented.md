# ADR-0023 — Retention periods are determined from a source, or recorded as unresolved

**Status:** **Accepted** — Vahid's decision, 2026-08-26
**Extends:** [ADR-0010](./0010-policy-driven-document-retention.md)
**Analysis:** [retention-analysis.md](../retention-analysis.md)

## The decision

> *"Do NOT invent retention periods. Determine the appropriate retention requirements from the
> applicable ICO/UK GDPR guidance, relevant university/application requirements, and the actual
> purpose of processing. Where an exact retention period cannot responsibly be determined from an
> authoritative source, do not guess. Instead: record the requirement as unresolved, identify the
> authoritative source needed, clearly distinguish legal requirement, operational requirement and our
> own policy decision, make the system fail safely until the required policy is configured."*

ADR-0010 established that absence of policy is not permission to keep. This adds the harder part:
**what a policy has to be able to show**, and what to do when it cannot yet be written.

## The finding that shapes it

**UK GDPR prescribes no retention period for any of these document types.** Article 5(1)(e) requires
that personal data be kept no longer than necessary for the purpose; Article 5(2) requires the
controller to be able to demonstrate it. There is no number to look up — there is a duty to
determine one, justify it, and defend it.

That is a heavier obligation than being handed a number, and it is exactly why guessing would be the
wrong response to not finding one.

## Three kinds of basis, kept apart

`RetentionBasis.kind` is mandatory on every policy:

| | Means | When challenged |
|---|---|---|
| `legal_requirement` | a statute or regulation prescribes it | we cannot shorten it |
| `operational_requirement` | a university, UKVI or process needs it | we could shorten it, at a cost |
| `policy_decision` | our own choice under storage limitation | must survive *"why not less?"* |

Most retention here is the third. **A policy decision is the weakest claim and therefore needs the
most written down** — the opposite of how it usually gets treated.

Each basis carries a statement, a citable `authoritativeSource`, and **who read it and when**. A
basis nobody can be asked about is a number with a footnote.

## Unresolved is a first-class state, and it blocks

`UnresolvedRetentionRequirement` records: the open question, the source that answers it, an owner,
and who raised it. It **blocks storage exactly as a missing policy does** — and it is checked *first*
in `requirePolicy`, so the caller gets the useful error (*go and read this specific source*) rather
than the generic one (*write a policy*).

An unresolved requirement is strictly worse than a missing one: **someone has looked and found they
cannot responsibly say.** Leaving a gap instead would be indistinguishable from nobody having thought
about it, and is how "we will decide later" becomes "we never decided".

## Guards against a guess wearing the costume of a decision

The realistic failure is not an empty field. It is `"TODO"` added to make an upload work, which then
looks like a real basis in every listing and review.

- A basis statement, source, or verifier of `""`, `TODO`, `TBC`, `TBD`, `n/a`, `unknown`, `?`, `-`,
  `xxx`, `placeholder`, `fixme` or `pending` is **refused**.
- A `legal_requirement` whose statement is under twenty characters is **refused**: a legal
  requirement we cannot state is one we have not read.
- A pair that has **both** a policy and an unresolved entry is refused — the dangerous direction is
  that the policy silently wins.
- An unresolved entry with no owner, or naming no source, is refused. *"We need to look it up"* is
  not a plan; the point of recording it is to say **where the answer is**.
- A policy past its `reviewBy` is refused. Periods go stale as law and practice change.

## Versioned, never edited

A schedule is a version with an `effectiveFrom`, an approver, and optionally what it `supersedes`.
`effectiveFor(history, at)` answers *"what governed on this date?"* — the question that matters when
a document stored a year ago comes up for deletion, and the one an edited-in-place document cannot
answer.

## The state right now

Version 0 configures **no policies and twelve unresolved requirements**. Nothing can be stored.

That is the designed state, not a fault. `pnpm run retention-status` prints what is open and who owns
each answer, and **it runs in CI** — because a half-configured schedule is the dangerous one: it
looks configured.

## A related determination this surfaced

**DPA 2018 Schedule 1 may require an "appropriate policy document"** for some conditions relied on
when processing special-category data. If any of these documents are handled as special category — a
reference mentioning a disability, a medical reason for a deferred entry — that document must exist
*before* the processing. Flagged with the lawful-basis determinations under ADR-0022 rather than
answered here.

## Honest limitation

I could not read a single one of the named sources: this environment blocks `ico.org.uk`,
`legislation.gov.uk` and `gov.uk`. Every `expectedBasisKind` in version 0 is **a reading of where the
answer is likely to live**, marked as a reading. The framework above is my understanding of
well-established law, written down so whoever *does* read the sources knows what they are looking
for. It is not advice, and the sources are what count.
