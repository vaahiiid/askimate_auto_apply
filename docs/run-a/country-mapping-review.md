# The country mappings: what derives, and what you have to read

> **Generated — do not edit by hand.** `pnpm run country-mappings` rewrites it, and
> `scripts/derive-country-mappings.test.ts` holds the join. Re-run it and this page
> comes back identical, which is the point: you are checking a derivation you can
> repeat, not a list I typed.

Blocker 69. The signed entry carries **8 countries of 249**. This is what it takes to
carry the rest, split the way you asked: derive the code-valued fields, read the
disagreements on the name-valued ones.

## How a row got where it is

| | what it means | how far to trust it |
|---|---|---|
| **derived** | the portal submits this country's ISO code, or spells its name exactly as the reviewed table does | nothing was guessed |
| **corroborated** | the portal's OWN code-valued select names this code, and that name is in this list | a fact about the portal; nothing of ours is involved |
| **proposed** | our name resembles the portal's text | a guess — this is the column to read |
| **absent** | no option carries this country under any of the portal's own names | the portal does not have it |
| **withdrawn** | two countries' proposals landed on one submitted value | never shown as a candidate |

## What the portal has, before a single line is read

| field | options are | offered | derived | corroborated | to read | absent | collisions |
|---|---|---|---|---|---|---|---|
| `fundingNationality` | ISO codes | 242 | 235 | 0 | **1** | 13 | 0 |
| `countryOfBirth` | ISO codes | 242 | 235 | 0 | **1** | 13 | 0 |
| `corrCountry` | names | 259 | 212 | 14 | **5** | 18 | 0 |
| `permanentResidence` | names | 261 | 205 | 22 | **5** | 17 | 0 |
| `previousCountry1` | names | 260 | 211 | 14 | **6** | 18 | 0 |
| `institutionCountry-ts-control` | names | 255 | 212 | 14 | **4** | 19 | 0 |

`offered` counts the portal's own list without its empty first entry. The reviewed
table holds 249 countries (ADR-0141). **to read** is the only column that asks
anything of you.

## `fundingNationality` — DERIVED

The portal submits ISO codes, so the join is the identity on a code the reviewed table
already holds: **235 of 249**, nothing guessed.

**Spot-check** — every 25th derived match, so it is the same rows every run:

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
| `AD` | Andorra | Andorra | `AD:O` |
| `BM` | Bermuda | Bermuda | `BM:H` |
| `CZ` | Czechia | Czech Republic | `CZ:E` |
| `GH` | Ghana | Ghana | `GH:O` |
| `IT` | Italy | Italy {Includes Sardinia, Sicily} | `IT:E` |
| `LV` | Latvia | Latvia | `LV:E` |
| `NC` | New Caledonia | New Caledonia | `NC:E` |
| `PY` | Paraguay | Paraguay | `PY:O` |
| `SZ` | Eswatini | Eswatini | `SZ:O` |
| `VI` | U.S. Virgin Islands | United States Virgin Islands [Virgin Islands, U. S.] | `VI:O` |

### To read (1) — a guess from our name against the portal's text

This is the column that needs you. Nothing acts on it until you say so.

| code | our name | proposed option text (UNVERIFIED) | submitted value |
|---|---|---|---|
| `CY` | Cyprus | Cyprus (European Union) | `XA:E` |

### Absent (13) — the portal's list has no trace of these

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
| `TF` | French Southern Territories | no option in the portal's list carries this country under any of the portal's own names |
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
already holds: **235 of 249**, nothing guessed.

**Spot-check** — every 25th derived match, so it is the same rows every run:

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
| `AD` | Andorra | Andorra | `AD:O` |
| `BM` | Bermuda | Bermuda | `BM:H` |
| `CZ` | Czechia | Czech Republic | `CZ:E` |
| `GH` | Ghana | Ghana | `GH:O` |
| `IT` | Italy | Italy {Includes Sardinia, Sicily} | `IT:E` |
| `LV` | Latvia | Latvia | `LV:E` |
| `NC` | New Caledonia | New Caledonia | `NC:E` |
| `PY` | Paraguay | Paraguay | `PY:O` |
| `SZ` | Eswatini | Eswatini | `SZ:O` |
| `VI` | U.S. Virgin Islands | United States Virgin Islands [Virgin Islands, U. S.] | `VI:O` |

