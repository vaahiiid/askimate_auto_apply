# ADR-0036 — No third-party scripts on authenticated surfaces; analytics is server-side

**Status:** **Accepted** — delegated technical authority, 2026-08-28
**Extends:** [ADR-0030](./0030-the-secure-control-runs-on-its-own-origin.md),
[ADR-0025](./0025-sensitive-data-never-reaches-a-trace.md)

## The problem

A tag manager is a script loader whose payload is chosen at runtime, outside the repository. That is
its purpose and its value for marketing. It has three consequences that are unacceptable on a page
where a student is authenticated and typing:

1. **Build-time controls cannot see it.** Code review, CI, and this repository's own boundary rules
   are structurally unable to inspect code that does not exist until the page loads.
2. **A container publish is not a deploy.** No pull request, no review, no rollback discipline, and no
   signal anywhere in version control that anything changed.
3. **Any script on an origin can read any input on that origin**, and session-replay and heatmap tools
   do so by design. Their masking features are opt-in configuration — a setting someone must not get
   wrong, protecting a property we have promised is absolute.

None of this makes tag managers bad. It makes them unsuitable on an authenticated surface.

## The decision

**Three tiers, by origin.**

| Origin | Purpose | Third-party scripts |
|---|---|---|
| `www.askimate.com` | Marketing, blog, unauthenticated | **Permitted.** Tag manager, GA4, whatever marketing needs |
| `app.askimate.com` | The authenticated conversation | **None.** First-party bundle only; analytics emitted server-side |
| `secure.askimate.com` | The secure control | **None**, and nowhere to send anything: `connect-src 'self'` |

Product analytics for the authenticated app is emitted **server-side**, from the conversation service,
as named events from a closed set. The server already knows everything the client would have reported —
it wrote the event log — and a server-side event cannot read an input.

## Why server-side rather than a curated client-side tag list

A curated allowlist is a policy someone must keep. Server-side emission is an architecture in which
there is no browser-side vendor code to curate. It also produces better data: no ad-blocker loss, no
consent-banner gaps in the funnel, and events that agree with the database by construction.

## Controls, in force order

1. **The secure control's origin loads no third-party code**, and its `connect-src 'self'` means even
   an injected script has nowhere to exfiltrate to.
2. **`app.askimate.com` ships a nonce-based CSP with no `'unsafe-inline'`** in `script-src`. This is
   only achievable because there is no tag manager bootstrap to accommodate — the two decisions
   support each other.
3. **Session credentials are unreadable by any script** (ADR-0033), so in-page code cannot exfiltrate
   the session even where it runs.
4. **A CI check that cannot be forgotten.** The existing Playwright harness loads the secure control
   and asserts that the set of script origins is exactly `{secure.askimate.com}` and the set of
   network destinations likewise. A tag added later fails the build rather than being noticed later.

## If a tag manager is ever reintroduced on an authenticated surface

It would be a business decision with a security cost, and it would require, at minimum: publish rights
restricted to named people with enforced 2FA; a ban on Custom HTML and Custom JavaScript tags; server-
side tagging so the browser runs no vendor code; container version diffs reviewed where code diffs are
reviewed; and an audit of every DOM Element, Auto-Event and Form Submission variable and trigger. That
list is written down here so it does not have to be reconstructed under time pressure.
