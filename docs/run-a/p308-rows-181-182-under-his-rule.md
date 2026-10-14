# Rows 181 and 182 under his rule of 2026-10-14 (P308)

His words (`p308-his-decisions-on-p307-as-sent.txt`): *"for any open point where you give a
recommendation, apply your recommendation and record it as yours, unless it touches one of these
four: submitting an application, money, a student's personal data, or legal or declaration text.
Those four always come to me. … Apply this rule now to rows 181 and 182, and tell me which of their
points fall under the four."*

## His decision, 2026-10-14 (P310), in his words

Saved as sent: [`p310-his-decisions-as-sent.txt`](./p310-his-decisions-as-sent.txt).

> *"Rows 181 and 182: apply all your recommendations as written, with two additions in my words:*
> *- 182 (13): a CV uploaded after a record is kept and read into the student's profile, for future
> applications. Nothing changes on the submitted application, and the sentence says so.*
> *- 182 (3): leave as is for now. Record that before anyone other than me can record a submission,
> who recorded it must be authenticated."*

And his build order: *"1. P302 item 3 alone first: the consent notice at the account-creation
press, handled as sign-in already handles it. My live run waits for this. 2. Then my live run. 3.
Then rows 181 and 182, in one phase."*

So every recommendation below is applied as written, in one phase after his live run, and nothing
here is built before then. The recommendations stay mine; his word applies them. Where his two
additions differ from what I wrote, his words govern:
- **182 (13):** my line left "whether the CV is read or kept" to him. He has said it: kept and read
  into the profile, for future applications, with nothing changed on the submitted application, and
  the sentence saying so.
- **182 (3):** left as is, as I recommended, with his rule recorded: before anyone other than him
  can record a submission, who recorded it must be authenticated.

**The answer: all of them.** Every open point of rows 181 and 182 touches at least one of the four,
by my reading, so none was applied under his rule. Each is listed below with what it touches and my
recommendation, for him to answer. Four more points found by P308's review are added as 182 (11) to
(14), and they touch the four too.

**Method.** Each point was read in the code at `45f22bff` and classified by one reader. Then a second
reader tried to overturn each classification, reading the code again. It confirmed sixteen and
changed two, 182 (6) and (7), from "does not touch" to "touches". My reading of "touches" (CLAUDE.md,
P308) is: anything that changes whether, when or how a submission or a press can happen; anything
about what is collected, held, shown or deleted of a student's personal data or credentials; and any
declaration, attestation or legal wording. When in doubt, it touches. That reading is mine and his to
correct. Read narrowly, 182 (6) and (7) are the nearest to not touching.

182 (5) is not in the list: his addition to D7 settled it, and P308 built it.

## Row 181: what decision 1's build (P306) leaves

| Point | Touches | My recommendation |
|---|---|---|
| (1) A "no" to the registration e-mail that stays true has no way out | submitting; personal data | A person's record, shaped like P307's, that mail reaches the student's address (`observed` or `stated`); counted as the student's "yes". No waiver that hands the account back without proof. Until he answers, an abandon holds for a person, which is the safe direction. |
| (2) Case logs from before P306: does a completed reset count as proof? | personal data; submitting | Yes, count it: one clause in `handoverChecklistFrom`. It reaches only logs from before P306, and his AUTH 8 says none exists for Sheffield. |
| (3) D6 not built: the resume box says "the only reason I would ever ask for it a second time", untrue after a refused sign-in | personal data (the box that collects the password) | Build D6: a third explanation, `describeSignInRetry`, chosen when the last sign-in failed. It says this is the one more try, and that if it fails the run stops for a person (a promise, so a test that it does). |
| (4a) A typed message during any handoff but the registration question is dropped silently | personal data; submitting; money; legal (payment, declaration and final-submission handoffs share the path) | One fixed reply, no model, per open handoff. It points at the button and says never to type a password as a message. It records nothing and echoes nothing. |
| (4b) A different open handoff blocks a raise silently | submitting; personal data | Check for a different open handoff before deciding, and stop for a person (`specialist:handoff_conflict`), telling the student once. |
| (4c) The student's stop says "Nothing has been sent" for any cancelled box | personal data; submitting | Read the case: keep the sentence when nothing was created or saved, and otherwise say what the university holds, in `stoppedRemainder`'s words. |
| (5a) Under `student_types_into_portal`, the words say the password "passed through our system" | personal data; submitting | Leave the words. Add a line to row 127's list of constraints that cannot fire, naming the feature that makes it reachable. |
| (5b) A `passwordless` or `portal_issued` account on a portal that never verifies still owes a reset | personal data; submitting | Leave as is. Add a line to row 127's list, so that onboarding such a portal meets the question first. |

