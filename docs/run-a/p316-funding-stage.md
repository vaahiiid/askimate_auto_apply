# The funding stage his run stops on (P316)

His words (`docs/run-a/p316-his-message-as-sent.txt`): *"§1 shows the halt: iv_5c3c16a2…,
specialist:content_rejected, 1 violation: fundingStage required … This is my "no" to "Do you know
yet how your studies will be funded?", given and confirmed today … Funding touches money: give me the
facts, I choose the answer."*

Facts only. Nothing here chooses an answer for him, writes to his database or resolves anything.
Each fact says where it was read or how it was measured.

## 1. The box and its options

Read from the signed entry (`docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json`, page 12,
*"Course choice — Part 2, one taught course"*):

- **Label:** *"What stage are you at with your funding?"* (`fundingStage`), a select.
- **Rule:** `required`, from the form's own marker (`observed_marker`: the red asterisk after the
  label in the saved page).
- **No condition:** the entry shows it whatever the answer to *"Do you know how you want to fund
  your studies?"* is. Neither the box nor its section carries a `visibleWhen`.
- **Options, in the form's own order and words** (value and label are the same):

  | # | Option |
  |---|---|
  | 0 | Select... |
  | 1 | The funding has been confirmed |
  | 2 | I am applying for a project studentship |
  | 3 | I have applied for funding |
  | 4 | I am applying for funding |
  | 5 | I am thinking about funding my studies this way |

- **Where they were read:** his own read of 2026-09-25, on his account, pressing nothing (his commit
  `581070e`; `docs/captures/sheffield-part2-2026-09-25/taught-page.html`). The saved page holds the
  same six options in the same order. *Select...* is the form's empty choice: what the run plans
  for a box it leaves empty is `""`, which the `required` rule refuses.
- **Whether the form hides it for *No*: unread.** In the saved page neither radio is ticked and
  all three funding rows (source, details, stage) are shown (`display: block`). Both radios call
  `fundingSourceKnownChanged()`, whose body is in `studyprogrammetaught.js`, which was never
  captured (rows 82 and 86).

## 2. What fills it, and which of his answers would fill each option

The mapping (`mappingSet`, `fundingStage`) reads one profile field, `finance.funding`, and one part
of it, `stage`. An absent part is left empty. The interview's words (`FUNDING_STAGE_WORDS`,
`packages/interview/src/field-specs.ts`) are what he would say:

| He says | Held as `stage` | The box gets |
|---|---|---|
| *confirmed* | `confirmed` | The funding has been confirmed |
| *applying for a project studentship*, or *project studentship* | `project_studentship` | I am applying for a project studentship |
| *applied* | `applied` | I have applied for funding |
| *applying* | `applying` | I am applying for funding |
| *thinking about it*, or *considering* | `considering` | I am thinking about funding my studies this way |

The `stage` part exists only after a *yes*. The interview asks, in this order:
1. *"Do you know yet how your studies will be funded? Please answer yes or no."*
2. Only after a yes: *"Who is paying — self or family, employer, sponsor, scholarship, loan, or
   other?"*
3. Only after a yes: *"How far is the funding arranged — confirmed, applying for a project
   studentship, applied, applying, or thinking about it?"*
4. Only after a yes, and optional: *"Who is funding you — the name of the sponsor, scholarship or
   employer, or none?"*

A *yes* is held only with both a source and a stage. A *no* is held as `{known: false}` and nothing
else.

The other three funding boxes on page 12, from the same field:
- **"Do you know how you want to fund your studies?"** (`fundingSourceKnown`, required): *Yes* for a
  yes, *No* for a no.
