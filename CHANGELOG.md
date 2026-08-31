# Changelog

All notable changes to this repository are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this repository
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**One version, locked across every package** — see
[ADR-0027](./docs/decisions/0027-one-version-for-the-whole-repository.md) for why, and
`scripts/version.ts` for the mechanism. The authoritative source is the root `package.json`, and
`pnpm run verify` fails if any manifest has drifted from it.

**Nothing in this repository has been released or deployed.** Versions mark states of the source,
not shipped artefacts.

---

## [Unreleased]

---

## [0.22.0] — 2026-08-31

**P4 — the first production caller of the Secure Interaction Service.
`POST /internal/v1/secret-requests` has existed and been tested since the secure
plane was built and had nobody calling it. The Conversation Service now does.**

**Version bump: MINOR.** A new port and its HTTP client, two refusal kinds, one
orchestrator predicate, one concurrency primitive, and a latent race fixed. No
trust boundary moved, no new plaintext path, and nothing that returns a value.

### The Conversation Service opens the secure step

When `nextStep` answers `request_secret`, the Run Driver asks the Secure
Interaction Service to open a request and appends the authoritative
`secret_requested` event to the conversation's own log. That is the whole of the
change from the student's point of view: the first code path by which anybody is
actually asked for a password.

What crosses is metadata — identifiers, a purpose and a target host, both taken
from the case and the blueprint rather than from model output, so a
prompt-injected model can ask for *a* password but not for whose or for which
portal — plus the title and explanation shown inside the frame. What comes back
is an id, an expiry and a one-time frame token; the title and explanation are
**not** returned, so this plane holds no text a model wrote about a password and
its schema needs no exception. A test scans every row of `conversation_events`
for the word rather than checking a type.

`parseOpened` rebuilds the response field by field instead of casting it, so a
service that answered with a value-shaped field has nowhere to put it, and
`check-boundaries` now fails the build if that rebuild is replaced by a cast.

### One port for both halves of the secure step

`createConversationApp` takes a `SecureRequestOpener`, and both the driver's
`open` and the bootstrap endpoint's `mintFrameToken` go through it. Wired
separately they could name different services, and a deployment that opened
against one and minted against the other would answer `not_found` for every
bootstrap — a misconfiguration indistinguishable, from a support ticket, from an
expiry.

### `requiresSecureRequest` — the orchestrator says which steps have effects

The Run Driver may not branch on a step's kind; that rule is what keeps one
implementation of the decision. But it does have to know which steps need
something outside the process. So the orchestrator answers that too, as a type
predicate, and the driver obeys it — a list of step kinds kept in the driver
would go silently out of date the first time another step gained an effect.

### Fixed — two concurrent starts could ask the student twice

Two callers advancing the same conversation can both hold a valid run revision,
because the second loads the record after the first has already checkpointed and
nothing conflicts. Both then read a log with no live request in it and both ask.
The student would watch one secure box be replaced by another, and whichever
they typed into would settle a request the run was no longer watching.

The read → open → append sequence is now serialised per conversation with an
advisory lock. Deliberately advisory: `SELECT … FOR UPDATE` on the conversation
row deadlocks, because appending an event updates `conversations.last_ordinal`
on a different connection, so the transaction holding the row waits for the
append that is waiting for the row.

### Fixed — the loser of a checkpoint race got a 500

Latent since P1 and exposed by the extra log read this phase adds: two racing
starts leave `withBinding` holding a record at the same revision and both write a
checkpoint against it, and the loser's `RunConcurrencyError` reached the student.
It now does what the error's own message says — re-loads and decides again,
bounded at three attempts.

Nine deliberate regressions are recorded in
[`docs/p4-regression-audit.md`](./docs/p4-regression-audit.md), including the one
that was recorded as *not detected* until the racing test was made deterministic.

---

## [0.21.0] — 2026-08-31

**Two blockers resolved, both by decision rather than by working around them:
ADR-0043 (a credential field is mapped to the Secure Plane) and ADR-0044 (the
confirmed profile has its own store).**

**Version bump: MINOR.** A fifth `ValueSource`, a new store and port, two
migrations, and one design weakness corrected. No trust boundary moved and no
plaintext path changed.

### ADR-0043 — a credential field is mapped to the Secure Plane, not to data

Building the first gated blueprint produced two approved rules that could not
both be satisfied: no mapping may target a password field (ADR-0026/0042), and
every required field must have a mapping (`planFill`). The password field
genuinely *is* required, so `nextStep` answered `specialist / no_mapping` and the
run stopped for a specialist who had nothing to decide.

The root cause was an absence: `ValueSource` had no way to say *"the Secure Plane
fills this"*. It now does — a marker with two closed-set words, no `value`, no
`fieldKey`, and a compile-time assertion that fails the build if a field is added
that could hold one.

Credentials route to their own `FillPlan.credentials` list, away from the
`instructions` every existing consumer reads — because a `FillInstruction`
carries a `FillValue` and there is no `FillValue` that could hold a credential.
The preview shows *"filled from the password you typed in the secure box"*, and
hashes the **fact** — field and purpose — so an application that gained a
credential field after the student authorised it is a different application.

Enforced **both ways**, in `checkUsable` and again at the build: a password field
may have only this source, and this source may target only a password field.

### ADR-0044 — the confirmed profile has its own store

`docs/durable-execution-architecture.md` §12 flagged this when durable runs were
designed and explicitly deferred it: *"This needs your decision — it is a change
to what the event log is for."* It was decided, not assumed.

The log keeps recording **that** a confirmation happened, by reference;
`ConfirmationCaptured` is unchanged. The values live in `profile_entries` in the
Conversation Plane's database, behind `ConfirmedProfileStore`.

Rehydration lives in `packages/profile`, beside `applyConfirmation`, because the
boundary check that keeps `as ConfirmedValue` in one package is package-scoped —
putting it anywhere else would have meant widening the rule or casting outside
it. A rehydrated value carries the provenance it was minted with, so it is the
value the student confirmed rather than one nobody did.

**This is what unblocked the run.** The driver previously called `emptyProfile`
on every request, so a run could never leave `interviewing`: each call
re-derived a profile with nothing in it and reported the same blockers as the
one before. A restarted process now resumes an interview where it left off, and
the gated blueprint's run reaches `awaiting_secret`.

### Fixed — a version cannot identify a blueprint

P1's driver resumed by asking the catalogue for the blueprint whose *version*
matched the checkpoint. That worked while one blueprint existed and broke the
moment a second was written: both fixtures are at `1.0.0`, and a version is only
unique within a blueprint.

Migration 0004 records `cases.blueprint_id` — the fourth part of an identity
`CaseOpened.submissionIdentity` already carried three of. The checkpoint's
`blueprintVersion` keeps its own job, which is detecting that the blueprint
*moved*. Identity and revision are two questions and now have two answers;
`ApplicationCatalogue.findByVersion` is gone.

---

## [0.20.0] — 2026-08-31

**P2 — a controlled portal that actually requires an account.** The first
end-to-end product test needs a target, and this is one we own: gated, stateful,
and described by a blueprint proved against the real pages.

**Version bump: MINOR.** New test infrastructure, one new blueprint fixture, one
new `FieldInputType` member and one new build rule. No production behaviour
changed; no security boundary moved.

### Added — `startFixturePortal`

`/register` → `/apply` → `/review`, with real cookies, real refusals and real
state. The gate is the point: **`/apply` redirects to `/register` without a
session.** A fixture that served the form to anyone would let the entire
credential path be skipped while every later test still passed.

It has a login page for a reason. Nothing here ever renders a password back — so
"the right password arrived" cannot be checked by reading a page, which is the
property we want. It is proved by signing in instead: the portal using the
credential the way a real one does, failing on a single truncated character.

`submissions()` exists so that "it did not submit" is an assertion rather than a
hope (ADR-0014).

### Added — `FieldInputType` gains `password`

It was absent, which did not stop password fields existing on real pages — it
only stopped a blueprint saying so, leaving the document quietly wrong about the
field that matters most.

Naming it makes a rule checkable that was previously only a convention:
`check-boundaries` now fails the build if a **mapping set targets a password
field**. A password is not profile data, never becomes a `ConfirmedValue`, and
reaches its field through the Secure Plane's fill agent alone. There must be no
mapping for it to review.

### Found — an ambiguous locator that would have typed a credential into the wrong box

The blueprint first located the password field by `label: "Password"`. The test
that resolves every reviewed locator against the real page failed with *expected
2 to be 1*: `getByLabel` is non-exact by design, so "Password" also matches
"Confirm password".

On any other field that is a bug. On this one it is the bug that types a
credential into the wrong box — and the fill agent takes ONE locator, with no
list to fall through. Both password fields are now located by `name`, which is
also what discovery's own observer records for them.

---

## [0.19.0] — 2026-08-31

**P1 — the run exists.** A student conversation can now create and own a
durable application run, and the run survives the process that started it.

**Version bump: MINOR.** One new endpoint, one new migration, one new
orchestrator transition, and the first production caller of `nextStep`. No
approved security boundary moved.

### Added — the Conversation Service is now the Application Plane's service

`nextStep` had exactly one caller in the whole repository — `scripts/end-to-end.ts`,
a demo. The orchestrator was complete, tested and unreachable from anything a
student could do. `apps/conversation-service/src/run-driver.ts` is the join.

The division is stated and enforced: **the Conversation Service coordinates and
the orchestrator decides.** `scripts/check-boundaries.ts` fails the build if the
driver grows a `switch (step.kind)`, calls `phaseFor` or `deriveCheckpoint`, or
stops calling `nextStep` at all — because a second implementation of the
decision is exactly how the two models of a case came apart in the first place.

### Added — migration 0002, and the binding is the database's rule

`cases` is an identity anchor: an id, an owner, a timestamp. No status, no
phase, no checkpoint, no business fact — `case_events` is still the sole
authoritative record, and a `status` column here would have become a second
opinion about it within a bug or two.

`conversations.case_id` references `cases` through a **composite** foreign key
over `(student_id, case_id)`. A plain reference to `cases (case_id)` would let
student A's conversation point at student B's case: the reference would be valid
and the ownership would be wrong. MATCH SIMPLE keeps the column nullable, so a
conversation that has not started an application is the normal case rather than
an exception the schema has to tolerate.

### Added — `withSecret`, the only sanctioned writer of `RunState.secret`

The field has existed since the secret channel was designed and nothing could
write it. The writer is a machine, not an assignment: nothing may move out of a
settled secret, a second request may only replace one that has settled, and a
handle may only accompany a lifecycle that can have one — the same rule the
secure plane's own schema states as `a_handle_means_it_was_answered`. Re-reporting
the same word is a no-op, because lifecycle deliveries are at-least-once.

### Added — `POST /v1/conversations/{id}/runs`

No `Idempotency-Key`, and that is not an oversight: a conversation owns at most
one case, so a retry is the same question rather than a second request.
`resumed` and the status code (201 created, 200 resumed) are how a caller tells
which it got. The response carries position and identity only — a type-level
assertion in `@askimate/aas-contracts` fails the build if a free-text field is
ever added to it.

### Fixed — a concurrency defect the tests caught

The first version locked the conversation row for the BINDING and nothing after
it. Two simultaneous starts therefore agreed on one case and then raced to open
that case's event log, and the loser got a `ConcurrencyConflictError` a student
would have seen as a 500. The critical section now spans bind → open the case →
start the run, and run ids are derived from the case rather than from a clock,
for the same reason `idempotencyKeyFor` is derived rather than random.

### Discovered — a seam between the blueprint and the domain

`ApplicationBlueprint.intake` is the label `"September 2026"`; the domain's
`Intake` is a branded, validated `YYYY-MM` that goes into the submission key
preventing duplicate applications. Parsing the label would have made a
coordinator derive a business fact from prose, and derive it wrongly the first
time a blueprint said "Autumn 2026". The catalogue states the identity instead,
beside the institution and course references that were already there for this
reason.

### Honestly not durable yet

The `ConfirmedProfile` and the `InterviewState`. `resumeRun` has said so in its
own documentation since it was written — `ConfirmationCaptured` carries a
reference rather than a value, deliberately, so the event log is not a copy of
the profile. Everything P1's brief lists as durable does survive: case identity,
run identity, durable run state, checkpoint state and the conversation binding.

---

## [0.18.0] — 2026-08-30

**The runner no longer holds a password. The component that consumes a credential
moved inside the Secure Plane's trust boundary, and the plaintext still never
becomes service-to-service response data.**

**Version bump: MINOR.** A new deployable, two extractions, one contract
operation added, and one internal operation whose meaning changed without its
shape changing. No approved security boundary moved.

### Added — `apps/secure-filler`, the Secure Plane's fill agent

