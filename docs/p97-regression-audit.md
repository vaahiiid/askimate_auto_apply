# P97 — deliberate regression audit: the four gaps ADR-0103 built

Fifteen mutations against what P93–P96 built: the document slot's companion (its check, its entry
by the runner, its place in the hash); options that arrive after another field (the order rule,
the runner's wait, the session's bound); the typeahead (its check, and the two ways a wrong entry
could be chosen); the repeating page (rendering per item, the ledger's identity per item, the
entry's position in the hash, the driver's per-item filter, the runner's *add another*); and the
parser's refusal of a repeated field reference. Each was applied to a file on disk, **read back
from disk to prove the edit landed** (byte-compared against a copy taken first), run against the
tests that govern it, and restored from that copy — never from `git checkout` — with the restore
confirmed byte-identical. The runner and its results are reproduced below from the runs of
2026-09-11.

**Before the audit ran, preparing it found a defect. On the first pass eleven of fifteen were
caught. Three of the four misses were weak tests, and are now strong; the fourth is redundancy,
kept and labelled.**

## The defect found while preparing M3

M3 removes the companion from the preview's hash. Writing the mutation meant reading the line it
mutates, and the line read:

```
`${attachment.companion.fieldRef}={attachment.companion.text}`
```

— the field reference interpolated, and the text **not**: the literal characters
`{attachment.companion.text}` were hashed beside every companion. P93 declared the companion
inside the yes, tested that it was named beside the attachment, and never tested that its *value*
was in the hash. The same shape as the P86 defect ADR-0102 §7 records: a hash parameter declared
and not hashed, agreed with by a test that did not hold the rest fixed.

Fixed in this phase, test first: *"binds the yes to the companion's VALUE: a different mark
beside the same document changes the hash"* holds the entries, the document and the slot fixed
and changes only `whenAttached` from `now` to `later`. It failed against the line above — the two
hashes were identical — and passes with `${attachment.companion.text}`.

## The fifteen mutations

| # | Mutation | File | First pass | Now | Caught by |
|---|----------|------|-----------|-----|-----------|
| M1 | The companion check no longer refuses a companion that is mapped as well | `mapping.ts` | **CAUGHT** | — | "REFUSES a companion that is mapped as well, not offered, or not on the blueprint" |
| M2 | The runner attaches and never sets the companion | `execute.ts` | **CAUGHT** ×3 | — | **the journey**: the fixture portal refuses the save without the status, and the run stops there |
| M3 | The companion leaves the preview's hash | `preview.ts` | **CAUGHT** | — | the new value test above, and the P93 preview test |
| M4 | A dependent field may precede the one it follows | `mapping.ts` | **NOT CAUGHT** | **CAUGHT** | the order test, now on a mapped select — see below |
| M5 | The runner never waits for a late option | `execute.ts` | **CAUGHT** ×7 | — | the orchestrator's two wait tests, and **the journey**: the passport-country list has not arrived and the select is refused |
| M6 | The session's wait for an option gives up at once | `playwright-fill-session.ts` | **CAUGHT** ×2 | — | the two browser tests against a list that arrives after 400ms |
| M7 | The typeahead chooses the first of several exact entries | `playwright-fill-session.ts` | **NOT CAUGHT** | **CAUGHT** | "Ireland" offered twice — see below |
| M7b | The typeahead chooses the nearest entry when none is exact | `playwright-fill-session.ts` | **NOT CAUGHT** | **CAUGHT** | "Ital" offering Italy alone — see below |
| M8 | A typeahead without an entry locator is accepted | `mapping.ts` | **CAUGHT** | — | "REFUSES a typeahead that does not say where its entries are" |
| M9 | Every item of a repeating page is rendered from the first item | `plan.ts` | **CAUGHT** ×5 | — | the per-item plan test, the preview's order test, and **the journey**: the portal holds two copies of the first qualification |
| M10 | The ledger no longer tells one item of a repeating page from another | `run.ts` | **CAUGHT** | — | "is a DIFFERENT page for each item"; the journey passed — see below |
| M11 | An entry's position leaves the preview's hash | `preview.ts` | **NOT CAUGHT** | **NOT CAUGHT** | — (see below) |
| M12 | The driver hands every item's instructions out with each item | `run-driver.ts` | **CAUGHT** ×3 | — | **the journey**: each item's claim carries only its own four instructions |
| M13 | A repeated field reference parses | `parse.ts` | **CAUGHT** | — | "refuses a fieldRef that two pages share, naming the second" |
| M14 | The runner never presses *add another* | `fill-application.ts` | **CAUGHT** ×3 | — | **the journey**: the form stays hidden and the fields are not found |

## M4 — refused, for the wrong reason

The order rule was tested on `given_name` made to follow `nationality`. Removing the order rule
still refused it: `given_name` is a text field, and the *next* rule — a dependent must offer
options — refused it in the order rule's place, with the same refusal kind. The test asserted the
kind and the field, and passed. It now puts the dependency on `nationality`, a mapped select that
precedes `passport_country`: nothing but the order rule can refuse that, and the detail is
asserted to say *comes after it*. M4 fails it.

## M7 and M7b — the two ways to choose wrongly, neither exercised

The typeahead's rule is *the one entry whose text equals the text*. The browser test typed "Ira"
(offering Iran and Iraq: two near entries, no exact one) and "Atlantis" (nothing). Neither
distinguishes the rule from its two nearest wrong neighbours: choosing the **first** of several
exact matches, and choosing the **nearest** when none is exact. M7's first form, changing only the
wait loop's condition, was not a behavioural mutation at all — the refusal after the loop still
held — and was rewritten to change the refusal. The fixture list now carries "Ireland" twice, and
the test types "Ireland" (two exact: nothing chosen) and "Ital" (Italy alone, not exact: nothing
chosen). M7 and M7b each fail exactly one of those lines.

## M10 — the unit test is the catch; the journey was not

Removing the item from `pageFillTarget` fails the orchestrator's identity test and **passes the
journey**. That surprised me and is worth saying: with the item gone, the two items' targets still
differ, because the *values* differ — Sharif is not Farzanegan — so the ledger told them apart by
content. The item in the key matters for the case the journey does not stage: two identical
entries, which a student can have (two qualifications with the same fields entered, or one page
saved twice by a portal that lists the same thing). The unit test states the property directly
and is the reason M10 is caught.

## M11 — the mutation the sort already answers

Removing the entry's index from the hash line fails **no test**, including the one written to
catch it. The preview's hash sorts entries by field reference with a stable sort, so the two
lines for `qualification_level` stand in item order whether or not the index is written, and
swapping the items changes the hash without it. The index is redundancy over a sort's stability
— a property that would otherwise be implicit in an engine guarantee. It is kept, and the comment
on the line now says exactly what this audit measured. This is the same answer P77 gave for its
M10.

## What this audit did not mutate

- The wire's parsing of `optionsAfter`, `typeahead`, `item` and `repeat`: each has a line in the
  contracts suite through the round-trip tests, and `contract-drift.test.ts` carries a plan
  through both sides.
- The parser's reading of `repeats` and its refusal of a non-list: the catalogue tests state
  both.
- The zero-times rule for an unconfirmed optional block: the plan test states it; a mutation
  making it ask would fail every harness whose profile has no qualifications.

## The runner

```
for each mutation: cp file file.bak; apply the one replacement (assert it occurs exactly once);
cmp file file.bak must differ; vitest run <governing files>; cp file.bak file; cmp must match
```

Governing files: M1, M4, M8 `mapping.test.ts`; M2, M12, M14 `journey.test.ts`; M3, M11
`preparation.test.ts` (+ `orchestrator.test.ts` for M3); M5 `orchestrator.test.ts` +
`journey.test.ts`; M6, M7, M7b `preparation.test.ts` (browser lane); M9 `mapping.test.ts` +
`preparation.test.ts` + `journey.test.ts`; M10 `orchestrator.test.ts` + `journey.test.ts`; M13
`catalogue.test.ts`. Real PostgreSQL and Redis for the journey, as in CI's integration job.
