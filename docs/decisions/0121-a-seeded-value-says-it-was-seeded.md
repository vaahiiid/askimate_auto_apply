# ADR-0121 — A seeded value says it was seeded: the provenance vocabulary carries the true word

**Status:** Accepted · 2026-09-16 · amends the provenance vocabulary of ADR-0007's confirmation model (`ConfirmationProvenance.source`) · continues 0118 (one account only)
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-16. **Built in P151**, the same day.

## Context

P150 built the synthetic profile for Run A and the command that writes it to the profile store
after showing it. The store takes plain stored entries, and every entry carries a provenance
whose `source` says how the value reached the profile. The vocabulary had four words —
`student_stated`, `student_entered`, `document_extracted`, `student_corrected` — and its comment
said every one of them ends in the student confirming, and that there is no source that bypasses
it. A seeded value bypasses it. P150 stored the nearest word, `student_entered`, with an excerpt
saying the truth, and put the question to him.

## Decision

In his words:

> *"The provenance word: add the true one. 'Seeded, no interview took place' is a real origin and
> the nearest honest word is not it. This is the same shape as NotRequired meaning three things:
> a value that reads as something it is not, which someone eventually takes at face value. Small
> now, invisible later."*

So `seeded` is a fifth source: written by an operator's command from a fixture file that was
shown first; no student confirmed it and no interview took place. The comment on the vocabulary
now says that every source but `seeded` ends in the student confirming, and that `seeded`
bypasses it on purpose and is named so it can never be read as a confirmation.

## Built — P151

- `ConfirmationProvenance.source` gains `"seeded"` (`packages/domain`); the contract mirror
  `WORK_PROVENANCE_SOURCES` and the OpenAPI enum gain it; the seed command stores it; the Run A
  test pins it. The excerpt still says the file, the command and the date.

## Consequences

- A value whose source is `seeded` is not a student's confirmation, and nothing downstream may
  read it as one. Today nothing refuses a seeded value on any path: the only writer is the seed
  command, the only profile it has written is the synthetic one, and the only entry that can
  serve it admits one account (ADR-0118). A guard that refuses a seeded value under an
  any-applicant approval is not built; it is the natural next line if a second writer ever
  appears, and it is said here so that the absence is a known one.
- Nothing here touches the transmission gate, the authorisation content hash, or the
  mandatory-review categories.
