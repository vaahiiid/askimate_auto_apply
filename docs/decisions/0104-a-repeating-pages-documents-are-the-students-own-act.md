# ADR-0104 — A repeating page's documents are the student's own act, said under each entry; a condition inside a repeat is answered per item

**Status:** Accepted · 2026-09-11 · Decided by Vahid Mohammadi, built in P98
**Decides:** blocker 21 (`decision-sheet-blocker-21-a-document-per-item-of-a-repeating-page.md`)
**Continues:** ADR-0103 (gap 3), ADR-0066, ADR-0069, ADR-0050

## The decision, in Vahid's words — 2026-09-11

> *"B, and build the per-item condition with it."*
>
> *"C is out. The education page is the heart of a university application. A system that fills
> everything except the page carrying the applicant's qualifications has not done the thing it
> exists to do, and I would rather the student attach files on one page than have the page
> excluded."*
>
> *"B is honest in a way A is not yet. It says plainly, in the preview, which parts the student
> does themselves. Nothing is attached that could be wrong, and nothing claims to be right when it
> is not."*
>
> *"On A, I am changing your framing, not rejecting the option. You wrote 'B now, A when the
> registry holds education', which reads as A being scheduled. It is not. A changes what a student
> holds — documents bound to a qualification rather than to a type — and that is a product
> decision I have not made and am not making by answering this sheet. Record it as an option, not
> as the end state. If we reach it, it will be because a real student's second qualification made
> the case, not because this sheet promised it."*
>
> *"Build the per-item condition with B. Without it, unlistedDegree is wrong for one qualification
> or the other, which is the same class of silent error the document rule exists to prevent. Scope
> an item the way your sheet describes, so the shape is settled once."*
>
> *"One thing I want visible in the preview, not only in the plan: under each qualification, the
> student must be able to see which documents they are attaching themselves and which ones we
> filled. If a student reads it and cannot tell the difference, B's honesty is only in the
> design."*

His correction of the sheet's framing is recorded as he gave it: **A is an option, not the end
state.** The sheet said "B now, A when the registry holds education"; that reads as A scheduled,
and it is not. Nothing here plans A. If it is ever reached, it will be for the reason he names.

## What this decides

1. **The document slots of a repeating page are the student's own act.** A `student_handoff`
   mapping is admissible on a repeating page for a document slot (a `file` field) and for nothing
   else on it. The runner still fills and saves the page, once per item; a handoff on a document
   slot does not refuse transport (`toStoredPlan`), and a handoff on anything else still does.
   Nothing is attached by the system on such a page; a `document` mapping on it stays refused.
2. **The preview says, under each entry, what the student attaches themselves, apart from what
   was filled.** Each entry lists the fields filled for it and then *You attach yourself:* with
   the slot's label. The handoff is inside the content hash with its entry. The handover message
   names the same acts, so the student is told at the moment they act.
3. **A condition inside a repeat is answered per item, against that item's own values.** A
   field shown for the qualification whose degree is not in the list is filled for that entry and
   hidden for the other, and recorded as hidden for that entry. A condition on a repeating page
   may look only at the page: one that looks off it has no item to be answered by, and is
   refused. An item is scoped as the decision sheet describes: the values of one entry, and
   nothing outside it.

## What this does not decide

- **Option A** — a document bound to a qualification in what the student holds — is not planned,
  not scheduled and not the end state. It is recorded as an option, in his words.
- What a student holds per qualification. That is the product decision A would require.

## As built (P98)

- `checkUsable`: `student_handoff` on a repeating page is refused unless the field is a `file`;
  a condition on a repeating page whose `whenFieldRef` is off the page is refused; a condition on
  the page is admitted.
- The plan: a handoff on a repeating page is planned once per item with the item; conditions on
  the page are evaluated per item against that item's own instruction texts, to a fixed point,
  and a field hidden for an item drops that item's instruction, handoff or blocker and is recorded
  in `hidden` with the item. The fields of a repeating page are not evaluated again in the global
  pass, where one text per field reference would be wrong.
- `toStoredPlan` refuses `has_handoffs` only for a handoff that is not on a document slot.
- The preview: `You attach yourself: …` under each entry, inside the hash with the entry; the
  general *You will complete these yourself* list carries only handoffs that belong to no entry.
- The handover message lists the same acts, named with their entry, at the ask and at the
  confirmation, so the confirmation is bound to the text shown (ADR-0050).
- The fixture portal's education form takes a certificate and shows a grade box for a school
  qualification only; the gated fixture leaves the certificate to the student and fills the grade
  box for the diploma; the journey holds that the diploma's grade was typed, the bachelor's box
  was not, nothing was attached by the runner, and the preview says *You attach yourself:
  Certificate* under each of the two entries.
- The curated Sheffield draft marks its education page as repeating and leaves its six document
  slots to the student; `unlistedDegree`, shown by `degree` on the same page, is admitted.
