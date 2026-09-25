# Item 6 — the run, from nothing to `ready_to_submit`

The goal, in his words: *"A real person — me, on my own account, with my own real details — goes
from an empty conversation to ready_to_submit on a Sheffield application, without anyone editing a
file by hand."* And the account (ADR-0144): *"we create the account, the student does not."*

Every act below is his or the system's; none is a file edited by hand. Nothing is submitted at any
step, and no other real person's data enters at any step. Written before the run; what the run
actually did goes in `what-run-a-proved.md`, not here.

## Before the run — his acts, once

1. **A dedicated e-mail address**, made by him, for this account only. Nothing here reads that
   mailbox (ADR-0020 §5). He tells the chat the address when the interview asks for `contact.email`.
2. **The local stack on the catalogue** — the conversation service, the run driver, the runner and
   the secure plane against the entry `docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json`
   (hash `sha256:7b46e6fe…` at the time of writing; the signature covers whatever hash is current
   when he signs).
3. **A fresh `students` row** for his dev session, whose UUID goes into `approvals.json` under
   `ownAccountOnly.studentId` — the one account the entry may be served to (ADR-0118). This is the
   one edit that is his by design: an approval is a signature, not a file edited to make a run pass.
4. **One signature** over the entry, with that id, once everything above is in the hash.

## The run — his answers in the chat, and the system's acts

5. **The interview.** Each answer is played back with "Is that right?" and a "Yes, that's right"
   button in the panel below the chat; a typed *yes* is a correction, not a confirmation, and is
   refused as one. If the button is not there while a playback is open (P221, row 90), the same
   act from the console on the page, with the hash the server itself names:

   ```js
   const id = "<conversation id>";
   const r = await (await fetch(`/v1/conversations/${id}/runs`)).json();   // r.pending.decision === "confirm_value"
   await fetch(`/v1/conversations/${id}/runs/${r.run.runId}/decision`, {
     method: "POST", headers: { "content-type": "application/json" },
     body: JSON.stringify({ kind: "confirm_value", contentHash: r.pending.contentHash }) });
   ```

   `r.pending` is `null` when no reading is open — after a typed *yes*, which closed it. The
   hash is also on the `value_proposed` event in `GET /v1/conversations/${id}/events?limit=500`.
   He answers as himself. Where his institution, subject or grading system lies
   outside the lists on file, the plan refuses by name and one read of that list closes it (P218);
   nothing is guessed.
6. **The yes.** The preview shows what will be typed; he authorises it. The run starts. He has not
   recorded an existing account, so the orchestrator's step is `create_account` (ADR-0110's
   default).
7. **The password box.** The secure channel opens once; he types a password only he has seen. The
   handle lives five minutes (`MAX_TTL_SECONDS`); an expired one reopens the box.
8. **The creation.** The runner opens `https://www.sheffield.ac.uk/postgradapplication/`, checks the
   host, checks for a CAPTCHA, and then — before typing — checks whether the portal's consent notice
   stands over the form's button (ADR-0144).
   - **No choice on record** (the first time): the creation stops with `consent_banner_met`,
     nothing typed, no password spent. The chat says so and asks the choice in the notice's own
     words: *"Before I can create your account on www.sheffield.ac.uk …"*. He answers `accept` or
     `refuse` in the chat. The creation is offered again with the same handle if it is still live,
     or the box reopens.
   - **A choice on record:** the runner presses the path the entry names, reads the `CookieControl`
     cookie back against the entry's clauses, and only if every clause holds types his e-mail,
     asks the secure plane to type the password into both boxes, and presses `startApplicationBtn`.
   - **Success** is read from the page: the path changed from `/postgradapplication/`. His
     observation of 2026-09-11 (AUTH 4) is that registration goes *"straight into the form"*, and
     the entry records no e-mail verification. If a verification page does appear, the account
     waits at `awaiting_email_verification` and the chat hands off to him: he opens his mailbox
     himself, confirms, and tells the chat. The mailbox is never read.
   - **Refused twice** (ADR-0114): the run stops for a person and says which attempt failed and
     with what. Nothing is retried a third time.
9. **The fill.** Pages 3 to 12 in the entry's order, one page per unit of work, in the session the
   creation left open. Each page is saved; nothing is submitted. `ready_to_submit` is the end of
   Part 2 (P217).
10. **The record.** Rows for anything found that does not block the goal; the phase closes with what
    the clock said.

## What is unmeasured until the run, and named as such

- Sheffield's notice at the **registration** form is inferred from page 0 being one page with the
  sign-in, where the notice was measured (P164, attempt 1). The creation's consent step is proven on
  the fixture only (row 88).
- Where a **created account lands**. The runner reads success by the path changing; the evidence
  that it does is his one observation (row 89).
- What Sheffield does with a **duplicate e-mail** — the dedicated address exists to make that
  question moot for this run.
