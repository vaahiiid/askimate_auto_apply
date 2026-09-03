# The five deployables — responsibility, configuration, startup, shutdown

**P18, 2026-09-03.** The architecture check Vahid asked for before implementation:
*"map the five deployables and their startup responsibilities clearly … Do not
accidentally create a sixth or merge boundaries that existing ADRs deliberately
separated."*

Governed by [ADR-0037](./decisions/0037-service-topology-and-deployment.md) (topology
and trust levels), amended by [ADR-0052](./decisions/0052-the-system-acts-when-nobody-is-watching.md)
(the fifth deployable), with [ADR-0042](./decisions/0042-the-credential-is-consumed-inside-the-secure-plane.md)
and [ADR-0045](./decisions/0045-the-runner-pulls-leased-work.md) fixing the two
boundaries most easily eroded by a careless entry point.

## The count, and why it stays five

| # | Process | Plane / trust level | Inbound | Databases |
|---|---|---|---|---|
| 1 | **Conversation Service** | Conversation | HTTPS from browsers + internal | conversation |
| 2 | **Secure Interaction Service** | Secure | HTTPS from browsers (iframe) + internal | secure |
| 3 | **Fill Agent** | Secure | internal only | **none** |
| 4 | **Automation Runner** | Browser | **CDP only** (ADR-0045) | **none** |
| 5 | **Background Worker** | Conversation | **nothing** (ADR-0052) | conversation |

**No sixth process is introduced.** Two things that might have become one are
deliberately not:

- **Migrations are a COMMAND MODE of the owning service, not a process.**
  `aas-conversation-service migrate` and `aas-secure-service migrate` are the
  same binaries with a different first argument. A separate migrator deployable
  would need both planes' database credentials to be useful, which is exactly
  the single-process-holds-both-planes shape ADR-0037 exists to prevent.
- **The worker does not absorb the secure plane's loops.** ADR-0052 §13.0 is
  binding: the Secure Service drains its own outbox in-process, because a worker
  that drained it would be the one process whose compromise yields both
  databases.

## Two processes deliberately have no health endpoint

Vahid's P18 list includes health endpoints. Three processes get one; two do not,
and the reason is an accepted decision rather than an omission.

ADR-0045, on the runner: *"Nothing calls into this process. ADR-0037 gives it
exactly one inbound port — a CDP endpoint reachable by the fill agent alone —
and an HTTP control API would be a second inbound surface on the component that
loads pages we do not control and is the most likely thing in this system to be
compromised."* ADR-0052 says the worker *"listens on nothing"*.

A `/healthz` is not a control API, but it is an inbound surface, and it would be
one on the two processes whose whole design is that they have none. So:

| Process | Liveness | Readiness |
|---|---|---|
| Conversation Service | `GET /healthz` | startup checks passed before `listen` |
| Secure Interaction Service | `GET /healthz` | as above |
| Fill Agent | `GET /healthz` | as above |
| Automation Runner | **the process is alive** | it exits non-zero if it cannot start |
| Background Worker | **the process is alive** | it exits non-zero if it cannot start |

For the last two, "did it start correctly" is answered by the exit code and
"is it working" by what it logs. A supervisor that can see a process is the
right monitor for a process that listens on nothing.

## 1 · Conversation Service — `aas-conversation-service`

**Responsibility.** The student's conversation, the case, the run driver, and the
internal work API the runner pulls from. The only plane a browser session
authenticates against.

| Variable | Required | Notes |
|---|---|---|
| `AAS_CONVERSATION_DATABASE_URL` | yes | conversation plane only. Never the secure database. |
| `AAS_SESSION_SECRET` | yes | ≥ 32 chars. Signs the `__Host-` cookie. Never logged. |
| `AAS_PORT` | yes | |
| `AAS_SECURE_ORIGIN` | yes | where the student's browser loads the secure iframe from. **https in production.** |
| `AAS_SECURE_INTERNAL_URL` | yes | where THIS service opens secure requests. Private subnet. |
| `AAS_SECURE_SERVICE_TOKEN` | yes | this service's identity to the Secure Service (mTLS in production). |
| `AAS_SERVICE_CERT_SECURE` | yes | the certificate the Secure Service presents for the internal append. |
| `AAS_SERVICE_CERT_RUNNER` | yes | the certificate the Runner presents for claim/report. |
| `AAS_CATALOGUE` | yes | `fixtures` only, and **refused in production** — see "What still blocks production". |
| `AAS_PUBLIC_DIR` | no | built client. Absent serves the API alone. |
| `AAS_DEV_SESSION` | no | mounts `POST /dev/session`. **Refused in production.** |

