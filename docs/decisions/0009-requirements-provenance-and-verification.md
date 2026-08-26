# ADR-0009 — Requirements provenance and multi-source verification

**Status:** **Accepted** — architecture proposed by Claude, direction set by Vahid, 2026-08-26
**Answers:** Phase 0 Open Question 4 — who owns the correctness of requirement rules
**Related:** ADR-0004 (the wall), ADR-0008 (the learning loop)

## The requirement

Vahid:

> I do not want the system to rely on the AI or an engineer as the ultimate source of truth for
> university requirements. […] The important principle is that the system must know where a
> requirement came from and whether it has been verified before using it in an application decision.

Two evidence channels, with provenance on both, and escalation rather than guessing when they
disagree.

## The architecture

### Two independent channels, neither authoritative alone

| | **Curated channel** | **Official channel** |
|---|---|---|
| What | A knowledge-base entry reviewed and approved by a human specialist | Direct verification against the university's official website or application portal |
| Strength | Judgement, context, interpretation of ambiguous guidance | Current, first-hand, refreshable on demand |
| Weakness | Goes stale silently; costs specialist time | Machine-read, so it is an *interpretation* of a page |
| Provenance | reviewer, review date, cited source | URL, retrieval timestamp, evidence excerpt, content hash |

**The official channel produces evidence, not truth.** A machine reading a web page is
interpreting it — the same act, with the same failure modes, as extracting a field from a document
or from something a student said. So it is treated the same way the rest of this system treats
machine interpretation (ADR-0004, ADR-0007): it becomes *evidence*, and something else has to
promote it before it can carry a decision.

### Verification status — a lattice, not a score

```
  unverified      no usable evidence at all
  curated_only    human-reviewed KB; no official check, or the official check is stale/failed
  official_only   official source read; no human review of it
  corroborated    both channels present, fresh, and AGREEING          ← strongest
  conflicted      both present and they DISAGREE                      → escalate, never resolve
  stale           evidence exists but is past its revalidate-by
```

### The part Vahid did not ask for, and the reason I am proposing it

He invited a better approach, so here is the one thing I would add.

**The evidence bar should scale with consequence, not with confidence.**

Being wrong about "does this course want a personal statement?" costs an awkward email. Being
wrong about the 31-day financial-evidence window costs a student their visa. Treating those two as
the same problem means either over-spending specialist time on trivia or under-verifying the thing
that actually harms someone.

So every requirement carries a **criticality**, derived from what it *is* — never from how
confident the system feels about it:

| Criticality | Meaning | Required status to use it |
|---|---|---|
| `critical` | Being wrong causes visa refusal, legal harm, or a rejected application. Visa rules, financial evidence, ATAS, anything concerning a minor. | **`corroborated`** — both channels, agreeing, both fresh |
| `material` | Affects eligibility or outcome. Entry grades, English-language requirements, deadlines. | any single verified channel, fresh |
| `procedural` | Affects convenience. Document formats, portal quirks. | any non-conflicted, non-stale evidence |

This is the same shape as the two-layer escalation already in the system (brief §2.5): some things
require more, always, regardless of how sure the machine is. Consistency matters here — it means
one principle to understand, not two.

Anything below its bar **cannot be used in an application decision.** The requirement resolves to
unusable, the orchestrator raises a task, and the case escalates or asks. It does not fall back to
the weaker source and proceed.

### Conflict is never resolved automatically

Where the channels disagree, the system **never** prefers one. It marks the requirement
`conflicted`, refuses to use it at any criticality, and escalates for human review. Priority scales
with criticality; the refusal to guess does not.

### Freshness is per criticality, and configurable

A `revalidate-by` date is set from the requirement's criticality, from configuration rather than
constants in code — a critical requirement is re-checked far more often than a procedural one.
Past that date the status degrades to `stale` and the requirement stops being usable, which is what
makes "stale data must be detectable" (brief §5) an enforced property rather than a report someone
has to read.

### Change detection

Every piece of official-channel evidence stores a hash of the excerpt it was read from. On
re-verification, **a changed hash forces re-review even when the extracted value looks identical**.
That catches the case that would otherwise be invisible: a university quietly rewording a page in a
way that changes its meaning without changing the number.

### Conflicts feed the learning loop

When a specialist resolves a conflict or an ambiguity, that resolution is captured exactly as
ADR-0008 describes: recorded, validated, published, and then reusable. So disagreements between
the channels are not just incidents to be cleared — they are how the curated channel improves.

## Alternatives considered and rejected

**A single trust score.** Combine both channels into one number, use it above a threshold.
**Rejected**, and firmly: it destroys the exact thing Vahid says matters. A score of 0.87 does not
tell you whether a specialist reviewed this or a scraper guessed. Provenance answers "where did
this come from and has it been verified?"; a scalar cannot. This is the most tempting wrong answer
here, which is why it is written down.

**Human review of everything.** Safe, but it does not scale, it spends specialist time on trivia,
and it works against the whole direction of ADR-0008 (fewer interventions over time).

**Official source as the sole authority.** Superficially appealing — it is first-hand. But
university pages are ambiguous, contradictory, and often out of date, and a machine reading them
is interpreting them. Without human judgement in the loop, this is the AI being the source of
truth, which is precisely what Vahid ruled out.

**Prefer the fresher source on conflict.** Rejected: a conflict is a signal that something is
wrong, and freshness is not the same as correctness. Guessing quickly is still guessing.

## Scope

**Modelled now (Phase 1):** provenance, verification status, criticality, the evidence bar, the
usability gate, conflict detection, staleness. All pure domain logic, fully testable.

**Built later (Phase 4):** the Requirements Service itself — fetching official sources, extraction,
the curated KB store, and the specialist review console. What exists now is the gate they must
pass through, so no future service can bypass it.

## Consequences

- A requirement can always answer: where did this come from, when was it retrieved, who reviewed
  it, is it still fresh, and has it been corroborated.
- The most dangerous requirements are the most heavily verified, by construction.
- The system cannot silently degrade to a weaker source under time pressure.
- Specialist effort concentrates on conflicts and on critical requirements, not on everything.
- Adding the official channel later cannot weaken the model, because the bar is defined now.
