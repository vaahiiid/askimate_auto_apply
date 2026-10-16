# ADR-0161 — An answer the interview accepts fills its box or is asked about there and then; a student answers a field again on their own word; a financial answer they change is reviewed again

**Status:** Proposed · written 2026-10-16 (P317) at Vahid's request, for his approval · **nothing
here is built** · it records three decisions of his, of 2026-10-16, in his own words (row 209,
the general rule, row 189 (1)) · everything else here is mine, recommended, and not agreed ·
would amend [ADR-0143](./0143-funding-is-a-closed-vocabulary-and-the-students-own-statement.md)
§1 and §3, [ADR-0154](./0154-a-confirmed-answer-can-be-corrected-by-asking.md) as amended in
P311, [ADR-0148](./0148-the-interview-is-an-ai-asking-not-a-form-read-aloud.md) §4 and §11 (as
built in P231 and P233), and the reach, not the rule, of
[ADR-0123](./0123-a-star-is-not-a-requirement-and-a-step-that-cannot-ask-stops-for-a-person.md)
Decision 2 · keeps the mandatory review of financial evidence and of minors whole, and narrows
what an approval clears to the content it reviewed

## His words (2026-10-16)

Saved whole as sent ([the message](../run-a/p317-his-message-as-sent.txt)):

> *"Row 209: B, plus a general rule. Not A, not C.*
>
> *The product logic I am testing: any student, interviewed once, applies to many universities;
> later applications ask less because the student's own answers are reused. My profile on
> Sheffield is the first test, not the goal. So fix the class, not my run.*
>
> *1. General rule: for every required box in a signed entry, every answer the interview accepts
> must either produce a value that satisfies the box, or lead the interview to ask the follow-up
> there and then, never a stop after the plan is complete. A test checks this for every signed
> entry and every accepted answer. Today's case: "no" to "Do you know how your studies will be
> funded?" can never fill the required stage box.*
> *2. Build the way to answer the funding questions again on the student's own word, with
> playback and the "Yes, that's right" press.*
> *3. Row 189 (1): my decision is that a student may correct their own financial answers in the
> chat, with playback and a press. No person sets a financial answer for a student.*
> *4. Then tell me the exact steps for my run, ending with the resolve command. I will give my
> funding answer myself in the chat.*
>
> *Propose this as an ADR first if it changes accepted decisions; otherwise build it
> test-first."*

His decisions, as he typed them, and only these:

- **Row 209:** *"B, plus a general rule. Not A, not C."* B is the way to ask the funding
  questions again on his word. A (the read of `studyprogrammetaught.js` and an entry patch as
  the settlement) and C (a person setting a whole yes) are not taken.
- **The general rule:** item 1 above, in his words.
- **Row 189 (1):** *"a student may correct their own financial answers in the chat, with playback
  and a press. No person sets a financial answer for a student."*

## Why this is an ADR first

It changes accepted decisions, so his last sentence sends it here before any code:

- **ADR-0143 §1**, as accepted on 2026-09-25 (the ADR's wording, not his quoted words): *"a
  student who answered no holds `{ known: false }`, which is complete."* Under the general rule
  it is complete only where no required box needs more (§4 below).
- **ADR-0143 §3**, the ADR's wording too: a scholarship or a loan whose name the map needs
  *"refuses loudly and is asked about"*. Measured today it refuses as a person's stop (measured
  above; §7 says what it would get). The rule asks for the follow-up there and then instead.
- **ADR-0154 as amended in P311** refuses a correction to funding's source and stage. That
  refusal was recorded there as *"my choices, not his words"*. His decision on row 189 (1)
  replaces it (§6).
- **ADR-0148 §4 as built in P231** turns "none" into a real answer only for optional parts. It
  never asks a part that an earlier answer closed (`askWhen`). §3 below extends it.
- **ADR-0154 §2** says that after a page is saved *"The confirmed answer here is unchanged"*, under
  his words *"Do not reach further yet"*. §5 below lets a person reopen a field so the student can
  answer it again after its page is saved, which reaches further. That is his (D11).
