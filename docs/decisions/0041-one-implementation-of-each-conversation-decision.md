# ADR-0041 — One implementation of each conversation decision, enforced by the build

**Status:** **Accepted** — delegated technical authority, 2026-08-28
**Extends:** [ADR-0039](./0039-repository-structure-for-the-independent-product.md),
[ADR-0040](./0040-the-wire-contract-is-its-own-package.md)

## What the duplication actually was

Not sloppiness — **two generations of the same idea**, coexisting. The turn model in
`apps/chat-integration` and the wire model in `packages/contracts` each had their own answer to five
questions: is a step open, what may the composer do, can this client render, what is drawn, what
reaches the model.

And they had already drifted, in a way that mattered:

```ts
// superseded — closes on ANY status
else if (item.render === "secret_status") open = null;

// authority — closes only the request it NAMES
if (open === event.requestId) open = null;
```

`ChatTurn`'s `secret_status` variant had no `requestId`. Two requests in one conversation — a lapsed
one and a live one — and the lapsed one's settlement released the live one's composer guard, letting
a message through while a password box was on screen.

**The old model could not express the correct rule.** That is why this was a migration to the wire
model rather than a lift of the existing code, and it is the strongest argument for the extraction:
the duplication was not merely redundant, one copy was wrong and nothing could have told them apart.

## The decision

`packages/conversation` is the single domain authority for five decisions:

| Decision | Question |
|---|---|
| `openSecretRequest` | Is a secure step open? |
| `composerPolicy` | What may the composer do about it? |
| `decideRendering` | Can this client show the step at all? |
| `projectTranscript` | What is drawn, and in what order? |
| `buildModelRequest` | What reaches the model? |

Both services and both browser bundles consume this implementation. `check-boundaries.ts` fails the
build if any file outside that package **defines** one of these names; importing is what they are for.

## Two narrowings the extraction forced, and both are improvements

- **`decideRendering` takes the channel and the expiry**, not a whole `SecretPrompt`. Under
  [ADR-0030](./0030-the-secure-control-runs-on-its-own-origin.md) the conversation plane never has
  the title, the explanation or the portal host — the secure origin holds them and renders them
  itself. A decision that cannot reach the prompt cannot leak it.
- **`SecureControl` takes only the fields it renders.** It never needed the channel, the expiry or
  the observed rules; those are inputs to a decision that ran before the component existed. It no
  longer imports `@askimate/aas-secrets` at all, so the package that holds the secret store is one
  step further from any browser bundle.

## What stayed behind, and why that is not duplication

`replayEvents` in `apps/chat-integration` reads the LEGACY `askimate_conversation_events` table. It
has no counterpart in the authority because it is a fact about a table being retired, not a decision.
It now yields wire events, so the shared decisions run over its output too.
