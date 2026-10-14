# ADR-0154 — A confirmed answer can be corrected by asking

**Status:** Accepted · decided by Vahid, 2026-10-04 and 2026-10-05, in his own words · built in P288 · §5 superseded for fixed choices at his word of 2026-10-14 (P311)

## Why this exists

In his words: *"A confirmation is meant to be the student's authorship of a value, and authorship
that cannot be revised is not authorship — it is a trap that looks like consent. I could not
correct mine for three days and I am the person who built this."*

Until P288, nothing reopened an answer once it was confirmed. Both correction paths, `#correct` and
the entry buttons (ADR-0148 §6–§7), worked only while a playback was open. The stop message said so
itself: *"There is not yet a way to make that choice here."*

His own profile showed what that costs. He confirmed his Master's institution as "Azad
University", and on 3 October (his message of 17:16 UTC: *"I correct my answer to 'Islamic Azad
University'"*) he decided it should be "Islamic Azad University". Nothing let him tell the chat. "Azad University" is a real entry on Sheffield's list (UNI6950), a different
university from his (UNI30764), so the signed identity row (ADR-0153) types the wrong institution
for him. The only thing that stopped it was a missing grading rule, and the stop message invited
that rule to be added (row 134).

ADR-0153 §2 already said the fix was the student's answer, *"corrected by the student, in the
interview, in their own words"*. This is what makes that possible.

## Decision

### 1. Asked for in words, played back, confirmed by the press

His words of 2026-10-04: *"a confirmed value should be correctable by asking, the same way a
deletion is asked for, with the correction played back and confirmed like any other."*

- **Reading the request.** A deterministic reader (`correction-requests.ts`) reads phrasings, not
  a model's guess. It runs before the interview, in `answerStudent`, whatever the run's status.
- **Both halves are named.** The student says what the answer says now and what it should say,
  for example *"my institution is Islamic Azad University, not Azad University"*. The answer is
  found by its own words, never by a guess at which field a sentence is about.
- **Ambiguity is asked about.** Words found in more than one answer are settled by the rest of the
  sentence ("my *Master's* subject") or asked about, never chosen between. A request without both
  halves is asked back.
- **Played back like any other answer.** The correction is put as an ordinary proposal: the whole
  answer, opened with *"You asked me to change … Here it is as I would record it — nothing changes
  until you say it is right."* The ordinary press confirms it. The ordinary writer stores it, one
  revision on, and the conversation log keeps the old value.
- **No second writer.** No new kind of event exists. The log knows a playback is a correction by
  its opening words.
- **Withdrawing.** A plain *leave it*, or an entry pressed as wrong, withdraws the correction, and
  the answer stays as confirmed. A withdrawn correction is not counted as a failed answer.
- **Played back as one answer.** The whole field is played back and stored, so its provenance
  becomes the student's correction: a part first read from a CV no longer says so.

### 2. Only before any page is saved; after that, a person

His words of 2026-10-05:

> *"Build v1 for corrections before any page is saved. After that, the request goes to a person
> the way a deletion does, and the student is told plainly what has already reached the university
> and what that means. Do not reach further yet — going back to an earlier portal page is
> unmeasured, and building on it would be the assumption we have spent the week avoiding."*

Once the run has saved any page on the portal:

- **The request goes to a person.** It is raised as an intervention (`correction:<field>`), the
  queue a person already reads, and the run is held, so nothing more is filled in until a person
  has looked.
- **The student is told what has reached the university.** If a saved page holds the answer: the
  university already holds the old value, on which page, and that is what it has until a person
  changes it there. If not: the value is not on the form yet, but other pages are.
- **The confirmed answer here is unchanged.**

**What the limit costs, in his words:** *"a student who notices their mistake after the fill has
begun has no route except a person, and if the page is saved the university already holds the
wrong value. That is a real gap, not a tidy boundary."*

### 3. A held run keeps its person

His words: *"A system that closes its own intervention because it thinks the blocker cleared is a
system deciding it no longer needs the review it asked for. The resolution re-plans, and that is
enough."*

- **The person still resolves.** A correction confirmed while the run is held tells the student
  the person will see it as it is now. The person's resolution re-plans on the profile as it stands.
- **A resume re-plans before it speaks (row 135).** At a resume the step is derived first.
  - If the run would still stop for a person, it stops at once with a new intervention (blocker
    48) and **one** message: *"Someone on the team has looked at your … application, but it still
    cannot go on …"*.
  - Only a run that moves is told it is moving again.
  - The interventions command says which happened.

### 4. A value that is an entry's exact text is named, not offered as a rule to add

His words: *"Replace the sentence … It names the thing, states the doubt, and offers the route —
all three. Make it general rather than this portal's case: whenever a value a rule is missing for
is itself the exact text of an entry the run would otherwise choose, say so."*

- **Before:** the stop said *"I do not yet have a rule for … 'Azad University'; that is ours to
  add"*.
- **Now:** for such a value it says *"Their list has an entry called exactly 'Azad University'. If
  that is not where you studied, tell me and I will change it."*
- **After a page is saved:** the sentence says *"… I will pass it to a person on the team to
  change"*.
- No rule is added for "Azad University" (row 134).

