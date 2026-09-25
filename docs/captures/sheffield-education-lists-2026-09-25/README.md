# Sheffield — the education page read in place, with an institution chosen (2026-09-25)

**Read by:** Vahid, on his own account, `--as-is`, one page:
`education.do?new=true`, with the page in the state item 4 asked for — an institution chosen in
the typeahead so the grading-system list is the one the server loaded for it, a grading system
chosen so the grade list is the loaded one, and a subject search run. Nothing saved. His commit
`1c13dbd`; this README is P214's reading of it.

**What it is evidence of, in his words:** *"The institution I chose is not mine and the values are
not mine. We are still inside Niloofar's application on my account and I am not mixing my own
details into it — the real-person run comes later, on a clean account, once the path works end to
end. So this capture is evidence of the SHAPE: that the grading list arrives per institution, what
a loaded grade list looks like, what the subject search returns. It is not evidence of which rows a
particular student needs."*

## What the read holds

`blueprint.draft.json`: one page, 34 fields as the tool counts them (his line: 52 fields, 2
forms, nothing saved — the tool's count excludes the site search and the buttons). `run.json`:
attached, read-only, no navigation refused, nothing off-host.

| Box | What arrived | Compared with the 2026-09-10 read (P132) |
|---|---|---|
| `institutionCode` (hidden select behind the typeahead) | `SHEFFIELD` — University of Sheffield | **The same institution.** The chosen institution is the one the synthetic profile holds, so this read does NOT show what another institution's lists look like. |
| `gradingSystemId` | Sheffield's four: 7 *UK Bachelors Degree (BA, BSc)*, 8 *UK Masters Degree (MA, MSc)*, 9 *UK Research Degree*, 81 *UK Medical Degree (MBBS, MBChB)*, plus *Not in list* | Identical to P132. |
| `grade` | **Five** options: *Select your grade…*, *Still waiting for grade*, *Failed to complete course*, *Pass*, *Fail* | P132's list, for system 7, had nine: the same non-grades plus *1st*, *2.1*, *2.2*, *3rd*. So this is a **different system's list** — and the read does not record which system was chosen (a select's chosen value is scrubbed with every other input value). It is one of 8, 9 or 81. |
| `subject` after the search | 87 results | Identical to P132's, for the same search word. |
| `degree` | 43 options, 41 titles | Identical to the signed entry's; the map built in P213 was derived from these. |

## What it settles, and what it does not

- **Settled: the grade list is loaded per grading system, and systems differ in kind.** One
  system carries honours classes; another carries only pass and fail. A map from a grade string to
  a value is therefore only right for one system, and the entry's `grade` map (four rows) is
  system 7's. Blocker 78.
- **Settled: Sheffield's own grading-system list is the four above, twice read.**
- **Not settled — the thing item 4 wanted measured:** what the grading-system list looks like for
  an institution that is not the University of Sheffield. P132 named the list *per institution*
  from the page's own script (`getGradingSystemsForCountry.do`); no read has yet shown a second
  institution's list, because both reads chose the same one. Blocker 77. This is said here rather
  than built around: the `gradingSystemId` map stays keyed on the level with one row, and a
  non-Sheffield qualification refuses at the plan, loudly, as before.
- **Not settled:** which system the five-option grade list belongs to. Recorded as unidentified
  rather than guessed; a future read that records the chosen value will name it.

## What in the entry is chosen to match the synthetic profile

Every education row in the signed entry that names one value names the synthetic profile's value —
chosen to match it, not read from a student. Each such mapping's note in the entry now says so in
the same words (*SYNTHETIC-PROFILE VALUE*), so whoever reads the entry at the real run knows which
rows change: the institution entry (`SHEFFIELD`), the subject search word (*business*) and subject
(*Business Management*), the grading system (`7`, from *Bachelor's degree*), the grade rows
(system 7's), the UK-study qualification (*UG DEGREE*), and the award title the fixture states
(`BSc`). None of them is his.

## P218: the rows are the whole lists now

His correction: a map row is a fact about Sheffield's form, not about a person, and a one-row map
passes for the one student who matches it. So the education maps are the whole lists on file —
system 7's grades, Sheffield's two level-named systems, the eighty-five subjects of one search, the
ten institutions of one search — keyed on the parts that decide them (a `switch` rule), and every
list not read refuses by name. The *SYNTHETIC-PROFILE VALUE* marks on those five maps are gone
with the rows they marked; the UK-study qualification map still carries one and says so.
