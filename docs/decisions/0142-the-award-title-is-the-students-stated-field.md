# ADR-0142 — The award title is the student's stated field, and a level never determines it

**Status:** Accepted · 2026-09-25 · closes blocker 71 · continues 0112 (a qualification has dates) and 0113 (a list is collected entry by entry)
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-25, on raising blocker 71: *"Say in the blocker what the registry needs — the award title as its own field, stated by the student, distinct from level."* Built in P213 as item 3 of the list to `ready_to_submit`.

## Context

Sheffield's education page asks for the *Qualification* as an award title — BA, BEd, BEng, BSc,
MSc, one of forty-one — and the registry held a qualification's **level** (`Bachelor's degree`).
From P148 the `degree` mapping read the level and wrote a title: `Bachelor's degree → BSc`. It
rendered, the plan succeeded, the validator passed, the preview built, and Run A passed through
it because Run A's qualification happened to be a BSc. Every student holding a BA would have been
told to a university as holding a BSc, silently (blocker 71, P208). P209 made the map refuse with
its own words rather than guess, at his instruction, and wrote the path out into the blocker.

## Decision

1. **`Qualification.awardTitle`** is a part of its own in the registry: the title as printed on
   the certificate, **stated by the student** in the interview, never derived from `level`,
   `subject` or anything else. It is optional, because a qualification may carry no title — a
   school certificate — and an absent title claims nothing.
2. **A portal's title box reads that part and nothing else.** The Sheffield `degree` mapping is
   `part awardTitle → option`, keyed on the label the select prints and mapped to the value the
   form submits (nine of the forty-one differ). A title the list does not carry — *Bachelor of
   Science*, *BSc (Hons)* — refuses with `no_matching_option` and is asked about, never matched
   to the nearest; a qualification with no title stated refuses with `no_such_part`. The escape
   the form offers (*Not in list*) is the student's own act and is never chosen by a map.
3. **`level` keeps its own uses.** `gradingSystemId` reads it, and reads it correctly: Sheffield's
   grading systems are a level-and-country vocabulary, not a title one.

## Consequences

- The interview's qualification walk (ADR-0113) asks for the title as its own part, after the
  level: *"the title as printed on your certificate — BSc, BA, BEng, MSc — or none."* Free text,
  trimmed; the portal's list constrains it at the mapping, not at the question, because the
  registry is portal-free.
- The synthetic profile states `BSc` — what Run A typed on his account and he checked on
  `summary.do` — so the page-by-page read is a page of values again, and `degree` is typed from
  what the fixture states rather than what a map derived.
- The entry's hash moved (`sha256:55759f10…`, mapping set 0.3.37) and is **unsigned** until item 6
  of the list, at his instruction: *"batch it — I would rather sign once at the end of a working
  path than seven times along it."* The directory refuses to load until then, and the test
  asserts the refusal.
- Nothing is derived. The rule this repeats: *a value the student did not state is never
  supplied by us.*
