# ADR-0137 — A refusal in the runner's own words may be said; a portal's words about the student's answer still may not

**Status:** Accepted · 2026-09-22 · **narrows [ADR-0122](./0122-a-failed-page-fill-is-tried-twice-then-stops-for-a-person.md)'s silence and replaces the P178 boundary**, which drew the line at drift · asked for by Vahid after attempt 9
**Built in P186**, the same day.

## Context — nine attempts, and the ninth said nothing

Attempt 9 filled eighteen of nineteen boxes on `education.do`. The nineteenth:

> `page fill failed — 1 of 19 boxes did not take its value (refused): certificateStatus`

And nothing else. P178 had decided that only a *drifted* box's error may be printed:

> ONLY for drift, and that is the whole boundary. Those two errors are the runner's own and their
> words are chosen … A `refused` came from the portal, about the student's answer, and keeps its
> silence.

That reasoning is right about a portal's validation message and wrong as a rule about every
refusal. The reason this box failed had to be reconstructed from a capture, a summary page and a
count of rows on a screenshot taken eleven days earlier. Vahid:

> **"Make the refused line say which check refused, in allowed words, the way drift now says what
> the list offered. Nine attempts have taught me that a silent failure line costs a password each
> time."**

## Decision

**1 · The question is not *was this drift*. It is *whose words are these*.**

`ExecutionOutcome` carries `ours` beside `drift`, set from a closed list of errors this repository
raises itself: `LocatorNotFoundError`, `OptionNotAvailableError`, `ControlNotActionableError`,
`ClickRefusedError`, `RobotsDisallowedError`. The failure line prints an outcome whose words are
ours. Everything else — above all a message the portal produced about the student's answer — keeps
its silence exactly as before.

`drift` is unchanged and still decides the failure code: a control the page does not show is **not**
drift, because the blueprint is right about the page. What changes is only whether the reason may
be stated.

**2 · A control that cannot be set is diagnosed by the runner's own checks, in a closed set.**
`ControlNotActionableError` carries one of `not_present`, `not_visible`, `not_enabled`,
`not_editable`, `did_not_settle`, read from the element's own state in the order a person would
look. The words are fixed in this repository; nothing is quoted from the page:

> The portal's "certificateStatus" control is on the page and could not be set: it is NOT VISIBLE —
> the page has it, and does not show it. This is the runner's own check, not the portal's words.

**3 · An act on a control is bounded at five seconds, not thirty.** Playwright's default is right
for a page still loading and wrong for a control the page has decided not to show, where the answer
will not change and the run pays half a minute per box to learn nothing. Five seconds is the bound
`OPTION_WAIT_MS` already uses for a list that must arrive from a server.

## What this does not change

- A portal's own validation text is still never printed. The closed list is the whole licence.
- No value, label or option text of the student's reaches the line. `not_visible` is a fact about a
  DOM element's computed state, not about what the student wrote.
- The two failure codes are untouched: `portal_drift` and `portal_refused` still mean what they
  meant, and ADR-0122 still stops for a person after two page-fill failures.

## Consequences

- The next attempt at a box like this one reports its reason in the same breath as its failure,
  which is what eight of the nine attempts cost a password to learn.
- Proved against a real browser on a radio group inside a `display:none` container — the shape
  attempt 9 met — and against a disabled box, so that *cannot see* and *cannot use* are told apart
  rather than collapsed into one word.
