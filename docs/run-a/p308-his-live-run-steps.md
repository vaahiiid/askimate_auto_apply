# His live run, as numbered steps (P308)

Asked for in his message of 2026-10-14 (`p308-his-decisions-on-p307-as-sent.txt`): *"give me the
live run as plain numbered steps on my machine: what to start, the exact words to type in chat for
the three corrections, where the run stops before page 12, and the exact command to record my own
submission afterwards."*

Everything below is read from the code at P308's commit. None of it was run against Sheffield:
the agent does not touch the portal. **Proven against the deterministic stand-in only.**

**Cost:** nothing metered, as the stack starts by default. The interview uses the deterministic
model, the CV reader is the stand-in, and documents are `none`. Starting with
`AAS_LOCAL_READER_MODEL=bedrock` would spend sixty-eight model calls on each CV reading.

Two placeholders stand for addresses, because which address to use is his to say and a record
carries only his own. Type the real ones; never paste them into a record.

**P302 item 2, decided by him on 2026-10-14:** *"my live run uses today's code. It does not wait for
ADR-0158."* The steps below are today's code.

---

## What may stop it, before you start

- **The consent notice at the creation's press is not handled** (P302 item 3, not built). If
  Sheffield shows it after the page has opened, the press fails as `uncertain` and the run stops
  for a person.
- **A password Sheffield refuses** counts as a failed attempt: two attempts, then a person. In your
  words (P302 item 5, 2026-10-14): *"Sheffield's registration page shows no password rules."* So
  Sheffield may still refuse a password for a rule the page does not show (my reading).
- **An account already on the address the account is created on** counts the same way: two
  attempts, then a person. In your words (P302 item 4): *"my live run uses an e-mail address of mine
  that has no Sheffield account."* So I do not expect a duplicate there (my reading, not your
  words). One can still arise if correction 1 is not made, or if an earlier press that ended
  uncertain had already made the account.
- **`email_verified` for your student record is recorded nowhere** the agent could read. If it is
  false, the password box is refused (`email_not_verified`). Step 2's query shows it.
- **The financial-evidence review** (step 7) stops the run before the preview if your profile
  holds `finance.funding`.

## The steps

1. **Pull and start, on the same database as before.** A recreated database gives you a new
   student id, which the signed approval does not admit.
   ```
   git switch main && git pull
   pnpm install --frozen-lockfile
   pnpm run -s catalogue check docs/run-a/catalogue
   scripts/local-stack.sh stop
   AAS_LOCAL_CATALOGUE=registry AAS_CATALOGUE_DIR="$PWD/docs/run-a/catalogue" scripts/local-stack.sh start
   scripts/local-stack.sh verify
   ```
   - `check` should print `sha256:2a4ae5a9f000409aa70c0dba594c3e1bdbc9342b696fdd5f283e4b796a1dcbe0`
     and that it admits one account only, studentId `5774ff16-ff9c-424a-882f-42d0f304968b`.
   - If your Postgres superuser is your macOS user, put
     `AAS_LOCAL_ADMIN_DATABASE_URL=postgresql://<your macOS user name>@127.0.0.1:5432/postgres`
     before `start`.
   - `verify` should end `verified: documents=none, cv reader model=stand-in — as asked`.

2. **Optional: read what your profile holds now**, so that the "not …" half of each correction is
   your stored text exactly.
   First print the conversation service's database address:
   ```
   grep '^AAS_CONVERSATION_DATABASE_URL=' .local-stack/conversation-service.env | cut -d= -f2-
   ```
   Then put what it printed in place of `<that address>`:
   ```
   psql "<that address>" \
     -c "SELECT id, email_verified FROM students WHERE id = '5774ff16-ff9c-424a-882f-42d0f304968b'" \
     -c "SELECT field_key, value FROM profile_entries WHERE student_id = '5774ff16-ff9c-424a-882f-42d0f304968b' AND field_key IN ('contact.email','education.prior_qualifications','finance.funding')"
   ```
   (Written without the shell's command substitution, which the check that every page read prints
   its country, `scripts/reads-print-their-country.test.ts`, takes for a read of the page.)

3. **Sign in to the student page.** Open `http://127.0.0.1:4870/healthz`, and in its console run:
   ```js
   await fetch("/dev/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject: "5774ff16-ff9c-424a-882f-42d0f304968b" }) });
   ```
   Then open `http://127.0.0.1:4870/` and continue conversation `01M3D473G7EWJDKZ50BTSVEDW7`.

4. **The three corrections, typed in the chat, one sentence at a time.** After each, the chat
   plays the change back; press **"Yes, that's right"** before typing the next. A sentence typed
   while a playback is open gets only the press-or-"leave it" reply. Corrections are taken only
   before any page is saved.
   1. Your e-mail. The account is created on it. Use the address you named in P302 item 4, the one
      of yours with no Sheffield account. Type it only in the chat. It goes into no file, commit or
      note in the repository; your profile and the conversation log in your own database hold it,
      as they hold any correction, because the account is created on it.
      ```
      my email is <your own address>, not <the address your profile holds now>
      ```
   2. Your doctorate's award title (Sheffield's box takes 28 characters):
      ```
      my doctorate award title is DBA, not Doctorate of Business Administration
      ```
   3. Your Master's. It changes two parts, so it is two sentences:
      ```
      my Master's institution is Islamic Azad University, not Azad University
      ```
      ```
      my Master's award title is MSc, not Master's in International Business
      ```
      Type the apostrophe as your profile holds it: the reader matches a straight `'` against the
      stored text unchanged, so a curly `’` stored is not found. Step 2 shows which. If the award
      title is already MSc (ADR-0154 records your report of 2026-10-05), the chat says nothing was
      changed, and that does no harm.

