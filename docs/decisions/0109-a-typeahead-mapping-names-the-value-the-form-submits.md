# ADR-0109 — A typeahead mapping names the value the form submits; the reviewer records the text; both must match at the fill; the preview shows the text; the escape is named by value and never chosen

**Status:** Accepted · 2026-09-13 · decides the value-versus-text question raised in P101 · continues 0103 (gap 2) and 0057
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-13. Built in P118.

## Context

ADR-0103's gap 2 gave the blueprint a `typeahead`: a box the applicant types into, which offers
entries as they type, one of which is chosen. P95 built it so that a mapping to such a box named
the *text* the entry shows, and the runner typed that text and chose the one entry that read
exactly it. P101 confirmed, from the markup Vahid copied, that each entry also carries a
`data-value` — the value the form submits — and raised, without deciding, whether the mapping
should name that instead. P102 observed the first real form's institution list returning
*Sheffield International College* twice, indistinguishable by text.

On 2026-09-13 he read the institution dropdown with its values (P117): the two identical
entries carry `SCH40484` and `SHE0512`. The same reading appeared to show every value changed
since a copy of two days earlier; he held the decision on that evidence, then settled it by
reading the `<select>` the box fronts, whose option value agreed with the dropdown's: the
earlier copy had been from a different box, mislabelled — *"That is my error and it should be
recorded as mine, not as Sheffield's instability."*

## Decision

In his words:

> *"Take it back off hold. My original reasoning stands and the evidence that undermined it was
> mine, not the portal's. Name the value. The duplicates are SCH40484 and SHE0512,
> distinguishable only by value."*
>
> *"The two conditions from before hold unchanged: the mapping names the value AND the reviewer
> records the text it reads as, and both must match at the fill; and the preview shows the
> student the text, never the code."*

And on the escape, whose value on that form is its own label:

> *"'Not in list' carries its own text as its value, which reads as a weaker escape than a code
> — check what that does to the guard, since a value equal to its own label is not the clean
> sentinel 9004 would have been."*

## What is built

- **The blueprint records the entries and the escape.** A typeahead field carries `options` —
  value: what the form submits; label: what the entry shows — recorded by the reviewer from the
  page, partial as a country map is partial. `typeahead.escapeValue` names the form's escape by
  its value.
- **The usable-set check requires the value to be one the reviewer recorded, and never the
  escape.** A mapped typeahead with no entries is refused. A constant must be an entry's value;
  a profile field must reach the box through an option rule (directly or under `part`) whose
  every target is an entry's value; free text is refused — *"free text is never the value a
  typeahead submits"*. Any named value equal to the escape is refused as *"the form's escape,
  not an answer"*. The guard compares values, so an escape whose value is its own label is
  refused exactly as a coded one would be.
- **The plan names the value and carries the text.** An instruction to a typeahead names the
  value, and its `typeahead` block carries the text the reviewer recorded for it and the
  escape's value; both cross the wire to the runner unchanged.
- **The runner requires both.** It types the text, waits a bounded time for the ONE entry that
  reads exactly that text AND carries the value, and chooses it. The value alone finds nothing;
  the text alone finds nothing; two entries that read the same are told apart by value. The
  escape is refused by value before anything is typed, whatever it reads as, for a confirmed
  value and a reviewed constant alike. P102's open case — an entry that is the form's escape
  chosen when the text names it — is closed.
- **The preview shows the text.** It already showed a value's label for any field with
  options; a typeahead with entries now has one. The hash binds the value; the reviewer's text
  is bound through the blueprint the catalogue hashes (ADR-0057).

## Consequences

- A mapping to a typeahead is the same shape as a mapping to a select: a reviewer-recorded
  option list, exact values, nothing approximated, the student shown the words.
- The fixture portal's course search, the runner's fixture form and the first real form's
  institution box all carry entries with values and an escape whose value is its own label; the
  Sheffield draft names the institution box's eleven entries from his reading and its escape.
- A value that moves on the portal's side breaks a mapping pinned to it — the risk he weighed.
  The evidence for it was his own mislabelled copy; the day-later read on the `<select>` that
  the form posts stands as the test of drift, and nothing built assumes the answer.
- Nothing here touches the transmission gate, the authorisation content hash's construction,
  or the mandatory-review categories.

## What was deliberately not done

- No matching on the value alone, and no matching on the text alone: his condition is both.
- No heuristic for the escape's wording: it is named by value on the blueprint, by the
  reviewer, or it is not an escape the system knows.
- No mapping to either Sheffield box is signed: the institution box's entries are recorded so
  that one can be; the country box's are the captured `<select>`'s, still to be recorded on the
  box itself when a mapping is authored.

## Amended — 2026-09-21: the evidence that removed the doubt was wrong

**The decision above stands unchanged.** A typeahead mapping names the value, the reviewer records
the text, both must match at the fill, and the preview shows the student the words. That is his and
he has not revisited it.

What is withdrawn is the *Context*'s account of why the doubt went away. It says the earlier copy —
the one showing `0159` for *University of Sheffield* — "had been from a different box, mislabelled".
On 2026-09-21 Vahid re-read that copy:

> the markup in that copy was `id="institution-ts-dropdown"` with entries `institution-opt-1` to
> `-11`, which is the institution box, not a different one — so the `0159` / `SHEFFIELD`
> disagreement is real, and it is still unresolved.

So: the copy is of this box, taken on 2026-09-11 (the screenshot with it is named
`2026-09-11_at_21_35_55`; he had said the 14th in passing and corrected it himself). Two reads of the
same box, two days apart, same country and same typed text, identical labels in identical order, and
**every value different**.

### What that changes

- The consequence recorded below — *"A value that moves on the portal's side breaks a mapping
  pinned to it — the risk he weighed. The evidence for it was his own mislabelled copy"* — is
  **wrong in its second sentence**. The evidence was a real read of the real box, and the risk is
  therefore **observed on this portal, not merely conceivable**. It is open.
- The mitigation named there still stands and is the right one: the `<select>` the form posts is
  what a drift test reads. It has been read once, on 2026-09-13, and it agreed with `SHEFFIELD`.
  One agreement two days after one disagreement does not close the question.
- Nothing about the fill changes. The runner requires the text and the value, and a value the list
  no longer carries is a loud refusal rather than a wrong choice — which is precisely the behaviour
  that makes an unstable value safe to discover rather than dangerous to rely on.

### Why it did not cost a signature on 2026-09-21

Attempt 5's failure was **not** this. The box answered with an empty list and the runner's line now
says why: the page's own lookup came back with nothing in it. The value question was never reached.
Recorded as blocker 49's second half, and open.
