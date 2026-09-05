# P31 — what this system already assumes about documents

The evidence map ADR-0067 rests on. Every row was read, not remembered; the "reachable" column is by
dependency graph, not by intent.

## 1 · Decisions

| ADR | What it assumes about documents | Load-bearing quote |
|---|---|---|
| [0010](./decisions/0010-policy-driven-document-retention.md) | AAS **holds** them | Answers *"how long do we keep a passport scan"*; *"Design the document vault so that retention periods are configurable and policy-driven."* |
| [0011](./decisions/0011-minor-detection-and-the-minor-workflow.md) / [0013](./decisions/0013-minor-is-not-a-blocker.md) | A minor's route adds document conditions; `[]` blocks, `undefined` does not | conditions are stage-scoped |
| [0016](./decisions/0016-extraction-must-quote-the-document.md) | AAS **reads** them | *"a model asked to read a blurry photograph, having seen a great many passports"* |
| [0021](./decisions/0021-application-requirements-are-not-visa-requirements.md) | Financial evidence is **out of scope** for a UK university application | `scope` is mandatory so a rule cannot default into blocking |
| [0022](./decisions/0022-a-document-in-the-vault-is-not-permission-to-send-it.md) | AAS **sends** them, gated | *"The system must not upload a document to a university merely because the document exists in the vault."* |
| [0023](./decisions/0023-retention-periods-are-determined-not-invented.md) | Holding needs a determined period, or it **blocks** | unresolved is first-class and refuses |
| [0009](./decisions/0009-requirements-provenance-and-verification.md) / [0019](./decisions/0019-requirements-curation-ownership.md) | *Which* documents are required is a **requirement**, with provenance and an evidence bar | *"Do not invent a new authority hierarchy that bypasses these rules"* |
| [0002](./decisions/0002-aas-owns-the-confirmed-profile.md) | **AskiMate holds none** | *"no qualifications, grades, test scores, passport data, financial information, or documents of any kind"* |
| [0034](./decisions/0034-the-vault-is-ephemeral.md) | The Secure Plane is for a **secret**, not a document | ≤5-minute TTL, all persistence disabled, per-request data key zeroed after use |
| [0066](./decisions/0066-three-declarations-name-a-document-and-one-decides.md) | Only the reviewed **mapping** decides an upload | measured in both directions |

## 2 · Code

| Where | What it does | Reachable from a deployable |
|---|---|---|
| `packages/documents` | vault port + in-memory reference; `uploaded → extracted → confirmed → verified → superseded → purged`; `store` gated on retention | **no** — only `packages/extraction` depends on it |
| `packages/documents/validity.ts` | deterministic validity (the 31-day window and friends) | no |
| `packages/extraction` | reads a document into `ProposedValue`s, must quote | **no** — nothing depends on it |
| `packages/disclosure` | `authoriseDisclosure`, `mayTransmit`, `renderDisclosureRequest`, `LawfulBasisRegister` | **yes** — `orchestrator`, `execution` |
| `packages/execution/execute.ts` | loops `plan.uploads`, resolves a `DocumentSource`, gates each on `mayTransmit`, records a `TransmissionRecord` | **yes** — the runner |
| `packages/mapping/plan-transport.ts` | refuses `has_uploads` for transport | yes |
| `packages/preparation/preview.ts` | refuses `document_missing` | yes |
| `apps/conversation-service` | 19 routes, **none** document-bearing | — |
| `scripts/end-to-end.ts` | performs a real upload against a replay, with a stubbed determination | demo only |

## 3 · Policy state, as the system reports it

`pnpm run retention-status`, run for this phase:

```
0.2026-08-26   effective 2026-08-26 · 0 policies · 12 unresolved
approved by: UNAPPROVED — this version exists to record what is open, not to permit storage
```

All twelve are about **holding**, all owned by `data_protection_owner`, and every one names an
external authoritative source. Nothing anywhere reports the lawful-basis side: exactly one processing
activity is declared (`disclose_document_to_institution`), no determination exists, and there is no
activity name for holding at all.

## 4 · What discovery has actually observed

103 real discovery runs against the Ulster Birmingham / QA Higher Education portal.

**Zero file inputs. Zero document requirements.** The application sits behind a login, discovery is
read-only and never signs in (ADR-0014), so the real portal's document requirements are **unobserved**.
The target file still carries *"Required documents: transcripts, certified translations, English test
certificate"* as an unverified `claimsToVerify` entry.

The only blueprint in the repository that declares a document is the local **fixture**, whose file
inputs are `transcript` and `passport`.

So: nothing in this repository yet knows what documents a real application requires. That is an input
to the product decision, not an obstacle to making it.

## 5 · Two claims verified rather than repeated

**No approval exists.** The only `approvals.json` files anywhere are in `/tmp/aas-p20-*` test
directories. The repository has none.

**Field names are inside the content hash.** Two artefacts differing only in what a field is called
hash differently — `sha256:435b98b5…` against `sha256:32c383ba…`. Now pinned by a test in
`packages/catalogue`, and regressed: dropping the key from `canonicalText` fails it.

## 6 · One gap found

`InMemoryDocumentVault` is constructed with a `RetentionSchedule` and nothing else, and `store()`'s
only gate is `assertStorable`. Measured: with a retention policy configured and no lawful-basis
determination anywhere, a document stores. ADR-0022 says *"The system will refuse to act until"*
storing activities are registered; that is true of sending and false of storing.

Not exploitable today — no policy exists and no deployable holds a vault — and deliberately not closed
in this phase, because closing it means deciding where the lawful-basis machinery sits relative to
`packages/documents`, which is a coupling inside the architecture this phase exists to leave
unsettled. Recorded as ADR-0067 §7 and as the first item of P32's scope.
