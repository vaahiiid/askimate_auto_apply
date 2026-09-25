# What Run A proved, what it cost, and what it did not prove

**Run A completed 2026-09-22**, attempt 10, on the University of Sheffield's Postgraduate Online
Application Form, on Vahid Mohammadi's own account, under the fifth signature
(`sha256:e2a10113…`). **Nothing was submitted.**

This is the standing record of it. It is not a phase note and it is not in the journal: the phases
are in [`state-of-the-system.md`](./state-of-the-system.md) §2 and the narrative is in
[`where-we-are.md`](./where-we-are.md). This file answers three questions and nothing else — what
was proved, what it cost, what it did not prove — because the third is as much the finding as the
first, and a record that carries only the first is the kind this project has spent phases removing.

Vahid, 2026-09-22, asking for it: *"Record it properly, once, not as a phase note."*

---

## 1 · What Run A proved, on a real portal, on a real account

Attempt 10, in his account of it:

```
sign-in through the consent path, the recorded choice, 4 of 4 held
education.do?new=true     saved, read back — every filled value seen
employment.do             saved, read back
equalOpportunities.do     saved, read back
→ handing_over → I confirmed the handover → ready_to_submit
```

and the portal's own line at the foot of the page:

> *"Completed Part 1 — You have now completed all the required fields in this section and can now
> return to the overview to make your course choices."*

Six things stand proved by that, each against a real portal rather than a fixture:

| | Proved | Where it was in doubt |
|---|---|---|
| **A consent notice answered with the student's own choice** | The runner met `div#ccc-overlay` standing over the sign-in button, recorded the choice it made, and read Sheffield's own record of it back. 4 of 4 held | Blocker 47: dismissing an overlay is a choice made on the student's account, not a click to get past. ADR-0131 |
| **Sign-in, through that path, into an account the student already holds** | Attempt 2 (2026-09-18) was the first to sign in at all; attempt 4 (2026-09-21) the first to fill, save and read pages back. **Sign-in and the consent path held on every attempt from 4 onward** — what failed after them was the institution box (5–7), a month name (8) and a radio (9), never the door | ADR-0110: a run may start on an account the student already holds. Built in P122 and never exercised on a real portal until Run A. Attempt 1 could not press the button at all — blocker 47, the overlay |
| **Six pages filled, saved, and read back** | Personal, contact, nationality, education, employment, equal opportunities. Every filled value seen on re-read; the listing count matched | ADR-0106: a page is saved when the portal shows it, not when a control is pressed. The read-back is the only evidence a file input was kept |
| **A server-backed typeahead** | The institution box: typed key by key, the list fetched by Sheffield's own `loadInstitutionSearch`, the one exact entry chosen, the value the portal records read back as *University of Sheffield* | Attempts 5 through 7 could not fill it at all. ADR-0133, ADR-0135 |
| **A condition read from the portal's own script** | The education page's two pre-completion rows read *"Not required or uploaded elsewhere"* on `summary.do` — **set by the page itself**, exactly as ADR-0138 predicted from `education.js` before the run | Blocker 57. The prediction was made from the script and confirmed by the portal without the runner touching either control |
| **A stop, a handover, and `ready_to_submit` with nothing sent** | `handing_over` → his confirmation → `ready_to_submit`. The capability ladder has no `submit` (ADR-0014) and every run stops there (ADR-0059) | The hard stop was policy from the first week. Run A is the first time it held on a real portal with a real account behind it |

And the check that matters more than any of them, in his words: *"Checked by hand on my own
account, summary.do, section by section against what-will-be-typed.md: every value matches what I
signed."* The preview is the thing the student authorises. On a real portal, for a real account, it
was true.

---

## 2 · What it cost

**Ten attempts. Five signatures. Twenty-seven blockers**, numbered 31 to 57 in
[`state-of-the-system.md`](./state-of-the-system.md) §6 — sixteen closed, eleven still open. Counted
from that register rather than remembered.

The five signatures, each superseded by the next as the content moved under it:

| Hash | Signed | What moved the content |
|---|---|---|
| `sha256:baca64a9…` | 16 September | the entry as first reviewed |
| `sha256:21060fca…` | 21 September, 08:00 | the consent notice became signed content (ADR-0131) |
| `sha256:3238406a…` | 21 September, 12:00 | six pages' save locators, `id=saveBtn` → `name=saveBtn` |
| `sha256:56388e65…` | 22 September | the education month maps, `Sep` → `Sept` (ADR-0136) |
| `sha256:e2a10113…` | 22 September | the pre-completion condition (ADR-0138) **and** the document headings (ADR-0139), signed once together |

