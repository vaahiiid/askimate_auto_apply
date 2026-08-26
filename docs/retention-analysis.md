# Retention analysis

**Date:** 2026-08-26
**Status:** framework established · **every period unresolved**
**Schedule:** [`config/retention/v0.2026-08-26.json`](../config/retention/v0.2026-08-26.json)
**Check it:** `pnpm run retention-status`

---

## Read this first

**I could not read any of the authoritative sources.** The build environment blocks `ico.org.uk`,
`legislation.gov.uk` and `gov.uk` — I checked, and all three return no response.

So this document does two things and deliberately does not do a third:

- ✅ establishes the **framework** — what kind of question a retention period is, and why
- ✅ records **what is unresolved**, per document type and purpose, with the source that answers it
- ❌ **does not propose any period**, because proposing one from memory is exactly the guess your
  instruction rules out

Anything below that reads like a legal statement is my understanding of a well-established
framework, offered so the person who *does* read the sources knows what they are looking for. It is
not advice, and the sources are what count.

---

## 1 · The finding that shapes everything else

**UK GDPR does not prescribe retention periods for any of these documents.**

That is not a gap in my research. It is how the law works. Article 5(1)(e) — storage limitation —
requires that personal data be kept in a form permitting identification *no longer than is necessary
for the purposes for which it is processed*. Article 5(2) — accountability — requires the controller
to be **able to demonstrate** compliance. Article 30 requires records of processing to include, where
possible, the envisaged time limits for erasure.

So there is no number to look up for "how long may we keep a passport scan". There is a duty to
determine a period, justify it against the actual purpose, write down the justification, and be able
to defend it.

**That is a heavier obligation than being handed a number, not a lighter one** — and it is precisely
why guessing would be the wrong response to not finding one.

## 2 · Three kinds of answer, and why the distinction matters

Your instruction to distinguish these is doing real work. It decides what happens when someone
challenges a period.

| Kind | Means | When challenged |
|---|---|---|
| **Legal requirement** | A statute or regulation prescribes it | We cannot shorten it. Cite the provision. |
| **Operational requirement** | A university, UKVI or process needs it this long | We *could* shorten it, at a cost to someone. The cost is the justification. |
| **Policy decision** | Our own choice under storage limitation | We chose it. We must survive *"why that long and not less?"* |

The system encodes this as `RetentionBasis.kind`, and every policy must carry one, with a statement,
a citable source, and the name of whoever read it.

**Most retention in this system will be the third kind.** A policy decision is the *weakest* claim
and therefore needs the *most* written down — which is the opposite of how it usually gets treated.

There is a guard against the specific failure of dressing a guess up as a decision: a basis of
`"TODO"`, `"TBC"`, `"n/a"`, `"unknown"` and a dozen similar strings is refused by
`validateSchedule`. That failure is realistic — someone adds a placeholder to get an upload working,
and it then looks like a real basis in every listing and review.

And a stricter bar on the strongest claim: a `legal_requirement` whose statement is under twenty
characters is refused. *A legal requirement we cannot state is one we have not read.*

## 3 · What is unresolved, and what answers it

Twelve entries, all in the schedule, all blocking. Grouped by where the answer lives.

### Our own decision under storage limitation

| Document · purpose | The open question |
|---|---|
| `passport` · identity verification | Is there any period beyond *"until the application is decided"* we can justify — and are we relying on defending a claim as a purpose? |
| `national_id` · identity verification | As passport, plus whether it reveals data that is special category in context |
| `personal_statement` · application submission | The student's own writing. Does reuse across applications change the answer? |
| `reference_letter` · application submission | Contains a **third party's** data as well as the student's — and what does the referee need to be told? |
| `other` · audit evidence | How long must a submission preview remain reproducible? |

**Source needed:** ICO *Guide to UK GDPR → Principles → Storage limitation*, read against our actual
purposes.

