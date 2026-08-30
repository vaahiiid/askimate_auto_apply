# ADR-0042 — the deliberate regressions, and what each one proved

Ten regressions, applied one at a time to a clean tree. Each was **proved to have
applied** by reading the file back from disk and asserting the new text is
present and the file changed — then the relevant suite was run and required to
fail **on a named assertion**, not on a timeout and not on a compile error that
happened to be nearby. Every file was restored from a full-path-keyed backup
afterwards, and `git status` was checked clean.

> The apply-proof matters more than it sounds. The first version of the harness
> asserted that the *anchor text was gone*, which is only true for regressions
> that replace rather than insert. It reported **six false negatives** — six
> regressions that had applied perfectly and were recorded as "did not apply".
> A harness that mis-reports in that direction is safe; one that mis-reports the
> other way certifies a proof that never ran.

| | The regression | Detected by |
| --- | --- | --- |
| **R1** | The agent returns the plaintext alongside a valid result, `as unknown as SecretFillResult` | `fill-agent-e2e` — *puts the password on NO wire between any two processes* |
| **R2** | The agent stops verifying that nothing is streaming DOM snapshots | `fill.test` — *detects a snapshot-streaming tracer in the runner's context and refuses* |
| **R3** | The agent stops requiring the field to be a masked password input | `fill.test` — *refuses a field the browser does not render masked* |
| **R4** | The agent stops checking the page is on the bound target host | `fill.test` — *refuses a page that is not on the bound host, before asking for authority* |
| **R5** | The field-existence wait moves to AFTER the secret is obtained | `fill.test` — *does NOT spend the handle when the field does not exist* |
| **R6** | `apps/browser-runner` declares `@askimate/aas-secrets` again | `check-boundaries` — the manifest rule |
| **R7** | A runner source file names `EnvelopeVault` through a deep relative import | `check-boundaries` — the source rule, which is the one a manifest cannot catch |
| **R8** | The secure service takes the ciphertext again, as it used to | `fill-agent-e2e` — *fills the field, settles the lifecycle, and spends the handle exactly once* |
| **R9** | The published contract grows a `secret` field on `SecretFillResult` | `openapi.test` — *has NO response, anywhere, that can carry a secret value back* |
| **R10** | `apps/secure-service` takes a **production** dependency on Playwright | `check-boundaries` — the production-only rule added for exactly this |

## The three worth explaining

**R1 is the one this phase exists for.** The end-to-end suite records the body of
every HTTP message between the runner, the fill agent and the secure service, in
both directions, and asserts the password appears in **exactly one** — the
student's own submission, travelling towards the one endpoint designed to receive
it. "Exactly one" rather than "none" is deliberate: a scan finding zero would
mean the recording was broken and would pass for the wrong reason.

**R5 is the one that costs a student something.** If the field-existence wait
moves after the vault call, a blueprint whose selector has drifted spends a
single-use password on a field that was never there, and the student has to be
asked for a new one. The test that catches it does not merely check a refusal
code — it asserts the authority was **never requested**, the ciphertext is still
in the cache, and that a corrected locator then spends the same handle.

**R7 catches what R6 cannot.** A manifest rule sees declared dependencies.
`import "../../../packages/secrets/src/vault.js"` resolves perfectly well and
pnpm never hears about it, so the runner's source files are scanned by name as
well — in tests too, because a test that stands up an in-process vault inside the
runner is a template for production code that does the same.

## What was NOT regression-tested, and why

The residual ADR-0042 records: **a compromised runner can read the field it asked
to have filled.** There is no test for it because it is not a defect to detect —
it is a property of the chosen boundary, stated in the ADR. `readValue` on the
runner's own `FillableSession` returns what is in a field, and it exists for a
good reason (portals silently truncate at `maxlength`). Removing it would not
close the hole, because the runner owns the browser and could ask CDP directly.