### The ones that would have reached a real student

This is the finding, more than the green line. Each of these was invisible to the whole test suite
and was found only because a person walked the path on a real portal. They are ordered by how
quietly they would have failed, because **the silent ones are the ones that matter**: a loud failure
costs an attempt, a silent one costs a student something they cannot get back.

**Silent — nobody would have been told anything was wrong:**

- **The guard that existed only in tests** (blocker 51, P182). `guardContext` — the network guard
  that refuses a write to the portal during preparation — was installed by the *test* harness and
  never by `attach()`, the door a deployed fill goes through. For three weeks the system described a
  protection that was not on the context a real fill used. A declared safety guard with no
  production caller is exactly the class the reachability check exists for, and it passed, because
  a function called only by an unreachable function passes.
- **The summary that said the portal saved nothing** (blocker 51, the same finding). With the guard
  unarmed, `WriteLog.summarise()` still printed *"the portal saved nothing"* — a positive claim
  about a portal, made by a log that had watched nothing. A student reading that would have been
  told a falsehood about their own application, in the system's own voice.
- **The preview that named the wrong documents** (ADR-0139, found by Vahid reading P187's output
  before signing it). The sentence saying what the university was being told read *"your
  officialCertTranslation, your officialTranTranslation …"* — four of the portal's field names, and
  two of them naming the wrong document: `officialCertTranslation` is the page's **Final Academic
  Certificate**, not a translation of anything. A student would have authorised a statement about
  documents that were not the ones being deferred. ADR-0059 — the student can read what they
  authorise — was broken on precisely the line that matters.
- **The stop that never finished** (blocker 40, P158). A stop moved the case to `WINDING_DOWN` and
  the second act that concludes it never ran for an escalated run, so the case could never conclude
  — and a student whose application stopped could never start another.
- **The stop that raised nothing and vanished** (blocker 48, P177). A stop following a resolution
  raised no intervention and the run disappeared from every list. The application was simply gone,
  with nobody told.
- **The dead end with no question and no message** (blockers 34 and 35, ADR-0123, P156). The signed
  entry did not validate against the profile it was signed over; the run stood at *fix content
  (running)* with nothing to fix and nothing said. Eighteen starred boxes in a section Vahid had
  saved empty on the live portal. A student would have waited at a screen that would never change.
- **The message that told a student we made their account** (blocker 38). The stop's wording took
  one boolean and told a student we had created an account when they had declared their own.
  Still open.
- **The interview that says "complete" while the plan is stuck** (blocker 72, P210). Found after
  Run A, by running the goal against an empty profile rather than by reasoning about it: the plan
  blocks on every set-read field that is absent, the interview asks only fields behind a `required`
  marker, and four fields fall in the gap. Once the interview has asked its last question it answers
  `complete`; the plan still holds 23 `value_unavailable` blockers; the driver puts no question for a
  `complete` and raises nothing. The run sits, and nothing says so. Vahid: *"Item 2 is the same
  shape as the silent seven and belongs in that count."* **Closed in P212**: the interview asks what the plan blocks on, and the silent form is a named stop.

**Loud — an attempt was lost, and the reason was unreadable:**

- **`Sep` where Sheffield says `Sept`** (ADR-0136, attempt 8). A month map written from an
  assumption about a list rather than a read of it; all three of the synthetic profile's education
  months would have failed in turn. The capture that refutes it had been in the repository since
  10 September, a few hundred lines from the map that contradicted it.
- **The refusal that said only `refused`** (ADR-0137, attempt 9). `certificateStatus` failed twice
  and the line named no check. Nine attempts had by then taught that a silent failure line costs an
  attempt each time.
- **The widget that took the focus back** (ADR-0135, attempts 5 to 8). The institution box read back
  empty because Tom Select re-focused its own control after the choosing click.
- **A cookie overlay over the sign-in button** (blocker 47, attempt 1 of the third conversation).
  Loud only because it stopped the run; the decision it forced — that dismissing it is a choice made
  on the student's account — became ADR-0131.

None of the eight silent ones is the sort of thing a test suite finds, because each is a statement
the system makes about the world rather than a behaviour inside it. What found them was a person
reading the portal's own page, beside a preview, on a real account.

---

