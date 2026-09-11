# ADR-0102 — Use the refusal the form offers

**Status:** **Accepted** — decided by Vahid, 2026-09-11; built in P86
**Decides:** [blocker 20](../decision-sheet-article-9-fields-a-portal-asks-for.md) — a field the
portal asks for that our own rules forbid us to hold
**Continues:** [ADR-0077](./0077-two-determinations-made-structural.md) ·
[ADR-0059](./0059-the-student-can-read-what-they-are-authorising.md) ·
[ADR-0043](./0043-a-credential-field-is-mapped-to-the-secure-plane-not-to-data.md)
**Amends:** ADR-0077 §"Decision 1" — two channels it left open are closed

## Context

The first real form read by this repository — the University of Sheffield's postgraduate
application, 2026-09-10 — carries an equal-opportunities page: eleven disability checkboxes, a
support-needs box, an ethnic-origin select. Health and ethnic origin are two of the eight
categories UK GDPR Article 9(1) enumerates. ADR-0077 made it structurally impossible for
extraction to *produce* such a field; nothing had said what happens when a portal *asks* for one.

Vahid, 2026-09-11, on reading the dependencies output: *"That is a decision, not a defect, and it
is mine. Do not design around it."* The decision sheet costed five options from the tree. Its
recommendation — leave the fields unmapped and let the student answer at the university — broke
on his next observation: **the empty save is refused.** *"Saving Section G blank returns 'Please
tick the box to say you have no disabilities, or tick a disability'. The page will not advance
unless something is ticked."*

And the form names its own way out. The *Prefer not to say* option's label reads: *"if you go on
to register on a course you will have another opportunity to answer later"*.

## Decision — in Vahid's words

> *"We tick 'Prefer not to say' for disability and 'Information withheld' for ethnic origin. Those
> are not the student's answer and we must never present them as one. They are a stated refusal to
> route Article 9 data through us, made on a form that offers exactly that option and tells the
> student where the real answer belongs."*
>
> *"Three conditions, and I want all three enforced, not noted."*
>
> 1. *"The preview must say plainly what we did and why: that we did not answer these on the
>    student's behalf, what we entered instead, and that the university will ask again directly
>    after registration. If the student reads the preview and cannot tell that a question about
>    their health was left unanswered by us deliberately, the authorisation is not informed."*
> 2. *"The values must be reviewed constants at the mapping boundary with that rationale attached,
>    never sourced from a profile field. No path may exist by which a real answer reaches those
>    controls, whatever the student says in the conversation. Make it the same shape as ADR-0077:
>    refused at mapping, not checked at fill."*
> 3. *"And it must not be silent. If a future portal has no equivalent opt-out, the fill must stop
>    rather than pick something. Write that as the general rule — this decision is 'use the refusal
>    the form offers', not 'answer Article 9 fields with a safe default'."*

Two refinements, after the expressibility of each condition was answered before building:

> *"A form whose opt-out says nothing about asking again: still usable, with that line absent. …
> it must be the form's own words — if a form does not say it, we do not write it. Quote or omit,
> never compose."*
>
> *"An unclassified field: refuse the entry. … If absent means ordinary, one reviewer's omission
> turns a health question into an ordinary field with nothing to notice. 216 fields is a real cost
> and it is a cost paid once, inside a review that has to happen anyway."*

**Correction to the decision's words — Vahid, 2026-09-11, from the live dropdown.** The decision
above says *"Information withheld" for ethnic origin*. The list offers no such entry. His words:

> *"Confirmed from the live dropdown: the option is 'Prefer not to say'. There is no 'Information
> withheld' entry in the list. So the capture was right and I was wrong. I read 'Information
> withheld' from the field's label text and reported it as the option. The label names a choice
> the list does not offer. Record that as a correction to my words in ADR-0102, dated, rather than
> quietly using the right value — the whole point of the quote-or-omit rule is that the form's own
> words and my recollection of them are different things, and this is an instance of exactly
> that."*

So both values are *Prefer not to say*: the disability checkbox `ratherNotSay`, whose own label
carries the later-opportunity sentence and may be quoted; and ethnic-origin option `998`, whose
captured text — label and twenty-two options — carries no equivalent statement, so the preview
prints no such line for it. *"Omit, do not borrow the disability field's sentence."*

## What is built

**1 · A field carries the reviewer's classification.** `BlueprintField.dataCategory` is
`"ordinary" | "special_category"`, optional in the schema because a draft has none, and **set by
the reviewer, never by discovery** — `draftBlueprintFrom` leaves it absent on every field, because
a regex reading a label is not a determination. `checkUsable` refuses a mapping set against a
blueprint with any unclassified field (`unclassified_fields`). Absent is not ordinary.

**2 · One source, for one kind of field: `form_refusal`.** A `ValueSource` beside `constant`, not
inside it — a constant is application metadata; this is a declined question. It carries the
`value` the form offers, a mandatory `rationale`, and an optional `formSays`. `checkUsable`, the
branded gate `planFill` requires, refuses:

