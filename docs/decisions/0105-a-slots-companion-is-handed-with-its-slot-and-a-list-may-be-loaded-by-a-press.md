# ADR-0105 — A slot's companion is handed to the student with its slot; a list's options may be loaded by a press that loads options and nothing else

**Status:** Accepted · 2026-09-11 · Decided by Vahid Mohammadi, built in P100
**Continues:** ADR-0104 (the documents of a repeating page), ADR-0103 (gaps 1 and 4), ADR-0014 (the click guard)

## The decisions, in Vahid's words — 2026-09-11

Both were raised in P99 from his live read of Sheffield's education page, as proposals and not
builds. He answered:

> *"Both proposals: yes, build them. Reasoning for each, so the record carries why and not only
> what."*

**The companion radio handed with its slot.**

> *"Build it. 'My transcript is in English' is not the student attaching something, it is the
> student answering the question the slot asks. If a student whose documents are in English
> cannot say so, the page cannot be completed, and blocker 21's option B was chosen precisely so
> the education page would be fillable. A rule that makes it unfillable for a whole class of
> applicant is the rule defeating its own purpose, the same shape as the twelve-checkbox cover in
> ADR-0102."*
>
> *"Keep the narrowness: it is a slot's own companion, handed with that slot, and nothing else.
> Not a general licence to hand over any radio on a repeating page."*

**`optionsAfter` naming a control to press.**

> *"Build it. Subject is a search-then-select and there is no way to reach the options without
> the press. Without it the field is unfillable and Sheffield's subject is mandatory."*
>
> *"One constraint I want enforced, not assumed: the control named must be a control that loads
> options, and pressing it must not be able to advance, save or submit the page. You already keep
> a submission-control allow-list for the typeahead entry click. Whatever guards that should
> guard this, and if it cannot, tell me before building rather than after."*

And on what the capture cannot settle, as it stood:

> *"On the six versus four document slots: my four is what the rendered page showed me, and your
> six is what the DOM holds. Both can be true — two hidden by a condition the capture cannot see.
> The draft keeping all six until the next read is right. I will settle it on the re-read rather
> than either of us deciding from where we are standing."*
>
> *"The asterisks, the slot titles and the 'in English' wording are my report and nothing more.
> Keep them marked that way."*

## What this decides

1. **A document slot's own companion may be handed to the student with that slot, and nothing
   else may.** On any page, a `student_handoff` mapping on a field is admissible when the field is
   the companion (`RequiredDocument.companion.fieldRef`) of a slot whose file field is itself
   mapped `student_handoff`. The companion rule of ADR-0103 gap 4 — a companion is mapped by
   nothing — admits exactly this case. On a repeating page, ADR-0104's rule — a handoff on a
   document slot and nothing else — admits exactly this case. A handoff on a companion whose slot
   is not handed with it is refused; a handoff on any other radio is refused.
2. **Such a handoff crosses to the runner with its slot.** The plan carries it once per item on a
   repeating page, marked with the slot it belongs to (`ofSlot`); the transport admits it as it
   admits the slot's; the preview says *You answer yourself:* beside *You attach yourself:* under
   the entry, inside the hash; the handover message names it with the slot it is answered with.
3. **A list's options may be loaded by a press.** `optionsAfter` carries an optional `press`, a
   control pressed after the earlier field is set and before the bounded wait for the named
   option. The runner presses it through the click guard.

## The constraint, as enforced, and the limit stated before building

Vahid asked that the pressed control be one that loads options and that pressing it not be able
to advance, save or submit — enforced, not assumed — and that the guard on the typeahead entry
click guard this too, or that he be told before building if it could not.

The guard on the typeahead entry is one rule: a control whose name reads as a submission is
refused (`looksLikeSubmission`), whatever list it is on. That rule guards the press the same way,
at the moment of the click. On top of it, two more, because a press is a named control where the
entry was a piece of text:

- **Static, at the mapping boundary:** `checkUsable` refuses a press that is the page's advance
  control, the page's *add another*, or the blueprint's submission control
  (`options_after_invalid`). Those three are the controls the blueprint knows to move the
  application, and a press may not be any of them.
- **At the fill:** the runner reads the page's URL before and after the press. A press that left
  the page advanced, saved or submitted it, and the page fails as drift with that said; nothing
  is typed into the dependent field. The press is on the click allow-list only because the plane
  sent it, as *add another* is (ADR-0014).

**The limit, stated here rather than discovered:** a control that saves without navigating and
without a save-like name cannot be told from a lookup by the runner. Sheffield's press is
`subjectSearchButton`, whose handler the dependencies read names as `searchSubjects()`; naming
the control is the reviewer's act, from that reading, and the three checks above are what stands
between a wrong naming and a saved page. That is the same place the typeahead entry's guard
stands: it cannot know what a click does, only what it is called and where it leads.

## What this does not decide

- A general licence to hand any field of a repeating page to the student. Only a slot, and only
  that slot's own companion with it.
- Which two of Sheffield's six file inputs are hidden, and by what: the next read.
- The asterisks, the slot titles and the *in English* wording: his report, marked as such.

## As built (P100)

- `checkUsable`: the two admissions above; the three static refusals of a press.
- The plan: `HandoffRequirement.ofSlot`; `FillInstruction.optionsAfter.press`, through the
  transport and the wire. `toStoredPlan` admits a handoff marked `ofSlot`.
- The runner: the press through `session.click` after the earlier field and before the wait; the
  URL compared before and after; the press on the click allow-list because the plane sent it.
- The preview: *You answer yourself: …* under the entry, after *You attach yourself: …*; in the
  general list, *(answered with the document itself)*. The handover message names the companion
  as answered with its slot.
- The fixture portal: a certificate status radio beside the education page's slot, handed with
  it; the study page's start dates shown only on a press for the chosen course, refused unless
  one the course offers. The journey holds both.
- The Sheffield draft (0.2.9; set 0.3.6): the six status radios handed with their slots;
  `subject` presses `subjectSearchButton` after `subjectSearch`.
