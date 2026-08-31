# ADR-0043 — A credential field is mapped to the Secure Plane, not to data

**Status:** **Accepted** — Vahid's decision, 2026-08-31
**Extends:** [ADR-0026](./0026-a-password-the-model-can-ask-for-and-never-see.md) (a password the model never sees),
[ADR-0042](./0042-the-credential-is-consumed-inside-the-secure-plane.md) (the fill agent),
[ADR-0017](./0017-mapping-is-reviewed-data.md) (mapping is reviewed data),
[ADR-0004](./0004-branded-types-for-confirmed-values.md) (branded confirmed values)

## The contradiction

Building the first blueprint for a portal that actually requires an account produced two approved
rules that could not both be satisfied:

| Rule | Where it lives | Says |
|---|---|---|
| No mapping may target a password field | ADR-0026, ADR-0042 | there must be **no** mapping |
| Every **required** field must have a mapping | `packages/mapping/src/plan.ts` — an unmapped required field is a `no_mapping` blocker | there must be **a** mapping |

The password field on `/register` is genuinely required — `required`, `minlength=8` — so the
blueprint cannot honestly say otherwise. Run against it, `nextStep` answered:

```
specialist / no_mapping
  Required field "Password" has no mapping. A specialist decides what belongs here
```

`checkUsable` passed and `planFill` refused. Both rules were right in isolation.

**The root cause was an absence.** `ValueSource` had four members — `profile_field`, `document`,
`student_handoff`, `constant` — and **no way to say "the Secure Plane fills this."** The
orchestrator had no concept of a field satisfied by the credential path rather than by data, so a
specialist authoring the mapping set faced a question with no correct answer.

## The decision

**A fifth `ValueSource`: `{ kind: "secure_credential", purpose }`. A marker, and nothing else.**

Vahid, 2026-08-31: *"Add secure_credential as the fifth ValueSource, as a marker only. It must never
contain plaintext, a credential value, or a profile field reference. Route it separately through the
credential path. Enforce bidirectionally that credential/password fields may only use
secure_credential, and secure_credential may only target credential/password fields."*

### It cannot hold a value, and that is structural

The member has exactly two fields: `kind` and `purpose`, where `purpose` is one of two closed-set
words already used by the secure plane. There is no `value`, no `fieldKey`, no `format` and no
`documentRef`. A compile-time assertion in `mapping.ts` fails the build if a field is added whose
type is anything but those two literals, so "it must never contain plaintext" is a property of the
type rather than a rule someone reviews for.

It also has no `ProfileFieldKey`. That is the difference between this and every other source: the
other four say *where a value comes from*, and this one says *that no value comes from here* — the
field is filled by the Secure Plane's fill agent, out of the vault, and the plan learns only that
the field exists and needs one.

### Routed separately

`FillPlan` gains a `credentials: readonly CredentialRequirement[]` list. A credential requirement is
NOT a `FillInstruction`: `FillInstruction` carries a `FillValue`, and there is no `FillValue` that
could hold a credential. Keeping them in separate lists means every existing consumer of
`instructions` — the preview, the validator, the executor — continues to see only things that have
values, and cannot accidentally treat a credential as one.

The preview the student authorises therefore shows credential fields as *"filled from the password
you gave in the secure box"* rather than showing anything. There is nothing to show.

### Enforced BOTH ways, in the domain and at the build

Two directions, because one alone leaves a hole:

- **A password field may have only a `secure_credential` mapping.** Without this, a specialist could
  map a password field to `profile_field`, creating the one route from a profile to a credential
  field that ADR-0026 exists to prevent.
- **A `secure_credential` mapping may target only a password field.** Without this, the marker
  becomes a way to say "the Secure Plane fills this" about an ordinary field — which would make the
  fill agent type a password into a name box, and the agent's own masked-field check (ADR-0042)
  would refuse it at the last moment rather than the mapping being refused at review time.

Both are enforced by `checkUsable`, which is the domain authority and returns a refusal a specialist
reads. `scripts/check-boundaries.ts` enforces them again over the fixtures, as defence in depth —
the domain check protects a run, and the build check protects the repository.

## Consequences

- `MappingRefusal` gains two members. A mapping set that breaks either direction is **not usable**,
  so it cannot reach `planFill` — the signature does the work, as it already does for review status.
- The `no_mapping` blocker keeps its meaning. A required credential field now HAS a mapping, so the
  plan is complete and the run proceeds — which is the whole point.
- Nothing about the credential's path changes. It still exists only in the Secure Service's
  submission frame, the vault, and the fill agent's callback. This ADR adds a marker to a plan; it
  moves no plaintext and crosses no boundary.
- `ValueSource` is a closed union consumed by exhaustive switches, so every consumer had to decide
  what a credential means to it. That was the intended cost: a new member that compiled everywhere
  by default would be a member nobody thought about.
