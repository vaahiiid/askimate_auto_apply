# ADR-0123 — A star is not a requirement: the validator reads the section fact the plan reads; a step that cannot ask for what it needs stops for a person and says so

**Status:** Accepted · 2026-09-17 · amends [ADR-0119](./0119-a-box-handed-to-the-student-is-their-own-act-and-the-record-has-three-states.md) (the section fact, P147: now read by the validator too) · extends [ADR-0065](./0065-a-run-only-a-person-can-carry-on-stops-and-says-so.md) (the stop, to `fix_content`) · closes blockers 34 and 35 · found by Run A
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-17. **Built in P156**, the same day; see *Built* below.

## Context — Run A found it before a student did

Run A's step 3, 2026-09-17. Vahid requested the signed Sheffield entry on his own account and the
page read `Your application: fix content (running)` — no question, no message, no intervention,
no log line, and a Stop button. Reproduced here on the signed entry with the repository's
synthetic profile: the plan had no blockers, and the validator had **eighteen violations**,
every one *"required and the plan has nothing for it"*, every one a starred box in the
English-language section.

Two of our own records disagreed about one page and nothing compared them until a run stopped.
The plan had read the section's `optional` fact since P147 (ADR-0119), so it planned nothing for
those boxes and the read he signed over said *"Left empty … the form does not require them"*.
The validator read the marks alone. And the validator had never run on the signed entry with its
profile: the P150 test checked the plan's blockers and nothing more, so the run was the first
thing to run `validatePlan` on it. That is the whole argument for Run A existing, and it is
recorded as such.

## Decision 1 — the star is not the evidence; the save is

In his words:

> *"The eighteen are not required, and we have observed it rather than inferred it. On 16
> September I opened language.app fresh, touched nothing at all, pressed Save, and it saved. No
> error. The summary then read 'First Language: Not entered / Previously Educated in English: Not
> entered / Previous Education Language: Not entered' under the portal's own sentence."*
>
> *"The star is not the evidence. The save is. This is the same finding as 'an error-free save is
> not a save', pointing the other way: a star is not a requirement either. On this portal a star
> means at least four things now, and one of them is nothing."*
>
> *"So: the section-level optional fact you built in P147 is right and should govern. If the
> validator is not reading it, that is the defect — not the marks and not the mapping. Make the
> validator read what the blueprint already says about that section, the same fact the plan
> already reads, and leave the eighteen marks untouched."*

So the validator reads `optionalSectionWords`, the same function the plan reads, and a
`required` marker inside a section the portal says may be skipped raises no violation. The marks
stay: a star was seen, and erasing it would be asserting the page had none. No draft changed, so
the signed entry's hash is unchanged and **no re-sign is needed** — he accepted one, and it is
not owed.

**Two records read different things about one fact.** Said plainly, as he asked: the plan and
the validator were two readings of one page; this is the third time two of our own records
disagreed about one fact (the preview and the page walk, P72 to P152; the read and the marks,
here) and nothing compared them until a run stopped. The Run A profile test now runs the
validator on the signed entry, so the two are compared before any run.

## Decision 2 — a step that cannot ask for what it needs stops for a person and says so

> *"Blocker 35 is the more serious finding and I want it treated that way. A position with no
> question, no intervention, no log line and no way out is worse than any of the three loops we
> have fixed, because at least those did something. Whatever the validator decides, a step that
> cannot ask for what it needs must stop for a person and say so. Build that too."*

`fix_content` was meant to go back to the student through the interview. But the interview asks
for profile fields, a violation names a portal box, no mapping is consulted, and
`interviewActionOf` answers `null` for it — so every `fix_content` was a dead end, re-derived by
the Worker every tick. Now the orchestrator carries a second narrowing beside
`specialistHandoverOf`: `contentHandoverOf`, which turns a `fix_content` step into a hand-over
naming each box, its rule and the rule's bound, and never a value (a `pattern` violation's own
text quotes what the student typed, and that must not reach an intervention). The driver's
ADR-0065 stop takes either narrowing: an intervention `specialist:content_rejected`, the run
`escalated`, the student told once that the form would not accept something as planned, that it
is not something they can be asked to change from here, and that a person will look. One
mechanism, one home for "this run cannot go on until a person looks".

Until the interview can ask for a fix, every `fix_content` stops this way. That is the honest
position: a stop that says so beats a loop that says nothing.

## Built — P156, 2026-09-17

Tests first, red — the validator on a starred box inside a skippable section; the Run A entry
under `validatePlan`; `contentHandoverOf`; the driver on a statement over the fixture's limit —
then:

- `packages/preparation/validate.ts`: `skippable` in the field context, from
  `optionalSectionWords(blueprint)`; a `required` rule inside such a section is satisfied.
- `scripts/run-a-profile.test.ts`: the signed entry's plan validates with no violation and no
  unknown field, for the synthetic profile. Red first with eighteen.
- `packages/orchestrator`: `contentHandoverOf(step)`, exported; the detail names label, ref,
  rule kind, bound and source, and no value.
- `apps/conversation-service` run driver: `#stopForSpecialist` takes `specialistHandoverOf(step)
  ?? contentHandoverOf(step)`; `contentRejectedMessage` for the student.
- Tests: preparation (the mark alone still a violation; the mark inside the section not);
  orchestrator (reason, detail, no value; null otherwise); the driver on real Postgres (escalated
  at `start`, the intervention keyed `specialist:content_rejected`, the student told once, a second
  advance says nothing more and asks nothing).

## Consequences

- Run A resumes from the same conversation: the Worker re-derives the step, the validator now
  passes the entry, and the run moves on to the account declaration and the authorisation. The
  read he signed over is unchanged.
- Every portal: a required box the mapping set does not cover stops the run for a person with the
  box named, instead of stranding it silently.
- The validator's other readings of a page — hidden by condition, handed to the student, filled
  by the Secure Plane, set by an attach — were already shared with the plan. This was the one
  fact read by one and not the other.
