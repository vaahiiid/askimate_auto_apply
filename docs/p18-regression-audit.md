# P18 — the deliberate regressions, and two controls that were not controls

**Date:** 2026-09-03 · **Governs:**
[ADR-0055](./decisions/0055-a-process-refuses-to-start-when-it-is-not-safe.md)

Ten mutations. Each was applied, then the file was re-read **from disk** and the
new text asserted present before any test ran. Restores are from a file copy,
never `git checkout`.

Eight were caught. **Two survived**, and both were the same shape: a thing this
phase was explicitly asked to deliver as a *control* turned out not to be one,
because something else was doing the work. Both are now genuinely load-bearing,
and each was re-run against its new test to prove it.

| # | The mutation | Caught by |
|---|---|---|
| **S1** | The reader raises the FIRST problem instead of collecting every one | 5 assertions across both suites |
| **S2** | The error message echoes the configured value | `puts NO configured value in what it prints` |
| **S3** | The dev-session production refusal is inverted | `REFUSES the dev session route in production` |
| **S4** | The fixture-catalogue production refusal is removed | `REFUSES a fixture catalogue in production` |
| **S5** | `assertVaultIsProductionGrade` is not called at startup | **survived** — see §1 |
| **S5b** | as above, against the control's new home | `REFUSES a production process that would use a local master key` |
| **S6** | A service serves an unmigrated database | `REFUSES to serve an unmigrated database` |
| **S7** | The cache is never verified at startup | `REFUSES to start against a cache that would evict under pressure` |
| **S8** | `take` becomes a GET and a DEL instead of `GETDEL` | `is taken by exactly ONE of two racing callers` — see §3 |
| **S9** | The runner's forbidden-configuration refusal is removed | `REFUSES a runner that is handed a database` |
| **S10** | Shutdown fires `close()` without waiting for it | **survived** — see §2 |
| **S10b** | as above, against the new test | `RELEASES ITS LEASES before it exits` |

## 1 · S5 — the vault control was shadowed by the configuration

Vahid's P18 list names it directly: *"`assertVaultIsProductionGrade` becoming a
real production startup control."* The first implementation called it in the
Secure Service's entry point, which looked like exactly that.

S5 deleted the call. **Every test passed.**

Because `secureConfigFrom` already refuses a production start without
`AAS_SECURE_KMS_KEY_ID` — so by the time the provider is chosen, a production
process cannot be holding a local one. Two checks guarding one property, and the
one actually stopping the process was not the one the requirement named. The
assertion was decorative in the assembled system, which is precisely the
condition this repository keeps finding and refusing to leave alone.

**What changed.** `keyProviderFor` now makes the choice and the refusal one
function, in `packages/secrets`, called by both secure-plane processes. The
configuration's refusal stays — it puts the problem in the same message as
everything else wrong — but the control now sits inside the decision it guards,
where deleting it changes an outcome. S5b fails on
`expected [Function] to throw an error`.

## 2 · S10 — a clean shutdown that closed nothing

`installShutdown` awaits `close()`, then logs `stopped` and exits zero. S10 made
it fire `close()` and carry on. **Every assertion still passed**: the exit code
was zero, the log said `shutting down` and `stopped`, and the port was free —
because the process was gone either way.

The test was asserting the *appearance* of a clean shutdown. Nothing checked
that anything had been closed.

**What changed.** The worker's shutdown releases its `worker_leases` so the next
worker does not wait a full lease period for work it could start immediately —
a behaviour `docs/deployables.md` states and one that is observable in the
database *after the process has exited*. The test now takes leases, sends
`SIGTERM`, waits for exit zero, and reads the table. Under S10b: **two leases
left behind.**

Worth naming the general shape, because it has now cost two phases: an exit code
and a log line describe what a process *said*, not what it *did*. Where a
shutdown has a consequence somebody else can observe, that consequence is the
assertion.

## 3 · S8 — four fill agents, one password

The single most vivid result of the phase. `take` uses `GETDEL` so the read and
the removal are one command. S8 split it into a `GET` and a `DEL`, and the race
test went from one winner to **four**:

```
is taken by exactly ONE of two racing callers
  → expected [ {…}, {…}, {…}, {…} ] to have a length of 1 but got 4
```

Four processes, each told it may type a student's password into a university
portal. Against a real Redis, not a model of one — which is why this test needed
a real server rather than a fake that would have serialised the calls by
accident.

## 4 · What the eight caught ones establish

S1–S4, S6, S7 and S9 are the refusals, and together they are the phase's actual
claim: **the startup validator is the executable form of the deployment
checklist.** Each mutation turns one refusal back into a service that starts —
with no identity provider, or a test catalogue, or an unmigrated schema, or a
cache that would silently drop a student's credential — and each is caught by a
test that spawns the real binary and reads what it printed.

S2 deserves one note. It made the error message append the offending value, and
the test that caught it looks for a database password and a session secret in
the output. That is the assertion that keeps this safe to send to a log
aggregator, and it is cheap to lose: a well-meaning "show the value so they can
see what's wrong" is a natural thing for somebody to add.

## 5 · What these regressions do NOT cover

Stated because the coverage is genuinely partial:

- **Nothing here proves a production start works**, because a production start
  is currently impossible by design (ADR-0055 §5, and `docs/deployables.md`).
  The refusals are tested; the acceptance path in production is not, and cannot
  be until identity and a catalogue exist.
- **`KmsDataKeyProvider` has still never run against a live key.** The
  configuration path that reaches it is now real and tested; the first
  `GenerateDataKey` remains an operator's first-run check
  (`secure-plane-deployment.md` §3.1).
- **The Chromium starvation from P17 is unresolved.** See the standing
  limitations in `where-we-are.md`.

---

*Ten mutations, eight caught, two survivors — each a thing that looked like a
control and was not, and each now one.*
