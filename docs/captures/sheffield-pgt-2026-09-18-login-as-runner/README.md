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
