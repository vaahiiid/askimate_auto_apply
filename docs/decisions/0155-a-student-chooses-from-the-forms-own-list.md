# ADR-0155 — A student chooses from the form's own list, the form's escape among the choices

**Status:** Accepted · 2026-10-05 · the shape from the message of 15:02 UTC, which speaks of Vahid in the third person; the escape and the single build decided by Vahid in his own words, 15:52 UTC · amends ADR-0109 · built in P290

## Why this exists

Until P290, when a student's value was not among the entries a portal's list was read to hold, the
run stopped for a person and said so: *"If yours is on their list under another name, which one it
is is yours to say, and I will not choose it for you. There is not yet a way to make that choice
here."* His own run stopped there on three values (the doctorate's institution, award title and
subject; the Master's subject; and the grading rule that follows the institution).

The message of 2026-10-05, 15:02 UTC, speaks of Vahid in the third person (*"The shape Vahid and I
agree on"*), so its words are recorded here as that message's, not as his:

> *"When a value is not among the entries read, the student is shown what the portal's list does
> hold and chooses. The options are the entries the search returned, plus the form's own escape
> where it has one. Whatever they pick is their answer, recorded as theirs, and the run carries on
> with it."*

> *"The system never pre-selects, never orders by similarity, and never says "did you mean". The
> entries are shown as the portal returned them. If the student picks one that is not literally
> their institution's name, that is their statement about their own education — the same standing
> as typing it into the escape box."*

> *"The escape is always offered alongside, not as a last resort after they have been shown
> near-misses. A student whose subject genuinely is not on the list should not have to scroll past
> five approximations to find "none of these"."*

> *"And what they pick is stored as their own words, with the portal's entry recorded beside it. If
> they later ask what their application says, the answer is what they chose, not what the form
> submitted."*

And Vahid's own words, 15:52 UTC (*"Both decisions, in my own words"*):

> *"ADR-0109 is amended: the runner may choose the form's escape entry when, and only when, the
> student has chosen it. Never otherwise, and never as a fallback when nothing matches. The record
> of that choice is what permits the press, so a run with no recorded choice refuses the escape
> exactly as it does today."*

> *"One build, not two phases. Nine hours, stop at eighteen."*

## Decision

### 1. What is offered: what the form holds for the value, as the entry records it

An offer is derived each time from the plan and the signed entry. It is never stored, and nothing
in it is guessed. It is made for a value the plan refused (`no_matching_option`, or
`no_matching_case` for a list keyed on another part), on a field whose escape is on record, and
only from a list someone read:

- **A searched list** (a typeahead, or a select a press fills) offers what a search RETURNED. The
  blueprint records each search as `searches: [{ word, entries }]`. The one search offered is the
  one whose word is in the student's own words. If no search word is in their words, or two are,
  nothing is offered and a person looks, as before.
- **A list the form loads after an earlier box** is read for that box's value
  (`listsAfter: [{ fieldRef, value, entries }]`). It is offered only once the plan sets that box,
  which may be after the student's own choice there (the grading list after the institution's
  escape).
- **A list the form shows whole** offers every entry.

The entries are in the order the form returned them: never ranked, never filtered by likeness.
Placeholders and the escape are not among them. The escape is offered beside them: first, apart,
and at the same weight on the page. A field with no escape on record is not offered at all, so a
student is never shown a list with no honest answer if none of it is theirs.

`searches` and `listsAfter` are read by the catalogue's parser. Every entry must be one of the
field's own options and never its escape.

### 2. One at a time, in the plan's order, before any person

In `#stopForSpecialist`, before raising an intervention, the first refusal that can be offered is
put to the student instead. The message is said once however often the worker re-derives the step,
and the run stays `running`. One at a time, because an answer to one can change the next.
Refusals no offer can settle go to a person exactly as before, and the stop's sentences are
unchanged.

A run already with a person reaches the offer through the person's resolution (row 135's re-plan).
That resolution says one thing: *"Someone on the team has looked at your … application."*, followed
by the offer.

### 3. What the student reads, and what each sentence promises

The offer says what the list does not hold, in the student's words, and where the entries came from
(*"Searched for "…", it offers the N entries below, in its own order."*). Then: *"If one of them is
yours, choose it. If none is, choose "Not in list": that is the form's own option for exactly
this"*. Where the escape opens a box the mapping fills with the student's own words, it adds *"and
I will type your own words, "…", into the box it opens"*. The words quoted there are read from the
plan the run would build with that choice, not assumed. It ends: *"Whichever you choose is your
answer and is recorded as yours. I will not choose for you, and nothing is chosen until you press
one."* Each promise is held by a test: the box filled with those words, and typed words recording
nothing.

