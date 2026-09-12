# Decision sheet — a companion the page will not save without

**For:** Vahid · **Prepared:** 2026-09-12 · **ADR-0105 revisited, on his instruction.**
Companion to [blocker 22](./decision-sheet-blocker-22-a-page-is-saved-when-the-portal-shows-it.md).
Recorded as **blocker 23** in [`state-of-the-system.md`](./state-of-the-system.md).

> **What raised it** — his words, 2026-09-12: *"Under ADR-0105 as built, a slot handed to the
> student means the runner sets neither the file input nor its companion radio. On Sheffield's
> education page, that is exactly the state I just produced by hand: radios unanswered, save
> pressed, nothing recorded, no error. So the shape we chose for blocker 21 option B, applied to
> this page, produces a page that silently does not save."*
>
> And the question, as he framed it: *"If the runner must leave the radio for the student, and
> the page will not save without it, then either the runner answers the radio after all — 'I
> will upload later' is not a claim about the document, it is a statement about when — or the
> whole page waits for the student. I do not want to decide that in the same message as the
> read-back. Put it up as its own question with what each costs, and I will answer it."*
>
> Nothing below is decided. This is what each option costs, from the build.

> **Already decided, and not on the table:** ADR-0104 — a repeating page's document slots are
> the student's own act, said under each entry; ADR-0106 — a page is saved when the portal shows
> it, so whatever is chosen here, a qualification the portal drops reads *uncertain* and never
> *succeeded*; ADR-0066 — an upload is planned from a reviewed mapping, never from a slot.

## The fact the options are priced against

On Sheffield's education page every one of the four evidence radios must hold an answer for the
entry to be recorded, and the page says nothing when one does not. ADR-0105 as built leaves the
radio to the student with its slot. So under ADR-0105, on this page, the runner cannot save a
qualification at all: every item is *uncertain* under ADR-0106, and every item is a specialist's
look that ends the same way — nothing was recorded.

## The options

### A — the runner answers the companion with a value the reviewer names: a statement about *when*

The slot stays the student's own act. Its companion is no longer handed with it; the runner sets
it to a value the reviewer names per slot on the blueprint — on Sheffield, *I will upload it
later* — as a reviewed constant. The student attaches the document afterwards and, if the portal
asks, changes the radio then. The preview says so under each qualification: *We will mark:
"I will upload it later". You attach yourself: Certificate.*

- **What it costs to build:** ADR-0105 amended, not reversed. The companion gains a named value
  for the handed case (`companion.whenHanded`); the plan carries it as a reviewed-constant fill
  after the slot's handoff; `checkUsable` refuses a handed slot whose companion has no such
  value on a page that requires it — which the reviewer states, since the capture does not
  carry the requirement. The preview and the handover name it. One phase, fails first. The
  Sheffield draft names *later* on six slots.
- **What it costs the student:** a statement on the form they did not make, that they will
  upload later — true of what the shape asks of them, and visible in the preview before the
  yes. It is not a claim about the document.
- **Where it is wrong:** a portal whose *later* means something the student has not agreed to —
  a deadline, a fee, a status that blocks submission. The reviewer reads that from the page and
  names nothing if it is not clearly a statement about when. On Sheffield the option reads
  *I will upload my certificate later*, and nothing in the capture attaches a consequence to it.

### B — the whole page waits for the student

The education page becomes a handoff: the runner fills nothing on it; the student adds their
qualifications themselves. Nothing new to build — a page with every field handed off is already
expressible — and nothing new to decide about the radio.

- **What it costs to build:** nothing.
- **What it costs the product:** the education page is, in his words on blocker 21, *"the heart
  of a university application"*. Handing all of it back is option C of that sheet by another
  route: the run fills the pages around the one that matters.
- **Where it is right:** a portal where no value the reviewer could name is honest — where every
  companion option is a claim about the document.

### C — leave ADR-0105 as built, and let the read-back catch it

Every qualification on this portal reads *uncertain*; a specialist looks, finds nothing
recorded, and the student is where option B would have put them, later and with a look spent.

- **What it costs:** a look per qualification per application, each ending in *not recorded*.
  Honest, and useless. Listed because it is the state of the build today, not because it is a
  choice.

## My recommendation, and what it is not

**A**, with the value named per slot by the reviewer and shown in the preview. It keeps
ADR-0104's decision — the student attaches their own certificates — and ADR-0105's reason, that
*"in English"* is the student's answer and never the runner's; it adds only that *when* the
document comes is a statement the reviewer may make on the student's behalf when the page will
not save without one, and the student reads it before the yes. Where a reviewer cannot honestly
name a value, B is the page's shape, per portal.

This is my recommendation. It is not your decision until you type it.

## What I need from you

- **A, B, or something else, in your words.** If A: whether the preview line above says it the
  way you want the student to read it.
- **One observation, if A:** the exact text of each radio's *later* option on the education
  page, so the reviewer names the value from the page rather than from my paraphrase — you
  reported *"I will upload later"* in P103; the draft holds the option values from the capture
  and the labels from your report.
