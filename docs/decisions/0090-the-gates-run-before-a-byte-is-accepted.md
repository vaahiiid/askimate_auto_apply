# ADR-0090 — The document transport: the gates run before a byte is accepted

**Status:** **Accepted** — 2026-09-08
**Answers:** **B4**, the last of the five blockers [ADR-0067](./0067-aas-obtains-documents-and-the-policy-not-the-design-is-what-blocks.md) §6
enumerated — *"No transport: nothing by which a student can supply bytes"*
**Completes:** [ADR-0068](./0068-the-storage-boundary-refuses-what-adr-0022-says-it-refuses.md), whose gate
has had no production caller since it was written

## Context

ADR-0067 §8, four weeks ago: *"There is no route, no schema and no client surface by which a student
could supply a document."* It listed five blockers and said all of them were policy except this one.

They are all answered now. B5 — hold and reuse (ADR-0078). B1 — eleven periods, row 12 blocking
(ADR-0078). B2 — four determinations (ADR-0087). `other / audit_evidence` decided-refused
(ADR-0088). `national_id` removed, with the two gates it alone needed (ADR-0089). What was left was
engineering, and this is it.

## Decision

**An upload is a two-step exchange, and the split is the control.**

```
POST /v1/conversations/{id}/documents          declare it · THE GATES RUN HERE
  → 201 { intakeId, expiresAt, maxBytes, acceptedContentTypes, contentHash,
          retentionPolicyReference }

PUT  /v1/conversations/{id}/documents/{intakeId}/content    the bytes
  → 201 { documentId, state, contentHash, retentionPolicyReference }
```

### Why not one request with the metadata alongside the bytes

Because the server would have to **read the body to find out whether it was allowed to.**

A refusal that arrives after a passport has crossed the wire has already failed. The bytes were
received, they were in a process's memory, and *"we did not keep them"* is a claim rather than a
structure. Multipart would have been the obvious shape and it has exactly this defect.

The two-step also lets the server **state** the constraints — the byte ceiling for that document
type, the content types it may arrive as, the hash it will check — instead of a client guessing and
being refused. That is ADR-0075's rule one layer out: a refusal a person cannot act on is a defect.

### The property, and what enforces it

> **The gates run before a single byte is accepted.**

Not "before the bytes are stored" — before they are *accepted*. And it is the **type** that enforces
it, not the order of statements in a handler: `openIntake` takes a `StorableUpload`, which only
`assertStorable` can mint (ADR-0068). There is no way to obtain an intake without the retention
policy and the lawful basis having been established for that exact document type and purpose.

`acceptBytes` is the same device one layer out. It returns a branded `AcceptedBytes`, and
`vault.store` takes nothing else, so a buffer nobody checked against the declaration cannot reach
storage.

### The bytes must be the ones the gates were run for

The intake carries the SHA-256 the declaration passed the gates with. The content route recomputes
it over what arrived and refuses a mismatch, and refuses a length mismatch first.

Without it every check upstream would be about a document that was never sent: a student could
declare a two-megabyte personal statement, clear the gates for one, and send a passport. **ADR-0057
binds an authorisation to exact content by hash for the same reason, at the other end of the
journey.** The same-length substitution is the case that proves the hash rather than the length is
doing the work, and it is tested at both levels.

### An intake is spent once, and three failures answer identically

`take` reads and removes in one operation, because a read-then-delete leaves a window in which two
concurrent requests both see an intake open.

An unknown intake id, an expired one and an already-spent one all answer `intake_not_open`,
**deliberately indistinguishable** — telling a caller which is which would say what intake ids exist.

### `DOCUMENT_LIMITS` is total, and deliberately unequal

`as const satisfies Record<DocumentType, …>`: a type added to the union and not to the table does not
compile. A default ceiling for anything unlisted is the shape ADR-0023 refuses — a limit nobody
chose, applied to a document nobody thought about.

The ceilings differ because the documents do. A personal statement is text and a transcript is a scan
of several pages; one ceiling for both means accepting a 20 MB "personal statement" without anyone
having decided that was reasonable. These are **engineering** limits — what a request may cost this
system — not policy, and not determinations.

## Where the bytes come to rest — and what this phase does NOT ship

**The store is in-memory, and it refuses to run in production.**

`assertDocumentStoreIsDurable` throws on `NODE_ENV=production` with an `InMemoryDocumentIntakePort`.
That is ADR-0055's lesson applied: *one* check, called at wiring time, with no configuration check
beside it that would make this one unreachable — the mistake ADR-0055 recorded was two checks of
which only one was load-bearing, so a regression deleted the real one with every test still green.

The alternative was shipping the in-memory store and writing *"not for production"* in a comment,
which is the shape this repository has spent ten phases removing: a record that says the right thing
over code that does not enforce it.

**The durable, encrypted store is the next phase.** It needs envelope encryption under a customer-managed
key (ADR-0010, brief §8), and the honest pattern already exists — `DataKeyProvider`,
`LocalDataKeyProvider`, `KmsDataKeyProvider` and `assertVaultIsProductionGrade` in
`packages/secrets`. It is deliberately not rushed into this phase, because a durable store without
the encryption its own ADR requires would be the thing the constraint constrains, shipped without the
constraint (ADR-0019, read backwards).

Also not built: the client surface. The student's page has no upload control, so
`content_hash_mismatch` and `intake_not_open` are listed in `CANNOT_REACH_THIS_PAGE` with that reason
rather than given wording nobody would see — and moving them into `REFUSALS` is the visible act that
says the upload surface has landed.

## What this changes about the register

**`assertStorable` has a production caller for the first time.** It has been on the
declared-but-unreachable list since P39, for a reason that was never engineering: every policy
blocker in front of it was open.

The register found the move itself, and refused the build until the entry was corrected:

```
✗  assertStorable is on the reviewed unreachable list and now HAS a production caller
   (apps/conversation-service/src/routes.ts). Move it: a stale allow-list is what hides the next one.
```

**Seven declared-but-unreachable capabilities become six** — the first time an entry has left that
table since it was created.

## What was measured, not asserted

**Four deliberate regressions**, each verified by reading the mutated file back from disk and each
restored from a file copy:

| mutation | result |
|---|---|
| Remove the hash comparison | 2 fail — the same-length substitution, at both levels |
| Replace `assertStorable` with a cast | 3 route tests fail **and `pnpm run reachability` fails**, because the register says the symbol has a caller and it no longer does |
| Make `take` read without removing | 1 fails — an intake spends twice |
| Remove the expiry check | 2 fail |

The third of those needed the test suite fixed first. **The expiry regression exposed a vacuous test
of mine:** *"says that starting again re-runs the checks"* called `acceptBytes` inside a `try` and
asserted only in the `catch`, so deleting the check made it pass — no throw, no catch, no assertion.
ADR-0072's shape, and the second one caught in two phases, both in tests written to prevent exactly
it. An `expect.unreachable` now sits after the call, and the regression fails 2 rather than 1.

## A guard that had not been exercised in nine phases

`unreachable-is-documented.test.ts` checked the standing account's stated count with a literal
`/Seven capabilities/` and an `expect(REGISTER_UNREACHABLE.length).toBe(7)` beside it — a guard that
**pinned** the number rather than checking it. When the count moved it failed with *"the word 'Seven'
is now wrong"* and named no replacement.

P49 removed exactly this shape from `adr-status-agrees.test.ts`, where a hand-written
number-to-words map covering 78 to 84 lasted one ADR. It survived here because the count had not
moved since P39: nine phases of a constant is a guard nobody sees fail. It is computed now, both
directions.
