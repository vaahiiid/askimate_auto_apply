# The country mappings: what derives, and what you have to read

> **Generated — do not edit by hand.** `pnpm run country-mappings` rewrites it, and
> `scripts/derive-country-mappings.test.ts` holds the join. Re-run it and this page
> comes back identical, which is the point: you are checking a derivation you can
> repeat, not a list I typed.

Blocker 69. The signed entry carries **8 countries of 249**. This is what it takes to
carry the rest, split the way you asked: derive the code-valued fields, read the
disagreements on the name-valued ones.

## READ THIS FIRST — what this page does not print, and what that cost

**A zero in the column you are reading is not a zero in the columns you are not.**

On 2026-09-25, one step before the entry was signed, the maps were written and read
back. Two fields carried `CY` → `CYPRUS`.

Vahid had held `CY` on **every** field under blocker 70, because Sheffield's lists
encode a fee status the registry has no field for. The hold was not applied.
`corrCountry` and `institutionCountry` offer **both** `Cyprus` (`CYPRUS`) and `Cyprus
(European Union)` (`CYPRUS (EUROPEAN UNION)`). The strict pass matched `CYPRUS`
**exactly** and settled it as *derived* — and the reviewed decisions ran only over the
proposer's output. **A hold guarded the guesses and had nothing to say about the
matches.**

What that would have done, plainly: **every Cypriot student sent `CYPRUS`, the option
that states no fee status, chosen by a string match, on the exact question blocker 70
exists to say we cannot answer.**

This page said *proposed 0*, and that was true. `CY` was never proposed on those
fields — it was matched, and matches are the one pass this page prints as a count
rather than in full. Nothing here was wrong; it was answering a narrower question than
the one being asked of it.

Two things changed, and both are load-bearing:

- A **hold** now suppresses a strict match as well as a candidate, because a hold names
  no option and means *this code is not applied on this field*, whichever pass found
  it. A **reject** still does not, unless the match IS the option it names — a real
  *Northern Mariana Islands* option is a new fact, not the *Northern Ireland* that was
  refused.
- The table below audits every hold and every reject against the pass that reached it,
  so a hold that is stopping nothing is visible as stopping nothing.

**What is still summarised rather than printed:** the strict matches, ~205–235 rows a
field, shown as a count plus every 25th row. That was asked for — *"not 249 lines to
approve blind"* — and it remains the shape of what you are trusting rather than
reading. The defect was never the summary; it was that a decision could not reach what
the summary covered. It can now.

## How a row got where it is

| | what it means | how far to trust it |
|---|---|---|
| **derived** | the portal submits this country's ISO code, or spells its name exactly as the reviewed table does | nothing was guessed |
| **corroborated** | the portal's OWN code-valued select names this code, and that name is in this list | a fact about the portal; nothing of ours is involved |
| **proposed** | our name resembles the portal's text | a guess — this is the column to read |
| **absent** | no option carries this country under any of the portal's own names | the portal does not have it |
| **withdrawn** | two countries' proposals landed on one submitted value | never shown as a candidate |
| **accepted · held · refused** | you read it already | your words, quoted, with the date |

## What the proposer actually does

You asked for this, having read a column called UNVERIFIED without knowing how it was
produced. Here is the whole of it.

**What it compares.** Our name for the country and the portal's text for an option,
both lowercased, with punctuation — hyphens, slashes, brackets, apostrophes — folded to
spaces, then cut into words. The words `and`, `the` and `of` are dropped, because they
join names rather than being part of one.

**The bar.** A pairing is offered only when, of the words that are left, EITHER one
name's words are the opening of the other's, word for word — `iran` opens `iran islamic
republic of`, and `niger` does **not** open `nigeria`, because it is word for word and
never letter for letter — OR the two share **at least two** words, as `cocos keeling
islands` and `cocos islands` share `cocos` and `islands`. The shortest candidate wins.

**What it ignores.** Everything else. Not the continent, not the region, not what the
name means, not any list of aliases of ours. It has no idea where anywhere is.

**Why the bar is two words and not one.** It was one until you read the last version:
`MP` *Northern Mariana Islands* → *Northern Ireland*, and `TF` *French Southern
Territories* → *French West Indies*. Both came from a single word in common and nothing
else, which is why a shared leading or trailing word is no longer a resemblance.

**What stands behind it.** Two things, and they are why a bad guess here is survivable:
no option already taken by another country can be proposed at all, and any option
proposed for two countries is withdrawn from both and shown as a collision.

## Every hold and every reject, and which pass reached it

Measured by deriving each field twice — once with your decisions, once with none —
so **reached by** is what the passes actually did. `nothing` means the derivation
would have found no candidate at all there, so the ruling is stopping nothing on
that field and is belt and braces.

**applied** is what the entry now carries. A **hold** names no option, so anything
applied contradicts it. A **reject** names one, so a value is a contradiction only
when it IS that option — `MP` was refused as *Northern Ireland*, and the portal's own
*Northern Mariana Islands* option is a different fact the reject was never meant to
suppress. The first version of this table got that wrong and flagged all three `MP`
rows; the judgement is now made against what was actually ruled.

