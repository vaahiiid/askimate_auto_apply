# Run A — the artefacts for one run on Vahid's own account

What is here is data for Run A (`docs/distance-to-a-reviewed-sheffield-run.md`): a synthetic
profile, and later the reviewed catalogue entry. Nothing here is a person, and nothing here is
served to anyone but the one account an `ownAccountOnly` approval names (ADR-0118).

## The synthetic profile — `synthetic-profile.json` (P150)

Vahid, 2026-09-16: *"the synthetic profile: I want to see its values before it seeds."* So the
command that writes it prints first and writes only when told to, and this table is the same
eighteen values, in the profile store's stored shape (a date is `{"$date": …}`):

| Registry field | Value |
|---|---|
| `identity.given_name` | `"Niloofar"` |
| `identity.family_name` | `"Hosseini"` |
| `identity.date_of_birth` | `{"$date": "1999-04-02T00:00:00.000Z"}` |
| `identity.nationality` | `"IR"` |
| `identity.country_of_birth` | `"IR"` |
| `identity.passport` | `{"kind": "none"}` |
| `contact.email` | `"niloofar.hosseini@example.com"` |
| `contact.address` | `{"line1": "12 Valiasr Street", "city": "Tehran", "postalCode": "1966733411", "countryCode": "IR"}` |
| `education.prior_qualifications` | `[{"level": "Bachelor's degree", "subject": "Business Management", "institution": "University of Sheffield", "countryCode": "GB", "start": {"year": 2019, "month": 9}, "end": {"kind": "completed", "date": {"year": 2022, "month": 6}}, "award": {"year": 2022, "month": 7}, "grade": "2:1", "gradeScale": "uk_honours"}]` |
| `employment.history` | `[{"employer": "Pars Novin Trading Co.", "employerAddress": "Unit 4, 8 Mirdamad Boulevard, Tehran, Iran", "position": "Business analyst", "startDate": {"year": 2022, "month": 10}, "end": {"kind": "current"}, "basis": "full_time", "duties": "Prepares monthly sales analyses, maintains the customer database and supports the commercial team's tenders."}]` |
| `residence.country` | `"IR"` |
| `residence.in_uk_now` | `false` |
| `residence.history` | `[{"countryCode": "IR", "from": {"year": 2015, "month": 9}, "to": {"kind": "ended", "date": {"year": 2019, "month": 8}}}, {"countryCode": "GB", "from": {"year": 2019, "month": 9}, "to": {"kind": "ended", "date": {"year": 2022, "month": 7}}}, {"countryCode": "IR", "from": {"year": 2022, "month": 8}, "to": {"kind": "current"}}]` |
| `residence.always_in_residence_country` | `false` |
| `residence.always_in_eu` | `false` |
| `residence.outside_residence_country_last_three_years` | `false` |
| `immigration.uk_status` | `{"british_passport": false, "indefinite_leave": false, "refugee_status": false, "migrant_worker": false, "spouse_of_uk_citizen": false, "eu_passport": false, "spouse_of_eu_citizen": false}` |
| `immigration.uk_study` | `{"kind": "studied", "onStudentVisa": true, "highestLevel": "university", "qualification": "BSc Business Management", "timeOnVisa": {"years": 3, "months": 0}}` |

**Who this is.** A synthetic Iranian national, born 1999, resident in Tehran, holding no passport,
with one qualification — a BSc in Business Management from the University of Sheffield,
2019–2022, a 2:1 — which is a UK study at university level on a student visa (three years, no
current visa), back in Iran since August 2022 and in one job there since October 2022. Every
value is invented. The qualification is Sheffield's because only Sheffield's dependent lists were
read (P132), at his word: *"A Sheffield degree for the synthetic profile."*

