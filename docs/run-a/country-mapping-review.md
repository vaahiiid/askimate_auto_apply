# The country mappings: what derives, and what you have to read

> **Generated — do not edit by hand.** `pnpm run country-mappings` rewrites it, and
> `scripts/derive-country-mappings.test.ts` holds the join. Re-run it and this page
> comes back identical, which is the point: you are checking a derivation you can
> repeat, not a list I typed.

Blocker 69. The signed entry carries **8 countries of 249**. This is what it takes to
carry the rest, split the way you asked: derive the code-valued fields, read the
disagreements on the name-valued ones.

## What the portal has, before a single line is read

| field | options are | offered | strict join matches | to read | portal options nothing claimed |
|---|---|---|---|---|---|
| `fundingNationality` | ISO codes | 242 | 235 / 249 | 14 | 6 |
| `countryOfBirth` | ISO codes | 242 | 235 / 249 | 14 | 6 |
| `corrCountry` | names | 259 | 212 / 249 | 37 | 47 |
| `permanentResidence` | names | 261 | 205 / 249 | 44 | 54 |
| `previousCountry1` | names | 260 | 211 / 249 | 38 | 49 |
| `institutionCountry-ts-control` | names | 255 | 212 / 249 | 37 | 43 |

`offered` counts the portal's own list without its empty first entry. The reviewed
table holds 249 countries (ADR-0141), so `249 − matched` is what is left to settle,
and the last column is what the portal has that we do not.

## `fundingNationality` — DERIVED

The portal submits ISO codes, so the join is the identity on a code the reviewed table
already holds: **235 of 249**, nothing guessed. The 14 it does not carry are below —
they are absences in the portal's list, not disagreements about a name.

**Spot-check** — every 25th match, so it is the same rows every run:

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

**The 14 the join could not settle.** The candidate column is a PROPOSAL and
nothing acts on it until you say so; a blank one means nothing in the portal's list
resembled our name at all.

| code | our name | proposed option text (UNVERIFIED) | submitted value |
|---|---|---|---|
| `AQ` | Antarctica | — nothing resembles it — | — |
| `BQ` | Caribbean Netherlands | — nothing resembles it — | — |
| `BV` | Bouvet Island | — nothing resembles it — | — |
| `CW` | Curaçao | — nothing resembles it — | — |
| `CY` | Cyprus | Cyprus (European Union) | `XA:E` |
| `GF` | French Guiana | — nothing resembles it — | — |
| `GP` | Guadeloupe | — nothing resembles it — | — |
| `HM` | Heard & McDonald Islands | — nothing resembles it — | — |
| `IO` | British Indian Ocean Territory | — nothing resembles it — | — |
| `MQ` | Martinique | — nothing resembles it — | — |
| `RE` | Réunion | — nothing resembles it — | — |
| `SX` | Sint Maarten | — nothing resembles it — | — |
| `TF` | French Southern Territories | — nothing resembles it — | — |
| `UM` | U.S. Outlying Islands | — nothing resembles it — | — |

**What the portal offers that no country in our table claimed (6).** Read this
beside the table above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Channel Islands, not otherwise specified | `XL:H` |
| Cyprus (European Union) | `XA:E` |
| Cyprus (Non-European Union) | `XB:O` |
| Kosovo | `QO:O` |
| Netherlands Antilles {Comprises Curacao, Bonaire, Saba, St Eustatius, St Martin (South)} | `AN:E` |
| Stateless | `AA:O` |

## `countryOfBirth` — DERIVED

The portal submits ISO codes, so the join is the identity on a code the reviewed table
already holds: **235 of 249**, nothing guessed. The 14 it does not carry are below —
they are absences in the portal's list, not disagreements about a name.

**Spot-check** — every 25th match, so it is the same rows every run:

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

**The 14 the join could not settle.** The candidate column is a PROPOSAL and
nothing acts on it until you say so; a blank one means nothing in the portal's list
resembled our name at all.