| refusal | when |
|---|---|
| `special_category_mismapped` | a special-category field mapped to anything but `form_refusal` — constant, profile field, document, handoff, credential |
| `form_refusal_misused` | `form_refusal` on a field that is not special-category |
| `form_refusal_not_offered` | the value is not among the field's captured options, or the field has no options to refuse with — a text box offers no refusal |
| `form_refusal_composed` | `formSays` is not in the field's captured label or option labels — *quote or omit, never compose* |
| `unclassified_fields` | any field without a category |

**3 · With no refusal, the fill stops.** A special-category field with no `form_refusal` mapped is
a structural plan blocker, `special_category_unhandled`, **required or not** — the rule that an
optional unmapped field is passed over in silence does not apply to it. The orchestrator already
turns a structural blocker into a `specialist` step before any preview is built or any fill
starts; nothing new was needed there. `toStoredPlan` refuses a plan with blockers, so no runner
ever sees it.

**4 · The preview says so, under its own heading.** A refusal is never among the preview's
`entries` — an entry is an answer, and a refusal must never be listed as one. It is in
`refusals`, rendered as:

```
We did not answer these for you:
  Prefer not to say (if you go on to register on a course you will have another opportunity to answer later)
    Not answered on your behalf. Instead we ticked this box.
    Why: <the reviewer's rationale>
    The form says: "if you go on to register on a course you will have another opportunity to answer later"
```

The last line is printed only when `formSays` is present, and `formSays` can only be the form's
own words. The content hash covers each refusal's value, rationale and quoted line, so the
authorisation binds to them (ADR-0059). The builder's switch over value kinds is exhaustive: a
kind added later cannot render as an ordinary answer or vanish.

**5 · Transport, wire and runner carry it as a refusal.** `StoredFillValue`, the contracts'
`TransportedValue` and both conversions (`toWirePlan`, the runner's `toStoredPlan`) gained the
kind; the runner enters it through the constant path — the text the form offers, nothing of the
student's — and the kinds stay distinguishable to the keyboard.

**6 · Two channels ADR-0077 left open, closed while still empty.** *Found, not designed.* ADR-0077
closed extraction plans against special-category fields by typing a plan target as
`OrdinaryFieldKey`. Costing this decision showed two other channels typed by the whole registry:
the `profile_field` mapping and the interview's `ask`. Both are now `OrdinaryFieldKey`, and
`fieldsToCollect`, `missingFields` and `requiredFields` narrow with them. **Measured:** with
`identity.religion` added to the registry and classified `special_category`, a mapping naming it
and an `ask` naming it each fail to compile at the line that names it —
`Type '"identity.religion"' is not assignable to type 'OrdinaryFieldKey'`. The catalogue parser
refuses the same in a file. Vahid: *"I want them closed while they are still empty."*

**7 · A refusal covers the other controls of the same question.** *Found while writing the first
real set, 2026-09-11.* Sheffield's disability question is twelve checkboxes and *Prefer not to
say* is one of them; the rule as built in §3 would have blocked the plan on the other eleven, each
a special-category field with no refusal of its own. So `form_refusal` carries `covers`: the other
controls of the same question, each of which must be in the blueprint, special-category, mapped by
nothing and covered by one refusal only (`form_refusal_cover_invalid` otherwise). They are left
untouched, planned as nothing, and the preview names every one under *Left untouched, as part of
this*, inside the hash. A cover cannot reach an ordinary field, and cannot silence a question that
has no refusal: the text box beside the disability group is covered only because it is part of
that question, and a reviewer who disagrees removes it from the list and the plan blocks on it.

**Also found, and fixed:** P86 declared the refusals as a parameter of the content hash and never
hashed them; its test compared against a preview with no refusals, whose entries differ too, and
so passed. P87's test holds the entries fixed and changes only a refusal's rationale, or a cover,
and the hash now moves with each.

## Where the refusal happens — said plainly

Vahid asked for *"the same shape as ADR-0077: refused at mapping, not checked at fill,"* and
accepted the limit stated before building: **a portal's fields are discovered data, so there is
no compile error to be had for `dyslexia`.** What there is is the branded usable-set check —
`UsableMappingSet` cannot exist for a set that breaks any rule above, `planFill` accepts nothing
else, and `toStoredPlan` refuses a plan with blockers. The refusal is therefore **at review time,
on data, before anything is built on the mapping** — before the preview, before the plan reaches
a runner, and never during a fill. It is the same place ADR-0043 refuses a mismapped password. It
is not a type error, and this record does not let "same shape" imply one. The compile-time wall
exists on the profile side (§6), where the registry is a closed type.

## What this does not decide

- What is special-category. The classification is the reviewer's determination on the reviewed
  entry, against the statute's list quoted in `packages/profile/src/categories.ts`; this record
  applies it only to the Sheffield page's fields, whose labels put them inside it beyond argument.
- A student's own instruction to decline (the sheet's C′). Not needed while the form offers the
  refusal; not built.

## Consequences

- A reviewed entry for Sheffield classifies all 216 fields before it can be used. Paid once.
- The mapping vocabulary's natural reading — *student handoff* — is refused on these fields, so
  the reviewer cannot make the application untransportable by mistake.
- Every future portal that asks an Article 9 question either offers a refusal the reviewer maps,
  or stops the run at a specialist. There is no default.