The vault hands plaintext to a **callback**, and a closure cannot cross mTLS. So
the callback moved to where the vault can reach it: a fourth deployable that
constructs its **own** `EnvelopeVault` over the **same** envelope cache and the
**same** KMS key as the secure service, obtains the ciphertext locally, decrypts
it in its own process, and types it into the runner's browser over the Chrome
DevTools Protocol.

Vahid, 2026-08-30: *"Sending the plaintext back in an HTTP response, even over
mTLS and a private subnet, weakens one of the strongest guarantees we have
deliberately established."* Nothing sends the agent a secret. `SecretUseResult`
is unchanged and still has no field that could carry one — and the contract's
sentence about the vault handing plaintext to a callback is now literally true
for the first time.

### Added — three checks the agent makes against the live page

`confirmNoDiagnosticCapture()` reads a private symbol on a `BrowserContext`
object, and the agent holds a different object for the same underlying context.
Rather than take the runner's word for it, three experiments were run against
real Chromium with the fill performed by a second process:

| Runner-side state | Value in `trace.trace` | Detectable from the page |
| --- | --- | --- |
| tracing, `snapshots: true` | **yes, verbatim** | **yes** |
| tracing, `snapshots: false` | no | no |
| no tracing | no | no |

The first row is the finding: a value typed by *another process* still lands in
the runner's trace, because the leak is the DOM snapshot rather than the action.
The third column makes it fixable — Playwright's snapshotter installs a `window`
property beginning `__playwright_snapshot_streamer_`, present in exactly the
configuration that leaks. So the agent **verifies** rather than trusts, which is
stronger than what it replaces: a check performed by the component being checked
guards against accident, and this one is performed by the component holding the
plaintext.

Two more, neither of which existed before: the page's host must equal the bound
target host (checked against the document, not against metadata), and the field
must be an input the browser renders **masked** — which is what closes video, the
one capture route the agent cannot detect remotely.

### Changed — `/internal/v1/secret-uses` grants authority, and no longer takes the ciphertext

It used to call `vault.use(handle, () => true, now)`: spending the entry with a
callback that discarded the plaintext, because there was nothing on that side to
hand it to. Now it re-checks the binding, settles `secret_consumed`, records the
use and enqueues the outbox row — and the agent takes the ciphertext.

Single use is enforced twice, now on either side of the boundary: `settle` and
`recordUse` make a second call answer 409, and `EnvelopeCache.take` is atomic and
removes the entry before the callback runs. The authority is obtained **before**
any plaintext exists, so a failure after that point is a spent password — the
same semantic ADR-0026 §3 already establishes for a callback that throws, and the
failure direction that leaves a record.

### Changed — the runner is a client, and cannot become anything else

`fillSecret` posts to the agent and reads back one of two words. The runner
declares no `@askimate/aas-secrets`, no `@aws-sdk/client-kms`, and none of its
source files may so much as name `EnvelopeVault`, `InMemorySecretStore`,
`useSecret` or `getSecret` — checked in the manifest AND in the source, because
a deep relative import resolves perfectly well and pnpm never hears about it.

`apps/secure-service` may not declare Playwright as a production dependency: the
browser automation went to the agent precisely so that service would not grow
one.

### Added — two extractions, so nothing is duplicated across a trust boundary

`@askimate/aas-secure-logging` (the field-allowlist logger, now used by both
Secure Plane processes) and `@askimate/aas-browser-fill` (locator resolution, the
keystroke, and the page guards, used by the runner and the agent). Two copies of
"which element does this blueprint mean" would eventually disagree, and on the
agent's side that disagreement is a password typed somewhere it should not be.

### Added — the whole path, end to end, with every byte on every wire scanned

`fill-agent-e2e.test.ts`: a real PostgreSQL, the real secure service reached
through the real frame bootstrap, the real agent over real HTTP, a real Chromium
over real CDP, and the real runner client. It records the body of every HTTP
message between the three processes and asserts the password appears in
**exactly one** — the student's own submission. "Exactly one" rather than "none"
because a scan finding zero would mean the recording was broken.

### Verified — ten deliberate regressions

Recorded in `docs/adr-0042-regression-audit.md`, each proved to have applied by
reading the file back from disk before its suite was read.

### Documented — the residual, rather than glossed over

The runner still **owns** the browser the agent types into, so a runner that has
been actively compromised can read the field afterwards. ADR-0042 records this
deliberately. What the change protects is the password's existence outside the
browser — in a heap, a log, an error object, a crash dump, a KMS grant — not the
live page. A password is reused across sites and a portal session is not, which
is why that is the trade worth making.

---

## [0.17.0] — 2026-08-30

**The seven coverage gaps are closed, and closing them found two real defects:
the composer reopened on the browser's own word, and the client never asked
whether it could show the step at all.**

**Version bump: MINOR.** New coverage, two behavioural corrections, one contract
alignment, and the first staged deletion from the legacy harness.

### Fixed — the composer gate read provisional state

`useSecureTurn` computed `awaitingSecret` from the MERGED view: durable events
plus whatever the browser was drawing. So when the secure frame posted
`secret_received`, the client drew a provisional entry, the merged view went
empty, and **the composer reopened before the Secure Interaction Service had
published anything**. Nothing unsafe was ever accepted — the Conversation
Service refused the resulting message with a 409 — but the student saw a live
composer for a step the log still held open, and "provisional UI must never
override server authority" is the rule.

The gate now reads `openSecretRequest(log.durable)`. Rendering still uses the
merged view, because the card *should* close the instant the student succeeds.
The two are different questions and now have different answers.

On the provisional app there is no durable log — its turns arrive through
`receive` without ordinals — so there the merged view IS the server's word, and
the gate says so explicitly.

### Fixed — the real path never asked whether it could render

`decideRendering` was written for this architecture; its own comment cites
ADR-0030. The cross-origin path went straight to fetching a bootstrap
capability without consulting it, which is why three refusal reasons had no
coverage: nothing called them. It is now asked BEFORE the capability is
fetched, so a client that cannot show the step never obtains a one-time token
it has no use for.

**One legacy behaviour is deliberately not preserved.** The provisional path
cancelled the request on a refusal. The real path cannot — cancellation needs a
secure session, which needs the bootstrap it has just declined — and should
not: a client that reports it cannot display a password box is not a client
that should decide nobody will be asked. The request stays open, the composer
stays blocked, and the TTL settles it.

### Fixed — a contract divergence on the internal API

`secure.v1.yaml` distinguishes 409 (already spent) from 404 (unknown) on
`POST /internal/v1/secret-uses`. The implementation collapsed both to 404,
because `settle` nulls the handle. It now consults the audit table, answers 409
for a handle that was spent, and records the refused attempt — a second attempt
on a dead handle is either a retry that should stop or a capability being used
where it should not be, and both deserve a row.

Note the deliberate asymmetry: on the STUDENT-facing surface one answer still
covers unknown, spent and expired, because telling them apart would confirm that
some handle had once been real. The internal caller is our own runner behind
mutual TLS, where "do not retry" and "wrong id" are different instructions.

### Fixed — a frozen clock in the two-origin browser suite

The servers minted `expiresAt` from a hard-coded `2026-08-28T10:00:00Z` while
the browser compared it with `Date.now()`. Two days later every secure step the
tests opened was already expired as far as the page was concerned. Nothing
looked before, because nothing checked the expiry; wiring `decideRendering` in
exposed it immediately — every frame refused with `prompt_expired`. Production
has one real clock on both sides, and so does the suite now.

### Added — 21 tests against the real architecture

Ten composer/draft questions answered on the two-origin stack, three capability
refusals, three plane-separation tests, two handle-spend tests, and a
"never fetches a capability it cannot use" test.

### Findings

**Two properties are defended twice over, which two regressions revealed.**
Filtering `secret_requested` out of the paged read did not break the
refresh-restore test, because the SSE backfill still delivered it; the
regression had to break the single source both paths use. And bypassing the
vault did not produce a double-spend, because `settle` nulls the handle
independently. Both are good news, and both mean a single-mutation regression
proves less than it appears to.

**Three regressions were caught only by a timeout at first**, which is not proof.
Each test was restructured so the assertion fails and names what it found: Q5
waits for the transcript then asserts, Q7's capability tests do the same, and
Q4's release case polls for "released OR something was sent" so a released
buffer fails on the assertion rather than on a composer that never reopens.

### Harness retirement — the first deletion

**Seven `it` blocks deleted from `fail-closed.test.ts`** (33 → 26), each after a
regression proved its replacement fails. Nothing else was removed:
`quarantine.test.ts`, `end-to-end.test.ts`, `continuity.test.ts` and the
provisional app all stay. **One property still has no replacement** —
`refuses an unverified email` — because ADR-0038's identity delegation is not
implemented and there is no claim for a test to assert on.

`docs/harness-coverage-mapping.md` carries the full decision matrix.

### Verification

- **1490 tests, 75 files**, `pnpm run verify` green.
- **445 tests against real PostgreSQL**, none skipped.
- **27 two-origin Chromium tests**.
- **Nine deliberate regressions**, each verifying it applied first.

---

## [0.16.0] — 2026-08-28

**A real browser now types a real credential into a real cross-origin Secure
Plane, and the conversation page cannot read it — because the browser will not
let it, not because our code promises not to look.**

**Version bump: MINOR.** The Secure Interaction Service gained its HTTP surface
and the vault became what ADR-0034 specifies; additive in capability. Two
contract corrections are described below. No security property is weakened.

### Added — the Secure Interaction Service

Seven operations, implementing `secure.v1.yaml` as written. The contract and the
`postMessage` protocol in `packages/contracts/src/frame.ts` already existed and
were followed rather than re-invented.

- **`control-document.ts`** — the control, served by the secure origin, under
  `default-src 'none'; script-src 'self'; connect-src 'self'; form-action
  'self'; base-uri 'none'; frame-ancestors <parent>`. `connect-src 'self'` is
  the load-bearing one: even an injected script has no origin to send a value to.
- **`control-client.ts`** — the only code that ever sees a password. No
  framework, deliberately: React is what would have tempted someone to make the
  input controlled. The value exists in one DOM element and one `fetch`
  argument, and nowhere else.
- **`routes.ts`** — the one endpoint in AskiMate that accepts a secret. Every
  check that does not need the value runs first, so no refusal path ever holds
  the plaintext in a variable.
- **`logger.ts`** — a field allowlist, by type. `LogFields` admits scalars with
  known meanings and there is no `meta`, no `extra`, no `err`. `failure()`
  reduces a thrown value to a class name at its first statement.

### Added — the vault ADR-0034 actually specifies

AES-256-GCM, a fresh KMS data key per secret, keys zeroed after use, ciphertext
in a cache with a five-minute ceiling applied at encryption time. `use()` still
takes a callback and returns the callback's result — ADR-0034 says that design
"is kept exactly", and it is.

`LocalDataKeyProvider` is for development, and
`assertVaultIsProductionGrade(provider, NODE_ENV)` **refuses to start** a
production process that is using it. `KmsDataKeyProvider` is real code that has
never been run against a live key from this repository, and
`docs/secure-plane-deployment.md` says so rather than implying otherwise.

### Fixed — two contradictions between the contracts and reality

**The TTL ceiling.** `packages/secrets` said fifteen minutes; `secure.v1.yaml`
said 60–300 seconds; ADR-0034 said "hard ceiling 5 minutes". The contract and
the ADR are the authority — they were written in the contract-first phase that
the constant predates — so the ceiling is 300 and the floor is 60. The vault
applies the ceiling again at encryption, so a caller that never went through
request validation still cannot exceed it.

**The secure session cookie.** The contract specified `SameSite=Lax`, and that
**cannot work**: measured in Chromium, a `Lax` cookie is not sent on requests
made from inside a cross-site iframe, which is the only context this session
exists in. The frame would set the cookie and then be refused by its own service
on the next fetch — `SameSite=Lax` and ADR-0030 are mutually exclusive. It is
now `SameSite=None; Partitioned` (CHIPS), which keys the cookie to the top-level
site as well, so it is not a general third-party cookie. The CSRF protection
`Lax` would have given is replaced by `Origin` and `Sec-Fetch-Site` checks,
which refuse a cross-site POST outright rather than merely withholding a cookie.

### Findings

**A backup directory keyed by basename destroyed a file.** Two services both
have `routes.ts`; the regression harness copied both into one directory and a
restore wrote the conversation service's routes over the secure service's. It
was caught by the next test run, the file was rewritten, and the backups are now
keyed by full path. Recorded because the failure mode — a "restore" that
silently installs the wrong file — is one a green suite would not have shown.

**Four regressions were not caught, and each exposed a real gap.**

- **R7** (a prefix origin comparison instead of an exact one) passed every test.
  The rule was documented in `frame.ts` and enforced nowhere.
  `packages/contracts/src/frame.test.ts` now tests nine lookalike origins,
  including `https://app.askimate.com.evil.test`.
