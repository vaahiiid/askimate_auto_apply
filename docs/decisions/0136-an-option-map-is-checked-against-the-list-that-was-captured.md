# ADR-0136 — An option map is checked against the list that was captured, by the build

**Status:** Accepted · 2026-09-22 · **found by attempt 8** on Sheffield's education page · corrects [ADR-0112](./0112-a-qualification-has-dates.md)'s build note, which wrote an assumption about a list as a fact · the same question [ADR-0102](./0102-use-the-refusal-the-form-offers.md) already asks of a refusal, asked of the maps that carry the student's own answers
**Built in P185**, the same day. Voids the entry's signature — see *Consequences*.

## Context — eighteen boxes took their values and one did not

Attempt 8, with P184's fix in place, filled eighteen of nineteen boxes on `education.do`. The
nineteenth:

> `startDateMonth` — The portal's "startDateMonth" list does not offer the confirmed value
> (3 characters). It offers:  (), Jan (Jan), Feb (Feb), Mar (Mar), Apr (Apr), May (May),
> **June (June), July (July)**, Aug (Aug), **Sept (Sept)**, Oct (Oct), Nov (Nov), Dec (Dec).

The mapping sent `Sep`. Sheffield says `Sept`. Three of its twelve month names are not three
letters — June, July, Sept — and the synthetic profile's education dates are exactly those three
months: start September, end June, award July. **All three would have failed in turn.**

The list was never in doubt. The first capture of that page, `blueprint.draft.json` from
**2026-09-10**, records the select's options as `Jan, Feb, Mar, Apr, May, June, July, Aug, Sept,
Oct, Nov, Dec` — and so does every read since. The blueprint inside the signed entry says the same
thing, on the same page, a few hundred lines from the map that contradicts it.

## Where "three-letter names" came from

It was written down as a fact in this repository, four days after the capture that refutes it.
ADR-0112's **Built (P134)** section:

> Set 0.3.22: `startDateMonth`, `startDateYear`, `endDateMonth`, `endDateYear` per qualification,
> **the months by the selects' three-letter names**; `awardDateMonth` and `awardDateYear` left
> empty when there is no award.

Nothing on the record says that. No capture, no read, no note of Vahid's. It is what a month list
usually looks like, asserted about a list that had already been read. The same ADR's last
consequence names the very task it skipped — *"the reviewer's option maps onto the observed
lists"*.

The contrast within the same mapping set is the proof that this was avoidable rather than
inevitable. The nationality and visa month maps, authored by other phases, carry their provenance
in their notes — *"by the select's own names (Jan … June, July … Sept … Dec, **as captured**)"* and
*"in the select's own spellings"* — and all of them are right. Only the three notes that assert a
shape are wrong. **This is the `saveBtn` shape again: authored from what a control usually looks
like, not from what this one said.**

## Decision

**1 · `checkUsable` refuses a mapping set whose option map names a value the field's captured
options do not hold.** A new refusal, `option_map_not_offered`, beside `form_refusal_not_offered` —
the same question, asked of the maps that carry the student's own answers rather than of a refusal.
It walks the format tree, because a format nests (`part` then `option`), which is how three of six
month maps could differ from the other three with nothing noticing.

Two kinds of field are skipped rather than refused, and both are named here rather than left
implicit:

- **A field with no captured options.** A text box legitimately has none. `checkUsable` already
  refuses a field that is not in the blueprint at all, so what is skipped is narrow.
- **A field whose options ARRIVE AFTER another is set** (ADR-0103 gap 1). Its captured options are
  one observation of a list the page loads at fill time — the eleven institutions one search
  returned, the grading systems for one institution — not the list the student's own answer will
  meet. Refusing against a partial observation would refuse correct maps. **The check found this
  itself, on its first full run:** the `end-to-end` demonstration's `passport_country` is a country
  list the fixture portal fills after the nationality, captured empty and mapped correctly, and the
  check refused it until the exception was added.

The three maps this check was built for are static selects carrying their whole list on the page,
which is why the capture is authoritative there.

**2 · A reviewer is not the check.** A person cannot hold twelve spellings against a list they read
a week earlier, and asking them to is how this survived a signature. The build can, on every
mapping, every time, in under a millisecond.

**3 · The three maps are corrected from the capture**, and their notes now carry the provenance the
correct maps already carried — what was read, and when.

## The audit that came with it

Every option map in the Run A entry — **45 of them** — checked against the blueprint's recorded
options:

| | |
|---|---|
| Agree with the captured list | **41** before the fix, **44** after |
| Named a value the list does not hold | **3** — `startDateMonth`, `endDateMonth`, `awardDateMonth`, each on `Jun`, `Jul`, `Sep` |
| No captured list to check against | **1** — `subjectSearch`, a free-text search box that has no options; the map there is a search term, not a choice |

Read from a capture and correct: the eleven country and nationality maps, the nine nationality and
visa month maps, the employment month maps (full English names — `January`…`December`, which the
capture also records), the date of birth, the yes/no radio maps, the qualification levels, the
grading system, the grade, and the two typeahead maps. Assumed and wrong: the three above, and no
others.

## Consequences

- **The entry's signature is void, and the approval is removed rather than re-pointed.** Correcting
  the maps changed what will be typed, which moves the content hash — exactly as ADR-0057 intends.
  Vahid, before the first signature: *"If anything in either changes afterwards — a label, a value,
  a condition — the hash moves and the approval is void, and I would rather that happened loudly
  than be worked around."* An agent cannot re-sign on his behalf; a hash written into
  `approvals.json` by anything but him is a signature he did not give. The directory refuses the
  entry until he signs `sha256:56388e658f98955236f0a609afc0696fa295c415dba39a86c42c94f6877f21ef`.
- **What moved in `what-will-be-typed.md`:** three typed values and two identifiers, and nothing
  else. `Start:: Sep → Sept`, `End:: Jun → June`, `Date of Award:: Jul → July`; the version line
  `0.3.31 → 0.3.32`; and the document's own reference hash. Five lines of a hundred and
  twenty-four.
- ADR-0112's decision about a qualification's dates stands. Only its build note's claim about the
  month names is withdrawn, and it is withdrawn in that ADR as well as here.
- This check would have caught the defect on the day it was written, before a signature, before
  eight attempts, and before a page that refuses one box at a time would have refused three.
