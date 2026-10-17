# The funding source required on your asterisk, and the stage and source asked after a no in the form's own words: one change, one signature (P319)

**Status: prepared, NOT signed.** Nothing here is applied to `main`, and `approvals.json` still
holds your signature of 13 October (`sha256:2a4ae5a9…`). Your answer 9 makes signing it a step
of your run: *"Agreed: my signature as a step of my run."* The steps for your run (P321) place
it before the run continues.

The change is the patch [`p319-for-signature.patch`](./p319-for-signature.patch). Applied and
signed in one commit, `main` never holds an entry no approval covers. It applies on top of the
P319 commit, which teaches the catalogue to read `absent: "ask"`. On a tree without that commit
the parser refuses the patched entry, naming the mapping's `absent`. So "How to sign" checks
that the P319 commit is in before anything else, and the hash check is the second guard.

## What you asked, in your words (2026-10-17)

Saved whole as sent: [`p319-his-answers-on-row-214-as-sent.txt`](./p319-his-answers-on-row-214-as-sent.txt)
and [`p319-his-answers-on-the-thirteen-as-sent.txt`](./p319-his-answers-on-the-thirteen-as-sent.txt).

> *"6. Yes: treat the funding source box as required on my observed red asterisk, and ask the
> source on my run in P319. Prepare the entry change for my signature; do not sign anything."*

> *"6. Not as recommended. After a "no", offer the other four stages, not "The funding has been
> confirmed": the two contradict each other, and a contradiction in the submitted form is worse
> than one fewer option. If the student says their funding is confirmed, tell them that means the
> answer to "Do you know…" is yes, and offer to answer that field again (§5).*
> *8. Not as recommended. No value is filled against the signed note's current wording, even
> temporarily. The note change and the source rule go into one prepared change, signed by me in
> one signature, as a step of my run before it continues (with 9).*
> *9. Agreed: my signature as a step of my run.*
> *10. Agreed: the four now; the rest with D7.*
> *12. Agreed.*
> *13. Agreed, on one condition: the stand-in approval never carries my name, is plainly marked
> as a test, and cannot be mistaken for my signature anywhere."*

Your answer 12 agreed to the rule resting on your observed asterisk, recorded with the source
`specialist_noted`, in the words of question 12.

## What the patch records

**In the blueprint, 0.2.36 → 0.2.37.**
- `fundingSource` carries `{ "kind": "required", "source": "specialist_noted" }`. The observer
  did not read this star; you did. `observed_marker` is defined as read by the observer, so it
  would claim more than happened.
- One line in the unobserved claims, which is the place the entry says what rests on whom:
  *"P319 (2026-10-17): fundingSource REQUIRED, on Vahid's observed red asterisk at
  docs/captures/sheffield-part2-2026-09-25/taught-page.html:209 (the row's label followed by
  `<font color="red">*</font>`), in his words of 2026-10-17: "treat the funding source box as
  required on my observed red asterisk" (…answer 6). Not on a save the portal refused (ADR-0123
  Decision 1). Recorded specialist_noted: the observer did not read this star; he did."*
- One line of history in the blueprint's own comment, which the hash does not cover.

**In the mapping set, 0.3.48 → 0.3.49.**
- `fundingStage` and `fundingSource` say `absent: "ask"` where they said `absent: "leave_empty"`.
  Nothing else in the entry says `ask`.
- What `absent: "ask"` does (P319, on `main`): where a student's answer lacks the part, the box
  renders nothing and the student is asked for it in the box's own words and options. It never
  renders a value of its own, not even an empty one. Without it, nothing is reopened. That is how
  your answer 8 is held: until you sign, no student is asked these questions and no value is
  filled against the note you signed. The mechanism is mine; the change is yours to sign.
- What a student who answers "no" is then asked, read off the patched entry by the run's own
  derivation:
  - *"Please select your likely funding source"*, with Employer, Self or Family, Sponsor and
    Other: the four options a value of its own names. The scholarships, the loans and the escape
    need a name nobody asked for, so they wait for D7 (your answer 10).
  - *"What stage are you at with your funding?"*, with the four sentences that are not *"The
    funding has been confirmed"* (your answer 6).