While an offer stands, the page's position line says the choice is the student's
(`CHOOSING_LINE`), never that a person has it.

### 4. The press, recorded with the application

`choose_entry` carries the offer's hash and the id of an entry or of the escape. The driver
derives the offer again. A different hash is refused as `content_changed`, an id the offer does not
hold as `refused`, and a press with nothing open as `not_asked`. The choice is recorded in
`entry_choices` (migration 0039) with:

- the student's words beside the entry's value and label;
- whether it is the escape;
- the search word, where there was one;
- the offer's hash.

One choice stands per (case, field, entry of a repeating page, the student's words). Typed words
choose nothing.

The student's words stay in the profile untouched. The choice is about **this** application's form.

### 5. The plan, the preview and the runner

- `planFill` takes the recorded choices. A refused value with a choice becomes a `chosen` value
  (the entry's value, its label, the student's words, the escape flag), never a confirmed one.
- A search box takes the search word the student's choice came from.
- A typeahead types that word and carries `chosenByStudent`.
- The preview shows a chosen entry as the student's choice, beside the words the list did not
  hold. The preview's hash binds what is submitted, as for every line.
- The box the escape opens may hold the student's own words, through an ordinary mapping of a
  profile field with no option rule. `checkUsable` still refuses a constant there, a translated
  word, and any row naming the escape (ADR-0109 as extended in P281).
- The runner chooses a typeahead's escape only for an instruction that carries `chosenByStudent`,
  which only a recorded choice produces.

## Consequences

- A student whose value is not on a list that was read has a route that does not wait for a
  person, and a run already with a person reaches it through the person's resolution.
- **His run still waits on his reads.** The signed entry records none of `searches`, `listsAfter`,
  the unlisted boxes' `visibleWhen`, or their labels. `docs/run-a/p290-reads.md` says what to read.
  One signature afterwards covers the patch built from them.
- His grading list after "Not in list" is a `listsAfter` read; the grade list has no escape on
  record, so a grade cannot be offered until a read shows one.

## Not built

- **Searching again with a different word** (row 138). It means touching the portal before the
  student has authorised anything, which nothing does today. A student whose words match no
  recorded search, or whose first search returned nothing, still goes to a person.
- **Two searched words in the student's words** (row 139). Nothing they said chooses between the
  two lists, so neither is offered.
- **A choice after a page is saved.** The offer comes from the plan before any page is filled; a
  value refused after a save is a correction, and goes to a person (ADR-0154 §2).
- **Changing a choice once made.** One stands per value. A student who wants another asks, and a
  person can clear it; there is no route in the chat yet.

## Amended in P291 (2026-10-06): what his six reads found

His reads, on his own account with nothing saved, are saved whole as he sent them:
`docs/captures/sheffield-pgt-2026-09-10/reads/p291-six-reads-as-sent.txt`. In his words (15:28 UTC):

> *"The grading-system escape is a dead end and the build cannot offer it. Record it as a row: on
> Sheffield, choosing "Not in list" for the grading system leaves a student unable to state their
> grade, so the offer must not present that escape as a way through. Whether it should be offered
> at all with a plain sentence saying where it leads is yours to propose."*

- **An escape that leads nowhere is recorded, and not offered.** `escapeLeadsNowhere` on a field
  holds the read. With it, the field is not offered, as a field with no usable escape (§1), and
  the stop's message does not explain its escape as a route. The proposal he asked for is on
  row 140 and in `docs/run-a/p291-for-signature.md`; nothing is built on it.
- **A list's prompt is not an answer.** `prompt` names the option that asks for a choice:
  Sheffield's award title opens on *Select qualification...*, whose value is that text. The
  offer of a whole list leaves it out.
- **The empty string is a value.** The parser dropped a condition's value of `""`, so the box the
  award title's escape opens (shown when the title equals `""`) could never show. Fixed in the
  P291 patch, not on `main`: his signature covers the entry as parsed, and the fix moves its hash,
  so it lands with his signature. His
  words: *"Worth saying in the entry that the empty string IS the escape there, so nobody later
  reads an empty value as a missing one."* The code had read it as missing.
- **The box's own limit is read before anything is promised.** Sheffield's award-title box takes
  28 characters. Where the student's words are longer, the offer says so instead of promising to
  type them, ending *"so they will not go in as they are; I will not shorten them for you."* The validator
  refuses them too, and the run stops to have them shortened by the student.
- **A search box's word is not a choice.** The preview says *"typed to search their list, for what
  you chose for …"*. Before, it said *"you chose this on their list"* of a word nobody chose.
- **The entry sentence names the list:** *"entry 1 of the 2 in your previous qualifications"*.
