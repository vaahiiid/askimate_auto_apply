# ADR-0039 — Repository structure for the independent product

**Status:** **Accepted** — delegated technical authority, 2026-08-28
**Extends:** [ADR-0027](./0027-one-version-for-the-whole-repository.md)

## What was wrong

`apps/chat-integration` is shaped as an *integration into somebody else's application*: its name says
so, its schema is transcribed from a foreign database, and its entry point carries a "research build —
not the production integration" banner. That framing was accurate and is now obsolete.

## The decision

```
apps/
  conversation-service/   ← was chat-integration. Plane A: log, messages, LLM, SSE
  secure-service/         ← new. Plane B: the control document, the vault, handle spending
  browser-runner/         ← unchanged. Plane C
packages/
  secrets/                ← unchanged. Handles, binding, single-use, callback-only consumption
  conversation/           ← new. The decision modules, shared by both services and the two clients
  …fourteen existing packages, unchanged
```

`packages/conversation` holds what both planes must agree on, and it holds **only** things that are
pure: the `ConversationEvent` union, `projectTranscript`, `openSecureRequest`, `composerPolicy`,
`decideRendering`, `buildModelRequest`, the closed reason and lifecycle sets and their parsers. Two
services and two client bundles consuming one implementation is what makes "the client and the server
cannot disagree" a structural claim. Phase D found that exact class of bug twice; extracting the
shared authority is the durable fix.

## What survives unchanged

The decision modules and `packages/secrets` are the valuable output of Phases A–D and they move
without edits. `SecureControl.tsx` moves to `secure-service` as-is: it already posts to a same-origin
endpoint, which is now the secure origin's own. `useSecureTurn.ts` keeps every decision it makes and
changes only its transport.

## Gaps this restructure must close

Three of these are ADRs this repository already accepted and has not yet honoured. Naming them here so
they are closed deliberately rather than discovered later:

| Gap | The ADR it violates | Resolution |
|---|---|---|
| The chat schema ships as one `SCHEMA_DDL` string, with no migrations | [ADR-0003](./0003-versioned-migrations-not-push-force.md) | Versioned migrations before any data exists. `packages/case-store` already does this correctly and is the pattern |
| No OpenAPI document anywhere | [ADR-0005](./0005-contract-first-openapi.md) | Author the contract for both planes' public APIs **before** implementing them, and generate the client types from it |
| `FREE_TEXT_COLUMNS` grows with the schema | — | Collapses to one entry under [ADR-0031](./0031-one-conversation-event-log.md) |

## Versioning

One version across every manifest, unchanged. The two services are released together: they share the
`postMessage` contract and the design tokens, and independent versioning of two halves of one protocol
is how a protocol drifts.
