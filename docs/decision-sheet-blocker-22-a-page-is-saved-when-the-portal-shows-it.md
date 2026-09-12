# Decision sheet — a page is saved when the portal shows it, not when a control is pressed

**For:** Vahid · **Prepared:** 2026-09-12 · ~~**What it costs, before anything is built.**~~
**✅ DECIDED — Vahid Mohammadi, 2026-09-12:** *"Your cost answer: accepted. Nine looks per
application on a portal with nothing to read is the honest price and I would rather pay it than
report a success we cannot see. Build the three phases in the order you set: reopen-and-read,
the listing count, the slot marker."* Built in P105, all three; see
[ADR-0106](./decisions/0106-a-page-is-saved-when-the-portal-shows-it.md). The cause of his
failed save is settled: the unanswered radios (a repeat with all four answered saved). The
network trace was not needed — the status code changes nothing built — and was not asked for
again. ADR-0105's revisit is [blocker 23](./decision-sheet-blocker-23-a-companion-the-page-will-not-save-without.md).
Companion to [blocker 19](./decision-sheet-blocker-19-how-a-runner-is-signed-in.md),
[blocker 20](./decision-sheet-article-9-fields-a-portal-asks-for.md) and
[blocker 21](./decision-sheet-blocker-21-a-document-per-item-of-a-repeating-page.md). Recorded as
**blocker 22** in [`state-of-the-system.md`](./state-of-the-system.md).

> **What raised it** — P103 found, from the code, that after the advance control is pressed the
> runner reads nothing back and reports the page succeeded. On 2026-09-12 Vahid met the case on
> the real portal, in his words: *"opened education.do?new=true, filled a second qualification,
> left two of the four Documentary Evidence radios unanswered, pressed Save and Continue. What
> happened: no error. The page did not complain. And summary.do shows Previous Education 1 and
> nothing else. The second qualification was not saved. So the portal accepted the press, showed
> no validation message on the page I could see, and silently did not record the entry. A runner
> doing exactly what I did would have reported the page succeeded."*
>
> His correction of P103's proposal: *"Your shape was 'a landing URL, or an error locator that
> must be absent'. This case would defeat both halves … An absence-of-error check would have
> passed. So the reliable signal is not on the page that was saved. It is that the thing is there
> afterwards. Whatever you build, the question it answers has to be 'did the portal record it',
> not 'did the page look like it complained'."*
>
> **His shape, verbatim:** *"a page is not reported saved because a control was pressed. It is
> reported saved when the portal shows the thing exists. Where a blueprint can name how to see
> that, name it. Where it cannot, the honest report is uncertain, not succeeded — and an
> application that reports uncertain is a specialist's problem, not a silent success."*
>
> **His question:** *"Tell me what that costs before building it. If it means every page needs a
> read-back and most portals offer nothing to read, I want to know that now."* This sheet is the
> answer. Nothing in it is decided.

> **Already decided, and not on the table:** ADR-0047 — page progress lives in the intent ledger,
> and skipping past an uncertain page is acting on a portal state nobody knows; ADR-0054 — an
> intent with no completion *is* the uncertain case, and the window belongs to a specialist;
> ADR-0069 — a transmission is recorded from the runner's report, and only for a saved page.

## What exists today, so the cost is measured against it and not against nothing

**`uncertain` is built end to end.** It is one of the three work outcomes
(`packages/contracts/src/work.ts`, `WORK_OUTCOMES`), it completes nothing in the ledger
(`run-driver.ts`, *"Why `uncertain` completes nothing"*), the next claim stops on the open intent
(`assessIntent` → `verify_first` → run status `uncertain`), and a person resolves it with one of
two words, *resume* or *abandon*. **So "uncertain, not succeeded" needs no new machinery. What it
costs is a person's look, once per uncertain page.** That is the unit everything below is priced
in.

**On `uncertain`, no transmission is written.** `#settleAttachments` returns before touching the
attach intents; they stay open, and the disclosure record stays honest. On `succeeded`, the
transmission is recorded. So the worst case of blocker 22 is not a missing qualification — it is a
page whose save was silently dropped *with a document on it*: today that writes a transmission
record for a file the portal never kept.

**The runner can already read.** The session has `goto`, `readValue` on any locator (P94) and
`currentUrl`. A read-back of a page's own fields needs no new capability; a read-back that counts
entries needs one small method (a count on a locator).

**What the runner reports today after the press:** `succeeded`, unconditionally, unless the click
itself threw (`fill-application.ts`, *"Saving the page, which is what makes any of it real"*).

## The three kinds of read-back, and what each costs

### A — reopen the page and read its own fields back (no vocabulary)

After the press: `goto` the page's own URL again, `readValue` every locator the plan filled, and
compare with what was typed. Every value present and equal → `succeeded`. Any value absent or
different → `uncertain` (never `failed`: the portal may hold part of it).

- **Costs at run time:** one extra page load per page — the one-second floor plus the load, so a
  few seconds a page, nine pages on Sheffield — and a compare of values the runner already has.
- **Costs the reviewer:** nothing. No blueprint vocabulary; it uses the locators already reviewed.
- **Works where** a saved page re-renders its saved values on reopening, which is how most
  server-rendered forms behave. **Fails honestly where** reopening shows a blank form, or the URL
  cannot be reopened after a save: those pages read as *uncertain* on the first run and the
  reviewer learns it once, on that portal, and names a read-back (B or C) or accepts the look.