**What it types into the application on his account.** The whole of Part 1 as the drafts map it,
including the e-mail address into the personal page's two e-mail boxes. The e-mail here is an
`example.com` address, kept synthetic at his word (*"A real address inside an otherwise invented
profile is the worst of both — not a test and not true"*). **Sheffield may send to that address
and nothing will arrive** — no confirmation, no reminder, no reset link reaches anyone — so
silence from the portal after Run A is not evidence of a portal failure, and nobody later should
read it as one. The passport is *none*, so the nationality page gets the portal's
own *"no passport"* instruction (ADR-0117); a synthetic passport number was not invented.

**Not held, and why.** `residence.uk_entry_date` — not in the UK now, and the page hides the entry
date for a resident abroad; `immigration.uk_study.currentVisaExpiry` — no current visa, the three
expiry boxes typed empty as the row's own words allow; and every registry field no Sheffield
mapping reads. `scripts/run-a-profile.test.ts` holds that the fixture names exactly the fields the
set reads, that it plans onto the drafts with nothing blocking on Part 1, and that the preview at
the yes reads as it should.

## Seeding it

```sh
pnpm run profile:seed docs/run-a/synthetic-profile.json
#   prints the eighteen values; writes NOTHING

AAS_CONVERSATION_DATABASE_URL=postgresql://…/aas_local_conversation \
  pnpm run profile:seed docs/run-a/synthetic-profile.json --write --subject run-a
#   creates the students row for "run-a", writes the values, prints the studentId UUID
```

The UUID it prints is the identity everything keys on: post it as the dev session's `subject`
(`POST /dev/session`), and write it into the approval's `ownAccountOnly.studentId`. The command
refuses to write for a student who already holds any profile entry — a seed never overwrites
what a person has said.

**Provenance, said plainly.** Every seeded entry is stored with `source: "seeded"` (ADR-0121,
decided by Vahid: *"add the true one. 'Seeded, no interview took place' is a real origin and the
nearest honest word is not it"*) and a `sourceExcerpt` reading *seeded from synthetic-profile.json
by `pnpm run profile:seed --write` on <date>; no interview took place*. A seeded value is not a
student's confirmation and nothing may read it as one; nothing refuses one on any path today, and
the ADR says so.

## The catalogue entry — `catalogue/entries/sheffield-pgt-2027-09.json` (P152)

The thing he signs. Assembled from the two drafts as they stand — blueprint 0.2.25 and mapping
set 0.3.31, byte for byte after parse, which `scripts/run-a-profile.test.ts` holds — plus the
portal-authentication facts of 2026-09-11, `requiredDocuments: []` (the runner attaches nothing
on the international path; the six education slots are the student's own act), the repository's
own refs for the submission key (`inst-sheffield`, `course-sheffield-msc-management-and-
international-business`, `2027-09`) and `passwordDelivery: askimate_secure_channel`.

**It is not signed.** Both artefacts still say `draft`, the set names no reviewer, and
`pnpm run catalogue check docs/run-a/catalogue` refuses the directory for exactly that. The
signature is three acts, his, in this order, after the read below:

1. In the entry file, `blueprint.status` → `"reviewed"`.
2. `mappingSet.status` → `"reviewed"`, `mappingSet.reviewedBy` → `"Vahid Mohammadi"`,
   `mappingSet.reviewedAt` → the moment, RFC 3339.
3. `pnpm run catalogue hash docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json`, and the
   hash into `docs/run-a/catalogue/approvals.json` in the shape the runbook shows, with
   `ownAccountOnly.studentId` = the UUID the seed printed (ADR-0118). Then
   `pnpm run catalogue check docs/run-a/catalogue` prints *admits ONE account only*.

Anything that changes in the entry after step 3 invalidates the approval, which is the point
(ADR-0057). The test that pins the entry to the drafts will go red the moment a draft moves
under a signed entry, which is the signal to decide whether to sign again.

## The read — `what-will-be-typed.md`

Vahid, 2026-09-16: *"give me the human-readable version to read. Not the JSON — the list of what
will be typed into which box, page by page. That is the one review that is actually mine."*
`pnpm run catalogue preview <entry.json> <profile.json>` prints it, in the student's own preview
words (ADR-0059), from the same builder and renderer the run shows at the yes; the committed
file is that output for the synthetic profile, and the test holds that they are the same. A
draft entry is planned as if reviewed and the first line says so.

Three things in the read are display, not substance, and each is a blueprint label, so fixing
one changes the entry: the yes/no radios on the nationality page show their own name beside the
value sent (their option labels were never read; the values were, P110); the two hidden selects
behind the education page's country and institution boxes are listed under *Left empty* although
the boxes set them; and a few selects carry their DOM id as a label (`dobMonth`, `startYear`).
And one sentence is the product's, not Run A's: *"This is exactly what will be submitted"* —
Run A ends at the end of Part 1 with nothing submitted (distance item 10).

## What could still change after a signature

Asked before assembling, answered plainly. Nothing in the entry is one I expect to revise. Four
things in it have never been driven on the live portal, and if any of them is wrong the fix is a
change to the entry, which means signing again:

- **The grading systems following the institution box** (draft 0.2.24): inferred from the
  dependencies read and P102's shape, not observed as a fill.
- **The two Tom Select boxes as fills**: the runner's typeahead was proved on the fixture and on
  the markup he copied (P101), never on Sheffield's page.
- **The subject search**: the word `business` produced the 87 captured results; the runner
  pressing the button and waiting on Sheffield's page is unobserved.
- **The login form's locators** (P91, from the signed-out read): the sign-in path has never run
  against the real portal. It now stops at two attempts (ADR-0120).

A smaller entry that is settled is not available: all four are on Part 1's path, and the
education page is one of its pages. Everything else — every value, the date maps, employment,
the refusals, the language section left as optional — is settled and stays as it is.
