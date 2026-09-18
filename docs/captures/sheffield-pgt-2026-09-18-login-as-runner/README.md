# The login page, read as the runner sees it — 2026-09-18

Read by Vahid with `inspect:attached sheffield --as-runner --covering name=loginBtn`
(ADR-0128) after attempt 2 printed *the sign-in button could not be pressed … the password box
is still on the page*. A fresh profile, signed out, tags allowed, `AskiMate-Runner/1.0` presented,
1280×720. `run.json` and the draft are here; the HTML and the screenshot were kept out of the
repository.

## What it found

- **`name=loginBtn: at its own point — nothing over it.`** At the instant of the read, nothing
  stood between the runner and the button. The overlay-on-open hypothesis is wrong — the fourth
  wrong hypothesis on this one step, after the race, the server and time, and like the other three
  it was tested rather than fixed.
- 3 forms, 6 fields, 3 signals; the page as the entry-page read of 2026-09-11 recorded it.
- **Off-host reads: 48**, allowed and recorded (`offHostReads`). Among them: Civic **CookieControl**
  (`cookieControl-9.x.min.js`), **Hotjar**, and Yandex Metrika with **webvisor** — a session
  recorder. These are observations of what loads, not conclusions about what any of them does.

## The reader is not the runner, in the twenty-POST way

Twenty things happen in the runner's page that this read refused. The method rule refused 20 POSTs —
beacons to Google, LinkedIn, TikTok, Snap, Spotify, Yandex and two ingest endpoints — and the
runner's context refuses nothing, so in the runner every one of them succeeds. And among what the
read did let through are CookieControl, Hotjar and a session recorder. **The next person who
compares a read to a run must know the read is the quieter of the two.**

## The reader's own defect — `Navigations refused 2`

`run.json` says the page tried to navigate to `tr.snapchat.com/cm/i` and `facebook.com/tr/`, and
that read as a lead: a page sending the tab elsewhere while a click is pending would match the
symptom exactly. It was not that. Both are tracking pixels in **iframes** — the second is a POST,
which no main-frame tag navigation ever is — and Playwright's `isNavigationRequest()` is true for a
subframe's first load. The guard never checked the frame. The rule was right and the check was one
frame short; it cost a round of attention, which is the kind of cost that adds up. Fixed in P162
(ADR-0129): only a main frame's navigation is the tab going somewhere; a subframe's load falls to
the host rule and is recorded as an off-host read. The two entries in this `run.json` stay as they
were written, with this paragraph beside them.

## The leading candidate, with its caveat

The covering read records the button's box: **`y=690`, 22 tall, in a 720-pixel viewport — eight
pixels from the bottom edge** — on a page that loads a cookie-consent library. That is not a
conclusion; at the instant of the read nothing was over the button, and the read cannot see the
moment the runner clicks. But it is the first fact in four days with a shape a bottom bar would
fit: a fixed element of any height at the bottom covers the button, one of 30 px covers it
completely. P162 makes the runner read the point at the moment the press fails, so attempt 3 says
in one line whether that shape is the thing. It is recorded here as the leading candidate so that,
if attempt 3 names a bottom-anchored element, nobody later reads it as a lucky guess — and so that,
if it names something else, this paragraph is seen to have been a candidate and not a finding.

## What "attempt 1" and "attempt 2" meant in this week's logs (17 and 18 September 2026)

Every runner line above and in the Run A record that reads `sign-in attempt N` was printed
before P163, when the number was the plane's count of **failed** sign-ins plus one. Read them
as follows, because the words did not say what the number was:

- `attempt 1` — a sign-in starting with no failure yet on the run: the first sign-in.
- `attempt 2` — a sign-in starting after exactly one failure. On the run of 17–18 September
  (P157 to P160) that was the second sign-in. On the third conversation of 18 September it was
  also the second sign-in, and it **held**.
- A sign-in that holds ends the count (ADR-0120: *"a later loss is a new episode of two, not the
  third attempt of an old one"*). So the next sign-in on the third conversation — the third a
  person typed a password for — would have printed `attempt 1`.

From P163 the line says what the number is: `sign-in, failures in this episode: N of 2 allowed,
starting, opening <URL>`, and the student's messages carry no ordinal at all.

## Correction — the y=690 candidate is withdrawn (attempt 1 of the third conversation, 2026-09-18)

The paragraph above records the button at `y=690`, eight pixels from the bottom of a 720-pixel
viewport, as the leading candidate with its caveat. Attempt 1 of the third conversation, read by
the runner at the instant the press failed, ends its line with the control itself:

```
at the button's point: div#ccc-overlay (fixed, 1280×720 at 0,0) > input (static, 130×21 at 238,566)
```

At the press the button was at **y=566**, 133 pixels above the bottom edge, fully inside the
viewport. The bottom-bar candidate rested on the button being at the edge, and it was not. It is
withdrawn, and the caveat did its job: this paragraph was a candidate, not a finding.

What the line does establish rests on nothing about the button's position: Playwright's pending
check was *another element intercepts pointer events*, and the top layer at the point was
`div#ccc-overlay`, fixed, the full viewport — Civic CookieControl's backdrop. A full-viewport
backdrop covers a button at 566 and at 690 alike.

The 124-pixel difference between the two readings is unexplained. The honest reading is the same
page in two layouts — a consent bar at the top, a sign-in error line, a scroll offset would each
move the button by that much — and it says that this reader's page on 2026-09-18 was not the
runner's page at attempt 1, which is consistent with the reader finding nothing over the button
and the runner finding the overlay. Option 0 (P164, decided by Vahid 2026-09-18) reads the point
as the page opens and at a successful press too, so the next difference comes with its cause.

Attempt 2 of the same conversation signed in. Nothing was read at that press, because the runner
read the point only when a press failed; so whether the overlay arrived late or never appeared is
not known, and nothing may be built on that absence until it is measured.

