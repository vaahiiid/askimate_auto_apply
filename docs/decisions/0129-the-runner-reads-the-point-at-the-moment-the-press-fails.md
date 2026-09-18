# ADR-0129 — The runner reads the point at the moment the press fails: structure, no text, and which check was pending

**Status:** Accepted · 2026-09-18 · follows [ADR-0128](./0128-read-the-page-the-runner-sees-before-anything-learns-to-push-past-it.md), whose read found nothing over the button as the page opens · keeps [ADR-0124](./0124-the-runner-says-what-it-did-in-words-it-is-allowed-to-say.md) and [ADR-0127](./0127-the-submit-is-two-waits-with-two-names.md) whole
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-18. **Built in P162**, the same day.

## Context — nothing over the button as it opens, and a press that still fails

The `--as-runner` read (`docs/captures/sheffield-pgt-2026-09-18-login-as-runner/`) said
`name=loginBtn: at its own point — nothing over it`. The overlay-on-open hypothesis is the fourth
wrong hypothesis on this one step — the race, the server, time, a banner — and, like the other
three, it was tested rather than fixed. But the runner's press timed out twice with the password
box on the page. Whatever blocks it is not on the page as it opens; it is there between the page
settling and the click — after the e-mail, after the password, or because of them.

A static read cannot see that moment. The runner can, and until now threw the datum away:
Playwright's click failure names which actionability check was pending, from a closed set of its
own phrases, and for one of them names the element in the way — *`<div id="…">` intercepts pointer
events*. ADR-0124's vocabulary withheld the whole message because a message can carry page text.
The rule was right, and it discarded the one thing that would have named the obstacle.

## Decision 1 — the point read, at the moment of the failure, structure only

> *"Your reasoning is mine: the point read gives structure and no text, which keeps ADR-0124 and
> ADR-0127 whole, and it answers the question directly if there is something at the point."*

`point-read.ts` is one in-page read with two allowances. The attached reader (`--covering`) keeps
each layer's visible text, because a capture is something a person looks at and the text is what
names a banner. The runner keeps **structure only** — tag, id, classes, computed `position`,
`z-index`, box — because its line goes to a log. In the catch of the press, `sign-in.ts` now reads
`elementsFromPoint` at the button's own centre and says:

```
sign-in failed — the sign-in button could not be pressed — the step timed out;
pending: another element intercepts pointer events; the password box is still on the page;
at the button's point: div#ccc-overlay.ccc-overlay (fixed, 1280×60 at 0,660) > input (static, 130×22 at 238,690)
```

`pending:` is Playwright's own check, matched from a closed set of Playwright's phrases and printed
in our word — *intercepts pointer events*, *not visible*, *outside the viewport*, *not enabled*,
*not stable* — or *a check this log does not name*. The element Playwright quotes is never quoted;
the page's structure is read instead. The fixture's covered button proves the line names
`div#cover (fixed, …) > button#signIn` and carries no text.

## Decision 2 — not the picture, not yet

> *"The picture is for the case where there is nothing there and the failure is stability or
> focus, and I would rather earn that case than assume it. Build the picture only if P162 says
> 'nothing at the point', and bring me the design again then rather than now."*

Recorded so it is met as a decision: a masked viewport image is buildable in a way that keeps
ADR-0127's reason — every input masked, a directory the operator names, never the log, never
committed, refused in production — and it is **not built**. If attempt 3 prints *nothing at the
button's point*, the design comes back for his word then.

## Decision 3 — the reader's own defect, fixed and counted

The attached reader refused two tracking pixels' iframes as *"the page tried to send the tab
elsewhere"* and printed `Navigations refused 2`, which read as a lead. `isNavigationRequest()` is
true for a subframe's first load; the guard never checked the frame. The rule was right and the
check was one frame short. Now only a main frame's navigation is the tab going somewhere; a
subframe's load falls to the host rule and is recorded as an off-host read. **It cost a round of
attention, which is the kind of cost that adds up**; the capture's README says so beside the two
entries, which stay as written.

## What is recorded, and how

- The reader is not the runner in the twenty-POST way — twenty things happen in the runner's page
  that the read refused, and among what it let through are CookieControl, Hotjar and a session
  recorder. The read is the quieter of the two. In the capture's README, in those words.
- The button sits at `y=690`, 22 tall, in a 720 viewport — eight pixels from the bottom edge — on a
  page that loads a cookie-consent library. Recorded as the **leading candidate with its caveat**:
  not a conclusion, the first fact in four days with a shape a bottom bar would fit. If attempt 3
  names a bottom-anchored element, it was the candidate on record; if it names something else, the
  candidate is seen to have been one.

## Consequences

- Attempt 3 is a reading of the thing itself: one line names which check was pending and what
  stood at the point, or says nothing did.
- Nothing pushes past anything. The runner learns to read, not to dismiss.
- The picture waits on *nothing at the point*, and on Vahid's word after that.
