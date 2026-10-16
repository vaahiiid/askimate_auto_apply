# The halt after the residence list, and how to read it (P315)

His words (`docs/run-a/p315-his-message-as-sent.txt`): *"Read-only, without guessing: which
intervention was raised, its kind and its reason text, from the code and my database. Give me the
command to show it and tell me how to resolve it so the run continues."*

Nothing below writes to his database or resolves anything until he chooses to. §1 asks the
service, through a read that changes nothing. §2 runs in a session Postgres itself holds read-only.
§4, and any correction in the chat, write through the service, and are for him to run.

## What the code says the halt is

- **The page's line** *"Something in your application needs putting right before it goes further.
  It is with a member of the team, and I will come back to you."* is the line for the step
  `fix_content` (`apps/conversation-service/src/client/words.ts`). It is shown only while the run's
  status is `running`; once a person holds the run the line becomes *"Your application is with a
  member of the team. I will come back to you."*
- **`fix_content` comes from validation.** The orchestrator returns it only when every value the
  form needs is held (no missing value left) and the planned content breaks a rule the signed
  Sheffield entry records for a box, or fills a box the entry does not know
  (`packages/orchestrator/src/run.ts`, `nextStep`). The rules are each box's own (`required`,
  `maxlength`); no rule compares one answer with another. An answer can show or hide a box, and a
  hidden box's rules are not checked.
- **The intervention it raises** is raised by an advance of the run, in his journey the worker's
  next pass, a few seconds after the list is confirmed; never by a typed line or a press. A
  confirmation records the answer and asks the next question, if there is one; only an advance
  stops for a person (`#stopForSpecialist`, `apps/conversation-service/src/run-driver.ts`). It has:
  - target (its kind): `specialist:content_rejected`;
  - reason column: `information_unobtainable`, the default, because no reason is passed (row 200);
  - priority: `high`;
  - `encountered` (its reason text): *"The portal would reject the content as planned, and this
    system cannot ask the student to change it from here: … N violation(s): "<box label>"
    (<box>[, entry k]): <rule> [<bound>] [<source>]. A person decides whether the blueprint's rule
    is the portal's, whether the mapping should cover the box, or whether the student is asked."*;
  - and one message to him: *"I have paused your University of Sheffield application and passed it to
    a member of the team. Their form would not accept something in it as I had planned to enter it
    …"*. That message names no box (row 204, his).
- **The chat says whether it was raised.** Short of a reload or something he does on the page, the
  page re-reads the run only when something new reaches the conversation's log through its stream
  (`listen`, `client/journey.ts`; the stream looks every second). A change of the run's status
  alone writes nothing there. The stop's message is written there, so once it is written the page
  normally re-reads within about a second and shows *"Your application is with a member of the
  team. I will come back to you."* A page that keeps the `fix_content` line **with no "I have
  paused…" message in the chat** fits two states:
  - the run is `running` at `fix_content` and **no intervention has been raised**: the worker is
    not running, or does not reach this run, or its advance of this run fails or refuses on every
    pass, and a failure is counted and nothing is written about it (`advancePass`,
    `apps/worker/src/worker.ts`; row 207);
  - or the page's stream stopped bringing new lines (row 194, open; he met it in P313), and the
    message is there but not shown.

  A reload tells the two apart, and §2 (1) says which. With the message in the chat, the
  intervention exists, and the line is one read in the moment between the message and the hold
  (row 201).