5. **The stop of 3 October, if it is still open.** List, then resolve:
   ```
   AAS_CONVERSATION_URL=http://127.0.0.1:4870 AAS_SERVICE_CERT=browser-runner pnpm run interventions
   AAS_CONVERSATION_URL=http://127.0.0.1:4870 AAS_SERVICE_CERT=browser-runner pnpm run interventions resolve <its id> --specialist "Vahid Mohammadi" --did-not-happen --actions "Corrected my e-mail, award titles and Master's institution in the chat (ADR-0154)" --resolution "Resumed after the corrections"
   ```
   `--did-not-happen` is the one taken: that stop recorded no intent.

6. **The run's choices.** Answer them with the buttons. Measured at this commit with
   `npx tsx scripts/questions-his-run.ts docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json DBA`:
   four.

7. **If the run stops for the financial-evidence review** ("Before I show you your University of
   Sheffield application to approve, a member of the team needs to check it over…"): you are the
   only reviewer. Whether it is approved is yours to say. Record the review **first** (expect `204`),
   then resolve the stop with the step-5 command, `--did-not-happen`:
   ```
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:4870/internal/v1/cases/<caseId>/review -H "x-service-cert: browser-runner" -H 'content-type: application/json' -d '{"reviewerId":"Vahid Mohammadi","outcome":"approved","triggers":["financial_evidence"],"notes":"<what you checked>"}'
   ```
   The caseId is on the `case` line of `pnpm run interventions` (step 11).

8. **The preview, the password, the account.** Under page 12 the preview says it is held. Press
   **"Yes — this is right, fill it in"**. The password box opens; type it once (its handle lives
   five minutes). The first creation stops at Sheffield's consent notice with nothing typed: answer
   its question in the chat, and the creation runs again. Then the chat asks whether Sheffield's
   registration e-mail has arrived: press **"Yes, it has arrived"** only if it did. Nothing is
   filled until you answer.

9. **The fill.** Pages 3, 4, 5, 7 (once per qualification), 8 (once per job) and 9. Pages 6, 10
   and 11 have nothing mapped and are not opened.

10. **Where it stops: before page 12, the course choice page.** It does not open the page. The
    chat says, once:

    > I have stopped before the course choice page of your University of Sheffield application, and
    > I will not open it while it is not known whether saving that page sends your application to
    > the university. A member of the team has been asked to look at it, and nothing more happens on
    > your application until then.

    The run is `escalated`, with one stop open: reason `page_save_may_submit`, against
    `held:page12`.

11. **Your own hand on the portal.** Sign in at Sheffield yourself, complete page 12 and anything
    else it asks, and press Submit. Note the time, in your own zone. Then list the stops:
    ```
    AAS_CONVERSATION_URL=http://127.0.0.1:4870 AAS_SERVICE_CERT=browser-runner pnpm run interventions
    ```
    The held stop is the one `against held:page12`. Its `case` line is the caseId; its id is the
    one to resolve in step 13.

12. **Record your submission.** The exact command, with the time you pressed Submit, its offset
    included (`+01:00` in the UK until 25 October, `+00:00` after):
    ```
    AAS_CONVERSATION_URL=http://127.0.0.1:4870 AAS_SERVICE_CERT=browser-runner pnpm run submission-by-hand <caseId> --by "Vahid Mohammadi" --at 2026-10-15T14:05:00+01:00 --observed
    ```
    - The date you type is the date you are told. A second, different record is refused, so get it
      right the first time.
    - `--observed`: you saw the portal say it was submitted.
    - It prints `Recorded on <caseId>. …`, then that you were told, once, the date, and that the
      run is still held by the page-12 stop.
    - It is refused while a runner holds work (`work_in_flight`): wait a few minutes and send it
      again.

13. **Resolve the page-12 stop**, so the account is handed back:
    ```
    AAS_CONVERSATION_URL=http://127.0.0.1:4870 AAS_SERVICE_CERT=browser-runner pnpm run interventions resolve <the held:page12 stop's id> --specialist "Vahid Mohammadi" --did-not-happen --actions "Filled page 12 and pressed Submit myself on Sheffield's portal; recorded with submission-by-hand" --resolution "Submitted by hand and recorded (ADR-0159 O10); resumed so the account is handed back"
    ```
    Before the record, this is refused, and the command says why.

**If you save page 12 without submitting,** do not resume: abandon (`--abandon` on step 13's
command). A page saved by hand without a submission cannot be recorded, and a resume would save
page 12 a second time.

## What you will see after step 12 (his D7 addition, built in P308)

With `--at 2026-10-15T14:05:00+01:00`:

- **In the chat, once, at the record:** *"You submitted your University of Sheffield application on
  the university's website on 15 October 2026. A member of the team has recorded it. I will not
  fill in or submit anything more on it."*
- **On the page, whatever the run's state:** a line beginning *"You submitted your application on
  the university's website on 15 October 2026."*
- **After step 13:** nothing says "moving again". The hand-back follows: *"You submitted your
  application to University of Sheffield on the university's website on 15 October 2026, and the
  account is yours."*, with how to sign in and the advice to change the password now. Press
  **"Done — I have completed that"** once you are in.
- **Then, once:** *"That is the last of it. You submitted your University of Sheffield application
  on the university's website on 15 October 2026. The account at University of Sheffield is yours
  now, and nothing is left for me to do on it."* The run is `completed`.
