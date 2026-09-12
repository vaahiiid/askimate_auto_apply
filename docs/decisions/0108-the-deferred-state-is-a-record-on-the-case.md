# ADR-0108 — What the student owes the portal is a record on the case, closed by their word, and nobody claims to chase them

**Status:** Accepted · 2026-09-12 · decides blocker 24 · continues 0104, 0107 and 0050
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-12. Built in P107.

## Context

ADR-0107 made the runner tell a portal that a document is coming later while the student
attaches it themselves. P106 found what the system then did with that: told the student once,
at the handover, in a message; recorded no item, held no incomplete state, could not check, and
could not reach them afterwards. Vahid asked for it as its own question
([the sheet](../decision-sheet-blocker-24-the-deferred-state-after-the-handover.md)) and answered
it.

## Decision

In his words:

> *"Blocker 24: the durable record on the case, as the floor. Not the reminder."*
>
> *"A student who authorised 'later' has an obligation this system created on their behalf.
> Telling them once in a message that scrolls away is not a record of it, it is a mention of it.
> The case knows what it deferred, and it should carry that where the student and a specialist
> can both see it."*
>
> *"So: record the outstanding items as items, on the case, closable by the student saying they
> have done it. The student is told what they owe, and where. Nothing claims to chase them."*

And the wording, which he wanted uncomfortable:

> *"the student must be able to tell that we are not watching this and nobody will remind them.
> If the honest version of that sentence makes the product look worse, that is the product, not
> the sentence."*

The reminder is out, on its own terms and not because of the channel:

> *"An outbound message to a student after the conversation has closed is a different product
> surface with its own consent, its own deliverability, its own failure modes and its own way
> of being ignored. That is a decision I would want to make on its own terms, not as an appendix
> to a radio button. And there is a worse failure in it than not sending: a reminder that fails
> silently leaves the student worse off than no reminder, because we have now implied someone
> is watching. Better that the record says plainly nobody is."*

## What is built

- **Two case events.** `OwnActRecorded` — one per document slot left to the student, per entry,
  with what the portal was told beside it — is appended with the yes, from the preview the
  student authorised, which is the one thing the hash binds. `OwnActDone` is the student's word.
  The case's fold carries `ownActs`; a key the case never recorded invents nothing, a second
  word keeps the first's time, and re-authorising refreshes the debt without taking a word back.
  No new table: a business fact goes in the case log (ADR-0031).
- **The student's word crosses the wire** as the decision `attached_myself` with the key the run
  published — no hash, since it is a statement about their own act, not agreement to something
  shown. The run driver answers it before asking the run's situation, so an act is closable
  whatever the run is doing, including after it has finished and the account is theirs. A key the
  case never recorded is refused.
- **Both the student and a specialist read the same record.** `GET …/runs` carries `ownActs`:
  label, page, entry, what was told, and `done`. The student client lists them under *Still
  yours to do — nobody is watching this, and nobody will remind you*, with a button per open item
  that sends their word.
- **The wording, in three places.** The preview, before the yes, under each entry: *Nobody is
  watching this, and nobody will remind you.* The handover: an application with something owed
  is *filled as far as I can take it*, not *complete*; the list; *<institution> has been told
  these are coming later. Nobody is watching this, and nobody will remind you. If you do not
  attach them, <institution> will treat the application as incomplete, and I will not know. When
  you have attached one, tell me here and I will record it.* And the run's readable state, which
  says the same in fields.

## Consequences

- The debt is a record, not a sentence: a specialist reading the run sees what the student owes
  and whether they said they did it; the student sees it wherever the run is read, and their
  word is what closes it.
- Nothing checks the portal and nothing reminds, and the record says so. ADR-0050's completion
  through the student's own decision is unchanged: the case concludes at the account handover,
  and what they still owe the portal is carried beside it, open, until they say otherwise.
- Nothing here touches the transmission gate, the authorisation content hash, or the
  mandatory-review categories.

## What was deliberately not done

- No reminder, no outbound message, no schedule — his decision, for the reasons above.
- No reading of the portal after the handover to see whether the document arrived: the account
  is the student's and the runner's session is closed (ADR-0101); the system has no honest way to
  look, and the record does not pretend to.
- No closing of an act by anything but the student's word.
