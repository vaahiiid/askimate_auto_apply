# P27 — deliberate regression audit

Fourteen mutations against the new path-level guard, the corrected contract, and the authentication
boundaries the contract declares. Each was applied to a file on disk, **read back from disk to prove
the edit landed**, run against the control that governs it, and restored from a byte copy taken
before the edit — never from `git checkout`.

**All fourteen are caught. None survived.** That is unusual for this repository and worth explaining
rather than celebrating: this phase built controls where there were none, so every mutation is
aimed at a check written in the same phase and known to be reachable. The honest measure of P27 is
not the regression score but the **seven** discrepancies found before any of these mutations
existed — six by the new path guard on its first run, and a seventh by reading the resulting diff.

| # | Mutation | File | Result | Caught by |
|---|----------|------|--------|-----------|
| R1 | A served route is dropped from the contract | `conversation.v1.yaml` | **CAUGHT** | contract-drift |
| R2 | The contract publishes a route nothing serves | `conversation.v1.yaml` | **CAUGHT** | contract-drift |
| R3 | The `/v1` prefix silently comes back off a student path | `conversation.v1.yaml` | **CAUGHT** | contract-drift |
| R4 | Health goes back to the name nothing serves | `conversation.v1.yaml` | **CAUGHT** | openapi ×2 |
| R5 | An internal route is quietly unpublished again | `conversation.v1.yaml` | **CAUGHT** | contract-drift |
| R6 | The secure plane's frame-token route is unpublished | `secure.v1.yaml` | **CAUGHT** | contract-drift |
| R7 | A new public route is added and never published | `routes.ts` | **CAUGHT** | contract-drift |
| R8 | The guard tolerates an app with no routes at all | `contract-drift.test.ts` | **CAUGHT** | contract-drift |
| R9 | An unpublished route loses its stated decision | `contract-drift.test.ts` | **CAUGHT** | contract-drift |
| R10 | A route is excepted that is not served at all | `contract-drift.test.ts` | **CAUGHT** | contract-drift |
| R11 | An internal route is published without mutual TLS | `conversation.v1.yaml` | **CAUGHT** | openapi ×2 |
| R12 | The bootstrap capability is published as an open route | `conversation.v1.yaml` | **CAUGHT** | openapi ×2 |
| R13 | The secure document's security default goes back inside `components` | `secure.v1.yaml` | **CAUGHT** | openapi ×2 |
| R14 | A default is parked under `components`, where nothing reads it | `secure.v1.yaml` | **CAUGHT** | openapi |

## R7 — the failure this phase exists to prevent, replayed

R7 is the only mutation that adds a **route** rather than editing a document. It registers
`GET /v1/conversations/:conversationId/shadow` in `routes.ts` and publishes nothing — which is
exactly what happened to the bootstrap route in P4 and to the intervention family in P11, both of
which then went unnoticed for over twenty phases.

```
× publishes every route the Conversation Plane serves, and serves every one it publishes
```

It fails now because the guard reads the **router**, not the source. A textual check could have
been fooled by a route registered through a helper or a nested mount; the layer walk cannot, because
it is reading the same table Express would dispatch against.

## R8 — the vacuity guard, and why it needed its own test

The comparison is `expect(published).toEqual(served)`. If `routesOf` returned an empty array, that
assertion would agree with an empty contract and **both** route tests would go green while the
service served whatever it liked.

R8 removes the throw on an absent layer stack. It is caught by a test that asserts the throw
directly and then asserts the real planes still yield more than ten and more than five routes
respectively — a floor, so the guard cannot quietly narrow to nothing.

This is the same lesson P25 recorded from the other direction: a rule that passes while looking at
nothing is worse than no rule, because it reports a ✓.

## R9 and R10 — the exceptions are data, not a pattern

Three routes are deliberately unpublished. They are named individually with the ADR that decided
each, and **not** matched by a pattern such as `startsWith("/auth/")`, because a pattern would
silently swallow the next route that matched it.

- **R9** replaces an ADR citation with `"it is fine, trust me"`. Caught: an exception must cite a
  decision, asserted as `/ADR-\d{4}/`.
