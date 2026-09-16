# ADR-0119 — A box handed to the student is their own act on a page we still fill; the record distinguishes filled, handed and never mapped; a list longer than the form stops the fill by name

**Status:** Accepted · 2026-09-16 · extends [ADR-0104](./0104-a-repeating-pages-documents-are-the-students-own-act.md) (own acts, from document slots to any box) and [ADR-0108](./0108-what-the-student-owes-is-a-record-on-the-case.md) (the record at the yes) · closes blocker 29 · records the cut of 2026-09-16
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-16. **Built in P145**, the same day.

## Why this exists: the goal changed, the list did not

On 2026-09-16 Vahid changed what the work is for (ADR-0118): a system that stands and runs end
to end for a professional developer to inherit, not one in front of a real student. He then
asked for the open work to be sorted by that goal:

> *"Go through the five open items, the blockers, and anything you are carrying as 'should be
> done', and sort them into three: Needed to reach Run A at all. Needed before a real student, not
> before Run A. Neither, and I have been doing it out of habit."*

> *"I would rather cut a week of work deliberately today than find in a month that I spent it
> because it was next on a list nobody re-read after the goal changed."*

The sort is in [`../what-was-skipped-to-get-it-standing.md`](../what-was-skipped-to-get-it-standing.md).
Its finding, which he asked to be kept where the next developer reads it: **the goal changed, the
list did not, and a week of work was on it out of habit rather than need.** He accepted the cut in
full: *"The cut is accepted, all of it."*

What reaching Run A needed was not twenty mappings but one mechanism, and this ADR is it.

## Decision 1 — a box handed to the student is their own act on a page we still fill

The mapping's `student_handoff` source, until now a document slot's (ADR-0104) or a pause the
run could not automate, is any box the reviewer hands to the student rather than maps. The runner
types nothing in it and fills the rest of the page. On a repeating page it is one own act per
entry, said under the entry, as the document slots already were.

His one condition, enforced in the preview and its hash:

> *"A field handed to the student must be visibly different in the preview from a field we filled.
> Not a footnote at the bottom, not a count — under the page it belongs to, in the student's words,
> saying which boxes they are filling themselves and that the application is not complete until
> they do. The document slots already do this and the wording is right; use the same shape rather
> than a new one."*

So the preview now reads **page by page**, each page a heading in the portal's words, and under
each page: what is filled, then *You fill in yourself: …* with *We leave these boxes empty for you
to fill in. The application is not complete until you do. Nobody is watching this, and nobody will
remind you.* (the ADR-0108 sentence, kept), then what is left empty. The general *You will
complete these yourself* block at the foot of the preview is gone. A handed slot keeps *You attach
yourself* and its ADR-0107 lines.

Nothing of a handoff crosses to a runner: `toStoredPlan` no longer refuses a plan for a non-file
handoff (`has_handoffs` is gone), and the stored plan carries no handoffs at all. The handover's
list of what the student still owes names the handed boxes with their page.

## Decision 2 — the record distinguishes three states

> *"The record must distinguish three states, not two: filled by us, handed to the student, and
> never mapped. Handed is a decision. Never mapped is a gap nobody has looked at. If those collapse
> into one list, a later developer reading it cannot tell which fields someone thought about."*

- **Filled** — the fill ledger, and the content hash the yes captured.
- **Handed** — `OwnActRecorded`, one per box per entry, now always with its page (ADR-0108).
- **Never mapped** — `FillPlan.unmapped`: every *optional* box nobody mapped, listed under its
  page in the preview (*Left empty: … Nothing you told us goes into these boxes, and the form does
  not require them.*), inside the content hash, and recorded at the yes as `UnmappedRecorded`, one
  per page, kept apart from the own acts on the case (`ApplicationCase.unmapped`). A *required* box
  nobody mapped is still a `no_mapping` blocker: loud, as before.

The two lists never merge: a box in `unmapped` is never an own act, and the driver's test at the
yes asserts it.

## Decision 3 — blocker 29: a list longer than the form's blocks stops the fill by name

> *"Blocker 29: do it now, as you suggest. An hour, and the gate is the whole cost. A history that
> silently drops a period is the exact class of error this system exists to refuse, and leaving it
> because Run A will not hit it is how it stays."*

A page that maps entry 0…n-1 of a list-valued field through indexed `part` rules offers n blocks.
When the confirmed list is longer, the plan carries a `list_exceeds_form` blocker naming the field,
the page, how many were given and how many fit, and the fill stops for a person with that text;
nothing is typed short. Proved on a two-block page with three periods, and on the Sheffield draft's
four blocks.

## Decision 4 — blocker 30 stays, with its note

> *"Blocker 30: not now. Half a day, and the case it protects is a student we are not serving yet.
> Keep the row and the two-line note."*

## The cut, applied