- The two notes that said these boxes are left empty for a no are reworded. The wording is mine,
  and yours to correct when you sign:
  - `fundingSource`: *"Left EMPTY for a student who does not know (absent part)."* becomes
    *"Required on his observed red asterisk (…taught-page.html:209), in his words of
    2026-10-17. For a student who does not know how their studies will be funded, this box's own
    question is asked with the four options a value of its own names, Employer, Self or Family,
    Sponsor and Other, and nothing is left empty (absent: ask; ADR-0161 §4; his words of
    2026-10-17: "the four now; the rest with D7")."*
  - `fundingStage`: *"Left EMPTY for a student who does not know; the page's script hides this
    row for No (his expectation, unread — blocker 86 says what happens if it does not)."*
    becomes *"For a student who does not know how their studies will be funded, this box's own
    question is asked with the four sentences a no leaves open, not "The funding has been
    confirmed", and nothing is left empty (absent: ask; ADR-0161 §4; his words of 2026-10-17:
    "After a "no", offer the other four stages"). Whether the page's script hides this row for
    No is unread (blockers 82 and 86): if it does, the fill meets a hidden box and stops for a
    person."*
- One line of history in the mapping set's comment.
- `reviewedBy` and `reviewedAt` are unchanged, so the file is not read as a review you have not
  given. Your signature is the approval.

**The same changes in the drafts** (`blueprint.draft.curated.json`, `mapping-set.draft.json`),
which the entry is held equal to.

**Regenerated, each by its own tool on the patched tree, never retyped:**
- `what-will-be-typed.md`: its version line and its Reference. Every typed, attached and left line
  is the same.
- New prints of P315's, P316's and P317's measures, as `p319-content-stops-on-sheffield.txt`,
  `p319-funding-on-page-12.txt` and `p319-required-boxes.txt`. The earlier prints stay as they
  were printed, and the tests read the new ones.

**Tests moved:**
- the hash pin and the approval's hash, and the version pins;
- P315's and P316's case of your held no: on the patched entry it is refused at both boxes, not
  filled empty, and the run stops for a person until the no is answered again (below);
- the rule's gate: a no given after the change breaks no funding box, so the stage's line leaves
  `scripts/required-boxes-known.ts`. Your D1's list shrinks by one, and none joins it. The test
  titles say this of a no given after the change, and say that your held no is not mended by it;
- "loses a finding when the rule behind it is taken off" runs on the stage left empty, as before
  the change, where taking the rule off still loses the finding. On the change itself a no is
  asked the stage, so the same test there could not fail for its reason;
- "reopens nothing on any entry as signed today" becomes "reopens the funding stage and source on
  Sheffield's entry, by his signature of P319's change, and nothing anywhere else".

## The hash

```
sha256:388debf05a1ff4c2529b1096d3be13ecf6f663d7c6d000823e6686596bb4cb6e
```

Printed by `pnpm run catalogue hash` on the patched tree, by both builds of this change: the first,
and the second after P319's review, whose corrections touched the tests and this sheet and not the
entry's edits.

## What it does (measured on the patched tree)

- **A student who answers no from now on** is asked the source and the stage, in the form's
  words, before the playback, and the plan fills both boxes. The rule's checker finds no answer
  beginning with a no that breaks a funding box.
- **A no held from before** (yours, given on 16 October): the plan refuses at both boxes
  (`render_refused`, `no_such_part`) and the run stops for a person. Today the same answer stops
  at `fix_content`. Either way it stops: a held no is not asked again by itself. You agreed it is
  reached by answering the field again (your answer 1, §5), which is P320. The steps for your run
  put your signature, then your answer, then the resolve command.
- **A yes already given** under 0.2.36 is asked for again before anything is typed. The
  preview's Reference moves (`sha256:c22cfaec…` → `sha256:cf20da6c…`), for the same typed
  content.
- **Your run's questions per application** (`scripts/questions-his-run.ts`): 5 with your title,
  4 with "DBA", on the patched entry and on the entry as signed alike; the two prints differ only in
  their version line. **What that measure cannot see:** it builds its student from
  `docs/run-a/synthetic-profile.json`, whose funding answer is a yes; only the qualifications are
  yours. Your held no is not in it. On the patched entry your own case, planned before the change,
  stops for a person at the two funding boxes (above). A case begun after your signature by a
  student who had said no before it is asked the source and the stage when it first plans: two
  questions more than this count.

## Checks

Every line below is read from the second build's own outputs, kept in the session's scratchpad
(`p319-build-2/`), not from memory of the first.

- **The code that reads the change** (P319, on `main`): each part of it has a test that fails without
  it. Twenty-two mutations, all killed, each restored byte for byte (`docs/run-a/p319-mutations/`).
- **On the patched tree, under a stand-in approval:** the twelve test files that read the entry, the
  approval and the drafts ran 190 of 191. The one that failed asserts that the approval is signed by
  you, and the stand-in fails it by design.
  - The stand-in names `TEST STAND-IN, NOT A SIGNATURE` as author and approver, is dated
    2000-01-01, and its note says it is a test that approves nothing. It does not carry your name,
    and the build stops if it does.
  - It was written only into the scratch worktree's `approvals.json`, never into the repository,
    and never into the patch: the build stops if the patch names an approval. The worktree was
    removed by the build once every step had passed. The first build's worktree and its loose copy
    of the stand-in were deleted before this commit. A search of the whole scratchpad afterwards
    found no approvals file holding it; the files that still name it do so as text: the two build
    scripts that write it, the test logs that quote it, the review's journal and this sheet's
    draft.
