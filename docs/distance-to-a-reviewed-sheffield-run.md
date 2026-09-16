# The distance to an end-to-end run against a reviewed Sheffield entry

**As of:** 2026-09-13 (P119) · **For:** Vahid · **Kept current:** every phase that changes an item
below updates this file; every report quotes the count of items and the declared-but-unreachable
number.

Vahid, 2026-09-13: *"what is left before a run could be made end to end against a reviewed
Sheffield entry — not the whole blocker list, just what stands between here and that. I have lost
track of how close that is, and I would rather know than assume."*

This is read from the repository as it stands — the curated draft (0.2.17), the mapping set
(0.3.17), the profile registry, the runner and the checks — not from memory. Where a number
appears, the script that produced it is the draft test and the coverage read of 2026-09-13.

## Two runs, not one

- **Run A — the fill.** A confirmed profile, built from synthetic data through the service's own
  page, filled by the runner into Part 1 of the real Postgraduate Online Application Form on an
  account, every page read back, the account handed over, **stopping before submission** (a hard
  stop, and Part 2 is unread in any case). This is the run the question is about.
- **Run B — the product.** The same, with the student talking to AskiMate and the interview run
  on a real model. Run B is Run A plus three items at the end of this list.

## What is already in place for Run A

Eleven pages captured and curated; registration and login authored from the entry read; the
personal and contact pages mapped and **read back exactly** on the live portal (P115–P116); the
equal-opportunities page mapped through the form's own refusals; the education page's six
document slots the student's own act with their companions set to *later* and the debt recorded
on the case (ADR-0104, 0107, 0108); the education listing named for the count (P113); every radio
group on the form carrying its submitted values (P108–P110); the nationality uploads placed off
the international path (P112); the institution box's entries and escape recorded and a mapping to
a typeahead naming the value (ADR-0109); the runner's fill, read-back, listing count, marker,
challenge stop, resume and handover all built and proved on the fixture portal and the journey.

## What stands between here and Run A

In the order they bite, each with who holds it and the evidence.

1. ~~**Which fields are mandatory on five pages is not in the record.**~~ **Closed, P126, with
   thirteen carried into item 6.** Three attached reads on 2026-09-14; the curated draft (0.2.18)
   carries 79 row-text labels and 50 observed markers on the five pages; thirteen fields whose
   question no positional rule can reach are Iman's to read from the screenshots, listed in the
   pack. Vahid, 2026-09-14: *"the ceiling is 106 of 149 because 43 fields have no question of
   their own, and the 13 between 93 and 106 are not a tool failure. They are markup a positional
   rule cannot reach. Anyone reading this later should not take it as work left undone."* The
   history: the draft marked `required`
   only where the DOM said so or a specialist noted it: personal (3), contact (6), employment (4),
   registration (3). On nationality (72 fields), language (19), education (33), marketing (10) and
   documents (10) the captured labels are the field names — placeholders — so the asterisks
   Sheffield puts on mandatory fields were never read, and every field there stands as optional.
   A run would pass them over and save the page empty; Sheffield's own statement is that Part 2
   opens only when every mandatory field of Part 1 is complete. **Read once, 2026-09-14
   (`docs/captures/sheffield-pgt-2026-09-14-five-pages/`), and not closed by it:** the attached
   tool's observer tied no label and saw no asterisk, because the markup ties nothing. P123 made
   the observer read the row's question and the bare `*`, with their sources named
   (`labelSource: "row_text"`, `observed_marker`). **Re-read the same day
   (`docs/captures/sheffield-pgt-2026-09-14-five-pages-relabelled/`): 76 of 149 labelled, 42
   marked, and not closed by it** — the seventy-three unlabelled are named in that README and
   include nationality's top selects, its dates and all four previous-country blocks, whose
   question is in a row above, not in theirs. P124 reads a control's own words, the row's
   question, and the question row above. **Third read the same day
   (`docs/captures/sheffield-pgt-2026-09-14-third-read/`): 93 labelled, 50 marked, and the
   ceiling of reading by position** — forty-three of the fifty-six unlabelled have no question
   of their own; the thirteen that matter (nationality's eleven top questions, two language
   radios) sit where no rule over rows can look, and nationality's markers did not move between
   reads. Fourteen labels the third rule got wrong are named, and the observer now refuses
   those shapes rather than guessing. **What closes it:** the read folded into the curated
   draft, the fourteen excluded (mine, on his word to stop), and the thirteen read from the
   screenshots at review — the pack's own fallback since it was written. Nothing can be mapped
   for a page whose mandatory set is unknown, so this is first.