- **R8** (`postMessage(payload, "*")`) passed everything, because a wildcard is
  a superset of correct behaviour and no cooperating test notices. A boundary
  rule now reads the source — and my first version of that rule caught the
  wildcard in one file and missed it in the other, because the second call had a
  trailing comma.
- **R13** (splitting the receipt from its outbox row) passed, because on the
  happy path both writes succeed either way. There is now a test that fails the
  publication and asserts the receipt rolled back with it, plus a rule that only
  `withTransaction` may issue BEGIN or COMMIT.
- **R3**, in its first form, was "caught" only by a timeout after my patch broke
  the control flow. That is not evidence, and it was redone surgically.

### Verification

- **1475 tests, 75 files**, `pnpm run verify` green.
- **7 two-origin Chromium scenarios**: the full journey, postMessage scanning,
  refresh, cancellation, rejection, a stale client POSTing directly, and two
  browsers on one conversation.
- **20 secure-service tests** against a real database and a real vault, every
  log assertion on a FAILURE path.
- **All 14 required regressions** confirmed, each verifying it applied first.

### Not done, deliberately

`docs/harness-coverage-mapping.md` is updated: the secret-entry path now has
browser-level coverage on the real architecture, and **seven properties still
have none**. Nothing was deleted.

---

## [0.15.0] — 2026-08-28

**The browser now talks to the real Conversation Service, and the Secure
Interaction Service pushes lifecycle transitions into the real event log. The
architecture that existed as separated pieces in 0.14.0 is connected and proven
end to end in real browsers, across two services and two databases.**

**Version bump: MINOR.** Two services gained real surfaces and the client moved
onto them; additive in capability. One contract gained a parameter, described
below. No security property is weakened; three are newly proven in a browser.

### Phase 1 — the React client on the real service

```
Browser → Conversation Service → PostgreSQL → server-assigned ordinal
        → SSE → ConversationLog → React UI
```

- **`apps/conversation-service/src/app.ts`** — the conversation plane as ONE
  origin: the API and the client it serves. ADR-0030 already said so; this makes
  the session cookie simply attach, `EventSource` work without `withCredentials`,
  and leaves no cross-origin preflight in front of the fail-closed guard.
- **`apps/conversation-service/src/session.ts`** — the `__Host-` HttpOnly cookie
  of ADR-0033. The stream is what turned the approved model into the *only*
  workable one: `EventSource` takes no request headers, so a bearer token could
  only ride in the URL — where it reaches the access log, the `Referer`, the
  proxy and the browser history.
- **`apps/chat-integration/src/conversation-client.ts`** — `load`, `send`,
  `stream`. Relative URLs, no base to configure, and the browser's own
  `EventSource` so its automatic reconnect and `Last-Event-ID` handling are the
  ones ADR-0035 depends on rather than a reimplementation.

### Phase 3 — the lifecycle push, as a transactional outbox

```
Secure Interaction Service → authenticated internal append
        → Conversation Service → durable event log → SSE → browser
```

- **`0002_lifecycle_outbox.sql`** — the transition and the intent to publish it
  commit in ONE transaction, in the secure plane's own database. Separate
  databases mean the two planes cannot share a transaction, so the choice was
  where the failure lands: pushing inside the request loses a student's
  submission when another service blinks; pushing and forgetting loses the
  transition. The outbox loses neither.
- **Fail-closed follows the DIRECTION of the error.** An undelivered row means
  the conversation log still shows the request open, so the guard there refuses
  messages. The failure mode is a composer that stays shut — never one that
  opens early — and that is a property of the arrangement rather than a rule
  someone has to remember.
- **Two idempotency layers**, because a duplicate enqueue and a duplicate
  delivery have different causes: `UNIQUE (request_id, kind)` here, and the
  internal route's existing idempotency on (conversation, request, kind) there.
- **`FOR UPDATE SKIP LOCKED`**, because several instances run the publisher.

### Changed — the stream contract gained a resume parameter

A browser's `EventSource` sends `Last-Event-ID` **automatically, and only on its
own reconnects**. A page that has just loaded cannot send it: the API accepts no
request headers. So a client holding events up to ordinal 41 had no way to say
so on a fresh connection, and every refresh re-sent the whole conversation while
announcing `resumingAfter: 0`.

`conversation.v1.yaml` now documents a `lastEventId` query parameter alongside
the header, parsed and constrained identically — a strict non-negative integer,
used only as a lower bound inside a conversation already authorised. **The
header wins when both are present:** it is the browser's account of what this
connection received, whereas the query parameter is what the page believed
before the connection existed.

### Added — a bounded stream lifetime

`maxStreamMs`, five minutes by default. An SSE connection is open indefinitely
by design, and that is exactly what stops an instance draining: a rolling
deployment cannot retire a pod holding streams nobody will close. The server
closes them on a schedule it controls and the browser reconnects by ordinal, so
a routine deployment costs nothing. This is also what let the browser test prove
reconnection — see below.

### Findings

**Three tests that would have passed while proving nothing.** Each was caught by
asserting that the thing under test actually happened:

- **The stream never dropped.** The reconnect test registered a Playwright route
  to abort the stream — but routing only affects requests a page has yet to
  make, and the `EventSource` was already open, so the pattern matched nothing
  and the test asserted that an *uninterrupted* stream delivers events.
  `context.setOffline(true)` did not sever the established loopback connection
  either. Closing it server-side does, and is the realistic case.
- **The client never resumed by ordinal.** The resume point was a ref assigned
  during render; `backfill` calls `setLog`, React applies that on a later
  render, and the stream opened in the same microtask — so the ref still read 0.
  Correct on screen, because `admitDurable` deduplicates, and wrong on the wire.
  The watermark is now a local advanced by the code that learns the ordinals.
- **A client-created ordinal was invisible end to end.** Overwriting the send
  response's ordinal with `1` failed *none* of the fourteen browser tests: the
  stream delivers the same event at its real ordinal moments later and repairs
  it. The durable path is defended twice, which is good — but a suite that
  cannot distinguish "correct" from "repaired" would let the response path rot.
  `conversation-client.test.ts` now drives the transport with an injected
  `fetch` and `EventSource` so each path is observable alone.

**An ambient clock in a column default.** `lifecycle_outbox.next_attempt_at`
defaulted to `now()`, the database's clock — a second clock, and it disagreed
with the injected one the moment a test used a fixed time. Every row was queued
in the database's present and asked for in the caller's past, so nothing was
ever due: a publisher that silently delivered nothing, which has the shape of an
outage rather than a bug. `enqueue` now takes the caller's clock.

**Two schema guards did their job.** Adding the outbox failed the migration-list
assertion and the "names every table it has, so a new one cannot arrive
unnoticed" test, which is exactly what they are for — the column-by-column
"no column can hold a secret" scan now covers the new table because it was
registered rather than because anyone remembered.

### Verification

- **1422 tests, 71 files**, `pnpm run verify` green.
- **405 tests against real PostgreSQL**, `scripts/with-postgres.sh`, none skipped.
- **14 real-Chromium tests** against the real service: server ordinals, two
  clients converging, refresh, reconnect, and the fail-closed guard.
- **8 cross-service tests** across two databases: delivery, retry, permanent
  failure, duplicate retry, and both services restarting.
- **All ten required regressions** confirmed, each verifying it applied first.
- `app.test.ts`, `conversation-service.test.ts` and `lifecycle.test.ts` added to
  `scripts/ci-guard.test.ts`, so CI fails rather than skips without a database.

### Not done, deliberately

`docs/harness-coverage-mapping.md` maps every legacy property to its
replacement — and names the ones that have none. **The legacy harness stays.**
The Secure Interaction Service has no HTTP surface yet, so nothing in the new
architecture accepts a password, and the suites that prove what happens when one
is typed are still the only proof of it.

---

## [0.14.0] — 2026-08-28

**The Conversation Service exists, and it is the only thing in the system that may say where an
event sits. The client had been inventing that answer for a whole phase, and nothing objected
because a rendering position and a durable ordinal were both `number`.**

**Version bump: MINOR.** A new service, additive in capability. Two wire shapes changed and one
divergence between two contract artefacts was resolved; both are described below. No security
property is weakened.

### The bug this removes

```ts
// superseded — apps/chat-integration/src/useSecureTurn.ts
{ ...event, ordinal: previous.length + 1, createdAt: now().toISOString() }
```

That is a plausible number and a false claim. An ordinal is dense, unique per conversation, assigned
by the database inside the insert's transaction — and it is also the SSE event id a reconnect
resumes from. Two tabs would produce different "ordinal 4"s for different events, and a reconnect
carrying a locally-computed `Last-Event-ID` would skip or repeat real events. The value looked like a
resume cursor and was not one.

It is now impossible to write. A `Position` is either the server's ordinal or a client-local id, and
they share no field; an `UnpositionedEvent` has no `ordinal` and no `createdAt` to put one in.
`createdAt` travels with `ordinal` for the same reason — the contract already said a client's clock
is never trusted for it, and a shape permitting "the server said where but not when" invites
`new Date()` onto a durable event.

### Added — `apps/conversation-service`

- **`event-store.ts`** — the ordinal authority. A position is claimed by
  `UPDATE conversations SET last_ordinal = last_ordinal + 1 WHERE id = $1 RETURNING last_ordinal`:
  one statement that claims, locks and advances, in the same transaction as the insert. Not a
  sequence — sequences are non-transactional, so a rolled-back insert would leave a gap, and ordinals
  must be dense because the ordinal *is* the SSE event id.
- **`routes.ts`** — messages (with the fail-closed guard ahead of reading the body), paged event
  reads, a resumable SSE stream, and the internal append the Secure Interaction Service uses.
  `Last-Event-ID` maps to `WHERE ordinal > $cursor`: no cursor table, no opaque token.
- **33 tests against real PostgreSQL and a real listening server** — twenty simultaneous writers,
  cross-conversation independence, reconnect without duplication, two readers converging on one
  ordering, a hostile `Last-Event-ID`.

### Added — `packages/conversation`

- **`log.ts`** — the client's `ConversationLog`, which separates events the server placed from
  entries the browser is merely drawing. `admitDurable` deduplicates by ordinal, orders by ordinal,
  and retires the local echo the arriving event supersedes. It lives in the domain authority rather
  than in a client because "a rendering position is not a durable ordinal" is a rule every client
  must obey, and a rule kept in one client is a rule the next one reinvents wrongly.
- **`unpositioned.ts`** — `UnpositionedEvent`, and the compile-time constraint that it names no
  position. `openSecretRequest`, `persistableContent` and `buildModelRequest` now take it: each reads
  `kind`, `requestId`, `actor` or `content` and never a position, so requiring an ordinal was forcing
  callers to invent one merely to ask a question.
- **`Position`** — `{ placement: "durable", ordinal }` or `{ placement: "provisional", localId }`,
  with `renderKey` the only thing that flattens them, into a prefixed string that is never an
  ordinal. A shared key space would let React reuse a settled secure step's DOM node for a live
  control.

### Changed — two wire shapes

- **`ChatSendResponse` moved to `packages/contracts`** and its accepted branch now carries
  `events: readonly ConversationEvent[]` rather than `reply: string`. A single request can cause the
  server to append more than one durable event — the student's message and, on a synchronous
  endpoint, the assistant's answer — and a client told about only the first would have to place the
  second itself.
- **`ChatRoutesOptions.persist` became `append`**, which returns the event at the position the server
  gave it. `persist` returned `void`, which is why the route was left fabricating `ordinal: 1`.

### Fixed — a contradiction between two artefacts in `packages/contracts`

`conversation.v1.yaml` declared `POST /messages`'s 409 as `application/problem+json` carrying
`SecretRequestOpenProblem`. The service was sending `application/json` carrying a bespoke
`{ status: "refused" }` envelope, and its 201 returned an envelope where the contract named a bare
`MessageEvent`. The OpenAPI tests compare the two *documents* against each other and against the
vocabulary; nothing compared either with what the service actually sends.

The contract wins — ADR-0005 is contract-first, and RFC 9457 for every failure is the better answer
than one endpoint with its own error envelope. The service now sends problem+json, returns the bare
event, and `routes.test.ts` asserts the media type as well as the body. The document gained the
`200`-on-idempotent-replay response it was already returning. `ChatSendResponse` remains the shape of
the *provisional* `POST /api/askimate/ai`, which has no OpenAPI document and answers inline because
it has no stream.

### Added — a boundary rule for wire types

`scripts/check-boundaries.ts` now fails if a browser file imports from a server route module, or
names a type such a module declares. The declared names are read out of the server modules rather
than listed, so a wire type added to a route tomorrow is covered without anyone remembering.

### Verification

