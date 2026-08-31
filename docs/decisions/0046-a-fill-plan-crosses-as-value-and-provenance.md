# ADR-0046 — A fill plan crosses to the runner as value and provenance, reassembled through the one mint

**Status:** Accepted · **Date:** 2026-08-31 · **Supersedes:** nothing ·
**Related:** ADR-0004, ADR-0007, ADR-0037, ADR-0039, ADR-0040, ADR-0042, ADR-0045

## Context

ADR-0045 gave the Automation Runner work to do and stopped one step short. Its
closing section:

> **Not decided here.** How the `execute` step's fill plan reaches the runner.
> Its `FillInstruction`s carry `ConfirmedValue<string>`, a branded type that may
> only be minted inside `packages/profile` (ADR-0004, enforced package-scoped),
> and the runner may not depend on that package.

`WORK_KINDS` therefore had one member, and the end-to-end journey stopped at the
account. Filling the form — the thing the whole system exists to do — had no
route to the process that owns a browser.

The obstacle is real rather than bureaucratic. A `ConfirmedValue` is the type-
level record that a student was shown a value and said yes (ADR-0007). It cannot
survive `JSON.parse`: what arrives on the far side is an ordinary object, and
every consumer downstream of it loses the ability to tell a value the student
confirmed from one a model wrote.

## The options, and why the others were rejected

**Strip the brand and send text.** Cheapest, and it loses the guarantee at
exactly the boundary where it matters most — in the process that actually types
into a university's form. The guarantee would still hold upstream, where
`planFill` accepts only a `ConfirmedProfile`, but nothing at the keyboard would
carry it.

**Drive the browser remotely.** The plane runs `executePlan` and the runner
exposes `goto`/`fill`/`click` over the wire. Preserves ADR-0004 completely, and
contradicts ADR-0037: the runner would gain an inbound control API, and its
whole topology entry is *"no inbound from the internet, plus a CDP endpoint
reachable by the fill agent alone"*.

**A fourth deployable.** A Fill Runner inside the Application Plane, holding the
plan and driving the runner's browser over CDP — mirroring ADR-0042 exactly.
Changes no rule and reuses an approved pattern, at the cost of another
deployable and a second process holding a student's personal data.

## Decision

**A plan crosses as its two halves — each value's text and the provenance the
student's confirmation produced — and is reassembled through the mint, in the
package that owns it.**

### 1 · The mint stays in one package

`packages/profile` exports `rehydrateConfirmed({ value, provenance })`: the same
cast `rehydrateProfile` already made, extracted so a second caller can use it.
`packages/mapping` composes plans out of the values it returns and casts
nothing, so `scripts/check-boundaries.ts` still finds `as ConfirmedValue` in
exactly one package.

### 2 · The provenance is carried, never rebuilt

This is the load-bearing half, and it is what separates this from "strip the
brand". A provenance nobody produced is a **lie about a student**:
`student_stated` means they said it, the agent played it back, and they
confirmed it. A plan that arrived as text and had a provenance attached on
receipt would assert all of that about a value whose history was discarded one
process earlier.

So `TransportedValue`'s confirmed branch requires its provenance, a compile-time
assertion (`A_CONFIRMED_VALUE_CARRIES_ITS_PROVENANCE`) fails the build if that
becomes optional, and the parser refuses a confirmed value without one rather
than patching it up.

### 3 · The runner may depend on `@askimate/aas-profile`

The boundary rule that forbade it is narrowed, not removed. Its rationale —
*"browser automation must have no access to application secrets or the primary
database"* — is untouched: profile is neither. `@askimate/aas-orchestrator`
takes its place on the forbidden list, because that package carries
`@askimate/aas-case-store` (and `pg`) and `@askimate/aas-secrets`.

### 4 · `executePlan` moves to `@askimate/aas-execution`

Which is why point 3 works. The runner has to run the executor, and the
orchestrator is the wrong package to take: a database driver and a vault in the
tree of the process that loads untrusted pages is exactly what the rule forbids,
transitively or otherwise.

The move is also right on its own terms. `executePlan` is a pure function over a
session and a plan; it reads no run state, writes no checkpoint, and decides
nothing about what happens next. Its four real dependencies are blueprint,
disclosure, domain and mapping. It was in the orchestrator because that is where
it was written. The orchestrator re-exports it, so no existing caller changes.

### 5 · An untransportable plan is refused, not trimmed

`toStoredPlan` refuses a plan with uploads, handoffs or blockers. A plan with
its uploads silently removed would report itself complete having attached
nothing, and the student would be told their application was filled. Documents
are a separate capability the runner does not have — `@askimate/aas-documents`
stays forbidden — so a plan needing them is not work for a runner.

### 6 · The session is passed in, because the form is behind a login

Creating the account signs the student in; the portal sets a cookie exactly as
it would for a person, and the application form is unreachable without it. A
fill that opened its own context would arrive logged out and have no way back —
the password was single-use and is gone. So the caller supplies the context, and
a run that has lost it is refused with `needs_the_student` rather than being
allowed to create a second account.

## Consequences

**Good.** The runner can do the work the system exists to do. The mint stays in
one package and the boundary check is unchanged. A confirmed value that reaches
a university's form still carries the confirmation that made it one, in the
process that types it. Extracting the executor removes a database driver and a
vault from the runner's dependency closure — a strictly better position than
before this ADR, when the runner simply could not run it.

**The cost.** The runner now holds the student's confirmed answers in memory
while it types them. It always would have: that is what filling a form is. What
changes is that this is now stated rather than avoided by not doing the work.

**The residual, stated plainly.** A compromised runner can read what it typed —
the same residual ADR-0042 records for the credential, and for the same reason:
it owns the browser. What the architecture protects is the data's existence
outside that browser. Nothing here weakens that.
