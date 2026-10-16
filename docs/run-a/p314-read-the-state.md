# Why "no" to the British passport question was asked again, and how to see it (P314)

His words (`docs/run-a/p314-his-message-as-sent.txt`): *"Give me read-only commands to show the
state, and tell me what to do so the run continues. Do not edit my database by hand."*

Nothing below writes to his database. Every database read runs in a session that Postgres itself
holds read-only (`default_transaction_read_only=on`), and §2 prints that setting first.

## What happened

1. The interview read his "no" as the first of the UK status's seven claims, and wrote it to the
   log as a part, keyed `british_passport`.
2. The log refused the row. Its check on a part key (migrations 0024 and 0025) took letters and
   digits only, and the seven claims are keyed with underscores. Every answer to any of the seven
   was refused, in any application, for any student.
3. The message route had already answered his message with 201 before the interview read it, so
   the page showed nothing. The service logged one line: `conversation-service error: error
   (constraint conversation_events_part_key_check)`.
4. His message had closed the open question, so the worker's next advance put the same question
   again, as attempt 2 and then 3.

The earlier application is not involved. A part is read back only from the conversation it was
written in, and in that conversation the same refusal had kept his earlier "no" from being written
at all (§2, query 2). The "no" answers he confirmed there after the stop ("always lived in the EU",
"always lived in your country of permanent residence") are in his profile, so the new application
did not ask them again, but they play no part in this (§2, query 5).

## 1. Before stopping or restarting anything: the service's own log

`scripts/local-stack.sh start` empties the log, so read it first. From the repository root:

```
grep -n 'conversation-service error' .local-stack/conversation-service.log
```

Expected: one line `conversation-service error: error (constraint conversation_events_part_key_check)`
for each "no" he typed to the passport question since the stack was last started.

## 2. His log, his profile and the check, read-only

From the repository root, with the stack up or down (Postgres must be running):

```
URL=`grep '^AAS_CONVERSATION_DATABASE_URL=' .local-stack/conversation-service.env | cut -d= -f2-`
PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -v student='5774ff16%' <<'SQL'
SHOW default_transaction_read_only;
\echo (1) the newest conversation, from the UK status question on
SELECT e.ordinal, e.kind, e.actor, e.field_key, e.part_key, e.attempt, left(b.content, 60) AS said
  FROM conversation_events e
  LEFT JOIN message_bodies b ON b.id = e.body_id
 WHERE e.conversation_id = (SELECT id FROM conversations WHERE student_id::text LIKE :'student' ORDER BY created_at DESC LIMIT 1)
   AND e.ordinal >= (SELECT min(x.ordinal) FROM conversation_events x
                      WHERE x.conversation_id = e.conversation_id AND x.kind = 'value_asked' AND x.field_key = 'immigration.uk_status')
 ORDER BY e.ordinal;
\echo (2) answers to the UK status ever written, per conversation
SELECT c.id AS conversation, c.created_at, count(e.*) AS parts_written
  FROM conversations c LEFT JOIN conversation_events e
    ON e.conversation_id = c.id AND e.kind = 'value_part_read' AND e.field_key = 'immigration.uk_status'
 WHERE c.student_id::text LIKE :'student' GROUP BY c.id, c.created_at ORDER BY c.created_at;
\echo (3) the check the log applies to a part key
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'conversation_events_part_key_check';
\echo (4) the newest migrations applied
SELECT version, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 2;
\echo (5) what the profile holds for residence and immigration
SELECT field_key, value, updated_at FROM profile_entries
 WHERE student_id::text LIKE :'student' AND (field_key LIKE 'residence.%' OR field_key LIKE 'immigration.%')
 ORDER BY field_key;
SQL
```

What it should show before the fix:

- `SHOW` prints `on`: the session cannot write.
- **(1):** `value_asked` for `immigration.uk_status` with attempt 1, the question, his `no`, then
  attempt 2, the question, his `no`, then attempt 3 and the question. After either `no` there is
  no `value_part_read` and no `answer_unread`: nothing was recorded, and nothing was said.
- **(2):** `0` for every one of his conversations, the stopped one included.
- **(3):** `[a-zA-Z0-9]`, with no underscore.
- **(4):** `0039_a_student_chooses_from_the_forms_own_list` is the newest.
- **(5):** the residence answers he confirmed, and no `immigration.uk_status`.

If any of these differs, stop and send what it printed. It would mean something else is happening
too, and the steps below are not enough.

## 3. To continue his run

```
scripts/local-stack.sh stop
git switch main && git pull
pnpm install --frozen-lockfile
pnpm run -s catalogue check docs/run-a/catalogue
AAS_LOCAL_CATALOGUE=registry AAS_CATALOGUE_DIR="$PWD/docs/run-a/catalogue" scripts/local-stack.sh start
scripts/local-stack.sh verify
```

`start` applies migration 0040, which widens the check to take an underscore and nothing else. Run
queries (3) and (4) of §2 again: (3) shows `[a-zA-Z0-9_]`, and (4) shows
`0040_a_part_key_may_carry_an_underscore`.

Then hard-reload `http://127.0.0.1:4870/`. The passport question is still the open one. Type **no**
once. The page should show the next claim, *"Do you have indefinite leave to remain or enter? Please
answer yes or no."*, and then the other five claims one at a time. After the seventh, the page plays
all seven back to be confirmed with "Yes, that's right".

If he types something the interview cannot read as yes or no, the question now comes back opened
with why (*"I could not read yes or no from …"*), where until P314 it came back word for word.

His two earlier "no"s stay on the log as he typed them, with nothing read from them. They are not
answers to anything and are not counted against him: the stop after three unread answers counts
only `answer_unread` and rejected readings, and neither was written.

## Cost

Nothing metered. The interview runs on the deterministic stand-in (`apps/conversation-service/src/wiring.ts`).
