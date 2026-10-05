# ADR-0154 — A confirmed answer can be corrected by asking

**Status:** Accepted · decided by Vahid, 2026-10-04 and 2026-10-05, in his own words · built in P288

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
  - corrections of a fixed-set answer, a date or a number;
  - buttons for choosing between answers holding the same words: the student names them in a
    sentence instead.
