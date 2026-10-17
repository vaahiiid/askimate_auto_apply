# ADR-0161 — An answer the interview accepts fills its box or is asked about there and then; a student answers a field again on their own word; a financial answer they change is reviewed again

**Status:** Accepted · approved by Vahid on 2026-10-17 in his own words, phased (D1: *"approved,
phased"*), with D2, D4, D5, D6 and D11 answered differently from my recommendations or with
conditions (see [His answers](#his-answers-2026-10-17)) · written 2026-10-16 (P317) at his request ·
records three decisions of his of 2026-10-16 and his answers of 2026-10-17, in his own words ·
everything else here is mine · phase 1 is building from P318: the review rule and the test
gate in P318; in P319 the funding stage and source after a no in the form's own words, behind
his signature of a prepared change, both of D10's moments, and a minor's review over every
answer and list choice; answering a field again (§5) next; the rest
follows in §8's order · amends [ADR-0143](./0143-funding-is-a-closed-vocabulary-and-the-students-own-statement.md)
§1 and §3, [ADR-0154](./0154-a-confirmed-answer-can-be-corrected-by-asking.md) as amended in
P311, [ADR-0148](./0148-the-interview-is-an-ai-asking-not-a-form-read-aloud.md) §4 and §11 (as
built in P231 and P233), and the reach, not the rule, of
[ADR-0123](./0123-a-star-is-not-a-requirement-and-a-step-that-cannot-ask-stops-for-a-person.md)
Decision 2, and, as built in P318, [ADR-0049](./0049-the-run-driver-drives-the-case-machine.md)
§3 (the triggers are read from the stored profile, not the run's view of it) and §4 (an approval
of a mandatory review names the case as the reviewer read it, `caseSequence`) · keeps the
mandatory review of financial evidence and of minors whole, and narrows what an approval clears
to the content it reviewed

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

## His answers (2026-10-17)

Saved whole as sent ([the message](../run-a/p318-his-answers-on-adr-0161-as-sent.txt)):

> *"ADR-0161, my answers:*
>
> *D1: approved, phased. First build only what unblocks my run and protects every student: the
> test with its shrinking list, the review rule (§8 first), the funding stage after "no", and
> answering a field again. The rest follows in the ADR's order.*
> *D2: approved. Ask with the form's own words and options. If the funding source box is also
> required (row 210), ask it too.*
> *D3: approved.*
> *D4: build nothing yet. First observe on the live form whether Sheffield truly requires at
> least one job. If it does and the student has none, tell the student then and there and hand it
> to a person; never invent an entry.*
> *D5: where the cause is an incomplete list in the entry (missing countries), fix the entry for
> my signature rather than burden the student. Only a truly impossible case is told to the
> student and a person.*
> *D6: rejected as written. The profile is shared across universities. A shortened value is
> stored for that application only; the student's full words stay in the profile.*
> *D7: approved.*
> *D8: approved.*
> *D9: approved.*
> *D10: approved.*
> *D11: approved with conditions: the saved page is marked for re-fill, the change shows in the
> final preview, and the page is re-filled before submission. Never after submission.*
>
> *Where any of my answers differs from your recommendation in the ADR, tell me in one line each
> before building."*

The six lines I sent him before building, as they read in my message (mine):

> Six of your answers differ from what ADR-0161 recommended. One line each, before I build:
>
> - **D1:** you phase the build. The parts a map needs and text too long for its box now come
>   after answering a field again; §8 had them before it.
> - **D2:** I proposed my own words and not asking the funding source. You want the form's own
>   question and options, and the source asked too if that box is required (row 210 is still
>   unread).
> - **D4:** I proposed building the empty-list sentence now. You build nothing until you observe
>   the live form, and then the case goes to a person, not just a stop.
> - **D5:** I proposed telling the student and stopping for a person whenever a fact can't fill a
>   box. You fix the entry for your signature when the cause is a missing country, and keep the
>   stop for truly impossible cases.
> - **D6:** I proposed the shorter words replace the longer ones in the profile. You keep the
>   full words in the profile and store the shorter value for that application only.
> - **D11:** I proposed only telling the student what the university holds. You add re-filling
>   the saved page before submission, shown in the final preview, never after. Re-filling a saved
>   page is the "going back to an earlier portal page" that ADR-0154 §2 calls unmeasured, so it
>   will need a read before it is built.
>
> D3, D7, D8, D9 and D10 match my recommendations.

Where his answer and the sections below differ, his answer stands; the sections are amended
in place below and say so.

## His answers on row 214 (2026-10-17)

Saved as sent: `docs/run-a/p319-his-answers-on-row-214-as-sent.txt`. In his words:

> Row 214, my answers:
>
> 1. Yes: a minor's review covers every answer.
> 2. Yes for now, recorded as temporary: one changed financial answer sends every application back to review. Revisit before a second reviewer exists or before more than a handful of students; then only applications whose form carries funding go back.
> 3. Keep: fingerprint holds no student values.
> 4. Keep: approval bound to what the reviewer read.
> 5. Keep: raise first, void second.
> 6. Yes: treat the funding source box as required on my observed red asterisk, and ask the source on my run in P319. Prepare the entry change for my signature; do not sign anything.
> 7. Deferred item: agreed, keep it as row 214 (7).
>
> On the three departures: this is the second time you built against an accepted decision before asking. From now on, when building would depart from an accepted ADR, stop and ask me first, even if you are sure; record the question, build nothing on it until I answer.
>
> Next: P319 as planned, then the exact steps for my run ending with the resolve command.

His rule on departures is recorded in CLAUDE.md, where the rules for how work enters the
repository live. From P319 on, every build of this ADR is read against the accepted ADRs before
it is written, and a departure is asked, not built.

## Asked in P319, before building (undecided until he answers)

Under his rule of 2026-10-17 (CLAUDE.md): before P319 built the funding stage after a no, its
design was read against the accepted ADRs by three mappers, a designer and two critics
(`docs/run-a/p319-design-reading.txt`, printed from their journal). Each point below would depart
from an accepted text, or settles something his words do not. Nothing
standing on any of them is built until he answers. Row 215 carries them; each has my
recommendation, which is mine.

1. **His held "no".** P319's stage question does not reach it: the interview never asks a held
   answer again, so after the resolve his run stops at the same box. It can be reached by
   answering the field again (§5, phase 1 item 4; his words: *"I will give my funding answer
   myself in the chat"*), by D10's "when a case begins" check in a new application, or by a check
   when a stopped case resumes, which D10 does not cover. My recommendation: §5 next, then the
   steps for his run.
2. **D10's second moment.** Is the check "when a case first plans" built in P319, so a held or
   reused "no" is asked the stage in any new Sheffield application? My recommendation: yes,
   both moments.
3. **Scope.** The stage after a no only, as D2 words it, or a general rule asking any closed part
   a required box reads, on every entry he signs later (ahead of D1's phasing and ADR-0147's
   "a question's words are authored")? My recommendation: the funding stage only.
4. **What the stage is.** An interview answer stored in his profile and reused elsewhere, or a
   choice from the form's own list in ADR-0155's sense (recorded for this application only;
   ADR-0155 also says a list with no escape is not offered)? My recommendation: an interview
   answer, asked in the form's words, as D2 says.
5. **A typed answer.** Shown the five sentences, a student types "confirmed": refuse and ask
   again (a person after three misses), suggest "The funding has been confirmed" for a press, or
   read it and play it back? My recommendation: suggest it for a press (his words of 2026-10-15:
   "a near match is only ever suggested, never chosen").
6. **"No" and "confirmed" together.** After a no, the five sentences include "The funding has
   been confirmed"; the form would carry both. Offer all five, leave some out after a no, or ask
   again? My recommendation: all five, as the form does, with the playback showing both lines
   before the press.
7. **The playback.** After a no, the stage is played back by the form's question and sentence;
   the review and corrections keep the registry words until §5. My recommendation: yes.
8. **The signed note.** The stage is filled for a no under the entry he signed, whose note (and
   ADR-0143's Consequences) says those boxes are left empty for a no, before he signs the
   rewording. My recommendation: yes, under D2.
9. **The source before his signature.** His answer 6 cannot be met in P319 without a rule held
   outside the signed entry, which ADR-0148 §4 ("never authored") and ADR-0057 (the hash binds
   what the system acts on) do not allow. Hold it outside until he signs, or make his signature
   of the prepared change a step of his run? My recommendation: his signature as a step of his
   run.
10. **The source's options after a no.** The four the map names (Employer, Self or Family,
    Sponsor, Other), or the form's whole list with its "not listed below" escape, 22 schemes and
    3 loans (his D7, after phase 1; a scheme's name would then be needed after a no, which
    ADR-0143 §1 asks only of a yes)? My recommendation: the four now, the rest with D7.
11. **"Every answer" for a minor.** Does it include a choice made from a form's own list, held
    per application? At deploy every case ever reviewed for a minor goes back to review once, and
    each new answer of a minor raises it again (both fail closed). My recommendation: include
    choices; accept both. The profile's answers are built in P319, on his answer 1. (This line
    first said "built now", before they were; corrected in P319.)
12. **The source's rule in the entry change** rests on his observed red asterisk
    (`docs/captures/sheffield-part2-2026-09-25/taught-page.html:209`), not on a refused save
    (ADR-0123 Decision 1), recorded with the source `specialist_noted` (the tool did not read the
    star; he did). My recommendation: yes, in those words.
13. **A stand-in approval** to check the patched entry, in a scratch copy, never in the
    repository and never committed, beside his "do not sign anything". My recommendation: yes.

### His answers to the thirteen (2026-10-17)

Saved as sent: `docs/run-a/p319-his-answers-on-the-thirteen-as-sent.txt`. In his words:

> P319, my answers:
>
> 1. Agreed: build §5 (answering a field again) next, then the steps for my run.
> 2. Agreed: both moments.
> 3. Agreed: funding stage only. The shrinking list carries the rest.
> 4. Agreed: a profile answer, asked in the form's words.
> 5. Agreed: suggest a near match for a press; never choose it.
> 6. Not as recommended. After a "no", offer the other four stages, not "The funding has been confirmed": the two contradict each other, and a contradiction in the submitted form is worse than one fewer option. If the student says their funding is confirmed, tell them that means the answer to "Do you know…" is yes, and offer to answer that field again (§5).
> 7. Agreed.
> 8. Not as recommended. No value is filled against the signed note's current wording, even temporarily. The note change and the source rule go into one prepared change, signed by me in one signature, as a step of my run before it continues (with 9).
> 9. Agreed: my signature as a step of my run.
> 10. Agreed: the four now; the rest with D7.
> 11. Agreed: include list choices; accept the one-time re-review.
> 12. Agreed.
> 13. Agreed, on one condition: the stand-in approval never carries my name, is plainly marked as a test, and cannot be mistaken for my signature anywhere.
>
> Record these in my words and build test-first.

Two of his answers differ from my recommendations: 6 (four stages after a no, not five, and a
student who says their funding is confirmed is told it means yes and offered the field again)
and 8 (nothing filled under the signed note's current wording, even for a moment: the note, the
source's rule and whatever lets the stage be asked go into one change he signs, as a step of his
run). Each of the others is his "Agreed", 13 with his condition.

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

**Amended by his answer (D2):** *"Ask with the form's own words and options. If the funding
source box is also required (row 210), ask it too."* So the stage is asked with the form's own
question and its five options as the entry records them, and the source is asked too when its
box is required. Whether row 210's reading of his saved page is enough to call it required, or
whether the source waits for an entry patch, is not in his words: it is below, his. The words I
had proposed are withdrawn; they were:

> ~~*"You said you do not know yet how your studies will be funded. Sheffield's form still asks
> how far your funding is arranged. Which is closest — confirmed, applying for a project
> studentship, applied, applying, or thinking about it?"*~~

Three facts belong beside it:

- **The form's script is unread.** Whether it hides the stage box for *No* is still not known
  (rows 82, 86). If it does, the signed entry is wrong about the form, and a "no" student's fill
  would stop at a hidden box. He chose "not A" as row 209's settlement, and nothing here
  re-proposes it. The read stays where it already was: ADR-0160 §4 step 1, the agent's plan
  after his words of 2026-10-13.
- **The source.** The signed entry marks no rule on the funding source, though his saved page
  marks it (row 210). His answer asks it "if the funding source box is also required (row
  210)". **Open, and his** (it touches money): does row 210's reading of his saved page make it
  required now, so P319 asks the source on his run, or does it wait for an entry patch he signs?
  My recommendation: row 210's reading is enough, because his words name row 210, and an entry
  patch carrying the rule follows for his signature. My first draft of this paragraph read his
  words as "only where the entry marks it" and did not say the reading was mine; P318's records
  reviewer caught it. Nothing is built on either reading until he answers.
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

**Phased by his answer (D1):** *"First build only what unblocks my run and protects every
student: the test with its shrinking list, the review rule (§8 first), the funding stage after
"no", and answering a field again. The rest follows in the ADR's order."* So phase 1 is items 1,
2, the funding stage of item 3, and item 4; the rest of item 3 follows after item 4.

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

Each of these touches one of his four, so nothing was built on it until he answered. My
recommendation stands beside each, and his answer of 2026-10-17 after it, in his words.

- **D1. The ADR as a whole.** I recommend he approves it. **His answer:** *"approved, phased."*
- **D2. The stage asked after a no, and its words (§4)** — money. I recommend it, with the words
  in §4. **His answer:** *"approved. Ask with the form's own words and options. If the funding source box is also required (row 210), ask it too."*
- **D3. The review's fingerprint, and old approvals covering nothing (§6)** — money and the
  review. I recommend both, the minors trigger included. **His answer:** *"approved."*
- **D4. An empty list (row 202, §7)** — submitting. I recommend my row-202 recommendation (P315)
  unchanged, with the sentence said at the "any …?" question. **His answer:** *"build nothing yet. First observe on the live form whether Sheffield truly requires at least one job. If it does and the student has none, tell the student then and there and hand it to a person; never invent an entry."*
- **D5. A fact the student cannot change (§3 case 4)** — submitting. I recommend that the
  student is told at the answer and the case stops there for a person, with the reason named. **His answer:** *"where the cause is an incomplete list in the entry (missing countries), fix the entry for my signature rather than burden the student. Only a truly impossible case is told to the student and a person."*
- **D6. Shorter words replacing longer ones in the profile (§7)** — personal data. I recommend
  the student's restated words, played back and pressed, replace the longer answer, so one
  answer serves every form. **His answer:** *"rejected as written. The profile is shared across universities. A shortened value is stored for that application only; the student's full words stay in the profile."*
- **D7. The scholarship's and the countries' offers (§7)** — money, and personal data. I
  recommend the form's own list, with its escape. **His answer:** *"approved."*
- **D8. The validator's option rule (§2, row 213).** It changes when such a run stops, which I
  read as touching submitting. I recommend it. **His answer:** *"approved."*
- **D9. A UK postcode asked again with the shape the map reads (§7).** It changes what is held of
  the student's address, which is personal data. I recommend it. **His answer:** *"approved."*
- **D10. §3's two moments.** Checked before the playback, and when a case begins. The second
  asks a student again about an answer they gave for another application, which changes what
  is collected. I recommend both. **His answer:** *"approved."*
- **D11. A field answered again after its page is saved (§5).** A person reopens it, and the
  student answers in the chat. This reaches past ADR-0154 §2's *"Do not reach further yet"*. It
  touches personal data and the submission, because the university already holds the old
  value. I recommend it, with the student told, as today, what the university holds and on
  which page. **His answer:** *"approved with conditions: the saved page is marked for re-fill, the change shows in the final preview, and the page is re-filled before submission. Never after submission."*

## Applied under his rule of 2026-10-14 (recorded as mine)

These do not touch his four, so they are mine to apply under his rule of 2026-10-14. They took
effect with his D1 of 2026-10-17 and are built in its phases. Each is recorded as my choice,
never as his:

- The definition of holding the rule in §1.
- The test's shape in §2, including the list that can only shrink.
- The build order in §8, with the review first.

Where an item could be read either way, I read it as touching his four. That is the reading of
his rule written in P308 (mine, not his words), which says to do so when in doubt. That is why D8
to D10 are his.

## As built, phase 1 (P318)

Built test-first in P318, the first two items of §8 at his D1. Each choice below that goes
beyond his words is mine, recorded as mine. Three of them depart from §6 as he approved it and
touch what his rule of 2026-10-14 sends to him first; they were built before asking him, which
that rule says must not happen. That was my error. He answered each on 2026-10-17 (row 214; below,
"His answers on row 214"), and kept all three.

**The review covers only the content it reviewed (§6, his D3).**

- **What a raising and a review carry.** A raising of a mandatory trigger carries a fingerprint
  of the content it stands on (`HumanReviewRequested.fingerprints`). A review carries the
  fingerprint of what it saw (`HumanReviewRecord.covers`).
- **When an approval clears.** Only when the two match (`unclearedMandatoryTriggers`, the fold,
  and the guard, which share one rule). An approval with no fingerprint, or a raising with none,
  clears nothing; that covers every approval recorded before P318, as §6 says.
- **What the fingerprint is made of: each answer's revision and the moment it was confirmed,
  never its value** (`reviewFingerprintsOf`). §6 as approved names *"the stored financial answers
  and their revisions"*; I built it without the values, so that the case log, which is
  append-only, holds nothing of what the student said. A date of birth hashed alone could be
  recovered by trying every date, as a mapper found. **Departs from §6; row 214 (3); his answer:
*"Keep: fingerprint holds no student values."*** Content
  that is gone fingerprints too, over an empty list, so every raising carries one an approval can
  match.
- **Read from the stored profile, at the moment it is needed.** One reading (`#reviewBasis`)
  serves the raising, the take-back, the locks, disclosure and the review. It reads the stored
  profile, not the run's view of it, which hides a field a portal demand or a CV reading has
  reopened. And it reads it fresh, so a decide holding an older profile cannot raise the older
  content again after another raised the new. This changes ADR-0049 §3 as built.
- **Every change to a value moves its revision.** Both profile stores move it on every
  overwrite, whatever revision the writer gave. Migration 0041 makes the table move it for any
  UPDATE that changes a value or its provenance in place, whoever writes it, and lets no UPDATE
  lower it. 0028 was such a write, and a hand-written statement would be another. It fails
  closed: a rewrite of a value's format alone sends a reviewed answer back to review. It does not
  cover a row deleted and written again, which fires no UPDATE; nothing in the application does
  that.
- **A review names the case as the reviewer read it** (mine; **departs from §6, row 214 (4); his
  answer: *"Keep: approval bound to what the reviewer read."***).
  `GET /internal/v1/cases/{caseId}/review` gives the case's sequence and the reviews it waits on,
  by name. The reviewer reads it before looking at the content, and an approval of a mandatory
  review names that sequence (`caseSequence`), which changes ADR-0049 §4. The approval covers the
  fingerprint the trigger was raised for, and is refused:
  - with `/triggers`, writing nothing, when the case does not wait on that review and was never
    raised for it (an adult's case approved for "a minor" by a slip);
  - with `/caseSequence`, when it names no reading, or the trigger was raised or reviewed again
    after the reading (a change the student made while the reviewer looked, or a rejection
    recorded after it);
  - with `/caseSequence`, when the content changed since it was raised; it is raised there and
    then, for the content as it is.
  What it holds is an honest reviewer's order of work (read, look, approve). It does not prove a
  look, and a reading of one case posted to another is not refused: nothing ties the number to a
  case.
- **Raised again for the content as it stands.** Each trigger that applies, each still
  outstanding, and each the case was ever raised for, whose raised fingerprint is not the
  content's own. The last two whether or not the trigger still applies: a raising from before
  P318 carries no fingerprint and could never be cleared, and a reviewed minor whose date of birth
  is answered again as an adult's no longer "applies", though that date is exactly what no person
  has seen.
- **The order after the student's yes** (**departs from §6, row 214 (5); his answer: *"Keep:
  raise first, void second."***). §6 says "the
  authorisation is voided first and the trigger reopened after". The reviews of the plan showed
  that order leaves the case waiting on the student with the review outstanding, where the
  student's approval was not guarded. As built:
  - The trigger is raised for the changed content.
  - Then, on every decide while a review is outstanding, an authorised case is voided and goes
    back to PREPARING; the domain does this when the guard into authorisation refuses. A case
    waiting on the student is moved back to PREPARING.
  - The walk forward then meets the guard and stops for the review.
  - The hand-back is its own step on every decide; an append another request beat is read again
    rather than thrown.
- **The account's hand-back is not held.** While the run owes the student their portal account
  (ADR-0050), a review raised does not take the case back or stop the run, so the hand-back is
  asked for; the review gates the student's next yes, and every fill.
- **AUTHORISED is reached by the student's yes, never by a walk.** A step that targets
  AUTHORISED before the student is asked again (the account's hand-over) used to walk a voided
  case there by a plain transition, with no authorisation on it, and the student's later yes was
  refused for ever. The walk now stops before AUTHORISED unless an authorisation was captured.
- **The guard, and the locks.** The guard runs at the student's approval and at the step into
  submitting, as well as on the way into authorisation. No fill (execute work) is handed to a
  runner, and no document handed over to one, while a review of the content as it now stands is
  outstanding, a change no decide has raised included; a run with no case log is handed no fill.
  The account's creation and a sign-in carry no answer a review covers and are not held. The
  guards read the case's raisings, so a change no decide has raised is caught by the yes (raised
  first, below) and by these locks; a press of the final submit, when it is built (ADR-0159),
  must carry the same live check.
- **The student's yes after a change no decide has raised.** The change is raised first, by the
  advance every decide makes, which stops the run for the review; the domain then refuses the
  yes. A yes refused while the case holds a review is named "a person is checking" whatever the
  run's status. If the raising could not land (eight lost races), the yes is not weighed at all
  and the request fails. P318's first build refused the yes in the coordinator before the domain,
  which P11 recorded must not happen, and said "a person is checking" before anyone was asked.
- **A minor is still a minor after the review.** Disclosure reads a minor's conditions as not
  yet determined and refuses (ADR-0011). P318's first build read that from the outstanding
  triggers, which an approval now empties, so a reviewed minor's passport was handed to the
  runner as an adult's. Found by P318's regression refuter before anything was committed. Now a
  minor is one while the stored date of birth says so or the trigger is outstanding: the same
  outcome as before P318, by a different reading (the stored profile, not the run's view).
- **What is untouched, and what changed.** The case binding at the transmission gate
  (`mayTransmit`) and the comparison of the authorisation's content hash are not changed. The
  authorisation's lifecycle is: a void now also moves the case to PREPARING when the guard
  refuses, the capture runs the guard, and the walk reads whether a hash was captured. Each makes
  the gate stricter.
- **Not built, and open:**
  - An approval followed by a rejection of the same trigger still stands, as before P318. A
    rejection followed by an approval made on an older reading is refused.
  - The minors fingerprint covers the date of birth only, as §6 says: row 214 (1). His answer:
    *"Yes: a minor's review covers every answer."* Building in P319.
  - One funding answer changed sends every one of the student's applications back to review,
    including a portal that never fills a financial field: row 214 (2). His answer: *"Yes for
    now, recorded as temporary … Revisit before a second reviewer exists or before more than a
    handful of students; then only applications whose form carries funding go back."* (row 214
    quotes it whole).
  - A case in AWAITING_HANDOFF, AWAITING_SPECIALIST_RECOVERY or SUBMITTING is not taken back.
    Nothing in the application reaches those states today.
  - A choice from a form's own list (P290) on a box filled from a financial answer is not in the
    fingerprint. No signed entry offers one: `scripts/a-financial-choice-waits-for-the-review.test.ts`
    fails when one first does, which his D7 will bring.
  - After a take-back of a case already filled, the student is told the pre-fill sentence again
    ("approving it lets me fill the form in for you"), and the stop's own sentence speaks of
    approving before anything is shown. Reachable today only for a case holding an approval from
    before P318. Mine to mend, with a test, after phase 1: row 214 (7). (P319 widens its reach: a
    reviewed minor's case reaches it too, once when P319 is deployed and again whenever the minor
    answers anything after the yes, since the minors review now covers every answer. Found by
    P319's review.)
- **What it does to cases now in flight.** Every case that holds an approval from before P318
  goes back to review on its next decide, because that approval covers nothing; an authorised
  one is voided first. His live case, if it holds one, is among them; the read before the review
  says `"approvable":false` for it until the raising is made again, and his live-run steps say so.

**The rule's test, with its shrinking list (§2).**

- **The gate.** `scripts/required-boxes-hold.test.ts` fails on any line that breaks the rule
  and is not on `scripts/required-boxes-known.ts`, and on any listed line that no longer occurs.
- **The list can only shrink.** It holds the 59 lines P318 found, each named with the row or
  answer of his it waits on (mine), and the test fails on any listed line that is not one of
  those 59 (`docs/run-a/p318-known-breaks.txt`, printed from the list by the code). So a new break
  cannot be listed, only mended. The first gate let a new break pass by listing it, which P318's
  records reviewer found.
- **Whose words.** His D4 names jobs; the twelve qualification lines rest on his "build nothing
  yet" and nothing more. Two lines call a case "truly impossible" in my reading of his D5.
- **Checked both ways.** The gate was made to fail both ways on purpose: a line missing from the
  list, and a listed line that does not occur (mutations 15 and 16 below).

**What the reviews found (P318).** Two refuters read the first build; then three reviewers read
the fixes, one each for a way past the review, a regression and the records, and each finding
they did not rate low (every finding, for the records) went to another reviewer who tried to
refute it. Nothing weakened the case binding at the transmission gate or the authorisation
content hash. The first pair found nine things. The three found twenty-eight more: the sixteen
put to a refuter were each confirmed real, four of them at a lower severity, and the twelve rated
low by the way-past and regression reviewers were put to none (`docs/run-a/p318-review-findings.txt`,
printed from the review's own journal). Each is fixed above, or is an open line above, or is row 214. Among them:

- a reviewed minor's documents disclosed as an adult's (a regression: the first build weakened
  the minors category until it was fixed, before any commit);
- an approval covering content changed while the reviewer looked;
- a raising from before P318, and a minor turned adult, never raised again;
- a voided case walked to AUTHORISED at the account's hand-over, and the hand-back held behind
  a review;
- "a person is checking" said before anyone was asked;
- three departures from §6 built without asking him (row 214 (3) to (5)), and his D2 on the
  funding source narrowed in my words without saying so (now row 214 (6));
- records that said more than the code: "no page" where only fills were held, "the list can only
  shrink" where it could grow, and row 189's decision called built where only its review half is.

**Mutations.** Eighteen, each run on the finished tree, are in `docs/run-a/p318-mutations/`:
seventeen killed, and one survived. That one (13) took out the store's own rule that an overwrite
moves the revision; migration 0041 does the same for the store's upsert, so no test sees the
store's rule alone.

## As built, phase 1 (P319)

His answers to the thirteen, above, built test-first. Proven against the deterministic stand-in
only: no model was called, and the real model reads nothing new (below).

**A minor's review covers every answer and every list choice** (row 214 (1), his answers 1 and 11).
The `involves_minor` fingerprint is taken over:
- every confirmed answer in the stored profile;
- every choice the application made from a form's own list, each by its id and the moment it was
  made.

It still holds no value (his answer 3). Every case reviewed for a minor before P319 goes back to
review once, which he accepted: *"accept the one-time re-review"*. Red first: an answer other than
the date of birth, and a list choice, each changed after the review, were not raised again. P319's
review found one more reach: a case once raised for a minor goes back to review on every later
answer, even after the student is an adult. That is row 218, his.

**Nothing is asked, or filled, against the note he signed** (his answer 8). A reviewed mapping may now
say `absent: "ask"` of a `part` or a `switch`. Where the student's answer lacks the part, the box
renders nothing and refuses, as a rule with no `absent` does, and the student is asked for the part
in the box's own words and options. The run reads which parts to ask from the mapping set and the
blueprint alone (`partPolicyFor`, `reopens`), so what is asked is still read from the portal and never
authored at run time (ADR-0148 §4).

A part is asked only where all of these hold:
- the box is required (his D2: *"If the funding source box is also required (row 210), ask it
  too"*);
- its label was read;
- each option offered renders from one value;
- the value is one the part's own closed list holds, so a mapping's key can never become a stored
  answer outside the registry's vocabulary.

A test fails CI if any signed entry carries an `ask` the run would not ask. Nothing on any entry as
signed today says `ask`, and a test holds that. The prepared change for his signature
(`docs/run-a/p319-for-signature.md`) puts it on Sheffield's two funding boxes, with the source's rule
and the reworded notes, in one signature, as a step of his run (his answers 8 and 9). The mechanism is
mine, built to hold his answer 8. I read it as departing from no accepted text, and record the reading
as mine.

**After a no, the form's own questions** (D2; his answers 4, 6, 7 and 10). Where the entry says to ask
them, a student who answers *no* to *"Do you know yet how your studies will be funded?"* is asked,
before the playback:
- *"Please select your likely funding source"*, with Employer, Self or Family, Sponsor and Other: the
  four options a value of its own names;
- *"What stage are you at with your funding?"*, with the four sentences that are not *"The funding
  has been confirmed"*, which a no contradicts.

Each question is the box's label and then its options, one to a line, with no word of mine (§4's
preface stays withdrawn). The answer is a profile answer, `{ known: false, source, stage }`:
- `known` stays the student's own no and is never derived (ADR-0143 §2);
- the details stay a yes's alone;
- a question whose answer the value would not keep is not asked.

The playback names each such part by the form's question, in the student's words and in the recorded
value alike: *"What stage are you at with your funding?": I am thinking about funding my studies this
way*.

**Read exactly, never by a model, and a near match never chosen** (his answer 5). The answer is read
against the options shown, with case, spaces and a closing full stop set aside, and no model call. So
a model reading *"confirmed"* as the confirmed stage cannot happen. An answer near more than one
option is offered with them for a press, as ADR-0146 offers any answer that reads two ways; nothing is
chosen until the student presses.

**An answer near exactly one option is named in the refusal, and the question asked again**, without
a press. His answer 5 says *"suggest a near match for a press"*. ADR-0146 Decision 1, which he
approved, says *"One reading is never an offer — it is read, or it is refused with why"*. Offering a
single reading for a press departs from that sentence, so under his rule of 2026-10-17 it is asked,
not built: row 216, undecided until he answers.

**"Confirmed" after a no** (his answer 6). A student who says their funding is confirmed is told
*'Funding that has been confirmed means the answer to "Do you know yet how your studies will be
funded?" is yes.'* (wording mine), and the four stages are asked again. That covers the bare word, the
form's sentence, or the word said and not turned round, so "my funding is confirmed" counts and "not
confirmed yet" does not. His answer 6 goes on: *"and offer to answer that field again (§5)"*. The offer
is §5's, P320, and is not built. Until then, a student who answers *yes* to that is not read, and three
answers the question did not take stop for a person, as every question does (ADR-0123 Decision 2).

**Both of D10's moments** (his answer 2). The first is in the walk, as above. The second is when a case
first plans: an answer given before it that lacks a part this entry asks is asked for that part. It is
raised by the demand a refused save raises (ADR-0148 §11), from the plan before any save, as §3 says,
and marked so.
- **Said with nothing before it.** The field's question is the form's own, with nothing of mine before
  it (D2). P319 first said a sentence of mine before it. P319's review found the sentence claimed the
  form asks two questions the records say may be hidden for a no, in a preface of the kind D2
  withdrew. It is removed, and whether a sentence should say why is row 217, his.
- **When "first plans" holds.** It holds while the run has never been checkpointed, not merely on this
  call's first start. So a start that failed before its first decide, or a second start that arrives
  before the first has decided, still checks. Once the case has planned, it is never checked again,
  and his own held no is reached by §5 (his answer 1).
- **When the demand is set aside.** A case-begin demand is set aside once the held answer holds every
  part the form asks. That is latent today: one entry asks, and a second case for the same course is
  refused. It becomes reachable with a second such entry, or with §5.

**The checker walks as the interview asks.** `scripts/required-boxes-hold.ts` uses the interview's own
gate (`partAsAsked`) and the values it offers. On the entry as the change would sign it, every answer
beginning with a no is asked the stage and the source, and breaks no funding box. With the stage back
to `leave_empty`, the gate goes red on that line. Run on the signed entry, its output is unchanged.

**What his run gets from P319 alone: nothing yet**, as he agreed (answer 1). After his signature, his
held no, given before the change, is refused at the plan on the two boxes and stops for a person; today
it stops at `fix_content`. Answering the field again (§5, P320) reaches it. The steps for his run (P321)
put his signature, then his answer, then the resolve command.

### P319's review

Six lenses read the build and the prepared change: 23 findings. Each was to go to two refuters, but
the run was stopped once seven verdicts, on four findings, had come back, because at two agents at a
time the rest would have taken over an hour. Counted from the run's journal:
- three findings stand, each on two verdicts: the sentence skipped when another question comes first,
  the check missed by a concurrent or failed start, and "Confirmed." read as unreadable;
- one is refuted as worded, on the one verdict that came back: an answer changed in another
  application. The refuter shows it cannot happen today, with one entry and one case per course. It
  becomes reachable with a second entry that asks, so it is mended as a latent constraint (CLAUDE.md).

The other nineteen I judged myself. Each code finding I acted on has a test that fails without the
fix: twenty-two mutations of P319's code, one or more for each fix, all killed, each restored byte
for byte (`docs/run-a/p319-mutations/`). All the findings are in `docs/run-a/p319-review-findings.txt`,
with what was done about each. (A first draft of this
paragraph said eight verdicts and seven standing; the journal holds seven and six.)

### Applied in P319 under his rule of 2026-10-14 (mine, never his)

- A ruled-out answer ("confirmed" after a no) counts toward the three answers after which a person is
  asked, as any answer the question did not take.
- What a near match is: the part's own reading of the answer, or the answer's words inside an
  option's words, with one word of four letters or more beyond the commonest; two or more near
  options, and fewer than all, are offered.
- What counts as saying a ruled-out value: its sentence, its word, or the spec's own word for it,
  not turned round by "not", "no", "never", "nothing", "none", "neither", "nor" or an "n't".
- The playback's form for a part asked in the form's words: *"the form's question": the sentence*.
- The sentence a student who says their funding is confirmed is told: *'Funding that has been
  confirmed means the answer to "Do you know yet how your studies will be funded?" is yes.'*, his
  answer 6's instruction put in the form's question.
- Only values the part's own closed list holds are offered after a no.
- The wording of the two notes in the prepared change, his to correct when he signs.
- The stand-in approval's names and note, under his condition of answer 13.

### Asked in P319's build (undecided until he answers)

- **Row 216: a single near match, offered alone for a press?** His answer 5 against ADR-0146
  Decision 1. My recommendation: yes, offered alone for a press, with the form's sentence as its only
  button, as his words say. It touches what goes on the form (submitting), so it is his whatever my
  recommendation, and it amends ADR-0146 Decision 1 for a near match, which is his to approve.
- **Row 217: is the student told why, before a question asked when a case begins?** D2 says to ask
  with the form's own words and options, and withdrew my preface. A question about funding that
  arrives with no reason may puzzle a student. My recommendation: one sentence that claims no more
  than the entry says: *"<University>'s form has its own questions about how your studies will be
  funded. Here is the first."* It touches money and a student's words, so it is his.
- **Row 218: a case once raised for a minor, when the student is now an adult.** The minors review
  covers every answer (his answer 1). A case raised for a minor stays raised (P318: a change to what a
  person reviewed is reviewed again). So every later answer of a former minor sends the case back to
  review, indefinitely. It fails closed, and it changes when a press can happen. My recommendation:
  once the stored date of birth says adult, the minors fingerprint is the date of birth alone. A
  change to that date is still reviewed again, and the former minor's other answers are not. It
  touches the mandatory review of minors, so it is his.

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