**The one worth deciding early:** whether we are relying on *defending a legal claim* as a purpose.
If we are, the limitation period for a contract claim in England and Wales (Limitation Act 1980,
s.5 — **six years**, and this needs confirming, not taking from me) becomes the anchor for several
of these, and the periods get much longer. If we are not, they get much shorter. It is one decision
that moves most of the table, and it is a legal question rather than a product one.

### The university's or QA Higher Education's requirement

| Document · purpose | The open question |
|---|---|
| `academic_transcript` · application submission | How long must *we* hold it, as distinct from the university? |
| `degree_certificate` · application submission | As transcript |
| `english_test_certificate` · application submission | Plus: the test provider's own terms may constrain onward handling |

**Source needed:** the university's / QA HE's published records-retention requirement or privacy
notice, and any contractual terms between Universitio and QA HE.

**A distinction worth being explicit about:** universities that sponsor Student visas have
record-keeping duties under Home Office sponsor guidance. **Those are the sponsor's duties, not
ours.** We are not a sponsor. Inheriting the university's retention period because it is written
down somewhere would be adopting an obligation that is not ours — and keeping personal data longer
than necessary for *our* purpose is the breach, not the safe option.

### Children's data

| Document · purpose | The open question |
|---|---|
| `birth_certificate` · minor safeguarding | Do children's-data considerations shorten this or lengthen it? |
| `parental_consent` · minor safeguarding | A consent record may need to **outlive** the processing it authorised, in order to evidence it |
| `guardianship_document` · minor safeguarding | As parental consent |

**Source needed:** ICO guidance on children's personal data and the Age Appropriate Design Code;
plus the university's own minor-applicant process.

**Why these are marked `expectedBasisKind: "unknown"` rather than guessed at:** the two principles
genuinely pull in opposite directions here. Minimisation says hold a child's data for less time.
Article 7(1) — being able to demonstrate consent — says hold the consent record for longer. I do not
know which wins, and pretending to would be worse than saying so.

### Out of scope, and recorded anyway

| Document · purpose | Why it is here |
|---|---|
| `bank_statement` · financial evidence | Out of scope for the first UK application ([ADR-0021](./decisions/0021-application-requirements-are-not-visa-requirements.md)) — a visa requirement, not a university application requirement |

Recorded as unresolved rather than omitted, so it **blocks** rather than silently missing, and so the
question already exists when a route does require it.

## 4 · One more determination this analysis surfaced

Not a retention question, but it came out of the same reading and it will block sooner:

**DPA 2018 Schedule 1 may require an "appropriate policy document"** for some of the conditions a
controller relies on when processing special-category data. If any of these documents are handled as
special category — a reference mentioning a disability, a medical reason for deferred entry — that
document must exist *before* the processing, and it has its own retention rule.

This belongs with the lawful-basis determinations under
[ADR-0022](./decisions/0022-a-document-in-the-vault-is-not-permission-to-send-it.md), and I have
flagged it there rather than inventing an answer.

## 5 · What happens right now

```
0 of 10 document types could be stored today.
12 questions recorded as unresolved.
```

**No student document can enter the vault.** That is the designed state, not a fault — and
explicitly not something to work around. The vault refuses, the schedule says why, and
`pnpm run retention-status` prints who owns each answer.

The check runs in CI, so a half-configured schedule cannot arrive quietly. A half-configured schedule
is the dangerous state: it looks configured.

## 6 · What I need from you

**One person, named, who will read the sources and decide.** Everything else follows from that.

The most efficient order:

1. **Decide whether "defending a legal claim" is a purpose we rely on.** One legal question that
   moves most of the table.
2. **Ask QA Higher Education what they require us to retain**, while you are asking them about the
   sandbox — it is one extra paragraph in an email you are already sending.
3. **Take advice on the children's-data entries.** Three entries, genuinely conflicting principles,
   and the applicant group where being wrong matters most.
4. Everything else is then a short, well-evidenced set of policy decisions.

Each answer becomes a policy in version 1 of the schedule, superseding version 0, with the source and
the reader's name attached. The system does the rest.
