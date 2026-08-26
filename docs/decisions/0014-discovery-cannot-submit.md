# ADR-0014 — Discovery is structurally incapable of submitting

**Status:** **Accepted** — implementing Vahid's Phase 3 authorisation, 2026-08-26

## The requirement

> Discovery and inspection should remain clearly separated from actual submission. Do not submit a
> real application or create a consequential application for a real student without a further
> explicit approval from me.

## Decision

Enforced at **two independent layers**, because one is not enough for an instruction of this weight.

### 1. Type level — there is nothing to call

Browser sessions come in three nested capability levels:

| | Can do | Used by |
|---|---|---|
| `ReadOnlySession` | navigate, observe, screenshot | **discovery** |
| `FillableSession` | + fill (`ConfirmedValue` only), click, attach | preparation, Phase 5 |
| `SubmittableSession` | + submit (requires an `AuthorisationToken`) | Phase 6 only |

A `DiscoverySession` has no `fill`, no `click`, no `submit`. Not "must not call" — the methods do
not exist on the type.

Note `fill` takes `ConfirmedValue<string>` and nothing else: the ADR-0004 wall reaches all the way
to the keyboard. And `submit` requires an `AuthorisationToken` that this package cannot construct,
so the browser runner cannot manufacture its own permission to submit.

### 2. Network level — the guard

Every request the browser makes is intercepted. In discovery mode, anything that is not a safe,
idempotent read (`GET`/`HEAD`/`OPTIONS`) on an allow-listed host is **aborted before it leaves the
machine**. An allow-list of methods, not a block-list: a method nobody thought of is refused.

**Why the second layer is not redundant.** Type safety governs what *our* code does. It says
nothing about what *the portal's* code does. A page can POST without anyone calling a method — an
auto-submitting form, an analytics beacon, a session-registration call on page load.

This is not hypothetical. A portal that registers a partial application on first load would create
a real record against a real institution — precisely what Vahid withheld approval for. The fixture
in `apps/browser-runner/fixtures/` does exactly that, and the test asserts the request never
reaches the server.

### Blocked requests are a finding, not just a log entry

If discovery observes a portal attempting a write during ordinary browsing, that tells us the site
cannot be inspected without side effects — something a specialist must know before execution is
ever attempted. `BlockedRequestLog.portalAttemptedWrite` surfaces it in the discovery report.

## Two more constraints worth recording

**Host allow-list.** Even a `GET` is confined to the run's target hosts. Discovery of one
university's portal has no business loading another site, and an open-ended crawl is not what was
authorised.

**Honest identification.** The runner sends a User-Agent naming itself as AskiMate discovery. Brief
§7 forbids defeating protective mechanisms; that principle covers not disguising itself as an
ordinary browser. If a portal wishes to refuse us, it should be able to.

## A blueprint is not executable until reviewed

Discovery always produces `status: "draft"`. `checkExecutable` refuses anything that is not
`reviewed`, and also refuses a blueprint with **no observed URLs** — one assembled from hearsay
rather than first-hand observation was never really discovered. Executing either is how a wrong
reading becomes a wrong application.

## Consequences

- Discovery can be run against a live portal without risking a consequential action.
- Granting fill or submit capability is a visible, deliberate change in the code that requests it.
- The safety property is tested against real Chromium, not asserted in a comment.
- Extending discovery to interact with a page (to explore conditional logic) would require a new
  capability level and a new decision — it cannot happen by accident.
