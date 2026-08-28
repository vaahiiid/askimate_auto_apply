# ADR-0040 — The wire contract is its own package, and OpenAPI is the published form

**Status:** **Accepted** — delegated technical authority, 2026-08-28
**Refines:** [ADR-0039](./0039-repository-structure-for-the-independent-product.md),
[ADR-0005](./0005-contract-first-openapi.md)

## What ADR-0039 said, and what it missed

ADR-0039 named one shared package, `packages/conversation`, for "the decision modules". Building the
contracts made a seam visible inside that: **describing the wire and deciding about it are different
jobs with different consumers and different dependency budgets.**

## The decision

Two packages.

| Package | Answers | Dependencies |
|---|---|---|
| `packages/contracts` | *What may appear on the wire, and is this an instance of it?* | **None. Enforced.** |
| `packages/conversation` | *What do we render, send the model, and let the composer do?* | May depend on `contracts` |

`packages/contracts` holds the closed sets and their parsers, the conversation event model, the error
contract, the frame protocol, the SSE framing, the versioning rules, and the two OpenAPI documents. It
holds no behaviour: `projectTranscript`, `composerPolicy`, `decideRendering` and `buildModelRequest`
belong in `conversation` and can arrive when the services do.

### Why the dependency budget is zero, and checked

`contracts` is consumed by two services and two browser bundles, and one of those four is the secure
control — the file whose supply chain has to stay inspectable by reading it. A dependency added here
arrives in all four without anyone deciding that. `check-boundaries.ts` fails the build on any runtime
dependency, and on any workspace dependency even in `devDependencies`.

That rule bit immediately and usefully: the first version of the lifecycle drift test imported
`@askimate/aas-secrets` **without declaring it**, which worked only because pnpm hoists. It now lives
in `scripts/contract-drift.test.ts`, where cross-package assertions belong.

## Why the lifecycle words are written twice

`contracts` declares the lifecycle words rather than re-exporting `SecretLifecycle`. Importing the
secrets package as a **value** drags `InMemorySecretStore` — the object that holds plaintext — toward
any browser bundle touching the module. Measured, not theorised: esbuild refused to build the Phase D
client with `Could not resolve "node:crypto"` when exactly that import was tried.

`scripts/contract-drift.test.ts` compares the two lists in both directions, at runtime and at compile
time, which is what makes writing them twice safe rather than merely tolerated.

## OpenAPI is the published contract; TypeScript is the checked mirror

ADR-0005 requires contract-first OpenAPI. YAML cannot import from TypeScript, so the closed sets
appear in both. `openapi.test.ts` compares them **in both directions** — a value added to either
without the other fails the build rather than shipping as a divergence between what we published and
what we implement.

The same test walks every schema reachable from every operation in both documents and asserts the
security properties as facts rather than as prose: that exactly one operation accepts a secret, that
no response anywhere can return one, that only `MessageEvent` has a `content` property, that every
request body and event member is closed to additional properties, and that no path or query parameter
is a credential.

## Consequence for the boundary rules

The build now enforces three things about this package that a reviewer would otherwise have to
remember: no runtime dependency, no workspace dependency, and — through the drift and structure tests
— that the published document and the code cannot disagree.

## Addendum, 2026-08-28 — `packages/conversation` now exists, and the boundary moved

This ADR said `contracts` answers *"what may appear on the wire"* and `conversation` answers *"what
do we decide about it"*. When `conversation` was actually built, two functions turned out to be on
the wrong side of that line and were moved:

- **`openSecretRequest`** — is a secure step open? A decision, and the one the composer guard trusts.
- **`persistableContent`** — what do we store? A decision.

Both now live in `@askimate/aas-conversation`. `contracts` keeps the model, its parser, and
`eventCarriesContent`, which is a fact about the shape rather than a choice about it.

A build rule now enforces the other direction too: outside `packages/conversation`, the five
decisions may be **imported but not defined**. See ADR-0041.
