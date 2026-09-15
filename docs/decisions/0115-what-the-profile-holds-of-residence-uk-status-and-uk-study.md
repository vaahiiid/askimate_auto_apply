# ADR-0115 — The profile holds a student's residence over time, their UK status claims, and their previous UK study, each as facts the student states

**Status:** Accepted · 2026-09-15 · decides distance item 3's second half (three of its four groups) · continues 0111, 0112 (the shapes of a month-and-year and an explicit end) and 0113 (asked, not inferred)
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-15, from
[`decision-sheet-item-3-…md`](../decision-sheet-item-3-what-the-registry-does-not-hold-of-a-student-residence-and-status.md). The three shapes below were proposed 2026-09-15 and **confirmed by him the same day with one change** (the entry date as month and year — see *Confirmed* below); **built in P139**. Group 4 (the passport when there is none) waits on his read of the row's words.

## Decision

In his words, group by group:

> **Group 1, residence:** *"A. Your argument is the one that decides it and I want it in the ADR:
> an address is where mail goes, not where a person has lived, and the page asks about the last
> three years. Answering a residence question from a postal address is exactly the quiet
> inference this system exists not to make. Residence history as a list of country, from, to in
> month and year, the same shape as the other two."*
>
> **Group 2, immigration status:** *"A, all seven asked, none derived. And I am rejecting B for a
> reason your sheet did not name. A passport's issuing country does not establish citizenship.
> Someone can hold a passport issued by a country they are no longer a citizen of, hold two, or
> hold a British passport issued while abroad. But the real reason is the consequence you did
> name: a wrong yes opens a document slot the student must then refuse or fill. So a derivation
> that is right most of the time produces, for the student it is wrong about, an upload request
> for a document they do not have and cannot get. Seven questions is a cheap price for never
> doing that."*
>
> **Group 3, previous UK study:** *"A, with one condition. Deriving previousStudentVisa from a
> qualification's country being the UK is a derivation from a stated fact and I accept it — but a
> UK qualification does not imply a student visa. A British citizen who did their degree here, or
> an EU student before 2021, has a UK qualification and never held one. So derive it as a
> proposal the student confirms, not as an answer. If that is not expressible today, ask it
> outright and drop the derivation."*
>
> **Group 4, the passport instruction:** *"I will read the row and bring you its words."*

## Confirmed — 2026-09-15, with one change and two reasons

In his words:

> *"The three shapes: confirmed, with one change."*
>
> *"The change. residence.uk_entry_date should be month and year, not a full date, and the day
> the page asks for is the mapping's problem rather than the profile's."*
>
> *"Sheffield asks a day because it asks a day, not because anyone knows it. A student who came
> to the UK in September 2019 knows the month; most do not know the date, and the ones who do
> are reading it off a visa stamp. Holding a Date means the profile carries a day that in
> almost every case will be invented at the point of asking — which is the thing we have
> refused everywhere else."*
>
> *"If the portal insists on a day, that is a value we do not hold and it asks the student, the
> same as any unavailable value. One extra question for the students who reach that page beats
> a fabricated day for all of them."*
>
> *"Everything else stands as proposed. Two things I want to say why on, since a later phase may
> want to undo them."*
>
> *"The three starred yes/no questions asked rather than computed from the history. Computing
> 'always lived in the UK' from a residence history means a student who gave three periods
> gets a 'no' that is really 'the list I typed does not say otherwise'. The history is what
> they remembered; the answer is what they claim. Those are different, and only one of them is
> signed at the bottom of an application."*
>
> *"And the seven status claims each mapping to its own radio with nothing derived. That is
> already decided but the reason belongs in ADR-0115 too, not only in ADR-0114: a wrong yes
> opens a document slot the student must refuse or fill."*

So `residence.uk_entry_date` is a `YearMonth`; every day select on the page is unmapped by
decision, and a portal that insists on a day asks the student for it as any unavailable value.

## The three shapes — as proposed, and confirmed above

All three follow ADR-0111 and 0112: a month-and-year where a form asks one, an explicit kind
where absence would otherwise be read as a claim, and nothing derived from a postal address or a
passport's issuer.

### 1 · `residence` — where the student lives, and has lived

| Field | Type | Sheffield asks | Note |
|---|---|---|---|
| `residence.country` | country code, required | `permanentResidence`, `ukPermanentResidence` | the country of permanent residence — a statement, not the address's country |
| `residence.in_uk_now` | boolean, required | `livingInUK` (starred), `applicationLocation` | asked, never read off the history |
| `residence.uk_entry_date` | ~~`Date`~~ **`YearMonth`** (his change) | `dateEnteredUK` (month, year; the day unmapped) | a month and a year, never a day; the day the page asks for is the mapping's problem, asked of the student as any unavailable value |
| `residence.history` | list of `{ countryCode; from: YearMonth; to: { kind: "ended"; date: YearMonth } \| { kind: "current" } }`, required, may be confirmed empty | the four `previousCountry` blocks with from/to dates | one entry per period; a current period is the student's statement; the page's four blocks take the first four |