All ten named properties were confirmed by deliberate regression — each guarantee broken in turn,
with the failing test recorded. Two of those runs are worth keeping:

- **A regression that silently did not apply.** My first attempt to break the atomic claim used a
  patch string that did not match the source, and `str.replace` made it a no-op. The suite passed and
  briefly looked like proof that the concurrency tests were vacuous. Every later regression asserted
  that it had applied before the tests ran.
- **A regression aimed at the wrong line.** Swapping the `ROLLBACK` in `append`'s catch clause for a
  `COMMIT` does not break anything: PostgreSQL aborts a transaction as soon as a statement in it
  fails, and `COMMIT` on an aborted transaction rolls back. What actually carries "a failed
  transaction cannot leave `last_ordinal` advanced" is that the claim and the insert share ONE
  transaction — and committing the claim separately does break the test. Recorded in
  `event-store.test.ts`.

`apps/conversation-service` was added to `scripts/ci-guard.test.ts`, so CI fails rather than skips if
its database is missing.

---

## [0.13.0] — 2026-08-28

**`packages/conversation` is now the single domain authority. The duplication it removes was not
redundancy — one of the two copies was wrong, and nothing could have told them apart.**

**Version bump: MINOR.** A new package and a client migrated onto it, additive in capability. Every
security property is preserved or strengthened; two are strengthened, described below.

### The bug the duplication was hiding

Two generations of the same five decisions coexisted: the turn model in `apps/chat-integration` and
the wire model in `packages/contracts`. They had drifted:

```ts
// superseded — closes the open step on ANY status
else if (item.render === "secret_status") open = null;

// authority — closes only the request it NAMES
if (open === event.requestId) open = null;
```

`ChatTurn`'s `secret_status` variant carried no `requestId`, so **the old model could not express the
correct rule.** Two requests in one conversation — a lapsed one and a live one — and the lapsed one's
settlement released the live one's composer guard, letting an ordinary message through while a
password box was on screen. That is why this was a migration to the wire model rather than a lift of
the existing code.

### Added — `packages/conversation`

Five decisions, one implementation each, consumed by both the server routes and the browser client:

| Decision | Question |
| --- | --- |
| `openSecretRequest` | Is a secure step open? |
| `composerPolicy` | What may the composer do about it? |
| `decideRendering` | Can this client show the step at all? |
| `projectTranscript` | What is drawn, and in what order? |
| `buildModelRequest` | What reaches the model? |

**`check-boundaries.ts` now fails the build if any file outside that package DEFINES one of those
names.** Importing is what they are for; a second implementation is how the client and the server
come to disagree.

### Removed — four files of duplicated decisions

`chat-transport.ts`, `render-decision.ts`, `transcript.ts` and `transcript.test.ts` are gone from
`apps/chat-integration`, which now imports the authority. `continuity.test.ts` keeps only its unique
coverage — `replayEvents` over the legacy table — because its other assertions were about decisions,
and the decisions moved.

### Changed — two narrowings, both improvements

- **`decideRendering` takes the channel and the expiry**, not a whole `SecretPrompt`. Under ADR-0030
  the conversation plane never has the title, the explanation or the portal host. A decision that
  cannot reach the prompt cannot leak it.
- **`SecureControl` takes only the five fields it renders**, and no longer imports
  `@askimate/aas-secrets` at all — so the package holding the secret store is one step further from
  any browser bundle. Neither does `useSecureTurn`.

### Strengthened

- **The wire parser no longer spreads.** It used to `{ ...fields }` an incoming prompt, so an
  unexpected server field rode along unread. It now constructs field by field, and the test that
  asserted `conversationId` *survived* the spread now asserts it is **absent**, along with the exact
  key set.
- **A replayed receipt replays as `secret_expired`, not `secret_received`.** A handle nobody can
  spend is not an available secret, and `secret_received` without a handle is unrepresentable in the
  wire model — which is what the database's `a_handle_means_receipt` CHECK says too.

### Also moved — ADR-0040's own boundary

`openSecretRequest` and `persistableContent` were in `packages/contracts`. They are **decisions**, so
they moved. `contracts` keeps the model, its parser, and `eventCarriesContent` — a fact about the
shape rather than a choice about it. Recorded as an addendum to ADR-0040 and in
[ADR-0041](./docs/decisions/0041-one-implementation-of-each-conversation-decision.md).

### Verification

**64 files, 1317 tests, 0 failures, 0 skipped** — identical totals to before the extraction, with the
coverage relocated rather than lost: `transcript.test.ts` (17) and part of `continuity.test.ts` and
`contracts.test.ts` became `conversation.test.ts` (27). **All browser coverage preserved**:
`fail-closed.test.ts` (33), `end-to-end.test.ts` (12), `react-client.test.tsx` (25) all run against
the extracted implementation.

| Deliberate regression | Caught by |
| --- | --- |
| A second `composerPolicy` appears in the app | ✅ build rule |
| Openness closes on ANY settlement | ✅ package tests |
| A rejection closes the request | ✅ package **and** browser tests |
| The composer becomes disable-able | ✅ package tests |
| `decideRendering` stops checking the channel first | ✅ package tests |
| The model funnel serialises the whole event | ✅ package **and** e2e tests |

Two of those fired in both the package's own suite and the app's — which is the evidence that both
consumers really do run the same implementation.

---

## [0.12.1] — 2026-08-28

**Migrations: the first implementation step of the independent product. The security guarantees
move from the application into `CHECK` constraints, verified against a real PostgreSQL.**

**Version bump: PATCH.** Two new schemas that nothing runs against yet, plus an extracted runner.
No behaviour changed and no boundary moved.

### Added — two schemas, two databases

Per ADR-0037 the planes hold **separate databases with separate credentials**, so these are two
migration sets, not one.

- **`apps/conversation-service/migrations/0001_conversation_log.sql`** — students (keyed by the
  OIDC `sub` and nothing else), conversations, `message_bodies`, `conversation_events`, idempotency
  keys, and the `open_secret_requests` view.
- **`apps/secure-service/migrations/0001_secret_requests.sql`** — requests, hashed single-use frame
  tokens, hashed sessions, and the use audit. **No column can hold a secret.**

### The guarantees, as constraints rather than as code

| Property | Enforced by |
| --- | --- |
| A secure event cannot hold what a student typed | `CHECK ((kind = 'message') = (body_id IS NOT NULL))` |
| …and a message cannot lose its text | the same constraint, read the other way |
| A secure event names its request; a message never does | `CHECK ((kind = 'message') = (request_id IS NULL))` |
| A handle exists exactly on a receipt | `CHECK ((kind = 'secret_received') = (handle IS NOT NULL))` |
| A reason exists exactly on a rejection | `CHECK ((kind = 'secret_rejected') = (reason_code IS NOT NULL))` |
| Closed vocabularies | `CHECK (… IN (…))` on kind, actor, reason, channel, lifecycle, purpose, refusal code |
| One event per position | `UNIQUE (conversation_id, ordinal)` — two racing writers, one gets 23505 |
| Redaction is not deletion | `ON DELETE RESTRICT` on `body_id` |
| The secure database holds no secret | asserted from `information_schema` after migrating |

`open_secret_requests` deliberately contains **no `now()`**: a clock inside a view is an ambient
read no test can move, and every clock in this repository is injected. The caller supplies the
instant. A rejection is deliberately absent from the settling kinds, so a mistyped confirmation
leaves the step open — the divergence Phase D removed, now expressed in SQL.

### Added — `packages/aas-migrate`

The runner extracted from `packages/case-store`, which now passes its own directory like everyone
else. **There is no default directory**: a runner with one silently migrates the wrong database
when a caller forgets the argument. `@askimate/aas-migrate/testing` also holds the shared
database-availability helper — three copies of `announceSkip` would be three chances for one of
them to forget that `AAS_REQUIRE_DATABASE=1` must turn a skip into a failure.

### Added — the internal append endpoint, found by writing the schema

`POST /internal/v1/conversations/{id}/events`, behind mutual TLS. See the architectural note in the
report: with separate databases the conversation service **cannot** read `secret_requests` to run
its fail-closed guard, which is what the previous design did when both tables shared a database.
The secure service now pushes each transition server-to-server and the guard reads the
conversation's own log.

### Changed — three corrections to ADR-0031's sketch, found by implementing it

1. **`ON DELETE SET NULL` → `ON DELETE RESTRICT`** on `body_id`. `SET NULL` would have silently
   violated `only_messages_have_bodies` the first time anybody deleted a body.
2. **`actor` is nullable and message-only.** The sketch had it `NOT NULL` on every event; the
   shipped contract puts it on `MessageEvent` alone, and a lifecycle transition is not "from"
   anybody.
3. **`content` is nullable with a paired `redacted_at`**, not `NOT NULL`. Redaction has to leave the
   row so the event pointing at it survives; `CHECK ((content IS NULL) = (redacted_at IS NOT NULL))`
   makes it symmetric.

### Verification

**64 files, 1317 tests, 0 failures, 0 skipped**, with PostgreSQL up and `AAS_REQUIRE_DATABASE=1`.
45 of those are new schema tests, every one of which writes a row the design forbids and asserts the
database refuses it by SQLSTATE and constraint name.

| Deliberate regression | Caught by |
| --- | --- |
| `only_messages_have_bodies` dropped | ✅ both directions |
| `body_id` becomes `ON DELETE SET NULL` | ✅ redaction tests |
| The event-kind vocabulary is opened up | ✅ closed-set tests |
| A rejection closes the request in the view | ✅ guard tests |
| A secret column appears in the secure DB | ✅ `information_schema` scan |
| A `bytea` blob appears instead | ✅ `information_schema` scan |
| Ordinal uniqueness dropped | ✅ position tests |
| `now()` creeps into the guard view | ✅ view-definition test |
| A handle allowed on an unanswered request | ✅ lifecycle tests |
| The frame token stored raw | ✅ token tests |
| An audit row may free-text its refusal | ✅ audit tests |

---

## [0.12.0] — 2026-08-28

**The contract-first phase: both services' APIs are specified, checked against the code, and proved
unable to carry a secret outside the one endpoint that takes one.**

**Version bump: MINOR.** A new package and a new lifecycle member, both additive. One security
boundary was strengthened and one of my own compile-time assertions turned out to be vacuous; both
are described below.

### Added — `packages/contracts`

The wire contract, as its own dependency-free package ([ADR-0040](./docs/decisions/0040-the-wire-contract-is-its-own-package.md)).

- **`openapi/conversation.v1.yaml`** — the Conversation Service. Six paths, eighteen schemas.
  Sessions are a `__Host-` `HttpOnly` cookie; every endpoint but `/health` requires one.
- **`openapi/secure.v1.yaml`** — the Secure Interaction Service. Six paths, sixteen schemas, split
  into a student-facing surface and an internal API behind mutual TLS on a subnet with no public
  route.
- **`vocabulary.ts`** — every closed set declared exactly once, with the union **derived from** the
  runtime array so the two cannot drift, and a fail-closed parser for each.
- **`events.ts`** — the conversation event model. Exactly one member has a `content` field; the
  others do not have it optional or nullable, they do not have it.
- **`problems.ts`** — RFC 9457 `problem+json` **minus `detail`**. That member is "a human-readable
  explanation specific to this occurrence", which is precisely the field a helpful handler
  interpolates the failing value into — and on the one endpoint that receives a password, the
  failing value is the password. Wording is chosen client-side from a table keyed by code.
- **`frame.ts`** — the cross-origin protocol. A closed union in both directions, content-free, with
  four checks on every receipt: exact origin equality, the specific `contentWindow`, the request id,
  and every enum member parsed against its set.
- **`sse.ts`** — the ordinal **is** the SSE event id, so `Last-Event-ID` maps onto the log with
  nothing in between.
- **`versioning.ts`** — adding an enum member is explicitly non-breaking, because every client is
  contractually required to fail closed on unknown values. The security requirement buys
  evolvability as a side effect.

### Changed — `secret_cancelled` reaches the domain (ADR-0032)

- `SecretLifecycle` gains `secret_cancelled`; three terminal states now, not two.
- **`SecretStore.cancel()`** joins `discard()`. Two verbs rather than one with a reason parameter: a
  reason parameter needs a default, and a default is how the wrong word gets recorded silently.
- Cancellation is reachable **only from `secret_requested`**. Once a handle exists the automation may
  already be spending it, and a cancellation racing a consumption would be a lie in one direction.
- The Phase D compile-time drift assertion caught the change the moment the domain gained the member,
  naming it exactly. Three browser and unit tests asserted the old collapsed word and were updated.

### Fixed — an assertion of mine that was proving nothing

`ONLY_MESSAGES_CARRY_CONTENT` in `events.ts` was written as a conditional type that **computed**
`never` when the claim was false. `never` is a legal type, so the declaration succeeded and nothing
errored: adding `content?: string` to a secure event compiled cleanly. Regression **C4b** found it —
an *optional* field, so no consequential parser error masked the silence.

