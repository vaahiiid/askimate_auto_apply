# Decision sheet — distance item 3: what the nationality page asks that the registry does not hold

**For:** Vahid · **Prepared:** 2026-09-15 · **Answerable in one sitting, in parts.** Item 3 of
[`distance-to-a-reviewed-sheffield-run.md`](./distance-to-a-reviewed-sheffield-run.md): *"Iman's
mapping for what the registry reaches; a product decision for what it does not."* This sheet is the
second half. It follows the shape of items 2 and 5 (ADR-0111, ADR-0112): what the profile collects
is yours.

> **What the page asks, by what the registry holds.** Seventy-two fields on `nationality.do`,
> read on 2026-09-14 (three reads; the fifty markers and the thirteen unread questions are in the
> review pack). Grouped here by whether a registry field can answer them at all.

## Reached today — Iman's mapping, no decision needed

| Page asks | Registry holds | Note |
|---|---|---|
| `fundingNationality` | `identity.nationality` | a partial option map onto the portal's names, as the country map on contact |
| `countryOfBirth` | `identity.country_of_birth` | the same |
| `passportNumber` (starred) | `identity.passport_number` | text, verbatim |
| `secondFundingNationality` | — | optional on the page; unmapped is honest |

## Not reached — four groups, each a decision

### 1 · Where the student lives, and has lived

`permanentResidence`, `ukPermanentResidence`, `livingInUK` (starred), `livedOutsideCountry`
(starred), `alwaysUKResident` (starred), `alwaysEUResident` (starred), `dateEnteredUK` (three
selects), the four `previousCountry` blocks with from/to dates (twenty-eight selects),
`applicationLocation` (inside/outside the UK).

The registry has a home address (`contact.address`, with a country) and nothing about residence
over time. **Options:** (A) a residence group — the country of permanent residence, whether the
student is in the UK now, the date they entered it if so, and a residence history as a list of
`{ country, from, to }` in month-and-year, the shape of ADR-0111's and 0112's dates; (B) the
starred yes/no questions answered from the home address's country by rule (in the UK now ⇔
address in the UK) and the history left to the student as a handoff. **The catch with B:** an
address is where mail goes, not where a person has lived for three years, and the page's own
words ask about the last three years; answering a residence question from a postal address is
the quiet inference the system refuses.

### 2 · UK immigration status claims

`britishPassport`, `indefinateVisa`, `refugeeStatus`, `migrantWorker`, `spouseOfUKCitizen`,
`euPassport`, `spouseOfEUCitizen` — seven starred yes/no questions — and the five document slots
they open (off an international student's path, P112).

The registry holds `identity.passport_issuing_country` and two immigration lists (previous UK
visas, previous refusals), none of which says whether a student holds refugee status or is
married to a UK citizen. **Options:** (A) a status group of explicit yes/no facts the student
states — the registry's shape for an answer that is a claim, never derived; (B) `britishPassport`
and `euPassport` derived from the passport's issuing country by rule, the other five asked;
(C) all seven as `student_handoff`. **Note for the decision:** the review pack classifies these as
ordinary with a judgement flag on refugee status; nothing here is Article 9, but the answers
decide the document slots that open, so a wrong "yes" opens an upload the student must then
refuse or fill.

### 3 · Study in the UK before

`previousStudentVisa` (starred), `qualificationLevel` (starred), the five `highestQualification`
selects and `highestQualificationOther` (starred), `yearsOnStudentVisa`, `monthsOnStudentVisa`,
`visaExpiry` (three selects).

The registry holds `immigration.previous_uk_visas` as a list of strings, and qualifications with
institutions and countries (ADR-0112). **Options:** (A) `previousStudentVisa` answered *yes* when
a qualification's country is the UK — a derivation from a fact the student stated; then the
level and time on the visa asked as new parts of the immigration group; (B) the whole block
asked as explicit facts; (C) handed to the student. **Note:** the page shows most of this only
after *yes*, so for a student with no UK study the block is one question.

### 4 · The passport, when there is none

`passportNumber` is starred and its row says it is required *"in order to comply with UK
immigration law"*; Vahid's console read recorded an instruction on what to enter without a
passport, not carried into any file (P124). The registry requires a passport number for every
student. **Question:** does the profile hold "no passport" as a stated fact, and what does the
mapping type then? Not answerable until the instruction's words are read off the page.

## What I would choose, and why

Group 1 as (A) and group 2 as (A): both are facts about the student that every UK form asks in
some shape, and both are claims only the student can make — the same argument as items 2 and 5,
and the same shape (a list in month-and-year for the history). Group 3 as (A): the derivation is
from a stated fact, not an inference, and the rest asked. Group 4 waits on the words.

## What it needs from you

One answer per group, in your words. Groups 1–3 shape a registry change each (mine, proposed
before building, as before); group 4 needs your read of the row's instruction. Nothing is built
until then.