2. ~~**The employment page blocks the plan today.**~~ **Done, P129.** Decided by Vahid, 2026-09-14
   (ADR-0111): *"employment goes into the registry as a new group"*, one entry per job, the page
   repeating as education does, a page filled zero times said plainly; the shape confirmed by him
   with the referee narrowed to a name and a role. Built: `employment.history` in the registry,
   `page8` repeating over it (draft 0.2.19), the four required fields and the dates mapped per
   job (set 0.3.19), the empty page's line in the preview. The section is optional in the
   portal's own words on `summary.do`, so no student is stuck. **P130:** his read of the listing
   with one throwaway job saved names it (*Previous Employment N*, draft 0.2.20), so each save is
   counted. What remains is Iman's review (item 6).
3. **The nationality page: seventy-two fields, none mapped, and the registry holds part of what
   it asks.** Funding nationality, country of birth, permanent residence and the immigration
   yes/no questions map onto `identity.nationality`, `identity.country_of_birth` and the two
   `immigration.*` lists as far as those reach; the registry has no permanent-residence field, no
   UK-residence history, and no list of previous countries with dates. Each select takes the
   portal's own names through a partial option map, like the country map on contact. What is
   mandatory here is item 1. **Iman's mapping** for what the registry reaches; **a product
   decision** for what it does not — **the sheet is written (P136):**
   [`decision-sheet-item-3-what-the-registry-does-not-hold-of-a-student-residence-and-status.md`](./decision-sheet-item-3-what-the-registry-does-not-hold-of-a-student-residence-and-status.md),
   four groups with options and a recommendation each; his answers, in his words. **P139
   (ADR-0115, confirmed by him with one change):** the registry holds the three groups and
   set 0.3.23 maps thirty-six of the page's fields from them — no day anywhere, by his change.
   **P141 (ADR-0117):** group 4 decided (A) and built — the passport is one value, held or
   stated as none, and the row is mapped with the portal's own words quoted for a stated none.
   **P142:** `nationality.js` read — the page's show/hide on the draft as twelve sections, the
   two spans' fields renamed once from the script, the UK-study block mapped (set 0.3.25). A
   resident abroad with no UK study fills the page with nothing blocking. What still waits: the
   five per-level qualification selects (blocker 25's shape) and the registry's nationality
   vocabulary, both his; and Iman's sitting, which starts now. Blocker 29 (the silently dropped
   fifth period) raised.
4. **The language page: nineteen fields, none mapped.** The registry has
   `education.english_language_test`; the page asks the test type (42 options), the award date
   as three selects, certificate numbers, awarding body and the component scores, and offers a
   certificate slot whose companion is now named. **Iman's mapping**, once item 1 says what is
   mandatory.