The distinction that matters: `AssertNever<T extends never>` fails because a **constraint** is
violated. A conditional type that merely evaluates to `never` fails at nothing. Rewritten as
`AssertTrue<Exactly<…>>`, and both directions now caught.

Also fixed: the new package was added without a project reference, so `pnpm run typecheck` passed
having never compiled it. Proved by introducing a deliberate type error and confirming it was
*missed*, then confirming it was caught after the reference was added.

### Verification

| Deliberate regression | Caught by |
| --- | --- |
| A conversation endpoint accepts a password | ✅ contract structure |
| A response hands the submitted secret back | ✅ contract structure |
| A secure event gains `content` in the YAML | ✅ contract structure |
| A secure event gains `content` in TypeScript | ✅ typecheck |
| A secure event gains an **optional** `content` | ✅ typecheck (after the fix above) |
| `MessageEvent` loses its `content` | ✅ typecheck |
| A frame message gains a `password` field | ✅ typecheck |
| A problem gains RFC 9457's `detail` | ✅ typecheck |
| The YAML gains a reason the code lacks | ✅ drift |
| TypeScript gains a reason the YAML lacks | ✅ drift |
| Frame origin check becomes `startsWith` | ✅ frame tests |
| Frame stops checking which window sent it | ✅ frame tests |
| A rejection closes the open request | ✅ openness tests |
| `Last-Event-ID` parsed with `parseInt` | ✅ SSE tests |
| The contract package takes a dependency | ✅ build rule |
| An internal endpoint loses mutual TLS | ✅ contract structure |
| The message endpoint becomes public | ✅ contract structure |

### Still out of scope, deliberately

No migrations, no service implementation, no `packages/conversation`. The contract-first phase
specifies; it does not build.

---

## [0.11.0] — 2026-08-28

**Phase D: one client, and it is the React one — plus the client/server divergence that had been
trapping every student who successfully set a password.**

**Version bump: MINOR.** New capability (the integrated React client), additive. One security
boundary was deliberately NARROWED and one client behaviour deliberately CHANGED; both are
described below, and neither weakens a property — they remove disagreements between two halves of
the system that each believed the other agreed with it.

### Fixed — the two divergences

- **A successful secure step no longer traps the student.** `openRequestFor` counted a row as open
  while its lifecycle was `secret_requested` **or** `secret_received`, released only by
  `secret_consumed` or `secret_expired`. Nothing in this application ever writes `secret_consumed`
  — `store.use()` moves the in-memory entry, not the database row, because the consumer is the
  orchestrator and it does not reach this table. So the only thing that ever released the guard was
  the five-minute TTL, while the client released its composer immediately on the status turn. A
  student who successfully set a password saw a live Send button and collected `409
  secret_request_open` on every message until the request lapsed. "Open" is now exactly
  `secret_requested`, unexpired — the state in which a password box is on screen, which is the only
  state in which an ordinary message risks being a password in the wrong field.

  Why no test caught it: the release path was only ever exercised through `secret_expired`, and the
  browser lifecycle test asserted the Send button was enabled without ever pressing it against the
  guarded route. Two correct halves, and nothing standing on the seam. There are now three tests on
  that seam, one of which asserts the row is *still* `secret_received` when the message goes
  through — so a fix that worked by writing a consumption record would not satisfy it.

- **A rejection no longer closes an open request (F3).** The vanilla harness closed the card for
  every rejection except `confirmation_mismatch`, which released the composer while the server still
  held the request at `secret_requested` — the exact divergence the fail-closed guard exists to
  catch. `openSecureRequest` had always said a rejection closes nothing; the client had simply not
  been asking it. Three browser tests that encoded the old behaviour were rewritten, and say so in
  place.

### Added

- **`useSecureTurn.ts`** — the headless container. Owns the turn list and the three lifecycle
  network calls, and **decides nothing itself**: rendering goes to `decideRendering`, ordering to
  `projectTranscript`, openness to `openSecureRequest`, the composer to `composerPolicy`. The
  harness had hand-copied all four into browser JavaScript, and one of the copies had drifted.
- **`ChatView.tsx`** — the provisional React surface. Composer is **uncontrolled**, for the same
  reason the password field is: a student who mistypes a password into the ordinary box has made a
  mistake, and a controlled input turns that mistake into React state an error boundary can
  serialise. Not a UI/UX proposal; banner-marked in the page.
- **`browser-entry.tsx`, `public/index.html`, `build-client.ts`** — the mount, the page, and an
  esbuild bundle built from the tree on every test run. The bundle is never committed: a checked-in
  build is a second copy of the client, which is what this release removes.
- **Cancellation actually cancels.** `DELETE /api/askimate/secret/:requestId` shipped in 0.10.0 with
  **no client at all**; `SecureControl`'s `onCancelled` cleared the inputs and told nobody. It now
  issues the delete and, only on a confirmed 200, appends a `secret_status · secret_expired` turn —
  a real lifecycle transition, the only closure `openSecureRequest` accepts. A failed delete appends
  a rejection instead, which by design leaves the request open, because it *is* still open.
- **`SECRET_REJECTION_REASONS`** — the closed set is now a runtime array with the union **derived
  from it**, so the two cannot drift; plus `parseRejectionReason`, through which every reason off
  the wire is narrowed before it can reach a turn, the transcript, or the model.
- **`SECRET_LIFECYCLE_WORDS`** — the client's own copy of the four lifecycle words, with a
  compile-time assertion in both directions against `SecretLifecycle`. Not an import, deliberately:
  see the bundle note below.
- **A boundary rule over every client `.tsx`**, not one hardcoded path. Exactly one file may render
  `<input type="password">`, and no file may bind a password-ish name in `useState`/`useReducer`. A
  parent holding the secret in state is as fatal as the control doing it, and was unenforced.
- **A test on the built browser bundle.** It must contain no `InMemorySecretStore`, no
  `node:crypto`, and no consumption vocabulary — and must be a real bundle, so an empty file cannot
  pass by containing none of them.

### Changed

- **`onRejected` is `(reason: SecretRejectionReason) => void`**, not `(reason: string)`. It feeds a
  turn whose `reason` is the closed union, so a `string` meant the narrowing happened elsewhere, or
  nowhere. An unrecognised reason is now narrowed by *how* it failed: a response that named
  something unknown is a newer server (`client_does_not_support_secure_control`); a response that
  named nothing usable — a 500, a proxy page, an unparseable body — is
  `endpoint_unreachable`.
- **Capabilities are read from the client, at the moment a directive arrives** — a function, like
  `now`, rather than a value fixed at mount. The harness carried them on the directive turn, which
  was always a fiction: a server cannot tell a browser what that browser can do.
- **The browser suites now drive the React client** and read real signals instead of debug globals:
  Playwright's record of network traffic replaced `window.__askimateSent` (which proved only what
  the page *believed* it had sent), the 409 response itself replaced `__askimateChatRefusal`, and
  the rendered rejection replaced `__askimateStatus`.

### Removed

- **`public/chat.html` and `public/secure-control.js` — the vanilla harness, retired.** Kept until
  the React path had full browser-level coverage, then deleted. Two clients implementing the same
  security rules is how F3 happened.

### Fixed — found on the way

- **A flaky assertion in `packages/secrets/src/adversarial.test.ts`.** The clean baseline for this
  phase came up red: `expected 'sh_27c123ffea…' not to contain '123'`. A handle is 32 hex
  characters, and "123" occurs in one somewhere in **0.70%** of draws (measured over 200 000
  samples), so the assertion failed about one run in a hundred and forty on entirely correct code.
  It was also proving nothing — a handle derived by hashing the password would contain "123" no more
  often than a random one — so it was replaced by the property it was groping at: derivation is a
  *function*, so fifty draws for the same password must give fifty distinct handles, and the handle's
  shape must not vary with the password's length.
- **`chat.html`'s composer comment (F9)** claimed the composer was disabled while a password box was
  open and pointed at `chatInputEnabled`, deleted in Phase B. Corrected, then removed with the file.
- **A React state update that was not being flushed.** `react-client.test.tsx` imported `act` from
  React rather than from Testing Library, leaving `IS_REACT_ACT_ENVIRONMENT` unset; every delivery
  printed a warning and the wrapper was doing nothing. The assertions passed anyway, because
  `fireEvent` flushed them a moment later — a green test whose synchronisation is inert.

### Verification

| Deliberate regression | Caught by |
| --- | --- |
| `secret_received` counts as open again | ✅ quarantine |
| The guard matches nothing that is open | ✅ quarantine |
| A rejection closes the request | ✅ react-client + fail-closed |
| The server's reason passes through unnarrowed | ✅ fail-closed |
| The secure control becomes controlled | ✅ build rule |
| A parent holds the password in React state | ✅ build rule |
| A second password input appears in the view | ✅ build rule |
| The composer clears optimistically on send | ✅ react-client + fail-closed |
| Drafts keep reaching storage while a request is open | ✅ react-client + fail-closed |
| The secret store is imported into the client | ✅ fail-closed (bundle) |
| Cancel closes the card without the DELETE | ✅ react-client + fail-closed |
| A settled request still renders a live card | ✅ react-client + end-to-end |
| A refused directive still draws a card | ✅ react-client + fail-closed |
| Any string is accepted as a lifecycle word | ✅ react-client |
| A refused message is appended to history anyway | ✅ react-client |

### Still out of scope, deliberately

No request producer, no directive delivery route, and no conversation-event read/write routes.
`replayEvents` still has no caller in application code. Those are Phase E, and Phase E is blocked on
access to the production AskiMate client — a fact about access, not about the design.

---

## [0.10.0] — 2026-08-28

**Phase C: a refused attempt no longer stalls the conversation, and a refresh no longer leaves a
hole in it.**

**Version bump: MINOR.** New capability, additive. No security boundary moved, no behaviour
weakened.

### Added

- **`secret_rejected` as its own turn kind**, carrying a `SecretRejectionReason` — a code from a
  closed union of twelve literals, never assembled text. The client previously recorded a rejection
  only on a `window` variable and pushed no turn at all, so **the model never learned an attempt had
  failed**: it had no reason to offer another and the run waited for a secret that was never coming.

  A separate kind rather than another `secret_status` because a rejection is **not** a lifecycle
  transition — after a mismatch the request is still `secret_requested`, waiting.

- **A compile-time assertion that the two rejection unions cannot drift.** The endpoint's reasons
  and the transport's reasons live in different files and would silently diverge the first time
  someone added one to the route alone. `Exclude<ServerReason, SecretRejectionReason>` must be
  `never`, so a new server reason fails the build naming itself.

- **`askimate_conversation_events`** — the content-free record that lets a refresh redraw a secure
  step *in its original position*. Stores an ordinal, a kind, a request id, and a lifecycle word or
  reason code. **Nothing renderable is stored**: the prompt is reconstructed at read time from
  `askimate_secret_requests`.

  `kind`, `lifecycle` and `reason_code` are text columns constrained by **database CHECK
  constraints** to their closed sets, so "just put the message in `reason_code`" fails at the
  `INSERT` rather than at review. `UNIQUE (conversation_id, ordinal)` makes a replayed write a
  no-op rather than a duplicated item.

- **`DELETE /api/askimate/secret/:requestId`** — cancellation. Without it, a student who changes
  their mind is locked out of their own conversation until the TTL expires, because the composer's
  send is blocked and the server refuses ordinary messages while a request is open. No new lifecycle
  word was needed: `secret_expired` already reads *"the TTL passed, **or the student abandoned
  it**"*.

- **`replayEvents`** — rebuilds non-message turns from those rows. Deliberately does **not** restore
  a handle: one from before a restart resolves to nothing, and replaying it would tell the model a
  secret is available when it is not. An event whose request is no longer resolvable is **dropped**
  rather than rendered from a placeholder.

### Changed

- A rejection **does not close the open request**. A mismatch leaves it `secret_requested` on the
  server; treating the rejection as closure would release the composer while a live request is still
  open — exactly the client/server divergence the fail-closed guard exists to catch.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| Rejection rendered as a fixed sentence instead of the code | ✅ 2 tests |
| Rejection swallowed — no model turn at all (the original stall) | ✅ 2 tests |
| A rejection wrongly closes the open request | ✅ 1 test |
| Replay restores a stale handle | ✅ 1 test |
| Replay invents a prompt instead of dropping the event | ✅ 1 test |
| CHECK constraints dropped from the events table | ✅ 2 tests |
| Cancellation does not discard the secret | ✅ 1 test |
| Cancellation skips the ownership check | ✅ 1 test |
| Client swallows the rejection again | ✅ 2 tests |
| The typed value put on the rejection turn | ✅ 2 tests |
| The rendered note built from the typed value | ✅ 2 tests |
| A new server reason the transport cannot represent | ✅ typecheck |
| Refresh restores the composer draft from browser storage | ✅ 1 test |

