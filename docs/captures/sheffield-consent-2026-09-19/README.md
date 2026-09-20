# The Sheffield consent notice, read by Vahid — 2026-09-19 and 2026-09-20

Four reads and two presses, all on Vahid's own account, from the page's own DOM rather than
through the attached reader (`inspect:attached` lives on the iMac and he was not at it). Structure
and the notice's own words only; no values, nothing of anyone else's. They are what ADR-0131's
third shape is built on, and what the Sheffield entry's `authentication.consent` will be authored
from.

## The profile, and why it is named here

**`aas-consent-read`**, created for this work on a MacBook and used for every read below. It is a
throwaway. **On 2026-09-19 it pressed *Accept all cookies* and now holds every category accepted,
with a 90-day expiry**, so every later page load from it pulls the trackers.

It is recorded because P168 got exactly this wrong the other way round: an agent read the
capture of 2026-09-18 as evidence that six trackers load with no consent, when that profile had
**accepted everything** — which was also why it met no notice at all. A profile's consent state is
part of what a capture means. Vahid: *"I am not using it for any further capture."* **Nothing
further should be captured from `aas-consent-read`**, and anything that is must say so.

## What was read

**The banner** (fresh, cookie cleared, nothing clicked). Overlay `div#ccc-overlay`, fixed, block.
Three buttons inside `#ccc`:

| control | id | classes | words |
| --- | --- | --- | --- |
| close | `ccc-notify-dismiss` | `.ccc-notify-box-dismiss.ccc-link.ccc-tabbable` | **none** |
| accept | `ccc-notify-accept` | `.ccc-notify-button.ccc-link.ccc-tabbable.ccc-accept-button` | "Accept all cookies" |
| settings | **none** | `.ccc-notify-button.ccc-link.ccc-tabbable.ccc-notify-link` | "Settings" |

The settings button has **no id**. P170's draft invented `#ccc-settings`; corrected in P171 to the
class the read shows, scoped to the notice (`#ccc button.ccc-notify-link`).

**The toggles** (panel open, nothing pressed): three identical `input.checkbox-toggle-input`, no
`id`, no `name`, no label text of their own, all `checked=false`.

**The page's configuration:** not readable. No inline script on the page mentions `CookieControl`
or `optionalCookies`, so `initialState` per category was never read; the vendor's library is
refused by the agent's environment (403 on the proxy's tunnel).

**What loads with the record empty:** Google Tag Manager only — `gtm.js` and one
`gtag/destination`. Not Hotjar, Yandex, TikTok, LinkedIn, Meta or DoubleClick. **Consent gates
them**, and the tag manager runs **before any choice is made**, which is why the student's question
says so in the sentence rather than in a note.

## What the two presses recorded

The cookie is `CookieControl`, on `.sheffield.ac.uk`, URL-encoded JSON.

| press | `optionalCookies` | `interactedWith` | overlay | banner on reload |
| --- | --- | --- | --- | --- |
| *Settings* alone (2026-09-19) | `{}` | `true` | still up | — |
| *Close Cookie Control* (2026-09-19) | `{}` | `true` | gone | **does not return** |
| *Accept all cookies* (2026-09-20) | `{"functional":"accepted","analytics":"accepted","marketing":"accepted"}` | `true` | gone | — |

Both carry a `consentDate` and `consentExpiry` of 90.

So on this portal, **a refusal is an absence** and an acceptance is the string `"accepted"` — not
a falsy value against a truthy one, which is why ADR-0131's clauses ask about presence and, where
it matters, an exact value, and never about truthiness.

## The caveat that travels with all of it

Every line above is **one reading, on one account, on one day**. What the close control records,
and that an acceptance is written as `"accepted"`, are measurements of this portal's behaviour on
19 and 20 September 2026 — not properties of Civic CookieControl in general, and not guaranteed
tomorrow. The page's configuration could not be read, so nothing here is confirmed from the
source. That is the whole reason ADR-0131's third shape reads the record back at every run rather
than trusting the button: if Sheffield changes what these controls do, nothing in this capture
would notice, and the read-back would.
