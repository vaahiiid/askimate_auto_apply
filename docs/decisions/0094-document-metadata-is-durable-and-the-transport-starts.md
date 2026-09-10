# ADR-0094 — Document metadata is durable, and the transport starts in production

**Status:** **Accepted** — 2026-09-09
**Continues:** [ADR-0093](./0093-an-upload-url-cannot-be-minted-unbound.md), which named this as the
first thing it left unbuilt. **Completes** the chain from
[ADR-0090](./0090-the-gates-run-before-a-byte-is-accepted.md): the transport now exists in the
process, not only in its tests.

## Context

ADR-0093 reshaped the port and said, under *What was not built*: *"`DocumentRecord`s and the object
key each one lives under are held in a Map in both implementations. The bytes are where D puts them;
the record of them is not yet in the conversation plane's database. `assertDocumentStoreIsDurable`
keeps refusing a production start, as it has since ADR-0090, and production wiring of the S3 vault
waits for that phase."*

Three things were true at the end of P60 and none of them was visible from outside a test:

- the intake store was a Map, so two replicas disagreed about what was open and a restart between
  declare and confirm stranded the student;
- the S3 vault's metadata was a Map, so a restart forgot every document whose bytes were in the
  bucket;
- nothing in the entry point could produce the retention schedule, the lawful-basis register, the
  bucket or the key the routes needed, so `options.documents` was never supplied in production and
  the routes answered `service_unavailable` in every deployment.

This decision is the ordinary engineering that closes those three, under the constraints the
earlier decisions set.

## Decision

### The bytes are still not here

Migration `0017_documents.sql` creates `document_intakes` and `documents`. **Neither table has a
column of any type that could hold a document's contents**, and `document-store.test.ts` asserts that
against the migration's text and, at startup, against `information_schema`. The metadata is here; the
bytes are in the bucket (ADR-0092).

### The intake is taken in one statement, and the gates re-run on take

`PostgresDocumentIntakePort.take` is `DELETE … WHERE conversation_id = $1 AND intake_id = $2
RETURNING … expires_at`, and the code refuses the row that comes back when it has expired by the
injected clock. Two concurrent confirms cannot both see it open — tested with three racing takes,
exactly one of which wins — an expired row is never returned, and the same statement has spent it.

(Corrected 2026-09-10. As accepted, this section said the statement was `… AND expires_at > now()
RETURNING …`. That form hid an expired row from a take at the right clock and left it in the table,
where a take at an earlier clock could still find it — and the class read `new Date()` itself, so
its tests' fixtures, fixed at 2026-09-09, failed the morning after. The clock is now injected, as
everywhere else in the service, and expiry is judged on the row rather than in the WHERE clause.)

The row records what the gates relied on (the policy reference, the determination), for the audit.
But the `DocumentIntake` handed back is **not** rebuilt from the row by a cast: `assertStorable` runs
again, against the schedule and register in force now, and `openIntake`'s checks with it. A schedule
that stopped permitting the document between declare and confirm refuses the confirm, in the gate's
own words, and the intake is spent. ADR-0090's sentence — *"the checks that permitted it are re-run,
which is the point"* — is now true of the durable path.

### The vault's metadata is behind a port

`S3DocumentVault` takes a `DocumentRecordStore`: `PostgresDocumentRecordStore` over `documents`, or
`InMemoryDocumentRecordStore` for tests. The class is the same either way, and `durable` says which
it was handed. The `documents` table carries two whole-or-nothing constraints — a purged record
names when, a superseded one names what — and keeps `object_key` and `content_hash` after a purge,
so the audit can say where the bytes were and what they hashed to after they are gone (ADR-0010).

`purgeContents` deletes the object **first** and updates the record second. A failed delete leaves
the record saying the contents exist, which is the truthful state; the reverse order would produce a
record that says purged over an object still in the bucket.

### One durability check, three things it tells apart

