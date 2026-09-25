# ADR-0143 — Funding is a closed vocabulary, and "do you know?" is the student's own statement

**Status:** Accepted · 2026-09-25 · continues 0115 (claims are asked, never derived), 0141 (a reviewed table, and anything not in it is refused) and 0142
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-25, on reading Sheffield's Part 2 funding boxes against the registry. Built in P216 as part of item 5 of the list to `ready_to_submit`.

## Context

Sheffield's taught-course page asks six things about money: *Do you know how you want to fund
your studies?* (a yes-or-no, mandatory), a likely funding source (five general options and
twenty-two named scholarships and schemes), free-text details, and the stage the funding is at (five
sentences, mandatory). The registry held `finance.funding_source` as free text (*"who is paying,
e.g. self-funded, family, an employer, a government scholarship"*), `finance.sponsor_name` and
`finance.available_funds`. Read box by box in P215: one answerable from what was held, one only
as *Yes* by a derivation his rule refuses, two not held.

## Decision

In his words:

> *"The source select offers 33 options — five general and 28 named scholarships. So the registry
> gains a CLOSED funding-source vocabulary, the shape nationality took, and per-portal maps like
> the countries. Not free text.*
>
> *There is NO "I don't know" in the source list. The uncertainty lives in the radio above it —
> "Do you know how you want to fund your studies?" Yes or No … So: no invented "don't know"
> option. The registry holds the answer to that question as the student's own, asked directly,
> never derived from whether a source happens to be held.*
>
> *Funding stage gets its own field and its own question. The page offers five … That last one is
> where a student who is unsure goes honestly, and it should be reachable — a student who has not
> sorted their funding is the normal case, not an edge."*

(The list as read holds thirty-two options: two placeholders, the five general sources, twenty-two
named scholarships and schemes, and three loans. His "28 named" is his count from the page; the
entry's map is built from the read list, twenty-five named.)

So:

1. **`finance.funding`** replaces `finance.funding_source` and `finance.sponsor_name`: one
   composite with `known` (the student's own yes or no), `source` (a closed vocabulary:
   `self_or_family`, `employer`, `sponsor`, `scholarship`, `loan`, `other`), `stage` (`confirmed`,
   `project_studentship`, `applied`, `applying`, `considering`) and optional `details` (the
   sponsor's, scholarship's or employer's name). `source`, `stage` and `details` are asked only of
   a student who answered *yes*; a student who answered *no* holds `{ known: false }`, which is
   complete. `finance.available_funds` is unchanged.
2. **Nothing is derived.** `known` is never read off a source being held. The stage is asked, not
   inferred from a date or a sponsor.
3. **A portal's list is mapped from the vocabulary, per portal**, like the countries. Sheffield's
   map names the four general options the vocabulary can honestly name — self or family, employer,
   sponsor, other. `scholarship` and `loan` have no row: the list names twenty-two scholarships and schemes
   and three loans, and choosing *"not listed below"* or one loan for a student whose scholarship or
   loan is not known would be a claim. That needs a second key — the name — which the format
   language cannot express (blocker 85); such a student refuses loudly and is asked about.
4. **Financial evidence stays a mandatory review.** `finance.funding` is in `FINANCIAL_FIELDS`, so
   the gate that fires on financial evidence fires on it; a test holds that the reshaping did not
   weaken it.

## Consequences

- Two fields removed and one added; the interview walks the composite part by part (ADR-0140);
  the synthetic profile states a funding intent chosen to match it (self or family, confirmed).
- Sheffield's `fundingSourceKnown` radios carry `value=""` in the markup, so the runner chooses a
  radio group whose members all carry an empty value by its `<label for>` text, exactly, and only
  then (P216). What the form submits for each is unread.
- The page hides the source, stage and details rows for *No* by a script the read did not capture.
  The maps leave those boxes empty for a student who does not know; if the page does not hide the
  mandatory stage box, that student meets a validator violation rather than a silent sit (blocker
  86).