| code | country | field | verdict | reached by | would have carried | applied |  |
|---|---|---|---|---|---|---|---|
| `MP` | Northern Mariana Islands | `fundingNationality` | reject | **strict match** | `MP:O` | `MP:O` | ok |
| `MP` | Northern Mariana Islands | `countryOfBirth` | reject | **strict match** | `MP:O` | `MP:O` | ok |
| `MP` | Northern Mariana Islands | `corrCountry` | reject | nothing | — | nothing | ok |
| `MP` | Northern Mariana Islands | `permanentResidence` | reject | **strict match** | `Northern Mariana Islands:O` | `Northern Mariana Islands:O` | ok |
| `MP` | Northern Mariana Islands | `previousCountry1` | reject | nothing | — | nothing | ok |
| `MP` | Northern Mariana Islands | `institutionCountry-ts-control` | reject | nothing | — | nothing | ok |
| `TF` | French Southern Territories | `fundingNationality` | reject | nothing | — | nothing | ok |
| `TF` | French Southern Territories | `countryOfBirth` | reject | nothing | — | nothing | ok |
| `TF` | French Southern Territories | `corrCountry` | reject | nothing | — | nothing | ok |
| `TF` | French Southern Territories | `permanentResidence` | reject | nothing | — | nothing | ok |
| `TF` | French Southern Territories | `previousCountry1` | reject | nothing | — | nothing | ok |
| `TF` | French Southern Territories | `institutionCountry-ts-control` | reject | nothing | — | nothing | ok |
| `CY` | Cyprus | `fundingNationality` | hold | proposer | `XA:E` | nothing | ok |
| `CY` | Cyprus | `countryOfBirth` | hold | proposer | `XA:E` | nothing | ok |
| `CY` | Cyprus | `corrCountry` | hold | **strict match** | `CYPRUS` | nothing | ok |
| `CY` | Cyprus | `permanentResidence` | hold | proposer | `Cyprus (European Union):E` | nothing | ok |
| `CY` | Cyprus | `previousCountry1` | hold | proposer | `CyprusEU:O` | nothing | ok |
| `CY` | Cyprus | `institutionCountry-ts-control` | hold | **strict match** | `CYPRUS` | nothing | ok |
| `MF` | St. Martin | `corrCountry` | hold | proposer | `ST MARTIN (NORTH)` | nothing | ok |
| `MF` | St. Martin | `previousCountry1` | hold | proposer | `ST MARTIN (NORTH):O` | nothing | ok |
| `MF` | St. Martin | `institutionCountry-ts-control` | hold | proposer | `ST MARTIN (NORTH)` | nothing | ok |
| `UM` | U.S. Outlying Islands | `permanentResidence` | reject | nothing | — | nothing | ok |
| `MF` | St. Martin | `fundingNationality` | hold | **strict match** | `MF:O` | nothing | ok |
| `MF` | St. Martin | `countryOfBirth` | hold | **strict match** | `MF:O` | nothing | ok |

**No ruling is contradicted by what the entry carries.**

**7** of these are reached by the strict match — the pass that bypassed the decisions until P205: `MP` on `fundingNationality`, `MP` on `countryOfBirth`, `MP` on `permanentResidence`, `CY` on `corrCountry`, `CY` on `institutionCountry-ts-control`, `MF` on `fundingNationality`, `MF` on `countryOfBirth`.

## What the portal has, before a single line is read

| field | options are | offered | derived | corroborated | you decided | to read | absent | collisions |
|---|---|---|---|---|---|---|---|---|
| `fundingNationality` | ISO codes | 242 | 234 | 0 | 3 | **0** | 12 | 0 |
| `countryOfBirth` | ISO codes | 242 | 234 | 0 | 3 | **0** | 12 | 0 |
| `corrCountry` | names | 259 | 211 | 15 | 9 | **0** | 14 | 0 |
| `permanentResidence` | names | 261 | 205 | 23 | 9 | **0** | 12 | 0 |
| `previousCountry1` | names | 260 | 211 | 15 | 9 | **0** | 14 | 0 |
| `institutionCountry-ts-control` | names | 255 | 211 | 15 | 9 | **0** | 14 | 0 |

`offered` counts the portal's own list without its empty first entry. The reviewed
table holds 249 countries (ADR-0141). **to read** is the only column that asks
anything of you.

## `fundingNationality` — DERIVED

The portal submits ISO codes, so the join is the identity on a code the reviewed table
already holds: **234 of 249**, nothing guessed.

**Spot-check** — every 25th derived match, so it is the same rows every run:

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
| `AD` | Andorra | Andorra | `AD:O` |
| `BM` | Bermuda | Bermuda | `BM:H` |
| `CZ` | Czechia | Czech Republic | `CZ:E` |
| `GH` | Ghana | Ghana | `GH:O` |
| `IT` | Italy | Italy {Includes Sardinia, Sicily} | `IT:E` |
| `LV` | Latvia | Latvia | `LV:E` |
| `NE` | Niger | Niger | `NE:O` |
| `QA` | Qatar | Qatar | `QA:O` |
| `TC` | Turks & Caicos Islands | Turks and Caicos Islands | `TC:H` |
| `VN` | Vietnam | Vietnam [Viet Nam] | `VN:O` |

### Held by you (2)

Read, and deliberately not settled here.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `CY` | Cyprus | Cyprus (European Union) | HELD by Vahid on 2026-09-24 — blocker 70: "That is blocker 70 and I am not settling it here." One code, several options, and what they ask for is a distinction the registry does not hold. |
| `MF` | St. Martin | Saint Martin | HELD by Vahid on 2026-09-25 — blocker 66: The ISO-valued lists carry "Saint Martin" (MF:O) and no Sint Maarten at all; what they offer for that corner is AN:E "Netherlands Antilles", a state dissolved in 2010 and not in ISO 3166-1. "Hold MF on those two as well. Same reason as CY. Applying it there maps the French half and leaves the Dutch half of one island with nothing, on a field my hold does not name only because I did not know the pass reached it. The asymmetry is the defect; its arriving by a different route does not make it a different thing." |

### Refused by you (1)

Never offered again, whatever the proposer later thinks.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `TF` | French Southern Territories | — | REFUSED by Vahid on 2026-09-24: French Southern Territories are in the Antarctic; the French West Indies are in the Caribbean. Paired on "French". Same rule. |

### Absent (12) — the portal's list has no trace of these

Searched by the portal's own name for the code as well as by ours. A row here means
the list does not carry the country, not that the search failed.