### To read (1) — a guess from our name against the portal's text

This is the column that needs you. Nothing acts on it until you say so.

| code | our name | proposed option text (UNVERIFIED) | submitted value |
|---|---|---|---|
| `CY` | Cyprus | Cyprus (European Union) | `XA:E` |

### Absent (13) — the portal's list has no trace of these

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
| `TF` | French Southern Territories | no option in the portal's list carries this country under any of the portal's own names |
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
disagree. **212 of 249** matched exactly, **14** more were settled from the
portal's own code list, and **5** are guesses you have to read.

**Spot-check** — every 25th derived match, so it is the same rows every run:

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
| `AD` | Andorra | Andorra | `ANDORRA` |
| `BR` | Brazil | Brazil | `BRAZIL` |
| `EE` | Estonia | Estonia | `ESTONIA` |
| `GT` | Guatemala | Guatemala | `GUATEMALA` |
| `KM` | Comoros | Comoros | `COMOROS` |
| `MQ` | Martinique | Martinique | `MARTINIQUE` |
| `PF` | French Polynesia | French Polynesia | `FRENCH POLYNESIA` |
| `SM` | San Marino | San Marino | `SAN MARINO` |
| `UZ` | Uzbekistan | Uzbekistan | `UZBEKISTAN` |

### Withdrawn — one option, two countries

**None.** The rule ran and found no submitted value proposed for two countries.

### Corroborated by the portal itself (14) — read if you want to, not because you must

The portal's own code-valued select names this code, and that name is in this list.
No name of ours took part.

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
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

### To read (5) — a guess from our name against the portal's text

This is the column that needs you. Nothing acts on it until you say so.

| code | our name | proposed option text (UNVERIFIED) | submitted value |
|---|---|---|---|
| `CC` | Cocos (Keeling) Islands | Cocos Islands | `COCOS ISLANDS` |
| `CV` | Cape Verde | Cape Verde Islands | `CAPE VERDE ISLANDS` |
| `GS` | South Georgia & South Sandwich Islands | South Georgia & the South Sandwich Is | `SOUTH GEORGIA & THE SOUTH SANDWICH IS` |
| `MF` | St. Martin | St Martin (North) | `ST MARTIN (NORTH)` |
| `MP` | Northern Mariana Islands | Northern Ireland | `NORTHERN IRELAND` |

### Absent (18) — the portal's list has no trace of these

Searched by the portal's own name for the code as well as by ours. A row here means
the list does not carry the country, not that the search failed.

| code | our name | why |
|---|---|---|
| `AQ` | Antarctica | no option in the portal's list carries this country under any of the portal's own names |
| `AX` | Åland Islands | no option in the portal's list carries this country under any of the portal's own names |
| `BF` | Burkina Faso | no option in the portal's list carries this country under any of the portal's own names |
| `BL` | St. Barthélemy | no option in the portal's list carries this country under any of the portal's own names |
| `BQ` | Caribbean Netherlands | no option in the portal's list carries this country under any of the portal's own names |
| `BV` | Bouvet Island | no option in the portal's list carries this country under any of the portal's own names |
| `CI` | Côte d’Ivoire | no option in the portal's list carries this country under any of the portal's own names |
| `CW` | Curaçao | no option in the portal's list carries this country under any of the portal's own names |
| `HM` | Heard & McDonald Islands | no option in the portal's list carries this country under any of the portal's own names |
| `KN` | St. Kitts & Nevis | no option in the portal's list carries this country under any of the portal's own names |
| `MK` | North Macedonia | no option in the portal's list carries this country under any of the portal's own names |
| `RE` | Réunion | no option in the portal's list carries this country under any of the portal's own names |
| `SH` | St. Helena | no option in the portal's list carries this country under any of the portal's own names |
| `SJ` | Svalbard & Jan Mayen | no option in the portal's list carries this country under any of the portal's own names |
| `SX` | Sint Maarten | no option in the portal's list carries this country under any of the portal's own names |
| `TF` | French Southern Territories | no option in the portal's list carries this country under any of the portal's own names |
| `UM` | U.S. Outlying Islands | no option in the portal's list carries this country under any of the portal's own names |
| `VI` | U.S. Virgin Islands | no option in the portal's list carries this country under any of the portal's own names |