The three starred yes/no questions — *always lived in the UK*, *always lived in the EU*, *lived
outside this country in the last three years* — are **asked, not computed from the history**: a
history is as complete as the student made it, and a "no" computed from an incomplete one is the
inference he refused. They are three booleans on the group: `residence.always_in_uk`,
`residence.always_in_eu`, `residence.outside_uk_last_three_years`. If he would rather these were
proposed from the history for confirmation (group 3's pattern), the same mechanism serves; the
proposal here is to ask.

### 2 · `immigration.uk_status` — seven claims, all asked

One field holding seven booleans the student states: `british_passport`, `indefinite_leave`,
`refugee_status`, `migrant_worker`, `spouse_of_uk_citizen`, `eu_passport`,
`spouse_of_eu_citizen`. None is derived from `identity.passport_issuing_country`, by his word.
Each maps to its radio through `part` and an `option` onto the page's `yes` / `no`. The review
pack's judgement flag on refugee status stands; the category is ordinary.

### 3 · `immigration.uk_study` — previous study in the UK

| Field | Type | Sheffield asks |
|---|---|---|
| `immigration.uk_study` | `{ kind: "none" } \| { kind: "studied"; onStudentVisa: boolean; highestLevel: string; qualification?: string; timeOnVisa?: { years: number; months: number }; currentVisaExpiry?: Date }` | `previousStudentVisa`, `qualificationLevel`, the five `highestQualification` selects and `…Other`, `yearsOnStudentVisa` / `months…`, `visaExpiry` |

**His condition, and whether it is expressible today.** The derivation — *studied in the UK*
proposed when a qualification's country is the UK — is a **proposal the student confirms**, never
an answer. The domain already holds the shape: a `ProposedValue` with an origin, confirmed by the
student into a `ConfirmedValue` (ADR-0007), and every profile value enters that way. What does not
exist is an origin for "derived from another confirmed field", nor a step in the interview that
raises such a proposal; the interview's coverage is Run B's (ADR-0113). So the derivation is
expressible as a proposal — a new origin, `derived`, naming the field it came from — and until the
interview raises it, the field is asked outright, which is his fallback. The build carries the
origin; the question is asked; the proposal is the interview's when the interview is built.

### Built — P139, 2026-09-15

- `packages/profile`: `ResidencePeriod`, `UkStatusClaims`, `UkStudyLevel`, `UkStudy`; the nine
  fields (`residence.country`, `residence.in_uk_now`, `residence.uk_entry_date` as `YearMonth`,
  `residence.history` list-valued, the three asked booleans, `immigration.uk_status`,
  `immigration.uk_study`), ordinary, labelled; persistence round-trips a current period and a
  study whose visa expiry comes back as a `Date`.
- `packages/domain`: the `derived` origin on a proposal, which must name `derivedFrom` — and only
  a derived proposal may. The interview does not raise it yet (Run B, ADR-0113); the field is
  asked outright, his fallback.
- Set 0.3.23: thirty-six mappings on the nationality page from the three groups — the residence
  selects and radios; the entry date's month and year; the four previous-country blocks from the
  first four periods of the history, empty beyond what the student listed and the to-date empty
  for a current period; the seven status radios; `previousStudentVisa` from the study's kind. The
  country maps are partial (eight countries) for the reviewer to extend. Proved on a synthetic
  profile in `scripts/sheffield-draft.test.ts`: no day is typed anywhere.
- **Deliberately unmapped, and why:** every day select (the profile holds no day);
  `ukPermanentResidence` (a UK region the registry does not hold, off an international
  student's path); the UK-study block the page shows after *yes* — `qualificationLevel`, the five
  per-level selects, `highestQualificationOther`, the years and months on the visa, the visa
  expiry — because the draft has no show/hide for it and mapping a hidden select types into a
  box the page does not show. Its show/hide is read off the page's own script from his
  committed `nationality.do` markup, as P112 read `showHideDocumentUploads`, before those
  mappings are written. Those required fields remain `no_mapping` blockers until then.
- **One consequence to be aware of, not decided here.** A mapped field with no confirmed value
  blocks a fill, required on the page or not — a mapped box with no value is a value the student
  has not given, and the registry has no "optional field", only optional *parts* of a value.
  So a student who has never entered the UK has no entry date to confirm, and the entry-date
  boxes block unless the page hides them for a student outside the UK. Whether it does is in
  the same script read. If the page shows the date to everyone, the field needs a stated
  "never entered" kind beside the date, as a job's end has "current" — his call, when the read
  says which.

### Two more of his decisions on this page — 2026-09-15, after the markup read (P140/P141)

**The three-year window: the interview asks, the mapping does not select.** Sheffield's four
previous-country blocks are headed *"Please list the countries you have lived in over the last 3
years"*. In his words:

> *"Most recent first, and the mapping types the first four as it does now. A format rule that
> could sort and window periods by date is a rule that decides which of a student's answers reach
> the form, and that decision belongs where a person can see it, not inside a mapping."*
>
> *"But say plainly in the record what that means: a student with five periods in three years
> has one dropped, and nothing tells them. If the interview asks for the last three years and
> the page takes four, the fifth is lost silently. That is not acceptable and I am not solving
> it now — raise it as its own item rather than letting the decision above bury it."*

So `residence.history` is asked most recent first, the mapping stays as built, and the dropped
fifth period is **blocker 29** in the state document, open.

**The two script-filled spans.** The page's *"outside of `this country`"* and *"always lived in
the `UK`"* are spans `nationality.js` fills; if with the permanent-residence country, two fields
here ask a different question from the one their names record. In his words:

> *"That is not a naming problem, it is asking a different question and recording the answer to
> ours. Do not rename anything until the script says what the spans hold. If it turns out to be
> the residence country, both fields and their interview questions change, and I would rather
> that happened once, from the script, than twice."*

Nothing is renamed; the read of `nationality.js` decides.

### Read off `nationality.js` — P142, 2026-09-15

He committed the script (`docs/captures/sheffield-pgt-2026-09-15-passport-row/nationality.js`).
It decides every section of the page from three things: the nationality's suffix (`:H` the UK
and its territories, `:E` the EU, `:O` overseas, `:Q` read as `:E`; the better of the first and
second nationality, H over E over O), the permanent residence's suffix, and the answer to
*"living outside … in the last 3 years"*.

- **The two spans.** *"…outside of `this country`…"* becomes *"the UK"* when the permanent
  residence is the United Kingdom and **the permanent-residence country's name otherwise**;
  *"always lived in the `UK`"* becomes the permanent-residence country's name, and the question
  is shown only to a resident of the UK or its territories. So both fields were asking about the
  country of permanent residence, not the UK. **Renamed once, from the script**, as he asked:
  `residence.always_in_uk` → `residence.always_in_residence_country`;
  `residence.outside_uk_last_three_years` → `residence.outside_residence_country_last_three_years`,
  with their labels; the mappings to `alwaysUKResident` and `livedOutsideCountry` unchanged.
- **The entry date** is shown only to a non-UK national resident in the UK or its territories who
  has not lived outside it in three years and has not always lived there. The P139 note is
  resolved by the page: a student who never entered the UK is never shown the boxes, so
  `residence.uk_entry_date` needs no "never" kind.
- **The seven claims** are asked only of a non-UK national resident in the UK (the five) or in the
  EU (the two). A resident abroad is shown none of them.
- **The passport** is asked of every non-UK national. **The previous-country blocks** open after
  *yes* to living outside; **the living-in-the-UK question** is shown then too, and otherwise the
  script answers it itself from the permanent residence. **The UK-study block** is shown to a
  non-UK national (and, in the script, to anyone resident in the EU or overseas), its details
  after *yes*, one qualification select per chosen level.

The draft (0.2.22) carries the page as twelve sections with these rules as `visibleWhen`, so a
mapped field the page hides is neither typed nor missing. Two things the blueprint's condition
language cannot say are recorded rather than approximated silently: a condition names ONE
controlling field, so the "better of two nationalities" reads the first nationality only (the
second is unmapped), and the study block's OR over nationality and residence is written on the
nationality alone — a UK national living abroad is not covered. Set 0.3.25 maps the study block
from `immigration.uk_study`; the five per-level qualification selects stay unmapped, because they
want the student's qualification in the portal's own list — blocker 25's shape, flagged.

### What the build touched

- `packages/profile`: three groups, their categories (ordinary), labels, persistence.
- `packages/domain`: the `derived` origin on a proposal, naming its source field.
- Set 0.3.23: the nationality page's mappings from the three groups — the country selects
  through partial option maps onto the portal's names, the yes/no radios onto the page's
  lower-case `yes` / `no` (P110), the dates as selects, the history's first four periods to the
  four blocks. Iman's sitting for items 3 and 4 follows.
