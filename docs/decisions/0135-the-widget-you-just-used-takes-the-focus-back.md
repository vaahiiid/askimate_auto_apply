# ADR-0135 — The widget you just used takes the focus back, so the runner waits for the page to stop moving and verifies what the box took

**Status:** Accepted · 2026-09-22 · **found by measurement in P184**, on the portal's own code at its own version · closes blocker 49 (open since 2026-09-21, reopened in P181) and blocker 55 · corrects [ADR-0133](./0133-a-typeahead-is-typed-into-key-by-key.md), whose account of the cause was wrong
**Built in P184**, the same day.

## Context — seven attempts, four wrong explanations

Sheffield's institution box refused to fill across attempts 4 to 7. Every explanation offered
before this one was checked and failed:

| Said | Checked | Verdict |
|---|---|---|
| Tom Select 1.x binds `keyup`, so a one-act fill fires nothing (ADR-0133) | Vahid fetched the page's scripts: **2.3.1**, which binds `input` | **Wrong for this portal** (P183) |
| The fill session's guard refuses the page's own POST | `decidePreparationRequest` has no method rule — and the guard was not installed on the attached context at all | **Refuted, and a real defect fixed** (P181, P182) |
| The widget has no `load` function on a fresh page | Vahid read the live instance: `load` is set, with `shouldLoad`, `loadThrottle: 300`, `valueField: "code"`, `labelField: "displayName"`, `searchField: []`, `openOnFocus: true` | **Ruled out** (blocker 54, answered) |
| The query is wrong — the runner types the whole name, he typed `sheff` | He typed the runner's own text by hand, key by key. The list came | **Ruled out** |

So the widget was configured, the query worked, the country was set, and the only thing left that
differed was the runner's own act. Vahid: *"Build your option 1 now, and build it exactly."*

## What the fixture found

`apps/browser-runner/src/sheffield-typeahead.test.ts` serves the **committed capture** — the same
`tom-select.complete.min.js` and the same `education.js`, byte for byte — constructs the widget
with the settings read off the live instance, and drives the runner at it through `attach()`, the
door production uses. It reproduced the live failure exactly on the first run: no search request by
any method, the grading `POST …?institutionCode=` with an empty code, no script error, country set,
and the same failure line word for word.

Then it was measured rather than reasoned about. Reading the widget's own state through the
runner's sequence:

```
after fill(''):   {active: "institution-ts-control",        inst: "", country: ""}
after 4 chars:    {active: "institutionCountry-ts-control", inst: "", country: "iv"}
after the rest:   {active: "institutionCountry-ts-control", inst: "", country: "y of Sheffield"}
```

**The keystrokes went into the box the run had already finished with.** Patching
`HTMLElement.prototype.focus` on the page named the caller without guessing:
`de.open` → `de.focus` → `control_input.focus()` on the COUNTRY widget, about ninety milliseconds
after Playwright's click on its entry had already resolved.

The vendor source says why it does not stop: `open()` ends in `e.focus()`; `focus()` sets
`control_input.focus()` and queues `setTimeout(() => { ignoreFocus = false; onFocus() }, 0)`; and
`onFocus` with `openOnFocus: true` calls `open()` again. The chain outlives the click that started
it.

**This is our fault, not the portal's.** A person cannot type into the next field within
milliseconds of choosing in the previous one, which is exactly why it worked by hand every time and
why four explanations that blamed the portal all survived as long as they did.

## Decision

**1 · After choosing a typeahead entry, the runner waits for the page to stop moving.**
`settleFocus` samples `document.activeElement` and requires it unchanged across four consecutive
reads — two hundred milliseconds of quiet, longer than the ninety measured — then clears it, so no
widget is holding focus when the next instruction begins. It is drained at the END of the act that
caused it, not at the start of the next one, because that is where the debt belongs.

Requiring the focus to *stay* settled is the load-bearing part. An earlier version broke on the
first matching pair of reads and still failed four runs in five: a single matching pair falls
inside the chain.

**2 · The runner reads back what the box took, and retypes if it did not take it.** Bounded at
three attempts. A box that will not take text after three tries is a finding, not something to
keep hammering.

**3 · A box that still did not take the text SAYS so.** The failure line now carries *"The box did
NOT take what was typed — it is empty, and the page's focus was on `#institutionCountry-ts-control`.
Nothing was asked because nothing was typed into this box."* The element is named as page
structure — an id, never content.

This is the rule the repository already lives by, applied to typing: an edit you did not verify is
not an edit you made. Seven attempts were spent on a box whose failure line could not distinguish
*the portal offered nothing* from *we never asked it anything*, because nothing read back what was
typed.

**4 · The lookup log records a request when it is ASKED, not when it is answered.** Positions in
the log are now ask times, so an earlier act's answer no longer lands inside a later box's window
and gets reported as that box's doing (blocker 55). It also makes a state nobody could report
visible: a request that went out and has not come back reads `no answer yet`, where before it read
exactly like a request that was never made.

## Consequences

- Blocker 49 is **closed**, by a cause that was measured rather than argued.
- The fixture stays. It is the only place the runner is exercised against the widget the portal
  actually runs, at the version it actually runs, and it failed first — five runs in five before
  decision 1, five in five after.
- ADR-0133's typing change stands and is not reverted, for the reasons its amendment gives; its
  account of the cause was already withdrawn in P183 and is now replaced by this one.
- **What this does not claim:** that Sheffield will now fill. The fixture is the portal's code, not
  the portal. It says the fault was ours and that this instance of it is gone. Attempt 8 is what
  says the rest.
- The fixture found one thing about itself worth keeping: a classic script served without a charset
  is decoded in the document's fallback encoding, and Tom Select's diacritics table becomes mojibake
  that throws before `TomSelect` is defined. The committed capture is clean UTF-8; the first run
  broke on its own serving.