5. **The education page's own fields: thirty-three, six handed, the rest unmapped — and one of
   them cannot be mapped by rule.** The country box needs its entries recorded on the box (the
   captured `<select>`'s 255, copied); degree, subject, the three dates and the grade are selects
   with option maps from the `Qualification` parts, and the grade list arrives only after an
   institution is chosen, so **his read** of that list with an institution set comes first (P94's
   rule: no mapping may name an option the capture does not hold). **P127:** the attached tool
   opened each page fresh, so that state was lost before the read; `--as-is` now reads his own
   open tab as it stands, proved on the fixture's dependent list, red first. The steps, in order,
   are in the 2026-09-10 capture README under *Item 5*. **P132: read, as it stood** — the
   grade list (system 7's nine), Sheffield's four grading systems by numeric id, the subject
   results of one search by search-then-select, and the chosen institution's value on the hidden
   select, all in the draft (0.2.21) from observation
   (`docs/captures/sheffield-pgt-2026-09-14-education-dependent/`). **Found by it:** the registry's
   `Qualification` has no start or end date, and the page's four date selects are marked
   mandatory — the page cannot be filled from the profile as it stands, whatever is mapped.
   **Blocker 27, decided by Vahid and built (ADR-0112, P134):** `Qualification` carries a start,
   an end and an award date; the six date selects are mapped per qualification (set 0.3.22) and
   leave the plan's blockers. What remains of this item is the reviewer's option maps onto the
   observed lists (degree, grading system, grade, subject, country) and the institution box,
   which is the hard one: ADR-0109 requires an option rule onto recorded entries, and a real student's
   institution is free text — no rule can map *Sharif University of Technology* onto Sheffield's
   list. Either the box is the student's own act, or an interview step offers the portal's own
   entries for the student to choose. **Raised as blocker 25**, below; his decision.
6. **Review — changed by Vahid, 2026-09-16 (ADR-0118).** *"Drop it to one: I approve, and I am
   the only signature."* He signs the blueprint and the mapping set in `approvals.json`, naming
   his own `studentId` under `ownAccountOnly`; the loader refuses a draft, an unreviewed set, and
   a self-signed approval that names no account, and the service serves the entry to his account
   and to nobody else. Iman's sitting is dropped. What the pack flagged for a reviewer — the
   thirteen fields read from the screenshots, the fifty observed markers, the three flagged items
   — stays in the pack for whoever reviews before a real student, because **a second reviewer is a
   precondition of serving a real student, not an improvement** (his words;
   [`what-was-skipped-to-get-it-standing.md`](./what-was-skipped-to-get-it-standing.md)). Open
   until he signs. **Vahid.**
7. ~~**`robots.txt` for `www.sheffield.ac.uk` has never been read from this repository — and the
   fill run does not read it at all today.**~~ **Done, P135.** The first half was his read of
   2026-09-14, evaluated by the runner's matcher (P122): every observed path allowed, the
   `/user/*` disallows path rules, no crawl-delay. The second half is the runner's own: before
   every unit of work it performs, the Automation Runner reads the portal's `robots.txt` (kept
   ten minutes, read as `askimate-aas-runner`), refuses the work with `robots_disallows` if any
   page it would open is disallowed or the file could not be read, refuses again at the
   navigation and at every request of the fill session, and paces the fill session's
   navigations at the site's Crawl-delay or one second, whichever is longer. Proved on the
   fixture portal's own `robots.txt`; the journey runs the real performer through the gate.
8. ~~**The account, and how the run enters it.**~~ **Done, P122.** Decided by Vahid, 2026-09-14
   (ADR-0110): *"the run enters my existing account. Not a fresh synthetic applicant."* Built:
   the student says the account is theirs before the yes, the case records it, and ADR-0101
   §3's sign-in path runs from the start; the handover asks one confirmation, not a reset of a
   password that was always theirs. Proved through the five real processes on the fixture. What
   it needs from him on the day is the password through the box, once. His distinction is on
   the record: the profile is synthetic, the account is his, and only the second is decided.
9. ~~**Where it runs.**~~ **Done, P120.** `scripts/local-stack.sh` stands the five processes up
   on one machine against a Postgres and a Redis, migrated, and checks each; proved by
   `scripts/local-stack.test.ts` against the fixture catalogue; the Sheffield variant is
   `AAS_LOCAL_CATALOGUE=registry` with the reviewed entry's directory
   ([`runbook-local-stack.md`](./runbook-local-stack.md)). Found on the way: the runner's entry
   point launched its browser with no remote-debugging port, so the CDP endpoint it declared to
   the Fill Agent was served by nothing — every credential fill from the real deployable would
   have failed at the password. Fixed, red first. This environment still cannot reach
   `sheffield.ac.uk`; the script runs from a machine that can.
10. **Part 2 is unread.** The eleven observed pages are Part 1; the course choice is Part 2, and
    the blueprint has no page for it and no submission model. Run A ends at the end of Part 1.
    **Vahid, 2026-09-14:** *"not now. Run A ends at the end of Part 1 and I am not extending it
    before it has happened once."* Not on Run A's path by his word; kept here so the count stays
    honest about what Run A is.

**Not on Run A's path, and why:** Bedrock (blocker 3) — the profile can be confirmed through the
service's own page with the deterministic client, as the journey does; the vault's bucket
(blocker 17) — no document is attached on the international path as mapped; the DPA policy
document (blocker 8) — no real student's data, and no special-category data held (the form's
refusals); the AskiMate integration and specialist identity (blockers 10, 11) — Run B.