| code | our name | proposed option text (UNVERIFIED) | submitted value |
|---|---|---|---|
| `AQ` | Antarctica | — nothing resembles it — | — |
| `BQ` | Caribbean Netherlands | — nothing resembles it — | — |
| `BV` | Bouvet Island | — nothing resembles it — | — |
| `CW` | Curaçao | — nothing resembles it — | — |
| `CY` | Cyprus | Cyprus (European Union) | `XA:E` |
| `GF` | French Guiana | — nothing resembles it — | — |
| `GP` | Guadeloupe | — nothing resembles it — | — |
| `HM` | Heard & McDonald Islands | — nothing resembles it — | — |
| `IO` | British Indian Ocean Territory | — nothing resembles it — | — |
| `MQ` | Martinique | — nothing resembles it — | — |
| `RE` | Réunion | — nothing resembles it — | — |
| `SX` | Sint Maarten | — nothing resembles it — | — |
| `TF` | French Southern Territories | — nothing resembles it — | — |
| `UM` | U.S. Outlying Islands | — nothing resembles it — | — |

**What the portal offers that no country in our table claimed (6).** Read this
beside the table above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Channel Islands, not otherwise specified | `XL:H` |
| Cyprus (European Union) | `XA:E` |
| Cyprus (Non-European Union) | `XB:O` |
| Kosovo | `QO:O` |
| Netherlands Antilles {Comprises Curacao, Bonaire, Saba, St Eustatius, St Martin (South)} | `AN:E` |
| Stateless | `AA:O` |

## `corrCountry` — NEEDS YOUR READING

The portal submits names, so the join is a comparison between two authorities that
disagree. **212 of 249** matched exactly; **37** did not, and those are yours to read.

**Spot-check** — every 25th match, so it is the same rows every run:

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

**The 37 the join could not settle.** The candidate column is a PROPOSAL and
nothing acts on it until you say so; a blank one means nothing in the portal's list
resembled our name at all.

| code | our name | proposed option text (UNVERIFIED) | submitted value |
|---|---|---|---|
| `AQ` | Antarctica | — nothing resembles it — | — |
| `AX` | Åland Islands | — nothing resembles it — | — |
| `BF` | Burkina Faso | — nothing resembles it — | — |
| `BL` | St. Barthélemy | — nothing resembles it — | — |
| `BQ` | Caribbean Netherlands | — nothing resembles it — | — |
| `BV` | Bouvet Island | — nothing resembles it — | — |
| `CC` | Cocos (Keeling) Islands | Cocos Islands | `COCOS ISLANDS` |
| `CD` | Congo - Kinshasa | Congo | `CONGO` |
| `CG` | Congo - Brazzaville | Congo | `CONGO` |
| `CI` | Côte d’Ivoire | — nothing resembles it — | — |
| `CV` | Cape Verde | Cape Verde Islands | `CAPE VERDE ISLANDS` |
| `CW` | Curaçao | — nothing resembles it — | — |
| `CZ` | Czechia | — nothing resembles it — | — |
| `FM` | Micronesia | Micronesia, (Federated States of) | `MICRONESIA, (FEDERATED STATES OF)` |
| `GS` | South Georgia & South Sandwich Islands | South Georgia & the South Sandwich Is | `SOUTH GEORGIA & THE SOUTH SANDWICH IS` |
| `HK` | Hong Kong SAR China | Hong Kong (Special Administrative Region) | `HONG KONG` |
| `HM` | Heard & McDonald Islands | — nothing resembles it — | — |
| `IM` | Isle of Man | Isle of Man (The) | `ISLE OF MAN (THE)` |
| `KN` | St. Kitts & Nevis | — nothing resembles it — | — |
| `MF` | St. Martin | St Martin (North) | `ST MARTIN (NORTH)` |
| `MK` | North Macedonia | — nothing resembles it — | — |
| `MM` | Myanmar (Burma) | Myanmar (Burma) [The Republic of the Union of Myanmar] | `MYANMAR` |
| `MO` | Macao SAR China | Macao (Special Administrative Region) | `MACAO` |
| `MP` | Northern Mariana Islands | Northern Ireland | `NORTHERN IRELAND` |
| `PS` | Palestinian Territories | — nothing resembles it — | — |
| `RE` | Réunion | — nothing resembles it — | — |
| `SH` | St. Helena | — nothing resembles it — | — |
| `SJ` | Svalbard & Jan Mayen | — nothing resembles it — | — |
| `ST` | São Tomé & Príncipe | — nothing resembles it — | — |
| `SX` | Sint Maarten | — nothing resembles it — | — |
| `TF` | French Southern Territories | — nothing resembles it — | — |
| `TL` | Timor-Leste | — nothing resembles it — | — |
| `TR` | Türkiye | — nothing resembles it — | — |
| `UM` | U.S. Outlying Islands | — nothing resembles it — | — |
| `VC` | St. Vincent & Grenadines | — nothing resembles it — | — |
| `VI` | U.S. Virgin Islands | — nothing resembles it — | — |
| `YE` | Yemen | Yemen (Republic of) | `YEMEN (REPUBLIC OF)` |

