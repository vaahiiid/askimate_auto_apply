# ADR-0147 — No internal word ever reaches a student's screen

**Status:** Accepted · 2026-09-26 · continues 0060 (the client is not a second source of workflow truth), 0064 (a run waiting on a person does not read as one waiting on the student), 0116 · closes row 92
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-26, after his page read *specialist (running)* while the interview was asking him questions. Built in P227.

## Context

The student's page printed the run's position as the orchestrator's next step and the run's
status, joined: `Your application: {step} ({status})`. ADR-0064 had already taken the two
statuses that wait for a person out of that line, because *interview (escalated)* above an open
composer invited an answer nobody would read. The step kinds it left in. On 2026-09-26 the plan
could not render three maps (a Date the log had turned into a string, ADR-0146), the run's next
step became `specialist` while its status stayed `running`, and the page said so in those words.
He asked whether it was a wrong label or a real state; it was a real state, in a word that names
nothing to the person reading it. His decision:

> *"Decided: no internal word ever reaches a student's screen. Not specialist, not escalated,
> not uncertain. If the run is with a person, it says so in words a person would use. Make it
> structural if the code can express it — a student-facing string that cannot be a state name —
> and tell me if it cannot."*

## Decision

1. **The position line is composed from sentences, never from the run's fields.** A module of
   the client, `words.ts`, holds one sentence per step kind and one per status, in the present
   tense and the student's terms. A status that overrides the step — paused, with a person,
   stopped by the student, done, set aside — says why; `running` defers to the step. The two
   the driver names as waiting for a person and the step that IS a person all read the same:
   *Your application is with a member of the team. I will come back to you.*

2. **Structural, as far as the code can express it.** The tables are typed over the contract's
   closed vocabularies, exhaustively: a step or a status added without a sentence fails the
   build naming the one that has none, and there is no default arm for an internal word to leak
   through. The sentence is a branded string, `StudentWords`, minted in that module and nowhere
   else, and the page's position element accepts nothing else — a raw step or status does not
   type-check against it. A test walks every status against every step and asserts that no
   sentence contains any status, step or phase the contract knows, as written or with its
   underscores read as spaces, so the property is held over the whole table rather than over
   the cases somebody thought of.

3. **What the code cannot express, said plainly.** The type constrains the position line; it
   does not constrain every string the page writes. The transcript is the log's words, the
   refusals are mapped from a closed set (P41), and the position line was the one place a raw
   state was written; a source assertion, weaker than the type and said to be, checks that the
   template literal has not come back. A future element that printed a state name would not be
   caught by the type unless it, too, took `StudentWords`. That is the limit, and the answer to
   *tell me if it cannot*: it can, for the line that leaked, and for any element that is made
   to take the branded type; not for free text written anywhere else.

4. **The page tests waited on state names too.** Six waits looked for *Your application* and
   four for the word *interview* — the internal word itself, as the thing to wait for. They
   wait on the line existing, or on the sentence, now.

5. **The parts of a field are asked for, and played back, by the name a person uses** (added
   in P228, on his message that crossed with the build): *"'What's your home address — line1?',
   '— postalcode?', '— countrycode?', and the playback reading 'line1: …; postalCode: …;
   countryCode: IR'. Those are internal words on a student's screen by the same rule … Every
   field a person is asked for needs the name a person uses — street, town, county, postcode,
   country — and the playback reads as those names."* One table in the profile package,
   `PART_LABELS`, names every part of every field that has parts — fifty-one, across nine
   fields, checked against every question in the interview and not only the three he reached.
   The interview's part specs take their `label` from it at compile time, so a part without a
   name does not build and no question can fall back to a key; the playback reads a value's
   parts through the same table, with a country part shown as the country; the *You said:* line
   of an assembled value names each part the same way; the stop on an exhausted part names it
   by name. The keys stay where they belong — on the log and in the profile's values. The
   limit, again: a nested object with no table of names (the months and years of a visa, the
   components of a test score) reads its own keys as words, and a `kind` part's value —
   *held*, *current*, *ended* — is shown as the word it is.

## What this does not decide

The wording of any one sentence, which is the student's to find wanting and his to change. What
the run *does* when its next step is a person, which is ADR-0007's. Whether a phase name should
ever be shown — none is today, and the test forbids it in the line regardless.