### One of my regressions did not fire, and why that mattered

The first attempt at "the note must not carry the typed value" set the note text from
`el("secure-password").value` — and the tests stayed green. Not because they were wrong, but because
the inputs are cleared *before* the note renders, so the value was already gone. The regression was
unfaithful, not the test.

Re-run at points where the value genuinely **is** in scope — put on the turn, and captured in a
closure before clearing — both were caught. Recorded because "the regression passed" is only
evidence when the regression was actually possible.

### A behaviour deliberately left alone

A confirmation mismatch is caught **client-side, before any request is sent**: the box clears, says
so, and stays open. No turn is pushed, and no rejection reaches the model. That is correct — a typo
is not a stall, the student simply retries, and reporting every mistyped character would be noise
the model cannot act on. The stall this phase removes is the **server** rejection, where the box
closes and the attempt is over.

### Still provisional

All UI, copy, layout and interaction detail remains **provisional and unapproved**, including the
wording of the inline rejection note. What is proposed is the mechanism: the sentence is chosen at
render time from a fixed table keyed by the code, and is never carried on the turn.

---

## [0.9.1] — 2026-08-27

**A green local run, a red CI: a constraint checked against the wrong Node version.**

**Version bump: PATCH.** A dependency pin and a new check. No behaviour changed.

### Fixed

- **`jsdom` pinned to `^28`.** `jsdom@30` declares
  `engines.node: "^22.22.2 || ^24.15.0 || >=26.0.0"`, and `.nvmrc` pins `22.20.0`. CI installs the
  `.nvmrc` version, so `pnpm install --frozen-lockfile` refused with `ERR_PNPM_UNSUPPORTED_ENGINE`
  and **both jobs died before a single test ran** — on the commit whose local verification was fully
  green: 56 files, 1108 tests, lint, typecheck and boundaries all passing.

  It passed locally because this development sandbox happens to run Node **22.22.2** — the exact
  minimum jsdom wanted. `engine-strict` is on, so the check did run. It ran against a version the
  project does not target.

  Nothing was skipped and nothing was vacuous. The signal was simply measured against the wrong
  number, which is a failure mode worth naming separately from the others.

### Added

- **`scripts/check-engines.test.ts`** — reads `.nvmrc` and asserts every declared dependency's
  installed `engines.node` accepts it. Checking against the pinned version rather than the running
  one makes the answer the same on every machine, which is exactly what was missing.

  Verified by reinstalling `jsdom@30` and watching it fail with the precise reason.

  It carries three controls, because a checker that silently checks nothing is the failure this
  repository keeps rediscovering:
  1. `.nvmrc` must parse as a version — an empty file would otherwise pass everything.
  2. The workspace walk must find more than fifteen packages — a broken glob would otherwise check
     none.
  3. Fewer than a quarter of dependencies may be unresolvable — the per-package check *skips* what
     it cannot resolve, and a skip reports as a pass.

  Each control was verified by breaking the thing it guards.

### Also

- `semver` and `@types/semver` added as root devDependencies, for the range comparison above.
- `apps/chat-integration/package.json` restored to the repository's compact one-line style for
  `exports` and `scripts`, which `pnpm add` had expanded, and the React specs normalised to caret
  ranges matching every other entry in the file.

---

## [0.9.0] — 2026-08-27

**Phase B continued: the React secure control, transport separation, and four of my own tests that
proved nothing.**

**Version bump: MINOR.** New capability (`SecureControl`), additive. No security boundary moved.

### Added

- **`SecureControl.tsx`** — the secure password control as a React component, **uncontrolled by
  construction**. The inputs own their values; a ref reads them at submit; the two locals in the
  submit handler are the entire lifetime of the password inside the component.
- **`SecureControl.test.tsx`** — walks the React fibre tree (`__reactFiber$…`, hook `memoizedState`,
  `memoizedProps`) for the typed value, deliberately excluding the DOM element's own `value` so it
  can tell "in the DOM" from "in React". Also asserts an error boundary catching a crash captures
  nothing of the password.
- **A boundary rule** in `scripts/check-boundaries.ts`: `useState`/`useReducer`, a `value=` prop, or
  a secret-bearing top-level prop in that file **fails the build**. Tests can be deleted by the same
  commit that breaks the rule; a build rule has to be argued with.
- **Transport-separation tests**: the chat route will not accept a secret submission, the secret
  route will not accept an ordinary message, and neither is reachable at the other's path.
- **A log/telemetry scan** for the guarded chat route, with a **canary test proving the capture
  instrument works** — because a scan over an empty string passes for the wrong reason.

### Fixed

- **ESLint never covered `.tsx`.** Every `files` pattern was `**/*.ts`, which does not match `.tsx`,
  so the new component and its test were outside every rule in the repository — including the
  ambient-clock ban. Widened; linting then found four real problems in the new test.

### Four of my own tests that passed for the wrong reason

Each was found by trying to break it, not by reading it.

1. **`requires authentication before it decides anything`** — sent unauthenticated with *no* open
   request, so the guard was a no-op and the 401 came out either way. **All eight tests passed with
   authentication moved after the guard.** Now opens a request first: auth-first gives 401,
   guard-first would give 409 and tell an unauthenticated caller that a password step is open on
   someone else's conversation.
2. **`has no prop through which a secret could enter or escape`** — used `@ts-expect-error` over
   `void { ...props, password: X }`. Spreading into a discarded object literal gets no
   excess-property check, so all four directives came back **unused**. Replaced with a distributive
   type assertion plus a runtime mirror.
3. **Conversation scoping and expiry** were asserted against the store, not the route. A handler
   that looked up a hardcoded conversation, or passed no clock, would have passed both. Now checked
   through HTTP, both ways.
4. **The guard's placement before the body is read** was a claim in a comment with nothing observing
   it. Now: an open request plus a body with **no** `content` field must still answer 409, not 400.

### The boundary rule was wrong twice before it was right

Worth recording, because a rule that rejects correct code is worse than no rule — it teaches
whoever hits it to weaken the rule rather than the code.

- First version matched file-wide and fired on the **doc comment that explains the hazard**, which
  shows `useState` and `value={…}` as the thing to avoid. Now strips comments before matching.
- Second version matched anywhere inside `SecureControlProps` and fired on the `submit` callback's
  own parameter type, which legitimately carries a password — that function is how the value
  reaches the endpoint. Now anchored to top-level props only.
- It also fails loudly if the interface is renamed, rather than going quietly inert.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| Password input made controlled (`useState` + `value`) | ✅ 3 tests + build rule |
| A `password` prop added to `SecureControlProps` | ✅ typecheck + build rule |
| `value=` prop on the input | ✅ build rule |
| `SecureControlProps` renamed, rule goes inert | ✅ build rule |
| Guard moved after authentication | ✅ 1 test |
| Route ignores `conversationId` | ✅ 1 test |
| Route ignores expiry | ✅ 1 test |
| Content validated before the guard | ✅ 1 test |
| Chat route falls back to reading `password` as content | ✅ 1 test |
| Refusal echoes the request body | ✅ 4 tests |
| Route logs the refused message | ✅ 1 test |
| Client clears the composer optimistically | ✅ 1 test |

### Dependencies

React 19, react-dom, @testing-library/react, @testing-library/dom and jsdom, all as
**devDependencies of `apps/chat-integration` only**. The component is a research prototype for a
client this repository cannot reach; nothing in the runtime path depends on React.

### Still provisional

The component's markup and copy are **placeholders and not approved**. What is proposed is the data
shape and the state discipline — where the value lives, what leaves the component, and what cannot.
A visual redesign should be able to replace every element in the returned tree without touching any
of it.

---

## [0.8.0] — 2026-08-27

**Phase B: the composer stays live, nothing is destroyed, and the guard cannot fail open.**

**Version bump: MINOR.** New capability and a changed public surface
(`chatInputEnabled` → `composerPolicy`, `SecretBindingStore.find` → `findSync` + `openRequestFor`).
Additive for behaviour the student sees; nothing existing was weakened.

### Added

- **`composerPolicy`** replaces `chatInputEnabled`. `typing` is the literal `"live"` rather than a
  boolean, so "disable the composer" is not a value the function can return — reinstating the modal
  freeze requires editing the type, in a diff a reviewer would see.
- **`SecretBindingStore.openRequestFor`** — authoritative, asynchronous, reads the database.
- **`createChatRoutes`** — the ordinary message endpoint with the fail-closed guard, checked
  *before* the message is read for any purpose, so the text never enters scope on the refused path.
- **`scripts/ci-guard.test.ts`** — see **CI** below.

### Changed

- **`find` → `findSync`**, and the port now names two lookups **split by what happens when they are
  wrong**. A cache miss on the secret route means "refuse", which fails closed. The same miss in the
  quarantine guard would mean "nothing is open", which fails **open** — the message path left
  available at the moment a student is most likely to type a password into it. Same data, same
  staleness, opposite consequence, so the types say so.
- **The composer accepts typing while a secure request is open; only the send is inert.** No bytes
  leave the browser, and the draft stays exactly where the student put it.
- **The draft is never auto-sent.** Releasing a buffer when the card closes would transmit a
  password typed into the wrong box, turning a contained accident into a persisted one.
- **The composer clears on acknowledgement, never optimistically**, so a fail-closed refusal
  restores the draft instead of destroying it.
- **Draft persistence to browser storage is suspended** while a request is open.

### Fixed

- **`openRequestFor` had no `ORDER BY`** and returned an arbitrary row when a conversation had more
  than one open request. For "is anything open?" any row would do — but the `requestId` travels back
  to a stale client, which uses it to render the card the student is looking at. Found by a test
  that named the request it had just opened and got a different one back.
- **CI had never passed. Forty-seven runs, forty-seven failures.** Two independent causes, both now
  fixed — see below.

### Security

- **`AAS_DISCOVERY_DRY_RUN` was set by a test and read by nothing.** The comment beside it said "no
  network, so navigation will fail — which is fine", which was true only of the sandboxed
  development machine. GitHub Actions has open network, so on **every push** three tests launched a
  real browser and crawled `qahighereducation.com` and `ulster.ac.uk` — live university sites —
  until each hit its sixty-second timeout.

  This is the more serious half of the CI failure. The standing rule is that nothing runs against a
  real university site without an explicit safe target and Vahid's go-ahead, and a test suite had
  been doing it unattended since the workflow was added. The flag is now real: the CLI resolves the
  target, prints its details, and stops before any browser exists. Every one of those tests now also
  asserts `"No pages fetched."`, so a regression that re-enables the crawl fails here rather than
  quietly reaching the internet again.

### CI

- **The integration job now runs the whole suite** instead of three named directories. A list goes
  stale: a database-backed suite added anywhere else would never have run, and the job would have
  stayed green while covering less.
- **`scripts/ci-guard.test.ts` asserts the workflow still does its job** — from the ordinary
  no-database test path. Delete the integration job, drop `AAS_REQUIRE_DATABASE=1`, or narrow it
  back to a path list, and the default test run goes red.
- The suite-level check **executes** the property rather than grepping for it: each database-backed
  suite is run in its own subprocess against a closed port and must exit non-zero on its own.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| `openRequestFor` reads the process cache instead of the database | ✅ 3 tests |
| Guard removed from the chat route | ✅ 4 tests |
| Composer send not blocked | ✅ 1 test |
| Draft auto-sent when the card closes | ✅ 1 test |
| Draft persistence not suspended | ✅ 1 test |
| `ORDER BY` removed from `openRequestFor` | ✅ 1 test |
| `AAS_REQUIRE_DATABASE` dropped from CI | ✅ 1 test |
| Integration job narrowed to a path list | ✅ 1 test |
| Resolve-only guard removed from the CLI | ✅ 1 test |
| A database-backed suite skips silently under `AAS_REQUIRE_DATABASE=1` | ✅ 1 test each |

### Two of my own tests passed for the wrong reason

Both are recorded because they are the same mistake wearing different clothes.

The CI guard first asserted each database-backed file **contained the string** `"announceSkip"`. It
went red on two files that were entirely correct, because `packages/case-store` inlines the same
throw-if-required logic instead of importing the helper. It was checking a MECHANISM when the
property is behavioural — and a text match would equally have passed on the word inside a comment.

The replacement ran all four suites in **one** subprocess and asserted a non-zero exit. That passed
while a suite skipped silently, because the other three still threw and the aggregate exit code hid
it. Now one subprocess per suite, each of which must fail on its own — verified by making each
suite skip in turn.

### Still provisional

All UI, copy, layout and interaction detail remains **provisional and unapproved**. The harness page
carries a banner saying so. Every assertion added here tests structure, transport or state — never
appearance.

