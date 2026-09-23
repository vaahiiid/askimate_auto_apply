# ADR-0141 — The country table is a reviewed artefact, and anything not in it is refused

**Status:** Accepted · 2026-09-23 · closes blocker 61 · completes [ADR-0140](./0140-a-field-with-several-parts-is-asked-part-by-part.md)'s `countryCodeIso2`, which refused for want of this · the same discipline as [ADR-0057](./0057-approval-binds-to-content-not-to-claims.md), applied to a vocabulary rather than to an entry · built in P195
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-23, and quoted in full below.

## Context — a refusal that was right, and not good

P192 wrote the `countryCode` part of an address and **refused "Iran"**. The reasoning held: turning a
country's name into `IR` is a lookup, this repository had no reviewed table to do it with, and a
half-table is worse than a refusal because it works for some students and fails invisibly for
others. That is the rule Vahid had already set — *"a value the student did not state is never
supplied by us"* — applied honestly.

It was also a question no student can answer. Asking somebody for their own country's ISO code is
asking them to do our homework. The refusal was correct and the experience was bad, which is the
shape of a gap rather than a decision.

## Decision

> *"build it as a reviewed artefact, not a lookup you generate. ISO 3166-1 alpha-2, the list itself
> reviewed and hashed like a blueprint, and refuse anything not in it. A half-table failing
> invisibly is exactly the failure mode we spent this week finding."*

**1. The list is frozen in the repository and hashed.** `canonicalCountries` renders it as one
`CODE⇥Name` line per country in code order — not JSON, because a canonical form exists so the same
list hashes the same way however it is written down, and JSON offers a dozen ways to write one
object. `assertCountriesUnchanged` throws `CountryTableChangedError` when the hash has moved, and
`readCountry` calls it before every lookup.

**2. The same discipline as a blueprint, not the same code.** The catalogue's hashing already
depends on `packages/profile`, so reusing it would be a dependency cycle. The parallel is deliberate
and is written where a reader will find it.

**3. Membership is checked, not shape.** `ZZ` is a well-formed two-letter code that nobody is
assigned; so are `XK`, `EU` and `UK`. All four are refused. That is the thing a regular expression
could not do, and the reason the table exists.

**4. A name resolves, and an unrecognised one does not.** The student may type `Iran` or `IR`.
Matching is case- and punctuation-insensitive (`st. lucia` finds `St. Lucia`, `and` and `&` are one
word). A name the table does not hold is refused and asked again. **The rule did not soften** — what
changed is that there is now something to look in.

## Where the list came from, so a reviewer can re-derive it

Generated from the ICU data Node ships, not typed from memory:

```
new Intl.DisplayNames(["en"], { type: "region", fallback: "code" })
```

asked for every two-letter combination `AA`–`ZZ`. **280** resolve to a name. ICU carries more than
ISO assigns, so **31** codes are subtracted in `NOT_ASSIGNED`, each with the reason it is not an ISO
3166-1 assignment — twelve exceptionally reserved (`AC`, `CP`, `CQ`, `DG`, `EA`, `EU`, `EZ`, `FX`,
`IC`, `TA`, `UK`, `UN`), fourteen formerly assigned (`AN`, `BU`, `CS`, `DD`, `DY`, `HV`, `NH`, `RH`,
`SU`, `TP`, `VD`, `YD`, `YU`, `ZR`), one user-assigned (`XK`), and four CLDR inventions (`XA`, `XB`,
`QO`, `ZZ`).

**280 − 31 = 249**, which is the published count of officially assigned alpha-2 codes. A test
**re-runs the whole derivation** and asserts that arithmetic rather than trusting it: get one
exclusion wrong and the count moves. The subtraction is the only judgement in the derivation, which
is why each exclusion carries a reason and a test requires one.

The **names** are ICU's English display names. They are what a student is shown and what a typed
name is matched against, and where they differ from the ISO short names, ICU's is what is recorded.