## Run B adds

Bedrock wired and verified (blocker 3, and the service has no code path that builds a Bedrock
client today); the AskiMate integration (blocker 10); a consenting real applicant, with the DPA
policy document in place (blockers 4 and 8 in their real form); **and the interview asking for
what the registry holds** (recorded 2026-09-15 at Vahid's question). The interview asks a field
only when a question is defined for it (`packages/interview/src/field-specs.ts`), and seven of
the registry's twenty-seven fields have one — the two names, the date of birth, the nationality,
the e-mail, the mobile, the personal statement. For any other outstanding field it stops with
*"No question is defined … The agent will not improvise one"*. The two list-valued groups he
decided (employment, qualifications with their dates) are among the twenty it cannot ask, and
so are the address, the passport, the English test, finance and immigration. Run A does not meet
this: its profile is confirmed through the service's own store and page by the deterministic
client, lists included, and the journey does exactly that today. Run B, the student talking to
AskiMate, meets it on its first required field with no question. Not on Run A's list for that
reason; on Run B's for the same reason. How it is to be built is decided (ADR-0113, in his
words): entry by entry, and never from a pasted CV the model summarises. One scope note for
that build, from the nationality page's script (P142, recorded in ADR-0113): the seven UK
status claims are asked by the portal only of a non-UK national resident in the UK or the EU, so
the interview should ask them only when the residence makes a portal ask.

## Blocker 25, raised here

**The institution box cannot be mapped by rule from a free-text profile field.** ADR-0109 makes
a typeahead mapping name a recorded entry's value through an option rule. A student's
institution is whatever they typed; Sheffield's list is Sheffield's. Options: (A) the box is the
student's own act, handed like the document slots, with the read-back seeing what they chose;
(B) an interview step that offers the portal's entries — fetched by the runner's own search, or
recorded by the reviewer — and records the student's choice as the value, which the mapping then
names; (C) a reviewed option map per institution, which scales as far as the reviewer types.
Nothing here is built; the sheet is written when he asks for one.

## The two lines every report carries

- *Declared-but-unreachable: four* — the reachability check's count of declared capabilities
  with no production caller, reviewed (`pnpm run reachability`).
- *Distance to Run A: five items open of ten* — this file's list, by count, with what moved.

## What moved

- 2026-09-16, P144: item 6 changed at his word — one signature, his, for his own account only,
  enforced in the code (ADR-0118); Iman's sitting dropped; what the one signature leaves uncaught
  written for the developer. Five open of ten, unchanged.
- 2026-09-15, P143: records at his word — the ADR says why the script was read, not only what
  it said; the field the page answers itself is on the record; Sheffield's own bug is dated and
  the drift named; blocker 30 raised for what the condition language cannot say, with his
  sentence; the interview's scope note where Run B is scoped. The blocker 25 sheet written, the
  nationality vocabulary answered with it. Five open of ten, unchanged.
- 2026-09-15, P142: `nationality.js` read from his commit. The two residence fields renamed
  once from the script; the page's show/hide on the draft (0.2.22) as twelve sections; set
  0.3.25's nine mappings (the nationality selects, the UK-study block); the entry-date question
  answered by the page. Proved: a resident abroad fills the page with nothing blocking. Open and
  his: the per-level selects and the nationality vocabulary. Five open of ten, unchanged.