## 3 · What Run A did not prove

Stated in the same place, and with the same weight.

- **Part 2.** The eleven captured pages are Part 1. The course choice is Part 2; the blueprint has
  no page for it and no submission model. Vahid, 2026-09-14: *"Run A ends at the end of Part 1 and I
  am not extending it before it has happened once."* It has now happened once. Part 2 remains unread.
- **Course choice.** Not made, not modelled, not mapped. The portal's own line invites a return to
  the overview to make it; nothing here does.
- **Supporting documents.** Nothing was attached. Every document slot on the education page is the
  student's own act (ADR-0104), and the four the page still shows read *upload later*. The transport
  exists and is proved on the fixture portal; **it has never carried a file to a real portal.**
- **A second portal.** One institution, one course, one intake, one entry. Nothing here says what
  the second costs, and the honest expectation from the first is that it costs a reviewer's reading
  rather than a developer's week — but that is an expectation, not a measurement.
- **A created account.** The run entered an account that already existed. `create_account` is built
  and has never made an account on a real portal.
- **A real student.** Synthetic data throughout, on the operator's own account, under one
  signature that admits that account and no other. **A second reviewer is a precondition of serving
  a real student, not an improvement** (blocker 2, his words) — a field mapped to a plausible wrong
  source is what one signature leaves uncaught, and no gate in this repository refuses it.
- **The interview.** Run A's profile was confirmed through the service's own page by the
  deterministic client. Twenty of the registry's twenty-seven fields have no question defined, and
  the interview stops rather than improvising one. That is Run B.
- **Bedrock.** No model ran. The adapter is built, idle and unwired.

### The education page, stated plainly (added 2026-09-25, P208, at Vahid's instruction)

**Run A filled the education page. The education page is not mapped.** Those are different
sentences and until now this file carried only the first.

Six option maps fill that page, and between them they name **ten values**:

| map | rows it holds | what Run A typed |
|---|---|---|
| `subject` | **1** | `Business Management` — the only row |
| `institution-ts-control` | **1** | `SHEFFIELD` — the only row |
| `gradingSystemId` | **1** | `7` — the only row |
| `highestQualification(UNIVERSITY_LEVEL)` | **1** | `UG DEGREE` — the only row |
| `degree` | 2 | `BSc` |
| `grade` | 4 | `2.1` |

**Four of the six hold exactly one row, and Run A's value is that row.** The run did not pass
*despite* a thin map; it passed *along* one. What it proved on that page is portal mechanics — the
repeating entry, the typeahead, the options that arrive after another field is set, the save and the
read-back — none of which depends on how many rows a vocabulary has. What it did **not** prove is
that a second student reaches the same page and gets through it.

**And one of those six is worse than thin — see blocker 71.** `degree` maps a *level* onto an
*award title*, so `Bachelor's degree → BSc` is a guess that renders. **Run A passed through it
because Niloofar holds a BSc and the synthetic profile agreed with the bug.** Nothing on the path
caught it: the plan had no blocker, the validator no violation, the preview built, and the
read-back passed, because the value landed — it was simply the wrong value.

### A correction to how one of those was counted

`institution-ts-control` was reported in P206 as **1 of 11**. That is wrong, and the wrongness
matters more than the number: **a typeahead has no list to be partial against.** The 11 are what a
single search for *"Sheffield"* returned from an unbounded remote lookup, not options the portal
holds. Calling it *partial* invited exactly the wrong fix — widen the map to 11 — when the shape of
the question is blocker 25's: a typeahead is the student's recognition of a list we never see.

---

## 4 · The mixture on the account is real, and is not being reversed

Sheffield's form now holds, on Vahid Mohammadi's own account, a mixture: Niloofar Hosseini's name,
date of birth, nationality, education and employment, beside his own title, gender and permanent
address.

That was accepted before the run, under [ADR-0110](./decisions/0110-a-run-may-start-on-an-account-the-student-already-holds.md) — a run may start on an account the
student already holds, and on anyone else's account the same mixture would be two people's data in
one record. It is his own account, one signature, admitting that account and nothing else.

**It is recorded, not reversed.** Nothing in this repository removes it and nothing should: deleting
it would make the record of what Run A did less true, and the account is his to clear when he
chooses. Its existence is the standing reason blocker 2 is a precondition rather than an
improvement — the first real student is the point at which a mixture like this stops being
acceptable, and no amount of green makes that moment arrive sooner.