- **A typed "yes" on the list's playback confirms nothing.** Read in the code: with a list's
  playback open, any typed line, whatever it says, is answered *"If one of them is wrong, press
  that period below and I will ask you about it again. If the list is right, press "Yes, that's
  right"."*, and nothing is recorded (`answerStudent`, `run-driver.ts`). Pinned for a typed "no" by
  `run-driver.test.ts` (*"does not throw the list away on a typed no: it says which button to press
  and keeps the reading open"*); put through the driver with "yes" in P315 on a scratch test that
  was not kept. While the list is not held, the plan lacks it on 20 boxes of the residence page,
  so the step stays the interview (measured: `scripts/content-stops-on-sheffield.ts`, its output
  in `docs/run-a/p315-content-stops-on-sheffield.txt`). A `fix_content` therefore means his
  profile holds the list. In this conversation only the press writes it; a value already held in
  his profile would do the same. §2 query (5) shows whether the profile holds it, and query (4)
  whether a press was recorded here.
- **Permanent residence Iran with a current period in the United Kingdom is not a rule anywhere in
  the code.** Measured with the same script, on Run A's synthetic profile with his residence answers
  put in: permanent residence Iran, and one period, the United Kingdom from May 2023, still there,
  as his message says; and two his message implies but does not state, that he lived outside Iran
  in the last three years (the list is asked only then) and that he lives in the UK now. Result: no
  missing value, no violation, no unknown box. The cause is in another answer of his, or a box the
  entry does not know, and only `encountered` says which.

## 1. The open intervention, through the service

From the repository root, with the stack up:

```
AAS_CONVERSATION_URL=http://127.0.0.1:4870 AAS_SERVICE_CERT=browser-runner pnpm run interventions
```

4870 is the stack's default port. If he started it on another, the port it runs on is the one line
`grep '^AAS_PORT=' .local-stack/conversation-service.env` prints (only that line: the file also
holds the database address and a secret).

It lists the open interventions. For this halt: `stuck on  advance_portal_page against
specialist:content_rejected` (two spaces, as it prints), and `what` is the `encountered` text in
full. It does not print the reason column; §2 does. If it lists nothing for his run, no
intervention has been raised: see §2 query (1).

## 2. His run, the interventions, his log and the answers involved, read-only

```
URL=`grep '^AAS_CONVERSATION_DATABASE_URL=' .local-stack/conversation-service.env | cut -d= -f2-`
PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -v student='5774ff16%' <<'SQL'
SHOW default_transaction_read_only;
\echo (1) the newest conversation, its case and its run
SELECT c.id AS conversation, c.case_id, r.run_id, r.status, r.revision, r.updated_at
  FROM conversations c LEFT JOIN workflow_runs r ON r.case_id = c.case_id
 WHERE c.student_id::text LIKE :'student'
 ORDER BY c.created_at DESC LIMIT 1;
\echo (2) the interventions on that case, newest first
SELECT i.intervention_id, i.reason, i.priority, i.checkpoint->>'target' AS target,
       i.raised_at, i.announced_at, i.resolved_at, i.resolution_outcome
  FROM interventions i
 WHERE i.case_id = (SELECT case_id FROM conversations WHERE student_id::text LIKE :'student' ORDER BY created_at DESC LIMIT 1)
 ORDER BY i.raised_at DESC;
\echo (3) what each open intervention met, in full
SELECT i.intervention_id, i.encountered
  FROM interventions i
 WHERE i.case_id = (SELECT case_id FROM conversations WHERE student_id::text LIKE :'student' ORDER BY created_at DESC LIMIT 1)
   AND i.resolved_at IS NULL;
\echo (4) the last 15 events of the newest conversation, newest first
SELECT e.ordinal, e.created_at, e.kind, e.actor, e.field_key, e.part_key, left(b.content, 120) AS said
  FROM conversation_events e LEFT JOIN message_bodies b ON b.id = e.body_id
 WHERE e.conversation_id = (SELECT id FROM conversations WHERE student_id::text LIKE :'student' ORDER BY created_at DESC LIMIT 1)
 ORDER BY e.ordinal DESC LIMIT 15;
\echo (5) the answers the likely violations turn on
SELECT field_key, value, updated_at FROM profile_entries
 WHERE student_id::text LIKE :'student'
   AND field_key IN ('residence.country', 'residence.history', 'residence.in_uk_now', 'residence.outside_residence_country_last_three_years',
                     'residence.always_in_residence_country', 'education.prior_qualifications', 'employment.history', 'finance.funding',
                     'contact.address', 'identity.passport', 'immigration.uk_status', 'immigration.uk_study')
 ORDER BY field_key;
\echo (6) the list choices recorded for this application
SELECT field_ref, item_index, student_value, chosen_label, is_escape, chosen_at FROM entry_choices
 WHERE case_id = (SELECT case_id FROM conversations WHERE student_id::text LIKE :'student' ORDER BY created_at DESC LIMIT 1)
 ORDER BY chosen_at;
SQL
```

`SHOW` prints `on`: the session cannot write. Then:

- **(1)** `escalated`: the intervention was raised, and the page line was read before the run
  was escalated, or the page's stream stopped (rows 201 and 194); a reload shows *"Your
  application is with a member of the team. I will come back to you."* `running`: no intervention
  exists. Run the session again about 15 seconds later. A pass of the worker that reaches a
  `running` run at this step raises the stop, so if it is still `running` with no intervention and
  the same `revision` (every save of the run adds one; `updated_at` is not the clock of the save),
  no pass is completing over it. `scripts/local-stack.sh status` shows whether the worker is up. If
  it is up, `grep 'worker job failed' .local-stack/worker.log`: lines there mean every pass of the
  worker fails; none means it is not reaching this run, or its advance of it fails or refuses, and
  **nothing records which** (row 207). Then there is nothing to resolve (§4 needs an
  intervention). Stop there and send what (1) to (6) printed. Finding that failure is a phase, not
  a step for him.
- **(2)** one open row, `specialist:content_rejected`, reason `information_unobtainable`,
  priority `high`, `announced_at` set.
- **(3)** the `encountered` text: the boxes and rules. This is the cause. It is written when the
  stop is first raised; while that row is open, a later stop of the same run for the same reason
  writes no new row (one open intervention per run and reason, migration 0007), so the text
  describes the content as planned at that first stop.
- **(4)** his `yes`, then *"If one of them is wrong, press that period below…"* (the typed yes),
  then a `value_confirmed` for `residence.history` (the press), and the line *"I have paused your
  University of Sheffield application…"* if the stop was raised. With no `value_confirmed` there,
  (5) says whether his profile held the list already; if it does not, the `fix_content` line does
  not fit this state.
- **(5)** and **(6)** the answers and list choices the likely violations turn on (§3).
- **Anything else** (another status in (1), or no run; more than one open row in (2), or another
  target; `announced_at` empty, which means the stop was raised and he was not yet told): stop and
  send what (1) to (6) printed, before anything below.

## 3. What the reason text means, and what clears it

Each violation reads `"<label>" (<box>[, entry k]): <rule> [<bound>] [<source>]`. The ones a path
like his can meet, read from the signed entry and the validator. Where his own messages in this
repository rule one out, the row says so; which one it is, only `encountered` says.

| `encountered` names | Meaning | What clears it |
|---|---|---|
| `"If your qualification is not in the list please enter it here:" (unlistedDegree, entry k): maxlength 28` | Qualification `k`'s award title went to the "not in the list" box, which takes 28 characters. **Not expected for him:** his doctorate's title is held as *DBA* (his message of P312: *"In the chat I corrected: e-mail, doctorate award title (DBA), … Each was played back and confirmed."*), and the choice he recorded was for it (P314: *"Not in list for HHE, DBA and International Business"*), 3 characters. | A shorter title, in the chat: `my doctorate award title is <shorter>, not <as held>`, then "Yes, that's right" on the playback. |
| `"If you cannot find your institution listed, please enter its name below." (unlistedInstitution, entry k): maxlength 95`, or `(unlistedSubject, …): maxlength 58` | The name taken for "not in the list" is longer than the box. **Not expected for him**, on the same words: *HHE* is 3 characters and *International Business* 22. | A shorter name, in the chat, the same way: `my … institution is <shorter>, not <as held>`. |
| `"What stage are you at with your funding?" (fundingStage): required` | His funding is held as not known, and the box is required (measured: the script's "funding not known"). **Not expected for him:** row 86 records that he knows his funding; (5) shows `finance.funding`. | Not in the chat: "not known" holds no words a correction can find, and the stage is asked only after a yes to *"Do you know yet how your studies will be funded?"*. It touches money, so it is his: a true stage, set by a person, or the entry's rule under his signature. |
| `"Start Date:*" (startMonth): required` with `position`, `employerDetails` and `duties`, no entry number | His job list was confirmed empty, and the employment page's boxes are checked as if one job were there (row 202; measured: the script's "a job list confirmed empty"). | Not in the chat; his to decide (row 202). |
| any other `maxlength`: address line 1 (35), town (50), international postcode (20, shown when the address's country is not the United Kingdom), job title (200), funding details (118), the highest qualification studied in the UK at level "other" (100), passport number (30) | That answer is longer than the box. These are the only other boxes with a limit that the entry fills. The rest with a limit (the second and third address lines, telephone, grade, the permanent address, and page 10's "more details" and four other-institution and course boxes) are not filled, so no value reaches them. A UK postcode is split at its own seam into two boxes of 4. A passport number answered in the interview is read as 5 to 20 characters; one changed in the chat is not read again. | A shorter answer, in the chat: `my <what> is <shorter>, not <as held>`. |
| `0 violations:` | A planned box the entry does not know. `encountered` never names such a box; when boxes like it come with violations, they are not mentioned at all, so a run whose named violations are cleared can stop again with `0 violations:`. | A person: the entry. |

A correction is read only when no playback is open, and is played back for his "Yes, that's right"
before anything changes. After a page has been saved on Sheffield's portal it goes to a person
instead. A date or a number is not found by its words (ADR-0154 §5): of the residence list, only a
period's country can be corrected in chat, not its dates. A value he chose "not in the list" for
(*HHE*, *DBA*, *International Business*) is chosen for that value: if he corrects it, the resume
offers the form's list for the new value again. A correction confirmed while the run is held does
not release it. He is told *"Changed: … Your application is with a person on the team, and when
they look at it again it will be with this answer."*, and the run stays with a person until §4
re-plans it. If the corrected answers leave something to ask, the question is put to him at once,
while the run is still held, and his answer is read (row 208); a correction that clears a violation
leaves nothing to ask, and the run waits for §4.

## 4. When the cause is changed: the resolution, for him to run

Only when §2 (2) shows an open intervention, and only after the answer is corrected (or his decision
on the funding stage or on row 202 is in place). A resume without it plans the same content and
stops again at once, as a new intervention:

```
AAS_CONVERSATION_URL=http://127.0.0.1:4870 AAS_SERVICE_CERT=browser-runner pnpm run interventions resolve <the id from §1> --specialist "Vahid Mohammadi" --did-not-happen --actions "<what was corrected, in the chat>" --resolution "Resumed after the correction"
```

If the cause has changed, he is told the application is moving again, and the next step is the
preview of the whole application for his approval (`authorise`, `packages/orchestrator/src/run.ts`
after `fix_content`), not a question, unless the change left a question open. No account is
created and nothing is filled before he approves that preview.

`--did-not-happen` is the one taken: this stop recorded no action on the portal, and
`--did-happen` is refused (`validation_failed`). The resolution re-plans from his answers as they
now stand. If nothing named in `encountered` has changed, the run stops again at once under a new
intervention, and the same message as the first (row 205). The command shows it: after the
resolution it prints *"Open for this run now, as the list reads after the resolution: <id>
(specialist:content_rejected)."* `--abandon` (with `--did-not-happen`, which the command requires
either way) ends the application; it does not continue it.