### Residual risk, unchanged

A student can still type their password into the composer and deliberately press Send. Autofocus, an
inert send button and the visible draft reduce the likelihood; none eliminates it, and password
detection is explicitly not used because it cannot work.

---

## [0.7.0] — 2026-08-27

**Phase A of the inline secure turn: the password request takes its real place in the
conversation.**

**Version bump: MINOR.** New capability, additive. The security model is unchanged — no boundary
moved, no new data path opened.

### Added

- **`projectTranscript`** (`apps/chat-integration/src/transcript.ts`) — turns the `ChatTurn` list
  into an ordered list of things to draw, **dropping nothing**. The absence of a `continue` in that
  function is the entire fix: the prototype rendered `if (turn.kind !== "message") continue`, which
  removed the secure request from the conversation and pushed it into a detached panel below the
  composer.
- **`openSecureRequest`** — whether a request is open, *derived from the transcript* rather than
  tracked separately. A tracked boolean is a second source of truth, and the thing it gates is the
  composer, where drifting *open* means an enabled send button beside a password box. This is the
  client's view of what to draw; it is **not** a security control, and the server does not trust it.
- **`NO_FREE_TEXT_OUTSIDE_MESSAGES`** — a compile-time assertion that no transcript item except a
  message may carry free text.

### Changed

- The provisional harness renders directives and statuses **inline, in sequence**, and the secure
  card is *moved into* the transcript rather than living beside it.
- Rendering is now **append-only**. The previous implementation began every render with
  `innerHTML = ""`, which — once the card lives inside the transcript — would tear it out of the DOM
  whenever any unrelated turn arrived, discarding whatever the student had typed.

### Fixed

- **The browser-driven tests had silently stopped testing anything.** `NOW` was the literal
  `2026-08-27T10:00:00Z` while the browser reads its own clock (`secure-control.js` must, since a
  page has no clock to inject). With a 300-second TTL, every prompt was judged expired from
  10:05 UTC onwards and the control refused to render. **Seven tests — including "runs all ten
  steps and leaks the marker nowhere" and "survives a page refresh" — failed for that one reason**,
  reported as six unrelated-looking 30-second `locator.fill` timeouts naming an invisible element
  rather than why it was invisible.

  The clock is now anchored to the real one, and `deliver()` carries a guard that turns a refusal
  under full capabilities into an immediate, named harness fault. These tests are not in the default
  `pnpm run test` path — they need PostgreSQL — so nothing went red until the suite was run against
  a real database.

### Correction to the previous entry

The audit said the secret channel is *"wired to nothing"*. That was too strong. The **orchestrator
already emits `RunStep { kind: "request_secret" }` deterministically** — the decision logic is
integrated. What is missing is the store instantiation, the transport and the UI.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| Reinstate the `continue` that skipped non-message turns | ✅ 8 tests |
| Append controls at the end instead of in place | ✅ 3 tests |
| Interpolate the portal host into the model's directive sentence | ✅ 1 test |
| `content` field on `secure_control` only | ✅ typecheck + 1 test |
| `content` field on `secret_status` only | ✅ typecheck |
| `openSecureRequest` stops closing on a status | ✅ 1 test |
| Revert to `innerHTML = ""` rendering | ✅ 1 test |
| Stop moving the card into the transcript | ✅ 2 tests |
| Password input inside the composer's form | ✅ 1 test |
| `name` attribute on the password input | ✅ 1 test |

The first attempt at the type-level guard was **vacuous**: an `@ts-expect-error` on `item.content`
over the narrowed union only trips if *every* non-message variant grows a free-text field at once,
because `keyof` over a union is the intersection of its members' keys. The realistic mistake is one
variant, in one commit. Replaced with a distributive `ContentBearing<T>` and an `AssertNever`, which
catches either variant alone.

### Not done, deliberately

The composer is still hard-disabled while a card is open. Replacing that with the approved
prevention/containment/fail-closed model is Phase B. **All UI, copy and layout in the harness is
provisional** and carries a banner saying so.

### Internal — documentation carried into this release

These landed as documentation-only commits before 0.7.0 and were correctly not versioned at the
time under [ADR-0028](./docs/decisions/0028-versioning-policy.md) §3. They are recorded here
because 0.7.0 is the first release that follows them.

- **Password flow audit and plan** — `docs/password-flow-audit.md`. **Nothing implemented.**

  Principal finding: every secret-channel component exists and is well tested in isolation, and
  **none of them is wired to anything**. The store is instantiated in no product code; `fillSecret`
  is called only by its own test; `ApplicationSession` has no secret capability.

  Two corrections to the working assumptions: **`storageState` session handoff does not exist** (it
  appears once, as a leak-scan test artefact), and **the model cannot request a credential** — the
  orchestrator decides deterministically, which is stronger than the stated requirement and is
  flagged for a decision rather than changed.

- **The inline secure turn** — `docs/inline-secure-turn-architecture.md`. The finding that
  `ChatTurn` already separates the conversational layer from the secure interaction layer, and that
  the prototype re-joined them at render time.

- **The composer during a secure turn** — `docs/composer-during-secure-turn.md`. Prevention,
  containment and fail-closed as three layers, with server-side quarantine demoted from primary
  mechanism to last line.

---

## [0.6.0] — 2026-08-27

**Phase 4 of durable execution: a consequential action happens at most once — or we admit we cannot
tell.**

**Version bump: MINOR.** New capability, additive. Nothing existing changed.

### Added

- **`performOnce`** — the two-phase intent record. Look for an existing intent, record the new one
  *durably before acting*, act, record the completion *durably after*. A crash between steps 2 and
  4 is the uncertainty window, and it is detectable precisely because step 2 happened.
- **`VerificationResult`** with three cases, not two. `unknown_still` is the honest answer when a
  portal is down or the evidence is ambiguous, and it is **never collapsed into `did_not_happen`** —
  that collapse is exactly what creates a second university account for a student who already has
  one.
- **`recordCleanFailure`** — for failures that provably never left this process. A network timeout
  is explicitly *not* one: a request that timed out may have been received and acted upon.
- **Two end-to-end restart tests against real PostgreSQL**: an account is created exactly once
  across three separate processes with three separate connection pools, and an unverifiable action
  escalates across a restart without ever running twice.

### Security

- **There is no code path that retries an unverifiable consequential action.** `assessIntent` has
  no `retry` verdict and `performOnce` has no branch that reaches `perform()` from an escalation.
  Both are tested by enumeration, because an absence needs a test or it is just a thing nobody has
  done yet.
- **A verifiable action with no verifier escalates** rather than assuming. An action the domain
  says cannot be checked is not made checkable by an optimistic caller.
- **`failed_cleanly` is not retried.** A cleanly failed action still ran; running it again is a
  second attempt nobody decided to make.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| `unknown_still` collapsed into "did not happen" | ✅ 2 tests |
| Intent recorded *after* the action instead of before | ✅ 1 test |
| Unverifiable action retried instead of escalated | ✅ 2 tests |
| `failed_cleanly` retried | ✅ 1 test |
| Missing verifier treated as "did not happen" | ✅ 1 test + typecheck |

**A test that passed for the wrong reason, found and fixed.** The "never performs twice"
enumeration originally started from a *clean* run: perform once, then retry five times. Every retry
hit `already_done` and returned immediately, so the verify branch was never exercised — and the
`unknown_still` regression, which is the whole point of this phase, was caught by exactly one other
test. It now starts from the state a crash actually leaves: an intent written, no completion. With
that change the regression fails 2 tests instead of 1.

### Known limitations

- The three crash windows cannot be reduced to two. A process can always die between an external
  success and our recording of it, and no design closes that gap — this makes it **detectable**,
  which is the most any system can do.
- `RunState.profile` reconstruction remains **explicitly open** (Phase 5, not implemented).

---

## [0.5.0] — 2026-08-27

**Phase 3 of durable execution: the orchestrator checkpoints, and `assess`/`nextStep` stay pure.**

**Version bump: MINOR, not MAJOR.** `RunState.run` is **optional**, so every existing caller still
compiles and a run that does not need to survive a restart passes no store and carries no position.
Making it required would have been MAJOR for no gain.

### Added

- **`packages/orchestrator/src/durable.ts`** — `startRun`, `resumeRun`, `checkpointAfter`,
  `deriveCheckpoint`, `phaseFor`, `mayContinue`.
- **`RunState.run?`** — `runId`, `revision`, `checkpoint`. Position only.
- **A genuine process-restart test against real PostgreSQL.** Process A opens a case, starts a run,
  records an authorisation in the event log, checkpoints two filled fields, then **closes its pool
  — every socket and server-side session gone**. Process B opens its own pool, knowing only the
  `runId`, and resumes at exactly `filling` with both fields.

### Architecture

- **Persistence wraps the decision functions; it does not enter them.** `assess` and `nextStep` are
  untouched and still pure, which is why the orchestrator's tests run without a browser or a
  database.
- **The event log wins every disagreement.** A checkpoint claiming the run reached `filling` with no
  `AuthorisationCaptured` in the log describes a position that never legitimately existed — nothing
  may be filled before the student authorises the exact content — so it is discarded and the run
  re-derives. Same for a checkpoint written against a different blueprint revision.
- **`deriveCheckpoint` copies nothing from a step but its kind.** A `contentHash` is tempting and is
  a business fact that already lives in `AuthorisationCaptured`; two copies is two sources of truth.
- **An `uncertain` or `escalated` run does not continue automatically.** A run that may have created
  a portal account is not something to carry on with because the code path happens to be open.
- **`pg` is a devDependency of the orchestrator and must stay one** — enforced by a new boundary
  check. The orchestrator reaches storage only through ports; a runtime driver would let a query be
  written inside a decision function.

### Known limitations

- **`RunState.profile` is still not reconstructible from the event log**, because
  `ConfirmationCaptured` carries a reference and not a value. `resumeRun` therefore returns the run
  and its events and does **not** rebuild `RunState`; the caller still supplies the profile. This
  is **Phase 5 and remains explicitly open** — closing it here would have meant copying profile data
  into either the log or a checkpoint, which the architecture forbids.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| `checkpointAfter` saves nothing | ✅ 4 tests, incl. both restart tests |
| Reconciliation dropped — checkpoint always trusted | ✅ 2 tests |
| Blueprint-version check dropped | ✅ 1 test |
| `mayContinue` lets an `uncertain` run carry on | ✅ 1 test |
| `deriveCheckpoint` copies a `contentHash` into `detail` | ✅ 1 test |

---

## [0.4.0] — 2026-08-27

**Phase 2 of durable execution: the `WorkflowRunStore`.**

**Version bump: MINOR.** A new port with two implementations, additive. `CaseStore` is untouched —
its append-only guarantees are neither weakened nor extended.

### Added

- **`WorkflowRunStore`** — a **separate** port from `CaseStore`, as approved. `CaseStore` is
  append-only and holds business truth; a checkpoint is mutable and disposable. Forcing one into
  the other would mean either putting execution detail into the business record, or adding an
  update path to an append-only log.
- **`InMemoryWorkflowRunStore`** and **`PostgresWorkflowRunStore`**, both passing the same
  `runWorkflowStoreContract` suite.
- **Migration `0002_workflow_runs.sql`** — `workflow_runs`, `workflow_action_intents`. The
  guarantees are constraints: `PRIMARY KEY (run_id)`,
  `PRIMARY KEY (run_id, idempotency_key)`, a conditional revision UPDATE, and
  `CHECK ((outcome IS NULL) = (completed_at IS NULL))` so a half-written completion cannot exist.
- **`discardCheckpoints`** — the only destructive operation, and the one the contract uses to prove
  rule 3.

### Fixed

- **A corrupt checkpoint crashed `load()` instead of being discarded.** `decodeEvent` is built for
  events, which are always objects, and calls `JSON.parse` on a string input; a JSONB column
  holding the scalar `"a string"` comes back from `pg` as a JS string and parsing it throws.
  Found by the corrupt-checkpoint test, which is why it exists. `decodeEvent` still throws — an
  unreadable *event* means business truth is corrupt and a crash is right — and the workflow store
  absorbs it, because an unreadable *checkpoint* is routine.
- **`ActionIdempotencyKey`** renamed from `IdempotencyKey`. The domain already had an
  `IdempotencyKey` for submissions; two concepts sharing a name is how someone eventually passes
  the wrong one.

### Security

- **Losing every checkpoint loses no business fact** — the executable form of rule 3, in the shared
  contract. After `discardCheckpoints`, the run still knows its case, its student and when it
  started; only position is gone, and position is re-derivable.
- **Intents are NOT discarded with checkpoints.** They are evidence that a consequential action may
  have happened; throwing one away turns a detectable uncertainty into a silent repeat.