- **Cannot cover** file inputs: a re-rendered `<input type="file">` is empty by HTML's rule, so a
  slot's document needs C.
- **On Sheffield, unobserved:** whether `personal.do` reopened after a save shows the values. One
  look answers it.

### B — a named listing count, for a repeating page (vocabulary: `repeats.recorded`)

The blueprint names the listing page and the locator of one entry on it
(`repeats.recorded: { url, entryLocator }`). Before the first item, the runner counts entries
once — the baseline, because a student may already hold some. After each item's save it counts
again: baseline + items saved so far, or `uncertain`.

- **Costs at run time:** one listing load before the first item and one after each save.
- **Costs the reviewer:** naming the listing and one entry's locator from a copy of the listing's
  markup — on Sheffield, the *Previous Education* section of `summary.do`. Not from memory.
- **Costs to build:** blueprint, catalogue parse, contracts wire, plan, driver (the item index is
  already known per work item), execution, fixture (its education page already lists
  qualifications) and tests. One phase, fails first.
- **On Sheffield, available:** his observation — *Previous Education 1*, one entry per saved
  qualification. The employment page would use the same shape.

### C — a named marker per document slot (vocabulary: `requiredDocuments[].recorded`)

For a slot the runner attaches to, the blueprint names what the page shows when a file is held —
a filename, a *remove* link, a *provided* mark. After the save and reopen, the marker must be
present for every slot the plan attached to, or the page is `uncertain` and no transmission is
written.

- **Costs at run time:** nothing beyond A's reopen.
- **Costs the reviewer:** seeing the saved state — which means one upload on a test account with a
  synthetic file, then the markup of the slot as it looks with a file held. That is the one
  observation that cannot be made from an empty form.
- **Costs to build:** vocabulary, execution, fixture (the documents page can show a filename after
  an upload), tests. One phase, fails first.
- **Where absent:** a page the runner attached a document to cannot be `succeeded` — it is
  `uncertain` — because A cannot see the file and a transmission record for a dropped file is the
  worst case above. On Sheffield that is the nationality page (five slots) and `documents.do`
  (five), until their markers are named; the education slots are the student's own act (ADR-0104)
  and the runner attaches nothing there.

## The rule as he stated it, and what it costs on a portal with nothing to read

Under his shape, a page with no read-back that holds is `uncertain`, and `uncertain` is a
specialist's look. **So on a portal that offers nothing to read, every page is a look**: nine on
Sheffield, per application. That is the number he asked for.

What makes it smaller is that A costs the reviewer nothing and holds on most server-rendered
forms, so most non-repeating pages on most portals need no naming. What is left for the reviewer
to name, per portal, once: a listing per repeating page (B), and a marker per slot the runner
attaches to (C). Where the reviewer cannot name one, the look stays, and it is the honest price:
a page nobody can verify is a page a person verifies.

**The alternative he ruled out is cheaper and wrong:** keep reporting `succeeded` on the press.
It costs no looks and writes transmission records for files the portal may have dropped.

## What it would cost to build, in phases

| | What | Fails first on | New vocabulary |
|---|---|---|---|
| **1** | A: reopen and read back; `uncertain` when any value is not there | the fixture's `/apply` page made to re-render its values, and a page made *not* to, so both branches are proven; the orchestrator's recording session | none |
| **2** | B: a listing count for repeating pages | the fixture's education list | `repeats.recorded` |
| **3** | C: a marker per attached slot; no transmission without it | the fixture's documents page showing the filename | `requiredDocuments[].recorded` |

Each is one phase. The intervention a specialist reads should say *what was not seen* — which
field differed, which count was short, which slot showed no file — and that is a small addition to
the existing intervention text in phase 1. Nothing here touches the transmission gate, the
authorisation hash or the mandatory-review categories.

## What would settle why his save failed — specific, not a guess

He wrote: *"I also cannot tell you why it failed. Two unanswered radios is my guess and nothing
more."* Two things settle it, and a third is a yes/no:

1. **Repeat the second entry with all four radios answered.** If it saves, the radios were the
   cause and ADR-0105's handed-with-its-slot shape has a sequencing question (the runner sets
   neither the slot nor the radio, so the page would never save). If it still does not save, the
   radios are cleared.
2. **On the failing press, the save request in DevTools → Network:** the `POST` to
   `education.do` — its status code and, if any, its `Location` header. One line, no body. A `302`
   to `summary.do` means the portal accepted the request and dropped the entry (or folded it as a
   duplicate); a `200` means it re-rendered the page, which is a rejection with a message
   somewhere on it — above the fold, or hidden.
3. **Was the second entry different from the first** — institution, qualification, dates? A
   portal may fold an identical entry silently. Yes or no.

## What I need from you

- **The shape** — A as the default for every non-repeating page; B named for repeating pages; C
  named per slot the runner attaches to; `uncertain` wherever none holds. Yes, no, or changed, in
  your words. Built in the three phases above, in that order, if yes.
- **Two observations** — does `personal.do` reopened after a save show the saved values (A on
  Sheffield); and a copy of the *Previous Education* section's markup on `summary.do` (B's entry
  locator).
- **The three items above** on why the save failed — 1 and 2 settle it, 3 is a yes/no.

This is my recommendation and my estimate. It is not your decision until you type it.
