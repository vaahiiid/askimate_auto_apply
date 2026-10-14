# ADR-0159 — The run presses the final submit on the student's own confirmation for each university, and no password reset comes before submission

**Status:** Accepted · approved by Vahid on 2026-10-13, in his own words (below): five of its open
points answered by him, the other eleven applied as recommended at his word; three parts still his
to say (O5's session hold, O7's part decided with row 81, O15's presses on his own account) ·
written 2026-10-13
(P304) for his approval, at his request · **built: decision 1 (P306), O10 (P307) and his addition
to D7 (P308); the press is not built** (this line said "nothing here is built yet" until P308
corrected it); his build order is decision 1 alone first, the press later · amends
[ADR-0050](./0050-the-account-lifecycle-completes-through-the-students-own-decision.md) §3, §4, §5
and §7, [ADR-0014](./0014-discovery-cannot-submit.md) (the capability ladder and the token),
[ADR-0007](./0007-agent-led-conversational-intake.md) (a legal declaration as a handoff),
[ADR-0059](./0059-the-student-can-read-what-they-are-authorising.md) (the preview's "Nothing is
submitted by this"), [ADR-0020](./0020-the-account-belongs-to-the-student.md) §3, §4, §5a and what
the student is told, [ADR-0101](./0101-the-yes-comes-first-and-a-runner-is-signed-in-for-one-sitting.md)
§1 and §3, and §2 if his answer to the part of O5 still open keeps the session to the press,
[ADR-0069](./0069-an-authorisation-is-spendable-only-in-the-application-it-names.md)
(its binding, extended to a press), [ADR-0110](./0110-a-run-may-start-on-an-account-the-student-already-holds.md)
(his words keeping the address proof), [ADR-0120](./0120-a-failed-sign-in-is-tried-twice-then-stops-for-a-person-and-the-student-is-told-what-cannot-be-told-apart.md)'s
words, [ADR-0144](./0144-we-create-the-account-the-student-does-not.md)'s "nothing submitted",
[ADR-0058](./0058-a-case-opens-from-an-offer-the-student-accepted.md)'s "nothing submits at all",
ADR-0104 and ADR-0107 if O8 goes that way, and the run phases on the wire
(`packages/contracts/src/runs.ts`); answers the question ADR-0156 left open (*"the student
submits, and no state records it"*); and carries his words superseding his decision of 2026-10-13
on row 177, read as O12 says, at his word

## His picture and his decisions, in his words (2026-10-13)

Saved whole as sent:
[`docs/run-a/p304-his-product-picture-and-decisions-as-sent.txt`](../run-a/p304-his-product-picture-and-decisions-as-sent.txt).

> *"My product picture, in my own words: a student of any nationality chats with us and is
> interviewed, and for a university we have onboarded, like Sheffield, we apply without them doing
> anything in the process. Wherever we are unsure, we ask in chat. Until the final submission is
> done, the student does nothing at all on the university's website.*
>
> *My decisions:*
>
> *1. No password reset before submission. The student types the password once in the secure box;
> we never store it. This supersedes my earlier decision on row 177 and amends ADR-0050. The
> handover tells the student not to change their password until every submission is done, and
> advises them to change it after. If they change it earlier and the run cannot sign in, the run
> asks them once in chat for the new password, then hands to a person.*
>
> *2. The run must press the final submit. A student who chooses ten universities must not have to
> press ten submits. Design: one review session in chat with, for each university, its full preview
> and the exact declaration text from its submit page. The student confirms each university
> separately, with its own button, because each declaration is theirs. Each confirmation is
> recorded with its time and the exact text confirmed. Only then does the run press that
> university's final submit, on a separate allow-listed control, never by any other path.*
>
> *3. CAPTCHA and second factor: later, when we reach them.*
>
> *Write this as a Proposed ADR for my approval. Say honestly what it costs in safety, and what it
> changes in ADR-0050, the submit guard and row 80. Say what must be checked per university about
> submitting on a student's behalf. Nothing is built until I approve.*
>
> *For my own run: I will press the final submit myself the first time, so row 80 gets observed."*

## Approved, with his answers, in his words (2026-10-13)

Saved whole as sent:
[`docs/run-a/p305-his-answers-on-adr-0159-as-sent.txt`](../run-a/p305-his-answers-on-adr-0159-as-sent.txt).

> *"My answers on ADR-0159.*
>
> *O1: agreed. Tell the student not to change the password as soon as the account exists; hand the
> account back after its last press.*
>
> *O3: agreed. The student confirms in chat that Sheffield's registration e-mail arrived. If not,
> stop for a person before any press.*
>
> *O5: I choose the confirmation AFTER the fill, not before. The student confirms what the portal
> actually stored, read back from the portal's own summary page, together with the exact
> declaration text. If the session has expired by then, ask for the password once more. This also
> answers your cost "nobody reads what the portal stored before it is sent". Resolve the conflict
> with ADR-0158 ordering (a) on this basis.*
>
> *O12: your reading is right.*
>
> *O15: a press on any other student's case stays a hard stop until ADR-0157 is built.*
>
> *Your proposed offset is accepted: a person reads the outcome of the first press under each newly
> signed version.*
>
> *Before any press on any university, its declaration text must be read. If it says the applicant
> completed the form personally, the run does not press there; record it as a per-university
> check.*
>
> *For the other eleven open points, apply your recommendations and list what you applied in one
> line each. Record ADR-0159 as accepted with these answers.*
>
> *Build order: decision 1 alone first. The press comes later.*
>
> *BEFORE MY LIVE RUN: find out whether saving page 12 (the course choice) is itself the
> submission. Read studyprogrammetaught.js (row 82) and anything else that shows it, read-only.
> Until this is known, my run must stop before saving page 12.*
>
> *Also fix README.md:33 while you are there."*

### What his answers settle

- **O1, as recommended.** The student is told not to change the password as soon as the account
  exists, and the account is handed back after its last press.
- **O3, as recommended.** The student confirms in chat that Sheffield's registration e-mail arrived.
  If it did not, the run stops for a person before any press.
- **O5: his choice is (B), confirm after the fill**, with three things (B) did not say:
  - the student confirms what the portal stored, read back from the portal's own summary page;
  - they confirm it together with the exact declaration text;
  - if the session has expired by then, the password is asked for once more.

  O5 below is rewritten to say so, and names what his words leave open: whether the signed-in
  session is kept from the last save through the read-back to the press. In his words, this also
  answers cost 2, *"nobody reads what the
  portal stored before it is sent"*; §6 now says what it still leaves.
- **ADR-0158's ordering (a): the conflict is resolved.** The conflict was that (A) kept "once" only
  if ADR-0158 did not take ordering (a), whose fill signs in again after the preview. Under his O5, a
  second password ask is accepted when a session has expired, so (a)'s second sign-in no longer
  conflicts with this ADR. That is the resolution "on this basis". I read his words as resolving the
  conflict, not as choosing (a): which ordering ADR-0158 takes is still his (ADR-0158 §4).
- **O12, my reading,** in his words *"your reading is right"*.
- **O15, in part, in his words:** a press on any other student's case stays a hard stop until
  ADR-0157 is built. Still his: whether each later press on his own account needs his word, and
  whether ADR-0157 being built lifts that stop on its own (O15 below).
- **The offset in §6 is accepted:** a person reads the outcome of the first press under each newly
  signed version.
- **A per-university check, his rule:** before any press on any university, its declaration text is
  read. If it says the applicant completed the form personally, the run does not press there (§10
  row 2).
- **Build order:** decision 1 alone first (§2), the press later.
- **Before his live run:** whether saving page 12, the course choice, is itself the submission is
  found out, read-only. Until it is known, his run stops before saving page 12 (row 80; §12).

### Applied at his word: the other eleven, one line each

His words: *"For the other eleven open points, apply your recommendations and list what you applied
in one line each."* The recommendations are mine; his words adopt them.

- **O2:** changing the password after submission is advice; the case concludes without it, and the
  record says the advice was given.
- **O4:** "once" means once per account, per sitting, and never across accounts, which would store
  the password.
- **O6:** the confirmation record holds the declaration verbatim, the confirmation's time and the
  student's authenticated session, and the preview by its content hash, not its text. *(Under his
  O5 the student confirms the portal's read-back, not the preview. Whether the record also hashes
  the read-back is my adaptation, not applied at his word, and his to say.)*
- **O7:** one confirmation and one button per press; until claim 9 is observed, no press on an
  account where another case has a saved choice not yet pressed. The part the recommendation left
  to be decided together with row 81 stays open with that row.
- **O8:** no press while the student owes any act on that application; on Sheffield, either the run
  uploads the documents itself (a separate decision, revisiting ADR-0104) or the press waits for the
  student's uploads.
- **O9:** terms against sharing the password, or against a third party or software operating the
  account, stop
  the run on that portal, fill included; a declaration of personal completion, a typed-name
  signature, or terms against a third party pressing submit mean the run fills but does not press.
- **O10:** a person records a submission made by hand on the case, and the press path refuses any
  case that has one.
- **O11:** decision 1 covers `student_chosen` only; `generated_ephemeral` keeps its reset.
- **O13:** every attestation in the form is in the confirmation, verbatim and hashed, and the student
  confirms each; otherwise there is no press.
- **O14:** `CONFIRMED` stays the portal's confirmation; `decide` accepts `complete_handoff` on a
  terminal case reached from a press; every terminal state checks for an account still owed.
- **O16:** his own run takes way (i), decision 1 built alone first, which is also his build order.

Everything below that is not inside a quotation of his is mine: a reading, a design or a
recommendation. Every point his first message did not settle was listed in §5, O1 to O16, as
open and his to say. His answers above settle them, except three parts that stay his: O5's session
hold, O7's part decided with row 81, and O15's presses on his own account. Nothing in this ADR is recorded
as his decision except the quotations of his two messages and what they settle.

## 1 · Why this exists

Today the system stops before submission, by design and at his word. ADR-0014 holds his
instruction of 2026-08-26: *"Do not submit a real application or create a consequential application
for a real student without a further explicit approval from me."* Every run ends at
`ready_to_submit` (`packages/orchestrator/src/run.ts:386-392`), after the account has been handed
back (ADR-0050 §3), and the student presses the final submit on the university's website.

His picture changes both ends. The student does nothing on the website until the final submission is
done, so they do not sign in to hand the account back, and they do not press submit.

I read his decision 2 as answering ADR-0014's sentence for the design only, because he also wrote
*"Nothing is built until I approve."* Whether it is that approval, and for which presses, is his to
say (O15). In this proposal, approving the ADR approves a design, not a live press (§8).

How this was read: one read-only map at `cf124806`, with five readers (the reset, the submit
guard, row 80, the per-university checks, and what it costs). Each finding cites the file and lines
it rests on. Three reviewers then read the draft (attribution to him, citations, honesty and
completeness), and their findings are folded in here. Nothing touched the network, a portal, AWS or
a model. Where a statement is general knowledge, not read from the repository or a portal, it says
so.

## 2 · Decision 1: no password reset before submission

### What his words settle

- **No password reset before submission.** On Sheffield, an account the run creates owes one today.
  The run creates it under `student_chosen`. Sheffield does not verify e-mail
  (`emailVerificationRequired: false`), so ADR-0050 §4 replaces `emailVerifiedByPortal` with
  `passwordResetCompleted` (`packages/account/src/ownership.ts:299-304`). The map ran the code on
  Sheffield's signed entry and got four gate items, the reset first, with `resetStillToDo: true`.
- **The password is typed once, in the secure box, and never stored.**
- **The handover warns, then advises.** It tells the student not to change the password until every
  submission is done, and advises changing it after.
- **A changed password: ask once, then a person.** If the student changes it earlier and the run
  cannot sign in, the run asks once for the new password, then hands to a person. ADR-0120 already
  has this shape. Its first-failure message ends that *"a second failure in a row stops for a
  person"* (`apps/conversation-service/src/run-driver.ts:1150-1160`). What is missing is the words:
  neither message names a changed or reset password. Row 177 already lists those words as still to
  be built.

### How I read three of his phrases (mine, his to correct)

- **"asks them once in chat for the new password"** — the secure box opened in the conversation,
  never a typed chat message. ADR-0026 is the rule that a password is asked for and never seen.
- **"types the password once"** — once per university account. Each university is its own account,
  and its password is typed into its own box. Once across ten accounts would mean keeping the
  password between runs. That is a design that stores a student's portal password, a hard stop.
  This is O4.
- **"This supersedes my earlier decision on row 177"** — his earlier decision had three parts:
  keep the reset; a mid-run reset, then ask once and hand to a person; reads never open a reset
  page. I read "supersedes" as replacing the first, restating the second in decision 1's own words
  (which say *"they"*, the student, where row 177 said *"someone"*), and leaving the third. I also
  read it as a decision in force now, while what is built waits on his approval of this ADR. Both
  readings are O12.

### What it removes

- **The reset's own harm on Sheffield.** Sheffield's reset replaces the password and e-mails a new
  one in plain text (his AUTH 7 result: stated by him on 2026-10-12, not observed by a run; entry
  `json:30817`).
- **An extra ask.** A press after a reset would need the student to copy that mailed password into
  the secure box.

### What it costs

- **The only check that mail reaches the student goes.** On Sheffield, the reset is the only proof
  the system checks that mail sent to the account's address reaches the student (ADR-0050 §4). Today
  the student resets, then confirms they can sign in. Because the reset replaced the password, an
  honest "I'm in" needs the mail that carried the new one. Without the reset, nothing before
  submission depends on the mail arriving. Row 174 shows the risk is not theoretical: the account
  his reads use is registered with an address that is not his profile's. A replacement is O3.
- **The password stays live longer.** It passed through our process (`passwordDelivery:
  askimate_secure_channel`), and it now stays valid until the student changes it. His words make
  that change advice ("advises"). Whether it gates the case is O2.

### Decision 1 built alone, before any press exists

§11 recommends building decision 1 ahead of his live run, while the student still presses submit
themselves. In that build:
- **The reset is removed** for an account the run creates under `student_chosen` (O11).
- **The handover stays before `ready_to_submit`.** It asks only that the student confirm they can
  sign in, plus O3's proof of receipt.
- **Its words are for a student who presses submit themselves.** They say: do not change the
  password until you have submitted; after that, we advise you to change it. Nothing in them
  promises a press the build cannot make.
- **The words for a failed sign-in name a changed password**, under ADR-0120.
- **A person can record a submission made by hand** (O10), built with it.

The second telling that O1 recommends, after the run's last press, belongs to the press build
(§12 step 6), not to this one.

## 3 · Decision 2: the run presses the final submit

### What his words settle

- The run presses the final submit, so that a student with ten universities does not press ten.
- There is one review session in chat. For each university it shows that university's full preview
  and the exact declaration text from its submit page.
- Each university is confirmed separately, with its own button.
- Each confirmation is recorded with its time and the exact text confirmed.
- Only then does the run press that university's final submit. The press is on a separate
  allow-listed control and never by any other path.

### The design proposed to carry it (mine, nothing built)

1. **The declaration is portal structure, read once and signed.** ADR-0158 learns a portal once.
   ADR-0131 already keeps a consent notice's own words in the signed blueprint. The submit page is
   treated the same way. Its URL, its one submit control, its form's action and method, and the
   declaration's exact text go into the portal's signed blueprint as a reviewed `SubmissionModel`.
   The text is kept verbatim and untrimmed, because a trim is a retyping (CLAUDE.md). The control is
   identified by tag, type, name, id and label. Today `SubmissionModel`
   (`packages/blueprint/src/blueprint.ts:752-760`) has a control and a `pageRef`, whose page may
   carry a URL, but no declaration and no form action, so it gains them. A changed declaration changes the signed content, and changed signed content
   needs his signature again (ADR-0057).
2. **The confirmation is a new event, not today's yes.** The domain's guard on `SUBMITTING`, and
   `attempt_submission`, check only `authorisedContentHash` (`packages/domain/src/transitions.ts:283-306`,
   `packages/domain/src/machine.ts:825-866`). So any `AuthorisationCaptured` would satisfy them,
   and every one recorded so far was given under *"Nothing is submitted by this"*
   (`packages/preparation/src/preview.ts:769`). His own run's yes is among them. So a press needs a
   distinct, versioned confirmation event. It carries:
   - the case and its content hash;
   - a hash of the declaration text;
   - the version of the sentence the student read;
   - the host and the control.

   `SUBMITTING` and `attempt_submission` accept only that event. Every authorisation recorded under
   "Nothing is submitted by this" is ineligible, and a test shows an old yes being refused. The
   student still owns the task, under the kind already named `authorise_submission`
   (`packages/domain/src/tasks.ts:96`), so the pinned set of student-owned kinds does not grow.
3. **One confirmation per university, and per press.** His words give one confirmation per
   university. Where a university needs several presses, my design gives each press its own (O7).
   Each confirmation is spent once and only in its own application, as ADR-0069 binds an upload. Its
   identity is (case, content hash, declaration hash, host, control).
4. **The press has its own guard.** The fill path keeps today's click guard unchanged: no control
   that reads as a submission is ever pressed while filling
   (`apps/browser-runner/src/preparation-safety.ts:95-211`). The press runs as a separate work kind,
   with ADR-0014's `SubmittableSession` implemented for the first time. Its guard is the inverse of
   the fill's: on that path exactly one control may be pressed, the one named in the signed
   `SubmissionModel`, and nothing else. On the network, exactly one write is allowed, to the signed
   endpoint with the signed method; every other write is aborted and recorded.

   The separation is the guard and the work kind, not a different browser. `SubmittableSession`
   extends `FillableSession` (`apps/browser-runner/src/session.ts:172`). Under his O5 the press comes
   after the student's confirmation, in the same signed-in context if it is still held, or signed in
   again if not.
5. **At the press, the live page must match what was confirmed, byte for byte.** Before pressing,
   the runner checks:
   - the page is the signed page;
   - the control matches the signed identity;
   - the declaration on the live page equals the signed text;
   - every attestation the form asks for is in the confirmation (O13).

   Any difference means no press: a person is called, and the student is asked to confirm again.
6. **Presses go one at a time.** Each outcome is read before the next press. The first mismatch or
   uncertain outcome stops every remaining press. A student's stop is taken between presses
   (ADR-0053).
7. **A press is never retried.** `submit_application` is already marked as not verifiable
   (`packages/domain/src/workflow.ts:381`). An uncertain outcome goes to a person with a recorded
   finding. The intent is made durable before the press (ADR-0054). The press is not given the
   "tried twice" pattern that creation, sign-in and the fill have.
8. **One session, many cases.** Today one conversation is bound to one case: *"one case per
   conversation is a real constraint"* (`apps/conversation-service/src/routes.ts:1167`). A review
   session over ten universities spans ten cases. It needs a view of the student's applications in
   which each button still belongs to exactly one case and one press.
9. **A token the runner cannot make.** Today's `AuthorisationToken` is a plain interface; the map
   built one in a scratch file and `tsc` exited 0. A TypeScript brand would stop neither a cast nor
   an object made at run time. The runner has no case store (`scripts/check-boundaries.ts:10-13`).
   So the token is signed by the plane, and the runner holds only what verifies a signature, never
   what makes one. Where the signing key lives is a build question for his review.

## 4 · Decision 3: CAPTCHA and second factor, later

His words: *"later, when we reach them."* One thing is needed before then. A press path has to
detect a challenge on the submit page and stop. The challenge detector reads at registration, at
sign-in, on the form before anything is typed (`apps/browser-runner/src/fill-application.ts:216-221`)
and at a page the fill was sent back to, but not at a submit. Every challenge is already a
named stop and a handoff, never bypassed (ADR-0007). Until decision 3 is taken, a portal that shows
a CAPTCHA or a second factor at submit is not one the run presses on.

## 5 · The points his first message left open, now settled

Each item had my recommendation. His answers of 2026-10-13 settle them: O1, O3, O5, O12 and O15
in his own words, and the other eleven by his word to apply the recommendation. Each item says
which. Three parts stay his: O5's session hold, O7's part decided with row 81, and O15's presses on
his own account. The text is kept as he read it, except O5, rewritten to his choice, and O7, whose
attribution of the target file is corrected.

- **O1. Where the handover sits relative to the press.** *Settled in his words: agreed.*
  - **His words:** the handover *"tells the student not to change their password until every
    submission is done"*. They do not say when the account counts as handed back.
  - **My inference:** the message reaches the student while submissions are still outstanding.
  - **The constraint:** the run must hold the account to press it. A handover that completes before
    the press would need either the student to sign in on the website, against his picture, or the
    run to sign in to an account already called handed back.
  - *Recommended:* split his "handover" in two.
    - **A first telling, as soon as the account exists:** the account is yours; do not change the
      password until I have pressed every submit on it; after that, we advise you to change it.
    - **The handover proper, after the account's last press:** we hold no access, and we advise
      changing the password now.

    The split departs from his wording: he wrote that the handover tells it. I also read "every
    submission" as every submission on that account, because a student's other universities are
    other accounts. Under this, `ready_to_submit` stops being the end of a run.
- **O2. Whether changing the password after submission gates the case, or is advice only.** *Settled: the recommendation, applied at his word.* His word
  is "advises". *Recommended:* advice. The case concludes without it, and the record says the advice
  was given.
- **O3. What replaces the reset's proof that mail reaches the student.** *Settled in his words: agreed.*
  - **What ADR-0050 says:** §4 rejected dropping it: *"the risk still exists and only the check
    would be gone."*
  - **His own words:** in ADR-0110 he kept it *"for an account we created on their behalf, where the
    address was never tested."* His live run's account is exactly that case.
  - **What is known about Sheffield's mail:** the signed entry's AUTH 4 records, from his statement
    of 2026-10-01, that a registration *"went straight into the form with one acknowledgement e-mail
    and no link clicked"* (entry `json:30814`). Whether anything is sent at submission is unread.
  - *Recommended:* at account creation, the student is asked whether Sheffield's acknowledgement
    e-mail arrived, and the answer is recorded. This keeps the check before submission, needs
    nothing on the website, and rests on a stated fact. It is weaker than today's: "it arrived" is a
    statement, where a sign-in after a reset depends on the mail. If it did not arrive, the run
    stops for a person before any press. That is the case row 174 shows to be real.
- **O4. "Once": per account, or per student.** *Settled: the recommendation, applied at his word.* *Recommended:* per account, per sitting. Across
  accounts it cannot be done without storing the password (§2).
- **O5. When the confirmation happens, given the five-minute hold.** *Settled in his words: (B),
  after the fill, read back from the portal's own summary page.* A signed-in session is held in
  memory for at most five idle minutes (`SECURE_HOLD_CEILING_SECONDS = 300`). His words in ADR-0101
  forbid widening it quietly. ADR-0101 §2 also releases the hold *"when the run's last page is
  saved"*. There are three ways:
  - **(A) Confirm before the fill.** The student confirms with the preview, the run takes the
    password once, then fills and presses in one sitting. The declaration the student reads is the
    submit page's text as read and signed (§3 item 1), and the press checks that the live page
    still says it.
  - **(B) Confirm after the fill.** The run fills, the student reviews what was saved and the live
    declaration, and the press comes in a later sitting. That means a second password box for each
    university, unless every review finishes inside five idle minutes of its fill.
  - **(C) Widen the hold.** That needs his word, with a measurement.

  *Recommended:* (A). It keeps "once" only if three things hold:
  - ADR-0101 §2 keeps the hold until the press, instead of releasing it at the last save.
  - ADR-0158's ordering is not (a). Under (a), the fill after the preview signs in again. (a) is
    the ordering I recommended in P302, so the two recommendations pull against each other, and the
    choice between them is his.
  - Every press on one account is made in the sitting that fills it (O7).

  Its cost is that the student confirms the plan, not the portal's stored record, so the read-back
  before the press (§6, cost 2) matters more.

  **Not taken. His choice, 2026-10-13: (B).** In his words: *"I choose the confirmation AFTER the
  fill, not before. The student confirms what the portal actually stored, read back from the
  portal's own summary page, together with the exact declaration text. If the session has expired
  by then, ask for the password once more."* So:
  1. The run fills the application.
  2. It reads back the portal's own summary page.
  3. The student confirms that read-back, together with the exact declaration text.
  4. If the session has expired by then, the password is asked for once more.
  5. Then the press.

  **Still open, and his:** whether the signed-in session is kept from the last save, through the
  read-back and the confirmation, to the press. His words say what happens if it has expired; they
  do not say whether it is kept. Two ways, nothing built either way:
  - **Kept.** ADR-0101 §2 is amended: the hold is released at the press, not at the last save. The
    five idle minutes are not widened. The read-back follows the last save in the same sitting, and
    the password is asked again only if the student takes longer than five idle minutes to confirm.
  - **Released at the last save, as today.** The read-back needs the portal too, so it signs in
    again, and so may the press. The password is then asked at least once more for every
    university, where his words ask again only *"if the session has expired by then"*.

  My recommendation: kept. The first text of this acceptance (`48b3342f`) said ADR-0101 §2 stays as
  it is, as if his words decided it. They do not, and that sentence is withdrawn. "Once" (O4) means
  once per sitting either way, with one more ask when a session has expired before the press. On
  Sheffield, the summary page counts repeating entries and omits a job's
  duties (§6, cost 2), so what the student confirms is what that page shows, not everything the
  portal stored.
- **O6. What "the exact text confirmed" records.** *Settled: the recommendation, applied at his word.* *Recommended:* the record holds:
  - the declaration verbatim (the university's words, as ADR-0131 keeps a notice);
  - the confirmation's time and the student's authenticated session;
  - the preview by its content hash, not its text.

  ADR-0059 never writes the preview down, because it is the student's personal data. If he means
  the preview's text too, ADR-0059 is amended. The record then becomes personal data with a
  retention period that ADR-0023 says is determined, not invented.
- **O7. A confirmation per university, or per press, and the course choices.** *Settled: the recommendation, applied at his word, except the part decided together with row 81, which stays open with that row.* Sheffield is stated,
  not observed, to take up to three course choices (S2). The target file, written on 2026-09-08
  before any read, says *"each submitted separately"*, each with *"its own explicit Submit button"*
  (`docs/target-sheffield-pgt.md:198`, `:194`). It frames them under his reasons for the target
  (`:186`). Its header says everything about Sheffield in it is his, transcribed: his description,
  or what he reported the institution's public pages state (`:5-7`). These lines are not his
  verbatim words and give no URL, so they are not quoted as his here (corrected in P305; the first
  text called them his description). Whether that is so is unobserved claim 9 (counted
  from 0, entry `json:30810`). The model today is one case per course (row 81), so a press that submitted
  several choices would span several cases, which the binding, the duplicate guard and the
  per-course submission key (ADR-0006) cannot express. *Recommended:* one confirmation and one button
  per press. Until claim 9 is observed, the run refuses a press on any account where another case
  has a saved choice not yet pressed. Decided together with row 81.
- **O8. Acts left to the student on the website.** *Settled: the recommendation, applied at his word.*
  - **The conflict:** the signed Sheffield mapping hands six document slots to the student:
    certificate, transcript and four translations (ADR-0104, ADR-0107). Today the run tells the
    portal "I will upload later". His picture has the student do nothing on the website before
    submission.
  - *Recommended:* the run never presses while the student owes any act on that application.
  - **What that means on Sheffield:** either the run uploads those documents itself, a separate
    decision that revisits ADR-0104, or the press waits for the student's uploads.
  - **Unknown:** whether Sheffield accepts a submission with documents to follow.
- **O9. A portal where the run must not act.** *Settled: the recommendation, applied at his word, with his own rule on the declaration (§10 row 2).* His words of 2026-09-23 on the password hold apply:
  *"If the clause is there, your position is mine: we do not build the hold."*
  (`docs/decision-sheet-holding-the-students-password.md:9-10`). *Recommended:*
  - **The run stops on that portal entirely, fill included,** if its terms say the password must not
    be shared, or that a third party or software must not operate the account. A press would not be
    the only breach: the fill would be one already.
  - **The run fills but does not press,** and the submit stays a handoff to the student, if:
    - the declaration says the applicant completed the form personally;
    - the declaration asks for the applicant's typed name as a signature; or
    - the terms forbid a third party pressing submit.

  Either way the student's confirmation would not make those things true. And either way the
  student acts on the website, which departs from his picture.
- **O10. How a submission made by hand is recorded.** *Settled: the recommendation, applied at his word.* When the run gains the press, his case must
  not be pressed again (ADR-0006). *Recommended:* a person records the observed submission on the
  case, and the press path refuses any case that has one. Until P307 no route recorded it, and
  ADR-0156 left the same question open. **Built in P307** (below, "Built: O10").
- **O11. Whether decision 1 reaches `generated_ephemeral`.** *Settled: the recommendation, applied at his word.* His words describe a password the
  student types. Under `generated_ephemeral` the reset is what displaces a credential of ours
  (`ownership.ts:306-315`). *Recommended:* decision 1 covers `student_chosen` only, and
  `generated_ephemeral` keeps its reset.
- **O12. What "supersedes my earlier decision on row 177" reaches, and from when.** *Settled in his words: "your reading is right".* My reading is in
  §2. *Recommended:* that reading. Row 177's third part, reads never opening a reset page, stands.
  Decision 1 is his decision now, and the code changes when he approves the build.
- **O13. Attestations inside the form.** *Settled: the recommendation, applied at his word.*
  - **The case:** Sheffield's page 3 has `passportNameConfirmation`, and the signed mapping leaves
    it empty (§10 row 3). Such a box is either submitted unticked, or ticked by the run without the
    student having confirmed it.
  - **The rule it would break:** the run ticking it makes the mapping fixture's *"the system must
    never tick it for them"* false.
  - *Recommended:* every attestation in the form is in the confirmation, verbatim and hashed, and
    the student confirms each. Otherwise there is no press.
- **O14. Where a case rests after the press.** *Settled: the recommendation, applied at his word.* `CONFIRMED` and `FAILED_PERMANENT` are terminal
  (`transitions.ts:108-110`). `decide` refuses `complete_handoff` on a terminal case
  (`machine.ts:503-514`), and only `CANCELLED` checks for an account still owed
  (`transitions.ts:253`). So a case that reaches either after a press could never hand its account
  back. *Recommended:*
  - `CONFIRMED` stays the portal's confirmation and nothing else, as ADR-0050 §7 says.
  - `decide` accepts `complete_handoff` on a terminal case reached from a press. Today its terminal
    check refuses it (`machine.ts:507`).
  - Every terminal state checks for an account still owed, as `CANCELLED` does.
- **O15. Whose word each live press needs.** *Settled in part, in his words: a press on any other student's case stays a hard stop until ADR-0157 is built. Still his: the first two items below, on his own account, and whether ADR-0157 being built lifts that stop on its own. The standing hard stop on any real student's personal data is separate, and his words do not touch it.*
  - *Recommended:* his own word for the run's first live press, which would be on his own account.
  - Whether later presses on his account need his word each time is his to say.
  - `run.ts:388-391` holds an older plan, *"from Vahid for the first real one, and from the student
    for every one after that"*. Whose words those are is not recorded.
  - A press on any other student's case processes a real student's personal data. That is a
    separate hard stop, which neither this ADR nor his word on his own press lifts. It needs his
    own words, and ADR-0157's rule that every authentication fact is observed first.
- **O16. His own run (§11).** *Settled: way (i), applied at his word, and his build order says the same.* Which of the three ways.

## 6 · What it costs in safety, honestly

Today a final submit is impossible, and five independent things make it so:
- the type has no `submit`;
- the click guard refuses anything that reads as a submission, even a listed control;
- the plane hands out only a page's advance, add-another and list-loading presses
  (`apps/browser-runner/src/performer.ts:156-168`);
- the case spine ends at `AUTHORISED`;
- the signed entry names no submit page.

His decision 2 makes submission possible on one path. On that path all five are replaced, not only
the name refusal. And every check proposed for it comes from one input: the press allow-list, the
control's identity, the declaration match and the network rule all read the same signed
`SubmissionModel`. One wrong signature defeats them all at once, where today's five layers are
independent. So this ADR proposes one check that does not come from the `SubmissionModel`: a person
reads the outcome of the first press under each newly signed version before the next press under it.

These are the costs, each with what would reduce it and what it still leaves:

| | Today | Lost | What would reduce it (proposed, not built), and what it still leaves |
|---|---|---|---|
| 1 | A runner bug cannot submit. Nothing implements `submit` (`grep 'implements SubmittableSession'` finds nothing). | A bug that sends a control down the press path becomes a real submission. | §3 items 2, 4, 5 and 9. On the fill path, forbid the signed submit endpoint (blocker 53), **if** the per-university check finds it distinct from every save and navigation endpoint (§10 row 18). The file's own header calls telling a save from a submit by its request "guesswork" (`preparation-safety.ts:34-39`). **Leaves:** one path on which a submission is possible by design. |
| 2 | A person reads the portal's own record before anything is sent. Run A's record calls his hand read of `summary.do` *"the check that matters more than any of them"* (`docs/what-run-a-proved.md:45`). | Nobody reads what the portal stored before the press. The preview is the plan, not the portal, and the two have differed before (ADR-0106). | His O5: the student confirms what the portal stored, read back from its own summary page, with the declaration. Just before the press, the page is read again, and any difference from what was confirmed means no press and a person. **Leaves:** on Sheffield, the summary page counts repeating entries and omits a job's duties, so those are not confirmed against the portal; reading them needs edit-view reads, which are not built. |
| 3 | The student makes the declaration on the university's page. ADR-0007: *"Brief §7 requires these and forbids bypassing them. They cannot legitimately be automated"*. | Software makes it, on the student's confirmation. This departs from the brief as ADR-0007 reads it. ADR-0007 also warns against removing a handoff *"in the name of 'the student must never do manual work'"*, which is close to decision 2's stated reason. | §3 items 1, 2 and 5; O9; O13; §10. **Leaves:** if a declaration says the applicant did something themselves, a confirmation does not make it true. |
| 4 | The student can fix a saved field on the website before submitting. | The student never sees the form, and a submitted application is not changed (ADR-0156). | Refuse the press while any correction, withdrawal or student-owned act is open. A correction voids that university's confirmation. **Leaves:** a mistake neither the student nor the read-back sees is submitted. |
| 5 | Nothing irreversible happens in bulk. | One signed mapping serves every student on a portal (ADR-0157), so a wrong mapping is submitted for everyone it reaches. A wrong mapping gives a preview and a portal record that agree, so neither the read-back nor the live-page match catches it. | Before any press for a student other than him: ADR-0157's preview marks built (they make the student a second reader), and its rule that every fact is observed extended to the `SubmissionModel`. The independent first-press read above. Within one student, §3 item 6. **Leaves:** the student, reading the preview, is the last reader of a mapping error. |
| 6 | Duplicate submission is guarded by `attempt_submission`'s `duplicate_submission` (`machine.ts:825-843`), which nothing outside the domain asks for: a grep finds it only in `machine.ts` and `scripts/walkthrough.ts`. | It becomes live. | The bypasses in cost 8 fixed before any press; §3 item 7. **Leaves:** a press whose outcome is uncertain, which goes to a person and is never repeated. |
| 7 | The account is the student's before anything is sent. On Sheffield, the reset is the only checked proof that mail reaches them. | We operate the account until the last press. The proof of receipt becomes a statement (O3). The password that passed through our process stays valid until the student changes it, which his words make advice ("advises"). | O1, O2, O3. **Leaves:** a window in which a password we handled is live, and a weaker proof of receipt. |
| 8 | Latent defects are harmless because nothing asks for `SUBMITTING`. | Each becomes reachable (the list below). | Each fixed and tested before the press is built (CLAUDE.md, latent constraints). **Leaves:** none known, once fixed; the list is what the map found, not a proof that there are no others. |
| 9 | The runner "cannot manufacture its own permission to submit" (`session.ts:179-181`). | The claim is not held by the type: a forged token compiles. | §3 item 9: a signed token. **Leaves:** the signing key, which must be kept from the runner. |
| 10 | Anyone who knows the address can replace a Sheffield password between creation and the end of the fill (row 177 (2)). | The window now runs to the last press, review session included. | ADR-0120's words name a changed password. **Leaves:** the window itself. The words only say what happened; they do not shorten it. |

**Cost 8, the latent defects a press makes reachable.** Each was measured by the map with the
domain's own `fold` and `decide`, or read in the transition table.
- **The duplicate guard has bypasses.** The generic `transition` intent moves a case into
  `SUBMITTING` without `SubmissionAttempted`, from `AUTHORISED` and also from `AWAITING_HANDOFF` and
  `AWAITING_SPECIALIST_RECOVERY` (`transitions.ts:61`, `:76`, `:88`). A later `attempt_submission`
  is then accepted. On the proper path the same sequence is refused as `duplicate_submission`
  (`machine.ts:518-557` against `:825-866`). His words "never by any other path" need `SUBMITTING`
  to be reachable only through the confirmation-bound intent. *Fix:* remove the generic transition
  into `SUBMITTING`.
- **`authorisation_stale` cannot fire** on a case built from its log (`machine.ts:268-273`).
- **The `SUBMITTING` guard skips the mandatory review categories.** `AWAITING_SPECIALIST_RECOVERY →
  SUBMITTING` is permitted with an active trigger and no review (`transitions.ts:283-306`).
- **`checkMinorGate` has no live caller.** It is registered as unreachable until "the phase that
  brings submission into scope" (`scripts/check-reachability.ts:329`).
- **A terminal case cannot complete a handoff.** This holds for `CONFIRMED` and for
  `FAILED_PERMANENT`, which is reachable from `AUTHORISED`, `SUBMITTING` and `SUBMITTED`
  (`transitions.ts:88-92`). So a press
  that ends in either strands the account (O14).

**The hard stops must not be weakened, and each must reach the press.**
- **The case binding** today covers uploads only (`mayTransmit`). A press needs the same binding,
  carried on the claimed work's case, with the host, as ADR-0069's transmission identity carries.
- **The authorisation content hash** today covers the fill content and no declaration. A yes given
  under "Nothing is submitted by this" must never be spendable on a press (§3 item 2), and the
  confirmation's hash covers the declaration too.
- **The mandatory review categories** today are checked on entry to
  `AWAITING_STUDENT_AUTHORISATION` only. They are re-checked at `SUBMITTING`. Minors stay refused
  outright (row 62).
- **A real student's personal data.** A press on any case but his is that, and stays a hard stop
  (O15).

**Statements that would become false, and must change with the build, not after it.** Measured at
P304's commit (`de0a9d12`); its line numbers are that commit's, and P305's code since moved the
preview sentence to `preview.ts:769`. Found with
`grep -rniE "nothing (has been|was|is) submitted|not (been )?submitted|before you submit|ready for
you to submit|you submit"` over `*.ts` under `apps/` and `packages/`, tests and `dist/` excluded.
It finds 27 lines:
- 23 in `apps/conversation-service/src/run-driver.ts`, 21 of them student-facing, for example
  *"Nothing has been submitted."* after a failed sign-in, and the cancellation texts;
- `packages/preparation/src/preview.ts:751`, the preview sentence, with four tests that assert it;
- `apps/conversation-service/src/client/words.ts:53`, *"ready for you to submit"*;
- `packages/account/src/ownership.ts:700`, *"Before you submit, attach these yourself"*;
- a comment in `packages/domain/src/reapplication.ts`.

As a positive control, it finds the two strings this ADR's first draft already listed, `preview.ts:751`
and `words.ts:53`. It cannot see a sentence built from parts or worded differently. Found by reading,
not by the grep:
- the rest of the handover in `ownership.ts`: *"is complete"* (`:708`), *"I will close this off"*
  (`:716-717`), *"I have never had a password for this account"* (`:789`);
- the fill runner's User-Agent, *"does not submit"* (`apps/browser-runner/src/playwright-fill-session.ts:752-754`),
  which ADR-0014's honest identification would have say what the press path does;
- the comments that hold the boundary:
  - `preparation-safety.ts:5`, *"STOPS BEFORE SUBMITTING IT"*;
  - `performer.ts:156-157`, *"the submit button is unreachable however the blueprint changes"*;
  - `session.ts:166`, *"Phase 6, and never before"*;
  - `workflow.ts:342`, *"Submission is out of scope and stays so"*;
  - the orchestrator's header, *"cannot submit"* (`packages/orchestrator/src/index.ts:5`);
- ADR-0058's *"nothing submits at all"*; `README.md:31` (*"nothing here submits"*), `:143`, `:163`
  and `:196`; and `workflow.ts:380`, *"Out of scope, and it would be the most consequential of all"*;
- row 155's last sentence, on what *"the stop before final submission"* rests on;
- the mapping fixture's *"the system must never tick it for them"* (O13);
- `docs/what-a-controlled-live-run-needs.md:396`;
- the drafted letter to QA Higher Education, which promises declarations *"passed to the applicant
  to complete themselves, by design"*. Whether it was sent is not recorded.

## 7 · What it changes in ADR-0050

- **§3.** *"`ready_to_submit` is now reached only once the account is the student's again"* no longer
  holds once the run presses. The run must still hold the account when it presses. Under O1, the
  handover proper follows the account's last press. ADR-0101 §3's resume path covers *"any page
  after the handover"*; O1 keeps the press before the handover, so the press never needs it.
- **§4.** The substitution of `passwordResetCompleted` for `emailVerifiedByPortal` no longer applies
  before submission. The note there records his decision of 2026-10-13, *"Row 177: keep the reset
  before handing over an account the run creates."* His words of the same day supersede it (O12).
  What replaces the proof of receipt is O3. Neither of ADR-0050's rejected options comes back:
  - not "dropping the item": O3 replaces it;
  - not "leaving the deadlock": §2's build alone keeps the handover able to complete.
- **§5.** The order *"reset first, then access"* loses the reset. Access remains, and under O1 it is
  confirmed after the account's last press. That needs the student to sign in, which his picture
  allows once the final submission is done.
- **§7.** His words there, *"no terminal state is added"*, stay true: `CONFIRMED` already exists, and
  becomes reachable for the first time. So does §7's *"`CONFIRMED` means the portal confirmed a
  submission; reaching it any other way would be untrue."* §7 left `AWAITING_HANDOFF` unused and
  said that making the case state that precise *"is a transition-table change with its own ADR"*.
  The edges `AUTHORISED → SUBMITTING → SUBMITTED → CONFIRMED` already exist (`transitions.ts:88-92`).
  What would move is the spine the run walks, `CASE_SPINE` (`packages/orchestrator/src/durable.ts:83-94`),
  past `AUTHORISED`, with `CONFIRMED` reached only on the portal's confirmation. That is a change
  of the precision §7 asked its own ADR for, and this is that ADR. Where the handover goes after that is O14.
- **Consequences.** *"A run is not finished until the account is back"* stays, and the end moves past
  the press.

## 8 · What it changes in the submit guard

ADR-0014 is amended in two places, and its sentence stays:
- **The ladder.** It gets its third rung: `SubmittableSession`, implemented and reachable only
  from the press work kind.
- **The token.** It becomes a signed one the runner cannot make (§3 item 9).
- **His sentence** (*"without a further explicit approval from me"*) stays in force. In this proposal,
  approving the ADR approves a design. The run's first live press needs his own word for that press,
  and every other question of whose word a press needs is O15.

Layer by layer:

| Layer | Today | Under this ADR |
|---|---|---|
| Type | No `submit` on `FillableSession`; `SubmittableSession` declared, not implemented (`session.ts:165-193`). | Implemented for the press work kind only. |
| Token | `AuthorisationToken` is a plain interface; a forged one compiles. | Signed by the plane; binds case, content hash, declaration hash, host and control. |
| Click guard (fill) | Refuses every name or id that reads as a submission (`preparation-safety.ts:95-211`). | **Unchanged.** |
| Other presses | Sign-in, creation and consent go around the click guard and check only for a reset (`sign-in.ts`, `create-account.ts`, `consent.ts`). | Each also refuses a control that reads as a submission, so the press path is the only one. |
| Plane | Hands out advance controls; no submit work kind (`packages/contracts/src/work.ts:63-64`). | A press work kind, claimable only with an unspent confirmation. |
| Blueprint | `SubmissionModel` has no declaration and no form action; Sheffield's entry has none (`handoffPoints: []`). | A reviewed, signed `SubmissionModel`: page, control, form action and method, declaration, attestations. |
| Network | `forbiddenEndpoints` always empty (blocker 53). | Fill paths: the signed submit endpoint forbidden, where §10 row 18 finds it distinct. Press path: exactly one write, to the signed endpoint. |
| Domain | `SUBMITTING` reachable by a generic transition; checks only the fill yes; stale check cannot fire; no review re-check. | Only the confirmation-bound intent reaches `SUBMITTING`; it requires the new confirmation event; all of cost 8 fixed first. |
| Orchestrator | Last step `ready_to_submit`; spine ends at `AUTHORISED` (`durable.ts:83-94`). | Under his O5: the fill; the portal's summary page read back; the student's confirmation of it with the declaration; the press, signing in again if the session has expired; reading the outcome; the handover (O1). |

## 9 · What it changes in row 80

Row 80 says where the final submission is has not been read, and places it *"On the goal's path
only after `ready_to_submit`, which is where this system stops"*. Under decision 2 it becomes **a
precondition of any press**: no `SubmissionModel` can be signed for Sheffield until the submit page
has been observed. ADR-0014 refuses a blueprint "assembled from hearsay".

His first press observes it, and it is a one-time capture. After the press, the page before it may
never be reachable on his account again, and a second chance would be another real application. For
decision 2 to be buildable, that press has to capture:

- **The page.** Its URL, and what the overview shows after page 12 is saved. Is there one submit per
  choice or one per application? What other controls are on the page?
- **The control.** Its tag, type, name, id and visible label. Its form's action and method. Is it
  enabled only after a box is ticked?
- **The declaration.** The page's own text, verbatim and untrimmed, and every box it asks to tick.
  Where it sits: the page, a modal, a separate page, or a browser `confirm()`. If it is a
  `confirm()`, its text is part of what is confirmed. The browser runner registers no dialog
  handler, and Playwright then answers Cancel (general knowledge).
- **What follows.** The URL, the confirmation text, any reference number, any prompt back for
  incomplete sections, any payment page, any e-mail and to which address. Then the overview: is the
  choice marked submitted, is Part 1 locked, can more choices be added, can a submitted choice be
  withdrawn?

Constraints on how it can be captured, all from the repository:
- **The read tool must be detached for the press.** While attached to his browser, it aborts every
  request that is not GET, HEAD or OPTIONS (`apps/browser-runner/src/attached-inspection.ts:189-245`).
  So the order is: attach, read the submit page, detach, press, re-attach, read what follows.
  Nothing found records the press's own request without blocking it.
- **A kept HTML copy loses the values.** The capture blanks every `<input>` value and every
  `<textarea>` (`scrubValues`, `attached-inspection.ts:516-520`). So a kept copy of the submit page
  would show the submit's label as empty, and would lose a declaration held in either. The
  declaration has to come from a read of the live page's text, passed through as the read's own
  output.
- **A kept page keeps its text.** The scrub does not touch page text, and a summary capture once
  carried a real e-mail address in it (`apps/browser-runner/fixtures/sheffield-summary-listing.html:3-9`).
  A confirmation page may show his details or an application reference. Each kept page is read for
  that before it is committed.
- **A read snippet must print the selected country.** What a read prints on a page with no country
  box is still his to say (CLAUDE.md), and until he says, the test refuses such a snippet. That
  answer is needed before his press.

The map found two more things, outside this ADR:
- **Two earlier reads of the overview** (2026-09-10 and 2026-09-25) found no submission-like control
  and no payment wording
  (`docs/captures/sheffield-part2-2026-09-25/overview-blueprint.draft.json:84`). Both were made
  before any choice was saved, with English-only words.
- **Three records describe scrubbed markup as Sheffield's own.** Row 155 gives Save's
  `value=""`, and row 84 and claim 22 give the funding radios' `value=""`. The drafts from the same
  reads give `Save and Continue` and Yes/No. Row 179 records this.

## 10 · What must be checked per university before the run may press

Each row is answered from a read of that university's own pages or documents, kept and signed by
him, before its `SubmissionModel` is signed. General knowledge is not an answer.

When rows are re-read:
- **Rows 1, 2, 4 and 19:** at each new signature of the portal's blueprint, and at least once per
  application cycle.
- **Row 2:** also whenever the live check at the press finds the declaration changed.

Sheffield's status is from the map. S2, S4 and S5 are the stated facts listed in
`docs/target-sheffield-pgt.md:34-41`.

| # | Check | Passes when | Sheffield today |
|---|---|---|---|
| 1 | Terms of use: may the password be shared? May someone other than the applicant, or software, operate the account? Who may press submit? | All three allow it. A "no" to sharing or to operating stops the run on that portal, fill included (O9). | Unread. The captured Part 2 page links no terms; it links a privacy notice, unread. |
| 2 | The declaration's exact text. Is it first person? Does it say the applicant completed the form personally? Is it a tick box, a typed name, the button alone, or a dialog? One per application or per choice? | Read before any press. If it says the applicant completed the form personally, the run does not press there (his rule, 2026-10-13). Nor may it assert anything else the student's confirmation cannot make true (O9). | Unread. The record calling it "first person" (`docs/the-agent-portal-possibility.md:37`) cites no read. |
| 3 | Any attestation inside the form, beyond the final declaration. | Each is in the confirmation (O13). | One on page 3, which the signed mapping leaves empty: `passportNameConfirmation`, labelled *"Tick to confirm that you have entered your names and date of birth as they appear in your passport. This is to ensure you are able to get a student visa if you need to apply for one:"* (the signed entry's blueprint). |
| 4 | An agent or representative route. Must a third party use it? Must help be declared? | No route is required of us, and any required notice is made. | A route exists, found by a site search and not read on the portal. Unread: the Agent Representation Authority Form and the "Notification of Use of Services of a Recognised Agent" form (row 58). |
| 5 | Fee or payment at submit, and who pays. | No payment at submit, or payment is a handoff to the cardholder. | Stated, not observed: "no application fee for PGT master's" (S5). |
| 6 | Reversibility. Can a submission be withdrawn or amended? Is saving a choice already its submission? Does Part 1 lock? | Known, and saving is not submitting. | Unread (row 80). |
| 7 | Limits. Choices per application and per cycle. Does one press submit one choice or all (O7)? | Known. | Stated: up to three choices (S2). Claim 9 unread. |
| 8 | What must exist before submit: documents, references, a personal statement. Does submit e-mail referees (third-party data)? Are incomplete sections sent back? | Known, and nothing owed by the student is open (O8). | References "not normally required" (stated). Six documents handed to the student (O8). S4 stated, not observed. |
| 9 | Duplicates. Can a second press or a resubmission create a second application? | Known. | Unread. |
| 10 | Our basis in data protection for causing the submission. The university's applicant privacy notice. | A determination is recorded, and the notice is read. | No registered determination covers causing a submission (`packages/disclosure/src/b2-determinations.ts`). Notice unread. |
| 11 | Immigration questions under the declaration (OISC, ADR-0080). | Recorded whether pressing over them falls inside ADR-0080's question, and answered. | Page 5 asks passport and Student Visa history. Not recorded. |
| 12 | The control itself (§9's list). | Observed. | Unread. |
| 13 | What follows the press, and how success is read: confirmation text, reference, e-mail. | Observed. | Unread. |
| 14 | CAPTCHA or a second factor at submit (decision 3). | None, until decision 3. | Unread. |
| 15 | A minor applicant. | Never, until the guardian route exists. | Refused (row 62). |
| 16 | Whether the stored application can be read back in full before the press (§6, cost 2). | Yes. | Partly: repeating entries are counted, not read; `summary.do` omits a job's duties. |
| 17 | Whether the declaration bundles a consent: to processing, marketing or sharing. | Any consent is the student's own choice, asked in the declaration's words (ADR-0131). | Unread. |
| 18 | Whether the submit's endpoint is distinct from every save and navigation endpoint. | Distinct, so the fill path can forbid it (§6, cost 1). | Unread. |
| 19 | robots.txt for the submit URL, and the portal's stance on an identified automated agent (ADR-0014's honest identification). | Neither refuses it. | `robots.txt` disallows nothing under `/postgradapplication/` (`docs/where-we-are.md:9893`); stance unread. |
| 20 | Whether pressing accepts contractual terms: fees, deposits, conditions. | Known, and in the confirmation. | Unread. |
| 21 | The declaration's language against the student's. | The student reads the declaration's own words. A translation may be shown beside them, but it is never what is confirmed, because a translation is a retyping. | English. Whether every student reads English is not known. |

A university passes only when every row meets its "passes when". Today Sheffield meets none of rows
1, 2, 6, 9, 12, 13, 14, 17, 18 and 20 from a read. Rows 4, 10, 11 and 19 are partly read. Rows 5 and 7
rest on statements, not observations, and row 8 partly on statements and partly on the signed
mapping. Row 3 is read and decided by nothing yet (O13). Row 15
is refused by construction. Row 16 is partly met. Row 21 is unknown.

## 11 · His own first run

His words: *"I will press the final submit myself the first time, so row 80 gets observed."*

**What his run meets as the code stands:**
- **The reset, first.** On the new Sheffield account the run creates, it cannot reach
  `ready_to_submit` until he completes the `password_reset` handoff. That means pressing
  Sheffield's "Forgot password" (P302 list, item 12), which is what decision 1 removes. But
  *"Nothing is built until I approve."*
- **Page 12's Save, before his press.** The run presses Save on page 12, which has never been run
  (`docs/run-a/p298-plan.md:70`). Whether saving a course choice is already that choice's submission
  is unread (row 80; §10 row 6). If it is, the run makes a live submission before his hand press.
  The P298 plan rests the stop on three layers, *"none of them a promise about the live form"*.

**Three ways through the reset, his to choose:**
- **(i) Decision 1 first.** Approve §2 and O1 to O4, O11 and O12 on their own, and build §2's
  "decision 1 built alone" before his run. It does not need row 80.
- **(ii) Run as it stands, without the reset.** At the reset step he does not press "Forgot
  password". He signs in on the portal himself and presses the final submit. The case stays at
  `AUTHORISED`, its account at `handover_due`, unconcluded. A person (he) records what was seen, and O10 decides how the case
  holds it.
- **(iii) Run as it stands, with the reset.** He presses the reset. Decision 1 now says not to.

*Recommended:* (i). It is small, and his run then meets his decision 1, built. **Settled: (i)**,
applied at his word, and his build order says the same: *"decision 1 alone first."* And his words
add a stop: *"Until this is known, my run must stop before saving page 12."* P305 found it not
known, and built the stop: the run never opens page 12 while it is held
([ADR-0160](./0160-the-run-stops-before-a-page-whose-save-may-be-the-submission.md)).

**Cost:** nothing metered on this path, unless the stack runs with `AAS_LOCAL_READER_MODEL=bedrock`.
Then one CV reading is sixty-eight model calls (`docs/run-a/p298-plan.md:106-108`).

## 12 · Order, as he approved it

1. **Decision 1, built alone** (§2), with O10's recording route. Tests are seen red first.
2. **Before his live run:**
   - whether saving page 12 is itself the submission, found out read-only, and until it is known,
     a stop before saving page 12 (his words);
   - his answer on what a read prints on a page with no country box;
   - the capture order of §9;
   - his decision on the page-12 risk (§11).
3. **His live run**, with his own hand on the final submit and §9's capture list.
4. **Sheffield's per-university check (§10)** from reads, and its `SubmissionModel` signed by him.
5. **The domain first:** every defect in cost 8 fixed, each made to fail once on purpose.
6. **The press path against the stand-in:** every layer of §8, O1's second telling, O3, O13 and O14,
   with each guard made to fail once on purpose.
7. **The first live press by the run**, on his own account, on his word for that press.

## What it must not weaken

- **The case binding, the authorisation content hash and the mandatory-review categories:** each is
  extended to the press (§6), and none is relaxed for it. No yes given under "Nothing is submitted
  by this" is ever spent on a press.
- **The student's password:** no design here stores it. "Once" across accounts would, and is not
  proposed (O4).
- **The fill path:** its refusal of anything that reads as a submission stays as it is.
- **Other students:** nothing here reaches another student's case. That stays a hard stop until his
  own words lift it (O15).

## Built: decision 1 alone (P306)

His build order: *"decision 1 alone first. The press comes later."* So the run still presses no
final submit; the student still submits on the university's website after the handover.

**What his words decide, and what is built to them:**
- **No reset before submission** for an account the run creates with the password the student
  chose, on a portal that never verifies the address (Sheffield). The handover checklist's
  `passwordResetCompleted` is replaced there by `studentConfirmedRegistrationEmail`
  (`packages/account/src/ownership.ts`, `applicableItems`). A password we generated keeps its reset
  (O11). A portal that verifies keeps its verification. An account the student declared owes
  neither (ADR-0110). `passwordless` and `portal_issued` are unchanged.
- **O3, the registration e-mail, asked in chat.** Right after the account is made, the student is
  asked whether the portal's registration e-mail reached them, with two buttons, "Yes" and "No".
  A "yes" is a completed handoff, `registration_email`. A "no" is a new event, `HandoffDeclined`,
  and the run stops for a person (`registration_email_not_received`).
- **O1, the telling.** The question and the handover both say not to change the password until the
  application is submitted, and advise changing it after (decision 1's words).
- **A changed password.** ADR-0120's two messages, after a refused sign-in, now say to type a
  changed or newly issued password into the secure box, never as a message.

**My choices, beyond his words, each his to overturn:**
- **D1. The fill waits for the answer.** Nothing is filled into an account whose way back has not
  been shown to reach the student. The cost: a second password box if the answer comes after the
  five idle minutes.
- **D2. The shape of the "no".** A `decline_handoff` decision, accepted only for this question; the
  stop for a person; and, when a person resumes, the question opened again and asked again, with
  one sentence saying why. Read from the case, never from the stop's reason.
- **D3. No new portal fact.** The question does not claim the portal sends an e-mail. A portal that
  sends none produces a "no", which goes to a person.
- **D4. A typed message while the question stands** gets one fixed reply pointing at the buttons,
  and records nothing. No model reads "yes" or "no" into a fact about the account.
- **D5. Every sentence is mine.** His are the instruction and the advice of O1, the question of
  O3, and decision 1's words on a changed password.
- **The words a stopped run hears.** A stopped or filled run takes the question inside the
  hand-back, rather than being held on a question about filling.

**Not built:**
- **D6**, a retry frame for the password box after a refused sign-in. Its explanation still says
  *"This is the only reason I would ever ask for it a second time"*, untrue on a retry (row 181).
- **O10**, recording a submission made by hand: P307.
- **The press**, and everything in §3 to §10 that it needs.
- Until the press, the code and the signed entry still have the run stop at `ready_to_submit`. And
  ADR-0160 holds his run before page 12, so it does not reach `ready_to_submit` while that page is
  held.

**Open, and his to say** (row 181):
- **A "no" that stays true.** If the e-mail never arrives, a person can only ask again or abandon,
  and an abandoned case still owes the account, so it waits for a person. Nothing records that
  mail reaches the student by other means. How a case ends there is his to say.
- **Accounts made before P306.** Whether a completed reset counts as their proof of receipt. Until
  he says, such an account is asked the registration question.

**Checked by a review** of the build, which found two defects, both fixed before the commit: a stop
while the question stood left the hand-back unsaid while its yes/no could be pressed; and on a log
from before P306, a "yes" to the question completed an open reset the student never did.

**What this costs, said again because it is now built:** on Sheffield the proof that the portal's
e-mail reaches the student is their word, not the portal's reset observed working (§2, and §6 cost 7).

## Built: O10, a submission made by hand (P307)

His word: *"For the other eleven open points, apply your recommendations"*
(`docs/run-a/p305-his-answers-on-adr-0159-as-sent.txt`). O10's recommendation, applied: *a person
records the observed submission on the case, and the press path refuses any case that has one.*
The run still presses nothing. What changes is that a submission made on the portal by hand, as
his own run may end (§11 (ii)), can now be said on the case, and the run then acts on it.

**What is built:**
- **The record.** A case event, `SubmissionByHandRecorded`, holding when it was submitted and how
  it is known: `observed` (the person saw the portal say so) or `stated` (someone told them). Its
  actor is the person, asserted on the internal service credential as a review's is. It is
  written through `POST /internal/v1/cases/{caseId}/submission-by-hand` or
  `pnpm run submission-by-hand`. The first record is kept. The same record again changes nothing.
  A different one is refused, because two dates are a disagreement for a person to settle.
  - It is refused while a runner holds work on the run (`work_in_flight`, 409). Otherwise the page
    in flight could be saved after the student is told nothing more will be.
  - It is refused on a case this system attempted to submit. That cannot happen until the press
    exists; when it does, two submissions are for a person to reconcile.
- **The press path refuses it.** The `SUBMITTING` guard (`packages/domain/src/transitions.ts`)
  refuses a case with a record before any other check, as `submitted_by_hand`. It is the gate every
  road to a press shares. A "yes" sent after a record is refused too.
- **The run fills nothing more.** `claimWork` hands out no browser work for the case: no page, no
  sign-in, no creation. The case is not walked along the spine, since a hop towards `AUTHORISED`
  would claim a yes and a fill that never happened. Nothing new is asked: no yes, no reading, no
  choice. A completed run's interview answers nothing, and an interview stop resolved after a
  record asks nothing again. The account's step comes before anything the form still lacks
  (`nextStep`), so a gap in the form never stands in front of the hand-back.
- **The account is due back.** Its stage becomes `handover_due` (`RunInputs.submittedByHand`, the
  one source of the fact on the run). A registration question still owed is taken inside the
  hand-back. The hand-back's words are for an application already submitted: it was *"recorded as
  submitted on the university's website"*, and the password advice is to change it now. That is
  his decision 1 rule applied to its own condition: *"not to change their password until every
  submission is done, and advises them to change it after."* Documents the student still had to
  attach are listed as what was not attached, with the admissions office as the way to send them.
  "Before you submit" is no longer said.
- **A person, where no student can take it back.** An account only a person can settle (a creation
  whose outcome is not known, or one with no plan) is held for a person under
  `specialist:submitted_by_hand_owed`.
- **The end.** Once nothing is owed, the run is `completed`. It is the first path that completes a
  run. The client's words for that status were already *"Your application is done here. There is
  nothing more for me to do on it."*
- **What the student is told.** When it is recorded, once: *"A member of the team has recorded that
  your {institution} application was submitted on the university's website on {date}. I will not
  fill in or submit anything more on it."* Then the hand-back, or the hold for a person
  (*"… I will tell you when it is finished."*), and at the end, once: *"That is the last of it."*
  Both promises have tests (row 126, P12 and P13).
- **The stop's words.** A stop or an abandon after a record no longer says *"Nothing was
  submitted."* It says what was recorded, and that stopping does not withdraw it. The sentences
  changed are in `stoppedRemainder`, `heldForAPersonMessage` and `cancellationFinishedMessage`.
- **His run's page-12 stop.** Once a submission is recorded, the held stop may be resolved
  `resume`. Nothing says "moving again", the run opens no page, and the hand-back follows.
  `pnpm run interventions` says so when it refuses a resume of a held page.

**His decision on these choices, 2026-10-14, in his words**
(`docs/run-a/p308-his-decisions-on-p307-as-sent.txt`): *"Your choices D7 to D12 in ADR-0159:
accepted. One addition to D7: whatever the case's internal state, what the student sees must say
plainly that the application was submitted, by them, on that date."* The addition is built in P308.

**My choices, beyond his words, accepted by him on 2026-10-14:**
- **D7. The case keeps its state.** No new state, and not `SUBMITTED`. That would say this system
  submitted it. The record is a fact beside the state, as §11 (ii) describes his case: *"The case
  stays at `AUTHORISED`, its account at `handover_due`."*
- **D8. A second, different record is refused, not replaced.**
- **D9. `observed` or `stated`, no `reasoned`.** It is the shape of his rule on portal facts (P302),
  applied here by me.
- **D10. `completed` once nothing is owed**, and a finishing message.
- **D11. A stop is still taken after a record** (ADR-0053: the stop is refused by nothing). It winds
  down as before, in the words above.
  - Once the run is `completed`, there is nothing left to stop. A stop is refused, and the client no
    longer offers one.
  - A student's own stop at the password box stands until they carry on. Then the run hands the
    account back, or completes, and *"Carrying on … from where you left it"* is not said.
- **D12. Every sentence is mine.**

**Not built, and left as it was** (row 182):
- **A page saved by hand without a submission** still cannot be recorded. ADR-0160 §3's advice
  stands for that case: abandon, do not resume.
- **A report already in flight.** Thirteen sentences in twelve message functions of `run-driver.ts`
  still say *"nothing has been submitted"*. The count is from
  `grep -nE "[Nn]othing has been submitted"` over the file, with its two comment lines left out.
  - Three of them (`specialistMessage`, `contentRejectedMessage`, `blockedByTheFormMessage`) are
    said only from `#stopForSpecialist`. A recorded case returns before that point, in both
    `#decideOnce` and `#announceResumed`.
  - The other nine are said on a runner's report: a failed or stopped creation, sign-in or page,
    and the consent notice met.
  - After a record no work is handed out, and a record is refused while a runner holds work.
    `reportWork` refuses a report whose lease is no longer held. So those nine are reachable only
    through a narrow race: a runner claims work after the record has checked the leases and before
    it has written. Read in the code; no test makes the race.
- **Who recorded it is asserted, not authenticated**, as for a review.
- **The press**, and everything in §3 to §10 that it needs.
- **What the review found and left, each recorded in row 182:**
  - a password box open when the record is made stays open (the wind-down has the same gap);
  - the date the student is told is the record's day in UTC;
  - two identical records at the same instant: the second meets a write conflict;
  - a failure in the advance inside the record answers 500 after the record and the message are
    written;
  - `answerStudent`'s interview branch carries no check of its own. It is read as unreachable for
    a recorded case, and no test reaches it;
  - a recorded case never concludes, so the student's next request for the same course and intake
    is `already_applying`. That is ADR-0006's duplicate rule doing its job, and reapplying is
    refused.

**Proven:**
- **Tests.** In the driver:
  - his case replayed on the gated fixture;
  - a stop after a record;
  - a record before the yes, and one in the interview;
  - a hold only a person can settle;
  - the student's own stop, with and without an account owed;
  - an interview stop;
  - work in flight;
  - the route.

  Also the domain's tests, the orchestrator's, and the command's.
- **Mutations.** Twenty-seven, each guard disabled on its own and run on the finished code. Every
  run was red and every file restored byte for byte. The output is kept unedited in
  `docs/run-a/p307-mutations/`.
  - Earlier rounds were green three times: mutation 01 twice and 12 once. Each green run showed a
    test that could not see the guard. The tests were fixed, and those green runs are kept beside
    the red ones.
- **Checked by a review.** One read-only reviewer found three defects and two risks, all fixed with
  tests seen to fail first. The rest are recorded in row 182.


## Built: his addition to D7 (P308)

**His words**, 2026-10-14 (`docs/run-a/p308-his-decisions-on-p307-as-sent.txt`): *"Your choices D7 to
D12 in ADR-0159: accepted. One addition to D7: whatever the case's internal state, what the student
sees must say plainly that the application was submitted, by them, on that date."*

**What is built to them:**
- **The date is the one stated.** The record carries `submittedOn`, `YYYY-MM-DD`: the date part of
  `--at` as typed, in the zone it was typed in. A time of 00:30 in summer time is told as that day,
  not the UTC day before (row 182 (5), now closed).
  - The domain refuses a date that does not exist, or one the instant falls on in no real zone
    (from twelve hours behind UTC to fourteen ahead).
  - The route and the command refuse an impossible date or an offset outside that range before
    anything is sent.
  - A record written before P308 has no stated date. It is read as its instant's UTC day, which
    is what P307 told the student. Sent again as typed then, it is the same record, and the
    student is not told again in the new words.
- **One sentence, on every surface.** *"You submitted your {institution} application on the
  university's website on {date}."*
  - In the chat: the record's own message, the stop, the abandon (both branches), a hold for a
    person, the worker's repair of a hold left unannounced, the hand-back (*"You submitted your
    application to {institution} on the university's website on {date}, and the account is
    yours."*), and the closing message.
  - On the page: the position line, whatever the run's status; the targets heading; the heading
    over what is left to the student. The offer's heading and button and the stop button say
    nothing of applying: "The application you submitted", "Close it off here", and "Stop here (this
    does not withdraw the application you submitted)".
  - The run reading carries `submitted: { on } | null`. A malformed value refuses the whole read,
    rather than showing a wrong date.
- **"By them" is said on his decision, not read from the record.** The record holds who recorded it
  and how it is known (`observed` or `stated`), not who pressed submit.
- **Nothing on these surfaces contradicts it.** Four surfaces still do, and are his to say (under
  "Not built" below).
  - No *"Nothing was submitted"*, *"it cannot go on"* or *"you can change it yourself"*.
  - No "apply" on the page after a record, and no stop offered on an abandoned recorded run.
  - The stop does not claim anything was filled in.

**My choices, beyond his words, each his to overturn:**
- **The date comes from `--at`.** It is not asked for separately, so the date cannot disagree with
  the time.
- **"Close it off here" on the page**, not "hand my account back". A record may come before any
  account exists. The hand-back, when there is one, says so in the chat.
- **The stop after a record says** *"Anything I already filled in on their form is still saved
  there; I cannot remove it."* It does not say whether anything was filled in, or whether it can
  still be changed: neither is known.
- **The cookie choice stays visible and changeable after a record**, as ADR-0131 §4 has it. My first
  build hid it; the review caught that, and it is restored.

**Also fixed, found on the way and not his to decide:**
- `announcePending` took its batch of twenty-five before skipping the holds already announced. So
  twenty-five older open holds kept every later one from ever being told. It now skips them first.
  This is the first test that pass has had.
- `pnpm run interventions` prints each stop's case, which `submission-by-hand` takes.
- Its resolve text no longer tells the person that the student hears "moving again" after a record.

**Not built, and his to say** (row 182 (11) to (14), and `docs/run-a/p308-rows-181-182-under-his-rule.md`):
- a correction typed after a record still gets the old replies, and with pages saved it escalates the
  run;
- the way back after a stop at the password box still posts *"Apply to {institution}"* into the chat;
- a CV uploaded after a record is met with the late-document question;
- the reapplication panel offers "I withdrew it" and "Apply again anyway" with no word of the
  submission.

**Proven:**
- **Tests.** The domain, the driver (a date typed at 00:30 in its own zone, through the route; an
  account held across a stop, the hand-back and the close, dated just after midnight; both abandon
  branches; the worker's repair; a record from before P308 sent again), the orchestrator's hand-back
  with a stated date unlike the UTC day, the words, the transport, the command, and the page in a
  real browser after a record.
- **Mutations.** Each guard disabled on its own, run on the finished code, kept unedited in
  `docs/run-a/p308-mutations/`: thirty-eight, every one red. Two earlier runs were green, each a
  test that could not see its guard, and are kept beside the red ones: 08, the abandon's branch for
  a case that can no longer be wound down, which no test reached; 23, the calendar check, which the
  first test could not isolate, because "2026-02-30" sorts before March.
- **Checked by a review.** Three read-only reviewers (every surface; the date; tests and
  regressions), and a verifier for the top two findings of each. Every finding the verifiers
  checked was confirmed. What it found is fixed above, with tests seen to fail first, or listed for
  him under "Not built".