## What "reviewed" does and does not mean here

Said plainly, because a hash beside the word *reviewed* invites a reader to assume more:

- The hash makes the table **tamper-evident**. It cannot drift quietly the way the test count
  drifted 136 before ADR-0084.
- **Nobody has signed it, and nobody should.** Put to Vahid and decided by him, 2026-09-23:

  > *"no signature, and say why in the file itself rather than only in a report. A derivation that
  > re-runs and 249 matching the published count is stronger evidence than my signature would be —
  > I cannot check 249 codes and would be signing your arithmetic. Record that as the reason, so
  > nobody later reads the missing signature as an oversight and adds one to tidy it up."*

  The reason is written into `countries.ts` itself, beside the hash, ending with the instruction to
  a future reader: **if you are about to add an approval to this artefact, don't — strengthen the
  derivation instead.** A signature here would assert a check nobody performed, which is the kind
  of record ADR-0082 to ADR-0084 spent three phases removing.

## A country has TWO mappings, not one

Vahid, 2026-09-23, before the conversion phase exists, so that it inherits this rather than
rediscovering it:

> *"A country has two mappings, not one. The student's answer to a code is ours and general. The
> code to whatever a given portal's select calls it is the portal's, and belongs in its entry,
> reviewed and signed per portal."*

| | Whose | Where it lives | Scope |
|---|---|---|---|
| student's answer → code | **ours** | this table | general, one for the whole system |
| code → what a portal's control submits | **the portal's** | its catalogue entry's mapping set | per portal, per FIELD, reviewed and signed with the entry |

**Sheffield proves it inside one entry.** Measured from the signed
`docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json` — one country, one portal, **three labels
and four distinct submitted values**, and `IR` is not among them:

| Field | Label shown | Value submitted |
|---|---|---|
| `corrCountry`, `permCountry` (page 4) | `Iran` | `IRAN` |
| `fundingNationality`, `secondFundingNationality`, `countryOfBirth` (page 5) | `Iran [Iran, Islamic Republic of]` | `IR:O` |
| `permanentResidence` (page 5) | `Iran, Islamic Republic of` | `Iran, Islamic Republic of:O` |
| `previousCountry1`–`4` (page 5) | `Iran` | `IRAN:O` |
| `institutionCountry` (page 7) | `Iran` | `IRAN` |

So the per-portal half is **not a future need**: it already exists in the signed entry, already keyed
by the code, and already disagrees with itself field by field. What does not exist is the first
half — the student's answer reaching it as a code at all.

## What this does NOT do

**The three free-text country fields are unchanged**: `identity.nationality`,
`identity.country_of_birth` and `residence.country` still hold whatever the student typed. Held on
Vahid's word, 2026-09-23: *"hold it. The three country fields stay free text and the entry stays as
signed. Bring me the conversion together with whatever else moves the hash, when the composites are
done and we know the full set. I would rather spend one signature than one per phase."*

> **A correction, because the reason first given for this stop was wrong.** P195 told him converting
> them *"moves the entry's content hash and voids your signature"*. Measured afterwards rather than
> assumed: `loadReviewedEntry` computes `hashOf(toCanonical(reviewed))` over the **entry** —
> blueprint, mapping set, admits, refs. **The profile is not in it.** Changing how the interview
> reads a country changes a stored profile value, not the entry, so no signature is spent. The hold
> stands because he said hold; the cost he weighed does not exist. See
> [blocker 64](../state-of-the-system.md#6-open-blockers) for what measurement found underneath it.

## Consequences

- `packages/profile` gains `countries.data.ts` (249 entries plus the exclusion set) and
  `countries.ts` (canonical form, hash, `readCountry`).
- `countryCodeIso2` is now `readCountry(raw)?.code ?? null`, and the question it asks changed from
  *"the two-letter code"* to *"its name or its two-letter code"*.
- One P192 test asserted the opposite and was **rewritten, not deleted**, with the reversal and its
  reason written into it.
