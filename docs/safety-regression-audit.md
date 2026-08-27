# Safety regression audit — 2026-08-27

**Standing directive (Vahid):** *"Keep looking for tests that pass for the wrong reason. Regression
testing should prove that the intended protection actually fails when deliberately weakened."*

**Method:** take a safety guarantee, deliberately break the code that provides it, run the suite,
and record how many tests fail. A guarantee whose weakening changes nothing is not enforced —
whatever the tests say.

---

## Results

| | Guarantee | Weakening applied | Tests failed | Verdict |
|---|---|---|---|---|
| **S1** | Preparation never clicks a submission control | `looksLikeSubmission` returns `false` | **3** | ✅ enforced |
| **S2** | Discovery cannot issue a state-changing request | `POST` added to `SAFE_METHODS` | **5** | ✅ enforced |
| **S3** | `isTransitionAllowed` rejects illegal moves | returns `true` always | **1** | ✅ proportionate — see below |
| **S4** | `checkTransition` rejects illegal moves | returns allowed always | **22** | ✅ strongly enforced |
| **S5** | **Model output cannot become a `ConfirmedValue`** | a conversion function added | **0** | ❌ **NOT enforced** |

### S3 — why one test is the right answer

`isTransitionAllowed` looked under-tested until I checked who calls it: nothing does, except its own
tests and the public export. `decide()` uses `checkTransition`, which is S4. One test for a
convenience helper is proportionate; weakening the guard that is actually used fails 22.

**The lesson is about the method, not the result:** measuring the wrong function would have produced
a false alarm and a pointless "improvement". Check what calls it before concluding.

---

## S5 — the finding

Adding this to `packages/domain` **compiled cleanly and failed no test**:

```ts
export function trustTheModel<T>(text: ModelText): ConfirmedValue<T> {
  return text as unknown as ConfirmedValue<T>;
}
```

This is the system's central safety property — ADR-0004, *model output cannot reach a university
form field* — and the header of `values.test.ts` explicitly claimed the build would fail if a
conversion path were added.

### Why the existing test could not catch it

The `@ts-expect-error` directives are genuine compile-time tests, but each tests **one specific
illegal assignment**:

```ts
// @ts-expect-error — ModelText must never satisfy ConfirmedValue<string>.
const smuggled: ConfirmedValue<string> = generated;
```

A conversion *function* casting through `unknown` leaves that assignment exactly as illegal as
before. The directive stays used, TypeScript reports nothing, the build is green — and the property
is gone.

**A brand cannot defend itself against a cast.** Only a rule about where casts may appear can.

### The fix

`scripts/check-boundaries.ts` now fails the build if any non-test file outside `packages/profile`
casts to `ConfirmedValue`. `applyConfirmation` there is the one sanctioned mint, because a
`ConfirmedValue` means a human read the value back and approved it.

Three cast forms were tested against the check:

| Form | First version of the rule | Now |
|---|---|---|
| `as unknown as ConfirmedValue<string>` | caught | caught |
| `as ConfirmedValue<string>` | caught | caught |
| `as unknown as import("@askimate/aas-domain").ConfirmedValue<string>` | **walked past it** | caught |

The qualified form is the one worth dwelling on. My first rule matched only an unqualified name,
and a smuggled dynamic-import cast stepped straight around it — **a check that a regression can walk
past is not a check**, which is the same lesson as the trace scan that could not see inside a zip
and the store scan that could not see through a private field.

### The guarantee now has two halves

| Half | Prevents |
|---|---|
| Branded types + `@ts-expect-error` | an **accidental** assignment compiling |
| The boundary check | a **deliberate** cast being added anywhere else |

Neither is sufficient alone, and that is now stated in `values.test.ts`, in ADR-0004 and here —
rather than assumed in one place.

---

## What this audit did not cover

Named so the gap is visible rather than implied:

- The preview and authorisation gates (areas 13–14) were not weakened this round.
- The disclosure gate (ADR-0022) was not weakened.
- The retention engine was not weakened.
- The secret channel was audited when it was built — six regressions, all caught — and was not
  re-audited here.

These are candidates for the next pass. The absence of a finding above is not evidence about them.
