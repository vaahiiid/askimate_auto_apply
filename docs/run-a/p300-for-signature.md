# AUTH 3, 5, 6, 7 and 8 by their real source: one patch, one signature (P300, P301)

**Status: built, not signed.** Nothing here is on `main` as entry content. The batch is the patch
[`p300-for-signature.patch`](./p300-for-signature.patch), applied and signed in one commit, so
`main` never holds an entry no approval covers.

It applies on top of the P301 commit, which teaches the catalogue to read `passwordResetSends`.
- **On `main` with P300 but without P301,** the parser refuses the patched entry loudly, naming
  `passwordResetSends` (measured).
- **On `main` before P300,** the parser drops the sources and the new field without a word, and the
  entry hashes to `sha256:67bb4e99…` instead of the hash below (measured with that commit's parser,
  `6e535c07`).

So "How to sign" checks that the P301 commit is in before anything else, and the hash check is the
second guard.

This sheet was first built in P300 for AUTH 3, 5, 6 and 8, at `sha256:31770fb8…`. It is rebuilt
here with AUTH 7 in it, as you asked. `31770fb8…` was never signed and is withdrawn; its signing
message, if sent, would fail the hash check.

## What you asked, in your words (2026-10-12)

Saved whole as sent: [`p300-his-decisions-as-sent.txt`](./p300-his-decisions-as-sent.txt) (the
message's timestamp in the session record, 18:12:08 UTC).

> *"Row 169: record each of AUTH 3, 5, 6 and 8 by its real source: observed (name the read),
> stated by me (quote me), or reasoned from the design. Nothing reasoned may be recorded as
> observed. AUTH 8 is reasoned. Prepare whatever needs my signature as one sheet, and give me the
> exact signing message."*

And of AUTH 7, from the same message: *"After my result, prepare the entry change for my
signature."* Your result, saved whole as sent:
[`p301-his-auth7-as-sent.txt`](./p301-his-auth7-as-sent.txt).

> *"Record AUTH 7 as observed, with exactly this. … Fold this into P300's sheet as I asked, and
> give me the signing message when it is ready."*

## Why it needs a signature

Before P300 an authentication fact could only be `true`, `false` or `"unobserved"`. The entry had
nowhere to say where a value came from. P300 (on `main`, not in this patch) added an optional
`sources` beside the facts: for each fact, one or more sources, each of one of three kinds:

- `observed`: names the read or the run that saw it;
- `stated`: who said it, on which day, and their words verbatim;
- `reasoned`: what it follows from.

P301 (on `main`, not in this patch) adds `passwordResetSends`, what a portal's "Forgot password"
sends, where someone has tried it. Unlike the sources, **the handover reads it.** On a portal
recorded `new_password_in_plain_text`, a student who loses their password is told that resetting
replaces their password at once and that the new one arrives by e-mail. Its tests went red first.

**The parser refuses:**
- a source that says nothing;
- an unknown kind or key;
- a day that is not `YYYY-MM-DD`, or does not exist;
- an empty `sources`;
- any key in the record that is not a fact, the record's own fields, `sources`,
  `passwordResetSends` or `$comment`;
- any source on a fact recorded as `"unobserved"`, because such a fact rests on nothing;
- `passwordResetSends` beside a reset that does not work or was not tried, and any value but the two.

Both are hashed with the facts, so neither can change under a signature. **The sources are
recorded, not acted on:** the account chooser reads the values, as before.

A fact with no source has none recorded. Nothing reads it as observed by the record's discovery
run.

## What the patch records

The values do not change in the entry. In the draft, AUTH 7 moves from `"unobserved"` to `true`.
Each of the five facts gains its sources, exactly as below. The entry's own list of open questions
(`unobservedClaims`) answers AUTH 3, 5, 6, 7 and 8 the way it already answered AUTH 1, 2 and 4,
naming each kind.

**AUTH 3: passwordless sign-in.** `passwordlessAvailable: false`.
- *Observed:* "The signed-out read of 2026-09-11, run
  attached-sheffield-pgt-september-direct-2026-09-11T12-16-47-760Z
  (docs/captures/sheffield-pgt-2026-09-11-entry): the entry page, read twice, and
  forgottenPassword.do. The login form takes an email and a password, and the only other route
  is a reset. Pages after sign-in were not read for it."
- *Observed:* "The runner's read of the login page of 2026-09-18, run
  attached-sheffield-pgt-september-direct-2026-09-18T16-01-11-335Z
  (docs/captures/sheffield-pgt-2026-09-18-login-as-runner), signed out with tags allowed: the
  same forms and signals as the read of 2026-09-11."

**AUTH 5: MFA or a one-time code.** `mfaOrOtpRequired: false`.
- *Stated* by Vahid Mohammadi, 2026-09-11: "no second factor. I signed in again later with email
  and password only and went straight into the form. No code arrived and none was asked for."
- *Observed:* "Run A (docs/what-run-a-proved.md): sign-in held on every attempt from 4
  (2026-09-21) to 10 (2026-09-22). The runner signed in to his account with his email and
  password, through the consent path, read the page for a second factor after pressing sign in
  (apps/browser-runner/src/sign-in.ts), and reached the form each time. Registration was not
  observed by a run."

**Your words are quoted from P92's record, not from your message.** P92 (`4a1f550b`, 2026-09-11)
recorded them as your direct statement. Two places hold them whole: the capture draft's comment
(`docs/captures/sheffield-pgt-2026-09-10/portal-authentication.draft.json`) and the capture's README
(`docs/captures/sheffield-pgt-2026-09-11-entry/README.md`, AUTH 5). Two hold them shortened:
- the target file (`targets/sheffield-pgt-2026-09.json`) keeps only the last two sentences;
- the target document (`docs/target-sheffield-pgt.md`) cuts the middle with "…".

The message you typed them in was not saved in this repository. If you still have your
conversation of 2026-09-11, that is where they can be checked.

**Three ways to answer:**
- **They are your words.** Send the signing message below.
- **They are not as you said them.** Do not send it; say what you said, and I will put that in.
- **You cannot confirm the wording.** Say so, and I will rebuild the patch with AUTH 5 resting
  on Run A's observation alone. Nothing you would need to recall goes into signed content, and
  the rebuilt patch comes with a new hash and message.

**AUTH 6: a CAPTCHA.** `captchaPresent: false`.
- *Observed:* "The signed-in read of 2026-09-10, run
  attached-sheffield-pgt-september-direct-2026-09-10T16-13-23-186Z
  (docs/captures/sheffield-pgt-2026-09-10, P81): eleven pages, no CAPTCHA signal. Google Tag
  Manager was refused."
- *Observed:* "The signed-out read of 2026-09-11, run
  attached-sheffield-pgt-september-direct-2026-09-11T12-16-47-760Z
  (docs/captures/sheffield-pgt-2026-09-11-entry): no CAPTCHA script, iframe, widget or marker on
  the entry page or forgottenPassword.do. Google Tag Manager was refused, so a CAPTCHA a tag would
  inject could not have loaded."
- *Observed:* "The runner's read of the login page of 2026-09-18, run
  attached-sheffield-pgt-september-direct-2026-09-18T16-01-11-335Z
  (docs/captures/sheffield-pgt-2026-09-18-login-as-runner), signed out with tags allowed: the
  same signals, no CAPTCHA."
- *Observed:* "Run A, attempts 4 (2026-09-21) and 10 (2026-09-22) (docs/what-run-a-proved.md;
  P178 in docs/state-of-the-system.md): the runner reads the page for a CAPTCHA before and after
  signing in and as it fills (apps/browser-runner/src/sign-in.ts, fill-application.ts). Attempt 4
  saved the personal, contact and nationality pages and attempt 10 the education, employment and
  equal opportunities pages, six pages of Part 1 between them, and neither met one. Registration,
  submitted, was not observed for it."

  *(Corrected by P300's review: the first version of this sheet credited attempt 10 alone with
  six pages. Attempt 10 saved three; attempt 4 saved the other three.)*

