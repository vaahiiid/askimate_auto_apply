# ADR-0038 — Identity is delegated to a managed OIDC provider

**Status:** **Accepted** — delegated technical authority, 2026-08-28
**Note:** the technical decision is settled here. **Vendor choice has a cost dimension that is
Vahid's** — see "What remains yours" below. Nothing is blocked on it, because the standards-only
constraint makes the vendor swappable.

## The problem

The repository **verifies** JWTs and issues none. Something has to authenticate students, and the
choice is build or adopt.

## The decision

**Adopt a managed OIDC provider. Do not build authentication.**

Building it means owning, correctly and forever: password hashing and its migration path as
parameters age, credential-stuffing and breached-password detection, rate limiting and lockout that
does not become a denial-of-service vector, email verification and its enumeration risks, password
reset tokens and their timing, MFA enrolment and recovery codes, device and session management,
session revocation, account recovery, and the incident response when any of it fails.

None of that is our product. All of it is a well-understood way for a small team to ship a
vulnerability, and none of it differentiates a university-application assistant.

## The constraint that makes the vendor swappable

**Standards only.** We depend on OIDC Authorization Code with PKCE, standard claims, and the discovery
document. No vendor-specific claim, SDK-only feature, or proprietary session format appears anywhere
outside a single adapter module. The provider becomes a dependency we can replace in a sprint rather
than an architecture.

Concretely:

- Authorization Code + PKCE, no implicit flow, no ROPC.
- The provider's tokens are exchanged **at the conversation service** for our own `__Host-` session
  cookie (ADR-0033). Provider tokens never reach browser storage and never leave the server.
- `sub` is the only identifier we persist. Email is profile data, not identity, so a student changing
  it does not become a different person.
- Email verification state is read from the provider and re-checked server-side at every secure step,
  never trusted from a client claim.

## Recommendation on vendor

**Amazon Cognito**, on the grounds that it is in the account and region already established by
[ADR-0012](./0012-aws-region-eu-west-2.md), needs no new vendor relationship or data-processing
agreement, and keeps student identity data in eu-west-2 alongside everything else — which matters for
the UK GDPR position. Its developer experience is worse than Auth0, WorkOS or Clerk; because of the
standards-only constraint above, that is a cost we can pay and later stop paying.

## What remains yours

- **Vendor and tier**, which is a cost and vendor-relationship question, not a technical one.
- **Whether unauthenticated guest conversations exist at all.** That is a product and growth decision.
  The security half is settled regardless and is not waiting on it: **a secure step requires an
  authenticated student with a verified email**, and the guard refuses otherwise.
- **MFA policy** — whether it is offered, encouraged or required — which is a UX and support-cost
  judgement.