- **ADR-0123 Decision 2** stays as his words have it: *"a step that cannot ask for what it needs
  must stop for a person and say so."* The rule changes how often that happens, not what happens
  when it must. A `fix_content` stop remains for what no answer can mend: an entry that is wrong
  about its form.

## What was measured, before anything is proposed (P317)

`scripts/required-boxes-hold.ts` measures the rule as it stands today. Its output is
[`docs/run-a/p317-required-boxes.txt`](../run-a/p317-required-boxes.txt), and
`scripts/required-boxes-hold.test.ts` pins it.

**How it measures.** It reads every entry the signed catalogue admits; today that is only
Sheffield's, blueprint 0.2.36. For every profile field that the entry's maps read, it builds the
answers the interview's own parsers accept. It then plans Run A's synthetic profile with each
answer put in, through the run's own `planFill`, `validatePlan`, `partPolicyFor` and
`entryChoiceOffer`.

**What it planned.** In the words of its output: *"fields measured: 20; accepted answers planned:
5558"*, and *"what Run A's synthetic profile breaks itself … nothing"*. The script's header lists
how the answers are built and what that cannot see. In short:

- **Closed values.** A closed list contributes all of its values, and a yes-or-no both. A country
  contributes every code in the reviewed table.
- **Text and dates.** Text contributes its shortest and longest accepted probe, "Example", and the
  answers its own question names (*"school, foundation, … or other"*). Dates contribute every
  probe date the parser accepts, from 1900 to 2031.
- **Which parts are asked, and which may be "none".** This comes from the run's own part policy.
- **Composites.** A composite is varied one part at a time from the synthetic profile's own
  answer. It is also varied in pairs where one part has at most twelve values, so a part an
  earlier answer opens is varied with the answer that opens it.
- **Lists.** A list contributes no entries, one varied entry, and five copies of an entry.
- **Hidden fields.** A field whose every box the synthetic profile hides is measured again under
  another answer that shows one; the report names which.

It does not build three parts varied at once, or two different entries of a list. It names each
part that was never varied, because silence there is not a pass. One part is never varied today:
the e-mail, of which the probes reach one shape.

**What it found.** Each line below is a field, a box and a rule. The counts are read from the
output. The middle column was put to a refuter, who checked it against the code.

| Class in the output | Lines | What the run does with it today | The rule's verdict |
|---|---|---|---|
| `breaks_a_required_box` | 21 | A violation the validator finds only once the plan has no blockers left, so after the interview. The run's next advance stops for a person (`fix_content`, `specialist:content_rejected`) | Breaks it: *"a stop after the plan is complete"* |
| `breaks_another_box` | 2 | The same stop, on a box the entry does not require | The same stop. His words name required boxes, and §1 counts these too |
| `refused_by_the_map` | 23 | Another blocker on the answer. The orchestrator returns a person's step for it as soon as the answer is confirmed, ahead of every unanswered field; the next advance stops the run for a person, and nothing else is asked in between | Breaks it: neither a value nor a follow-up |
| `offered_but_the_escape_cannot_take_the_words` | 1 | The form's list is offered, but its escape would put the student's words in a box too short for them, so choosing it stops after the plan | Breaks it |
| `not_one_of_the_box_options` | 12 | Nothing before the fill: the validator has no rule that a select's value is one of its options. The student authorises the preview; the fill fails at the box as `portal_drift`; the page is tried once more and then stopped for a person | Breaks it, latest of all |
| `offered_from_the_form_list` | 1 | The student is shown the form's own list and chooses (ADR-0155) | Holds: a follow-up the student answers |
| `held_but_unreadable` | 0 | — | — |

The output marks each line's box as the entry marks it, and tallies them: *"lines that break the
rule on a box the entry marks required: 31; that stop the run on a box it does not mark required:
28; that hold the rule: 1"*. His words name required boxes, so 31 break his rule as he wrote it.
The other 28 stop the run the same way, and §1 (mine, not his words) counts them too. Behind
them, each line marked as a refuter found it:

- **Today's case** (real). `finance.funding → fundingStage: required, by 1 answer(s):
  known=false`. No other answer to the funding questions breaks the stage box.
- **A list confirmed empty** (real; row 202). No qualifications breaks twelve required boxes, and
  no jobs breaks four. The cause is the validator: it checks a repeating page as one unfilled
  entry when the student has none.
- **Text longer than its box.**
  - Real: a refuter's probe, an address line of 37 characters, *"Flat 12, Bramall Court, 123 Mill
    Lane"*, breaks Sheffield's 35 (the output's own example is 120 characters). The interview
    takes up to 120.
  - Real in kind, though no real answer is that long: the town (50), a job title (200), an
    international postcode (20), funding details (118), and a UK qualification named under
    "other" (100).
- **Countries the entry's maps do not hold** (real, apart from uninhabited territories).
  - The interview reads the countries; 15 to 18 per box are refused. Among them are Cyprus, Côte
    d'Ivoire, North Macedonia, Laos, Jersey, Guernsey, the Isle of Man, Réunion, Curaçao and Sint
    Maarten. The same refusal holds for a country in the residence periods.
  - Most have an entry on the form's own list, by my reading of the labels, which is not a
    reviewed mapping (ADR-0153).
  - Cyprus and Saint Martin are left out of the map on purpose (blockers 70 and 66).
  - The parser reads *"Côte d'Ivoire"* and *"Curaçao"* with their accents, and not without them.
- **The level of UK study** (real). Four of the six levels the question names (English language,
  school, foundation, exchange) have no mapping at all. The fifth, university, maps one
  qualification only.
- **Values that must be found per student** (real; ADR-0158, not built). An institution, a
  subject or a grade outside the rows read, or a qualification level other than a bachelor's at
  Sheffield, is refused, and no list is offered.
- **A scholarship or a loan** (real). With no name, the map cannot choose one of 22 scholarships
  and schemes and 3 loans. The interview offers "none" for the name, because the source box is
  not required and the policy reads a switch by its own path only. A name the list does not hold
  is refused too, and no list is offered.
- **An award title the degree list does not hold** (real). The form's list is offered. Where the
  title is longer than the 28 characters the escape's box takes, as *"Doctorate of Business
  Administration"* is at 36, choosing the escape stops after the plan.
- **A UK address whose postcode is not UK-shaped** (the mechanism is real; the measured answer is
  the checker's). The interview takes any postcode with any country. The map's `uk_postcode`
  reader takes every real UK shape and refuses a partial one, such as *"S10"*, or *"BFPO 123"*.
- **More residence periods than the form's rows** (real): five periods outside the country of
  residence.
- **Years and counts a form's list does not hold.**
  - A visa expiring after 2030 (real; the list holds 2026–2030).
  - Time on a visa of 18 months, which is the question's own example (real; each box holds 0 to
    12).
  - Qualification, job, residence and UK-entry years before 1957 or after the lists end (real,
    but rare).
  - A date of birth outside 1940–2014. This is mostly a child's date, which the minors review
    stops first.

**The checker's own faults, found before any number was quoted.** Each made a finding, or a
silence, that was the checker's and not the product's:

1. Base answers were built from each part's first accepted value, an award title of "AE" for
   instance, which every list refused. They are now built from the synthetic profile's own
   answer.
2. A date went into the profile without its stored form, so every date "needs a Date, got
   object". It is now stored as the profile stores it.
3. Free text was read as a country part, because "GB" passes through text unchanged. A country
   part is now one that also refuses "Example".
4. A local helper named `textOf` shadowed the imported one, so every select read as empty.
5. A blank fill counted as "not one of the box's options".
6. A stored value that differs from what its part reads ("studied" for the part's "held")
   stopped the base forming. A held value is now used only where the part could give it.
7. A break the synthetic profile has itself was hidden as "not new". The planted test found
   this one, and it is now said on its own line.

The refuters found more, and these are fixed too; see below.

## Proposal (mine, for his approval)

### §1 What counts as holding the rule

His rule is a list of what may happen to an answer. Read as a test, an accepted answer holds the
rule when one of these happens, for every box it fills in the case's entry:

- **It fills the box.** The plan carries it, the box's rules pass, nothing refuses it, and a
  select or a radio gets one of its own options.
- **The follow-up is asked before the next question.** Either the interview asks a part or asks
  again (§3), or the form's own list is offered (ADR-0155).

Anything else breaks it. That includes a person's stop at any point and a `fix_content` after the
plan. It also includes a fill that fails at the box, and a stop said in the interview but for a
person to settle.

### §2 The test

`scripts/required-boxes-hold.ts` becomes his test. It runs over every signed entry, every field
the entry's maps read, and every accepted answer as the script builds them. It fails on any line
that breaks the rule.

Until the build reaches each class, the test holds a list of today's lines, each named with the
row or open point it waits on. The list can only shrink:

- A new line fails the test.
- A line that stops occurring must leave the list.
- A new signed entry is measured from its first signature.

Two more things:

- **The plan's validator learns that a select or radio value must be one of its options**
  (packages/preparation/src/validate.ts has no such rule). The twelve fill-time lines then become
  plan-time lines.
- **Pairs are already built** (P317, after the refuters), where one part has at most twelve
  values: the country and the postcode, a funding source and its name. Three parts varied at
  once are not built, and the script's header says so.

### §3 One check, after every answer, before the next question

Today the plan is run after every answer. Its rules are checked only once no blocker is left,
which is at the end of the interview. Proposed:

- **Checked when the answer is put together, before it is played back.** The answer is checked
  against the boxes it fills in the case's entry. The playback then shows the whole answer and
  one press confirms it.
- **Checked when a case begins.** An answer the student gave for another application is checked
  against this entry when the case first plans. This is his product logic: *"later applications
  ask less because the student's own answers are reused"*. The answer is reused where it fills
  the box, and asked about where it does not, before the plan is complete.

Each refusal or rule broken on a box the answer fills becomes exactly one of these:

1. **A part asked.** An optional or gated part that the box reads is asked, even if an earlier
   answer closed it. This extends ADR-0148 §4's *"or, if the university requires it, we ask for
   it rather than offering"* from optional parts to gated ones (§4). It departs from the same
   item's *"if they say they are still there, we do not ask for an end date at all"* wherever a
   required box reads a part an earlier answer closed, and that is his to approve (D1). A part a
   map needs to choose an option is asked rather than offered as "none" (a scholarship's name).
2. **Asked again with the box's own reason.** Text longer than the box is asked again; *"it must
   not be truncated on their behalf"*, as the validator already says. So is a postcode the map
   cannot split, and a date outside the form's year list. The reason comes from the box's
   recorded rule and is never invented.
3. **The form's own list offered** (ADR-0155), where the list is on file.
4. **Said there and then, for a person or for him.** A fact the student cannot change, such as a
   date of birth outside the form's years, a country with no entry on the form's list, or a list
   they truly have none of. The student is told at the answer, not after the plan. What follows
   for each is in §7; those that touch submitting are his.

Machinery for 1 exists for one case. A box the portal refused at the save raises
`value_part_demanded` when it was typed empty because the student left an optional part out, and
the interview asks that part of the held answer (ADR-0148 §11, P233). Nothing today asks again
for a value the student gave. The check would raise the same demand from the plan, before any
save. The new pieces are:

- asking a gated part;
- asking again with the box's reason;
- keeping a part the answer would otherwise drop (`assemble` returns `{ known: false }` whatever
  else it was given).

### §4 Today's case: the funding stage after a "no"

Under §3, a student who answers "no" to *"Do you know yet how your studies will be funded?"* is
asked the stage before the playback, wherever the entry requires it, as Sheffield's does. The
answer then holds `{ known: false, stage }`.

The words are mine. They are a question about money, so the words are his to approve:

> *"You said you do not know yet how your studies will be funded. Sheffield's form still asks how
> far your funding is arranged. Which is closest — confirmed, applying for a project studentship,
> applied, applying, or thinking about it?"*

Three facts belong beside it:

- **The form's script is unread.** Whether it hides the stage box for *No* is still not known
  (rows 82, 86). If it does, the signed entry is wrong about the form, and a "no" student's fill
  would stop at a hidden box. He chose "not A" as row 209's settlement, and nothing here
  re-proposes it. The read stays where it already was: ADR-0160 §4 step 1, the agent's plan
  after his words of 2026-10-13.
- **The source is not asked.** The entry marks no rule on the funding source, though his saved
  page marks it (row 210). The stage is asked; the source is not.
- **The review sees it.** A stage held under *No* is a financial answer, and the review of
  financial evidence covers it (§6).

### §5 Answering a field again, on the student's own word (his item 2)

This is general, not for funding alone. It would also settle row 189 (3): whether a passport is held,
and whether there was UK study.

- **What is recognised.** A sentence asking to answer a field again, such as *"I want to answer
  the funding questions again"* or *"I want to change my funding answer"*. It names the field by
  the words the student is shown for it. One field or none is found, never a guess, and none is
  asked about. The reader stays deterministic, like the correction reader (ADR-0154).
- **Before a page holding it is saved.** The field's questions are asked from the first part,
  each gate read afresh, and §3's check applies to the new answer. The whole new answer is
  played back with *"Yes, that's right"*. The press replaces the answer, with the student's own
  words as its source, and the old answer stands until then. *"Leave it"* withdraws, and the old
  answer stands.
- **After a page holding it is saved.** It goes to a person, as every correction after a saved
  page does (ADR-0154 §2). The person's resolution never carries a value; it lets the student
  answer again in the chat. For a financial field this is his rule: *"No person sets a financial
  answer for a student."*
- **The guard stays.** A bare change of a part that decides what else the answer holds (`known`,
  `kind`) is still refused as a correction. It is reached only by answering the field again,
  which asks the parts it opens. Row 209 found that the guard does not cover `known`; it would.

### §6 Financial answers, corrected or answered again by the student (his item 3)

His decision: *"a student may correct their own financial answers in the chat, with playback and
a press. No person sets a financial answer for a student."* So:

- **ADR-0154's refusal is withdrawn.** It refused funding's source and stage, which were the
  agent's choices. A financial closed part is corrected as any closed part is: found by the words
  shown, taken only if it is one of the set, played back and pressed. The same applies to
  answering a financial field again (§5).
- **No person sets one.** No resolution, command or endpoint writes a financial answer. A person
  may only reopen it for the student.
- **The review covers the content it reviewed.** This stays a hard rule, and nothing here weakens
  it.
  - **The hole today.** An approving review clears `financial_evidence` for good
    (`unclearedMandatoryTriggers` in packages/domain/src/escalation.ts), and a review records no
    content. Row 189 (1) is that hole. It is open today for the free-text financial parts, which
    are corrected from words since P288.
  - **What a review would record.** For each trigger it clears, a fingerprint of what raised it:
    the stored financial answers and their revisions for `financial_evidence`, and the confirmed
    date of birth for `involves_minor`. The service computes it from the profile at the moment
    the review is recorded; the reviewer never types it.
  - **When an approval counts.** Only while that fingerprint is the content's own. Any change
    reopens the trigger: a correction, a field answered again, or a part §3 asks. The case then
    cannot reach the student's authorisation until a new review approves what changed. That gate
    is the existing one, in the transition guard.
  - **After the student's authorisation.** The guard runs only on the way into authorisation. So
    a change to fingerprinted content after it also sends the case back, and the guard runs
    again.
    - Today an authorisation is voided only when the preview changes; a financial answer the form
      never shows would not void it. Here the fingerprint sends the case back, not the preview's
      hash.
    - The order matters. Today `void_authorisation` is refused while a trigger is outstanding
      (packages/domain/src/machine.ts), and the driver does not act on that refusal
      (apps/conversation-service/src/run-driver.ts, `#voidOutgrownAuthorisation`). So the
      authorisation is voided first and the trigger reopened after. Otherwise a stale
      authorisation would stay in place.
    - It is not used today, because the orchestrator asks for authorisation again whenever the
      preview's hash no longer matches (`stillCovers`). So this is not a weakening now, and the
      build must not make it one.
  - **Where the guard reads the fingerprint.** The guard's context holds the case's events, not
    the profile. So the fingerprint travels in them: each raising of a trigger carries the
    fingerprint of the content that raised it. An approval clears only the raising whose
    fingerprint it names, and a change raises the trigger again with a new one.
  - **Approvals recorded before this.** They carry no fingerprint, so they cover nothing.
  - **The minors trigger** is included because §5 would open the same hole: a date of birth
    answered again after its review. It cannot be corrected in the chat today (ADR-0154 §5).

