# ADR-0130 — The point is read at every press, not only a failed one: as the login page opens, just before the press, and at a failure

**Status:** Accepted · 2026-09-18 · follows [ADR-0129](./0129-the-runner-reads-the-point-at-the-moment-the-press-fails.md), whose read named the overlay at a failed press · keeps [ADR-0124](./0124-the-runner-says-what-it-did-in-words-it-is-allowed-to-say.md) and [ADR-0127](./0127-the-submit-is-two-waits-with-two-names.md) whole · the first of the two decisions on blocker 47
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-18. **Built in P164**, the same day.

## Context — the overlay named at one press, and absent at the next, unread

Attempt 1 of Run A's third conversation printed the line ADR-0129 was built for:

```
sign-in failed — the sign-in button could not be pressed — TimeoutError: the step timed out;
pending: another element intercepts pointer events; the password box is still on the page;
at the button's point: div#ccc-overlay (fixed, 1280×720 at 0,0) > input (static, 130×21 at 238,566)
```

A full-viewport backdrop with Civic CookieControl's id, at the button's point, at the instant the
press failed — the fifth hypothesis on this one step, and the first one measured rather than
reasoned. Attempt 2, minutes later, pressed through and signed in. Nothing was read at that press,
because the runner read the point only inside the catch of a failed one. So the overlay is
sometimes there, and whether attempt 2 pressed before it arrived, or it never appeared, is not
known.

Vahid, putting the six options for the overlay in order:

> *"Option 0 first and unconditionally. We do not know why the overlay was absent at attempt 2,
> and anything built on top of an unmeasured absence is built on a guess. Read the point at a
> successful press as well as a failed one, and once as the login page opens, so attempt 3 names
> it either way."*

## Decision — three readings of the same point, in the same words

The sign-in reads the stack at the button's centre three times, and prints each:

1. **As the login page opens**, after `goto` and before the challenge probe or a character is
   typed: `sign-in, as the login page opens: nothing over the sign-in button (button#signIn
   (static, 57×21 at 546,80))`, or `… over the sign-in button: div#cover (fixed, 1280×720 at
   0,0)`.
2. **Just before the press**, inside `settleSignIn`, immediately before the click: the same
   clause under `just before the press`. Then, when the click lands, `sign-in: the button was
   pressed`.
3. **At a failed press**, in the catch, the ADR-0129 line, **unchanged**: the pending check and
   the whole stack down to the button.

Read *before* the press rather than after it, because a press that lands may navigate the page at
once and take the point with it, and a press that fails reads the point again in its catch. The two
readings are milliseconds apart; together with the reading at the open, they say whether the
overlay was there when the page opened, whether it was there when the press was made, and, when
the press fails, what stood there at the failure. The fixture proves the case that matters: a
layer added after the page opened reads as *nothing* at the open, *over the button* just before
the press, and *at the button's point* at the failure — the race attempt 2 may have won and
attempt 1 lost, made deterministic.

Structure only, as ADR-0129: tag, id, classes, position, box; never a layer's text. The fixture's
late layer carries the words "We use cookies" and none of the three lines does.

## What this does not do

Nothing in the runner's behaviour changes. No wait, no delay, no dismissal, no second press. A
press that meets the overlay still fails and still stops for a person. Getting past the overlay
is option 2 (blocker 47), the student's decision per portal, and it is built on these readings
rather than on the absence attempt 2 left unmeasured.

## Consequences

- Attempt 3 prints what stood over the button at the open and at the press, whichever way the
  press falls, in the same words as the failure line. The next "why was it absent" is answered
  from a log, not a guess.
- The 124-pixel difference between the as-runner read's button position and attempt 1's now
  comes with its cause on the next run: the open reading carries the button's own box.
- `overControlInWords` in `point-of-control.ts` is the one read for the two non-failing moments,
  beside `atPointInWords` for the failure; `sayOverButton` is exported so a fixture test drives
  the open reading without a fill agent.
