# AUTH 3, 5, 6 and 8 by their real source: one patch, one signature (P300)

**Status: built, not signed.** Nothing here is on `main` as entry content. The batch is the patch
[`p300-for-signature.patch`](./p300-for-signature.patch), applied and signed in one commit, so
`main` never holds an entry no approval covers. It applies on top of the P300 commit, which
teaches the catalogue to read a fact's source (below). On `main` before that commit it would still
apply and parse, but the old parser drops `sources` without a word and the entry hashes to
`sha256:6a3f2092…` instead of the hash below (measured with `main`'s parser). So the hash check is the guard, and "How to sign"
checks that the P300 commit is in before anything else.

## What you asked, in your words (2026-10-12)

Saved whole as sent: [`p300-his-decisions-as-sent.txt`](./p300-his-decisions-as-sent.txt) (the
message's timestamp in the session record, 18:12:08 UTC).

> *"Row 169: record each of AUTH 3, 5, 6 and 8 by its real source: observed (name the read),
> stated by me (quote me), or reasoned from the design. Nothing reasoned may be recorded as
> observed. AUTH 8 is reasoned. Prepare whatever needs my signature as one sheet, and give me the
> exact signing message."*

And of AUTH 7: *"Do not change the signed entry's AUTH 7 until then."* This patch leaves AUTH 7
exactly as signed. If your "Forgot password" result arrives before you sign this, I will rebuild
this sheet with AUTH 7 in it, so that you sign once. The rebuilt sheet will have a new hash, and so
a new signing message. The message below names this sheet's hash, so it cannot sign a rebuilt one.

## Why it needs a signature

Before P300 an authentication fact could only be `true`, `false` or `"unobserved"`. The entry had
nowhere to say where a value came from. P300 (on `main`, not in this patch) adds an optional
`sources` beside the facts: for each fact, one or more sources, each of one of three kinds:

- `observed`: names the read or the run that saw it;
- `stated`: who said it, on which day, and their words verbatim;
- `reasoned`: what it follows from.

**The parser refuses:**
- a source that says nothing;
- an unknown kind or key;
- a day that is not `YYYY-MM-DD`, or does not exist;
- an empty `sources`;
- any key in the record that is not a fact, the record's own fields, `sources` or `$comment`;
- any source on a fact recorded as `"unobserved"`, because such a fact rests on nothing.

The sources are hashed with the facts, so they cannot change under a signature. **They are
recorded, not acted on:** the account chooser reads the values, as before.

A fact with no source has none recorded. Nothing reads it as observed by the record's discovery
run.

## What the patch records

The values do not change. Each of the four facts gains its sources, exactly as below. The entry's
own list of open questions (`unobservedClaims`) answers AUTH 3, 5, 6 and 8 the way it already
answered AUTH 1, 2 and 4, naming each kind.

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

**What the patch leaves without a source.**
- AUTH 1, 2 and 4: your words named AUTH 3, 5, 6 and 8. AUTH 4 rests on your statement of
  2026-09-11, and AUTH 1 and 2 on the reads; the entry's open questions already say so.
- AUTH 7: waits on your result.

### Everything else in the patch

- **Blueprint 0.2.35 → 0.2.36 and mapping set 0.3.47 → 0.3.48.** The open-question lines are in
  the blueprint, and the mapping set names the blueprint version it was reviewed against.
- **What that does to a run already said yes to.** The preview's reference includes the blueprint
  version, so it moves (`sha256:29c0efb2…` → `sha256:c22cfaec…`, in `what-will-be-typed.md`).
  - A run whose student said yes under 0.2.35 is asked for the yes again before anything is
    typed, for the same typed content.
  - Nothing saved on the portal is lost. A run in flight re-derives its page position on the new
    version.
  - *(Corrected by P300's review: the first version of this sheet said nothing a run authorised
    is lost.)*
- **The same lines and sources in the drafts.** The changes are made in
  `blueprint.draft.curated.json`, `mapping-set.draft.json` and
  `portal-authentication.draft.json`. The draft keeps AUTH 7 `"unobserved"` (P299), with no
  source. The draft's comment and the entry's comment name the sources the patch adds. Both
  comments are outside the hash.
- **`what-will-be-typed.md` regenerated.** Only its version line and its reference hash change.
  Every typed, attached and left line is the same.
- **Tests.**
  - The hash pin and the version pins move.
  - The test that holds the entry equal to its drafts now also holds the four sources:
    - AUTH 8 reasoned, and only reasoned;
    - your AUTH 5 words exactly, and the same words in the draft's comment;
    - every observed source naming a capture's run or Run A's record;
    - AUTH 7 with no source;
    - the draft's sources equal to the entry's.
  - **The patch adds no test**, so the census does not move and the signing commit carries the
    patch and the approval alone.

## The hash

```
sha256:31770fb8d8719fd3a8b6433edf50ce8398e7b29c50987dfb5dd5d0c24189be9a
```

The first version of this sheet printed `sha256:82127c34…`. P300's review found AUTH 6's Run A
source wrong (above), and the correction moved the hash. `82127c34…` is withdrawn and no message
names it.

## What it does to your run (measured)

`scripts/questions-his-run.ts` on the patched entry:
- **5** questions today with your title;
- **4** with "DBA";
- **0** under ADR-0156 with the intake answers.

That is as on `main`. The six synthetic students are unchanged (`scripts/questions-by-nationality.ts`,
output identical below its version line). The chooser still picks `student_chosen` for Sheffield,
because the values did not change. A yes you gave under 0.2.35 would be asked again (above).

## Checks

- **The parser's test went red first.** The P300 test that the catalogue keeps `sources` failed
  on the old parser, which dropped them. Its refusals cover:
  - an unknown fact;
  - an empty list;
  - an unknown kind;
  - a blank read;
  - stated words missing;
  - a date not `YYYY-MM-DD`;
  - blank reasoning;
  - an unknown key;
  - a source on an unobserved fact.

  Added after P300's review, red first:
  - an empty `sources`;
  - 2026-02-30 and 2026-13-11;
  - a misspelt `source` beside the facts.
- **On the patched tree, under a stand-in approval** (never committed, its note saying it is not
  yours):
  - the ten test files on the entry, the approval and the drafts: 210 of 210;
  - the catalogue check admits the one account.
- **Made to fail once:** AUTH 8's source put back as `observed` turned the test red, with *"AUTH 8
  is reasoned, and only reasoned"*.
- **The patch round-trips:** applied, it prints the hash above; reversed, `main`'s
  `sha256:546b2948…`.
- **AUTH 7 untouched:** of the patch's changed lines, the only one naming `passwordResetAvailable`
  is the test's check that it has no source. No value or source of AUTH 7 changes.

## What stays open, and is yours

**A reasoned fact still counts for the chooser.** AUTH 8 is now recorded as reasoned, and the
chooser still reads its `true` as it did before. Whether a reasoned fact may stand where the
chooser takes the portal's word is yours to say. If it may not, account creation on Sheffield
stops until a handover is observed, and a handover can only be observed after an account has been
created.

## How to sign: one commit

```sh
grep -q readAuthFactSources packages/catalogue/src/parse.ts || echo "STOP: the P300 commit is not in"
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
    "contentHash": "sha256:31770fb8d8719fd3a8b6433edf50ce8398e7b29c50987dfb5dd5d0c24189be9a",
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

> I approve P300's patch, whose entry hashes to
> sha256:31770fb8d8719fd3a8b6433edf50ce8398e7b29c50987dfb5dd5d0c24189be9a. Apply it and sign it
> as docs/run-a/p300-for-signature.md says, with approvedAt at the time of signing, and this note:
> "Approved by Vahid: AUTH 3, 5, 6 and 8 recorded by their real source; AUTH 8 reasoned from the
> design, not observed." The AUTH 5 words quoted in it are mine, as I said them on 2026-09-11.
> Check that the printed hash is the one in this message before committing, then push and report
> CI.

## What this costs

Nothing metered: no model call and no AWS.