**AUTH 7: "Forgot password".** `passwordResetAvailable: true`, and, new beside it,
`passwordResetSends: "new_password_in_plain_text"`.
- *Stated* by Vahid Mohammadi, 2026-10-12, these words exactly, inserted from
  [`p301-his-auth7-as-sent.txt`](./p301-his-auth7-as-sent.txt) by a script, never retyped:

  > "Forgot password" works, but it does not send a reset link. Sheffield immediately generates a new password, replacing the old one, and e-mails it in plain text to the account's e-mail address, with a recommendation to sign in and change it. I am changing it now.

- **What the reset sends**, as a fact the handover reads: a new password, replacing the old one at
  once, e-mailed readable. Recorded only beside a reset that works; a portal with no such record is
  told nothing about what a reset does.
- **The claim answered** in the entry's open questions, in our words and pointing at yours: *"YES,
  AND IT REPLACES THE PASSWORD AT ONCE — STATED by Vahid, 2026-10-12, who tried it on the account
  used for the reads: no reset link is sent; Sheffield generates a new password, replacing the old
  one, and e-mails it in plain text to the account's address. The run never presses it."*

**Three readings of your message that are mine, not yours. Say if any is wrong, and I will rebuild:**
- **The kind is `stated`, not `observed`.** You wrote "Record AUTH 7 as observed". In the record,
  AUTH 7 stops being `"unobserved"`. Its source is `stated` because the type's `observed` names a
  read or a run, and your try was neither: it is your own observation, in your words. AUTH 5's
  statement of 2026-09-11 is recorded the same way.
