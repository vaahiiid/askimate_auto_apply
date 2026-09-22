# ADR-0138 — A document slot carries the condition the form shows it by, in the student's own terms

**Status:** Accepted, **one Consequences claim corrected 2026-09-22 (P189)** — the hash it named as awaiting a signature was never signed; the decision itself stands · 2026-09-22 · decides **blocker 57**, raised by attempt 9 · continues [ADR-0104](./0104-a-repeating-pages-documents-are-the-students-own-act.md) (a condition inside a repeat is answered per entry), [ADR-0105](./0105-a-slots-companion-is-handed-with-its-slot-and-a-list-may-be-loaded-by-a-press.md) and [ADR-0107](./0107-a-handed-slots-companion-says-later.md) (a handed slot's companion says *later*)
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-22 — option **B**, against the two alternatives the sheet put beside it. **Built in P187**, the same day. Voided the entry's signature; **signed together with ADR-0139 on 2026-09-22** (`eb4e83e`) — see *Consequences*.

## Context — one radio refused, twice

Run A, attempt 9, 2026-09-21. Sign-in, the consent notice and the institution typeahead all held,
and P185's month spellings took. Then:

> page fill failed — 1 of 19 boxes did not take its value (refused): `certificateStatus` …
> failed (`portal_refused`) — **twice**

On 11 September Vahid had reported that the education page showed **four** document rows while the
discovery's DOM read held **six**. The two extra were never explained. Attempt 9 explained them,
and his own account's `summary.do` had been saying so all along:

> *Certificate / Proof of Registration: Not required or uploaded elsewhere*

`education.js` is committed (`33aa901`, P184's capture of the page's own scripts), so the branch is
readable rather than inferable. `endDateChanged`:

```js
var month = document.getElementById("endDateMonth").selectedIndex;
var year  = document.getElementById("endDateYear").value;
var awardMonth = document.getElementById("awardDateMonth").selectedIndex;
var awardYear  = document.getElementById("awardDateYear").value;
if (awardYear.length == 4 && awardMonth > 0) { month = awardMonth; year = awardYear; }
…
if (endDate > startOfMonth) {
    document.getElementById("preCompletionDocuments").style.display = "";   // SHOWN
    …
    return;
}
…
document.getElementById("preCompletionDocuments").style.display = "none";   // HIDDEN
…
if (getRadioValue(form.certificateStatus) == null …) document.getElementById("certificateNotRequired").checked = true;
if (getRadioValue(form.transcriptStatus)  == null …) document.getElementById("transcriptNotRequired").checked  = true;
```

So: the page compares the **award date**, or the end date when no award date is given, with the
first of the current month. Later than that — the qualification has not ended — and the
`preCompletionDocuments` block is **shown**: *Proof of Registration* and *Most Recent Transcript*,
the slots whose radios are `certificateStatus` and `transcriptStatus`. Earlier, and the block is
**hidden** and the page ticks both radios to *Not required* itself.

The synthetic student finished in June 2022 and was awarded in July 2022. The block was hidden. The
runner was typing into a control that was not on the page, and the fill reported `portal_refused`
because the refusal was real.

## The three options, and why B

Put to Vahid as blocker 57:

**A — read the page.** Decide at fill time from the dates the plan is about to type. Rejected by
him: *"a signed plan must not depend on the day it runs."* A plan signed in September and run in
October would enter different things for the same student, and the preview would have been a
statement about a day that had passed.

**C — carry on past a hidden control.** Skip any control the page does not show, generally.
Rejected, in his words:

> *"C makes the preview false. The student authorised 'we are telling Sheffield your proof of
> registration is coming later', and under C the runner would skip that act while the page records
> 'not required' in its place. The student said yes to a statement that was never made, and the
> portal holds a different one. The preview is exactly what will be entered; C breaks that sentence
> on the first completed qualification. And C as a general rule is worse: a control can be hidden
> because an earlier answer was wrong. Carrying on past it hides the mistake that hid it. A hidden
> control the plan meant to set stays a stop, named, as it now is."*

**B — the condition, on the slot, in the student's own terms, signed.** Chosen:

> *"So B: the condition in the student's own terms, on the slot, signed. When the qualification's
> end is 'completed', the two pre-completion slots — `certificateStatus` and `transcriptStatus`
> with their files — are not planned, not previewed and not set. The preview for a completed
> qualification then shows four documents, which is what the page shows."*

## Decision

A `RequiredDocument` may carry **`askedWhen`**: the entries of a repeating page the form asks that
slot for, read off the **entry itself** rather than off another control.

```ts
interface SlotAskedWhen {
  readonly part: readonly string[];   // the path into the entry, e.g. ["end", "kind"]
  readonly is: readonly string[];     // the answers the form DOES ask this slot for
  readonly because: string;           // the reviewer's own words, signed with the rest
}
```

Four things follow, and each is a property the build holds:

1. **It is not a `visibleWhen`.** A `FieldCondition` is over another control's value, which is the
   right shape when the portal's script watches a control. Nothing on this page holds *"whether the
   student has finished"* — the page computes it from two dates and a clock. The fact is the
   student's, so the condition reads the student's own answer.
2. **It is answered per entry**, in the same loop and by the same rule as ADR-0104's conditions:
   one qualification may be asked for the slots and the next not.
3. **The slot and its companion go together.** A companion is a statement *about* a slot
   (ADR-0107); a statement about a slot the page never shows is a statement made into a control
   that is not there. When the condition does not hold, neither the file nor the radio is planned,
   previewed or set.
4. **Nothing is dropped silently.** Both are recorded in the plan's `hidden` list with
   `whenEntrySays: { part, holds }` — the path read and what this entry holds there — so
   `validatePlan` reads them as neither filled nor missing, for the reason it can name.

The `part` is read through the **same rule a mapping's `part` format uses**, so a reviewer writes
one path language, not two. An entry that does not answer the path **stops the plan**
(`render_refused` on the slot) rather than defaulting either way: a slot planned or dropped on a
guess is the class of thing the fill exists to avoid.

A page that does not repeat has no entry to answer the condition against, so `askedWhen` there is
**refused at parse** — not ignored. A rule that decides nothing would read to a reviewer as a rule
that decides something.

## What B does for each of the three ends

`Qualification.end.kind` is `completed | expected | discontinued` (ADR-0112). Sheffield's page
branches on **the date**, not on the kind, so each answer below is a reading of the branch:

| The student's answer | What the page does | What the plan does |
|---|---|---|
| **`expected`** — still studying, the end is a date in the future | the block is **shown**: the student is asked for proof of registration and a recent transcript | **sets both**, as it always did — the slots are planned, previewed and entered |
| **`completed`** — finished, the end is past | award date, else end date, is behind the start of this month, so the block is **hidden** and the page ticks both radios *Not required* itself | **does not plan, preview or set them.** Four documents, which is what the page shows |
| **`discontinued`** — left before finishing | Vahid: *"Discontinued I do not know — read the branch and say which way the page goes."* The page has **no notion of it**: `education.js` never mentions a discontinued qualification. It goes by the date, and a qualification the student has left ended when they left, which is past. So the block is **hidden**, the same as completed — and after either hiding branch, the grade branch included, the same two lines tick *Not required* | **does not plan, preview or set them**, for the same reason as completed |

So the condition is written `is: ["expected"]` — the one end for which the page asks. That is one
rule covering all three answers, and it is the page's own rule restated in the student's terms.

## The known divergence, named because it is real

**B is not the page's literal rule**, and the difference has a case. The page compares the **award
date** — falling back to the end date only when no award date is given — with today. A student who
has **completed** a qualification but whose **award date is still in the future** (finished in June,
graduating in November) would be shown the block by the page, while the plan, reading
`end.kind === "completed"`, would not set it.

What happens then, in Vahid's own account of this portal — his reading of it, not a measurement
made here:

> *"the save leaves two radios unanswered, which on this portal drops the entry silently — and the
> listing count catches that as uncertain, not succeeded."*

So: two radios unanswered, the entry dropped without a word, and the listing count (ADR-0106)
reading back one fewer entry than it entered, which reports the page **uncertain** rather than
saved. Whether the portal drops the entry has not been observed here; what the listing count does
with a missing entry has, and that is the part that makes the failure loud.

Vahid, accepting it:

> *"That is a loud failure, and I accept it for an edge that a student who has finished but not yet
> been awarded would hit. Name it in the ADR as the known divergence."*

The alternative was A, which he had already rejected for a better reason than this edge is worth.
A loud failure on a narrow case is the right trade against a plan that means something different
depending on the day it runs.

Two smaller divergences, recorded so a later reader does not rediscover them as bugs: the page's
`erasmusStudyAbroad` branch returns before touching anything (its body is commented out), and
everything after it is inside `if (!finalDocumentsNotExpected)`, so that flag skips the whole
function. On either the block keeps whatever the server rendered, and `askedWhen` would not track
it. **What is known about the flags:** Vahid read `window.erasmusStudyAbroad` on the live page,
2026-09-22 — `boolean false`. `finalDocumentsNotExpected` and `visitingResearch` have **not** been
read, and nothing here claims a value for them.

## Built in P187

- **`packages/blueprint`** — `SlotAskedWhen`, and `RequiredDocument.askedWhen`.
- **`packages/catalogue`** — parsed and therefore hashed (the P97 lesson: an unrecognised field
  reaches nothing and signs for nothing). Refused: an empty or blank `part`, an empty `is`, a
  missing `because`, and `askedWhen` on a page that does not repeat.
- **`packages/mapping`** — answered per entry in `planFill`'s repeat loop, before anything is
  planned for that entry; `HiddenField.whenEntrySays` carries the reason; an unreadable path raises
  `render_refused`.
- **Sheffield's entry and the curated draft** — `askedWhen: { part: ["end","kind"], is: ["expected"] }`
  on `certificate` and `transcript`, with the reason quoting the page's script. Blueprint 0.2.26 →
  **0.2.27**, mapping set 0.3.32 → **0.3.33**.
- **Red first.** Without the plan change, the fixture's finished qualification planned the slot for
  both entries (`[0, 1]` where `[0]` was expected) and an unreadable path was ignored in silence;
  without the parser change, `askedWhen` round-tripped to `undefined` and the hash did not move.

## Consequences

**The entry's fourth signature is void.** `docs/run-a/what-will-be-typed.md` loses four lines and
one clause for the synthetic student's completed qualification:

```
- Proof of Registration …: I will upload proof of registration later  (sent as "UploadLater")
- Most Recent Transcript …: I will upload my transcript later  (sent as "UploadLater")
- You attach yourself: certificate
- You attach yourself: transcript
- We are telling University of Sheffield that your certificate, your transcript, your …
+ We are telling University of Sheffield that your officialCertTranslation, your …
```

Two of those are values the portal will no longer be told — unlike the consent and save-locator
re-signatures, this one **is** what goes into a box. The approval was removed rather than
re-pointed, and the directory refused the entry until he signed it himself. An agent never writes an
approval hash.

**Amended 2026-09-22, the same day.** This section first named
`sha256:cdb4356128ee269aebffdcb35d236588731c721e2ccb2ce11a3ce8826bf5bf82` as the hash awaiting a
signature. It was never signed. Reading this preview, Vahid found the fault ADR-0139 fixes and said
*"There is no point signing cdb43561 and re-signing in an hour"*, so the two changes moved the hash
once, together. **The signed hash is
`sha256:e2a10113c9e0f3536c1081cb3f51a7ea682ed6fceec9694d391a708a85f2b080`**, signed by Vahid
Mohammadi on 2026-09-22, his own account only, commit `eb4e83e`, from his own hash computation.

**Blocker 50 is untouched** by this: the `0159`/`SHEFFIELD` value disagreement on the institution
typeahead is still open.
