# ADR-0055 — A process refuses to start when it is not safe

**Status:** **Accepted** — Vahid, 2026-09-03 ·
**Realises:** [ADR-0037](./0037-service-topology-and-deployment.md) (five deployables) and
[ADR-0042](./0042-the-credential-is-consumed-inside-the-secure-plane.md) (the shared cache), both of
which described a topology this repository could not run ·
**Defers:** OIDC identity (ADR-0038) and a production catalogue, each to its own phase ·
**Companion:** [`docs/deployables.md`](../deployables.md)

## Context — measured on `6b6558f`

Five deployables, and **not one had an entry point.** `createConversationApp`,
`createSecureApp`, `createFillAgentApp`, `startWorker`, `startSecureBackground` and
`startRunnerSupervisor` had, between them, **zero production call sites**: each was a definition and
an export, and the only things that ever started them were tests.

Underneath that, four more absences:

| | |
|---|---|
| **No configuration layer** | Outside the runner's Chromium path and test helpers, this repository read *no* environment variables. `AAS_SESSION_SECRET`, `AAS_DATABASE_URL`, `AAS_SECURE_KMS_REGION`: zero references. `AAS_SECURE_KMS_KEY_ID` appeared once, inside an error message. |
| **No migration caller** | `migrate()` had no non-test caller. A deployed database would have had no schema and no way to get one. |
| **No shared cache** | The only `EnvelopeCache` was in-process, so ADR-0042's two deployables could not share it — `secure-plane-deployment.md` §2 has said so since it was written. |
| **An uncalled control** | `assertVaultIsProductionGrade` — *"a process that will not start is a control"* — had no process to stop. |

This is the reader-with-no-writer shape ADR-0052 named, one level up: P14, P16 and P17 gave those six
pieces of machinery their callers, and **nothing called the callers.**

## The decision

**Every deployable gets a real entry point whose first job is to refuse.**

A process starts only when its configuration is complete, its dependencies are reachable, and
nothing about the deployment is unsafe. Otherwise it prints what is wrong and exits non-zero.

### §1 · Configuration is read once, and every problem is reported together

`@askimate/aas-config` is dependency-free — like `@askimate/aas-contracts`, and for a related
reason: all five deployables import it, including the one that receives a password.

Two properties, both about the operator:

- **Every problem at once.** A reader that threw on the first missing variable would make
  configuring a service a sequence of deploys, each revealing one more thing.
- **No value is ever echoed.** These variables carry a session-signing secret and two database URLs
  with credentials in them, and a startup failure reaches whatever log caught it. A problem names
  the VARIABLE and the RULE. The single exception is a closed set of literals, where *"you wrote
  'fixture', the choices are 'fixtures'"* is the most useful thing the error can say and there is
  nothing to leak.

### §2 · Migrating is a command; starting is a check

`aas-conversation-service migrate` applies pending migrations under a PostgreSQL advisory lock.
Every ordinary start **refuses** if anything is pending.

A service that migrated on boot would migrate once per instance during a rolling deploy, moving the
schema under the previous version while it is still serving. Separating them means a build can never
run against a schema it was not written for, and the failure is a startup error naming the deploy
step rather than a runtime error naming a missing column.

**The two migration commands belong to the two services that own the two databases.** A single
migrator would need both planes' credentials, which is the shape ADR-0037 exists to prevent — so it
is a command mode of an existing binary, not a sixth deployable.

### §3 · The shared cache is implemented, and it verifies the server

`RedisEnvelopeCache` lives in its own package. `packages/secrets` holds the only plaintext in the
system, and a Redis client in its dependency tree would be a supply-chain path into it — the same
argument `check-boundaries.ts` makes for keeping Playwright out of the Secure Service.

- `take` is **`GETDEL`**, one command. A read followed by a delete is a race between two fill
  agents, and what they would be racing for is permission to type a student's password into a
  portal. A deliberate regression proved it: with GET-then-DEL, **all four racing callers got the
  envelope.**
- `verify()` runs at startup and refuses a server whose `maxmemory-policy` is not `noeviction`, or
  that would write ciphertext to disk (`appendonly`, `save`). §3.2 of the deployment document calls
  the first load-bearing: *"silent eviction would look to a student like a spontaneous
  cancellation, and a security control that fails quietly is not one."*
- **A server that refuses `CONFIG GET` fails the check.** Inconvenient on some managed offerings,
  and still right: this check exists to establish a property, and "I could not ask" is not "it
  holds".

### §4 · The vault control is where the decision is made, not beside it

`keyProviderFor` chooses the data key provider and asserts it, in one function both secure-plane
processes call.

This shape came from a failed regression rather than from design. The first implementation called
`assertVaultIsProductionGrade` in the Secure Service's entry point — and deleting that call changed
nothing, because the service's *configuration* already refused a production start without
`AAS_SECURE_KMS_KEY_ID`. Two checks, one reachable, and the one being relied on was not the one
anybody would name. The configuration's refusal stays, because it gives an operator the problem
alongside every other one; but the control is now inside the choice it guards.

### §5 · Development controls are refused by configuration, not by convention

Vahid, 2026-09-03: *"`/dev/session` must be structurally unavailable or unusable in production
through real configuration and startup controls, not comments or conventions."*

`AAS_DEV_SESSION` mounts a route that mints a session for any subject it is handed. With
`NODE_ENV=production` the process refuses to start and says why — including that ADR-0038's OIDC
provider is not built, so a production Conversation Service **has no way to sign a student in** and
must not pretend otherwise.

`AAS_CATALOGUE=fixtures` is refused on the same terms: it serves the gated *test* portal, and there
is no production catalogue adapter.

### §6 · Two processes have no health endpoint, deliberately

ADR-0045 gives the runner exactly one inbound surface because it is *"the most likely thing in this
system to be compromised"*; ADR-0052 says the worker *"listens on nothing"*. A `/healthz` is not a
control API, but it is an inbound surface, and it would be one on the two processes whose whole
design is that they have none.

For those two, liveness is the process and readiness is that it started at all — they exit non-zero
when they cannot. The three that already listen keep their `/healthz`.

### §7 · What is deliberately NOT here

- **No Docker, no IaC, no orchestrator manifests.** Vahid's scope boundary: *"First make the
  processes genuinely runnable and safe. Deployment infrastructure can consume that foundation
  afterwards."*
- **No self-contained artifact.** Entry points run through `tsx`, exactly as every other operational
  command in this repository does. Bundling, or an `exports` map that resolves to `dist`, is a
  packaging decision that belongs with the container work.
- **No OIDC.** Vahid's decision: its own phase, because it touches the session, the SSE stream and
  the secure-plane bootstrap.
- **No production catalogue.** There is nowhere to load a reviewed blueprint from and no parser for
  one; a loader accepting arbitrary JSON would mint reviewed artefacts nobody reviewed, which is
  what ADR-0004 and ADR-0009 exist to prevent.

## Consequences

**Good.** The system can be run outside a test for the first time. The startup validator is the
executable form of the deployment checklist — the things that block production are now a message a
process prints rather than a list in a document. Two controls that had been described for months
(`assertVaultIsProductionGrade`, the shared cache) actually run.

**The cost, stated plainly.** **A production start is currently impossible, on purpose.** With
`NODE_ENV=production` the Conversation Service refuses for want of identity and a catalogue. That is
the honest state: a service that started in production and quietly served nobody would be worse.

**Not decided here.** Where reviewed blueprints live and how they are validated; which OIDC provider;
and how these processes are packaged and scheduled.

---

*Accepted 2026-09-03. P18 implements it.*