### 5. Only words a student gave as words

*Superseded in P311 for fixed choices: see "Amended in P311" below.* As written before it:
A part chosen from a fixed set is a token, not the student's words. That covers an ISO country,
a vocabulary choice, and a country field (`isClosedVocabulary`, ADR-0153). Words put in its place
would be a value the set does not have, so it is refused with an honest sentence. Dates and
numbers are not text and are not found this way.

## Consequences

- **Authorisation.** A correction after authorisation moves the preview's hash, so `nextStep` asks
  for authorisation again and the old one is voided (`stillCovers`, `#voidOutgrownAuthorisation`).
  Nothing here touches the gate.
- **His own run waits for this.** He will correct "Azad University" himself before a person
  resolves his stop.
- **Not built:**
  - corrections after a saved page, which need a measured way back to an earlier portal page;
  - corrections of a fixed-set answer (built in P311, below), a date or a number;
  - buttons for choosing between answers holding the same words: the student names them in a
    sentence instead.

## Amended in P289 (2026-10-05)

His report after correcting his own two answers:

- **The playback credited his words to a second part.** It said *"Award: September 2020 (you said:
  "MSc")"*. The playback's rule for a field assembled from parts (`end` from `endKind` and
  `endDate`) took `awardTitle` as a part of `award`, because its key begins with it. Now a part
  that is a field of the entry in its own right is never assembled into another.
- **Only the press confirms a correction.** Until P289, a typed message on an open correction went
  to the interview's `#correct`:
  - on a plain field, typed words are stored as the answer with no press;
  - on a composite, the value was re-played without the correction's opening, and *leave it*
    stopped working.

  Now a typed message on a correction's playback is answered with one sentence: press to keep it,
  *leave it* to withdraw it. Nothing else happens.
- **What is stored is not per part (row 137).** The profile holds one source per field. A
  correction is stored with the correction as the whole field's source, so parts first read from a
  CV no longer say so. In his words, provenance is *"the record of who authored a value"*. Not
  built: it is a change to what the profile holds.

## Amended in P311 (2026-10-14): a fixed-choice answer can be corrected

His live run stopped on it. In his words ([as sent](../run-a/p311-his-message-as-sent.txt)):

> *"in the chat, I could not correct my Master's grade scale. "my Master's grade scale is
> 20-point, not UK honours" was refused because nothing confirmed says "UK honours" (the store
> holds uk_honours), and "not uk_honours" was refused because the scale "was chosen from a fixed
> set of answers". A student who picked the wrong option has no way to fix it."*
>
> *"a correction to a fixed-choice part (grade scale, and any other closed list) must work. Match
> the words the student is shown ("UK honours"), never only the internal token, and when the new
> value is a fixed choice, take it only if it is one of the set, then play it back for "Yes,
> that's right" as for any correction."*

So §5 no longer refuses a fixed choice:

- **Found by the words the student was shown.** An answer from a closed list is found by the
  words its playback shows (*"UK honours"*, *"Iran (IR)"*, *"full-time"*), by the interview's own
  reader for that part (*"uk honours scale"*, *"Iran"*), or by the stored token
  (`placesSaying`). The row-134 stop still names an entry's stored words only (`placesHolding`).
- **The new value only if it is one of the set.** It is read by the interview's own reader for
  that part, and by the shown words where the question's words differ (funding's *"a loan"*). A
  value the set does not have is refused with a sentence naming the set (*"The answers it can
  take are …"*), or, for a country, asking for its English name or two-letter code. The same
  choice in other words changes nothing and says so. A grade scale still keeps P297's rule: the
  student's own words are kept when they state a maximum.
- **Played back and pressed as any correction.** The opening, the playback, *"Changed: …"* and
  *"Nothing is changed: …"* show the words the student is shown, never a token.
- **Closed lists covered:** a qualification's grade scale and level, a job's basis, the level of
  UK study, every `countryCode` part, and the nationality, country of birth and country of
  residence.

Two kinds are still refused, and these are my choices, not his words:

- **A choice in a financial answer** (`finance.funding`'s source and stage), as before P311.
  The mandatory review of financial evidence is done once, before the preview. The trigger is
  raised again on the next advance, but an earlier approving review still counts as clearing it
  (`unclearedMandatoryTriggers`), so a correction after the review would never be reviewed. The
  free-text parts of a financial answer have been corrected from words since P288 regardless;
  that is row 189 (1), and his. It touches money, so it is his to decide.
- **A part that decides what else the answer holds**: whether a passport is held, whether there
  was UK study (`kind`). Changed on its own, it would store an answer half-built, which the code
  before P311 did. Before a page is saved it is refused with a sentence that says why; after,
  it goes to a person, as every correction after a saved page does (§2).

From P311's review, also mine:

- **The stored words first.** An answer that holds the words is found before a closed list that
  the same word names, so a town called Singapore is the town.
- **An open question keeps its answer.** While a question is open, an answer found only by its
  shown words must be named by the sentence, so *"It's Iraq, not Iran"* answers the question.
- **Read before a person.** After a page is saved, a change that changes nothing, or a value
  outside the set, is answered as it is before one; only a real change goes to a person, in the
  shown words.
