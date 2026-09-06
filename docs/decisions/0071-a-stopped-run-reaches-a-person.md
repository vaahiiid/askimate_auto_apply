# ADR-0071 — A stopped run reaches a person, and the notice carries nothing about the student

**Status:** **Accepted** — 2026-09-06
**Depends on:** [ADR-0008](./0008-recovery-first-escalation-and-the-learning-loop.md),
[ADR-0048](./0048-a-specialist-resolution-completes-an-intent.md),
[ADR-0052](./0052-the-system-acts-when-nobody-is-watching.md),
[ADR-0055](./0055-a-process-refuses-to-start-when-it-is-not-safe.md)

## The decision

The Background Worker sends a **`SpecialistNotice`** to a destination the operator configures, once
per open intervention, and records that it did. The notice carries identifiers, closed-union
categories and facts from reviewed artefacts. It carries no free text, no checkpoint and no student.

## The gap this closes

Every part of the recovery design was built and tested across P10, P11, P17 and P29: a run stops at
the failure point; `interventions` records what was encountered and what was expected; a specialist
adjudicates through an internal route; the run resumes from the intent ledger.

**And nothing told anyone.** A stopped run wrote a durable, discoverable row and then waited for
somebody to think of running `pnpm run interventions`. The student was told their application was
paused — `announcePending` has done that since P14 — so the one person who could not act on it was
informed, and the one who could was not.

The schema had been anticipating this since P10: migration 0003's index carries the comment *"the
query the operator CLI runs, and the one an alerting transport will run when it exists."*

## What leaves the system, and what does not

A notice goes to a URL this repository does not control. The question is therefore not *what would
be useful in the message* but *what may be handed to a third party in order to say that something
needs a person.*

| Sent | Not sent | Why not |
|---|---|---|
| `interventionId`, `runId`, `caseId` | `studentRef` | Pseudonymous is still personal, and it buys the specialist nothing — the CLI and the internal route both take the case |
| `reason` (closed union), `priority` | `encountered`, `expected` | The specialist's most useful fields, and the ones composed as free text at the point of failure. A portal quoting back an invalid value is the ordinary shape of an `unfamiliar_validation_error` — free text is where a value ends up |
| `institutionId`, `courseId`, `portal`, `page` — from the **reviewed** catalogue entry and blueprint | `checkpoint` | Structured rather than free text, but it names the pages of a real application in progress, and a webhook subscriber has authenticated to nothing |
| `raisedAt` | | |

So the notice says: *something of this kind stopped, on this application, at this institution, at
this time — go and look.* Following it requires the service credential, which is where the detail
correctly lives.

### Why this is a type rather than a convention

`noticeFor` is the only constructor and it **reads named fields** rather than spreading the
intervention and deleting a few. A delete-list is a list somebody has to update, and the field they
forget is the one that leaks. A future field on `StoredIntervention` — a specialist's note, a
portal's error body — has nowhere to land.

A `check-boundaries` rule is the second control: `packages/notify` may not depend on the profile, a
plan, a preview, a secret, a model or a database driver. `@askimate/aas-case-store` is permitted and
is the only store there, because `StoredIntervention` is the input and reading it is the whole job.

## The transport: a webhook, and why not something better

An HTTP POST to a URL, `fetch`, no SDK.

It is the one shape that needs **nothing provisioned and nothing paid for**. A chat platform's
incoming webhook, a paging service's events endpoint and an operator's own relay all speak it, so
which of those is used stays an operational choice rather than becoming a dependency in this
repository and a line on somebody's bill. It also keeps the SDK surface at zero in a process that
runs unattended against the conversation database.

**One destination is refused: plain HTTP to anything but loopback.** The notice carries no student
data by construction, but it does carry the shape of a real application in progress — which
institution, which course, how often runs stop — and putting that on the wire in clear is not a
choice anyone makes deliberately. Loopback is admitted because a local relay is a legitimate
deployment. The refusal is at **construction**, so a misconfigured destination stops the worker
starting (ADR-0055) rather than failing at three in the morning on the first stopped run.

## Ordering, and what happens when delivery fails

**Send first, mark second** — the order `announcePending` already uses, for the same reason: a crash
between them pages somebody twice, which is a much smaller failure than a stopped run nobody hears
about. `markNotified` is idempotent, so the duplicate does not move the recorded time.

**A failure leaves the row unmarked and the batch carries on.** Abandoning the pass would let one
intervention whose delivery always fails permanently suppress every notice behind it — the original
defect with an extra step. There is no attempt counter, no backoff column and no dead-letter: a
notice that keeps failing keeps being retried, and the operator finds out because the run is still
open in the queue they can already read.

**The notifier may throw, and must.** One that swallowed a failure would let the driver record a page
that never happened.

## Two audiences, two columns

`announced_at` records that the **student** was told their application is paused. `notified_at`
records that a **specialist** was told. Different audiences, different content, different channels,
and either can succeed while the other fails. One column for both would let a delivery failure on one
silently suppress the other, which is this ADR's own failure wearing a disguise.

## Where it runs, and why not in the Conversation Service

The Background Worker. Noticing that something needs a person, and telling them, is autonomous
progression, and ADR-0052 puts autonomous progression in the worker. It is the third job under the
existing lease vocabulary — `notify_specialists`, added to `worker_leases`' CHECK constraint in a
reviewed migration, because that constraint is what makes a typo in a job name a failed insert rather
than an orphaned lease nobody notices.

Fifteen seconds, the slowest of the three intervals, deliberately: it is the only job that talks to
something outside this system, and that something has its own rate limits. Fifteen seconds is far
inside any human definition of "promptly" for a case that needs a specialist.

## Not configuring it is a valid deployment

With no `AAS_SPECIALIST_WEBHOOK_URL`, the job is **not started** — rather than started and doing
nothing — so `worker_leases` does not carry a lease for a job that can never do work, and an operator
reading that table during an incident sees what this worker actually runs.

That is the behaviour of every deployment for the twenty-six phases before this one, so it must stay
valid. What changes is that it is now a **choice**, and the worker says so at startup: *"specialist
notices: OFF — no AAS_SPECIALIST_WEBHOOK_URL. Stopped runs reach the queue and nobody is paged."*
Something invisible until it matters is worth one line of output.

## What this does not do

- **It does not authenticate the specialist.** ADR-0048 §3's asserted-not-authenticated model is
  unchanged, and so is the condition Vahid named for ending it: a second specialist existing at all.
- **It does not sign the outbound request.** The notice contains nothing worth forging *into* — it
  carries no instruction and no secret — and a shared signing secret would be a credential in the
  worker's environment in exchange for that. When a destination needs authentication, it belongs in
  the URL the operator supplies, which is how every webhook endpoint of this shape works.
- **It does not retry with backoff, or give up.** See above.
- **It does not notify about anything except an open intervention.** A resolved one is not news.
