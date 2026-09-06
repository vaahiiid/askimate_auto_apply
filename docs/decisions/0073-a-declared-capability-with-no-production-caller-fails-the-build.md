# ADR-0073 — A declared capability with no production caller fails the build

**Status:** **Accepted** — approved by Vahid, 2026-09-06
**Follows:** [ADR-0072](./0072-two-decisions-enforced-by-nothing.md) (the audit that produced the method)

## Context

Vahid, 2026-09-06:

> The re-audit's finding was that a quarter of the ADRs checked asserted something production did
> not do, and the question that found them was *"does anything in production call this"*, not
> *"does the code contain this"*. That must stop being a habit and become a check. I do not want a
> thirty-ninth phase discovering a thirty-eighth-phase assumption by hand.

Seven consecutive phases each found the same class of defect:

| Phase | The record | What production did |
|---|---|---|
| P17 | ADR-0045 §4 — a crash is detectable | Nothing detected one |
| P19 | ADR-0038 — a verified-email guard on the secure step | No guard existed |
| P31 | ADR-0022 — the system refuses to store without a basis | It did not check |
| P34 | ADR-0022 — an authorisation is not transferable | It was, between applications |
| P35 | `documentRef` means one thing | It meant two, and the fixture followed the wrong one |
| P37 | ADR-0006 — `decideReapplication` is the single gate | `machine.ts` imported the type |
| P37 | ADR-0006 — the unique key is the second line of defence | Its only caller was a script |

Every one of them compiles, is exported, and is covered by tests. **The tests are the reason the
defect is invisible:** a capability with a thorough unit test and no caller looks, to everything
automatic, exactly like a capability that works.

## Decision

**A capability that a decision says is enforced must have a caller inside a deployable's dependency
closure, or be on a reviewed list that says why it does not and what would close it.**
`scripts/check-reachability.ts` runs inside `pnpm run verify` and in CI.

### What "production" means, precisely

1. **Not a test.** `*.test.ts`, fixtures, and the shared store contract suites are excluded. A
   capability exercised only by its own tests is the exact shape P37 found.

2. **Not a script.** `scripts/` is a demonstration surface. The whole of P37's finding was that
   `scripts/walkthrough.ts` was `claimSubmissionKey`'s only caller — a check that counted it would
   agree with the defect.

3. **Inside a deployable's closure.** The five deployables (ADR-0037, ADR-0052, ADR-0055) and every
   workspace package they transitively depend on. A call site in a package nothing deploys is not
   reachable in production however real the call is: `packages/requirements` has **no dependents at
   all**, so `assessUsability`, called only from there, is called by nothing that runs. Without this
   rule the check would have passed it.

### The register, and why it is a list rather than a sweep

It is deliberately not every exported symbol. The question is about capabilities a **decision**
says are enforced, because those are the ones whose absence is a false record rather than merely
dead code. Each entry names the symbol, the files that declare it, the record, and the promise in
one line — so a failure reads *"ADR-0006 says X, and nothing calls it"* rather than *"unused
export"*.

Three ways the register can be wrong, and all three fail the build:

- an entry marked enforced with no production caller — P37's finding;
- an entry on the reviewed unreachable list that **has** one — a stale allow-list is what hides the
  next finding, so it is a failure and not a quiet promotion;
- an entry naming a file that no longer declares the symbol — the register describing a repository
  that has moved on, which is the same defect one level up.

### It found one immediately

`openReapplication` — which ADR-0006 §3, written in P38 four hours earlier, calls *"the one
constructor for a second attempt"* — **had no production caller.** The run driver built the opening
event itself, with an ordinal and a prior case id passed as two separate fields. The ADR said one
thing and the code did another, in the phase that wrote the ADR.

Fixed rather than allow-listed, and the fix is better than the code it replaced: `#openAndStart`
now takes a discriminated attempt, the domain builds the opening event, and the submission key is
claimed for **the identity that event carries** rather than for one the driver assembled beside it.
Two constructions that could disagree became one.

## What this does not prove

**That a request can reach it.** This answers P37's question — is there a production call site — not
"is there a path from an HTTP route". A function called only by another function that nothing calls
passes. Closing that gap needs a call graph rather than a symbol search; claiming otherwise would be
the kind of confident overstatement the check exists to catch, so the script says so in its own
header.

**Branch-level reachability.** `recommendWait`'s `next_intake` branch has no production caller
because no caller supplies a `nextIntake`, and a symbol-level check cannot see that. It is recorded
in [`state-of-the-system.md`](../state-of-the-system.md) §4 instead.

## Consequences

- Eleven capabilities are checked as enforced. Six are on the reviewed unreachable list, each with a
  stated reason and what would close it: `checkMinorGate` (submission is out of scope, ADR-0014),
  `assertStorable`, `authoriseDisclosure`, `purgeContents` and `attach_document` (all four wait on
  B5, B2 or B1 and the document transport), and `assessUsability` (no deployable depends on
  `packages/requirements`).
- The unreachable list is now a **reviewed artefact with an expiry condition** rather than a fact
  somebody once knew. Each entry names what would close it, so the list can be worked rather than
  merely maintained.
- `scripts/check-reachability.test.ts` runs the real script in a real process against three real
  mutations of the register, because a check that cannot fail is the defect it exists to prevent —
  and this repository has already shipped one of those (ADR-0072, the walkthrough).
- Adding a capability to the register is cheap and adding one to the allow-list requires writing
  down why. That asymmetry is the point.