`assertDocumentStoreIsDurable` refuses a production start when the intake store is in memory, when
the vault is in memory, or when the S3 vault's record store is in memory — and its message names
which. Still one function, still called once at wiring time, with no configuration check beside it
(ADR-0055's lesson).

### The entry point builds the transport from the environment

`AAS_DOCUMENTS_BUCKET`, `AAS_DOCUMENTS_KMS_KEY_ARN`, `AAS_RETENTION_SCHEDULE_DIR`, and optionally
`AAS_DOCUMENTS_REGION` (which must be `eu-west-2`, ADR-0012). All together or none; a partial set is
refused at startup with every missing name listed. The key must be an **ARN**, because that is what
S3 reports on HEAD and what the confirm compares against; an alias would pass configuration and fail
every confirm.

The retention schedule is loaded from the directory of approved versions by the same parser the
`retention-status` command uses — `parseRetentionSchedule`, moved into the domain package for this
phase so that a schedule that loads in one loads in the other. The governing version is chosen by
`effectiveFor`, the history is checked by `validateHistory`, and the version is checked by
`validateSchedule`; any problem refuses the start. A process enforcing periods nobody could
responsibly say were right is the failure ADR-0023 names.

The lawful-basis register is `b2Register` — the four determinations Vahid made (ADR-0087), in code.

The S3 client carries no credential of its own. It signs with the process's role. Nothing in this
repository's own code reads `AWS_*`; the placeholder variables this sandbox injects are the
verification script's concern (ADR-0092 §4), not the service's.

### Nothing runs against AWS from here

The startup test starts the real process with the transport configured and shows the log line
`documents=s3`, the migration applied, and the tables holding no `bytea`. It sends nothing: the
client is constructed and no request leaves until a declaration is made, which the test does not
make. The first request this service makes to AWS happens on Vahid's deployment, after he sets the
variables — *"Do not run anything against AWS again without telling me first."*

## What was built

- `apps/conversation-service/migrations/0017_documents.sql`
- `document-record-store.ts` (the port, the Postgres and in-memory stores); `S3DocumentVault` over
  it, with `durable`; `PostgresDocumentIntakePort`; the widened durability check
- `config.ts` (`readDocumentsConfig`), `wiring.ts` (`loadGoverningSchedule`, `buildDocumentPort`),
  `app.ts` and `main.ts` plumbing
- `packages/domain/src/retention-file.ts` — `parseRetentionSchedule`, moved from the script
- `document-store.test.ts` (Postgres: take-once, three-way race, expiry, gates re-run, record
  round-trip, purge-is-whole, the durability check's four cases), `config.test.ts`, two startup
  cases in `p18-startup.test.ts`
- [`docs/provisioning-request-document-vault.md`](../provisioning-request-document-vault.md) — the
  service role's policy, the CORS rule, the lifecycle, the variables, the cost, the reach

## What was not built

- **A client surface.** ~~The page has no upload control; `journey.ts` still lists the three transport
  codes as stated absences. That is the phase in which the CORS rule is exercised.~~ **Built in P62 —
  [ADR-0095](./0095-the-page-makes-the-put-and-the-cors-rule-is-exercised.md):** the page hashes,
  declares, PUTs and confirms, the three codes are in `REFUSALS`, and the CORS rule is exercised by a
  real preflight against the rule parsed out of the provisioning request.
- **The retention sweep** that calls `purgeContents` when a period elapses; and the runner's fetch of
  a retrieval URL, which waits until `attach_document` is reachable — B5 is decided (A, hold and reuse, ADR-0078, 2026-09-07) and does not condition it; what is left is engineering: the attachment intent identity ADR-0069 names and a `WorkKind` that can carry it (state-of-the-system blocker 9). Both are in the reachability register with their reasons.
  (Corrected 2026-09-10: this bullet first named B5, a decided blocker, as the thing the fetch was
  waiting for. Vahid caught it; it was stale, not a lost dependency. `decided-blockers-are-not-pending.test.ts`
  now refuses that shape in every record that describes the present.)
- **An intake sweep.** ~~Expired intakes are never returned and are deleted when found by `take`; rows
  nobody confirms stay until then. A periodic delete is a worker job for when the worker has one.~~
  **Built in P63 — [ADR-0096](./0096-expired-document-intakes-are-swept-by-the-worker.md):** the
  worker's fourth job, `sweep_document_intakes`, every sixty seconds under a lease.

**Declared-but-unreachable surface: six, unchanged.**