| code | our name | why |
|---|---|---|
| `AQ` | Antarctica | no option in the portal's list carries this country under any of the portal's own names |
| `BQ` | Caribbean Netherlands | no option in the portal's list carries this country under any of the portal's own names |
| `BV` | Bouvet Island | no option in the portal's list carries this country under any of the portal's own names |
| `CW` | Curaçao | no option in the portal's list carries this country under any of the portal's own names |
| `GF` | French Guiana | no option in the portal's list carries this country under any of the portal's own names |
| `GP` | Guadeloupe | no option in the portal's list carries this country under any of the portal's own names |
| `HM` | Heard & McDonald Islands | no option in the portal's list carries this country under any of the portal's own names |
| `IO` | British Indian Ocean Territory | no option in the portal's list carries this country under any of the portal's own names |
| `MQ` | Martinique | no option in the portal's list carries this country under any of the portal's own names |
| `RE` | Réunion | no option in the portal's list carries this country under any of the portal's own names |
| `SX` | Sint Maarten | no option in the portal's list carries this country under any of the portal's own names |
| `UM` | U.S. Outlying Islands | no option in the portal's list carries this country under any of the portal's own names |

### What the portal offers that nothing claimed (5)

Read this beside the tables above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Channel Islands, not otherwise specified | `XL:H` |
| Cyprus (Non-European Union) | `XB:O` |
| Kosovo | `QO:O` |
| Netherlands Antilles {Comprises Curacao, Bonaire, Saba, St Eustatius, St Martin (South)} | `AN:E` |
| Stateless | `AA:O` |

## `countryOfBirth` — DERIVED

The portal submits ISO codes, so the join is the identity on a code the reviewed table
already holds: **234 of 249**, nothing guessed.

**Spot-check** — every 25th derived match, so it is the same rows every run:

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
| `AD` | Andorra | Andorra | `AD:O` |
| `BM` | Bermuda | Bermuda | `BM:H` |
| `CZ` | Czechia | Czech Republic | `CZ:E` |
| `GH` | Ghana | Ghana | `GH:O` |
| `IT` | Italy | Italy {Includes Sardinia, Sicily} | `IT:E` |
| `LV` | Latvia | Latvia | `LV:E` |
| `NE` | Niger | Niger | `NE:O` |
| `QA` | Qatar | Qatar | `QA:O` |
| `TC` | Turks & Caicos Islands | Turks and Caicos Islands | `TC:H` |
| `VN` | Vietnam | Vietnam [Viet Nam] | `VN:O` |

### Held by you (2)

Read, and deliberately not settled here.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `CY` | Cyprus | Cyprus (European Union) | HELD by Vahid on 2026-09-24 — blocker 70: "That is blocker 70 and I am not settling it here." One code, several options, and what they ask for is a distinction the registry does not hold. |
| `MF` | St. Martin | Saint Martin | HELD by Vahid on 2026-09-25 — blocker 66: The ISO-valued lists carry "Saint Martin" (MF:O) and no Sint Maarten at all; what they offer for that corner is AN:E "Netherlands Antilles", a state dissolved in 2010 and not in ISO 3166-1. "Hold MF on those two as well. Same reason as CY. Applying it there maps the French half and leaves the Dutch half of one island with nothing, on a field my hold does not name only because I did not know the pass reached it. The asymmetry is the defect; its arriving by a different route does not make it a different thing." |

### Refused by you (1)

Never offered again, whatever the proposer later thinks.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `TF` | French Southern Territories | — | REFUSED by Vahid on 2026-09-24: French Southern Territories are in the Antarctic; the French West Indies are in the Caribbean. Paired on "French". Same rule. |

### Absent (12) — the portal's list has no trace of these

Searched by the portal's own name for the code as well as by ours. A row here means
the list does not carry the country, not that the search failed.

| code | our name | why |
|---|---|---|
| `AQ` | Antarctica | no option in the portal's list carries this country under any of the portal's own names |
| `BQ` | Caribbean Netherlands | no option in the portal's list carries this country under any of the portal's own names |
| `BV` | Bouvet Island | no option in the portal's list carries this country under any of the portal's own names |
| `CW` | Curaçao | no option in the portal's list carries this country under any of the portal's own names |
| `GF` | French Guiana | no option in the portal's list carries this country under any of the portal's own names |
| `GP` | Guadeloupe | no option in the portal's list carries this country under any of the portal's own names |
| `HM` | Heard & McDonald Islands | no option in the portal's list carries this country under any of the portal's own names |
| `IO` | British Indian Ocean Territory | no option in the portal's list carries this country under any of the portal's own names |
| `MQ` | Martinique | no option in the portal's list carries this country under any of the portal's own names |
| `RE` | Réunion | no option in the portal's list carries this country under any of the portal's own names |
| `SX` | Sint Maarten | no option in the portal's list carries this country under any of the portal's own names |
| `UM` | U.S. Outlying Islands | no option in the portal's list carries this country under any of the portal's own names |

### What the portal offers that nothing claimed (5)

Read this beside the tables above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Channel Islands, not otherwise specified | `XL:H` |
| Cyprus (Non-European Union) | `XB:O` |
| Kosovo | `QO:O` |
| Netherlands Antilles {Comprises Curacao, Bonaire, Saba, St Eustatius, St Martin (South)} | `AN:E` |
| Stateless | `AA:O` |

## `corrCountry` — NEEDS YOUR READING

The portal submits names, so the join is a comparison between two authorities that
disagree. **211 of 249** matched exactly, **15** more were settled from the
portal's own code list, and **0** are guesses you have to read.

**Spot-check** — every 25th derived match, so it is the same rows every run:

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
| `AD` | Andorra | Andorra | `ANDORRA` |
| `BR` | Brazil | Brazil | `BRAZIL` |
| `EG` | Egypt | Egypt | `EGYPT` |
| `GU` | Guam | Guam | `GUAM` |
| `KP` | North Korea | North Korea | `NORTH KOREA` |
| `MR` | Mauritania | Mauritania | `MAURITANIA` |
| `PG` | Papua New Guinea | Papua New Guinea | `PAPUA NEW GUINEA` |
| `SN` | Senegal | Senegal | `SENEGAL` |
| `VA` | Vatican City | Vatican City | `VATICAN CITY` |

### Withdrawn — one option, two countries

**None.** The rule ran and found no submitted value proposed for two countries.

### Corroborated by the portal itself (15) — read if you want to, not because you must

