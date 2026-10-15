# Restarting his Sheffield application after the stop (P313)

His words (`docs/run-a/p313-his-message-as-sent.txt`, item 3): *"Tell me exactly how I restart my own
application now (student 5774ff16), keeping my profile corrections, without editing my database by
hand."*

Nothing below edits the database by hand. Every step is the page, or a read of the service's own
routes from the page.

## What carries over, and what is asked again

- **Carried over:** every answer he confirmed. The profile is held per student
  (`profile_entries`, keyed by student id), and a new application reads it, so the corrections he
  confirmed in the chat are read by it. His documents and his choice on Sheffield's cookie notice
  are per student too, and carry over.
- **Asked again:** the choices from Sheffield's own lists (award title, subject). They belong to an
  application (`entry_choices`, keyed by case), so the PHD and International Studies presses stay
  on the stopped one and the new one offers the lists afresh. Anything he had typed and not yet
  confirmed when he stopped is not in the profile and is asked again. A CV reading belongs to the
  conversation it was made in, so the CV question may be put again.

## 1. Pull and restart

```
scripts/local-stack.sh stop
git switch main && git pull
pnpm install --frozen-lockfile
pnpm run -s catalogue check docs/run-a/catalogue
AAS_LOCAL_CATALOGUE=registry AAS_CATALOGUE_DIR="$PWD/docs/run-a/catalogue" scripts/local-stack.sh start
scripts/local-stack.sh verify
```

`check` should print `sha256:2a4ae5a9f000409aa70c0dba594c3e1bdbc9342b696fdd5f283e4b796a1dcbe0`;
`verify` should end `verified: documents=none, cv reader model=stand-in — as asked`.

## 2. Before pressing anything: what was confirmed after the stop

Before P313 the stopped application kept asking, and a "Yes, that's right" pressed after the stop
was written to his profile. A new application will not ask those fields again. To see whether any
was, in the browser console (F12) on `http://127.0.0.1:4870/`, before pressing anything:

```js
const id = (await (await fetch("/v1/conversations?limit=50")).json()).conversations[0].id;
let after = 0, all = [];
for (;;) {
  const page = await (await fetch(`/v1/conversations/${id}/events?after=${after}&limit=500`)).json();
  all = all.concat(page.events);
  if (!page.hasMore || page.events.length === 0) break;
  after = page.events.at(-1).ordinal;
}
const stopAt = all.findLast((e) => e.kind === "message" && (e.content ?? "").startsWith("I have stopped work on your"))?.ordinal;
console.log({ conversation: id, stopAt, confirmedAfterTheStop: all.filter((e) => e.kind === "value_confirmed" && e.ordinal > stopAt).map((e) => [e.ordinal, e.fieldKey]) });
```

It prints the stop's event number and every field confirmed after it. An empty list means none
was. A field listed is in the profile as he confirmed it; if one is wrong, he corrects it in the new
application in words, as P311 built ("my … is …").

## 3. Start the new application from the page

1. Hard reload `http://127.0.0.1:4870/`. The stopped application shows no "Stop this application"
   and one button, **"Start a new application"**. Press it.
2. The page opens a new conversation and shows it: "What would you like to apply to?" with the
   Sheffield row. Press **"See what would be applied for"**.
3. Write a sentence in the box and press **"Apply to this for me"**.
4. Expected: the panel **"You have applied for this before"**, asking "What happened to that
   application?" with "It was rejected", "I withdrew it" and "Leave it".
   - If the page instead says "You already have an application for this course and intake." and
     shows no panel, an earlier application for the same course and intake is still open in his
     database; nothing more can be done from the page, and it comes to me.
5. Choose an answer. **Neither describes "stopped here before anything was submitted".**
   - "I withdrew it" records `withdrawn` as his statement, and the advice is: *"You withdrew the
     previous application rather than being turned down, so there is no particular reason to wait
     before applying again."*
   - "It was rejected" records a rejection that did not happen and advises waiting six months.
   - A third answer, recorded from the case itself rather than asked, is my recommendation (row
     196, point 1). It touches what is recorded about him, so it is his to decide, and it is not
     built.
6. The advice is shown. Write a sentence in "In your own words: why do you want to apply again?" and
   press **"Apply again anyway"**. The new application opens as attempt 2 of the same course and
   intake, and the interview goes on from his confirmed answers.

Do not reload between step 3 and step 6: the panel lives in the page (row 196, point 8). If it is
lost, press "See what would be applied for" and "Apply to this for me" again. If "Apply again
anyway" answers with a refusal, reload and read where things stand before pressing it again.

## Cost

Nothing metered. The offer, the advice and the second attempt make no model call, and the
interview runs on the deterministic stand-in.