### What the portal offers that nothing claimed (28)

Read this beside the tables above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Azores | `AZORES` |
| Balearic Islands | `BALEARIC ISLANDS` |
| Burkina-Faso | `BURKINA-FASO` |
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
| Not Known | `NOT KNOWN` |
| Reunion | `REUNION` |
| Scotland | `SCOTLAND` |
| St Kitts Nevis | `ST KITTS NEVIS` |
| St Martin (South) | `ST MARTIN (SOUTH)` |
| Stateless | `STATELESS` |
| Virgin Is (British) | `VIRGIN IS (BRITISH)` |
| Virgin Is (US) | `VIRGIN IS (US)` |
| Wales | `WALES` |

## `permanentResidence` — NEEDS YOUR READING

The portal submits names, so the join is a comparison between two authorities that
disagree. **205 of 249** matched exactly, **22** more were settled from the
portal's own code list, and **5** are guesses you have to read.

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

### Corroborated by the portal itself (22) — read if you want to, not because you must

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
| `VE` | Venezuela | Venezuela (Bolivarian Republic of) | `Venezuela (Bolivarian Republic of):O` |

### To read (5) — a guess from our name against the portal's text

This is the column that needs you. Nothing acts on it until you say so.

| code | our name | proposed option text (UNVERIFIED) | submitted value |
|---|---|---|---|
| `CY` | Cyprus | Cyprus (European Union) | `Cyprus (European Union):E` |
| `MF` | St. Martin | St Martin (French part) | `St Martin (French part):O` |
| `SX` | Sint Maarten | Sint Maarten (Dutch Part) | `Sint Maarten (Dutch Part):O` |
| `TF` | French Southern Territories | French West Indies | `French West Indies:E` |
| `US` | United States | United States of America | `United States of America:O` |

### Absent (17) — the portal's list has no trace of these

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
| `KN` | St. Kitts & Nevis | no option in the portal's list carries this country under any of the portal's own names |
| `LA` | Laos | no option in the portal's list carries this country under any of the portal's own names |
| `RE` | Réunion | no option in the portal's list carries this country under any of the portal's own names |
| `UM` | U.S. Outlying Islands | no option in the portal's list carries this country under any of the portal's own names |
| `VA` | Vatican City | no option in the portal's list carries this country under any of the portal's own names |
| `VC` | St. Vincent & Grenadines | no option in the portal's list carries this country under any of the portal's own names |
| `VI` | U.S. Virgin Islands | no option in the portal's list carries this country under any of the portal's own names |

### What the portal offers that nothing claimed (27)

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
| Holy See (Vatican City State) | `Holy See (Vatican City State):O` |
| Kosovo | `Kosovo:O` |
| Lao PDR | `Lao PDR:O` |
| Leeward Islands | `Leeward Islands:O` |
| Malaya | `Malaya:O` |
| Netherlands Antilles | `Netherlands Antilles:E` |
| Portuguese West Africa | `Portuguese West Africa:O` |
| Reunion | `Reunion:O` |
| Sabah | `Sabah:O` |
| Saint Vincent and the Grenadines | `Saint Vincent and the Grenadines:O` |
| Sarawak | `Sarawak:O` |
| Sikkim | `Sikkim:O` |
| St Barthelemy | `St Barthelemy:O` |
| St. Kitts-Nevis | `St. Kitts-Nevis:O` |
| Stateless | `Stateless:O` |
| Tibet | `Tibet:O` |
| Vietnam [Viet Nam] | `Vietnam [Viet Nam]:O` |
| Virgin Islands (US) | `Virgin Islands (US):O` |
| West Indies | `West Indies:O` |
| Windward Islands | `Windward Islands:O` |

## `previousCountry1` — NEEDS YOUR READING

The portal submits names, so the join is a comparison between two authorities that
disagree. **211 of 249** matched exactly, **14** more were settled from the
portal's own code list, and **6** are guesses you have to read.

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

### Corroborated by the portal itself (14) — read if you want to, not because you must

The portal's own code-valued select names this code, and that name is in this list.
No name of ours took part.

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
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