- **R10** adds `POST /admin/impersonate` to the exception list — a route nothing serves. Caught: an
  exception naming an unserved route is a hole being pre-cut, and the test asserts every excepted
  route is one the plane actually registers.

Together these mean the exception list cannot grow to cover a new surface without someone writing
down which accepted decision permits it.

## R11 and R12 — the authentication boundary, unchanged and still enforced

P27 publishes four previously-undescribed operations, three of them internal and one of them
handing out a capability. Both mutations check that the *existing* `openapi.test.ts` guards still
bind the newly published routes rather than merely the old ones:

- **R11** removes `serviceMutualTls` from a newly published internal route. Caught twice — by "puts
  every internal operation behind mutual TLS" and by "authenticates every STUDENT-facing endpoint
  with a `__Host-` cookie", which asserts the reverse direction separately so one cannot satisfy
  the other.
- **R12** marks the newly published bootstrap route `security: []`. Caught: the intended-open set
  is an exact list, and a capability-minting route is not on it.

The bootstrap's frame token appears in a **response body**, which is correct and unchanged: it is a
capability rather than a secret of the student's — a line `openapi.test.ts` had already drawn for
the secure document's copy — and the "no capability travels in a URL" guard still covers where it
may not go.

## R13 and R14 — the seventh discrepancy, found by reading the diff

The path guard is a route-table check and would never have found this one. It surfaced during the
manual review of the production diff, from a script printing the resolved security requirement of
every operation:

```
secure.v1.yaml   top-level security: undefined
                 components.security: [{"secureSession":[]}]   ← not an OpenAPI field
  GET    /v1/secret-requests/{requestId}          UNSECURED IN CONTRACT
  DELETE /v1/secret-requests/{requestId}          UNSECURED IN CONTRACT
  POST   /v1/secret-requests/{requestId}/secret   UNSECURED IN CONTRACT
```

`security: [{ secureSession: [] }]` was indented two spaces, placing it **inside `components:`**,
where OpenAPI has no such field and every generator ignores it. As published, the secure document
declared no authentication at all on its three student-facing operations — including
`POST /v1/secret-requests/{requestId}/secret`, **the one endpoint in this system that carries a
secret**.

Proved pre-existing against `git show HEAD`, so it is not something this phase introduced.

Nothing was ever exposed: the service authenticates those routes with the `__Host-` secure cookie,
and the two-origin browser suite proves it. What was wrong is the contract — which is what a
reviewer reads and what a generated client would build against.

The existing "leaves exactly the intended operations unauthenticated" test could not catch it,
because it looks for an explicit `security: []`. These declared **nothing at all** — a different
shape, and the more dangerous one, because absence reads as an oversight rather than a decision. Two
new assertions close it: every operation must resolve to a real requirement (its own, or a document
default that actually exists), and `components.security` must be undefined.

## A harness hazard, recorded because it nearly cost the fix

`run.py`'s `save()` skips when a snapshot already exists, and `shutil.copy2` preserves mtimes. R13
and R14 therefore restored a `secure.v1.yaml` snapshotted during R6 — **before** the security fix —
silently reverting it. Caught by re-reading the file from disk after the run rather than trusting
the restore.

The same hazard bit P25. The fix both times is to delete the snapshot store before re-running after
an edit; the durable lesson is that a restore is only trustworthy if the thing it restores is read
back and checked.

## What is deliberately not covered

- **`GET /auth/login` and `GET /auth/callback` are not schema-checked**, because they are redirects
  rather than operations. There is no request or response body to describe, and a generated client
  could not follow the chain anyway. The guard asserts they are *excepted with a reason*, not that
  their behaviour is right; ADR-0056's own tests cover the flow.
- **`express.static` is not a route.** It mounts a middleware, not a layer with a path, so it does
  not appear in the table and is not an operation to publish.
- **The regression score is not the finding.** Twelve of twelve caught measures a control built and
  tested in one phase. What P27 actually establishes is that six real discrepancies existed and
  nothing was looking.
