# ADR-0128 — Read the page the runner sees before anything learns to push past it: `--as-runner`, `--covering`, and no dismisser

**Status:** Accepted · 2026-09-18 · follows [ADR-0127](./0127-the-submit-is-two-waits-with-two-names.md), whose split named the press · found by Run A's attempt 2
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-18. **Built in P161**, the same day.

## Context — the press, named, and a page nobody has read

Attempt 2 of the repeat, with ADR-0127's split in place:

```
sign-in failed — the sign-in button could not be pressed — TimeoutError: the step timed out;
the password box is still on the page
```

The press, not the answer. The thirty seconds never came into it. Both of P157's hypotheses —
the race, the server — were wrong, and the split found the real site in one attempt where two
unnamed timeouts had said nothing. Something is over the button, the form is still there, and the
page went nowhere.

What is over it is not known, and the reason it is not known is a fact about the record: **the
runner's page has never been observed.** Every capture this repository holds refused Google Tag
Manager under the guard's host rule (AUTH 6's caveat), so anything a tag injects has never appeared
in a page anyone has read. The runner allows tags. It also presents `AskiMate-Runner/1.0` as its
user agent — a non-browser string no capture ever sent — and Playwright's default 1280×720
viewport. The runner meets a page that differs from every capture in three ways at once.

## Decision 1 — read it, do not push past it

> *"Do not fix the press. Do not add a banner dismisser, a click-through, or a
> wait-for-overlay-to-clear. Whatever is over that button, I want to see it named from a capture
> before anything in the runner learns to push past it."*

Nothing in the runner changes. A dismisser written now would be written for an overlay nobody has
seen — a fourth confident reading — and a runner that learns to click through things it cannot
name is a runner that will one day click through the wrong thing on a real application.

## Decision 2 — `--as-runner`: the attached read, as the runner

The attached-inspection tool (P79) gains a mode that reads **the page the runner meets**:

- **Off-host reads let through, and recorded.** `offHostReads: "allowed"` lifts the host rule for
  `GET`, `HEAD` and `OPTIONS` only; every read to a host off the target's list is written to the
  run record. The method rule is untouched — nothing that is not a read proceeds, on any host. The
  fixture proves both halves: a tag on a second host is refused by default and loaded as the
  runner, and a write is refused in both.
- **The runner's user agent presented.** The `User-Agent` header is rewritten at the guard on every
  request let through, so the portal and its tags answer *what do you serve that agent*. The page's
  own `navigator.userAgent` stays the person's browser's; the run record states this as a limit.
- **The runner's viewport.** The tool's tab is set to 1280×720, so layout matches.

The identity presented is `RUNNER_PRESENTS` in `runner-identity.ts`, and a test pins it to the
string `sign-in.ts` opens its context with, so the read and the runner cannot drift apart silently.

## Decision 3 — `--covering`: name what stands at the button's point

`--covering name=loginBtn` reads, for a named control, `document.elementsFromPoint` at the
control's own centre — top-most first, down to the control — with each layer's tag, id, classes,
computed `position` and `z-index`, box, dialog/iframe role, and its own visible text trimmed to 160
characters. `covered` is true when the top-most element is neither the control nor inside it: the
fact a press cannot get past. It dispatches nothing.

The reading is a capture a person looks at, alongside the screenshot P79 already takes; it is not
the runner's log, so ADR-0124's rule about page text does not bind it, and the text is what names
a banner.

## What this ADR does not guess

It does not name a consent banner, a cookie dialogue, a bot interstitial or anything else. The
runner's page is unobserved; that is the whole reason for the read. The read may find that the
covering element is a tag's banner, that the user agent is served a different page, that the
viewport puts something over the button, or something none of those. Each is an observation to
make, and P161 makes it possible to make without any of them being assumed.

## Consequences

- `pnpm run inspect:attached sheffield --cdp … --as-runner --covering name=loginBtn <login url>`
  reads the login page as the runner meets it and says what stands at the button's point, in the
  terminal and in `run.json` (`asRunner`, `presented`, `offHostReads`, `covering`).
- The person's browser is still read-only while attached, on every host, as before.
- Whatever the read names is the input to the next decision, which is Vahid's. Nothing in the
  runner has changed and nothing will until that decision is taken in his words.
