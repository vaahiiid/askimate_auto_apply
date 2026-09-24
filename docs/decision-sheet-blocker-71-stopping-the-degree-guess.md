# Decision sheet — blocker 71: stopping the `degree` guess today

**Raised:** 2026-09-25 (P208). **Status:** costs and a measurement. **Nothing is built.**
**Vahid's instinct, which this sheet tests rather than argues with:**

> *"A map that cannot be right should refuse rather than guess: if level is all we hold, degree has
> no honest mapping, so it should render nothing and stop for a person — the loud answer the absent
> countries now get. That costs a stop on every education page until the registry carries the
> title, which is a real cost and I will take it over telling a university something untrue."*

**The answer is: yes, it is buildable, and the cheapest form of it needs no code at all.** What it
breaks is listed in §3, and one thing about the refusal's *wording* needs a small change or the
stop tells the next person to re-create the bug (§4).

---

## §1 · What happens today, measured on the signed entry

```
──── TODAY — the two rows ────
  plan blockers: 0
  degree instruction: BSc
  validator violations: 0
  preview: built
```

Nothing refuses. The student authorises `BSc`, the runner types `BSc`, the page saves, the
read-back sees `BSc`. For a student holding a BA, every one of those steps succeeds and every one
of them is wrong.

## §2 · What happens if the map is emptied — measured, same script, same entry

Emptying `degree`'s `options` to `{}` and changing nothing else:

```
──── EMPTIED — options {} ────
  plan blockers: 1
    kind=render_refused  field=degree
      detail: "Bachelor's degree" is not one of this field's options…
  degree instruction: — none —
  validator violations: 1
    {"fieldRef":"degree","label":"Qualification:","rule":{"kind":"required",
     "source":"observed_marker"},"detail":"\"Qualification:\" is required and the
     plan has nothing for it."}
  preview: REFUSED plan_incomplete
```

**Three independent stops, none of which needed a line of code:**

1. **`planFill`** produces one `render_refused` on `degree`. That is a *structural* blocker, so
   `nextStep` takes the branch above the interview's and answers `specialist` — the same path a
   country in the absent column takes (P204), which the run driver turns into a durable
   intervention, an `escalated` run, and one message to the student (ADR-0065).
2. **`validatePlan`** reports the field as required-and-missing, from the portal's own observed
   marker. An independent second reading of the same page.
3. **`buildPreview`** refuses `plan_incomplete`, so **the run cannot reach the authorisation at
   all.** The student is never shown a yes to give.

Nothing is typed, nothing is sent, and the stop happens three steps before anything could be.

**So the honest summary of his instinct: it already works.** The machinery to refuse rather than
guess exists and is exercised; `degree` simply is not using it, because it holds two rows that
render.

## §3 · What it breaks

| | |
|---|---|
| **The entry's hash moves** | Another signature. The content change is two rows deleted from one map. |
| **`run-a-profile.test.ts`** | The P150 plan test asserts `plan.blockers` is `[]` and `degree#0` is `BSc`. Both become false — **correctly**, and the test should be rewritten carrying the reversal, not deleted. |
| **`sheffield-draft.test.ts`** | Two assertions: `valueOf("degree") === "BSc"` and a per-item `[[0,"BSc"],[1,"MSc"]]`. Same treatment. |
| **`docs/run-a/what-will-be-typed.md`** | The committed read changes: the qualification line goes, and the page gains a refusal. Regenerated, not hand-edited. |
| **The Run A story** | `what-will-be-typed.md` stops being a complete page. That is the point, and §3 of `what-run-a-proved.md` now says so. |
| **Nothing in production** | No deployable reads this entry. The journey and the demonstrations run against the fixture portal, whose own `degree` is a different map. Checked: the only `BSc` references outside the two test files are the fixture portal's own entries and a `format.test.ts` fixture, neither of which reads the Sheffield entry. |

**What it does NOT break:** the runner, the driver, the preview, the validator, the intervention
path, the census, or any other entry. The stop uses machinery that is already exercised by dozens
of tests.

**The real cost, stated as he stated it:** every education page stops until the registry carries an
award title. That is not a partial degradation — Run A's own profile would stop too, because the
map would hold nothing for `Bachelor's degree` either. There is no "stop only for the students it
would get wrong", because the system cannot tell which those are: that is the whole finding.

## §4 · One thing that must change with it, or the stop teaches the wrong lesson

The refusal that fires is the generic option-map one:

> *"Bachelor's degree" is not one of this field's options. The system will not choose the closest
> one — **a specialist maps it, or the student is asked.***

For `degree` **both halves of that sentence are false**. A specialist cannot map it — no map from
level to award title can be right — and the student cannot be asked, because the interview has no
question for an award title and the registry has nowhere to put the answer. Leaving this wording
in place tells the next person to fix it by adding rows, which is the bug.

It is the same defect blocker 66 already names for countries (*"the words are wrong"*), arriving on
a second field for a second reason.

**Two shapes, costed:**

- **(i) Empty the map, leave the wording.** Zero code, one signature. Stops the false statement
  today. **Risk:** the entry then holds an `option` rule with no options, which reads as an
  *unfinished* map, and the refusal explicitly invites someone to finish it. This is how the bug
  comes back.
- **(ii) Empty the map and give the refusal its own words.** A new format rule — `{ kind:
  "not_derivable", reason }` — that always refuses, carrying the reason into the blocker's detail:
  *"a level does not determine an award title; this needs the student's award as awarded, which the
  registry does not hold (blocker 71)."* Roughly **half a day**: one rule kind, its refusal, the
  parser, and tests. It cannot be mistaken for unfinished, and it makes the intent structural
  rather than an absence.

**I would take (ii)**, and the reason is this session's own evidence: an absence is not
self-explanatory, and the last three findings in this repository were all cases where something
looked finished or looked calm. But (i) is available **today** and (ii) can follow, because both
produce the identical stop — the difference is only what the next person reads.

**If (i) first, then (ii):** two signatures rather than one, since each moves the hash. Worth saying
so the choice is made with the cost visible.

## §5 · What is NOT proposed

- Widening `degree` to 42 rows. That is 42 rows of the same mistake.
- Removing the mapping entirely. An unmapped required field is a *quieter* failure than a refusing
  one — the plan simply has nothing for it, and the loudness depends on the validator alone.
- Touching the other five partial maps. They refuse already; this one does not.