- **Set 0.3.27** hands nineteen boxes to the student for Run A rather than mapping them: the
  language page's seventeen marked boxes except the qualification select and the certificate's
  companion (which follows its slot, ADR-0107), and `degree` and `unlistedDegree` on the education
  page. Each carries its reason. No required field on Part 1 is now without a mapping or a hand;
  what the plan lacks is the synthetic profile's values.
- **The review pack is frozen** with a line at its top saying so, when and why.
- **Cut, as listed:** confirming the thirteen labels and fifty markers before the run (the run is
  the check); the pack's per-sitting notes; further attached reads of pages already read; decision
  sheets for items in the second group; the set's notes addressed to a reviewer.

## What this does not settle, and the read that settles it

Sheffield marks mandatory boxes and, as observed in P81, enforces them on save. A page with a
handed *mandatory* box may therefore refuse to save from our fill. That is loud (ADR-0106's
reopen-and-read sees an unsaved page and the run stops), and it is a fact only the screen settles
for each page. The language page's read is the first; the steps are in the 2026-09-10 capture
README under *Item 4*. If a page will not save with a handed box empty, the next step is the page
as the unit: not filled by us at all, said so under it, with the values we hold listed for the
student — not a new shape, the same one a page wider.

## Settled from the screen, and two more of his decisions — P147, 2026-09-16

**The language page saves empty.** Vahid: *"No error, no complaint, straight through."* The
summary afterwards read *"D. English Language — No English qualifications entered. If you do not
have an English language qualification then you do not need to complete this section."* So the
page-wider mechanism above stays unbuilt, now on an observation rather than a hope, and the
seventeen marks on that page are marks within a section the applicant may skip. *"'Mandatory' on
this form means at least three different things now"*, in his words, and that is said where the
markers are tabled.

**The seventeen are un-handed.** His reasoning, adopting the distinction: *"'A student who has an
English qualification should enter it' is the interview's argument, not the preview's. A hand
says the student must do this and the application is not complete until they do, and both are
false here in Sheffield's own words. Left empty is the honest state."* Set 0.3.28 hands them no
more; the language page's boxes are the third state, left empty and said so, with the form's own
words under the page. Whether a student with a qualification enters it is Run B's interview.

**The section-level fact, built as proposed, erasing nothing.** *"A marker inside a section the
portal says may be skipped is not a box the page will not save without, and that is a property of
the section, not something to fix by erasing marks. Erase nothing."* `BlueprintSection.optional:
{ formSays }` carries the portal's words; the parser keeps it and the hash covers it; the plan's
"required to save" is the marker AND not inside such a section (`isRequiredToSave`); the
seventeen `observed_marker` validations stay exactly as read. The preview says *The form says:
"…"* under the page, in Sheffield's words. Draft 0.2.23 marks the language section so.

**Degree, still handed, pending his throwaway save.** If the entry is kept without a degree, it
is not required to save. If the listing is unchanged, it was dropped silently, and the route he
confirmed stands: *"map the degree for the levels the profile holds, do not hand it, do not build
the page-wider mechanism. A loud blocker on an unmapped value is the gate, and the education page
stays ours to fill."*

**The pattern, named by him and written on the capture README's first screen — and sharpened
the same day (P148).** His throwaway entry with the qualification select unchosen was refused by
name: *"Please complete the following item(s) correctly: Please select your qualification."* So
this portal does both — some deficient saves it refuses by name, others it accepts and quietly
does not keep, both on the same page — and, in his words, *"'Sheffield fails silently' is not a
rule about the portal, it is a rule about some of its fields."* Nothing built here treats an
error-free save as a save (ADR-0106), and nothing treats a `*` as a promise of a complaint.

**Degree, required and mapped (P148).** His route, confirmed and taken: set 0.3.29 maps the
degree for the two levels the synthetic profile holds — *Bachelor's degree* → `BSc`, *Master's
degree* → `MSc`, a reviewer's judgment for the synthetic profile and recorded as such — onto
Sheffield's forty-three captured award titles; any other level is a loud `render_refused`
blocker, never an approximation; `unlistedDegree` is shown only for *Not in list*, which the map
never names, so it stays hidden and unmapped. The set now hands nothing to the student on any
page. A real student's level in the portal's own vocabulary is blocker 25's shape and waits on
him. Found on the way and fixed: a required unmapped box on a repeating page whose visibility a
mapped field decides is now judged per entry — never shown, never a gap; shown for one entry, a
gap said once.

## Built

P145, 2026-09-16: `packages/mapping` (`FillPlan.unmapped`, `UnmappedField`, `list_exceeds_form`,
the repeat rule admitting a handed box, `toStoredPlan` without `has_handoffs`); `packages/preparation`
(`PreviewPage`, `PreviewUnmapped`, the page of every line, `act` on a handoff, the hash, the
page-by-page render); `packages/domain` (`UnmappedRecorded`, `ApplicationCase.unmapped`);
`packages/orchestrator` (handed boxes at the handover; the structural detail); `apps/conversation-service`
(the three states at the yes); set 0.3.27; the frozen pack; eight tests run red first.