**Startup checks, in order.** Configuration parses and every problem is reported
at once → `NODE_ENV=production` rejects `AAS_DEV_SESSION` and a non-https secure
origin → the database is reachable → **there are no pending migrations** → the
catalogue source resolves → then, and only then, `listen`.

**Shutdown.** `SIGTERM`/`SIGINT` → stop accepting connections → let in-flight
requests finish (bounded) → end the pool → exit 0.

## 2 · Secure Interaction Service — `aas-secure-service`

**Responsibility.** The one HTTP service that receives a student's password
(ADR-0034), the cross-origin control document, and — since P14 — its own outbox
drain and expiry sweep in-process.

| Variable | Required | Notes |
|---|---|---|
| `AAS_SECURE_DATABASE_URL` | yes | secure plane only. Never the conversation database. |
| `AAS_PORT` | yes | |
| `AAS_SECURE_SELF_ORIGIN` | yes | this service's own origin. |
| `AAS_CONVERSATION_ORIGIN` | yes | the parent frame permitted by CSP `frame-ancestors`. |
| `AAS_CONVERSATION_INTERNAL_URL` | yes | where the outbox delivers transitions. |
| `AAS_CONVERSATION_SERVICE_TOKEN` | yes | this service's identity for the internal append. |
| `AAS_SERVICE_CERT_CONVERSATION` | yes | the certificate the Conversation Service presents. |
| `AAS_SERVICE_CERT_AGENT` | yes | the certificate the Fill Agent presents. |
| `AAS_ENVELOPE_CACHE_URL` | **in production** | `redis://` or `rediss://`. Absent outside production means the in-memory cache. |
| `AAS_SECURE_KMS_KEY_ID` | **in production** | absent outside production means `LocalDataKeyProvider`. |
| `AAS_SECURE_KMS_REGION` | with the key id | |
| `AAS_SECURE_ASSET_DIR` | no | `control.js` / `control.css`. |

**Startup checks.** Configuration → `assertVaultIsProductionGrade(provider,
NODE_ENV)`, which **throws in production against a local key provider** — the
control the deployment document has always described and nothing has ever
called → the cache is reachable AND its eviction policy is `noeviction` → the
database is reachable → no pending migrations → `listen` → start the drain and
sweep loops.

**Shutdown.** Stop the loops (flushing what is due once) → stop accepting → end
the pool → quit the cache client → exit 0.

## 3 · Fill Agent — `aas-secure-filler`

**Responsibility.** ADR-0042: the credential is spent *inside* the Secure Plane.
This process takes the envelope from the shared cache, decrypts it locally, and
types it into the runner's browser over CDP. It holds no database.

| Variable | Required | Notes |
|---|---|---|
| `AAS_PORT` | yes | |
| `AAS_SECURE_INTERNAL_URL` | yes | where it asks whether a handle may be spent. |
| `AAS_SECURE_SERVICE_TOKEN` | yes | its identity to the Secure Service. |
| `AAS_SERVICE_CERT_RUNNER` | yes | the certificate the Runner presents. |
| `AAS_ENVELOPE_CACHE_URL` | **in production** | **the same cache as the Secure Service.** |
| `AAS_SECURE_KMS_KEY_ID` / `_REGION` | **in production** | **the same key.** |

**Why the cache is not optional in production.** The Secure Service `put`s the
envelope and this process `take`s it. They are different deployables. With
`InMemoryEnvelopeCache` they share nothing, and every handle resolves to
nothing — the failure ADR-0034 exists to fix. P18 ships the Valkey/Redis adapter
so the accepted topology is actually implementable.

**Startup checks.** Configuration → `assertVaultIsProductionGrade` → cache
reachable and `noeviction` → `listen`. **No database check: it has no database,
and an entry point that gave it one would erase ADR-0042's boundary.**

