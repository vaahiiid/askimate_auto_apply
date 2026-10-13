# What stands between today and his live run reaching `ready_to_submit` (P302)

He asked, on 2026-10-13 ([as sent](./p302-his-decisions-as-sent.txt)): *"Before building more
safety around accounts, tell me what stands between today and my live run creating its own account
and reaching ready_to_submit, as a short numbered list."* His live run, in his words of the same
message: *"a NEW Sheffield account, created by the run itself (ADR-0144), with my own e-mail
address."*

**Method.** One workflow, read-only, at HEAD `c387f455`. Five readers covered the records, the code
path, the signed entry's coverage, his data, and what has been rehearsed. Then came one synthesis
and one completeness critic. The critic checked every item against its cited lines and corrected
four. Then I re-read the items most likely to surprise him: the creation's consent check and the
financial-review gate. The commands run were `pnpm run -s catalogue check docs/run-a/catalogue`,
`npx tsx scripts/questions-his-run.ts <entry>` (with and without `DBA`), and
`npx tsx scripts/portal-onboarding-time.ts docs/onboarding/sheffield-pgt.json`. The critic also
made a scratch measure of his uncorrected Master's words, which was not saved, so its number is
not quoted here. **What it cannot see:** his profile, his database, his
conversation's state, any review already recorded on his machine, and the live portal. Each item says
where that matters.

## The list, in the order the run meets it

1. **Done 2026-10-13 (P303): signed at his word, `sha256:2a4ae5a9…`.** As written before it:
   **his signature on the rebuilt sheet** (`docs/run-a/p300-for-signature.md`, `sha256:2a4ae5a9…`).
   Sign it before his yes on the preview, because a signature after it asks for the yes again. The
   run does not wait on it: the signed entry `546b2948…` admits his account today.
   *His act.*
