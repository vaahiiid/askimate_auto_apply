# ADR-0044 — The confirmed profile has its own store; the event log stays a record of events

**Status:** **Accepted** — Vahid's decision, 2026-08-31
**Extends:** [ADR-0002](./0002-aas-owns-the-confirmed-profile.md) (AAS owns the confirmed profile),
[ADR-0004](./0004-branded-types-for-confirmed-values.md) (branded confirmed values),
[ADR-0031](./0031-one-conversation-event-log.md) (one conversation event log),
[ADR-0003](./0003-versioned-migrations-not-push-force.md) (forward-only migrations)

## The gap, reported at the time rather than assumed

`docs/durable-execution-architecture.md` §12 recorded it when durable runs were designed:

> **Phase 5 — profile durability (the §4 gap)**
> `ConfirmedProfile` is not reconstructible from the event log by existing design. Either persist it
> under its own port, or require it as a resume input.
> **This needs your decision** — it is a change to what the event log is for.

Confirmed in code before deciding: `ConfirmationCaptured` carries `{ type, confirmationRef }` and
nothing else, and `packages/profile` has no store, port or repository of any kind — it is pure.

The gap blocks everything downstream. `nextStep`'s order is blockers → **interview** → account and
secret → validation → preview → authorisation → execute. The interview must finish before a run
reaches the secure step, and an interview spans many HTTP requests. Without a durable profile every
request re-derives an empty one, and a run can never leave `interviewing`.

## The decision

**Persist the confirmed profile behind its own port, in the Conversation Plane's database. The event
log continues to record that a confirmation happened, by reference.**

Vahid, 2026-08-31: *"Persist ConfirmedProfile behind its own port in the Conversation Plane
database. Keep the event log as a record of events rather than a copy of profile values.
ConfirmationCaptured should continue to reference the confirmation rather than embedding the
profile. Resume must reconstruct the confirmed profile from the dedicated store."*

### What the event log is for, unchanged

`ConfirmationCaptured` keeps its shape. The log answers *what happened and when, and who agreed to
it*; the store answers *what the value is*. That separation is deliberate and it is the reason this
needed a decision at all: widening the event would have made the log a copy of the profile, and a
log that duplicates a mutable projection is a log that disagrees with it eventually.

The `confirmationRef` is the join. An event says "the student confirmed `identity.given_name`, and
the confirmation is `conf-…`"; the store holds the value that reference names, with its provenance.

### The port, and the mint that stays where it was

`ConfirmedProfileStore` is a port with two operations — load a student's profile, save one entry —
and `packages/profile` still holds the ONLY code that mints a `ConfirmedValue` (`applyConfirmation`,
ADR-0004). The store does not mint: it round-trips values that were already minted, and rehydrates
them with the provenance they were minted with. A store that could construct a `ConfirmedValue` from
a database row would be a second mint, and the whole branded-type guarantee rests on there being
one.

That is why the stored row keeps the provenance — who confirmed it, when, from what proposal — and
why rehydration lives in `packages/profile` itself, beside `applyConfirmation`. The existing
boundary check is package-scoped: `as ConfirmedValue` is legal in `packages/profile/src/` and
nowhere else. Putting rehydration anywhere else would have meant either widening that rule or
casting in a service, and both are worse than one more function in the package that already owns
the guarantee.

### Where it lives, and why not in a third database

The Conversation Plane's database. It already owns students, conversations and — since P1 — cases,
and the profile belongs to a student. ADR-0037 keeps the system at two databases; a third store for
this would be a third thing to migrate, back up and keep consistent, for data that has exactly one
owner.

The **Secure Plane's** database is emphatically not a candidate and the reason is worth stating: a
confirmed profile is the student's personal data in plain text, and the secure plane is the one
place kept free of anything that outlives a request.

## Consequences

- A new migration adds `profile_entries`, keyed by (student, field key), holding the value, its type
  and its provenance. Forward-only, per ADR-0003.
- `resumeRun` gains what it documented it could not do: the Run Driver now loads the profile from the
  store, so a restarted process resumes an interview where it left off rather than at the beginning.
  The comment in `durable.ts` naming this an open gap comes out.
- **A checkpoint is still disposable.** Discarding every checkpoint must still lose no business fact,
  and the profile store is a business fact — so it is not a checkpoint and is never discarded with
  one. The existing contract test that asserts this keeps its meaning.
- The profile is mutable by design: a student who corrects an answer overwrites an entry. That is
  what makes it a projection rather than a log, and it is why the log records the confirmation
  events separately — the history is there, in the place built for history.
- Nothing about the credential path changes. A password is never a `ConfirmedValue` (ADR-0026), so it
  has no profile entry and no row here. The boundary check that stops the conversation plane naming
  a vault or a resolver is unaffected.