**Shutdown.** Stop accepting → quit the cache client → exit 0.

## 4 · Automation Runner — `aas-browser-runner`

**Responsibility.** Pulls one leased unit of work at a time and performs it in a
real browser (ADR-0045, and the supervisor loop from P16).

| Variable | Required | Notes |
|---|---|---|
| `AAS_CONVERSATION_INTERNAL_URL` | yes | where it claims and reports. |
| `AAS_RUNNER_SERVICE_TOKEN` | yes | its identity for claim/report. |
| `AAS_RUNNER_HOLDER` | yes | which runner this is, for an operator reading the lease table. Never a credential. |
| `AAS_AGENT_INTERNAL_URL` | yes | the Fill Agent, for a credential it must never itself hold. |
| `AAS_RUNNER_SERVICE_TOKEN_AGENT` | yes | its identity to the agent. |
| `AAS_BROWSER_CDP_URL` | yes | its own browser's CDP endpoint, as the agent will dial it. |
| `AAS_CHROMIUM_PATH` | no | |
| `AAS_RUNNER_IDLE_MS` / `_BUSY_MS` | no | supervisor intervals. |

**Startup checks.** Configuration → the browser launches → **no database check
and no database configuration accepted at all.** `check-boundaries.ts` already
forbids the case store in this app's manifest and source; the entry point must
not reintroduce it through configuration.

**Shutdown.** `stop()` the supervisor, which **awaits the turn in flight** —
abandoning a browser mid-portal-action is the situation `assessIntent` refuses to
retry (P16) — then close the browser and exit 0.

## 5 · Background Worker — `aas-worker`

**Responsibility.** ADR-0052: makes the system act when nobody is watching.
Advances every eligible run on its own clock and announces interventions.
Conversation-plane credentials only.

| Variable | Required | Notes |
|---|---|---|
| `AAS_CONVERSATION_DATABASE_URL` | yes | |
| `AAS_WORKER_HOLDER` | yes | which worker holds a job lease. |
| `AAS_SECURE_INTERNAL_URL` + `AAS_SECURE_SERVICE_TOKEN` | yes | the driver opens secure requests. |
| `AAS_CATALOGUE` | yes | as the Conversation Service. |
| `AAS_WORKER_ADVANCE_MS` / `_ANNOUNCE_MS` / `_BATCH` | no | |

**It must never be given secure-plane database credentials.** ADR-0052 §13.0 is
the binding rule and the entry point is where it would be broken.

**Startup checks.** Configuration → database reachable → no pending migrations →
start the loops.

**Shutdown.** Stop the loops, release held job leases so the next worker does not
wait a full lease period, end the pool, exit 0.

## What still blocks production, after P18

P18's startup validator is the executable form of this list. Each of these makes
a process **refuse to start** with `NODE_ENV=production` rather than start and
quietly do nothing.

1. **No identity.** ADR-0038 delegates to a managed OIDC provider and nothing
   implements it. `AAS_DEV_SESSION` is refused in production, so a production
   Conversation Service has no way to sign a student in. Vahid's decision,
   2026-09-03: OIDC is its own phase.
2. ~~**No production catalogue.**~~ **Closed by P20 (ADR-0057).**
   `AAS_CATALOGUE=registry` loads reviewed entries from `AAS_CATALOGUE_DIR` and
   serves only those whose canonical content hash an independent approval
   registry vouches for. The artefact's own `status`/`reviewedBy` are not
   consulted. `AAS_CATALOGUE=fixtures` is still refused in production.

   **What remains open is not the loader but its input:** no real university
   artefact exists to load. Discovery is network-blocked and no artefact has
   been through two people, so a production catalogue directory today is an
   empty registry — which refuses everything, correctly.
3. **KMS has never been exercised against a live key** (`secure-plane-deployment.md`
   §3.1). The configuration path is now real; the first `GenerateDataKey` is
   still an operator's first-run check.
4. **No student document may be stored.** Retention remains UNAPPROVED — 0 of 10
   document types, 12 unresolved questions. Externally blocked, by design.

Items 1 and 2 are the next two phases' subjects. Neither is smuggled into P18.
