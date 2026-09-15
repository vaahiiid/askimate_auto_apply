# Decision sheet — blocker 25: a portal's own list against the student's words

**For:** Vahid · **Prepared:** 2026-09-15 (P143) · **Answerable in one sitting.** Recorded as
**blocker 25** in [`state-of-the-system.md`](./state-of-the-system.md); raised in P118 on the
institution box, and met since in four more places on the same form. He said he would answer the
registry's nationality vocabulary with it; that question is the last section.

> **What raised it** — ADR-0109 (his decision, 2026-09-13): a typeahead mapping names the value
> the form submits, the reviewer records the text, both must match at the fill, and the escape is
> named by value and never chosen for the student. That rule is right and it exposes the gap: the
> student's institution is whatever they typed into the profile, and Sheffield's institution list
> is Sheffield's. No rule turns one into the other.

## The facts, from the drafts and the code

- **The institution box** (`institution-ts-control`, page7) is a Tom Select typeahead whose
  entries follow the country chosen above it (`optionsAfter: institutionCountry-ts-control`).
  The draft holds the eleven entries his read of *Sheff* returned, value and text (P118), and the
  escape *Not in list* by value. The runner types, waits for the one exact entry by its text, and
  chooses it (P95, P101); two entries reading identically are told apart by value (ADR-0109).
  Unmapped: no profile field names a Sheffield entry value.
- **The same shape, four more times on the form.** `degree` — a select of Sheffield's
  qualification names with *Not in list* (value `""`) opening `unlistedDegree`, a 28-character
  text; `subject` — a search-then-select (P132); `gradingSystemId` and `grade` — per institution,
  the lists observed with an institution chosen (P132: system 7's nine grades); and the five
  per-level UK-study selects on the nationality page (`UG DEGREE`, `MASTERS`, … — P142). Every
  one wants the student's answer in the portal's list, and the registry holds the answer in the
  student's words (`Qualification.level`, `.subject`, `.institution`, `.grade`, `.gradeScale`;
  `UkStudy.qualification`).
- **What the registry does today, and where it already draws the line.** Every profile value
  comes from something the student said, deterministically (ADR-0007, ADR-0113). A value the
  mapping cannot name refuses to render rather than choosing the closest (`no_matching_option`).
  The one thing on this form that IS the student's own act is a document slot: handed to them,
  recorded as their own act on the case, read back as what the portal shows (ADR-0104, 0106,
  0107, 0108).
- **What Run A needs.** One qualification, one institution, one grade, on a synthetic profile
  you control. Any of the options below serves Run A; they differ for the product.

## Options

**(A) The box is the student's own act.** The institution (and degree, subject, grading system,
grade) are handed to the student like a document slot: the run fills what it can, stops on the
page, and says *"choose your institution from Sheffield's list"*; the read-back (ADR-0106)
records what they chose. **For:** nothing invented, no list to maintain, the portal's own search
is the search. **Against:** the student is in the portal for every qualification on every
application; the run cannot complete a page without them, so the *"ready to submit, nothing
submitted"* stop moves earlier; and the grade list depends on the institution, so one handed box
becomes four.

**(B) The interview offers the portal's entries and records the choice as the value.** When the
student names an institution, an interview step shows them the portal's matching entries — read
by the runner's own search against the live box (a GET-shaped typeahead query, under the robots
gate), or recorded by the reviewer in the draft — and records their choice as a **per-portal
value on the case**, not in the profile: the registry keeps *"Amirkabir University of
Technology"*; the case holds *"for Sheffield, entry `UNI…`"*. The mapping then names that
recorded value through the existing `option` rule with the escape refused. **For:** the student
chooses, once, in words they can see; the fill is by rule; the profile stays portal-free.
**Against:** a new record on the case (a value chosen for a portal), an interview step that
shows a list (ADR-0113's shape, Run B), and a live search by the runner at interview time that is
new traffic to the portal — or a reviewer-recorded list that is only as complete as the reviewer.

**(C) A reviewed option map per institution.** Iman maps the registry's words onto Sheffield's
values, entry by entry, as the country maps are mapped. **For:** nothing new is built; the
existing partial-map pattern. **Against:** it scales as far as the reviewer types — hundreds of
institutions, per country, per portal — and a student's spelling of their institution is not a
closed vocabulary, so most students would still refuse to render.

**What I would choose, and why.** **B, with the reviewer-recorded list for Run A and the
runner's search for the product.** It is the only option under which the student chooses from
the portal's own words *and* the fill stays by rule *and* the profile holds nothing that belongs
to a portal — the same separation ADR-0117 just drew for the passport's words. A is honest but
moves the student into the portal for the ordinary case; C cannot be completed. The cost is
real: a case record for a portal-specific choice, and an interview step that shows a list, which
belongs to the Run B interview build. For Run A the reviewer records the entries the synthetic
profile needs, as P118 did for *Sheff*, and the case record is written by hand for the run.

**Whichever you choose, one rule to state:** the escape (*Not in list*, `unlistedDegree`) is
chosen only by the student, never as a fallback for a value the mapping could not name.

## What it needs from you

1. A, B or C — and if B, whether the list at interview time is the reviewer's record, the
   runner's search, or the record first and the search later.
2. Whether the choice is held on the **case** (per application, per portal) or somewhere else.
3. Whether A's stop, if you choose A, is the same handoff as a document slot's.

## The registry's nationality vocabulary — answered with this sheet, in your words

`identity.nationality` holds a string with no fixed form: the passport plan reads the word off
the document (*IRANIAN*), the interview asks *"a nationality or country"*. The three other
country fields hold ISO 3166 codes (`contact.address.countryCode`, `residence.country`, the
history's `countryCode`), and every country map in the Sheffield set is keyed on codes. Set
0.3.25 keyed `fundingNationality` and `countryOfBirth` the same way, which is right only if the
profile holds a code.

**Options:** (1) the nationality is an ISO code too, and the passport plan turns *IRANIAN* into
`IR` through a **reviewed table** of demonyms and country names — deterministic, not a model —
with a word the table does not know refused, not guessed; (2) the nationality stays the
student's word and each portal map is keyed on words, which is C's problem again; (3) both a
code and the word, which is two fields that can disagree. **Recommendation:** 1.