### §7 The other classes measured, and what each would get

| Measured line | Under §3 | Touches one of his four? |
|---|---|---|
| Funding stage after a no | 1, a part asked (§4) | Money: his |
| Empty list on a page with required boxes (row 202) | Said at the "any …?" question, there and then. A list the portal is observed to save empty is recorded so (P156's skippable sections); otherwise the application cannot go on without one, said at once | Submitting: his, as row 202 already says |
| Text longer than its box | 2, asked again with the limit | Personal data (what is held: the student's shorter words replace the longer ones in their profile): his |
| A scholarship or loan without its name | 1, the name asked; a name the map does not hold → 3, the form's list (it has an escape: *"Scholarship or studentship (not listed below)"*) | Money: his |
| Postcode not UK-shaped for a UK address | 2, asked again with the shape the map reads | Personal data (what is held of an address): his (D9) |
| Country the entry's map does not hold | An entry patch, row by row, where the form's list has the country (ADR-0153, under his signature); where it has two (Cyprus), or none, 3, the form's list | The patch is his signature; the offer is personal data: his |
| Institution, subject, grade, qualification level per value | ADR-0158's resolution against the live list, then 3 | Already his (ADR-0158, accepted in direction) |
| A year outside a form's list | The validator rule (§2); then 2 where the student can restate it (a visa expiry), 4 where they cannot (a date of birth) | Submitting, for 4: his |
| A level of UK study with no mapping (four of six), or a UK qualification the one-row map does not hold | An entry patch for the levels' rows from the form's own lists (his signature), then 3 for a name the list does not hold | The patch is his signature; the offer is personal data: his |
| An award title too long for the escape's box (28) | 2, the student asked for words that fit, before the offer's escape is pressed | Personal data: his (with D6) |
| More residence periods than the form's rows | 4, said at the list's "another?" question: the form holds four | Submitting: his |

### §8 The order of the build, test-first (P318 onwards)

1. **The review covers what it reviewed (§6),** before any new path changes a financial answer.
   A rule that protects the review comes before the paths that would test it.
2. **The test (§2),** red on today's list, with the validator's option rule.
3. **§3's check, for today's case first:** the funding stage after a no. Then the parts a map
   needs and the text too long for its box. Each class is taken off the list only when its test
   is green.
4. **Answering a field again (§5),** with funding first and financial corrections (§6).
5. **The exact steps for his run (his item 4),** ending with the resolve command
   (`--did-not-happen`). The steps will name the review of financial evidence that stands before
   the preview (his P308 steps, step 7).

## What comes to him

Each of these touches one of his four, so nothing is built on it until he answers. My
recommendation stands beside each.

- **D1. The ADR as a whole.** I recommend he approves it.
- **D2. The stage asked after a no, and its words (§4)** — money. I recommend it, with the words
  in §4.
- **D3. The review's fingerprint, and old approvals covering nothing (§6)** — money and the
  review. I recommend both, the minors trigger included.
- **D4. An empty list (row 202, §7)** — submitting. I recommend my row-202 recommendation (P315)
  unchanged, with the sentence said at the "any …?" question.
- **D5. A fact the student cannot change (§3 case 4)** — submitting. I recommend that the
  student is told at the answer and the case stops there for a person, with the reason named.
- **D6. Shorter words replacing longer ones in the profile (§7)** — personal data. I recommend
  the student's restated words, played back and pressed, replace the longer answer, so one
  answer serves every form.
- **D7. The scholarship's and the countries' offers (§7)** — money, and personal data. I
  recommend the form's own list, with its escape.
- **D8. The validator's option rule (§2, row 213).** It changes when such a run stops, which I
  read as touching submitting. I recommend it.
- **D9. A UK postcode asked again with the shape the map reads (§7).** It changes what is held of
  the student's address, which is personal data. I recommend it.
- **D10. §3's two moments.** Checked before the playback, and when a case begins. The second
  asks a student again about an answer they gave for another application, which changes what
  is collected. I recommend both.
- **D11. A field answered again after its page is saved (§5).** A person reopens it, and the
  student answers in the chat. This reaches past ADR-0154 §2's *"Do not reach further yet"*. It
  touches personal data and the submission, because the university already holds the old
  value. I recommend it, with the student told, as today, what the university holds and on
  which page.

## Applied under his rule of 2026-10-14 (recorded as mine)

These do not touch his four, so they are mine to apply under his rule of 2026-10-14. They sit in
a proposed ADR, so none is built or in force until D1 is answered. Each is recorded as my choice,
never as his:

- The definition of holding the rule in §1.
- The test's shape in §2, including the list that can only shrink.
- The build order in §8, with the review first.

Where an item could be read either way, I read it as touching his four. That is the reading of
his rule written in P308 (mine, not his words), which says to do so when in doubt. That is why D8
to D10 are his.

## What the refuters found (P317)

Three refuters, read-only, worked in parallel on the checker's first full output (1,635 answers,
43 lines), kept as [`docs/run-a/p317-required-boxes-first.txt`](../run-a/p317-required-boxes-first.txt).
The copy kept was printed just before the line saying what the synthetic profile breaks itself
was added; that line read "nothing", and nothing else differs. Each line below says what was
found and what became of it.

**What the checker missed (coverage).** Seven gaps were confirmed by planning them through the
run's own code. Each is now built, and each now appears in the output:

- **No variants from a parser without a table.** Four of the six UK study levels were never built.
  The question's own words are now probes.
- **The pairs it needed were not built.** A level of "other" with a long name was one. Pairs are
  now built where one part has at most twelve values.
- **Probes that missed the question's own example.** Time on a visa of 18 months, the question's
  own example, was never tried. It is a probe now.
- **An offer's escape was never planned.** The offer's own `tooLong` is now read.
- **A gated part was never varied.** A job's end date, closed while the job goes on, was one. It
  is now opened by the pairs.
- **No years below 1960,** where every year list starts at 1957. Probes now reach 1900.
- **Hidden sections passed as measured.** The residence periods and the UK entry date were
  "measured" against boxes their sections hide. They are now measured where another answer
  shows them.

Two of its remarks are applied. A violation on a box the entry does not require stops the run
the same way, so it is now counted, as `breaks_another_box`. And the runner matches a select by
value only, so a label is no longer a match. The verdict on the stated blind spots was
*"incomplete"*; the script's header now names them as above.

**Whether the findings are real.** Each line is marked in the list above as the refuter found
it. The artefacts:

- **The postcode witness.** It was the synthetic profile's Iranian postcode with the country
  changed. The mechanism is real.
- **Uninhabited territories.** The interview accepts them, but nobody lives there.
- **Dates of birth after 2014.** These are a minor's dates, which the minors review stops first.

**What each class means in the run.** All five claims were confirmed against the code, and two
were reworded as the refuter wrote them:

- A refusal stops the run on its next advance, after the confirming press.
- An option the box does not have fails at the fill as drift, is tried once more, and then stops
  for a person, after the student has authorised the preview.

No existing mechanism catches any of these classes earlier. The part policy stops omissions
only. A portal demand comes only after a save. Nothing in the interview or the orchestrator
checks a length or an option.

## Consequences

- His run's next steps wait on his approval and on the build. Until then, the intervention that
  stopped it stays as it is: nothing here touches his database and nothing resolves it.
- The rule will be red on its first run, and the list in §2 says by how much.
- Every new university's entry meets the test from its first signature, which is where his
  product logic is decided: an answer reused is checked against the entry that reuses it.