### To read (6) — a guess from our name against the portal's text

This is the column that needs you. Nothing acts on it until you say so.

| code | our name | proposed option text (UNVERIFIED) | submitted value |
|---|---|---|---|
| `CC` | Cocos (Keeling) Islands | Cocos Islands | `COCOS ISLANDS:O` |
| `CV` | Cape Verde | Cape Verde Islands | `CAPE VERDE ISLANDS:O` |
| `CY` | Cyprus | Cyprus (European Union) | `CyprusEU:O` |
| `GS` | South Georgia & South Sandwich Islands | South Georgia & the South Sandwich Is | `SOUTH GEORGIA & THE SOUTH SANDWICH IS:H` |
| `MF` | St. Martin | St Martin (North) | `ST MARTIN (NORTH):O` |
| `MP` | Northern Mariana Islands | Northern Ireland | `NORTHERN IRELAND:H` |

### Absent (18) — the portal's list has no trace of these

Searched by the portal's own name for the code as well as by ours. A row here means
the list does not carry the country, not that the search failed.

| code | our name | why |
|---|---|---|
| `AQ` | Antarctica | no option in the portal's list carries this country under any of the portal's own names |
| `AX` | Åland Islands | no option in the portal's list carries this country under any of the portal's own names |
| `BF` | Burkina Faso | no option in the portal's list carries this country under any of the portal's own names |
| `BL` | St. Barthélemy | no option in the portal's list carries this country under any of the portal's own names |
| `BQ` | Caribbean Netherlands | no option in the portal's list carries this country under any of the portal's own names |
| `BV` | Bouvet Island | no option in the portal's list carries this country under any of the portal's own names |
| `CI` | Côte d’Ivoire | no option in the portal's list carries this country under any of the portal's own names |
| `CW` | Curaçao | no option in the portal's list carries this country under any of the portal's own names |
| `HM` | Heard & McDonald Islands | no option in the portal's list carries this country under any of the portal's own names |
| `KN` | St. Kitts & Nevis | no option in the portal's list carries this country under any of the portal's own names |
| `MK` | North Macedonia | no option in the portal's list carries this country under any of the portal's own names |
| `RE` | Réunion | no option in the portal's list carries this country under any of the portal's own names |
| `SH` | St. Helena | no option in the portal's list carries this country under any of the portal's own names |
| `SJ` | Svalbard & Jan Mayen | no option in the portal's list carries this country under any of the portal's own names |
| `SX` | Sint Maarten | no option in the portal's list carries this country under any of the portal's own names |
| `TF` | French Southern Territories | no option in the portal's list carries this country under any of the portal's own names |
| `UM` | U.S. Outlying Islands | no option in the portal's list carries this country under any of the portal's own names |
| `VI` | U.S. Virgin Islands | no option in the portal's list carries this country under any of the portal's own names |

### What the portal offers that nothing claimed (29)

Read this beside the tables above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Azores | `AZORES:O` |
| Balearic Islands | `BALEARIC ISLANDS:O` |
| Burkina-Faso | `BURKINA-FASO:O` |
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
| Not Known | `NOT KNOWN:O` |
| Reunion | `REUNION:O` |
| Scotland | `SCOTLAND:H` |
| St Kitts Nevis | `ST KITTS NEVIS:O` |
| St Martin (South) | `ST MARTIN (SOUTH):O` |
| Stateless | `STATELESS:O` |
| Virgin Is (British) | `VIRGIN IS (BRITISH):H` |
| Virgin Is (US) | `VIRGIN IS (US):O` |
| Wales | `WALES:H` |

## `institutionCountry-ts-control` — NEEDS YOUR READING

The portal submits names, so the join is a comparison between two authorities that
disagree. **212 of 249** matched exactly, **14** more were settled from the
portal's own code list, and **4** are guesses you have to read.

**Spot-check** — every 25th derived match, so it is the same rows every run:

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
| `AD` | Andorra | Andorra | `ANDORRA` |
| `BR` | Brazil | Brazil | `BRAZIL` |
| `EE` | Estonia | Estonia | `ESTONIA` |
| `GT` | Guatemala | Guatemala | `GUATEMALA` |
| `KM` | Comoros | Comoros | `COMOROS` |
| `MQ` | Martinique | Martinique | `MARTINIQUE` |
| `PF` | French Polynesia | French Polynesia | `FRENCH POLYNESIA` |
| `SM` | San Marino | San Marino | `SAN MARINO` |
| `UZ` | Uzbekistan | Uzbekistan | `UZBEKISTAN` |

