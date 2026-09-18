# ADR-0127 — The submit is two waits with two names, because the one wait did not do what it read as doing

**Status:** Accepted · 2026-09-18 · completes [ADR-0124](./0124-the-runner-says-what-it-did-in-words-it-is-allowed-to-say.md) at the one site it left unnamed · amends the sign-in path of [ADR-0120](./0120-a-failed-sign-in-is-tried-twice-then-stops-for-a-person-and-the-student-is-told-what-cannot-be-told-apart.md) · found by Run A's repeat, read from the log ADR-0124 built
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-18. **Built in P160**, the same day.

## The correction, first, in plain words

Run A's repeat printed, at the first attempt:

```
sign-in attempt 1, starting, opening https://www.sheffield.ac.uk/postgradapplication/
sign-in failed at the submit and the load that follows — TimeoutError: the step timed out
failed (runner_fault)
```

Not *"execution context destroyed"*. The race hypothesis P157 left open is exonerated, and it was
right not to fix it on a guess. But the second hypothesis — that fifteen seconds is too short for
the page load after Sheffield's submit — was **also wrong**, and it was wrong in a way that matters
more than the proposal that replaces it.

The code was:

```ts
await Promise.all([
  page.waitForLoadState("load", { timeout: STEP_TIMEOUT_MS }),
  submit.click({ timeout: STEP_TIMEOUT_MS }),
]);
```

It read as *"press the button, then wait for the next page to load."* It did not do that.
Playwright's own contract for `waitForLoadState`: *"If current document has already reached the
required state, resolves immediately."* It was called before the click, on the login page, which
`page.goto` had already brought to `load`. **The load-state wait was called on a page that had
already loaded, so it resolved at once and guarded nothing. The clock that expired was the click's
own** — `click()` waits for the button to be pressable, then for the portal's answer to commit, and
fifteen seconds covered both under one name.

Vahid: *"That is the third time this week a piece of code did something other than what it read as
doing, and each time the reading was confident. The lesson is the same as before — measure, do not
read — and it should be stated as the reason for the split rather than as a note."*

So it is the reason. Every claim in this ADR about what a wait does was checked against
Playwright's type contract and then driven to its own failure on a fixture in a real browser; none
of it is a reading.

## Decision 1 — two waits, two phrases, so attempt 2 is a reading whichever way it falls

> *"The split is right: two waits, two phrases, so attempt 2 is a reading whichever way it falls."*

`settleSignIn` in `sign-in.ts`, exported and taken to the form already typed, so each wait can be
tested alone:

1. **The press.** `click({ noWaitAfter: true })` under `SIGN_IN_PRESS_TIMEOUT_MS = 15 000`,
   unchanged. It measures one thing: attached, visible, enabled, receiving events. On failure the
   line says *"the sign-in button could not be pressed"* and one more fact — *"the password box is
   still on the page"* or *"no longer"* — a word from a locator, never text from the page.
2. **The answer.** `framenavigated` on the main frame, armed before the press, under
   `SIGN_IN_ANSWER_TIMEOUT_MS = 30 000`. That event is the commit of the portal's response to the
   POST — a redirect chain commits once at its end, a refused password that re-renders the form
   commits too — and it ignores every script on the page that follows. On failure the line says
   *"the portal did not answer the sign-in"*.

The fixture proves both directions: a portal that answers slowly inside the ceiling succeeds
(the wait is for the answer, not the load); one slower than a shortened ceiling fails naming the
answer; a transparent element over the button fails naming the press and reporting the box still
there; and a wrong password is `portal_refused` promptly, never a timeout.

## Decision 2 — thirty seconds is a measurement, not a fix

> *"Thirty seconds is a measurement and not a fix, and you said so."*

The unknown is server time on Sheffield's own sign-in handler, which exceeded fifteen once.
Doubling it once, on the answer wait alone, is a measurement: a second failure at thirty says the
cause is not time, and the log will say which wait it was. Not sixty — a student watching an open
box should not wait a minute to be told nothing.

## Decision 3 — the landing is confirmed by URL, because a locator would be invented

> *"The URL check as the landing confirmation is honest, since the URL is the only recorded shape
> and a locator would be invented."*

What Sheffield does after the submit is **not recorded anywhere**. AUTH 5 — *"what follows the
login button"* — is marked *not observed* in the entry's own notes and was settled by Vahid's
statement, never by a capture; the form's `action` and `method` are not in the entry capture; and
the landing page, `overview.do`, has `sections: []` in the signed entry because the 2026-09-10 read
found nothing on it but the site search box, which is on every page. The one recorded shape of the
landing is its URL.

The rule therefore stays what it was: still on the login form's pathname → `portal_refused`;
anywhere else → accepted, and the challenge probe runs on that page (ADR-0101 §5). Naming
`overview.do` as the expected landing would need the work item to carry a landing URL it does not
carry today, and that is not widened here.

## Decision 4 — no screenshot, as a decision

> *"The screenshot refusal is correct and should be recorded as a decision, not left as a sentence
> in a report. Someone will want it in a month and they should meet the reason first."*

A screenshot of the login page at the moment the press fails would settle the overlay question in
one glance. It is not taken, and this is a decision, not an omission: it is a picture of a login
form with the student's e-mail address typed into it, written to a log file on disk. ADR-0124's
rule is that nothing from a page reaches the log — not a message, not a slice, not a URL — and a
screenshot is all of the page. The log says *the password box is still on the page*, in our word,
and stops there. Whoever wants the picture in a month should meet this paragraph first.

## The overlay side, and what the ADR will not guess

If attempt 2 prints *"could not be pressed"* with *"the password box is still on the page"*, that
says **something is over the button**, and the next question is what. This ADR does not answer it,
and deliberately names no consent banner or cookie dialogue in the fix.

The reason is a fact about the record: **the runner's page is unobserved.** Google Tag Manager was
refused in every capture (AUTH 6's caveat), so anything a tag injects — a banner, an overlay, a
delayed script — has never appeared in any page this repository has read. The runner's browser
allows tags. It sees a page nobody has ever read. The next diagnostic on the overlay side is
therefore a **read of the login page with tags allowed**, through the attached-inspection path
(P79), so the answer is an observation and not a fourth confident reading.

## Consequences

- Attempt 2 will print one of two named failures, or succeed; each is a reading.
- The ceiling on the answer is 30 s; the press stays at 15 s. Both are exported constants a test
  pins, and both are overridable for tests only, so a test can drive one wait to its own failure
  without waiting the other out.
- `settleSignIn` is the one path from the typed form to the outcome; `signInToPortal` calls it and
  nothing else at the submit. The P157 comment that kept the race unchanged is superseded by this
  ADR, with the measurement that superseded it.
- Nothing about the fill, the vault or the handle changes. A press that fails after the password
  was typed still spends the handle, and the plane asks again, as before.
