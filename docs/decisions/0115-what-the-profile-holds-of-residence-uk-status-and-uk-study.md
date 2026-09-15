# ADR-0115 — The profile holds a student's residence over time, their UK status claims, and their previous UK study, each as facts the student states

**Status:** Accepted · 2026-09-15 · decides distance item 3's second half (three of its four groups) · continues 0111, 0112 (the shapes of a month-and-year and an explicit end) and 0113 (asked, not inferred)
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-15, from
[`decision-sheet-item-3-…md`](../decision-sheet-item-3-what-the-registry-does-not-hold-of-a-student-residence-and-status.md). The three shapes below are **proposed and not yet confirmed**; nothing is built until he confirms them. Group 4 (the passport when there is none) waits on his read of the row's words.

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

## The three shapes — PROPOSED, awaiting his confirmation

All three follow ADR-0111 and 0112: a month-and-year where a form asks one, an explicit kind
where absence would otherwise be read as a claim, and nothing derived from a postal address or a
passport's issuer.

### 1 · `residence` — where the student lives, and has lived

| Field | Type | Sheffield asks | Note |
|---|---|---|---|
| `residence.country` | country code, required | `permanentResidence`, `ukPermanentResidence` | the country of permanent residence — a statement, not the address's country |
| `residence.in_uk_now` | boolean, required | `livingInUK` (starred), `applicationLocation` | asked, never read off the history |
| `residence.uk_entry_date` | `Date`, optional | `dateEnteredUK` (day, month, year) | the page asks a day, so a full date; absent claims nothing — the boxes are left empty |
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

### What the build touches, when confirmed

- `packages/profile`: three groups, their categories (ordinary), labels, persistence.
- `packages/domain`: the `derived` origin on a proposal, naming its source field.
- Set 0.3.23: the nationality page's mappings from the three groups — the country selects
  through partial option maps onto the portal's names, the yes/no radios onto the page's
  lower-case `yes` / `no` (P110), the dates as selects, the history's first four periods to the
  four blocks. Iman's sitting for items 3 and 4 follows.