- **Every loser of a concurrent resume gets `RunConcurrencyError`**, not a raw driver error — the
  C1 lesson, where a transient-looking error invited exactly the retry that must not happen. Tested
  with eight concurrent resumes, because two can pass by luck.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| Revision check dropped — two resumes both win | ✅ 3 tests |
| `discardCheckpoints` also deletes intents | ✅ 1 test |
| Unreadable checkpoint trusted instead of discarded | ✅ 2 tests |
| The completion `CHECK` constraint removed | ✅ 1 test |

### Known limitations

- The orchestrator does not use this yet. That is Phase 3.
- `RunState.profile` reconstruction remains **explicitly open** (Phase 5, not implemented).

---

## [0.3.0] — 2026-08-27

**Phase 1 of durable execution: the run model.**

**Version bump: MINOR.** New backward-compatible domain vocabulary. Nothing existing changed;
`ExecutionCheckpoint` is reused unmodified.

### Added

- **`packages/domain/src/workflow.ts`** — `RunId`, `WorkflowPhase`, `WorkflowStatus`,
  `WorkflowCheckpoint`, `WorkflowRunRecord`, `ActionIntent`, `ConsequentialAction`,
  `IntentVerdict`, and `assessIntent`.
- **`WorkflowCheckpoint` composes the EXISTING `ExecutionCheckpoint`** rather than replacing it.
  The existing type models position inside the *portal*; the new one adds position inside the
  *workflow*. Two axes, both needed to resume.
- **`assessIntent` has no branch that means "retry".** Its absence is the safety property, and a
  test enumerates every verdict to prove no `retry` appears.
- **`fieldsCompleted: readonly string[]`** — field *refs*, never values. Replaces the
  `filled?: boolean` that recorded a run dying after 40 of 60 fields identically to one dying
  after none.

### Security

- **Rule 3 is enforced structurally, not by discipline.** `CheckpointValue` admits only
  `string | number | boolean | null`, so a `ConfirmedValue`, a document, a profile entry, a secret
  handle or a nested object cannot enter a checkpoint. Five `@ts-expect-error` tests assert each.
- **`scripts/check-boundaries.ts` guards the definition itself.** Following the ADR-0004 lesson
  that a type cannot defend itself against the code that defines it, the check parses
  `CheckpointValue`'s declaration and fails if it is widened, and fails if `workflow.ts` so much as
  *names* `ConfirmedValue`, `PreviewDocument`, `SecretHandle` or `ConfirmedProfile`.
- **`uncertain` cannot become `completed`.** "We do not know whether the account was created"
  cannot become "it worked" without verification (→ `running`) or a human (→ `escalated`).
- **A checkpoint with an unrecognised schema version is discarded, never guessed at** — in either
  direction, past or future.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| `CheckpointValue` widened to `unknown` | ✅ boundary check **and** 4 unused `@ts-expect-error` directives |
| `assessIntent` returns `verify_first` for unverifiable actions | ✅ 2 tests |
| `uncertain → completed` allowed | ✅ 1 test |
| Schema-version check removed | ✅ 1 test |

### Known limitations

- Nothing persists a checkpoint yet. That is Phase 2.
- `RunState.profile` reconstruction remains **explicitly open** (Phase 5, not implemented).

---

## [0.2.1] — 2026-08-27

**A safety claim that was wrong, and the enforcement that makes it true.**

**Version bump: PATCH.** A security fix with no API change, plus the documentation correction that
goes with it — [ADR-0028](./docs/decisions/0028-versioning-policy.md) §3 makes a doc change that
corrects a *wrong safety claim* a PATCH rather than unversioned, because the claim was part of the
product's contract.

### Security

- **ADR-0004's guarantee had a hole.** `values.test.ts` claimed that *"if someone ever adds a
  conversion path from `ModelText` to `ConfirmedValue`… the build fails."* Measured: adding

  ```ts
  export function trustTheModel<T>(t: ModelText): ConfirmedValue<T> {
    return t as unknown as ConfirmedValue<T>;
  }
  ```

  to `packages/domain` **compiled cleanly and failed no test.** The `@ts-expect-error` directives
  test one illegal *assignment*; a conversion *function* casting through `unknown` leaves that
  assignment just as illegal, so the directives stay used and the build stays green.

  **A brand cannot defend itself against a cast.** `scripts/check-boundaries.ts` now fails the
  build if any non-test file outside `packages/profile` casts to `ConfirmedValue` — plain,
  qualified (`Domain.ConfirmedValue`), or dynamic-import
  (`import("@askimate/aas-domain").ConfirmedValue`). All three forms were tested against the check.
  The first version of the rule caught only the plain form and a qualified cast walked past it.

### Fixed

- The header of `values.test.ts` and ADR-0004 now state what the directives actually prove, and
  name the boundary check as the other half. Neither half is sufficient alone.

### Internal

- **Safety regression audit** — five core guarantees deliberately weakened to confirm the tests
  fail. Recorded in `docs/safety-regression-audit.md`.
- **Roadmap and priority analysis** — `docs/roadmap-and-priorities.md`. **C2 is not the next item**;
  the recommendation and the one architectural decision it needs are in §7, awaiting Vahid.

---

## Release state — read before trusting a tag

| Version | Tag object | On the remote? |
|---|---|---|
| `0.6.0` | `v0.6.0` → the `0.6.0` commit | **NO** |
| `0.5.0` | `v0.5.0` → `6dd0500` | **NO** |
| `0.4.0` | `v0.4.0` → `441dd66` | **NO** |
| `0.3.0` | `v0.3.0` → `c59459d` | **NO** |
| `0.2.1` | `v0.2.1` → `fb69b68` | **NO** |
| `0.2.0` | `v0.2.0` → `d39ddb1` | **NO** |
| `0.1.0` | `v0.1.0` → `11629f4` (commit `d985ec4`) | **NO** |

`git push origin refs/tags/v0.1.0` returns **HTTP 403**: this session's
credential can write branch refs but not tag refs. A branch push to the same
remote succeeded seconds earlier, so this is a permission on tags specifically.

**The repository therefore has no published release.** The tag objects exist
locally and must be pushed as the *same objects* once a credential with tag
permission is available — never re-created at a different commit, which is the
state that produces arguments about which `v0.1.0` is real. See
[ADR-0029 §7](./docs/decisions/0029-git-workflow.md) for the reconciliation
order.

---

## [0.2.0] — 2026-08-27

A case now survives the process that created it.

### Internal

Governance work that does not earn a version under
[ADR-0028](./docs/decisions/0028-versioning-policy.md) §3, recorded here so it
stays traceable.

- **Versioning policy formalised** — ADR-0028 defines what earns a release and
  what is tracked by commit only, with explicit rules and exceptions for
  documentation-only, test-only, refactoring, research-only and tooling-only
  changes.
- **Git workflow proposed** — ADR-0029. **Status: Proposed. Awaiting Vahid.
  Nothing has been done — no branch created, no default changed, no tag moved.**
- **Baseline reviewed** — `docs/versioning-baseline-review.md`. `0.1.0` and the
  locked single-version strategy both stand; five conditions named that would
  require independent per-package versioning.
- **Replit dependency map** — `docs/replit-dependency-map.md`. Three items are
  genuinely blocked by the missing production access; everything else continues.
- **`apps/chat-integration` relabelled** as a research build against the
  2026-06-18 archive, in its README and its `index.ts` header.

**Version bump: MINOR.** New backward-compatible capability — a second
implementation behind an existing port. The in-memory store is unchanged and
still passes the same contract; no consumer must change anything.

### Added

- **`PostgresCaseStore`** (`@askimate/aas-case-store/postgres`) — passes the
  identical `runCaseStoreContract` suite as the in-memory store, which is the
  whole reason that suite exists. The guarantees live in constraints rather
  than in application code: `PRIMARY KEY (case_id, "sequence")` is what makes
  two concurrent writers resolve to exactly one winner, and
  `PRIMARY KEY (submission_key)` is the second line of defence against
  duplicate submission. Application-level check-then-write races by
  construction; a unique index does not.
- **Versioned migrations** (`packages/case-store/migrations/`) with a runner —
  forward-only, applied in order, each in its own transaction, per
  [ADR-0003](./docs/decisions/0003-versioned-migrations-not-push-force.md). An
  applied migration's SHA-256 is recorded, so a file edited after it ran fails
  the next run rather than silently doing nothing in every environment where it
  already applied.
- **Tagged date serialisation** — an event's `Date` fields survive storage as
  `Date`, not as strings.
- **Integration CI job enabled.** It had been sitting behind `if: false`
  awaiting exactly this adapter. It runs both database-backed suites with
  `AAS_REQUIRE_DATABASE=1`, so a broken Postgres service fails the run instead
  of reporting green while checking nothing.

### Fixed

- `pnpm run verify:integration` now covers `packages/case-store` as well as
  `apps/chat-integration`.

### Known limitations

- The orchestrator is not yet wired to the Postgres store; it still takes a
  `CaseStore` and is given the in-memory one by the demo scripts. Swapping it is
  a separate change.
- Nothing is deployed. This version marks a state of the source.

---

## [0.1.0] — 2026-08-27

**The first versioned state.** Before this, all eighteen manifests said `0.0.0`, there were no git
tags, no changelog and no release tooling.

This entry is deliberately *not* a reconstructed release history. Everything under **Added** below
already existed in the repository when versioning was introduced; it is listed so that `0.1.0`
names a real, verified state rather than an empty one. What is dated to today is the versioning
mechanism itself.

### Added

- **Versioning mechanism** (today). `scripts/version.ts` with `version:check`, `version:set` and
  `version:bump`; the root `package.json` as the authoritative source; a drift check wired into
  `pnpm run verify`; this changelog; and ADR-0027 recording the choice.

The state this version names, all of which predates the mechanism:

- **Domain core** (`packages/domain`) — branded `ConfirmedValue`, case state machine, event log,
  tasks, retention, minors, requirements, escalation, redaction, audit.
- **Capabilities** — profile, interview, extraction, mapping, preparation, blueprint, disclosure,
  documents, account, requirements, orchestrator, case store, LLM port with a Bedrock adapter.
- **Browser runtime** (`apps/browser-runner`) — read-only discovery that cannot submit (ADR-0014),
  controlled Salesforce-rendering inspection with four hard boundaries (ADR-0024), an LWC-aware
  observation layer, and a sensitive fill session on which tracing and video are structurally
  unavailable (ADR-0025).
- **Model-blind secret channel** (`packages/secrets`) — `SecretHandle`, `useSecret` with no
  getter, single-use destruction before the callback runs, five binding checks, and the four
  lifecycle words (ADR-0026).
- **Chat integration research build** (`apps/chat-integration`) — a secure endpoint, secure
  control and fail-closed render decision, built against the **archived** AskiMate codebase.
  See the Security note below.
- **27 architecture decision records**, and a verification suite of 885 tests plus 31 integration
  tests that require a real PostgreSQL.

### Security

- Personal data can no longer reach a Playwright trace, a video or a log. Playwright writes typed
  values verbatim into `trace.trace`, and stopping tracing around a fill does not prevent it — the
  action is buffered and replayed into the next trace file. A sensitive context therefore never has
  tracing at all, and `tracing.start` throws on it (ADR-0025).
- `tracingIsForbidden` used to answer its question by **calling** `tracing.start()`, which on an
  ordinary context started tracing — a check meant to detect the leak mechanism was switching it
  on. It now reads a module-private mark and touches nothing.
- `fillSecret` relied on a Playwright locator returning null for a missing field. Locators are
  lazy, so a bad selector spent the student's single-use password and then timed out. Field
  existence is now established before the secret is spent.
- `scrubParseErrorBody` removes the raw request body that `body-parser` attaches to a JSON parse
  error as `err.body`. Measured on Express 5 + body-parser 2.3.0: `err.message` and the default
  handler do **not** carry the body, but `JSON.stringify(err)` emits it in full — which is exactly
  what a structured logger does to a caught error.
- The audit system accepts only `AuditSafeText`, so a runtime string carrying personal data cannot
  enter it under an innocuous key.
- A `SubmissionPreview` throws on serialisation rather than silently JSON-encoding a student's
  application into a log or an event.

### Known limitations

- **`apps/chat-integration` is research, not production integration.** It was built against
  `archive/askimate/` in `vaahiiid/Universitio`, which is the AskiMate codebase as of 2026-06-18.
  The current production source for askimate.com is not accessible from this repository — see
  `docs/production-repository-audit.md`. No claim about production security is supported by it.
- Nothing here has touched a live university portal. No account created, no registration, no live
  fill, nothing submitted.
- The default password delivery remains `student_types_into_portal`, where AskiMate holds no
  secret at all.

[Unreleased]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vaahiiid/askimate_auto_apply/releases/tag/v0.1.0