The portal's own code-valued select names this code, and that name is in this list.
No name of ours took part.

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
| `BF` | Burkina Faso | Burkina-Faso | `BURKINA-FASO` |
| `CD` | Congo - Kinshasa | Congo (Democratic Republic) | `CONGO (DEMOCRATIC REPUBLIC)` |
| `CG` | Congo - Brazzaville | Congo | `CONGO` |
| `CZ` | Czechia | Czech Republic | `CZECH REPUBLIC` |
| `FM` | Micronesia | Micronesia, (Federated States of) | `MICRONESIA, (FEDERATED STATES OF)` |
| `HK` | Hong Kong SAR China | Hong Kong (Special Administrative Region) | `HONG KONG` |
| `IM` | Isle of Man | Isle of Man (The) | `ISLE OF MAN (THE)` |
| `MM` | Myanmar (Burma) | Myanmar (Burma) [The Republic of the Union of Myanmar] | `MYANMAR` |
| `MO` | Macao SAR China | Macao (Special Administrative Region) | `MACAO` |
| `PS` | Palestinian Territories | Palestine | `PALESTINE` |
| `ST` | São Tomé & Príncipe | Sao Tome & Principe | `SAO TOME & PRINCIPE` |
| `TL` | Timor-Leste | East Timor | `EAST TIMOR` |
| `TR` | Türkiye | Turkey | `TURKEY` |
| `VC` | St. Vincent & Grenadines | St Vincent & the Grenadines | `ST VINCENT & THE GRENADINES` |
| `YE` | Yemen | Yemen (Republic of) | `YEMEN (REPUBLIC OF)` |

### Accepted by you (5)

Your reading, kept so the page does not ask again.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `CC` | Cocos (Keeling) Islands | Cocos Islands | ACCEPTED by Vahid on 2026-09-24: The same place under a different name. |
| `CV` | Cape Verde | Cape Verde Islands | ACCEPTED by Vahid on 2026-09-24: The same place under a different name. |
| `GS` | South Georgia & South Sandwich Islands | South Georgia & the South Sandwich Is | ACCEPTED by Vahid on 2026-09-24: The same place under the portal's own abbreviation. |
| `KN` | St. Kitts & Nevis | St Kitts Nevis | ACCEPTED by Vahid on 2026-09-24: Same country; the portal drops the "and". |
| `VI` | U.S. Virgin Islands | Virgin Is (US) | ACCEPTED by Vahid on 2026-09-24: Same territory, abbreviated. |

### Held by you (2)

Read, and deliberately not settled here.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `CY` | Cyprus | Cyprus | HELD by Vahid on 2026-09-24 — blocker 70: "That is blocker 70 and I am not settling it here." One code, several options, and what they ask for is a distinction the registry does not hold. |
| `MF` | St. Martin | St Martin (North) | HELD by Vahid on 2026-09-24 — blocker 66: This list carries only "St Martin (North)" and no Sint Maarten at all, so MF is proposed here and SX has nowhere to go. "That is a real student with no honest option, which is blocker 66's case arriving. Do not apply MF on those three until 66 has a shape." |

### Refused by you (2)

Never offered again, whatever the proposer later thinks.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `MP` | Northern Mariana Islands | — | REFUSED by Vahid on 2026-09-24: Northern Mariana Islands is in the Pacific; Northern Ireland is in the UK. Paired on the word "Northern". A student from Saipan would have had Northern Ireland on their application, and on this portal that carries a fee-status marker. |
| `TF` | French Southern Territories | — | REFUSED by Vahid on 2026-09-24: French Southern Territories are in the Antarctic; the French West Indies are in the Caribbean. Paired on "French". Same rule. |

### Absent (14) — the portal's list has no trace of these

Searched by the portal's own name for the code as well as by ours. A row here means
the list does not carry the country, not that the search failed.

| code | our name | why |
|---|---|---|
| `AQ` | Antarctica | no option in the portal's list carries this country under any of the portal's own names |
| `AX` | Åland Islands | no option in the portal's list carries this country under any of the portal's own names |
| `BL` | St. Barthélemy | no option in the portal's list carries this country under any of the portal's own names |
| `BQ` | Caribbean Netherlands | no option in the portal's list carries this country under any of the portal's own names |
| `BV` | Bouvet Island | no option in the portal's list carries this country under any of the portal's own names |
| `CI` | Côte d’Ivoire | no option in the portal's list carries this country under any of the portal's own names |
| `CW` | Curaçao | no option in the portal's list carries this country under any of the portal's own names |
| `HM` | Heard & McDonald Islands | no option in the portal's list carries this country under any of the portal's own names |
| `MK` | North Macedonia | no option in the portal's list carries this country under any of the portal's own names |
| `RE` | Réunion | no option in the portal's list carries this country under any of the portal's own names |
| `SH` | St. Helena | no option in the portal's list carries this country under any of the portal's own names |
| `SJ` | Svalbard & Jan Mayen | no option in the portal's list carries this country under any of the portal's own names |
| `SX` | Sint Maarten | no option in the portal's list carries this country under any of the portal's own names |
| `UM` | U.S. Outlying Islands | no option in the portal's list carries this country under any of the portal's own names |

### What the portal offers that nothing claimed (26)

