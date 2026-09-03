# ADR-0057 — An approval binds to content, not to what the content says about itself

**Status:** **Accepted** — Vahid's decision, 2026-09-03
**Amends:** [ADR-0017](./0017-mapping-is-reviewed-data.md) §1 — which gate is load-bearing once
artefacts are loaded rather than compiled in
**Depends on:** [ADR-0003](./0003-versioned-migrations-not-push-force.md) (the checksum precedent),
[ADR-0004](./0004-branded-types-for-confirmed-values.md), [ADR-0009](./0009-requirements-provenance-and-verification.md)

## The measurement that produced this ADR

`checkExecutable` and `checkUsable` are the two gates between an artefact and a real application
run. Before writing a line of P20, both were given a blueprint and a mapping set invented from
JSON — no discovery run, no reviewer, a portal that does not exist — with `status: "reviewed"`,
a `reviewedBy` and an `authoredBy` that differ:

```
checkExecutable  -> EXECUTABLE
checkUsable      -> USABLE
authoredAt is a  -> [object String]
```

Both passed. The third line is a separate defect in the same act: `authoredAt` is typed `Date` and
a JSON cast produces a `String`, so the object lies about its own types as well as its provenance.

**This is not a defect in those gates.** Until now the only producer of an artefact was a typed
fixture compiled into the process, so there was nothing for them to defend against. They check
*integrity* — is this set internally consistent, pinned to the right blueprint version, not
self-reviewed — and they do that correctly.

What they cannot do is tell a reviewed artefact from bytes that claim to be one. `status`,
`reviewedBy` and `reviewedAt` are fields **inside the artefact**, and an artefact is not evidence
about itself. The moment a loader exists, those fields become attacker-controlled input.

So the danger in P20 was never the missing parser. **A parser is what creates the hole**, and the
integrity model had to be designed with it rather than after it.

## The decision

> Vahid, 2026-09-03: *"The artefact's self-declared review fields must not be the source of truth
> for whether production code considers it reviewed."*

Production code decides an artefact is reviewed by **one** question: does an independent registry
hold an approval for the hash of this exact content?

```
   bytes ──parse──▶ artefact ──canonicalise──▶ canonical bytes ──sha256──▶ hash
                                                                            │
                                        registry ◀───────────────────────────┘
                                            │
                              approved?  ───┴───▶  no  ──▶ REFUSED
                                            │
                                           yes ──▶ the catalogue may serve it
```

Four properties follow, and each is a test:

1. **A parse rebuilds, it never casts.** Every field is read, type-checked and reconstructed;
   `Date` fields are coerced from ISO-8601 and an unparseable one refuses. Unknown fields do not
   survive, so what is hashed is exactly what the system will act on.
2. **The canonical form is the artefact.** Raw JSON is a transport encoding: key order and
   whitespace are not content. Canonicalisation sorts keys, renders dates as ISO-8601 `Z`, drops
   absent optionals, and preserves array order — because array order *is* content.
3. **The hash binds the approval to that canonical form.** Alter anything the system acts on and
   the hash moves, and the approval no longer applies. Nothing about *who* the artefact claims
   reviewed it enters the calculation.
4. **The registry enforces the two-person rule, not the artefact.** `approvedBy` and `authoredBy`
   live on the *approval*, where they are the registry's own record rather than the reviewed
   party's own claim about itself.

### What the hash deliberately does not cover

`portalOrigin` — which deployment of a portal to run against — is **not** part of the reviewed
artefact and is not hashed. It already had this status: `CatalogueEntry.portalOrigin` exists
precisely so a reviewed blueprint can be run against a university's UAT environment without
rewriting the blueprint, which would mean running something nobody reviewed. It is supplied at
load time by configuration and remains a deployment fact.

Everything a specialist reviews *is* covered: both artefacts, the institution/course/intake
identity, the required documents, the observed portal authentication and the password-delivery
decision.

## Why the registry lives in this repository, for now

> Vahid, 2026-09-03: *"For now, build the registry inside this repository. Do not integrate the
> critical P20 path with the existing AskiMate KB workflow yet… I want the integrity model to be
> explicit, independently testable and fully controlled within this repository first."*

ADR-0019 says requirement *curation* rides on AskiMate's existing `kb_pending_entries` → approval →
`kb_entries` workflow, and warns against inventing a new authority hierarchy. That reasoning
transfers, and this ADR does not overturn it — it sequences it.

The distinction that makes both true at once:

| | |
|---|---|
| **Cryptographic and governance truth** — what content was approved, by whom, and whether these bytes are it | Here. Testable with no external system. |
| **The operational review experience** — where a human sits to read a draft and press approve | A later integration decision. |

`ApprovalRegistry` is therefore a **port**, and `InMemoryApprovalRegistry` and the file-backed
adapter are two implementations of it. An AskiMate-KB-backed adapter is a third, and adding one
requires no change to the parse, the canonical form, the hash or the loader. That is the clean
authority boundary Vahid asked to preserve, expressed as an interface rather than as an intention.

## Consequences

- **A production catalogue can be loaded without any way to mint an unreviewed artefact.** That was
  the blocker recorded in `docs/deployables.md`, and it is the one this closes.
- **An empty registry refuses everything, and that is correct.** It is the honest state of a system
  where no real artefact has been through two people yet. Nothing is seeded to make a demonstration
  work.
- **A reviewer reviews the canonical form.** `pnpm run catalogue` prints it and the hash it
  approves, so the thing signed for and the thing hashed cannot drift apart.
- **Editing an approved artefact requires a new approval.** Exactly as editing an applied migration
  trips `MigrationChangedError` (ADR-0003). The same discipline, for the same reason.
- **The fixture catalogue is unaffected and stays refused in production.** It remains a
  test-controlled artefact, and P20 does not promote it into anything else.

## What this ADR does not decide

Whether AskiMate's KB workflow becomes the registry's operational front end; who the second
reviewer is; and whether any real university artefact exists yet. Discovery remains network-blocked
and document retention remains unapproved, so P20 delivers a trustworthy loader for artefacts that
do not exist yet. That is deliberate, and it is stated here so nobody later reads a green test
suite as evidence that a real portal has been reviewed.