2. **His decision: today's code, or ADR-0158 first.** Today the run gets as far as the account
   without ADR-0158, asking him 4 choices from the form's lists once item 7 is done. Two of his
   ADR-0158 points differ from what today's code does on his run:
   - the subject search types the recorded word `international`, not his exact words (point 4;
     `apps/conversation-service/src/entry-choice-offer.ts:211-221`, `packages/mapping/src/plan.ts:475`);
   - the escape is pressed on his choice recorded in the chat, not on an intake rule plus a live
     search (point 2; `plan.ts:466-478`; ADR-0156's intake rules are unbuilt).

   If those points must govern his own run, ADR-0158 and ADR-0156's intake rule are built first, and
   he chooses the ordering. *His decision.*
3. **Account creation must answer Sheffield's consent notice at the press, as the sign-in does.**
   Today the creation looks for the notice once, as the page opens
   (`apps/browser-runner/src/create-account.ts:166-211`). A notice that arrives later makes the
   press fail into `uncertain`, and the run stops for a person (`create-account.ts:264-282`). The
   sign-in met exactly that race on Sheffield's page 0, and handles it at the press
   (`sign-in.ts:219-247`). Registration and login are the same page there. *Code to build.*
4. **Does his own e-mail already have a Sheffield account?** A duplicate looks like any refusal:
   two attempts, then a person (`create-account.ts:306-311`; row 149). The dedicated address that
   made this moot is gone under his row-174 decision. *An answer only he has.*
5. **Sheffield's password rules.** They are recorded nowhere, and the secure box does not state them
   (`packages/account/src/authentication.ts:676-684`). A password Sheffield refuses spends the
   attempt: two, then a person. *A read, or his knowledge.*
6. **On his machine:** pull `main` and restart the stack on the same database, then continue
   conversation `01M3D473G7EWJDKZ50BTSVEDW7`. The approval admits student `5774ff16-…` only, and a
   recreated database gives a new id the entry does not admit (row 74). *His act.*
7. **Three corrections in the chat, before any page is saved:**
   - `contact.email` to his own address: the account is created on it (`run.ts:704`, `:753`);
   - his doctorate's award title to *DBA* (28 characters at most);
   - his Master's: *Azad University* to *Islamic Azad University*, and its title as he decided in
     P281/P282, *MSc*.

   Uncorrected, the signed identity row types UNI6950, a different university, and the run stops
   for a person on the grading system and the grade (measured on the signed entry, row 134). With
   the corrections, his run is asked 4 choices from the form's lists (`npx tsx
   scripts/questions-his-run.ts docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json DBA`, which
   carries his decided Master's words). Whether he has corrected any of these since is not
   measured. *His act.*
8. **The intervention of 3 October**, if still open: resolve it after the corrections. He chose to
   leave it open until the correction route existed (row 134), and an escalated run waits for a
   person (`run-driver.ts:5825-5832` at P305's commit; `:5719-5726` when written). *His act.*
9. **The mandatory financial-evidence review.** Sheffield's entry maps `finance.funding`, a financial
   field, so the run stops for a human review before the preview
   (`run-driver.ts:11408-11409` at P305's commit; `:11106` when written; `packages/domain/src/transitions.ts:222-237`). He is the only reviewer.
   It is recorded through `POST /internal/v1/cases/:caseId/review` (`routes.ts:1893-1923`), and the
   review intervention is resolved. No runbook step covers it today. *His act; a runbook step is
   mine to write.*
10. **The creation, in the order the code meets it:**
    - his yes on the preview;
    - the password box (its handle lives five minutes);
    - a first attempt that stops at the consent notice with nothing typed;
    - his consent choice;
    - the creation again; the box reopens if the five minutes have passed (`run.ts:737`, `:749-750`,
      `:959`).

    It has never made an account on a live portal. Success is read from the page path changing, on
    one observation (row 89). *His acts; the outcome only his run shows.*
11. **The fill on the new account:** pages 3, 4, 5, 7 (once per qualification), 8 (once per job), 9
    and 12. Pages 6, 10 and 11 have nothing mapped and are never opened (row 168). Part 2 (page 12)
    has never been run. Sheffield says Part 1 must be complete before Part 2 opens, and whether it
    opens with 6, 10 and 11 unsaved is unobserved. If it does not open, the fill returns
    `needs_the_student`, and each retry asks for his password again. Nothing visible caps that loop;
    that is not measured. *A measurement only his run makes.*

    **P305:** the run stops before page 12 until whether saving it is the submission is known. The
    stop before *saving* is his word; stopping before *opening* is ADR-0160 §2's choice, his to
    overturn. What would settle it is ADR-0160 §4, his reads.

12. **The handover, two confirmations in order.**
    - First the reset, which he kept: Sheffield's "Forgot password", pressed by him, replaces the
      password and e-mails a new one in plain text.
    - Then that he can sign in.

    Only then is the run `ready_to_submit` (`run.ts:852-859`, `:608-609`; `ownership.ts:299-304`).
    *His acts.*

    **P304, 2026-10-13:** his decision 1 says *"No password reset before submission"* and *"This
    supersedes my earlier decision on row 177"*. What that reaches, and from when, is ADR-0159 O12.
    ADR-0159 is proposed, and nothing is built until he approves, so the code still asks for the
    reset here. ADR-0159 §11 gives three ways.

## What is left out, and why

These are not gates on the path to `ready_to_submit` for his own run on a new account:
- His rule on reasoned facts, ADR-0157, rows 171 to 173, 175, 176 and 178.
- Row 177's mid-run reset and reads.
- The rest of ADR-0156, and the wording of the creation and handover messages (row 149).
- The document slots he attaches himself.
- Where the final submission is (row 80): it matters only after `ready_to_submit`.

**Cost:** nothing metered on this path, unless the stack runs with `AAS_LOCAL_READER_MODEL=bedrock`.
Then one CV reading is sixty-eight model calls (`docs/run-a/p298-plan.md:106-108`).
