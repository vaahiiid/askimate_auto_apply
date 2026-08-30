# ADR-0042 — The credential is consumed inside the Secure Plane

**Status:** **Accepted** — Vahid's decision, 2026-08-30
**Extends:** [ADR-0026](./0026-a-password-the-model-can-ask-for-and-never-see.md) (the callback model),
[ADR-0034](./0034-the-vault-is-ephemeral.md) (the envelope vault),
[ADR-0030](./0030-the-secure-control-runs-on-its-own-origin.md) (the secure origin),
[ADR-0037](./0037-service-topology-and-deployment.md) (topology),
[ADR-0025](./0025-sensitive-data-never-reaches-a-trace.md) (nothing sensitive reaches a trace)

## The problem

The vault hands plaintext to a **callback**:

```ts
use<T>(handle, task: (secret: string) => T | Promise<T>, now): Promise<VaultUse<T>>
```

That works when the vault and the consumer are in one process. They were not. The vault lives in
`apps/secure-service`; the code that types the password lived in `apps/browser-runner`. A closure
cannot cross mTLS, so completing the design meant choosing which of three things to give up: the
callback, the process boundary, or the rule that no secret becomes service-to-service response data.

The published contract had already picked a side and then described an arrangement that did not
exist:

> *"the vault hands the plaintext to the automation's callback and returns the callback's result"*

There was no such callback. `/internal/v1/secret-uses` called `vault.use(handle, () => true, now)` —
it **spent the entry and discarded the plaintext**, because on that side of the boundary there was
nothing to hand it to.

Two further facts made the old arrangement unshippable rather than merely incomplete. First,
`InMemorySecretStore` holds plaintext in one process's heap, so the instance that received the
submission and the instance spending the handle were different processes and the handle resolved to
nothing on any real run. Second, the runner is the component *least* suited to holding a credential:
it loads pages we do not control, runs blueprint-driven logic against sites we cannot audit, and is
the most likely thing in the system to be compromised.

## What was rejected

**Returning the plaintext over mTLS.** Vahid, 2026-08-30:

> *"Sending the plaintext back in an HTTP response, even over mTLS and a private subnet, weakens one
> of the strongest guarantees we have deliberately established: that the secret does not become
> ordinary service-to-service response data."*

Every argument in ADR-0026 §2 against `getSecret()` applies with more force over HTTP: the value
lands in a response body, an HTTP client's buffers, a retry, a serialised error object, and any proxy
or platform log in the path.

**Moving the browser automation into the Secure Service.**

> *"Option (c) also creates unnecessary coupling between the Secure Service and browser automation."*

Correct, and it would put a browser — visiting a third-party portal — inside the dependency tree of
the one service that receives a password.

## The decision

**A fourth Secure Plane deployable, `apps/secure-filler`: the fill agent.**

It is the smallest component that can hold the callback:

- it constructs its **own** `EnvelopeVault` over the **same** envelope cache and the **same** KMS key
  as the secure service, so it obtains the ciphertext locally and decrypts it in its own process;
- it reaches the runner's browser over the Chrome DevTools Protocol and performs exactly one browser
  operation — `fill` on one field;
- it asks the secure service to **authorise and settle** the use, and that exchange carries no value
  in either direction.

Nothing sends it a secret. `SecretUseResult` is unchanged and still has no field that could carry
one; the contract's sentence about the callback is now literally true for the first time.

The runner keeps every other browser responsibility. It navigates, fills ordinary fields, uploads
documents and observes pages exactly as before. What it loses is the ability to hold a credential —
enforced, not asked for: `scripts/check-boundaries.ts` fails the build if `apps/browser-runner`
declares `@askimate/aas-secrets` or `@aws-sdk/client-kms`, or if any of its source files so much as
names `EnvelopeVault`, `InMemorySecretStore`, `useSecret` or `getSecret`.

### The order of operations, and why

```
1–5  everything establishable WITHOUT a secret        ← a failure here spends nothing
 6   the authority to spend, from the secure service  ← settles the lifecycle
 7   decrypt locally, type, zero                      ← the only plaintext
```

Steps 1–5 are: the browser is reachable; the page is unambiguous; the page's **host matches the
bound target host**; the field exists; the field is an `input` the browser renders **masked**; and
**nothing is streaming DOM snapshots**. A handle that fails any of them has not been spent, which is
what stops a blueprint mistake costing a student their single-use password.

