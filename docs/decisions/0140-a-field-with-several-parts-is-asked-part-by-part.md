# ADR-0140 — A field with several parts is asked part by part, and confirmed once

**Status:** Accepted · 2026-09-23 · continues [ADR-0007](./0007-nothing-enters-the-profile-unconfirmed.md) (nothing enters the profile unconfirmed) · applies [ADR-0136](./0136-an-option-map-is-checked-against-the-list-that-was-captured.md)'s rule to the interview · carries [ADR-0117](./0117-a-thing-the-student-does-not-have-is-one-value-not-three-empty-ones.md)'s `none` arm into the asking · built in P192
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-23, before the phase started — the parser rule below is quoted verbatim and was given as a standing instruction for *every remaining parser*.

## Context — six fields are not one utterance, and a `parse` cannot be one

P191 gave questions to the twelve registry fields whose value is a single utterance. Six are not:

| Field | What the value holds |
|---|---|
| `identity.passport` | a statement of *none*, or a number, an expiry and an issuing country |
| `contact.address` | six lines, two of them optional |
| `education.english_language_test` | a test, an overall score, a record of component scores, a date |
| `immigration.uk_status` | seven independent claims |
| `immigration.uk_study` | a statement of *none*, or a level, a visa answer and three optional facts |
| `education.highest_qualification` | a `Qualification` |

`FieldSpec.parse` was `(raw: string) => T | null`: **one utterance, one whole value**. A `parse` that
turned a sentence into an `Address` would have to supply the parts the student did not say. Which is
the rule Vahid had already stated, generalising from P191's money parser:

> *"The money parser refusing a bare number is right and it is the same rule as Sep/Sept. Make sure
> the same reasoning is applied to every remaining parser before it is written: **a value the student
> did not state is never supplied by us, however obvious the default looks from where we sit.**"*

So the composites are not data to be added — they are machinery. And the machinery is half of what
the list-valued class needs, which is why the class stays held (below).

## Decision

**1. A field may be a `CompositeFieldSpec`: an ordered list of `FieldPart`s and an `assemble`.**

Each part is its own question, with its own rationale (why the application needs *that part*), its
own `expectedShape` and its own parser. `FieldSpec<T>` becomes the union of `ScalarFieldSpec<T>` and
`CompositeFieldSpec<T>`; the eighteen scalar specs are unchanged.

**2. The parts are asked one at a time, in order, and the student confirms ONCE.**

`InterviewAction.ask` gains an optional `partKey`, so the chat layer and the log can tell *asked
again* from *asked for the next part* — they look identical otherwise, and one of them is a failure.
`InterviewState.partial` holds the readings until every applicable part is answered; then the whole
value is assembled and put for confirmation the ordinary way (ADR-0007). **The student never
confirms a part**, because a part is not what enters the profile.

**3. A part may be inapplicable, and then it is not asked.**

`FieldPart.askWhen` reads the parts already answered. ADR-0117's `none` arm is the case it exists
for: a student who has just said they have no passport is not then asked for its number.

**4. An optional part is asked, and may be answered with "there is none".**

Silence is not an answer, so the part is put; but the student may say there is none, from a small
closed set of words the question itself names, and then **there is none**. Nothing is invented to
fill the shape. `OMITTED` is a distinct value rather than `undefined`, so *asked and there is none*
and *not yet asked* cannot be confused — the difference decides whether the interview asks again.

**5. Attempts are counted per QUESTION, not per field.**

`identity.passport#expiry`, not `identity.passport`. Counting per field would escalate a six-part
address after two readable answers and one unreadable one, which is not three failures — it is one.
An unreadable part re-asks **the same part**; it is never skipped with the value left blank.

**6. A correction to the whole of a composite is refused, and the field is asked again.**

*"No, flat 4"* could be a new first line or a new second line, and choosing between them is us
supplying the answer. The parts are dropped and the walk starts over.

**7. A part answered in one request is readable in the next — `value_part_read` on the log.**

The driver rebuilds the interview from the conversation log on every request (`interviewFrom`), and
the log carried one event per FIELD — `value_proposed`, ADR-0051 — and **none for a part**. Measured
in P192 through the real driver, not reasoned about: a student's answer to the first line of their
address was read, dropped with the request, and the same question came back.

> **P192 stopped the run; P194 made the walk work.** For one phase the driver refused to put a part
> question at all, because a silent loop is worse than a clean stop. `value_part_read` replaced that
> stop with the thing it was standing in for — and the stop's removal is itself held by a test, so
> the two cannot both be believed at once.

The new kind is **its own**, not a `value_proposed` with a compound key. `open_value_proposals` is
the view that answers *"what is this conversation waiting on?"*; a part folded into that kind would
be reported as an outstanding confirmation, and a client could offer the student a way to agree to
half an address. It carries no `playbackHash`, for `value_asked`'s reason: nothing has been shown,
so there is nothing to confirm. **The last part is not written alone** — the `value_proposed` that
follows it carries the whole assembled value, and writing both would put that part on the log twice.
A walk **ends** at the proposal: once the whole value is put, the parts are not read back into the
state, or the field would be stranded with every part answered and nothing to ask.