- **"Exactly this" is the paragraph alone.** That is the paragraph after your opening line, ending "I
  am changing it now." Your opening line stays in the saved file and is not in the entry:
  > AUTH 7, observed by me today (12 October, about 20:45 UK time) on the Sheffield account used for our reads:
- **The value is `true`.** The question asks whether "Forgot password" works and whether the reset
  goes to the account's own address. By your words it does both. That a reset REPLACES the password
  is recorded beside it, in `passwordResetSends`, not by changing the value.
  On the account you tried, the account's own address is not your profile's (your second message,
  [`p301-his-account-as-sent.txt`](./p301-his-account-as-sent.txt)). The question asks about the
  account's address, so that does not change the value; what it changes for the run is recorded
  on `docs/state-of-the-system.md`, row 174, and the patch carries no address.

**AUTH 8: control handed back cleanly.** `credentialsCanBeHandedBack: true`.
- *Reasoned:* "AUTH 1 and the design: the password is the student's own, chosen at registration
  and never held by AskiMate (ADR-0020, ADR-0101), and nothing seen on the portal would prevent
  the student taking control (docs/captures/sheffield-pgt-2026-09-11-entry/README.md, AUTH 8:
  'settled by AUTH 1, not by a page'). No account has been handed back on this portal, so nothing
  has observed it."

**What the observed sources do not cover.**

- No read submitted registration for AUTH 5 or AUTH 6.
- AUTH 3 was not read after sign-in.
- The CAPTCHA reads that refused Google Tag Manager could not see a CAPTCHA a tag injects. The
  2026-09-18 read and Run A allowed tags.

Each source says this in its own words.

**What the patch leaves without a source.** AUTH 1, 2 and 4. Your words named AUTH 3, 5, 6 and 8,
and then AUTH 7. AUTH 4 rests on your statement of 2026-09-11, and AUTH 1 and 2 on the reads; the
entry's open questions already say so.

### Everything else in the patch

- **Blueprint 0.2.35 → 0.2.36 and mapping set 0.3.47 → 0.3.48.** The open-question lines are in
  the blueprint, and the mapping set names the blueprint version it was reviewed against.
- **What that does to a run already said yes to.** The preview's reference includes the blueprint
  version, so it moves (`sha256:29c0efb2…` → `sha256:c22cfaec…`, in `what-will-be-typed.md`).
  - A run whose student said yes under 0.2.35 is asked for the yes again before anything is
    typed, for the same typed content.
  - Nothing saved on the portal is lost. A run in flight re-derives its page position on the new
    version.
- **The same lines, facts and sources in the drafts.** The changes are made in
  `blueprint.draft.curated.json`, `mapping-set.draft.json` and
  `portal-authentication.draft.json`. The draft's AUTH 7 moves from `"unobserved"` (P299) to
  `true`, with your words as its source and `passwordResetSends` beside it. The patch touches
  neither file's comment: `main`'s comments already say what is true before and after you sign.
- **`what-will-be-typed.md` regenerated.** Only its version line and its reference hash change.
  Every typed, attached and left line is the same (regenerated on the patched tree and compared).
- **Tests.**
  - The hash pin and the version pins move.
  - The test that holds the entry equal to its drafts now also holds:
    - the five sources;
    - AUTH 8 reasoned, and only reasoned;
    - your AUTH 5 words exactly, and the same words in the draft's comment;
    - your AUTH 7 words exactly, read from the saved message as the test runs;
    - every observed source naming a capture's run or Run A's record;
    - `passwordResetSends`;
    - the draft's eight facts and sources equal to the entry's.
  - The draft's AUTH 7 test now holds that the chooser picks `student_chosen` with AUTH 7 as you
    tried it, and refuses, naming that one question, with it set back to unobserved.
  - **The patch adds no test**, so the census does not move and the signing commit carries the
    patch and the approval alone.

## The hash

```
sha256:e74ade254c751bba66c688357d2ee440d21eb9e895c9652869b687d8b1973b87
```

Two earlier builds are withdrawn, and no message names either:
- `sha256:82127c34…`: P300's first, which credited Run A's attempt 10 with six pages;
- `sha256:31770fb8…`: P300's corrected build, before AUTH 7.

## What it does to your run (measured)

`scripts/questions-his-run.ts` on the patched entry:
- **5** questions today with your title;
- **4** with "DBA";
- **0** under ADR-0156 with the intake answers.

That is as on `main`. The six synthetic students are unchanged (`scripts/questions-by-nationality.ts`,
output identical below its version line). The chooser still picks `student_chosen` for Sheffield.
A yes you gave under 0.2.35 would be asked again (above).

