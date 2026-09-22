# ADR-0133 — A typeahead is typed into key by key, and a box that finds nothing says what the field behind the earlier control holds

**Status:** Accepted, **Context amended 2026-09-21 (P183) and 2026-09-22 (P184)** — the cause is ADR-0135's; — the 1.x reasoning is withdrawn for Sheffield, which ships Tom Select 2.3.1; the decision stands and the typing is not reverted · 2026-09-21 · continues [ADR-0103](./0103-the-blueprint-says-what-the-form-does-between-fields.md) gap 2 and [ADR-0109](./0109-a-typeahead-mapping-names-the-value-the-form-submits.md) · found by Vahid's hand measurement on the live form, and by the line [ADR-0132](./0132-the-uniqueness-that-protects-a-queue-must-not-outlive-the-resolution.md)'s phase added
**Built in P180**, the same day.

## Context — a person's keystrokes searched, the runner's fill did not

Attempt 5 stopped on Sheffield's institution box with an empty list, and the line P179 added said
why it could not be diagnosed further: *While this box was being filled the page made NO request of
its own to the portal.* Vahid then measured the same box by hand, on his own account, nothing saved:

> `education.do?new=true`, country chosen by hand: United Kingdom; typed by hand, key by key, into
> `#institution-ts-control`: "sheff" → the list opened at once with all eleven entries.

So a person's keystrokes fire the search and the runner's fill did not. He also withdrew an
observation of his own: a console test that appeared to show a one-act fill firing nothing was void,
because his Network panel's type filter hid Fetch/XHR. The evidence is the runner's line, not that
test.

## AMENDED 2026-09-21 (P183) — the version fork below is NOT Sheffield's reason

Vahid fetched the page's own scripts after attempt 7 and committed them
(`docs/captures/sheffield-pgt-2026-09-21-education-scripts/`). The header of
`scripts/tom-select/tom-select.complete.min.js` reads **Tom Select v2.3.1**.

So Sheffield ships **2.x**, and the minified source confirms what the table below says about
2.x: `se(i,"input",(t=>e.onInput(t)))` — the control input's `input` event, bound on the
control, with no `keyup` binding on that path. A Playwright `fill()` dispatches `input`. **On
this page a one-act fill would have reached `onInput` too**, so the 1.x/2.x fork is not why
attempts 4 to 6 asked the portal nothing.

In his words: *"The key-by-key change is harmless but it did not fix this, and the ADR should
say that plainly rather than leave 1.x as the explanation."*

**The decision below stands and the typing is NOT reverted.** Typing key by key is what a
person does, it satisfies both versions, and it costs the portal the same one lookup. What is
withdrawn is the *claim that it was the cause here*. This ADR closed blocker 49; blocker 49 is
**reopened** (P181) and the cause is not established.

What the same capture does establish, from `education.js` and the vendored 2.3.1:

- the institution box's `load` function is `loadInstitutionSearch(query, callback)`, which reads
  `#institutionCountry`.value and calls `GET ./ajax/institution/search.app?name=…&studyAbroad=…&country=…`;
- `load()` runs only when `canLoad()` is true, which is `!!settings.load && !loadedSearches.hasOwnProperty(query)`;
- **the construction that would set `settings.load` is inline in `education.do` and no capture
  holds it.** That was the open question, and it is now answered: Vahid read the live instance off
  the element on 2026-09-22 — `load` IS set. **And the cause was found in P184 and is not here at
  all:** the previous widget takes the focus back about ninety milliseconds after its entry is
  clicked, and the runner's keystrokes for the next box land in it. See
  [ADR-0135](./0135-the-widget-you-just-used-takes-the-focus-back.md), which closes blocker 49.

The three paragraphs that follow are kept as the reading of the vendor source that they are.
They are correct about the two versions and wrong about which one this portal runs.

## What the vendor code says, and what it cannot say

Tom Select's own source, read from the published package:

- **1.x** (`1.7.8`, `src/tom-select.ts:317`) binds `keyup` — `addEvent(control_input,'keyup', …)` —
  and has **no `input` listener**. `onKeyUp` is what calls `shouldLoad` → `load(value)` →
  `refreshOptions()`.
- **2.x** (`2.0.0` onwards; `2.4.3:340`) binds `input` instead — `addEvent(control_input,'input', …)`
  → `onInput` → a `refreshThrottle` timeout → `_onInput` → `load`. `keyup` is gone.

Playwright's `fill` sets `.value` and dispatches **one `input` event**. On a 1.x page that fires
nothing at all: no `load`, no `refreshOptions`. On a 2.x page it would fire the search.

**Which version this portal ships is not established.** No capture in this repository holds
`education.do`'s HTML or its script URLs — the two captured pages carry neither. The measurement is
the stronger evidence about the version, not the other way round: a one-act fill asked nothing,
which is 1.x's behaviour and not 2.x's.

## Why the country box passed and the institution box did not

This is the difference that matters, and it is not luck. Both boxes are Tom Select; both were filled
the same way.

- `onFocus` calls `refreshOptions(…)` in **both** versions, and Playwright's `fill` focuses the
  element before typing. The **country** box is a *local* list — its entries are the `<select>`'s,
  as the mapping set records — so focus alone renders all of them into the dropdown, the runner's
  locator finds *United Kingdom*, and the click chooses it. No search is needed.
- The **institution** box is a *remote* list: nothing is in it until `load(value)` runs, and on 1.x
  only `keyup` runs it. Focus renders an empty list.

**But Vahid's deeper point stands:** nothing verified that the country was chosen. A fill's read-back
is recorded as a shape and never compared (ADR-0106's read-back is of the saved page, not of a
control), and the input a Tom Select fronts is **cleared by the widget** at the choice — so reading
the box says nothing either way. "Country passed" was an inference from the absence of an error.

## Decision

1. **A typeahead is typed into key by key**, not set in one act. A keystroke fires `keydown`,
   `keypress`, `input` and `keyup`, which satisfies both versions and matches what the reviewer
   measured. The box is cleared first, because a retry meets the previous attempt's text.
2. **The delay between keystrokes is 50 ms** — under Tom Select's 300 ms `loadThrottle`, which wraps
   the user's `load` in a **trailing** debounce (`loadDebounce`). So one box costs the portal **one**
   lookup, fired once the typing stops: the same as a person typing at speed, not one per character.
3. **The blueprint's `frontedBy` travels with the plan.** A dependent typeahead's `optionsAfter`
   gains `holds`: the locator of the field the earlier control sets. At a failure the runner reads it
   and says whether it **holds a value** or **holds NOTHING** — never which value, because on this
   chain the country is derived from the student's own education history.

## Consequences

- Typing a long reviewed text costs about a second per box. That is the price of being a visitor the
  page was built for.
- The traffic a fill generates is unchanged in count and slower in rate. The one-second floor
  between navigations (ADR-0091) is untouched; this is about keystrokes within one page.
- A dependent box that finds nothing now answers two questions at once: what the page asked the
  portal (P179) and whether the field it depends on was really set. Those are the two halves of
  every lookup failure.
- Proved red first, through a real browser on a page in Tom Select 1.x's shape — `keyup` only, a
  300 ms trailing debounce, a remote list: with a one-act fill the box cannot be filled at all and
  the page asks nothing; with typing it asks once and the entry is chosen.
- What is NOT done: nothing reads the version Sheffield ships, and nothing infers a widget from a
  class name or an id convention. The fix works whichever version it is.
