# Decision sheet — a document per item of a repeating page, and a condition inside one

**For:** Vahid · **Prepared:** 2026-09-11 · ~~**Answerable in one sitting**~~
**✅ DECIDED — Vahid Mohammadi, 2026-09-11: B, and the per-item condition built with it. C out; A
recorded as an option, not the end state — his correction of this sheet's framing. Built in P98;
see [ADR-0104](./decisions/0104-a-repeating-pages-documents-are-the-students-own-act.md), which
carries his words in full.**
Companion to [blocker 19](./decision-sheet-blocker-19-how-a-runner-is-signed-in.md) and
[blocker 20](./decision-sheet-article-9-fields-a-portal-asks-for.md). Recorded as **blocker 21** in
[`state-of-the-system.md`](./state-of-the-system.md).

> **What raised it** — P96, building ADR-0103's gap 3 (a page filled once per item of a list).
> The page the gap was raised for — Sheffield's education page, one qualification per entry —
> cannot be marked as repeating under the rule as built. It carries **six document slots per
> qualification** (certificate, transcript, and the official and unofficial translations of each)
> and **one field shown by another** (`unlistedDegree`, shown when the degree is not in the
> list). `checkUsable` refuses a condition on a repeating page today, and would refuse any
> document mapped on one the moment it was mapped. Both refusals are deliberate, and this sheet
> is why they stay until you say otherwise.
>
> This is my finding from the capture and the build, not your words. Nothing below is decided.

> **Already decided, and not on the table:** ADR-0066 — an upload is planned from a reviewed
> mapping, never from a page's declared slots; ADR-0069 and ADR-0099 — a document is a held
> record with a type, a hash and a case, authorised by the student for a named destination; and
> ADR-0103 gap 3 as built — a repeating page draws every value from one item of its list, and
> each item is its own page to the ledger.

## Why the two refusals are right as built

**A document is mapped to a held type, not to an item.** The mapping says *the passport goes in
this box*; the vault holds *a passport*. There is no way, in what the student holds or in what a
mapping can say, to name *the certificate for the second qualification*. A repeating page with a
document mapping would attach the one held certificate to every qualification, and the preview
would say so as if it were right.

**A condition inside a repeat has no item to be answered by.** `visibleWhen` is evaluated against
the plan's values by field reference. On a repeating page the same field reference carries one
value per item; the condition would be evaluated against whichever the code happened to read, and
a field shown for the first qualification and hidden for the second would be filled — or skipped
— for both.

## The options

### A — the profile holds documents per item, and the mapping names the item's document

A qualification in the profile gains document references (`certificate`, `transcript`, and their
translations), each a held document of that type bound to that item. A mapping on a repeating page
may say `{ kind: "document", perItem: { path: "certificate" } }`, and the plan attaches, for item
*n*, the document item *n* holds. The preview lists it under that entry. Each item's attachment is
its own `attach_document` intent, keyed to the item.

- Says exactly what a real education page asks for.
- The largest change of the three: the profile registry, the document intake (a document is
  taken *for* a qualification), the vault record, the disclosure authorisation's subject, and the
  preview. A product decision about what a student holds per qualification before a schema one.
- Conditions inside a repeat are a separate, smaller piece (see below) whatever is chosen here.

### B — documents on a repeating page are the student's own act

The repeating page's fields are filled per item; its document slots are left to the student, as a
handoff on that page. The preview says, under each entry, which documents the student attaches
themselves. `student_handoff` becomes admissible on a repeating page for its document slots only.

- Small to build; honest in the preview; nothing attached that could be wrong.
- The student does the part of the education page the system exists to do for them, on every
  qualification, and the run cannot say the page is done until they have.

### C — a repeating page may not carry documents at all, and the page is not marked

The rule stays as built. Sheffield's education page is filled by hand, whole, as a handoff page,
until the registry holds education and A or B is chosen.

- Nothing to build now; nothing wrong can happen.
- The first real form's education page is out of scope for the fill, which is a large part of
  what the fill was for.

## The condition inside a repeat — a smaller, separate question

Under A or B (and under C once the page is marked), a condition on a repeating page can be
evaluated **per item, against that item's own values**: `unlistedDegree` shown for the
qualification whose degree is not in the list, hidden for the one whose is. That is a natural
extension of P90's fixed-point evaluation, scoped to the item, and it is not a product question.
It is refused today only because it was not built, and building it should wait on this sheet so
that the shape of "an item" is settled once.

## My recommendation, and what it is not

**B now, A when the registry holds education.** B makes the page fillable at once and says
plainly what the student does; A is the right end state and is a product decision about the
profile that this sheet cannot make. C leaves the first real form's central page unfilled.

**This is not a decision.** It stays undecided until you type one, in your words. Nothing is built
against it before then, and the Sheffield draft's education page stays unmarked.

## What I need from you

1. A, B or C — or something else — in your words.
2. Whether a condition inside a repeat, evaluated per item, is to be built with it.