- **"Please select your likely funding source"** (`fundingSource`): **no rule in the entry, but his
  saved page marks it with the same red asterisk as the stage** (`taught-page.html`, the
  `fundingSourceRow` label, against the `fundingStageRow` label). The read tool did not record it: it
  skips a row whose text is longer than 400 characters (`observe-script.ts`), and this one holds 32
  options (row 210).
  - self or family → *Self or Family*; employer → *Employer*; sponsor → *Sponsor*; other → *Other*.
  - A scholarship or a loan is named by the name he gives, onto the twenty-two scholarships and
    schemes and three loans the list carries, exactly as the form prints them. A name the list does
    not carry, or no name at all (the name question is optional), cannot be put in the box, and the
    run stops before the fill for a person (measured below for a name not carried). What it then
    says to him was not part of this read. The form's own *"Scholarship or studentship (not listed
    below)"* is never chosen by the map.
- **"Please enter details of your funding source:"** (`fundingDetails`, at most 118 characters): the
  name, if he gives one.

**Measured.** `npx tsx scripts/content-stops-on-sheffield.ts --funding`, its output saved as
`docs/run-a/p316-funding-on-page-12.txt` and pinned by its test. It plans Run A's synthetic profile
with each funding answer in turn through the run's own planner and validator:
- His *no*: *No*, then three empty boxes, and the one violation, `fundingStage` required. That is
  his stop.
- A yes with each of the five stages: the stage's sentence above, and no violation.
- A scholarship the form lists (*Chevening Scholarship*): planned, no violation. One it does not
  list: the run stops on the source box instead.
- Only these eight answers were run: his *no*, the five stages with one source (self or family), and
  the two scholarship names. Employer, sponsor, other and loan were not.

## 3. Changing his answer in the chat today: no path

**No sentence the correction reader accepts reaches his funding answer.** A correction finds the
answer it changes by the words that answer holds, and a held *no* is a yes-or-no, not words: both
finders, `placesHolding` and `placesSaying`, read only text
(`apps/conversation-service/src/correction-requests.ts`). That is read in the code; what was
measured is narrower:
- **Measured** on the reader's own functions (`correction-requests.test.ts`, P316), on a map holding
  his funding *no* and two other answers, not on his profile: *"it's yes, not no"*, *"change my
  funding answer from no to yes"*, *"change my funding from No to Yes"*, *"my answer to do you know
  how your studies will be funded is yes, not no"* and *"my funding stage is confirmed, not
  nothing"* each find nothing.
- **Read in the code:** with no question open, the usual state while the run is held, he is then
  told *"None of the answers you have confirmed says "<the word after *not*>", so nothing has been
  changed. Tell me the answer exactly as you gave it and what it should be …"*. With a question
  open, nothing replies. Either way nothing changes.
- On his own profile, a sentence ending *"…not no"* can instead find **another** answer: one that
  holds the word *No* as typed, or a country held as Norway (the country table reads *no* as its
  code; measured with a scratch run of the reader, not kept). Then the playback names that answer,
  never his funding, and nothing changes unless he presses "Yes, that's right".
- *"I want to change my funding answer"* (read in the code): with no question open, it is answered
  with how to word a correction, and that leads back to the line above.