## Permanent residence

It can be corrected in the chat: `my country of permanent residence is United Kingdom, not Iran`
names `residence.country`, and not his nationality or country of birth, which also hold Iran
(`apps/conversation-service/src/correction-requests.test.ts`, P315). The new country must be one
the country table reads: `United Kingdom` or `GB`. `UK` and `the United Kingdom` are not read (the
same test). An answer that holds the word *Iran* as typed, for example a passport's issuing country
kept as he typed it, is found first. So before he presses "Yes, that's right", the playback must
name his country of permanent residence; if it names another answer, `leave it`.

It is not the cause of this halt, so it is his to change only if Iran is not the true answer. If he
changes it, his other residence answers were given about Iran and stay as they are: *"lived
outside it in the last three years: yes"*, and the United Kingdom listed as a place *other than
where you live now*. Each would go to Sheffield unchanged and would need correcting too, and only
a period's country can be corrected in chat. On Sheffield's form a UK permanent residence shows the
British passport and the other UK status boxes, which take his UK status answers if they are held
and are asked if not, at once after the correction, even while the run is held (row 208); *"always
lived in the UK"* shows only if *"lived outside it in the last three years"* is no.

## Cost

Nothing metered. §1 and §2 are reads; §4 and a correction in the chat write through the service.
The interview runs on the deterministic stand-in (`apps/conversation-service/src/wiring.ts`), and
the measurements here ran on synthetic values with no model.
