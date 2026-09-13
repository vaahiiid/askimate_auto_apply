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

1. **Which fields are mandatory on five pages is not in the record.** The draft marks `required`
   only where the DOM said so or a specialist noted it: personal (3), contact (6), employment (4),
   registration (3). On nationality (72 fields), language (19), education (33), marketing (10) and
   documents (10) the captured labels are the field names — placeholders — so the asterisks
   Sheffield puts on mandatory fields were never read, and every field there stands as optional.
   A run would pass them over and save the page empty; Sheffield's own statement is that Part 2
   opens only when every mandatory field of Part 1 is complete. **His read:** the labels with
   their asterisks on those five pages, the same snippet shape as before, then the draft.
   Nothing can be mapped for a page whose mandatory set is unknown, so this is first.
2. **The employment page blocks the plan today.** Four required fields — start date, position,
   employer, duties — and the profile registry has no employment field, so `planFill` raises
   `no_mapping` on all four and `isComplete` is false: no run can be claimed. Two routes, neither
   taken: registry fields for employment (a product decision about what the profile collects,
   raised in P89), or the four mapped as `student_handoff` — the student fills that page — which
   the existing vocabulary allows and the reviewer can sign now. **His decision** on the route,
   then Iman.
3. **The nationality page: seventy-two fields, none mapped, and the registry holds part of what
   it asks.** Funding nationality, country of birth, permanent residence and the immigration
   yes/no questions map onto `identity.nationality`, `identity.country_of_birth` and the two
   `immigration.*` lists as far as those reach; the registry has no permanent-residence field, no
   UK-residence history, and no list of previous countries with dates. Each select takes the
   portal's own names through a partial option map, like the country map on contact. What is
   mandatory here is item 1. **Iman's mapping** for what the registry reaches; **a product
   decision** for what it does not.
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
   rule: no mapping may name an option the capture does not hold). The institution box is the
   hard one: ADR-0109 requires an option rule onto recorded entries, and a real student's
   institution is free text — no rule can map *Sharif University of Technology* onto Sheffield's
   list. Either the box is the student's own act, or an interview step offers the portal's own
   entries for the student to choose. **Raised as blocker 25**, below; his decision.
6. **Review.** Iman signs the blueprint and the mapping set; the loader refuses a draft, an
   unreviewed set, and an approval signed by its author (blocker 2). Three items are flagged for
   him in the review pack: what the education page's first slot asks for, the contact page's
   *After* / *Before* texts, and the postcode's two boxes. **Iman.**
7. **`robots.txt` for `www.sheffield.ac.uk` has never been read from this repository.** The run
   reads it before the browser opens and obeys it; if it disallows the form's path the run
   refuses and nothing above matters. It is a public URL: **one read by Vahid**, pasted whole,
   settles it early rather than on the day.
8. **The account, and how the run enters it.** A fresh run registers a new applicant through the
   Secure Plane with a password the student chooses (ADR-0101); signing in to an existing
   account is the *resume* path only (P72), not a start. So Run A on the live portal means
   registering a synthetic applicant on Sheffield's real form — the fabricated-account option the
   gap analysis of 2026-08-26 advised against — or admitting a run onto his existing test
   account, which no path today offers as a start. **His decision**, and blocker 4 as it stands.
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
    the blueprint has no page for it and no submission model. Run A ends at the end of Part 1,
    which is where it should end today; a reading of Part 2 with Part 1 complete on his account
    is what extends it. **His read**, when Part 1 is complete on his account.

**Not on Run A's path, and why:** Bedrock (blocker 3) — the profile can be confirmed through the
service's own page with the deterministic client, as the journey does; the vault's bucket
(blocker 17) — no document is attached on the international path as mapped; the DPA policy
document (blocker 8) — no real student's data, and no special-category data held (the form's
refusals); the AskiMate integration and specialist identity (blockers 10, 11) — Run B.

## Run B adds

Bedrock wired and verified (blocker 3, and the service has no code path that builds a Bedrock
client today); the AskiMate integration (blocker 10); a consenting real applicant, with the DPA
policy document in place (blockers 4 and 8 in their real form).

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
- *Distance to Run A: nine items open of ten* — this file's list, by count, with what moved.

## What moved

- 2026-09-13, P120: item 9 done (the local-stack runbook, proved); the runner's CDP endpoint
  found unserved from the real entry point and fixed.
