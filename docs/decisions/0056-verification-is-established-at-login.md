# ADR-0056 — Email verification is established at authenticated login, not re-read at every secure step

**Status:** **Accepted** — Vahid, 2026-09-03 ·
**Amends:** [ADR-0038](./0038-identity-is-delegated-to-a-managed-oidc-provider.md), whose wording
described a live provider re-read this system deliberately does not perform ·
**Implements:** the OIDC adapter boundary ADR-0038 requires ·
**Related:** [ADR-0033](./0033-sessions-are-httponly-cookies.md) (the `__Host-` session),
[ADR-0034](./0034-the-vault-is-ephemeral-and-encrypted.md) (what a secure step is)

## Context — a guard that was described and did not exist

ADR-0038 states, as settled:

> *"Email verification state is read from the provider and re-checked server-side at every secure
> step, never trusted from a client claim."*

And the `students.email_verified` column carries a comment saying the same thing:

> *"Re-read from the provider at every secure step rather than trusted from a client claim."*

**Neither was true.** Measured on `7519c30`: `students.email_verified` has `DEFAULT false`, is written
`true` only by test fixtures, and is **read by nothing**. `#openSecureStep` checks the request purpose
and whether the Secure Plane is reachable; it checks nothing at all about the student.

So the one place a student types a password had no verification gate, and two accepted documents said
it had one. That is worse than a missing feature: it is a security claim a reader would rely on.

## The decision

**Verification is established once, from a signature-verified provider response at login, persisted
server-side, and enforced from that persisted state at every secure step.**

Vahid, 2026-09-03, choosing this over a live lookup:

> *"I do not want provider access tokens stored in the conversation plane simply to re-check
> `email_verified` at every secure step."*

### §1 · Why not a live re-read — stated so a future reader does not "fix" this

A literal re-read at every secure step means calling the provider's userInfo endpoint at that moment,
which requires a valid provider access token, which means **the conversation plane stores provider
tokens and refreshes them.** That is new long-lived sensitive state in the plane that holds student
identity, added for one boolean.

What the alternative buys is narrow: it would notice a student verifying their email *after* signing
in, without them signing in again, and it would notice verification being revoked. Weighed against
holding OAuth tokens for every student, that is not a good trade — and the failure direction of not
having it is **refusal**, which is the safe direction.

**This is a deliberate choice, not an approximation of the other one.** If a future phase needs
revocation latency, it needs a new decision about token storage, not a quiet edit here.

### §2 · What is trusted, and what is never trusted

The claim is `email_verified`, the standard OIDC boolean, requested with the `email` scope.

**Trusted:** the ID token returned by the **server-side code exchange**, whose signature is verified
against the provider's JWKS, whose `iss`, `aud`, `exp` and `nonce` are checked.

**Never trusted:** anything the browser sends. No query parameter, no request body, no header, no
cookie value other than our own signed session. The browser's only role in the flow is carrying a
redirect.

### §3 · The four cases, and why all four are refusals except one

The adapter returns a **closed set** rather than an optional boolean, so a caller cannot forget a
case and no absence can be read as consent:

| Provider response | Result | Secure step |
|---|---|---|
| `email` present, `email_verified: true` | `verified` | **allowed** |
| `email` present, `email_verified: false` | `unverified` | refused |
| no `email` claim | `no_email` | refused |
| `email` present, no `email_verified` claim | `no_verification_claim` | refused |

The last two matter most. **A missing claim is a refusal, never a default.** An identity provider that
does not tell us whether an address is verified has not told us it is verified, and treating silence
as `true` is exactly how a "fail safe" system stops being one.

Only `verified` persists `students.email_verified = true`. Every other case persists `false`, so the
database never holds an optimistic value.

### §4 · The student verifies later

They must sign in again before the secure step opens. They are told so.

This is the accepted cost of §1. It is a real UX cost and it is bounded: signing in again is one
redirect, and the message says exactly what to do rather than leaving a step mysteriously refused.

### §5 · The adapter boundary — Cognito is behind it

ADR-0038's standards-only constraint, made structural: **the adapter fetches the provider's discovery
document and derives every endpoint from it.** No endpoint URL is hardcoded, so nothing in this
repository encodes where Cognito puts its authorize or token endpoint — a detail that differs from the
issuer host and is exactly the kind of vendor knowledge that leaks.

The only provider-specific values anywhere are configuration: an issuer URL, a client id, a client
secret and a redirect URI. There is no AWS SDK in the conversation plane, no `cognito:*` claim is read,
and swapping provider is a change to four environment variables.

The adapter returns **identity facts only** — the closed set in §3. Tokens do not cross the boundary,
so no caller can start depending on one.

### §6 · What this phase does NOT do

- **No MFA policy.** ADR-0038 leaves it to Vahid; nothing here forecloses it.
- **No specialist identity.** ADR-0048's release blocker stands and is its own phase, gated on a
  second specialist existing.
- **No guest-conversation decision.** A product question, untouched.
- **No token storage, no refresh, no revocation checking.** §1.

## Consequences

**Good.** The guard ADR-0038 describes finally exists. The four cases are exhaustive and every
ambiguous one refuses. The provider is swappable by configuration, and Cognito appears nowhere in
application code.

**The cost.** Verification is as fresh as the student's last sign-in. Stated here, in ADR-0038, and in
the migration comment — all three previously said something else.

**Not decided here.** Whether revocation latency ever matters enough to store provider tokens.

---

*Accepted 2026-09-03. P19 implements it.*
