# ADR-0117 — The passport is one value, held or stated as none; a portal's words for the absence live in the reviewed mapping, never in the profile

**Status:** Accepted · 2026-09-15 · decides distance item 3's group 4 · continues 0111 and 0112 (absence as a statement, in one place) and 0115 (the nationality page's groups)
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-15, on the passport row's words read off his committed `nationality.do` markup (`docs/captures/sheffield-pgt-2026-09-15-passport-row/`). **Built in P141**, the same day.

## Context

Sheffield's nationality page asks for the passport number in a starred row: *"Please enter your
passport number below. This is required in order to comply with UK immigration law."* Its
tooltip says what a student without a passport should do: *"Enter your passport number if
possible. If you don't have a passport please enter 'no passport' in the box."* The registry held
the passport as three separate values — number, expiry, issuing country — so a student with no
passport had three unavailable values that blocked a fill and nothing anywhere saying why. The
item 3 sheet put two options to him: (A) fold the three into one value with a `none` kind, the
mapping typing the portal's own words for it; (B) give only the number the kind.

## Decision

In his words:

> *"Group 4: A."*
>
> *"Absence as a statement in one place is the same shape as a job's end and a qualification's
> end, and this is the third time the same problem has arrived: a student who does not have a
> thing has three empty values and nothing anywhere saying why. Fold them."*
>
> *"The portal's words living in the reviewed mapping and never in the profile is the important
> half. 'no passport' is Sheffield's instruction, not a fact about the student, and a portal that
> says something else gets its own words. Make sure the ADR says that, because the tempting
> shortcut is to store the string once and reuse it everywhere."*
>
> *"B keeps the defect and calls it smaller. It is not smaller for the student it happens to."*

So:

1. **One value.** `identity.passport` is `{ kind: "held"; number; expiry; issuingCountry? }` or
   `{ kind: "none" }`. The three fields it replaces are gone. `none` is the student's statement,
   as a job's `current` end and a qualification's `discontinued` end are.
2. **The portal's words are the mapping's, never the profile's.** A mapping types what a portal
   asks for when the student has stated an absence through the `part` rule's new clause,
   `absent: { typed: "…" }`, with the words quoted from the page into the reviewed set. The
   string `no passport` is stored nowhere in the profile, the domain or the code: it is
   Sheffield's instruction, and another portal's instruction is that portal's mapping. **The
   shortcut is refused by construction:** the profile has no field that could hold it, and the
   rule takes the words from the mapping it is written in.
3. **A passport read off a passport is always `held`.** The extraction plan assembles the one
   value from its parts; `none` is a statement only the student makes, never a document.

## Consequences

- The extraction plan's three passport scalars become one composite with a required number and
  expiry and an optional issuing country; a passport missing its expiry is not read at all,
  rather than read with a made-up one.
- Every consumer of the three old keys moves to the one value. The interview does not ask for a
  passport today (ADR-0113's coverage); when it does, it asks *held or none* and then the parts.
- Set 0.3.24 maps `passportNumber`: the held number through `part → number`, and for `none` the
  quoted instruction. The plan's `no_mapping` blockers fall to twenty-seven.

## Built — P141, 2026-09-15

- `packages/profile`: `Passport`; `identity.passport` in place of the three keys, ordinary,
  labelled *Passport*.
- `packages/profile` `format.ts` and `packages/catalogue` `parse.ts`: `absent: "leave_empty" |
  { typed }`; an empty typed text is refused by the parser as `leave_empty` wearing a costume.
  Tested: the number for a held passport, the quoted words for `none`, another portal's words
  from its own rule, and a refusal without the clause.
- `packages/extraction`: the passport plan's composite; the fixture passport reads as one held
  value with its issuing country; the passport missing its expiry is reported as the one
  missing field.
- Set 0.3.24 and `scripts/sheffield-draft.test.ts`: `no passport` typed for a stated none, the
  number for a held one; nothing else on the page changed.