Read this beside the tables above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Azores | `AZORES` |
| Balearic Islands | `BALEARIC ISLANDS` |
| Canary Islands | `CANARY ISLANDS` |
| Ceuta | `CEUTA` |
| Channel Islands (The) | `CHANNEL ISLANDS (THE)` |
| Cote d'Ivorie | `COTE D'IVORIE` |
| Crete | `CRETE` |
| Cyprus (European Union) | `CYPRUS (EUROPEAN UNION)` |
| Dubai | `DUBAI` |
| England | `ENGLAND` |
| Guinea (Equatorial) | `GUINEA (EQUATORIAL)` |
| Holy See | `HOLY SEE` |
| Java | `JAVA` |
| Kosovo | `KOSOVO` |
| Macedonia | `MACEDONIA` |
| Madeira | `MADEIRA` |
| Melilla | `MELILLA` |
| Netherlands Antilles | `NETHERLANDS ANTILLES` |
| Northern Ireland | `NORTHERN IRELAND` |
| Not Known | `NOT KNOWN` |
| Reunion | `REUNION` |
| Scotland | `SCOTLAND` |
| St Martin (South) | `ST MARTIN (SOUTH)` |
| Stateless | `STATELESS` |
| Virgin Is (British) | `VIRGIN IS (BRITISH)` |
| Wales | `WALES` |

## `permanentResidence` — NEEDS YOUR READING

The portal submits names, so the join is a comparison between two authorities that
disagree. **205 of 249** matched exactly, **23** more were settled from the
portal's own code list, and **0** are guesses you have to read.

**Spot-check** — every 25th derived match, so it is the same rows every run:

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
| `AD` | Andorra | Andorra | `Andorra:O` |
| `BR` | Brazil | Brazil | `Brazil:O` |
| `EC` | Ecuador | Ecuador | `Ecuador:O` |
| `GT` | Guatemala | Guatemala | `Guatemala:O` |
| `KY` | Cayman Islands | Cayman Islands | `Cayman Islands:H` |
| `MT` | Malta | Malta | `Malta:E` |
| `PK` | Pakistan | Pakistan | `Pakistan:O` |
| `SR` | Suriname | Suriname | `Suriname:O` |
| `YE` | Yemen | Yemen | `Yemen:O` |

### Withdrawn — one option, two countries

**None.** The rule ran and found no submitted value proposed for two countries.

### Corroborated by the portal itself (23) — read if you want to, not because you must

The portal's own code-valued select names this code, and that name is in this list.
No name of ours took part.

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
| `BN` | Brunei | Brunei Darussalam | `Brunei Darussalam:O` |
| `CD` | Congo - Kinshasa | Congo (Democratic Republic) | `Congo (Democratic Republic):O` |
| `CG` | Congo - Brazzaville | Congo | `Congo:O` |
| `CI` | Côte d’Ivoire | Ivory Coast (Cote d'Ivoire) | `Ivory Coast (Cote d'Ivoire):O` |
| `CZ` | Czechia | Czech Republic | `Czech Republic:E` |
| `FK` | Falkland Islands | Falkland Islands (Malvinas) | `Falkland Islands (Malvinas):O` |
| `FM` | Micronesia | Micronesia, Federated States of | `Micronesia, Federated States of:O` |
| `HK` | Hong Kong SAR China | Hong Kong | `Hong Kong:O` |
| `IR` | Iran | Iran, Islamic Republic of | `Iran, Islamic Republic of:O` |
| `KP` | North Korea | Korea, Democratic People's Republic of | `Korea, Democratic People's Republic of:O` |
| `KR` | South Korea | Korea, Republic of | `Korea, Republic of:O` |
| `MM` | Myanmar (Burma) | Burma (Myanmar) | `Burma (Myanmar):O` |
| `MO` | Macao SAR China | Macao | `Macao:O` |
| `PS` | Palestinian Territories | Palestine | `Palestine:O` |
| `RU` | Russia | Russian Federation | `Russian Federation:O` |
| `SH` | St. Helena | St Helena, Ascension & Tristan da Cunha | `St Helena, Ascension & Tristan da Cunha:O` |
| `ST` | São Tomé & Príncipe | Sao Tome and Principe | `Sao Tome and Principe:O` |
| `SY` | Syria | Syrian Arab Republic (Syria) | `Syrian Arab Republic (Syria):O` |
| `TL` | Timor-Leste | East Timor (Timor-Leste) | `East Timor (Timor-Leste):O` |
| `TR` | Türkiye | Turkey | `Turkey:O` |
| `TZ` | Tanzania | Tanzania, United Republic of | `Tanzania, United Republic of:O` |
| `VA` | Vatican City | Holy See (Vatican City State) | `Holy See (Vatican City State):O` |
| `VE` | Venezuela | Venezuela (Bolivarian Republic of) | `Venezuela (Bolivarian Republic of):O` |

### Accepted by you (6)

Your reading, kept so the page does not ask again.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `KN` | St. Kitts & Nevis | St. Kitts-Nevis | ACCEPTED by Vahid on 2026-09-24: Same country; this list hyphenates it instead. |
| `MF` | St. Martin | St Martin (French part) | ACCEPTED by Vahid on 2026-09-24: One island, two halves, two codes, correctly split: MF is the French part and SX the Dutch. |
| `SX` | Sint Maarten | Sint Maarten (Dutch Part) | ACCEPTED by Vahid on 2026-09-24: The Dutch half of the same island, and the portal splits it the way the codes do. |
| `US` | United States | United States of America | ACCEPTED by Vahid on 2026-09-24: The same place under a different name. |
| `VC` | St. Vincent & Grenadines | Saint Vincent and the Grenadines | ACCEPTED by Vahid on 2026-09-24: Same country, written out in full. |
| `VI` | U.S. Virgin Islands | Virgin Islands (US) | ACCEPTED by Vahid on 2026-09-24: Same territory. "That settles the UM/VI collision: the option says US, and the US Virgin Islands are VI." |

### Held by you (1)

Read, and deliberately not settled here.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `CY` | Cyprus | Cyprus (European Union) | HELD by Vahid on 2026-09-24 — blocker 70: "That is blocker 70 and I am not settling it here." One code, several options, and what they ask for is a distinction the registry does not hold. |

### Refused by you (2)

Never offered again, whatever the proposer later thinks.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `TF` | French Southern Territories | — | REFUSED by Vahid on 2026-09-24: French Southern Territories are in the Antarctic; the French West Indies are in the Caribbean. Paired on "French". Same rule. |
| `UM` | U.S. Outlying Islands | — | REFUSED by Vahid on 2026-09-24: "UM is the Minor Outlying Islands and is not that option — leave UM unproposed rather than finding it something." |

### Absent (12) — the portal's list has no trace of these

Searched by the portal's own name for the code as well as by ours. A row here means
the list does not carry the country, not that the search failed.

| code | our name | why |
|---|---|---|
| `AQ` | Antarctica | no option in the portal's list carries this country under any of the portal's own names |
| `AX` | Åland Islands | no option in the portal's list carries this country under any of the portal's own names |
| `BL` | St. Barthélemy | no option in the portal's list carries this country under any of the portal's own names |
| `BQ` | Caribbean Netherlands | no option in the portal's list carries this country under any of the portal's own names |
| `BV` | Bouvet Island | no option in the portal's list carries this country under any of the portal's own names |
| `CW` | Curaçao | no option in the portal's list carries this country under any of the portal's own names |
| `GG` | Guernsey | no option in the portal's list carries this country under any of the portal's own names |
| `HM` | Heard & McDonald Islands | no option in the portal's list carries this country under any of the portal's own names |
| `IM` | Isle of Man | no option in the portal's list carries this country under any of the portal's own names |
| `JE` | Jersey | no option in the portal's list carries this country under any of the portal's own names |
| `LA` | Laos | no option in the portal's list carries this country under any of the portal's own names |
| `RE` | Réunion | no option in the portal's list carries this country under any of the portal's own names |

### What the portal offers that nothing claimed (24)

Read this beside the tables above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Aland Islands | `Aland Islands:O` |
| Bonaire, Sint Eustatius and Saba | `Bonaire, Sint Eustatius and Saba:O` |
| British Antarctic Territory | `British Antarctic Territory:H` |
| Canary Islands | `Canary Islands:O` |
| Curacao | `Curacao:O` |
| Cyprus (Non-European Union) | `Cyprus (Non-European Union):O` |
| Cyprus (Not otherwise specified) | `Cyprus (Not otherwise specified):O` |
| French West Indies | `French West Indies:E` |
| Kosovo | `Kosovo:O` |
| Lao PDR | `Lao PDR:O` |
| Leeward Islands | `Leeward Islands:O` |
| Malaya | `Malaya:O` |
| Netherlands Antilles | `Netherlands Antilles:E` |
| Portuguese West Africa | `Portuguese West Africa:O` |
| Reunion | `Reunion:O` |
| Sabah | `Sabah:O` |
| Sarawak | `Sarawak:O` |
| Sikkim | `Sikkim:O` |
| St Barthelemy | `St Barthelemy:O` |
| Stateless | `Stateless:O` |
| Tibet | `Tibet:O` |
| Vietnam [Viet Nam] | `Vietnam [Viet Nam]:O` |
| West Indies | `West Indies:O` |
| Windward Islands | `Windward Islands:O` |

## `previousCountry1` — NEEDS YOUR READING

The portal submits names, so the join is a comparison between two authorities that
disagree. **211 of 249** matched exactly, **15** more were settled from the
portal's own code list, and **0** are guesses you have to read.

**Spot-check** — every 25th derived match, so it is the same rows every run:

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
| `AD` | Andorra | Andorra | `ANDORRA:O` |
| `BR` | Brazil | Brazil | `BRAZIL:O` |
| `EG` | Egypt | Egypt | `EGYPT:O` |
| `GU` | Guam | Guam | `GUAM:O` |
| `KP` | North Korea | North Korea | `NORTH KOREA:O` |
| `MR` | Mauritania | Mauritania | `MAURITANIA:O` |
| `PG` | Papua New Guinea | Papua New Guinea | `PAPUA NEW GUINEA:O` |
| `SN` | Senegal | Senegal | `SENEGAL:O` |
| `VA` | Vatican City | Vatican City | `VATICAN CITY:O` |

### Withdrawn — one option, two countries

**None.** The rule ran and found no submitted value proposed for two countries.

### Corroborated by the portal itself (15) — read if you want to, not because you must

The portal's own code-valued select names this code, and that name is in this list.
No name of ours took part.

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
| `BF` | Burkina Faso | Burkina-Faso | `BURKINA-FASO:O` |
| `CD` | Congo - Kinshasa | Congo (Democratic Republic) | `CONGO (DEMOCRATIC REPUBLIC):O` |
| `CG` | Congo - Brazzaville | Congo | `CONGO:O` |
| `CZ` | Czechia | Czech Republic | `CZECH REPUBLIC:E` |
| `FM` | Micronesia | Micronesia, (Federated States of) | `MICRONESIA, (FEDERATED STATES OF):O` |
| `HK` | Hong Kong SAR China | Hong Kong (Special Administrative Region) | `HONG KONG:O` |
| `IM` | Isle of Man | Isle of Man (The) | `ISLE OF MAN (THE):H` |
| `MM` | Myanmar (Burma) | Myanmar (Burma) [The Republic of the Union of Myanmar] | `MYANMAR:O` |
| `MO` | Macao SAR China | Macao (Special Administrative Region) | `MACAO:O` |
| `PS` | Palestinian Territories | Palestine | `PALESTINE:O` |
| `ST` | São Tomé & Príncipe | Sao Tome & Principe | `SAO TOME & PRINCIPE:O` |
| `TL` | Timor-Leste | East Timor | `EAST TIMOR:O` |
| `TR` | Türkiye | Turkey | `TURKEY:O` |
| `VC` | St. Vincent & Grenadines | St Vincent & the Grenadines | `ST VINCENT & THE GRENADINES:O` |
| `YE` | Yemen | Yemen (Republic of) | `YEMEN (REPUBLIC OF):O` |

### Accepted by you (5)

Your reading, kept so the page does not ask again.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `CC` | Cocos (Keeling) Islands | Cocos Islands | ACCEPTED by Vahid on 2026-09-24: The same place under a different name. |
| `CV` | Cape Verde | Cape Verde Islands | ACCEPTED by Vahid on 2026-09-24: The same place under a different name. |
| `GS` | South Georgia & South Sandwich Islands | South Georgia & the South Sandwich Is | ACCEPTED by Vahid on 2026-09-24: The same place under the portal's own abbreviation. |
| `KN` | St. Kitts & Nevis | St Kitts Nevis | ACCEPTED by Vahid on 2026-09-24: Same country; the portal drops the "and". |
| `VI` | U.S. Virgin Islands | Virgin Is (US) | ACCEPTED by Vahid on 2026-09-24: Same territory, abbreviated. |

### Held by you (2)

Read, and deliberately not settled here.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `CY` | Cyprus | Cyprus (European Union) | HELD by Vahid on 2026-09-24 — blocker 70: "That is blocker 70 and I am not settling it here." One code, several options, and what they ask for is a distinction the registry does not hold. |
| `MF` | St. Martin | St Martin (North) | HELD by Vahid on 2026-09-24 — blocker 66: As corrCountry: "St Martin (North)" with no Sint Maarten, so SX has nowhere to go. |

### Refused by you (2)

Never offered again, whatever the proposer later thinks.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `MP` | Northern Mariana Islands | — | REFUSED by Vahid on 2026-09-24: Northern Mariana Islands is in the Pacific; Northern Ireland is in the UK. Paired on the word "Northern". A student from Saipan would have had Northern Ireland on their application, and on this portal that carries a fee-status marker. |
| `TF` | French Southern Territories | — | REFUSED by Vahid on 2026-09-24: French Southern Territories are in the Antarctic; the French West Indies are in the Caribbean. Paired on "French". Same rule. |

### Absent (14) — the portal's list has no trace of these

Searched by the portal's own name for the code as well as by ours. A row here means
the list does not carry the country, not that the search failed.

| code | our name | why |
|---|---|---|
| `AQ` | Antarctica | no option in the portal's list carries this country under any of the portal's own names |
| `AX` | Åland Islands | no option in the portal's list carries this country under any of the portal's own names |
| `BL` | St. Barthélemy | no option in the portal's list carries this country under any of the portal's own names |
| `BQ` | Caribbean Netherlands | no option in the portal's list carries this country under any of the portal's own names |
| `BV` | Bouvet Island | no option in the portal's list carries this country under any of the portal's own names |
| `CI` | Côte d’Ivoire | no option in the portal's list carries this country under any of the portal's own names |
| `CW` | Curaçao | no option in the portal's list carries this country under any of the portal's own names |
| `HM` | Heard & McDonald Islands | no option in the portal's list carries this country under any of the portal's own names |
| `MK` | North Macedonia | no option in the portal's list carries this country under any of the portal's own names |
| `RE` | Réunion | no option in the portal's list carries this country under any of the portal's own names |
| `SH` | St. Helena | no option in the portal's list carries this country under any of the portal's own names |
| `SJ` | Svalbard & Jan Mayen | no option in the portal's list carries this country under any of the portal's own names |
| `SX` | Sint Maarten | no option in the portal's list carries this country under any of the portal's own names |
| `UM` | U.S. Outlying Islands | no option in the portal's list carries this country under any of the portal's own names |

### What the portal offers that nothing claimed (27)

Read this beside the tables above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Azores | `AZORES:O` |
| Balearic Islands | `BALEARIC ISLANDS:O` |
| Canary Islands | `CANARY ISLANDS:O` |
| Ceuta | `CEUTA:O` |
| Channel Islands (The) | `CHANNEL ISLANDS (THE):H` |
| Cote d'Ivorie | `COTE D'IVORIE:O` |
| Crete | `CRETE:O` |
| Cyprus (Non-European Union) | `CyprusNonEU:O` |
| Cyprus (European Union) | `CYPRUS (EUROPEAN UNION):E` |
| Dubai | `DUBAI:O` |
| England | `ENGLAND:H` |
| Guinea (Equatorial) | `GUINEA (EQUATORIAL):O` |
| Holy See | `HOLY SEE:O` |
| Java | `JAVA:O` |
| Kosovo | `KOSOVO:O` |
| Macedonia | `MACEDONIA:O` |
| Madeira | `MADEIRA:O` |
| Melilla | `MELILLA:O` |
| Netherlands Antilles | `NETHERLANDS ANTILLES:E` |
| Northern Ireland | `NORTHERN IRELAND:H` |
| Not Known | `NOT KNOWN:O` |
| Reunion | `REUNION:O` |
| Scotland | `SCOTLAND:H` |
| St Martin (South) | `ST MARTIN (SOUTH):O` |
| Stateless | `STATELESS:O` |
| Virgin Is (British) | `VIRGIN IS (BRITISH):H` |
| Wales | `WALES:H` |

## `institutionCountry-ts-control` — NEEDS YOUR READING

The portal submits names, so the join is a comparison between two authorities that
disagree. **211 of 249** matched exactly, **15** more were settled from the
portal's own code list, and **0** are guesses you have to read.

**Spot-check** — every 25th derived match, so it is the same rows every run:

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
| `AD` | Andorra | Andorra | `ANDORRA` |
| `BR` | Brazil | Brazil | `BRAZIL` |
| `EG` | Egypt | Egypt | `EGYPT` |
| `GU` | Guam | Guam | `GUAM` |
| `KP` | North Korea | North Korea | `NORTH KOREA` |
| `MR` | Mauritania | Mauritania | `MAURITANIA` |
| `PG` | Papua New Guinea | Papua New Guinea | `PAPUA NEW GUINEA` |
| `SN` | Senegal | Senegal | `SENEGAL` |
| `VA` | Vatican City | Vatican City | `VATICAN CITY` |

### Withdrawn — one option, two countries

**None.** The rule ran and found no submitted value proposed for two countries.

### Corroborated by the portal itself (15) — read if you want to, not because you must

The portal's own code-valued select names this code, and that name is in this list.
No name of ours took part.

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
| `BF` | Burkina Faso | Burkina-Faso | `BURKINA-FASO` |
| `CD` | Congo - Kinshasa | Congo (Democratic Republic) | `CONGO (DEMOCRATIC REPUBLIC)` |
| `CG` | Congo - Brazzaville | Congo | `CONGO` |
| `CZ` | Czechia | Czech Republic | `CZECH REPUBLIC` |
| `FM` | Micronesia | Micronesia, (Federated States of) | `MICRONESIA, (FEDERATED STATES OF)` |
| `HK` | Hong Kong SAR China | Hong Kong (Special Administrative Region) | `HONG KONG` |
| `IM` | Isle of Man | Isle of Man (The) | `ISLE OF MAN (THE)` |
| `MM` | Myanmar (Burma) | Myanmar (Burma) [The Republic of the Union of Myanmar] | `MYANMAR` |
| `MO` | Macao SAR China | Macao (Special Administrative Region) | `MACAO` |
| `PS` | Palestinian Territories | Palestine | `PALESTINE` |
| `ST` | São Tomé & Príncipe | Sao Tome & Principe | `SAO TOME & PRINCIPE` |
| `TL` | Timor-Leste | East Timor | `EAST TIMOR` |
| `TR` | Türkiye | Turkey | `TURKEY` |
| `VC` | St. Vincent & Grenadines | St Vincent & the Grenadines | `ST VINCENT & THE GRENADINES` |
| `YE` | Yemen | Yemen (Republic of) | `YEMEN (REPUBLIC OF)` |

### Accepted by you (5)

Your reading, kept so the page does not ask again.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `CC` | Cocos (Keeling) Islands | Cocos Islands | ACCEPTED by Vahid on 2026-09-24: The same place under a different name. |
| `CV` | Cape Verde | Cape Verde Islands | ACCEPTED by Vahid on 2026-09-24: The same place under a different name. |
| `GS` | South Georgia & South Sandwich Islands | South Georgia & the South Sandwich Is | ACCEPTED by Vahid on 2026-09-24: The same place under the portal's own abbreviation. |
| `KN` | St. Kitts & Nevis | St Kitts Nevis | ACCEPTED by Vahid on 2026-09-24: Same country; the portal drops the "and". |
| `VI` | U.S. Virgin Islands | Virgin Is (US) | ACCEPTED by Vahid on 2026-09-24: Same territory, abbreviated. |

### Held by you (2)

Read, and deliberately not settled here.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `CY` | Cyprus | Cyprus | HELD by Vahid on 2026-09-24 — blocker 70: "That is blocker 70 and I am not settling it here." One code, several options, and what they ask for is a distinction the registry does not hold. |
| `MF` | St. Martin | St Martin (North) | HELD by Vahid on 2026-09-24 — blocker 66: As corrCountry: "St Martin (North)" with no Sint Maarten, so SX has nowhere to go. |

### Refused by you (2)

Never offered again, whatever the proposer later thinks.

| code | our name | the portal's option text | what you said |
|---|---|---|---|
| `MP` | Northern Mariana Islands | — | REFUSED by Vahid on 2026-09-24: Northern Mariana Islands is in the Pacific; Northern Ireland is in the UK. Paired on the word "Northern". A student from Saipan would have had Northern Ireland on their application, and on this portal that carries a fee-status marker. |
| `TF` | French Southern Territories | — | REFUSED by Vahid on 2026-09-24: French Southern Territories are in the Antarctic; the French West Indies are in the Caribbean. Paired on "French". Same rule. |

### Absent (14) — the portal's list has no trace of these

Searched by the portal's own name for the code as well as by ours. A row here means
the list does not carry the country, not that the search failed.

| code | our name | why |
|---|---|---|
| `AQ` | Antarctica | no option in the portal's list carries this country under any of the portal's own names |
| `AX` | Åland Islands | no option in the portal's list carries this country under any of the portal's own names |
| `BL` | St. Barthélemy | no option in the portal's list carries this country under any of the portal's own names |
| `BQ` | Caribbean Netherlands | no option in the portal's list carries this country under any of the portal's own names |
| `BV` | Bouvet Island | no option in the portal's list carries this country under any of the portal's own names |
| `CI` | Côte d’Ivoire | no option in the portal's list carries this country under any of the portal's own names |
| `CW` | Curaçao | no option in the portal's list carries this country under any of the portal's own names |
| `HM` | Heard & McDonald Islands | no option in the portal's list carries this country under any of the portal's own names |
| `MK` | North Macedonia | no option in the portal's list carries this country under any of the portal's own names |
| `RE` | Réunion | no option in the portal's list carries this country under any of the portal's own names |
| `SH` | St. Helena | no option in the portal's list carries this country under any of the portal's own names |
| `SJ` | Svalbard & Jan Mayen | no option in the portal's list carries this country under any of the portal's own names |
| `SX` | Sint Maarten | no option in the portal's list carries this country under any of the portal's own names |
| `UM` | U.S. Outlying Islands | no option in the portal's list carries this country under any of the portal's own names |

### What the portal offers that nothing claimed (22)

Read this beside the tables above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Azores | `AZORES` |
| Balearic Islands | `BALEARIC ISLANDS` |
| Canary Islands | `CANARY ISLANDS` |
| Ceuta | `CEUTA` |
| Channel Islands (The) | `CHANNEL ISLANDS (THE)` |
| Cote d'Ivorie | `COTE D'IVORIE` |
| Crete | `CRETE` |
| Cyprus (European Union) | `CYPRUS (EUROPEAN UNION)` |
| Dubai | `DUBAI` |
| Guinea (Equatorial) | `GUINEA (EQUATORIAL)` |
| Holy See | `HOLY SEE` |
| Java | `JAVA` |
| Kosovo | `KOSOVO` |
| Macedonia | `MACEDONIA` |
| Madeira | `MADEIRA` |
| Melilla | `MELILLA` |
| Netherlands Antilles | `NETHERLANDS ANTILLES` |
| Not Known | `NOT KNOWN` |
| Reunion | `REUNION` |
| St Martin (South) | `ST MARTIN (SOUTH)` |
| Stateless | `STATELESS` |
| Virgin Is (British) | `VIRGIN IS (BRITISH)` |

## What happens after you sign

The option maps go into the entry, which moves its content hash — that is the
signature you offered to spend. The derived and corroborated fields are then held by
`scripts/derive-country-mappings.test.ts`, which re-derives them and fails if the entry
and the derivation ever disagree. What you read is held by your reading, recorded here.