- **Made to fail once:** with `fundingStage` set back to `leave_empty` on the patched entry, and the
  stand-in moved to that content's hash (`sha256:2930a0af…`), five tests failed:
  - the gate named exactly
    `bp-sheffield-pgt-september-direct|breaks_a_required_box|finance.funding|fundingStage|required`;
  - the saved print differed;
  - the test of a no given after the change listed the four answers that break the stage:
    `known=false`, and the same with the source Employer, Sponsor or Other;
  - the hash pin;
  - the test that holds the entry equal to the drafts, because only the entry had been edited.

  Restored, the entry printed `sha256:388debf0…` again.
- **The patch round-trips:** reversed on the patched tree, the entry prints `main`'s
  `sha256:2a4ae5a9…`; applied again, `sha256:388debf0…`. `git apply` warns of three new blank lines
  at the end of a file. They end the three new prints as their tools print them, and the tests
  compare the prints byte for byte, so they stay.
- **Without P319's code** (the commit before P319's build, `1dc3f34f`): `git apply --check` refuses
  the patch, the first guard below stops, and the entry alone is refused by the parser:
  `entry.mappingSet.mappings[99].source.format.absent: expected an object`.
- **The patch carries all it needs:** twelve files, among them the regenerated
  `what-will-be-typed.md` and the three new prints, which the first build's patch left out (P319's
  review). On that patch the signature commit would have left four tests red.

## How to sign: one commit

```sh
set -e
grep -q 'if (value === "ask") return "ask";' packages/catalogue/src/parse.ts || { echo "STOP: the P319 commit is not in"; false; }
git apply --check docs/run-a/p319-for-signature.patch
git apply docs/run-a/p319-for-signature.patch
# then edit docs/run-a/catalogue/approvals.json — replace the one entry (below)
pnpm run -s catalogue hash docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json | tail -1 | grep -qx "sha256:388debf05a1ff4c2529b1096d3be13ecf6f663d7c6d000823e6686596bb4cb6e" || { echo "STOP: the hash is not the one in your message"; false; }
git add docs/run-a docs/captures/sheffield-pgt-2026-09-10 scripts/content-stops-on-sheffield.test.ts scripts/required-boxes-hold.test.ts scripts/required-boxes-known.ts scripts/run-a-profile.test.ts scripts/sheffield-draft.test.ts
git commit
```

Each guard stops with a non-zero status, so nothing after it runs.

The approval file keeps **one** entry:

```json
[
  {
    "contentHash": "sha256:388debf05a1ff4c2529b1096d3be13ecf6f663d7c6d000823e6686596bb4cb6e",
    "authoredBy": "Vahid Mohammadi",
    "approvedBy": "Vahid Mohammadi",
    "approvedAt": "<when you sign, UTC>",
    "ownAccountOnly": { "studentId": "5774ff16-ff9c-424a-882f-42d0f304968b" },
    "note": "<your words>"
  }
]
```

## The signing message

Send this, as it stands, if it is true, as the step of your run that P321 names:

> I approve the patch in docs/run-a/p319-for-signature.patch, whose entry hashes to
> sha256:388debf05a1ff4c2529b1096d3be13ecf6f663d7c6d000823e6686596bb4cb6e. Apply it and sign it
> as docs/run-a/p319-for-signature.md says, with approvedAt at the time of signing, and this note:
> "Approved by Vahid: the funding source required on my observed red asterisk; after a no, the
> stage and the source asked in the form's own words, four stages and four sources; the two notes
> reworded." Check that the printed hash is the one in this message before committing, then push
> and report CI.

## What is not in this change

- **A near match offered alone for a press.** Your answer 5 says to suggest one for a press.
  ADR-0146, which you approved, says *"One reading is never an offer"*. So P319 offers two or more
  near matches for a press, and names a single one in its refusal without choosing it. Whether a
  single one may be offered alone is row 216, yours. It is code, not entry, so it is not in this
  change.
- **The offer to answer the field again** for a student who says their funding is confirmed (your
  answer 6). It is §5, P320. Until then such a student is told it means yes, in words that are
  mine, and asked the four stages again.
- **A sentence before a question asked when a case begins.** P319 asks it with the form's words
  alone; whether a student should be told why first is row 217, yours.

## What this costs

Nothing metered: no model call and no AWS. Signing it is a commit.