**One thing changes for a student, and it is the one you asked for.** Once you sign, Sheffield's
handover says what its reset does. The reset replaces the password at once, and the new one arrives
by e-mail, in plain text, at the address the account is registered with. Where it says this depends
on the account:
- **An account the student already holds:** the handover says it where they might lose their
  password.
- **An account the run creates:** the reset is still owed before handover (ADR-0050 §4; row 177),
  so the handover says it there, as the thing to do now.

The code that says it is on `main` (P301). The entry's `passwordResetSends` is what turns it on for
Sheffield. Until you sign, the handover says only to use "Forgot password", and nothing about what
it does.

## Checks

- **The parser's tests went red first.**
  - **P300's:** sources kept. Refused:
    - an unknown fact;
    - an empty list;
    - an unknown kind;
    - a blank read;
    - stated words missing;
    - a date not `YYYY-MM-DD`;
    - blank reasoning;
    - an unknown key;
    - a source on an unobserved fact;
    - an empty `sources`;
    - an impossible day;
    - a misspelt `source`.
  - **P301's:** `passwordResetSends` kept and hashed. Refused:
    - empty;
    - unknown;
    - beside an unobserved or `false` reset.
- **On the patched tree, under a stand-in approval** (never committed, its note saying it is not
  yours):
  - the ten test files on the entry, the approval and the drafts: 212 of 212, and 212 of 212
    again after P301's review changed the parser and the runner;
  - the catalogue check admits the one account.
- **Made to fail once (P301):** one character of your AUTH 7 words changed in the entry ("plain
  text" → "plain-text") turned the test red on the source, and on the hash pin; restored, the
  hash printed the one above again.
- **AUTH 8's** deliberate failure is P300's and was not repeated here; its assertion ran green in the
  212.
- **The patch round-trips:** applied, it prints the hash above; reversed, `main`'s
  `sha256:546b2948…`.

## What stays open, and is yours

- **A reasoned fact still counts for the chooser (P300).** AUTH 8 is recorded as reasoned, and the
  chooser reads its `true` as it did before. Whether a reasoned fact may stand where the chooser
  takes the portal's word is yours to say.
- **The reset a created account's handover asks for (P301).** For an account the run creates on
  Sheffield, which is what your item-6 run does, ADR-0050 §4 asks the student to use the portal's
  reset as proof that they receive mail. That item is "the student has set their own password via
  the portal's reset flow". By your observation, that reset replaces the password they typed
  through our box, and e-mails a new one in plain text. Should the requirement stand on Sheffield,
  be dropped there, or be replaced by another proof? Your words of 2026-10-01 record an
  acknowledgement e-mail at registration (the AUTH 4 line). Unchanged until you say; the handover
  now at least tells the student what the reset does.
- **These are recorded on `docs/state-of-the-system.md`, row by row.**

## How to sign: one commit

```sh
grep -q passwordResetSends packages/catalogue/src/parse.ts || echo "STOP: the P301 commit is not in"
git apply docs/run-a/p300-for-signature.patch
# then edit docs/run-a/catalogue/approvals.json — replace the one entry (below)
pnpm run catalogue hash docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json   # must print the hash above
git add docs/run-a docs/captures/sheffield-pgt-2026-09-10 scripts/run-a-profile.test.ts scripts/sheffield-draft.test.ts
git commit
```

The approval file keeps **one** entry:

```json
[
  {
    "contentHash": "sha256:e74ade254c751bba66c688357d2ee440d21eb9e895c9652869b687d8b1973b87",
    "authoredBy": "Vahid Mohammadi",
    "approvedBy": "Vahid Mohammadi",
    "approvedAt": "<when you sign, UTC>",
    "ownAccountOnly": { "studentId": "5774ff16-ff9c-424a-882f-42d0f304968b" },
    "note": "<your words>"
  }
]
```

## The signing message

Send this, as it stands, if it is true:

> I approve the patch in docs/run-a/p300-for-signature.patch, whose entry hashes to
> sha256:e74ade254c751bba66c688357d2ee440d21eb9e895c9652869b687d8b1973b87. Apply it and sign it
> as docs/run-a/p300-for-signature.md says, with approvedAt at the time of signing, and this note:
> "Approved by Vahid: AUTH 3, 5, 6, 7 and 8 recorded by their real source; AUTH 7 in my words of
> 2026-10-12; AUTH 8 reasoned from the design, not observed." The AUTH 5 words quoted in it are
> mine, as I said them on 2026-09-11. The AUTH 7 words are the paragraph of my message of
> 2026-10-12 that ends "I am changing it now.", as saved in docs/run-a/p301-his-auth7-as-sent.txt.
> Check that the printed hash is the one in this message before committing, then push and report
> CI.

If any of the three readings under AUTH 7 above is not what you mean, do not send it; say which,
and I will rebuild.

## What this costs

Nothing metered: no model call and no AWS.
