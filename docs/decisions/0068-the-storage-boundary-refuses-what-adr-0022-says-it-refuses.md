# ADR-0068 — The storage boundary refuses what ADR-0022 says it refuses

**Status:** **Accepted** — 2026-09-05
**Closes:** [ADR-0067](./0067-aas-obtains-documents-and-the-policy-not-the-design-is-what-blocks.md) §7 and blocker
**B3** — the gap between ADR-0022's stated guarantee and the vault's behaviour
**Amends:** [ADR-0022](./0022-a-document-in-the-vault-is-not-permission-to-send-it.md) — its *"the system will
refuse to act until"* is now true of storing as well as sending
**Depends on:** [ADR-0010](./0010-policy-driven-document-retention.md),
[ADR-0017](./0017-mapping-is-reviewed-data.md) (the pattern this borrows),
[ADR-0023](./0023-retention-periods-are-determined-not-invented.md)
**Still blocked:** B1, B2, B4 and B5 of ADR-0067 §6. Nothing here unblocks a real document

## §1 · The false invariant

ADR-0022:

> Before production, someone must determine and register, at minimum: **storing** identity
> documents, **storing** academic documents, disclosing documents to an institution… **The system
> will refuse to act until they have.**

Measured in P31 and again here. `InMemoryDocumentVault` was constructed with a `RetentionSchedule`
and nothing else, and `store()` had exactly one gate — `assertStorable`, which checked retention.
With a retention policy configured and no lawful-basis determination anywhere in the process, a
document stored:

```
STORED with NO lawful-basis determination anywhere: doc_000001 uploaded
retention policy consulted: PROBE-001
```

True of sending, false of storing. `authoriseDisclosure`'s **first** check is that the determination
names the sending activity, and its message reads *"A basis for holding a document is not a basis
for sending it."* Read the other way round, that sentence describes a gate that did not exist.

## §2 · Why it was structurally weak, not just missing a line

The gate was a **helper an implementation was trusted to call**. `assertStorable` was exported;
`InMemoryDocumentVault.store` called it; nothing made the S3 + KMS implementation — which does not
exist yet — call it too, and nothing would have noticed if it had not.

Every caller of the storage boundary in this repository is `vault.test.ts`. There is one
implementation and no production one. So the correct question was never *"add the check"*; it was
*"where does the check have to live so that the implementation that has not been written yet cannot
skip it?"*

## §3 · The enforcement point

**`assertStorable` is the gate, and its result is the only thing `store` accepts.**

```ts
export type StorableUpload = Brand<
  DocumentUpload & { policyReference: string; lawfulBasis: LawfulBasisDetermination },
  "StorableUpload"
>;

store(upload: StorableUpload, contents: Uint8Array, now: Date): Promise<DocumentRecord>;
```

This is ADR-0017's sentence applied to documents, and it is quoted here because it decided the shape:

> `planFill` takes a `UsableMappingSet`, obtainable only from `checkUsable`. So *"was this
> reviewed?"* is answered by the function signature rather than by a check someone has to remember
> to call.

`InMemoryDocumentVault` consequently holds **no schedule and no register**. It is not that it now
remembers to check — it is that there is nothing left for it to check, and nothing left to forget.
A second implementation cannot store an ungated document because it cannot be handed one.

Rejected alternatives, and why:

| | Why not |
|---|---|
| A second runtime check inside each `store()` | The thing that was wrong. Conventions do not bind implementations that do not exist yet. |
| The gate in orchestration or execution | Neither is the persistence boundary. A caller that went straight to the vault would bypass it, which is exactly the property being fixed. |
| A new policy service | A second source of truth for a decision `LawfulBasisRegister` and `RetentionSchedule` already own (ADR-0041). |

## §4 · The activity name is derived, not invented

`requireLawfulBasis(register, activity)` needs an activity name. ADR-0022 enumerates the storing
activities as *"storing identity documents, storing academic documents… and whatever a minor's route
adds"* — a per-**purpose** granularity — and `lawful-basis.ts` already gives `store_identity_document`
as its own example of an activity name.

So the name comes from `RetentionPurpose`, the closed union that already keys the retention gate:

```ts
export function storageActivityFor(purpose: RetentionPurpose): string {
  return `store_document:${purpose}`;
}
```

Two consequences, both wanted. A document's two storage gates are keyed on the same vocabulary, so
they cannot disagree about which category it is in. And adding a `RetentionPurpose` silently adds a
determination somebody must make, rather than silently widening what may be stored.