- *"yes"*, *"confirmed"*, *"I know how my studies will be funded"* (read in the code): not read as a correction. While
  the run is held, they are kept on the log as he sent them, change no answer, and nothing answers
  them (row 206), unless a question of another kind is standing (the CV's, a deletion's, the
  details offer's), which takes the line as its own answer and still leaves funding as it is.

**Even if one were found,** the stage and the source are refused as financial: *"… which a person
on the team checks, so I cannot change it from your words here. Nothing has been changed."* That
refusal is the agent's choice, kept from before P311, and whether it stands is his to decide,
undecided (ADR-0154 as amended in P311; row 189 (1)). The free-text name (details) of a held yes is
changed from words; he holds none. And a *yes* alone cannot be held: a known funding needs a source
and a stage. So any way to change his answer has to ask, or set, the whole funding answer again.

***"delete my answers"* or *"delete my details"*** raises a request, one per student and naming no
field, for a person to delete the details he confirmed; the person is told to read the conversation.
It does not change the funding answer alone. The request deletes nothing itself, and neither does closing it: the deletion
is not built (row 130). *"delete my funding answer"* is not read as that request: it is answered about
documents, and changes nothing.

**No other path exists today**, short of editing his database by hand:
- **A person's resolution** takes no value, and for a content stop it asks nothing. A resume
  re-plans the same *no* and stops again at once, under a new intervention (row 205).
- **The interview** never asks a held answer again. A *no* is a complete answer, and the stage's
  empty box is not a missing value (`absent: leave_empty`), so nothing reopens it.
- **The mechanisms that do reopen a held answer** cannot reach this one now. The CV's reopenings
  cover only the two lists a CV seeds. The portal's demands follow only a filled page the portal
  refused, and no page is filled while the run is at this stop. Even later, a demand on page 12
  could not ask the stage after a *no*: the stage is asked only after a yes, so it would end with a
  person, not a question.
- **A new application** reads the same profile. Profiles are per student, so the *no* carries over.
  And one cannot be started while this one is held: a second start is refused as already applying,
  and applying again needs this case concluded first.

## 4. What could settle it, each his to choose (it touches money)

Nothing below is built, and nothing will be until he answers.

- **A. His answer stays *no*.** The form itself may hide the stage for *No* (his expectation, unread).
  - The read that settles the browser's side is ADR-0160 §4 step 1: save `studyprogrammetaught.js`
    from his browser, unchanged, with no console snippet. That step is the agent's plan (ADR-0160 §4,
    written after his words of 2026-10-13, *"Read studyprogrammetaught.js (row 82) … read-only"*);
    ADR-0160 says it *"also settles rows 82, 84 and 86"*.
  - If the script hides the stage row for *No*, the entry would carry that as a condition on the
    stage, and the same on source and details. That is a patch for his signature.
  - With it in place, a *no* passes the run's validator, and he resolves the stop with the command
    below. Whether Sheffield's server takes a *No* with the stage hidden is known only at the save.
  - If the script does not hide it, the form itself marks a stage and a source for a *No* student,
    and A ends there.
- **B. His answer becomes *yes*, with a source and a stage.** This needs building: a way to ask the
  funding questions again on his word. A choice in a financial answer is not changed from words
  today; that refusal is the agent's choice and his to decide (row 189 (1)). Any such way must also
  refuse a bare change of *Do you know…*. It decides which other parts exist, as a passport's *held
  or not* does, and the correction reader does not guard it today: if it were ever found, the
  playback would offer the typed word in place of the answer, with no source or stage (read in the
  code, not tested). It cannot fire now, because a yes-or-no is not found by words.
- **C. A person sets a yes with a source and a stage for him.** This needs building: the resolve
  command takes no value.

**My recommendation (mine, not his):** A first. Its first step is one read, already written as
ADR-0160 §4 step 1, which serves page 12's other question too; the read itself changes nothing, and
if it shows the hide, A continues with an entry patch for his signature, after which his true *no*
goes through as he gave it. B only if his true answer is now *yes*.

**Then, whichever is in place, the last step:**

```
AAS_CONVERSATION_URL=http://127.0.0.1:4870 AAS_SERVICE_CERT=browser-runner pnpm run interventions resolve <the full id from §1, iv_5c3c16a2…> --specialist "Vahid Mohammadi" --did-not-happen --actions "<what changed>" --resolution "<resumed after it>"
```

`--did-not-happen` is the one taken. A resolve before the change stops again at once. After it, he
is first told the application is moving again. Then, unless an approving financial-evidence review
is already recorded on this case, the run stops for that mandatory review before the preview (any
held funding answer raises it, a *no* included): *"Before I show you your University of Sheffield
application to approve, a member of the team needs to check it over …"*. His P308 steps (step 7)
say how that review is recorded and its stop resolved. Then comes the preview of the whole
application for his approval. Page 12 is held: the run stops before opening it, until the hold is
lifted on his words (ADR-0160 §2 and §3).

## Cost

Nothing metered: every fact here was read or measured on synthetic values, with no model. The read
in A is his, in his own browser.
