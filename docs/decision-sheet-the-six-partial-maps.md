# Decision sheet — the six partial option maps, and the discipline they are not under

**Raised:** 2026-09-25 (P207), after Vahid signed the country maps and asked what the same
question costs for the rest of the entry.
**Status:** costs only. **Nothing here is decided, and nothing is built.**
**Related:** blocker 25 (an institution cannot be mapped by rule), ADR-0102 (use the refusal the
form offers), ADR-0107 (a refusal-style value is never ours), ADR-0109 (a mapping names the
submitted value), ADR-0141 (the reviewed country table).

His framing, which the sheet follows rather than argues with:

> *"I do not want the country treatment copied onto them, because they are not countries. A
> country is a closed set with a standard behind it. A subject list is 87 strings a university
> invented, a grading system is a vocabulary with no authority anywhere, and a degree is somewhere
> between."*

---

## §1 · What Run A actually touched — and it is all six

Worth stating plainly, because it is the thing the numbers hide.

| map | values it holds | what Run A typed | of which |
|---|---|---|---|
| `subject` | **1** | `Business Management` | the only row |
| `institution-ts-control` | **1** | `SHEFFIELD` | the only row |
| `gradingSystemId` | **1** | `7` | the only row |
| `highestQualification(UNIVERSITY_LEVEL)` | **1** | `UG DEGREE` | the only row |
| `degree` | 2 | `BSc` | one of two |
| `grade` | 4 | `2.1` | one of four |

**Four of these maps hold exactly one row, and Run A's value is that row.** Run A did not pass
*despite* a thin map; it passed *along* it. The education page was filled by six maps that between
them name ten values, and the six the run needed were the six that existed.

That is not a criticism of the run — it proved the machinery, the page walk, the save-and-read-back
and the hand-over, all of which are portal mechanics and none of which depend on how many rows a
vocabulary has. But "Run A filled the education page" and "the education page is mapped" are
different sentences, and only the first is true.

**A second student changes nothing about the machinery and everything about the maps.** Anyone
whose degree is a BA, whose subject is not one of Sheffield's 87 strings, whose institution is not
the one searched for, or whose grade is a Pass, meets `render_refused` → a specialist. Loud, per
P204 — but on the first page of real content, for almost everyone.

---

## §2 · Per map: what it would actually take

The denominators below are the portal's captured option lists. **One of them is misleading and is
corrected here**: `institution-ts-control` was reported in P206 as *1 of 11*. The 11 are what one
typeahead search for *"Sheffield"* returned, not a list the portal has. Its real denominator is
unbounded, which is precisely blocker 25.

### Derivable from something

**`highestQualification(UNIVERSITY_LEVEL)` — 1 of 7. The cheapest of the six.**
Reads `immigration.uk_study.qualification`, which is free text today. The portal's seven are a
small closed list of *levels* (Bachelors, Masters (UG level), Pre Masters, PG Cert, PG Dip, …) and
**there is no "Not in list" escape**, so every student must land on one of the seven.
*What it takes:* a level vocabulary in the registry — an enum, seven-ish values, no external
standard needed because the question is about UK study levels and the portal's list is the
authority for this portal — then one reviewed 7-row map per portal, which a person can read in a
sitting. *Cost:* small. The registry change is the real work; the map is an afternoon.
*Caveat worth pricing:* there are five of these selects (one per level, per P142) and only this one
is mapped. Closing one closes a seventh of the question.

**`gradingSystemId` — 1 of 5. Derivable, with a caveat that is the whole cost.**
The five are `Not in list`, `UK Bachelors Degree (BA, BSc)` = 7, `UK Masters Degree (MA, MSc)` = 8,
`UK Research Degree` = 9, `UK Medical Degree (MBBS, MBChB)` = 81. A rule from *level* and *country
of study* would settle it, and the rule is small enough to state in a sentence.
**But the list is per institution** (P132): it follows the institution box, and another institution
gives a different list with different ids. So the derivation is *not* "a rule", it is "a rule whose
output must be checked against a list read per institution" — and the reading is the cost, not the
rule. *Cost:* small per institution, unbounded across institutions, and it inherits blocker 25.

### Needs a person reading a list, and the list is short

**`grade` — 4 of 9. The only one where finishing the map is a genuinely small, bounded act.**
Four honours classes are mapped. The five unmapped are not more grades: they are `Select your
grade…` (the placeholder), `Still waiting for grade`, `Failed to complete course`, and the
Pass/Fail pair. **Three of those five are states, not grades** — *"still waiting"* is a fact about
the application, not about the student's degree, and ADR-0107 already says a refusal-style value is
the student's to choose and never ours.
*What it takes:* a person deciding, per value, whether it is a grade we can map from the registry
(Pass/Fail: probably, with a caveat about whether a student's *Pass* is the portal's *Pass*), or a
state the interview must ask about (still waiting, failed to complete). Five decisions, one sitting.
*Cost:* the smallest of the six, and the only one where "read the list and finish it" is the honest
answer. There is also an `unlistedGrade` text box and an `unlistedGradeDescription` beside it.

### The wrong shape for an option map at all

