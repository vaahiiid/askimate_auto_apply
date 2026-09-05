# P32 — deliberate regression audit

Six mutations against the two storage gates, the derivation that keys one of them, the type that
makes both unbypassable, and the rule that keeps document bytes out of the record. Each was applied
to a file on disk, **read back from disk to prove the edit landed**, run against the control that
governs it, and restored from a byte copy taken before the edit — never from `git checkout`, every
restore confirmed byte-identical by `cmp`.

**All six were caught.**

| # | Mutation | File | Result | Caught by |
|---|----------|------|--------|-----------|
| M1 | The lawful-basis gate is removed; retention alone decides, as before P32 | `vault.ts` | **CAUGHT** ×6 | the lawful-basis group |
| M2 | A determination's declared `documentTypes` scope is ignored | `vault.ts` | **CAUGHT** | scope refusal |
| M3 | The storage activity collapses onto the **sending** activity | `vault.ts` | **CAUGHT** ×2 | wrong-activity refusal |
| M4 | The port's signature is widened back to `DocumentUpload` | `vault.ts` | **CAUGHT** | the bypass assertion |
| M5 | The retention gate is dropped; the lawful-basis gate alone decides | `vault.ts` | **CAUGHT** ×6 | the retention group |
| M6 | The stored record carries the document's bytes | `in-memory-vault.ts` | **CAUGHT** | the no-contents assertion |

## M1 and M5 — the two gates are genuinely independent

The pair is the point. M1 removes the lawful-basis gate and six tests fail while every retention test
passes; M5 removes the retention gate and six fail while every lawful-basis test passes. Neither gate
is shadowing the other, and neither is doing the other's job:

> A period somebody justified is not a basis for holding the data, and a basis for holding it says
> nothing about for how long.

M1 is also the exact state of the code before this phase, so its failure list is the measurement P31
made, now expressed as a suite.

## M3 — the mutation that would have looked harmless

Making `storageActivityFor` return `disclose_document_to_institution` means a deployment that
determined a basis for **sending** documents would silently satisfy the gate for **holding** them.
It compiles, every fixture still has a determination, and nothing about the shape of the code looks
wrong.

It is caught because the suite registers a sending determination and asserts that storing is still
refused — which is `authoriseDisclosure`'s own first check, read in the opposite direction. That test
exists precisely because this is the plausible mistake, not a contrived one.

## M4 — the mutation nothing behavioural can catch

Widening `store(upload: StorableUpload …)` back to `DocumentUpload` compiles cleanly and **every
behavioural test still passes**, because every call site already passes a gated value. The property
it destroys is not "this call refuses" but "an implementation that has not been written yet cannot
skip the gate" — and no test of the current implementation can observe that.

So it is asserted against the source, the same answer P29 and P30 gave for an unreachable branch and
for a boundary rule:

```
× cannot be bypassed by an implementation that forgets to call it
  → the port takes the branded value
```

Recorded plainly: this is a data assertion, not a behavioural one, and it is the honest form for a
property that lives in a type.

## M6 — the leak that would reach everything downstream

Adding the bytes to `DocumentRecord` is caught by the assertion that the record's keys contain no
`contents` and that its serialised form contains none of the bytes. The record is what every log,
every error object and every snapshot downstream carries, so a byte that reached it would reach all
three — which is why brief §8 says audit records reference document IDs, never contents.

## What was not regressed, and why

- **`requireLawfulBasis` and `requirePolicy` themselves.** Both have their own suites in the packages
  that own them. Re-mutating them here would test somebody else's control.
- **The transmission gate.** Untouched by this phase, and already regressed where it lives.
- **A production vault.** There is none. The S3 + KMS implementation does not exist, which is the
  whole reason the invariant had to become structural rather than conventional: the implementation
  that could have skipped the gate is the one nobody has written yet.