## Row 182: what recording a submission made by hand (P307) leaves

| Point | Touches | My recommendation |
|---|---|---|
| (1) A page saved by hand without a submission cannot be recorded | submitting | Leave as is. ADR-0160 §3's advice, abandon and do not resume, is the guard. Keep the row open as a known limit. |
| (2) Thirteen sentences say "nothing has been submitted", nine reachable only through a race between a runner's claim and the record | submitting | Close the race with the existing per-conversation lock: the record re-reads the case, checks leases and writes inside it, and `claimWork` reads the case inside it. Leave the sentences. The test must inject the record before `claimWork`'s locked section. |
| (3) Who recorded it is asserted, not authenticated | submitting | Leave as is, as for a review (ADR-0048 §3). He is the only reviewer. |
| (4) A password box open when the record is made stays open | personal data; submitting | Refuse the record while a box is on screen and unexpired, with the existing `secret_request_open` (409). The command says to record it once the box has closed (at most five minutes). |
| (6) Two identical records at the same instant: the second answers 500 | submitting | Catch the write conflict, re-read once: if the case now holds the same record, answer as a retry; otherwise 409, "nothing was recorded; send it again". (Classified as touching by the second reader: the retry path reaches the telling and the hand-back.) |
| (7) A failure in the advance inside the record answers 500 after the record and the message are written | personal data; submitting | Catch it, answer 200 with `advanced: false` and the error's name, and have the command say the hand-back starts at the worker's next pass. (Borderline, by the second reader: that pass exists only while the run is still automatable.) |
| (8) A recorded case never concludes, so reapplying to the same course and intake is refused | submitting | Leave as is: ADR-0006's duplicate rule doing its job. |
| (9) `answerStudent`'s interview branch has no check of its own after a record | personal data; submitting | One guard line before the interview branch (after the registration question, which the hand-back still uses), and a test that a typed answer on a recorded, held case with no account records nothing. It is reachable: the by-hand branch of `nextStep` applies only with an account. |
| (10) The hand-back's list of things left says "I did not attach these" and "the application is not complete until you do", beside "You submitted your application" | submitting | Open with "I did not fill in or attach these, and I cannot tell whether they were done before you submitted it", close with "If any was not, {institution}'s admissions office can tell you how to send it", and drop "the application is not complete until …" after a record. It changes the hash of any hand-back already raised. |
| (11) **New, P308 review:** a correction typed after a record still gets the old replies ("filling in your application … has begun", "Nothing more will be filled in until a person has looked at it"), and with pages saved it escalates the run, which then cannot complete until a person resolves it | personal data; submitting | One fixed reply for any correction after a record, opening with "You submitted your application … on {date}". It says a change to a submitted application goes through the university's admissions office, and that nothing here was changed or passed on. No intervention, no status change, no playback. Tests for the saved-page and no-saved-page cases. |
| (12) **New:** after a record, a student who closed the password box is shown every target, and choosing one posts the offer, "Apply to {institution}", into the chat | submitting | Show only the bound target after a record, and render its offer as a close-off that opens with the submitted-on sentence, not "Apply to". (The page's own heading and button no longer say "apply", P308.) |
| (13) **New:** a CV uploaded after a record gets "Do you want me to go back and fill them in from the CV instead?" | personal data; submitting | After a record, a fixed sentence instead of the question: you submitted it on {date}, and nothing will be filled in from this CV. Whether the CV is read or kept is his to say. |
| (14) **New:** the reapplication panel for a recorded, stopped case offers "I withdrew it" and "Apply again anyway" with no word of the submission | submitting | Carry the record's date on `already_applying`, and open the panel with "You submitted your application on the university's website on {date}." |

## What I did apply, and why it is not on this list

The tool fixes and the review fixes P308 made are not open points of these rows. They are listed in
P308's report, each as mine, with the reason it does not touch the four.