- 2026-09-15, P141: group 4 decided and built (ADR-0117: one passport value, held or none; the
  portal's words in the mapping through `absent: { typed }`, never in the profile); set 0.3.24;
  twenty-seven unmapped. His decisions on the three-year window and the two spans recorded in
  ADR-0115; blocker 29 raised. P140 read the row's words off his committed markup. Iman starts
  now. Five open of ten, unchanged.
- 2026-09-15, P139: ADR-0115 built on his confirmation with one change — the entry date as
  month and year, never a day; his two reasons recorded. Three registry groups, the `derived`
  origin, set 0.3.23's thirty-six nationality mappings; the unmapped count on the three pages
  down from forty to twenty-eight. The UK-study block and the passport row wait on his
  committed markup. Five open of ten, unchanged.
- 2026-09-15, P138: blocker 28 decided and built the same day (ADR-0116: a cancel is the
  student's stop). A seventh run status; the run stops where it was on the next tick, the
  student told once; the restart is asking to apply again, a fresh box, nothing repeated; the
  three stops are three records. Five open of ten, unchanged.
- 2026-09-15, P137: blocker 26 built as decided (ADR-0114: two attempts, then a person; the
  student told at both points). The ledger counts attempts made and names the spent secret; the
  step sends the run back to the box by identity, not by the outbox's lifecycle word; the
  second failure stops with which attempt and why on the record. Found and closed on the way:
  a held run's advance could open a password box. Blocker 28 raised — a cancelled box loops
  the same way, his call. Five open of ten, unchanged.
- 2026-09-15, P136: records and sheets — ADR-0113 (the interview asks entry by entry; a CV block
  is its own decision if ever wanted), his two notes on item 7 in ADR-0091, and two decision
  sheets for him: blocker 26 and item 3's registry gaps. Five open of ten, unchanged.
- 2026-09-15, P135: item 7 done — the runner reads, obeys and keeps robots.txt before every
  unit of work and paces the fill session (ADR-0091 on the fill path), with `robots_disallows`
  as the failure a person decides. The interview's coverage recorded under Run B at Vahid's
  question: seven of twenty-seven registry fields have a question; Run A does not need it, Run
  B meets it first. Five open of ten.
- 2026-09-15, P134: blocker 27 built — a qualification has dates (ADR-0112, confirmed by Vahid
  with his reasons and one condition on the extraction); the six education date selects mapped
  per qualification; the plan's `no_mapping` blockers down to forty, all on the three unmapped
  pages. Item 5's registry gap closed; blocker 25 and the reviewer's maps remain. Six open of
  ten, unchanged.
- 2026-09-14, P133: blocker 27 decided — a qualification has dates (ADR-0112), the shape
  proposed for his confirmation with the award date held on its own; nothing built. Six open
  of ten, unchanged.
- 2026-09-14, P132: item 5's read taken as it stood — the grade list and the whole education
  chain from observation, folded into the draft 0.2.21; the subject results' two trailing-space
  values and one duplicate recorded; no mapping authored because the registry's `Qualification`
  has no start or end date and the page's four date selects are mandatory — blocker 27, his
  decision. `degree`'s marker seen in one read and not the other, flagged. Six open of ten,
  unchanged.
- 2026-09-14, P130: the employment listing named from his throwaway save (draft 0.2.20, set
  0.3.20); the new-entry URL confirmed as the way in; the summary found to omit duties, which
  under ADR-0106 §2's count-only verification changes nothing today and rules out a listing
  read-back of duties ever; the fifth marker explained as the row's star on the year. Six open
  of ten, unchanged.
- 2026-09-14, P129: item 2 done — the shape confirmed by Vahid (referee narrowed), the registry
  group built with two format rules, the page repeating, the four fields mapped, the empty page
  said plainly and pinned. The `summary.do` listing is his throwaway save, same sitting as item
  5. Six open of ten.
- 2026-09-14, P128: item 2 decided by Vahid — a registry group for employment, the page
  repeating, the empty page said plainly (ADR-0111); the shape proposed for his confirmation,
  nothing built. The optional section, from `summary.do` in the portal's words, corrects P127's
  "not in the record". Seven open of ten until the build lands.
- 2026-09-14, P127: item 5's read was not runnable as the tool stood — it navigates, and the
  grade list an institution loads is gone on navigation. `--as-is` reads the person's own open
  tab in place; proved red-first on the fixture's passport list and through the real command
  under tsx, where the adopted tab needed the `__name` shim by hand. His steps for the education
  page written. Item 2 answered from the registry: the four employment fields are new facts
  about a student, held under no other name — his decision. Seven open of ten, unchanged.
- 2026-09-14, P126: item 1 closed with thirteen carried into item 6, on Vahid's word to stop
  (*"for the reason you gave rather than the count"*). The third read folded into the curated
  draft 0.2.18 — 79 labels, 50 markers, the fourteen wrong labels excluded, the thirteen as
  their names — the set re-bound as 0.3.18, the review pack revised with the thirteen listed on
  their own and two marks flagged. The draft test now shows forty-four observed-mandatory fields
  on the three unmapped pages as `no_mapping` beside employment's four: items 3, 4 and 5 made
  visible. Seven open of ten.
- 2026-09-14, P125: item 1's third read — 93 of 149, 50 marked — read from the file and the
  ceiling stated: forty-three unlabelled by right, thirteen that matter unreachable by rules
  over rows, fourteen labels wrong in two new shapes (a help sentence taken with the next
  question; a column header taken as a question), both now refused by the observer, red first.
  The recommendation is to stop the reads and give the thirteen to Iman's screenshot read.
  Eight open of ten, unchanged.
- 2026-09-14, P124: item 1 re-read with the row-text observer and found not closed — 76 of 149
  labelled, 42 marked, the seventy-three named, four labels wrong (a row asking several
  things), the companions' "later" options carrying a comment node's markup. His six console
  observations checked against the file: four held, one half, one corrected (twelve starred
  yes/no groups, not one — his snippet's name filter). The observer reads a control's own
  words and the question row above; a comment is never a radio's words. Eight open of ten,
  unchanged.
- 2026-09-14, P123: item 1 read once with the attached tool and found not closed by it — the
  observer resolves labels only through markup ties, and these pages tie none. The observer now
  reads the row's question and the visible marker with their sources named; his re-read closes
  the item. Eight open of ten, unchanged.
- 2026-09-14, P122: item 8 done — the start path onto an account the student already holds,
  built and proved through the five processes (ADR-0110). Item 7: his read of
  `www.sheffield.ac.uk/robots.txt` evaluated by the runner's own matcher — every observed path
  allowed by no rule matching, the `/user/*` disallows path rules that do not reach the form,
  no crawl-delay so the one-second floor is ours; the matcher was found reporting a
  non-matching `Allow` as its reason and fixed red-first. The fill run's own reading is P123.
  Eight open of ten.
- 2026-09-14, P122 (records): item 8 decided by Vahid — his own existing account, never a
  synthetic applicant (ADR-0110); the start path is mine, P122. Item 7 corrected: the fill run
  reads no robots.txt today; P123 puts ADR-0091's reading into the runner. Item 10 held by his
  word. Items 1, 2 and 5 are his next reads, in that order; the item 1 snippet is in the capture
  README. The count is unchanged until P122 lands: nine open of ten.
- 2026-09-13, P121: item 9 strengthened — the five processes the script starts now carry the
  whole journey (`scripts/local-stack-journey.test.ts`), which found five defects between them
  the in-process journey could not see (the worker's origins, no page served, the certificate
  header, `__name` under `tsx`, two local master keys), all fixed red-first. The count is
  unchanged: nine open of ten.
- 2026-09-13, P120: item 9 done (the local-stack runbook, proved); the runner's CDP endpoint
  found unserved from the real entry point and fixed.