Disclosure keeps **one** activity for every document type, because ADR-0022 enumerates sending once.
The asymmetry is the ADR's, not a preference.

## §5 · `documentTypes` is read for the first time

`ProcessingActivity` is *"what is being done, and to what"*, and its `documentTypes` has been declared
since Phase 1 and **read by nothing** — populated in two tests and the demo script, checked nowhere.
The gate now refuses a determination that was not made about the kind of document being stored:
`DocumentTypeNotCoveredError`.

This is honouring a declared scope, not adding policy. A determination for
`store_document:identity_verification` naming `["national_id"]` is a decision somebody made about
national ID cards; relying on it to hold a passport would be relying on a decision nobody made.

## §6 · What is deliberately NOT checked at storage time

A determination's `reviewBy`. `determineLawfulBasis` refuses an expired one when it is **made**, and
`requirePolicy` does not re-check a retention policy's `reviewBy` either — `validateSchedule` reports
staleness and `pnpm run retention-status` prints it, in CI. Adding a second, differently-placed
staleness rule to one of the two gates would be an inconsistency rather than a control. If staleness
should bite at use, it should bite for both, and that is a change to make deliberately.

## §7 · Every place document bytes can exist

Traced, not assumed. Three, and only three:

| Where | Persisted | Encrypted | Reachable by another component |
|---|---|---|---|
| `DocumentVault` — the argument to `store`, and `#contents` in the in-memory implementation | in memory only, today; the S3 + KMS implementation is where "at rest" starts | not by the in-memory one, which says so | via `retrieve`, by document id |
| `packages/extraction` — `contents: Uint8Array` handed to a reader | no | n/a | no |
| `packages/execution` — `AuthorisedDocument.contents`, passed to `session.attach` | no | n/a | no |

`playwright-fill-session.attach` calls `setInputFiles` with an **in-memory buffer**, not a path, so
the runner writes no temporary file. The context is never traced (ADR-0025), and `close()` says so.

Everything else that holds a `Buffer` — `packages/secrets`, `packages/envelope-cache-redis` — is the
**secret** plane, structurally separated by `check-boundaries`, and holds no document.

Searched and found absent: any `bytea` or blob column in any migration; any logging, serialisation or
stringification of `contents`; any document-shaped conversation event. `DocumentRecord` carries a
content hash and no bytes, and now has a test saying so — because the record is what every log, error
and snapshot downstream carries.

## §8 · What this does NOT settle

**Whether transient in-memory bytes are "storage".** ADR-0010 gates `vault.store`; ADR-0023 says an
unresolved requirement *"blocks storage exactly as a missing policy does"*. Neither ADR classifies
bytes held in a process for the duration of an upload. That is a legal question, and ADR-0023
forbids guessing at exactly this kind.

So ADR-0067 §5's **pass-through** shape is neither adopted nor closed off. What can be said precisely
is what changes if it were chosen:

- it would **not** avoid ADR-0022 — the transmission gate and the disclosure determination apply to
  sending, whatever the bytes came from;
- it would avoid `vault.store`, and therefore this gate and ADR-0023's twelve questions, **only if**
  the answer to the classification question is that transient memory is not storage;
- on **retry**, `executePlan` re-resolves the `DocumentSource` for every upload on every execution, so
  something must be able to produce the bytes again. Either it is held — which is storage — or the
  student supplies it again. `attach_document` is already a `ConsequentialAction` and already
  `VERIFIABLE` (*"the application page lists its attachments"*), so the retry semantics exist; the
  byte custody does not.
- **extraction** would create a second in-memory copy and no retained one, so it does not change the
  classification either way.

## Consequences

- ADR-0022's guarantee is true of storing as well as sending, and is enforced by a type rather than
  by a convention.
- The two storage gates are independent and both are required: a justified period is not a basis for
  holding the data, and a basis says nothing about for how long.
- `packages/documents` now depends on `packages/disclosure` for the lawful-basis machinery. No cycle;
  both already depended on `packages/domain`, and the alternative — a second representation of a
  determination — is what ADR-0041 exists to prevent.
- `DocumentVault.store`'s signature and `InMemoryDocumentVault`'s constructor are public contract
  changes, made because ADR-0022 states a guarantee that the previous shape could not provide.
- Nothing is unblocked. B1, B2, B4 and B5 of ADR-0067 §6 still need a person; this phase makes the
  refusal true so that answering them is what unblocks a document, rather than forgetting to.