Closed [blocker 60](../state-of-the-system.md#6-open-blockers) in P194.

## The parser rule, applied to every parser this phase wrote

| Parser | What it refuses, and why it does not guess |
|---|---|
| `heldOrNone` | *"I might be able to find it"* is neither yes nor no. Resolving it in whichever direction moves the form along is us answering. |
| `passportNumber` | At least five characters and at least one digit. A judgement, stated as one: without it `soon` reads as a passport number. Nothing is upper-cased or de-hyphenated — a number we have tidied is not the number the student gave. |
| `isoDate` (expiry) | `02/04/2031` is April 2nd or February 4th and there is no way to tell. Unchanged from P191. |
| `countryCodeIso2` | **"Iran" is refused.** Turning a country name into `IR` is a lookup, and there is no reviewed country table in this repository. A half-table would work for some students and silently fail for others, which is worse than a refusal because the failure is invisible. The question asks for the code and says so. Raised as [blocker 61](../state-of-the-system.md#6-open-blockers). |
| `addressLine` | Non-empty and short enough to be a line. Nothing normalised, nothing title-cased. |

## The guardian fields, and what a mandatory-review category means for how they are asked

Vahid asked for these **inside** this phase rather than after it:

> *"They are reachable only on the minor path and that is exactly why they should not wait: a path
> that is rarely taken and never built is the one that fails in front of a real person."*

Three things follow, and they change **how the questions are worded**, not only who reads the case
afterwards:

1. **Minority is determined, never asked.** It comes from the date of birth (ADR-0011). There is no
   *"are you under 18?"* in the registry and there must not be: a question like that invites a
   student to answer around a safeguard. A test holds it — no spec's text may contain *are you under
   18*, *are you a minor*, *how old are you* or *what is your age*. Telling a minor *"because you are
   under 18"* is the opposite act and is allowed: it states back a determination already made.
2. **The answers feed a STOP, not a continuation.** Being a minor blocks nothing by itself
   (ADR-0013), and anything involving a minor is a mandatory human review — every time, regardless
   of confidence (brief §2.5). Collecting these does not release the case; it gives the person doing
   the review something to work with. **The questions say so**, because a student who is told a
   person will look is not surprised by the wait that follows.
3. **This is a third party's personal data**, given by someone who is not in the conversation. The
   guardian has not consented to anything here and cannot be asked through this chat — while the B2
   determination for the minor route (`MINOR_ROUTE`) rests on *the guardian's consent*. Nothing in
   this system reaches the guardian.

> ### ⚠️ Building these questions did not make a minor serviceable
>
> Raised in this phase and **decided by Vahid on 2026-09-23**, in his own words:
>
> *"a minor is not served until the guardian route is real. Not a stop-for-a-person, not a message
> in the student's chat — no application is prepared for a minor until there is a way for the
> guardian to be reached, told, and to consent in their own right. … A mandatory review with nobody
> to review to is worse than no route."*
>
> So this is a **product precondition**, recorded beside the second-reviewer precondition
> ([blocker 62](../state-of-the-system.md#6-open-blockers), beside blocker 2) rather than as a gap
> in the interview. Roughly what the route would take: **a second conversation** with its own log
> and lifecycle; **a separate identity** for the guardian, authenticated in their own right, which
> today's OIDC path issues only to the student; and **a consent record that is the guardian's own
> act**, minted from what they confirmed rather than inferred from the student's yes. Not built, and
> not priced as small.
>
> His reason for wanting it written here, where the questions are: *"I am not asking you to build
> it. I am asking that nobody later reads 'the guardian fields are built' as 'a minor can use
> this'."*

## What this does NOT do

- **`education.highest_qualification` has no parts.** It is a `Qualification`, which is the shape of
  one entry of the list-valued class Vahid held pending his read of Part 2 — *"Its shape depends on
  what the portal asks for, and ADR-0113 was decided without that page in view."* Giving it parts
  here would settle what he reserved, so it still escalates with *"the agent will not improvise a
  question"*, and a test holds that.
- ~~**The three remaining composites are not built**~~ — **built in P197**, and each met a shape the
  machinery had not: a RECORD whose keys the student supplies (`componentScores` is one part with a
  pair parser, not four named ones, because the components differ by test and a fixed four would be
  a half-table for everything that is not IELTS); SEVEN independent claims, none derived —
  `british_passport` is not read off the passport's issuing country and `eu_passport` is not read
  off nationality (ADR-0115); and a `none` arm with five optional parts behind it. A score is kept
  as the certificate writes it — `7.5`, `102`, `B2` — rather than parsed to a number, because a
  number would make 7.5 and 102 the same kind of thing and lose what either means.
- **`Address.postalCode` stays required.** A good many countries issue no postcode, so a student in
  one of them cannot complete an address. Fixing it is a registry change, not a spec change —
  [blocker 63](../state-of-the-system.md#6-open-blockers).

## Alternatives rejected

**One `parse` per composite, reading a whole address from a sentence.** It is what the type already
allowed, and it is the rule above broken: the parts the student did not say would be supplied, or
the whole answer refused because one optional line was missing.

**Confirming each part as it is read.** Six confirmations for an address is a form with extra steps,
and it confirms something that never enters the profile. The value that enters is the whole one, so
the whole one is what the student agrees to.

**Letting the driver ask parts and losing them.** Measured before the guard was written: the run
asked *"the first line of your address"*, took the answer, dropped it, and stayed `running`. A loop
is not a conversation.

## Consequences

- `packages/interview` grows `FieldPart`, `PartAnswers`, `OMITTED`, `partParser`, `isComposite`;
  `FieldSpec` becomes a union and `InterviewState` gains `partial`.
- `InterviewState.attempts` is keyed by question (`string`), not by field.
- `identity.passport`, `contact.address` and the five guardian fields can now be asked for.
  **Counted, not estimated** (`PROFILE_FIELD_KEYS` against `FIELD_SPECS`): **26 of the registry's 35
  fields now have a question — 21 of the 30 ordinary ones and all five guardian — up from 19.** The
  nine ordinary fields still without one are the five list-valued keys plus
  `education.highest_qualification`, `education.english_language_test`, `immigration.uk_status` and
  `immigration.uk_study`.
- The run driver gains one more reason to hand a case to a person, and the source-text guard over
  `#stopIfTheInterviewGaveUp` (P29) now names three kinds rather than two.
