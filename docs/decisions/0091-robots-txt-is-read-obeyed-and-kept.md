# ADR-0091 — robots.txt is read, obeyed and kept; and requests are paced

**Status:** **Accepted** — required by Vahid Mohammadi, 2026-09-08, as **preconditions on any run
against a live site**
**Depends on:** [ADR-0014](./0014-discovery-cannot-submit.md) — discovery is read-only, enforced at
the type level and at the network level

## Context

`docs/target-sheffield-pgt.md` measured what a discovery run does to a portal and found two gaps
that were not safety gaps in the sense ADR-0014 covers, and were gaps all the same: **there was no
`robots.txt` check anywhere in the runner**, and **no delay between requests**.

Vahid set both as preconditions before any run:

> 1. Read and obey robots.txt. Not because a crawl of public pages is necessarily forbidden, but
>    because **the difference between "we respected the rules" and "we did not look" is the whole
>    difference if anyone ever asks.**
>
> 2. A delay between requests. Even one second. Sequential crawling at browser speed from a single IP
>    is what gets an address blocked, and being blocked by our first target before we have an account
>    would be an expensive way to learn this.

## Decision 1 · robots.txt is read before the browser opens, and kept

**Read over plain HTTP, for every host the run may touch, before anything navigates.** A page load
runs the site's JavaScript; reading a text file should not execute anything, least of all before we
know what the file permits. It is also the one request exempt from its own rules, so routing it
through the guard would be circular.

**Three outcomes, and the middle one is the one that matters.**

| | meaning | effect |
|---|---|---|
| `fetched` | the file was read | its rules apply |
| `absent` (4xx) | the site says there is no policy | everything allowed |
| `unavailable` (5xx, timeout, network failure) | **we could not ask** | **nothing allowed** |

The third follows RFC 9309 §2.3.1.4, and it is also the only reading that satisfies the instruction:
a run that could not read the rules has not respected them, and carrying on anyway is exactly the
*"we did not look"* this exists to prevent. `absent` and `unavailable` are kept apart, because they
are different facts and a report should be able to say which.

**Obeying is half of it.** Every run writes `robots.json`: the file verbatim, the host, the status
code, the time it was read, and the group that was applied. A crawler that quietly complies leaves no
evidence that it complied, and the evidence is the point.

**Applied to every request, not only to navigations.** A page's CSS, scripts and images are fetches
this crawler makes. Exempting them is the convenient reading, and the convenient reading is the one
that is hard to defend when somebody asks. It has a cost — a page whose stylesheet sits under a
disallowed path renders unstyled, so the observation may not be what an applicant sees — and the cost
is **recorded rather than hidden**: the run's summary says so in those words.

**Two places, deliberately.** The network guard is the enforcement. The crawl loop also asks before
navigating, so a disallowed page does not consume a paced cycle or print a line saying the run went
somewhere it did not. That redundancy nearly hid a defect — see below.

## Decision 2 · a floor on the delay that nothing can lower

`MINIMUM_CRAWL_DELAY_MS = 1000`. A target file may ask for **slower**; a `Crawl-delay` in the site's
own robots.txt may raise it further; nothing may lower it. One `Math.max` in one function, rather
than a default somebody can override.

A `crawlDelayMs` below the floor in a target file is **refused, not clamped** — a person wrote that
number meaning something, and silently ignoring it would leave them believing the run is doing what
they asked.

## What building this found

Four defects, none of them in the new code, all surfaced by adding a second rule to a guard that had
only ever had one.

**1 · `portalAttemptedWrite` was `blocked.length > 0`.** So a run that skipped a single
robots-disallowed stylesheet would have reported *"the portal attempts writes during normal
browsing"* — a serious finding, invented. Harmless while the method rule was the only one that fired
often; wrong the moment a second rule existed.

**2 · The CLI never called `summarise()`.** `BlockedRequestLog` had a careful breakdown and the CLI
printed a hard-coded warning instead, so the log's own words reached nobody. The three refusals are
now printed as three findings.

**3 · `https://${host}` for the robots fetch.** Right for a real site, wrong for the fixture portal —
plain HTTP on a loopback port. The fetch failed, the policy became `unavailable`, and the run
correctly fetched nothing. **Correct behaviour from a wrong input, which is the worst kind of bug to
leave in a safety check: it fails closed and looks exactly like the rule working.** The origin now
comes from the run's own seed URLs. A second form of the same bug — `allowedHosts` written without a
port, seed URLs carrying one — was found in the same place.

**4 · The crawl-loop check masked the network guard.** A deliberate regression removed the guard
entirely and **every test still passed**, because the loop filter stopped the disallowed page first.
That is ADR-0082's *"two checks, one reachable"* in a new place. The fixture now serves a page
referencing a disallowed **sub-resource**, which the loop never sees, so only the guard can refuse
it — and the regression fails.

## What was measured, not asserted

**The sub-resource count is now counted.** `maxPages` bounds navigations; nothing bounded or counted
the CSS, scripts, images and fonts each page pulls. `docs/target-sheffield-pgt.md` said a 45-page run
was *"plausibly 1,500–4,000 GETs"* and said plainly that this repository had never measured it.
`RequestTally` measures it — navigations, sub-resources, per-page average, and a breakdown by
resource type — and it is printed and written to `run.json`.

**Four deliberate regressions**, each verified from disk and restored from a file copy: an
unavailable robots.txt allowing everything → 2 fail; removing the delay floor → 2 fail; removing the
network guard → **0 fail, until the sub-resource test was added**, then 1; and the fixture's
disallowed page being visited is caught by the run's own output.

## What this does NOT do

**No run has been made.** These are the preconditions; the run is a separate act with its own
approval. Nothing here widens what discovery may do — it narrows it.

`Sitemap` is not implemented: this crawl follows seeds and links, and a sitemap would widen it beyond
what the target file authorises. Policies are not cached across runs: a run is short and a fresh read
is the honest one.