**What the portal offers that no country in our table claimed (47).** Read this
beside the table above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Azores | `AZORES` |
| Balearic Islands | `BALEARIC ISLANDS` |
| Burkina-Faso | `BURKINA-FASO` |
| Canary Islands | `CANARY ISLANDS` |
| Cape Verde Islands | `CAPE VERDE ISLANDS` |
| Ceuta | `CEUTA` |
| Channel Islands (The) | `CHANNEL ISLANDS (THE)` |
| Cocos Islands | `COCOS ISLANDS` |
| Congo | `CONGO` |
| Congo (Democratic Republic) | `CONGO (DEMOCRATIC REPUBLIC)` |
| Cote d'Ivorie | `COTE D'IVORIE` |
| Crete | `CRETE` |
| Cyprus (European Union) | `CYPRUS (EUROPEAN UNION)` |
| Czech Republic | `CZECH REPUBLIC` |
| Dubai | `DUBAI` |
| East Timor | `EAST TIMOR` |
| England | `ENGLAND` |
| Guinea (Equatorial) | `GUINEA (EQUATORIAL)` |
| Holy See | `HOLY SEE` |
| Hong Kong (Special Administrative Region) | `HONG KONG` |
| Isle of Man (The) | `ISLE OF MAN (THE)` |
| Java | `JAVA` |
| Kosovo | `KOSOVO` |
| Macao (Special Administrative Region) | `MACAO` |
| Macedonia | `MACEDONIA` |
| Madeira | `MADEIRA` |
| Melilla | `MELILLA` |
| Micronesia, (Federated States of) | `MICRONESIA, (FEDERATED STATES OF)` |
| Myanmar (Burma) [The Republic of the Union of Myanmar] | `MYANMAR` |
| Netherlands Antilles | `NETHERLANDS ANTILLES` |
| Northern Ireland | `NORTHERN IRELAND` |
| Not Known | `NOT KNOWN` |
| Palestine | `PALESTINE` |
| Reunion | `REUNION` |
| Sao Tome & Principe | `SAO TOME & PRINCIPE` |
| Scotland | `SCOTLAND` |
| South Georgia & the South Sandwich Is | `SOUTH GEORGIA & THE SOUTH SANDWICH IS` |
| St Kitts Nevis | `ST KITTS NEVIS` |
| St Martin (North) | `ST MARTIN (NORTH)` |
| St Martin (South) | `ST MARTIN (SOUTH)` |
| St Vincent & the Grenadines | `ST VINCENT & THE GRENADINES` |
| Stateless | `STATELESS` |
| Turkey | `TURKEY` |
| Virgin Is (British) | `VIRGIN IS (BRITISH)` |
| Virgin Is (US) | `VIRGIN IS (US)` |
| Wales | `WALES` |
| Yemen (Republic of) | `YEMEN (REPUBLIC OF)` |

## `permanentResidence` — NEEDS YOUR READING

The portal submits names, so the join is a comparison between two authorities that
disagree. **205 of 249** matched exactly; **44** did not, and those are yours to read.

**Spot-check** — every 25th match, so it is the same rows every run:

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

**The 44 the join could not settle.** The candidate column is a PROPOSAL and
nothing acts on it until you say so; a blank one means nothing in the portal's list
resembled our name at all.

| code | our name | proposed option text (UNVERIFIED) | submitted value |
|---|---|---|---|
| `AQ` | Antarctica | — nothing resembles it — | — |
| `AX` | Åland Islands | — nothing resembles it — | — |
| `BL` | St. Barthélemy | — nothing resembles it — | — |
| `BN` | Brunei | Brunei Darussalam | `Brunei Darussalam:O` |
| `BQ` | Caribbean Netherlands | — nothing resembles it — | — |
| `BV` | Bouvet Island | — nothing resembles it — | — |
| `CD` | Congo - Kinshasa | Congo | `Congo:O` |
| `CG` | Congo - Brazzaville | Congo | `Congo:O` |
| `CI` | Côte d’Ivoire | — nothing resembles it — | — |
| `CW` | Curaçao | — nothing resembles it — | — |
| `CY` | Cyprus | Cyprus (European Union) | `Cyprus (European Union):E` |
| `CZ` | Czechia | — nothing resembles it — | — |
| `FK` | Falkland Islands | Falkland Islands (Malvinas) | `Falkland Islands (Malvinas):O` |
| `FM` | Micronesia | Micronesia, Federated States of | `Micronesia, Federated States of:O` |
| `GG` | Guernsey | — nothing resembles it — | — |
| `HK` | Hong Kong SAR China | Hong Kong | `Hong Kong:O` |
| `HM` | Heard & McDonald Islands | — nothing resembles it — | — |
| `IM` | Isle of Man | — nothing resembles it — | — |
| `IR` | Iran | Iran, Islamic Republic of | `Iran, Islamic Republic of:O` |
| `JE` | Jersey | — nothing resembles it — | — |
| `KN` | St. Kitts & Nevis | — nothing resembles it — | — |
| `KP` | North Korea | — nothing resembles it — | — |
| `KR` | South Korea | — nothing resembles it — | — |
| `LA` | Laos | — nothing resembles it — | — |
| `MF` | St. Martin | St Martin (French part) | `St Martin (French part):O` |
| `MM` | Myanmar (Burma) | — nothing resembles it — | — |
| `MO` | Macao SAR China | Macao | `Macao:O` |
| `PS` | Palestinian Territories | — nothing resembles it — | — |
| `RE` | Réunion | — nothing resembles it — | — |
| `RU` | Russia | Russian Federation | `Russian Federation:O` |
| `SH` | St. Helena | St Helena, Ascension & Tristan da Cunha | `St Helena, Ascension & Tristan da Cunha:O` |
| `ST` | São Tomé & Príncipe | — nothing resembles it — | — |
| `SX` | Sint Maarten | Sint Maarten (Dutch Part) | `Sint Maarten (Dutch Part):O` |
| `SY` | Syria | Syrian Arab Republic (Syria) | `Syrian Arab Republic (Syria):O` |
| `TF` | French Southern Territories | French West Indies | `French West Indies:E` |
| `TL` | Timor-Leste | — nothing resembles it — | — |
| `TR` | Türkiye | — nothing resembles it — | — |
| `TZ` | Tanzania | Tanzania, United Republic of | `Tanzania, United Republic of:O` |
| `UM` | U.S. Outlying Islands | — nothing resembles it — | — |
| `US` | United States | United States of America | `United States of America:O` |
| `VA` | Vatican City | — nothing resembles it — | — |
| `VC` | St. Vincent & Grenadines | — nothing resembles it — | — |
| `VE` | Venezuela | Venezuela (Bolivarian Republic of) | `Venezuela (Bolivarian Republic of):O` |
| `VI` | U.S. Virgin Islands | — nothing resembles it — | — |

**What the portal offers that no country in our table claimed (54).** Read this
beside the table above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Aland Islands | `Aland Islands:O` |
| Bonaire, Sint Eustatius and Saba | `Bonaire, Sint Eustatius and Saba:O` |
| British Antarctic Territory | `British Antarctic Territory:H` |
| Brunei Darussalam | `Brunei Darussalam:O` |
| Burma (Myanmar) | `Burma (Myanmar):O` |
| Canary Islands | `Canary Islands:O` |
| Congo | `Congo:O` |
| Congo (Democratic Republic) | `Congo (Democratic Republic):O` |
| Curacao | `Curacao:O` |
| Cyprus (European Union) | `Cyprus (European Union):E` |
| Cyprus (Non-European Union) | `Cyprus (Non-European Union):O` |
| Cyprus (Not otherwise specified) | `Cyprus (Not otherwise specified):O` |
| Czech Republic | `Czech Republic:E` |
| East Timor (Timor-Leste) | `East Timor (Timor-Leste):O` |
| Falkland Islands (Malvinas) | `Falkland Islands (Malvinas):O` |
| French West Indies | `French West Indies:E` |
| Holy See (Vatican City State) | `Holy See (Vatican City State):O` |
| Hong Kong | `Hong Kong:O` |
| Iran, Islamic Republic of | `Iran, Islamic Republic of:O` |
| Ivory Coast (Cote d'Ivoire) | `Ivory Coast (Cote d'Ivoire):O` |
| Korea, Democratic People's Republic of | `Korea, Democratic People's Republic of:O` |
| Korea, Republic of | `Korea, Republic of:O` |
| Kosovo | `Kosovo:O` |
| Lao PDR | `Lao PDR:O` |
| Leeward Islands | `Leeward Islands:O` |
| Macao | `Macao:O` |
| Malaya | `Malaya:O` |
| Micronesia, Federated States of | `Micronesia, Federated States of:O` |
| Netherlands Antilles | `Netherlands Antilles:E` |
| Palestine | `Palestine:O` |
| Portuguese West Africa | `Portuguese West Africa:O` |
| Reunion | `Reunion:O` |
| Russian Federation | `Russian Federation:O` |
| Sabah | `Sabah:O` |
| Saint Vincent and the Grenadines | `Saint Vincent and the Grenadines:O` |
| Sao Tome and Principe | `Sao Tome and Principe:O` |
| Sarawak | `Sarawak:O` |
| Sikkim | `Sikkim:O` |
| Sint Maarten (Dutch Part) | `Sint Maarten (Dutch Part):O` |
| St Barthelemy | `St Barthelemy:O` |
| St Helena, Ascension & Tristan da Cunha | `St Helena, Ascension & Tristan da Cunha:O` |
| St Martin (French part) | `St Martin (French part):O` |
| St. Kitts-Nevis | `St. Kitts-Nevis:O` |
| Stateless | `Stateless:O` |
| Syrian Arab Republic (Syria) | `Syrian Arab Republic (Syria):O` |
| Tanzania, United Republic of | `Tanzania, United Republic of:O` |
| Tibet | `Tibet:O` |
| Turkey | `Turkey:O` |
| United States of America | `United States of America:O` |
| Venezuela (Bolivarian Republic of) | `Venezuela (Bolivarian Republic of):O` |
| Vietnam [Viet Nam] | `Vietnam [Viet Nam]:O` |
| Virgin Islands (US) | `Virgin Islands (US):O` |
| West Indies | `West Indies:O` |
| Windward Islands | `Windward Islands:O` |

## `previousCountry1` — NEEDS YOUR READING

The portal submits names, so the join is a comparison between two authorities that
disagree. **211 of 249** matched exactly; **38** did not, and those are yours to read.

**Spot-check** — every 25th match, so it is the same rows every run:

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

**The 38 the join could not settle.** The candidate column is a PROPOSAL and
nothing acts on it until you say so; a blank one means nothing in the portal's list
resembled our name at all.

| code | our name | proposed option text (UNVERIFIED) | submitted value |
|---|---|---|---|
| `AQ` | Antarctica | — nothing resembles it — | — |
| `AX` | Åland Islands | — nothing resembles it — | — |
| `BF` | Burkina Faso | — nothing resembles it — | — |
| `BL` | St. Barthélemy | — nothing resembles it — | — |
| `BQ` | Caribbean Netherlands | — nothing resembles it — | — |
| `BV` | Bouvet Island | — nothing resembles it — | — |
| `CC` | Cocos (Keeling) Islands | Cocos Islands | `COCOS ISLANDS:O` |
| `CD` | Congo - Kinshasa | Congo | `CONGO:O` |
| `CG` | Congo - Brazzaville | Congo | `CONGO:O` |
| `CI` | Côte d’Ivoire | — nothing resembles it — | — |
| `CV` | Cape Verde | Cape Verde Islands | `CAPE VERDE ISLANDS:O` |
| `CW` | Curaçao | — nothing resembles it — | — |
| `CY` | Cyprus | Cyprus (European Union) | `CyprusEU:O` |
| `CZ` | Czechia | — nothing resembles it — | — |
| `FM` | Micronesia | Micronesia, (Federated States of) | `MICRONESIA, (FEDERATED STATES OF):O` |
| `GS` | South Georgia & South Sandwich Islands | South Georgia & the South Sandwich Is | `SOUTH GEORGIA & THE SOUTH SANDWICH IS:H` |
| `HK` | Hong Kong SAR China | Hong Kong (Special Administrative Region) | `HONG KONG:O` |
| `HM` | Heard & McDonald Islands | — nothing resembles it — | — |
| `IM` | Isle of Man | Isle of Man (The) | `ISLE OF MAN (THE):H` |
| `KN` | St. Kitts & Nevis | — nothing resembles it — | — |
| `MF` | St. Martin | St Martin (North) | `ST MARTIN (NORTH):O` |
| `MK` | North Macedonia | — nothing resembles it — | — |
| `MM` | Myanmar (Burma) | Myanmar (Burma) [The Republic of the Union of Myanmar] | `MYANMAR:O` |
| `MO` | Macao SAR China | Macao (Special Administrative Region) | `MACAO:O` |
| `MP` | Northern Mariana Islands | Northern Ireland | `NORTHERN IRELAND:H` |
| `PS` | Palestinian Territories | — nothing resembles it — | — |
| `RE` | Réunion | — nothing resembles it — | — |
| `SH` | St. Helena | — nothing resembles it — | — |
| `SJ` | Svalbard & Jan Mayen | — nothing resembles it — | — |
| `ST` | São Tomé & Príncipe | — nothing resembles it — | — |
| `SX` | Sint Maarten | — nothing resembles it — | — |
| `TF` | French Southern Territories | — nothing resembles it — | — |
| `TL` | Timor-Leste | — nothing resembles it — | — |
| `TR` | Türkiye | — nothing resembles it — | — |
| `UM` | U.S. Outlying Islands | — nothing resembles it — | — |
| `VC` | St. Vincent & Grenadines | — nothing resembles it — | — |
| `VI` | U.S. Virgin Islands | — nothing resembles it — | — |
| `YE` | Yemen | Yemen (Republic of) | `YEMEN (REPUBLIC OF):O` |

**What the portal offers that no country in our table claimed (49).** Read this
beside the table above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Azores | `AZORES:O` |
| Balearic Islands | `BALEARIC ISLANDS:O` |
| Burkina-Faso | `BURKINA-FASO:O` |
| Canary Islands | `CANARY ISLANDS:O` |
| Cape Verde Islands | `CAPE VERDE ISLANDS:O` |
| Ceuta | `CEUTA:O` |
| Channel Islands (The) | `CHANNEL ISLANDS (THE):H` |
| Cocos Islands | `COCOS ISLANDS:O` |
| Congo | `CONGO:O` |
| Congo (Democratic Republic) | `CONGO (DEMOCRATIC REPUBLIC):O` |
| Cote d'Ivorie | `COTE D'IVORIE:O` |
| Crete | `CRETE:O` |
| Cyprus (Non-European Union) | `CyprusNonEU:O` |
| Cyprus (European Union) | `CyprusEU:O` |
| Cyprus (European Union) | `CYPRUS (EUROPEAN UNION):E` |
| Czech Republic | `CZECH REPUBLIC:E` |
| Dubai | `DUBAI:O` |
| East Timor | `EAST TIMOR:O` |
| England | `ENGLAND:H` |
| Guinea (Equatorial) | `GUINEA (EQUATORIAL):O` |
| Holy See | `HOLY SEE:O` |
| Hong Kong (Special Administrative Region) | `HONG KONG:O` |
| Isle of Man (The) | `ISLE OF MAN (THE):H` |
| Java | `JAVA:O` |
| Kosovo | `KOSOVO:O` |
| Macao (Special Administrative Region) | `MACAO:O` |
| Macedonia | `MACEDONIA:O` |
| Madeira | `MADEIRA:O` |
| Melilla | `MELILLA:O` |
| Micronesia, (Federated States of) | `MICRONESIA, (FEDERATED STATES OF):O` |
| Myanmar (Burma) [The Republic of the Union of Myanmar] | `MYANMAR:O` |
| Netherlands Antilles | `NETHERLANDS ANTILLES:E` |
| Northern Ireland | `NORTHERN IRELAND:H` |
| Not Known | `NOT KNOWN:O` |
| Palestine | `PALESTINE:O` |
| Reunion | `REUNION:O` |
| Sao Tome & Principe | `SAO TOME & PRINCIPE:O` |
| Scotland | `SCOTLAND:H` |
| South Georgia & the South Sandwich Is | `SOUTH GEORGIA & THE SOUTH SANDWICH IS:H` |
| St Kitts Nevis | `ST KITTS NEVIS:O` |
| St Martin (North) | `ST MARTIN (NORTH):O` |
| St Martin (South) | `ST MARTIN (SOUTH):O` |
| St Vincent & the Grenadines | `ST VINCENT & THE GRENADINES:O` |
| Stateless | `STATELESS:O` |
| Turkey | `TURKEY:O` |
| Virgin Is (British) | `VIRGIN IS (BRITISH):H` |
| Virgin Is (US) | `VIRGIN IS (US):O` |
| Wales | `WALES:H` |
| Yemen (Republic of) | `YEMEN (REPUBLIC OF):O` |

## `institutionCountry-ts-control` — NEEDS YOUR READING

The portal submits names, so the join is a comparison between two authorities that
disagree. **212 of 249** matched exactly; **37** did not, and those are yours to read.

**Spot-check** — every 25th match, so it is the same rows every run:

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

**The 37 the join could not settle.** The candidate column is a PROPOSAL and
nothing acts on it until you say so; a blank one means nothing in the portal's list
resembled our name at all.

| code | our name | proposed option text (UNVERIFIED) | submitted value |
|---|---|---|---|
| `AQ` | Antarctica | — nothing resembles it — | — |
| `AX` | Åland Islands | — nothing resembles it — | — |
| `BF` | Burkina Faso | — nothing resembles it — | — |
| `BL` | St. Barthélemy | — nothing resembles it — | — |
| `BQ` | Caribbean Netherlands | — nothing resembles it — | — |
| `BV` | Bouvet Island | — nothing resembles it — | — |
| `CC` | Cocos (Keeling) Islands | Cocos Islands | `COCOS ISLANDS` |
| `CD` | Congo - Kinshasa | Congo | `CONGO` |
| `CG` | Congo - Brazzaville | Congo | `CONGO` |
| `CI` | Côte d’Ivoire | — nothing resembles it — | — |
| `CV` | Cape Verde | Cape Verde Islands | `CAPE VERDE ISLANDS` |
| `CW` | Curaçao | — nothing resembles it — | — |
| `CZ` | Czechia | — nothing resembles it — | — |
| `FM` | Micronesia | Micronesia, (Federated States of) | `MICRONESIA, (FEDERATED STATES OF)` |
| `GS` | South Georgia & South Sandwich Islands | South Georgia & the South Sandwich Is | `SOUTH GEORGIA & THE SOUTH SANDWICH IS` |
| `HK` | Hong Kong SAR China | Hong Kong (Special Administrative Region) | `HONG KONG` |
| `HM` | Heard & McDonald Islands | — nothing resembles it — | — |
| `IM` | Isle of Man | Isle of Man (The) | `ISLE OF MAN (THE)` |
| `KN` | St. Kitts & Nevis | — nothing resembles it — | — |
| `MF` | St. Martin | St Martin (North) | `ST MARTIN (NORTH)` |
| `MK` | North Macedonia | — nothing resembles it — | — |
| `MM` | Myanmar (Burma) | Myanmar (Burma) [The Republic of the Union of Myanmar] | `MYANMAR` |
| `MO` | Macao SAR China | Macao (Special Administrative Region) | `MACAO` |
| `MP` | Northern Mariana Islands | — nothing resembles it — | — |
| `PS` | Palestinian Territories | — nothing resembles it — | — |
| `RE` | Réunion | — nothing resembles it — | — |
| `SH` | St. Helena | — nothing resembles it — | — |
| `SJ` | Svalbard & Jan Mayen | — nothing resembles it — | — |
| `ST` | São Tomé & Príncipe | — nothing resembles it — | — |
| `SX` | Sint Maarten | — nothing resembles it — | — |
| `TF` | French Southern Territories | — nothing resembles it — | — |
| `TL` | Timor-Leste | — nothing resembles it — | — |
| `TR` | Türkiye | — nothing resembles it — | — |
| `UM` | U.S. Outlying Islands | — nothing resembles it — | — |
| `VC` | St. Vincent & Grenadines | — nothing resembles it — | — |
| `VI` | U.S. Virgin Islands | — nothing resembles it — | — |
| `YE` | Yemen | Yemen (Republic of) | `YEMEN (REPUBLIC OF)` |

**What the portal offers that no country in our table claimed (43).** Read this
beside the table above: between them they are the whole disagreement.

| the portal's option text | submitted value |
|---|---|
| Azores | `AZORES` |
| Balearic Islands | `BALEARIC ISLANDS` |
| Burkina-Faso | `BURKINA-FASO` |
| Canary Islands | `CANARY ISLANDS` |
| Cape Verde Islands | `CAPE VERDE ISLANDS` |
| Ceuta | `CEUTA` |
| Channel Islands (The) | `CHANNEL ISLANDS (THE)` |
| Cocos Islands | `COCOS ISLANDS` |
| Congo | `CONGO` |
| Congo (Democratic Republic) | `CONGO (DEMOCRATIC REPUBLIC)` |
| Cote d'Ivorie | `COTE D'IVORIE` |
| Crete | `CRETE` |
| Cyprus (European Union) | `CYPRUS (EUROPEAN UNION)` |
| Czech Republic | `CZECH REPUBLIC` |
| Dubai | `DUBAI` |
| East Timor | `EAST TIMOR` |
| Guinea (Equatorial) | `GUINEA (EQUATORIAL)` |
| Holy See | `HOLY SEE` |
| Hong Kong (Special Administrative Region) | `HONG KONG` |
| Isle of Man (The) | `ISLE OF MAN (THE)` |
| Java | `JAVA` |
| Kosovo | `KOSOVO` |
| Macao (Special Administrative Region) | `MACAO` |
| Macedonia | `MACEDONIA` |
| Madeira | `MADEIRA` |
| Melilla | `MELILLA` |
| Micronesia, (Federated States of) | `MICRONESIA, (FEDERATED STATES OF)` |
| Myanmar (Burma) [The Republic of the Union of Myanmar] | `MYANMAR` |
| Netherlands Antilles | `NETHERLANDS ANTILLES` |
| Not Known | `NOT KNOWN` |
| Palestine | `PALESTINE` |
| Reunion | `REUNION` |
| Sao Tome & Principe | `SAO TOME & PRINCIPE` |
| South Georgia & the South Sandwich Is | `SOUTH GEORGIA & THE SOUTH SANDWICH IS` |
| St Kitts Nevis | `ST KITTS NEVIS` |
| St Martin (North) | `ST MARTIN (NORTH)` |
| St Martin (South) | `ST MARTIN (SOUTH)` |
| St Vincent & the Grenadines | `ST VINCENT & THE GRENADINES` |
| Stateless | `STATELESS` |
| Turkey | `TURKEY` |
| Virgin Is (British) | `VIRGIN IS (BRITISH)` |
| Virgin Is (US) | `VIRGIN IS (US)` |
| Yemen (Republic of) | `YEMEN (REPUBLIC OF)` |

## What happens after you sign

The option maps go into the entry, which moves its content hash — that is the
signature you offered to spend. The derived fields are then held by the test in
`scripts/derive-country-mappings.test.ts`, which re-derives them and fails if the
entry and the derivation ever disagree. The name-valued fields are held by your
reading, recorded here.
