# ADR-0047 — Page progress lives in the intent ledger; a lease names the page it holds

**Status:** Accepted · **Date:** 2026-08-31 · **Supersedes:** nothing ·
**Related:** ADR-0003, ADR-0008, ADR-0014, ADR-0031, ADR-0041, ADR-0045, ADR-0046

## Context

ADR-0046 made a fill plan transportable and the runner filled a form. It left a
limitation, stated in `formPageFor` and in the P8 audit rather than hidden:

> One page per unit of work, and no way yet to advance to the next: a portal
> with two application pages gets its first one filled and then has nothing more
> offered, because nothing records which pages are done.

Real applications are paginated. A portal with three pages currently gets its
first filled, reports success, and stops — and the run reports itself `filling`
forever while no work is ever offered again. Worse, before `markFilled` was
keyed to anything, the same page could be offered twice: a student's answers
re-typed into a page they are already on, and "Save and continue" pressed a
second time on a real university's system.

So: **where does "page 2 of 4 is done" live durably?**

## The options, and why the others were rejected

**A `pages_completed` table, or a column on `workflow_runs`.** The obvious
answer, and it creates a second source of truth about what has happened to a
run. This repository has had two models of one thing come apart before, which is
why ADR-0041 exists. It would also need its own uncertainty handling: a page
whose save may or may not have landed is not "done" and is not "not done", and a
boolean column has nowhere to put that.

**A page cursor on the checkpoint.** Cheaper still, and wrong for a reason rule
3 already states: dropping every checkpoint must lose no business fact. "This
page was saved on a real portal" is a business fact — the most consequential
kind this system produces — and a checkpoint is a cache of position that
`discardCheckpoints` throws away on purpose.

**A second workflow engine.** Not seriously considered, and named here because
it is the shape this could drift into.

## Decision

**`advance_portal_page` gets one intent per page, and the intent ledger is the
record of which pages are done.**

Nothing new is stored. `idempotencyKeyFor` already takes a `target`, documented
as *"what it acts on. A host, a field ref, a document id"* — a page ref is
exactly that, and the key was being built with the run id in the target slot
because there was only ever one page.

### 1 · What each verdict means, per page

`assessIntent` already distinguishes the three states this needs, and its
deliberate absence of a "retry it" branch is what makes uncertainty safe:

| verdict | meaning for a page | what the run does |
| --- | --- | --- |
| `not_started` | never attempted | offer it as work |
| `already_done` + `succeeded` | saved on the portal | skip it; go to the next |
| `already_done` + `failed_cleanly` | nothing happened out there | offer it again |
| `verify_first` / `escalate` | the save may or may not have landed | **stop the run** |

The last row is the one that matters. A page whose intent was started and never
completed may be saved on a real portal, and offering it again would re-type a
student's answers and press save a second time. The run stops — visibly, with
its position unchanged and no work offered — which is what "a specialist looks
at the portal" means while nothing here can verify.

An unfinished page stops the **whole run**, not just that page. Pages are
ordered and later ones are often unreachable until earlier ones are saved, so
skipping past an uncertain page would be acting on a portal state nobody knows.

### 2 · A lease names the page it holds

`work_leases` gains `page_ref`. The lease says *this runner is doing page P*;
the ledger says *page P was done*. They answer different questions and neither
duplicates the other — the lease is transient operational state that expires,
and the intent is a durable record that never changes once written.

It exists because the report has to key the right intent, and the report arrives
with a lease id and nothing else. Deriving the page again at report time would
mean re-deriving the plan, and a plan that had changed in between would complete
an intent for a page the runner never touched.

### 3 · Which page is next

The first page, in blueprint order, that has fields to fill, has no credential
field, and has no successful `advance_portal_page` intent.

Blueprint order rather than plan order, for the reason `formPageFor` already
gives: which page comes first is a reviewed fact about the portal, and the
plan's instruction order is an artefact of how `planFill` walks fields.

A page with a credential field is a registration page — the Secure Plane filled
the password and account creation submitted it — so it is complete before
`execute` is ever reached and is not the fill's to do.

### 4 · The run is filled when every page is

`markFilled` applies when no fillable page remains, which is the same question
"which page is next" answers with `null`. One derivation, used twice, rather
than a counter that could disagree with the ledger.

### 5 · Submission stays where it is

Nothing here reaches the submit control. Advancing a page is
`advance_portal_page` — consequential, and modelled as such because it may
create a draft visible to admissions — and the runner's click guard admits
exactly the one locator the plane sends it. The review page has no fields to
fill and no advance control in the blueprint, so it is never a candidate;
submission remains out of scope by ADR-0014 and unreachable by construction.

## Consequences

**Good.** A multi-page application is filled page by page, resumes from the
right page after a restart, and cannot re-save a page it already saved. No new
table, no cursor, no second engine — the mechanism that already records "this
consequential action may have happened" is the mechanism that records it.

**The cost.** Deciding which page is next reads one intent per page. A
twenty-page application is twenty lookups per claim, on a table keyed by
`(run_id, idempotency_key)`. That is cheap, and if it ever stops being cheap the
fix is a batch read on the store — not a cursor.

**The limitation this does NOT remove.** A page the runner cannot reach — a
portal that will not navigate to page 3 until something happens elsewhere — is
still a stuck run, reported as such. Making that self-healing needs a
verification capability this system does not have, which is the same gap the
`verify_first` verdict names.
