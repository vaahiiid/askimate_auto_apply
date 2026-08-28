# ADR-0030 — The secure control runs on its own origin

**Status:** **Accepted** — decided under the technical authority Vahid delegated on 2026-08-28:
*"use the approach that experienced professional teams would use for a production-grade
security-sensitive product… do not keep asking me to choose between technical options where there is
a clear professional best practice."*
**Extends:** [ADR-0026](./0026-a-password-the-model-can-ask-for-and-never-see.md)

## The problem this solves that ADR-0026 could not

ADR-0026 established that the model never sees the password. Phases A–D delivered that, and delivered
more: the input is uncontrolled, read through a ref at submit, guarded by a build rule and a test that
walks the React fibre tree for the typed value.

All of that defends against **our own code** capturing the value. None of it defends against **other
code on the same page**:

```js
document.querySelector('input[type=password]').value   // any script, any origin-mate
```

Whether our input is controlled is irrelevant to a script that reads the element. A delegated `input`
listener, a `MutationObserver`, or a session-replay tool sees the same thing. The same-origin policy
does not distinguish our code from a tag someone added in a console, an injected script, or a
dependency that turned malicious in a patch release.

So the guarantee ADR-0026 requires — *never* — cannot be carried by in-page discipline.

## The decision

**The secure control is served by a separate service on a separate origin
(`secure.askimate.com`), embedded in the conversation as a cross-origin `<iframe>` at the
directive's ordinal position.**

The student sees one continuous conversation. The browser sees two origins that cannot read each
other's DOM, storage, or JavaScript heap.

## Why this is the professional answer, not a novel one

This is the established pattern for exactly this problem. Every major payment provider solves
"collect a secret on someone else's page without that page being able to read it" the same way:
Stripe Elements, Braintree Hosted Fields, Adyen Secured Fields, Checkout.com Frames. All of them are
cross-origin iframes, and all of them exist because the alternative — trusting the host page — is not
a control anyone can audit.

The PCI-DSS scoping rules make the reasoning explicit: a merchant using hosted fields qualifies for
SAQ A rather than SAQ A-EP, **because the merchant's page cannot touch the data**. The card industry
concluded, with more money at stake than we have, that origin isolation is the difference between a
promise and a control. A university portal password deserves the same treatment.

## What crosses the boundary

Only `postMessage`, and only a closed union with no free-text member:

```ts
type SecureFrameMessage =
  | { kind: "ready";           requestId: string; height: number }
  | { kind: "resize";          requestId: string; height: number }
  | { kind: "secret_status";   requestId: string; lifecycle: SecretLifecycle; handle?: string }
  | { kind: "secret_rejected"; requestId: string; reason: SecretRejectionReason }
  | { kind: "cancelled";       requestId: string };
```

Validated on every receipt, all four checks, no exceptions:

1. `event.origin === SECURE_ORIGIN` — exact string equality. Not `startsWith`, not a regex.
2. `event.source === frameRef.current?.contentWindow` — the frame we rendered, not any frame.
3. `requestId` matches the request this frame was created for.
4. Every enum member parsed against its closed set before use.

The reverse direction carries no secret-bearing data at all.

## What this costs, stated plainly

- **Risk concentrates on the secure origin.** An XSS there is catastrophic where before it was merely
  bad. Mitigated by keeping that service deliberately tiny: one document, `script-src 'self'`, no
  inline script, no CDN, no user-controlled HTML, no templating of untrusted input, no source maps
  served.
- **Frame mechanics are real work**: height negotiation by `postMessage`, focus and keyboard across a
  boundary, duplicated design tokens versioned with the parent, an accessible frame title, and a
  device matrix that includes iOS rather than assuming it.
- **Two deployables** with a shared release discipline.

## The alternative that was rejected, and why

**Same origin, stricter CSP on the secure route.** Cheaper and genuinely better than nothing. It fails
on a specific mechanism: a single-page application does not re-fetch its document when the route
changes, so a route-scoped CSP never applies to a control rendered inside an already-loaded page.
Making it apply requires a full-page navigation — which breaks the "never leave the conversation"
requirement more thoroughly than a frame does.

## Consequences

- `SecureControl.tsx` moves to the secure service. Its logic is unchanged; it already posts to a
  same-origin endpoint, which is now the secure origin's own endpoint.
- `useSecureTurn.ts` keeps every decision it makes. Its transport changes from `fetch` to
  `postMessage` receipt.
- The tag-manager question stops being load-bearing for the secret. It remains a live question for
  the session token and the student's messages — see ADR-0036.