Step 6 before step 7 is deliberate. The reverse — decrypt, type, then report — has a failure mode
with no good answer: a crash between the two leaves a spent password the conversation plane never
learns about, and an audit trail with a use missing from it. This order's failure mode is a settled
use that did not happen, which resolves as the student being asked again. Fail closed, in the
direction that leaves a record; and it is the same semantic ADR-0026 §3 already establishes, where a
callback that throws has still spent the secret.

### What the agent VERIFIES rather than trusts

`confirmNoDiagnosticCapture()` cannot cross a process boundary: it reads a private symbol left on a
`BrowserContext` by `openSensitiveContext`, and the agent holds a different object for the same
underlying context. The question was whether anything real was left to check. Three experiments
against real Chromium, with the fill performed by a second process over CDP:

| Runner-side state | Value in `trace.trace` | Detectable from the page |
|---|---|---|
| tracing, `snapshots: true` | **yes, verbatim** | **yes** |
| tracing, `snapshots: false` | no | no |
| no tracing | no | no |

The first row is the finding: a value typed by *another process* still lands in the runner's trace,
because the leak is the DOM snapshot rather than the action's parameters. The third column is what
makes it fixable — Playwright's snapshotter installs a `window` property beginning
`__playwright_snapshot_streamer_`, present in exactly the configuration that leaks and absent in both
that do not. The agent checks every frame, and treats a frame it cannot evaluate in as suspect.

This is **stronger** than what it replaces. ADR-0026 already admits that a consumer "could write a
consumer that returns `true` and lies"; a check performed by the component being checked guards
against accident. This one is performed by the component that holds the plaintext.

Video is the one capture route the agent cannot detect remotely, because recording happens on the
runner's side and leaves no mark in the page. That is why the field must be **masked**: a recording
of a `type="password"` input shows dots. There is deliberately no override — a portal that collects a
password in an unmasked field is a finding to escalate, not a flag to set.

The `noDiagnosticCapture: true` assertion is kept anyway, and a false or absent value is still
refused. It no longer carries the guarantee, but a caller that has not thought about capture should
not be able to reach the endpoint by omission.

## What this does and does not protect

**Protected.** The password never exists in the runner's heap, its logs, its error objects, its crash
dumps or its diagnostic artefacts. The runner holds no vault, no KMS grant and no route to the
envelope cache, so compromising it yields no *historical* secrets and no ability to decrypt one.
Neither plane's HTTP surface can carry a value: the end-to-end suite records every byte of every body
exchanged between the three processes and asserts the password appears in exactly one — the student's
own submission, travelling towards the one endpoint designed to receive it.

**Not protected, and recorded here rather than glossed over.** The runner still *owns* the browser
the agent types into, so a runner that has been actively compromised can read the field afterwards —
`readValue` on its own `FillableSession` is one call. Closing that would mean moving the browser out
of the runner, which means moving the automation, which is the decision this ADR was explicitly told
not to make. What is bought is real and worth having: a password is reused across sites and a portal
session is not, so keeping the password out of the large, portal-facing, frequently-changing
component is the trade that matters. If the residual is ever judged unacceptable, the successor is
not a patch to this design but a different one — the Secure Plane performing the whole declared
authentication flow and handing the runner a session instead of typing a credential into its page.

## Consequences

- **A fourth deployable**, its own ECS task, its own task role, its own security group. It is *not*
  a sidecar in the runner's task: containers in one Fargate task share the task role through the
  credentials endpoint, so a KMS grant on that task would be a KMS grant for the runner as well —
  the exact widening this ADR exists to prevent.
- **Two extractions**, so nothing is duplicated across a trust boundary:
  `@askimate/aas-secure-logging` (the field-allowlist logger, now used by both Secure Plane
  processes) and `@askimate/aas-browser-fill` (locator resolution, the keystroke, and the page
  guards, used by the runner and the agent). Two copies of "which element does this blueprint mean"
  would eventually disagree, and on the agent's side that disagreement is a password typed somewhere
  it should not be.
- **`/internal/v1/secret-uses` changes meaning, not shape.** It grants authority and settles the
  lifecycle; it no longer takes the ciphertext, because the agent needs it. Single use is still
  enforced twice, now on either side of the boundary: `settle` + `recordUse` make a second call
  answer 409, and `EnvelopeCache.take` is atomic and removes the entry before the callback runs.
- **`apps/secure-service` may not declare Playwright as a production dependency.** The browser
  automation went to the agent precisely so this service would not grow one.
- **No approved security boundary moves.** ADR-0030, 0033, 0034 and 0035 are untouched. The
  Conversation Plane still receives only handles and lifecycle words.