**`degree` — 2 of 42. Not partial. Wrong.**
This is the one to look at hardest, because the number understates the problem. The map reads
`education.prior_qualifications.level` — *"Bachelor's degree"* — and writes one of the portal's 42
**award titles**: BA, BEd, BEng, BMedSci, BSc, MSc, and so on. Those are different questions. A
level does not determine a title. **`Bachelor's degree → BSc` is wrong for every student who holds
a BA**, and it is wrong silently: the map renders, the plan succeeds, and the portal is told the
student has a BSc.
Nothing about widening this map fixes it. A 42-row level→title map is 42 rows of the same mistake.
*What it takes:* the registry holding the student's **award title as awarded**, which it does not,
and then the question becomes a choice from the portal's own 42 — a list the student can recognise
and we cannot derive. The portal offers `Not in list` (submitted value: empty) plus an
`unlistedDegree` text box shown when it is chosen, so ADR-0102's route exists here.
*Cost:* a registry field, an interview step, and a per-portal reviewed list. Medium. **And the
current two rows should be reconsidered before anything is widened**, because they are not a
partial truth, they are a guess that renders.

**`subject` — 1 of 87. Wrong shape, and the 87 are nobody's standard.**
Reads free text the student typed; the portal's 87 are Sheffield's own invented taxonomy
(*"Agri Marketing and Business Ad"*, *"GCE Applied Business Advanced"*). There is no derivation
from arbitrary text to an invented list, and no authority to appeal to. Sheffield knows this: it
offers `Not in list` and an `unlistedSubject` text box.
*What it takes:* the student choosing — an interview step offering the portal's 87 with the escape
as an explicit option (ADR-0102), never a match of ours. Widening the map is not the shape; even at
87 of 87 it would be a fuzzy match from free text, which is the join Vahid refused to sign for
countries and has less behind it here.
*Cost:* an interview step that can offer a portal's list, which does not exist yet and would serve
several of these. Medium, and reusable.

**`institution-ts-control` — 1 of an unbounded list. Blocker 25 by name.**
Already raised, already costed there with three options (A: the student's own act; B: an interview
step offering the portal's entries; C: a reviewed option map per institution). Nothing here
supersedes that sheet. The only addition: `unlistedInstitution` exists as a text box beside it, so
the portal's own escape is available here too.

---

## §3 · The shape of the answer, summarised

| map | offered | mapped | verdict | cost |
|---|---|---|---|---|
| `highestQualification(UNIVERSITY_LEVEL)` | 7 | 1 | **derivable** once the registry holds a level | small |
| `gradingSystemId` | 5 | 1 | **derivable by rule**, but the list is per institution | small × institutions |
| `grade` | 9 | 4 | **a person reads five rows**, three of which are states not grades | smallest |
| `degree` | 42 | 2 | **wrong shape** — level → award title is not a derivation, and the two rows already render a guess | medium, and reconsider the two |
| `subject` | 87 | 1 | **wrong shape** — free text → an invented taxonomy; ask, do not map | medium, reusable |
| `institution-ts-control` | unbounded | 1 | **wrong shape** — blocker 25 | already costed there |

Three of the six (`subject`, `degree`, `institution`) point at the same missing capability: **an
interview step that can offer a portal's own list and take the portal's own escape.** Built once,
it serves all three and the fifth per-level qualification selects behind them. That is the one
piece of leverage on this page.

---

## §4 · The discipline: what it would take to put them under it

Vahid: *"the six partial maps have notes in the entry that nobody re-derives, where the countries
now have a page that regenerates."*

The country page has **two halves**, and only one of them needs a standard behind the vocabulary:

1. **A derivation** — join our 249-country table against the portal's list. This half is what makes
   the countries special, and it is the half that **cannot** be copied here. There is no table to
   join a subject list against.
2. **An accounting** — what the portal offers, what the entry maps, what is unreachable, what a
   ruling stopped and which pass reached it. This half needs **no** standard. It is arithmetic over
   the blueprint's captured options and the mapping set's option rules, both of which are already
   in the entry.

### (a) One page per map — costed and not recommended

Six generators, six drift tests, six sets of prose. Six times the machinery for maps holding one to
four rows, and five of the six would be a page saying *"1 of 87, here they are"*. **~3 days**, and
it buys the least.

### (b) One page covering the six — costed and not recommended either

Cheaper (**~1 day**) but it invents a category. The six share a page in the portal and nothing else:
six profile fields, six vocabularies, three shapes. A page titled *"the education maps"* would be
six unrelated sections that happen to be adjacent, and the next portal would not have the same six.

### (c) One accounting page over EVERY option map in the entry — recommended

Not six maps, not nine: **all 45 option-carrying mappings**, the countries included, generated from
the entry the way the country page is, drift-tested the same way. Per map: the profile field it
reads, the portal's offered count, the mapped count, whether the portal offers an escape and
whether anything names it, and which offered values nothing claims.

Why this and not the others:

- It is **the half that generalises**. It makes no claim to derive anything, so it does not pretend
  a subject list is a country table.
- It is **portal-agnostic**. The next entry gets the same page for free, because it reads the entry
  rather than a hand-written list of six.
- It converts the exact thing he named — *"notes in the entry that nobody re-derives"* — into a
  table that regenerates, **without** requiring a single decision about any of the six first.
- It would have surfaced the six as a row each, months before anyone asked.

*Cost:* **~1 day.** It reuses `optionsFromEntry`, the table helper and the drift-test shape from
`scripts/derive-country-mappings.ts`; the arithmetic is the measurement P206 already did by hand.

*What it does NOT do, stated so it is not mistaken for more than it is:* it finds nothing that is
wrong today. Every one of the six already carries a note saying it is partial, and §2's judgements
came from reading the entry, not from a gap in tooling. What it buys is that the **next** thin map
is a row on a page rather than a sentence in a note, and that the count moves on its own when a
portal's list changes under us.

---

## §5 · What is NOT proposed

- Widening any of the six. Three are the wrong shape and widening them multiplies the error.
- Copying the country derivation. There is nothing to join against.
- Treating §2's verdicts as decisions. They are readings, offered for his.