### Withdrawn — one option, two countries

**None.** The rule ran and found no submitted value proposed for two countries.

### Corroborated by the portal itself (14) — read if you want to, not because you must

The portal's own code-valued select names this code, and that name is in this list.
No name of ours took part.

| code | our name | the portal's option text | submitted value |
|---|---|---|---|
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

### To read (4) — a guess from our name against the portal's text

This is the column that needs you. Nothing acts on it until you say so.

| code | our name | proposed option text (UNVERIFIED) | submitted value |
|---|---|---|---|
| `CC` | Cocos (Keeling) Islands | Cocos Islands | `COCOS ISLANDS` |
| `CV` | Cape Verde | Cape Verde Islands | `CAPE VERDE ISLANDS` |
| `GS` | South Georgia & South Sandwich Islands | South Georgia & the South Sandwich Is | `SOUTH GEORGIA & THE SOUTH SANDWICH IS` |
| `MF` | St. Martin | St Martin (North) | `ST MARTIN (NORTH)` |

### Absent (19) — the portal's list has no trace of these

Searched by the portal's own name for the code as well as by ours. A row here means
the list does not carry the country, not that the search failed.

| code | our name | why |
|---|---|---|
| `AQ` | Antarctica | no option in the portal's list carries this country under any of the portal's own names |
| `AX` | Åland Islands | no option in the portal's list carries this country under any of the portal's own names |
| `BF` | Burkina Faso | no option in the portal's list carries this country under any of the portal's own names |
| `BL` | St. Barthélemy | no option in the portal's list carries this country under any of the portal's own names |
| `BQ` | Caribbean Netherlands | no option in the portal's list carries this country under any of the portal's own names |
| `BV` | Bouvet Island | no option in the portal's list carries this country under any of the portal's own names |
| `CI` | Côte d’Ivoire | no option in the portal's list carries this country under any of the portal's own names |
| `CW` | Curaçao | no option in the portal's list carries this country under any of the portal's own names |
| `HM` | Heard & McDonald Islands | no option in the portal's list carries this country under any of the portal's own names |
| `KN` | St. Kitts & Nevis | no option in the portal's list carries this country under any of the portal's own names |
| `MK` | North Macedonia | no option in the portal's list carries this country under any of the portal's own names |
| `MP` | Northern Mariana Islands | no option in the portal's list carries this country under any of the portal's own names |
| `RE` | Réunion | no option in the portal's list carries this country under any of the portal's own names |
| `SH` | St. Helena | no option in the portal's list carries this country under any of the portal's own names |
| `SJ` | Svalbard & Jan Mayen | no option in the portal's list carries this country under any of the portal's own names |
| `SX` | Sint Maarten | no option in the portal's list carries this country under any of the portal's own names |
| `TF` | French Southern Territories | no option in the portal's list carries this country under any of the portal's own names |
| `UM` | U.S. Outlying Islands | no option in the portal's list carries this country under any of the portal's own names |
| `VI` | U.S. Virgin Islands | no option in the portal's list carries this country under any of the portal's own names |

### What the portal offers that nothing claimed (25)

Read this beside the tables above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Azores | `AZORES` |
| Balearic Islands | `BALEARIC ISLANDS` |
| Burkina-Faso | `BURKINA-FASO` |
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
| St Kitts Nevis | `ST KITTS NEVIS` |
| St Martin (South) | `ST MARTIN (SOUTH)` |
| Stateless | `STATELESS` |
| Virgin Is (British) | `VIRGIN IS (BRITISH)` |
| Virgin Is (US) | `VIRGIN IS (US)` |

## What happens after you sign

The option maps go into the entry, which moves its content hash — that is the
signature you offered to spend. The derived and corroborated fields are then held by
`scripts/derive-country-mappings.test.ts`, which re-derives them and fails if the entry
and the derivation ever disagree. What you read is held by your reading, recorded here.
