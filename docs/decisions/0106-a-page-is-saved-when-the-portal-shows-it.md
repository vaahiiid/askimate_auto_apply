# ADR-0106 — A page is saved when the portal shows it, not when a control was pressed

**Status:** Accepted · 2026-09-12 · decides blocker 22 · continues 0047, 0054 and 0069
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-12. Built in P105.

## Context

Until this decision the runner reported a page *succeeded* when the advance control had been
pressed. P103 found it in the code; on 2026-09-12 Vahid met it on the real portal:

> *"opened education.do?new=true, filled a second qualification, left two of the four
> Documentary Evidence radios unanswered, pressed Save and Continue. What happened: no error. The
> page did not complain. And summary.do shows Previous Education 1 and nothing else. The second
> qualification was not saved. So the portal accepted the press, showed me no validation message
> on the page I could see, and silently did not record the entry. A runner doing exactly what I
> did would have reported the page succeeded."*

The cause is settled, by his repeat of the same entry with all four radios answered, which saved:
the unanswered radios. His correction of the first proposal (an error locator, or a landing URL)
is the shape of the decision:

> *"An absence-of-error check would have passed. So the reliable signal is not on the page that
> was saved. It is that the thing is there afterwards. Whatever you build, the question it
> answers has to be 'did the portal record it', not 'did the page look like it complained'."*

## Decision

In his words:

> *"a page is not reported saved because a control was pressed. It is reported saved when the
> portal shows the thing exists. Where a blueprint can name how to see that, name it. Where it
> cannot, the honest report is uncertain, not succeeded — and an application that reports
> uncertain is a specialist's problem, not a silent success."*

And on the cost, which was put to him before building
([the sheet](../decision-sheet-blocker-22-a-page-is-saved-when-the-portal-shows-it.md)):

> *"Your cost answer: accepted. Nine looks per application on a portal with nothing to read is
> the honest price and I would rather pay it than report a success we cannot see. Build the three
> phases in the order you set: reopen-and-read, the listing count, the slot marker."*

### What "shows the thing" means, in three shapes

1. **A page filled once is reopened and read back.** After the press the runner navigates to
   the page's own URL again and reads every field it filled, through the locators already
   reviewed. The comparison is on the redacted shape the executor recorded at the fill — length
   and digest — so a value the portal changed reads as not kept, and no value is held in the
   clear. Every filled value present and equal → *succeeded*. Anything absent or different →
   *uncertain*. No vocabulary; it costs the reviewer nothing.
2. **A page filled per item is counted on its listing.** A new-entry form reopens empty by
   design, so the page cannot be read back. The blueprint names where the saved entries are
   listed and what one entry is (`repeats.recorded: { url, entryLocator }`). The runner counts
   the entries before the item's fill and again after its save: one more is the save; the same
   number, or no listing named, is *uncertain*. The listing is rebased onto the deployed origin
   as the form is, and one on another host is not work.
3. **A slot the runner attached to is seen by its marker.** A file input reads back empty by
   HTML's rule. The blueprint names what the page shows when a file is held in the slot
   (`requiredDocuments[].recorded`); reopened, the marker must be present for every slot the
   plan attached to. No marker named, or none shown → *uncertain*, and **no transmission is
   recorded** — a transmission record for a file the portal dropped was the worst case of the
   blocker.

### What *uncertain* already means, unchanged

`uncertain` completes nothing in the intent ledger (ADR-0047, ADR-0054); the next claim stops on
the open intent; a person resumes or abandons; the attach intents stay open and no transmission
is written. Nothing here adds machinery to that. The new failure code, `not_recorded`, is
reported only with `uncertain`, and a report carrying a transmission beside it is refused at the
wire.

### The price, stated

A page nobody can verify is a page a person verifies. On a portal that offers nothing to read,
every page is a look. The first shape makes that rare on server-rendered forms; the reviewer
names the second and third, once per portal, from a copy of the saved state.

## Consequences

- The runner's report of a page is a report of what the portal shows, not of what the runner
  did. The journey walks all three shapes against the fixture portal: its pages re-render what
  they hold, its education page lists what was saved, its documents page shows a held file.
- Two limits, stated rather than hidden. A typeahead widget may render its chosen entry outside
  the text box the runner reads, in which case the page reads *uncertain* on the first run and
  the reviewer learns it there. And the failure code reaches the plane but is not yet carried
  into the intervention's text — a specialist is told the page's save was not seen, not which
  field; that is a small addition left for a later phase, and the ledger's open intent is what
  stops the run either way.
- ADR-0105's shape, a slot's companion handed to the student with the slot, produces on this
  portal exactly the page that does not save. The read-back makes that *uncertain* rather than a
  false success; it does not resolve the sequencing question, which is raised as
  [blocker 23](../decision-sheet-blocker-23-a-companion-the-page-will-not-save-without.md) and
  decided separately, on his instruction.
- Nothing here touches the transmission gate, the authorisation content hash, or the
  mandatory-review categories.

## What was deliberately not done

- No heuristic for "this looks like an error" — his correction rules it out, and it is the kind
  of rule P82 removed.
- No retry of a press whose save was not seen: repeating a save is acting on a portal state
  nobody knows (ADR-0047).
- No attempt to verify a page by the summary page's per-section status on Sheffield: nothing
  in the capture shows one, and the reviewer names read-backs from what is seen, not inferred.
