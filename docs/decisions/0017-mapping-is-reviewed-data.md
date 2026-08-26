# ADR-0017 — Field mapping is reviewed data, and format rules are data too

**Status:** **Accepted** — 2026-08-26
**Implements:** brief §3.1 (the AI is never the source of a form field value), §5 (field mapping)
**Depends on:** [ADR-0004](./0004-branded-types-for-confirmed-values.md)

## What this decides

Three things, all in service of one question: **how does a confirmed profile value become the exact
string typed into a university form field, without anything being invented on the way?**

## 1. A mapping set is reviewed data, pinned to a blueprint version

A mapping says *"the student's date of birth goes in field `dob`, written `DD/MM/YYYY`"*. That is a
decision about where real student data goes, so:

- it is **authored by a specialist and reviewed by a second person** — a set reviewed by its own
  author is refused, because that is a draft with a signature on it;
- it is **pinned to a blueprint id and version**, and a mismatch refuses.

The pin matters more than it looks. If the portal changes and a new blueprint renumbers its fields,
the old mapping is not merely stale — it is a set of confident instructions to type a real
applicant's data into the wrong boxes. Field references are only meaningful within the version they
were checked against.

`planFill` takes a `UsableMappingSet`, obtainable only from `checkUsable`. So "was this reviewed?"
is answered by the function signature rather than by a check someone has to remember to call.

## 2. Format rules are data, not functions

The obvious way to render a `Date` into `02/04/1999` is a formatter callback:

```ts
renderConfirmed(dateOfBirth, (value) => format(value))
```

That has a hole big enough to drive the whole system through, because a closure can ignore its
argument:

```ts
renderConfirmed(dateOfBirth, () => whateverTheModelSaid)   // compiles
```

which produces a `ConfirmedValue<string>` carrying a real student's provenance and a value they
never confirmed — precisely what ADR-0004 exists to prevent.

So there is **no formatter parameter**. `FormatRule` is a closed union of data — `{ kind: "date",
pattern: "DD/MM/YYYY" }` — interpreted inside the profile package, and the only strings it can
produce are derived from the confirmed value itself. A reviewer reads a rule instead of reasoning
about a function.

`renderConfirmed` is the **second** sanctioned construction of a `ConfirmedValue`, and it is not a
second way to *create* confirmed data: it takes one in, carries its provenance through untouched,
and cannot be reached with anything else. The same fact, written the way this portal writes it.

## 3. A dropdown option is never approximated

A student's confirmed nationality is `Iranian`. The portal's dropdown offers `Iran (Islamic
Republic of)`. A person can see those are the same country.

**The system does not.** An unmapped option is refused, the field is left blank, and the case
blocks. Fuzzy-matching here is software deciding what a student's nationality is, which is the exact
thing brief §3.1 forbids — and the failure would be invisible, because the wrong answer would look
entirely reasonable in the preview.

## Reviewed constants — the honest weak point

Some fields are not the student's data: a course code, an intake term. Someone has to supply those,
and that someone is a human, which is a human typing a value into a university application.

There is no compile-time wall available. *"This string is course metadata and not a student's
personal data"* is a fact about the world, and no type decides it. So the controls are procedural,
and the type's job is to make them **unskippable and conspicuous**:

- a constant must be classified `application_metadata` and carry a mandatory rationale;
- `ReviewedConstant` is branded and constructible only from a `UsableMappingSet` — so it cannot
  exist without a second person's review;
- it travels through the plan as its **own variant**, never disguised as student data.

That last point was a real decision. The tempting shortcut is to give a constant a fabricated
`ConfirmedValue` with `student_entered` provenance, so everything downstream has one type to handle.
That would put a record in the audit trail saying a student confirmed something they have never
seen — a lie, told for the convenience of the code that reads it. A union is a small price.

## Consequences

- A **fill plan is computed entirely before a browser opens.** Every blocker is known in advance
  rather than discovered halfway through a live form, and the plan can be previewed, diffed and
  authorised. A sequence of live keystrokes cannot be.
- `fieldsToCollect(plan)` gives the interview its worklist: exactly which canonical fields to ask
  about, derived from the portal's real requirements rather than from a static list.
- An **optional** unmapped field is not a gap. Leaving it blank is correct behaviour.
- The mapping package is forbidden from importing the model port at all — not merely a model SDK.
  Mapping must have no way to ask a model, since asking is the failure.
