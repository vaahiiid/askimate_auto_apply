# ADR-0065 — A run only a person can carry on stops, and says so

**Status:** **Accepted** — 2026-09-05
**Completes:** [ADR-0064](./0064-the-interviews-decision-to-stop-reaches-the-system.md) — that wired the
interview's two dropped actions; this wires the orchestrator's own hand-over, which was dropped
wherever it was raised
**Depends on:** [ADR-0048](./0048-a-specialist-resolution-completes-an-intent.md) (the intervention a
specialist picks up), [ADR-0060](./0060-the-conversation-service-owns-the-student-surface.md)
**Corrects:** ADR-0064 §2's reason for returning a position rather than falling through — see §5
**Blocked by, and deliberately not closed:** [ADR-0022](./0022-a-document-in-the-vault-is-not-permission-to-send-it.md)
and [ADR-0023](./0023-retention-periods-are-determined-not-invented.md) — see §7

## §1 · The measurement

`nextStep` returns `{kind: "specialist", reason, detail}` from **ten** places in
`packages/orchestrator/src/run.ts` — seven reachable, three marked unreachable and `c8`-ignored — in
**five kinds of situation**. The run driver acted on **none** of them. `#decideOnce` fell
through to `checkpointAfter`, which preserves the status it finds, so the run stayed `running`,
`dueRuns` handed it to the worker on every pass, and the student was told nothing.

Measured through the real driver against the shipped fixture catalogue, before the change:

```
step: specialist   status: running   phase: awaiting_specialist
interventions: 0   messages: 0       still due for the worker: true
```

The five kinds of situation, all previously silent:

| Where | `reason` | The question a person has to answer |
|---|---|---|
| `assess` refused and produced no plan | the refusal's own kind | is this artefact reviewed and usable? |
| a structural blocker in the plan | `no_mapping`, `render_refused` | where does this field belong, and why would it not render? |
| validation did not run | `not_validated` | why did the plan not validate? |
| the preview could not be built | `preview_refused` (incl. `document_missing`) | where does the missing document come from? |
| the account step could not be planned | `portal_authentication_unobserved`, `student_availability_unknown`, `authentication_*`, `no_confirmed_email` | how does this portal sign people in? |

None of these is a question to put to the applicant. ADR-0007's rule — a missing **value** goes to the
student, a missing **mapping** goes to a specialist — is exactly what `specialist` encodes, and the
driver was discarding it.

## §2 · How `FIXTURE_BLUEPRINT` reaches it, honestly

The shipped fixture attaches *"Upload your passport"*. Following the real code:

- `planFill` routes a `document`-sourced mapping to `plan.uploads`, never to `plan.blockers`
  (`plan.ts:205`); only a `profile_field` whose value is unavailable becomes a blocker (`plan.ts:229`).
- The orchestrator enters the interview only `if (plan.blockers.length > 0)`, so **the interview never
  hears about the document.**
- Every field being confirmed, the run walks to `buildPreview`, which refuses
  `{kind: "document_missing", documentRef}` (`preview.ts:234`).
- `nextStep` turns that refusal into `specialist` / `preview_refused`.
- `toStoredPlan` independently refuses `has_uploads` (`plan-transport.ts:105`), so no unit of work
  could ever have been handed to a runner either.

So the refusal at the preview is the **last** of several places the architecture already declines to
proceed without a document. What was missing was not a safety boundary. It was anyone acting on it.

## §3 · Two problems, and only one of them is engineering

They were entangled in the phrase *"document upload is blocked"*, and separating them is what made
this phase possible:

1. **The planner's decision did not reach the system.** Nothing about it involves holding a document.
   It is a driver that discarded a step. Fixed here, with machinery that already exists, no schema
   change and no new state.
2. **There is no approved mechanism to obtain, hold or transmit a document.** That is ADR-0022's
   disclosure determination and ADR-0023's retention basis, both unapproved. Not fixed here, and not
   worked around.

The second does not gate the first, because **declining to proceed neither holds nor sends anything.**
ADR-0022 governs transmission; ADR-0023 governs storage. A run that stops engages neither.

## §4 · How the stop is represented

Through `#raiseForSpecialist` — the construction ADR-0064 extracted so `#pauseForReview` and the
interview stop share one. A third would be a third way for a run to be waiting for a person, and the
three could disagree about which runs those are.

- **Reason: `information_unobtainable`.** Deliberately **not** derived from the orchestrator's own
  `reason`, which is typed `string`. `recovery.ts` says in as many words that alerting routes off the
  reason and *"a routing decision made from free text is a routing decision waiting to fail"* —
  mapping an open string onto a closed, routing-consequential vocabulary would be exactly that. Its
  definition is the one that fits: the run requires something it cannot obtain.
- **The step is recognised by `specialistHandoverOf`**, a narrowing added to the orchestrator beside
  `interviewActionOf` and `requiresSecureRequest`. `check-boundaries` forbids the driver comparing a
  step's kind at all, and it is right to: `specialist` is one kind built in ten places, and an
  eleventh must reach this stop without anyone remembering to widen a condition in the coordinator.
- **The orchestrator's precise reason is carried losslessly** in `checkpoint.target` as
  `specialist:<reason>`, where nothing routes off it, and its `detail` becomes `encountered`. A
  specialist sees `The application attaches "Upload your passport" and no document has been provided
  for "passport".` without opening the blueprint.
- **One intervention per reason.** The target is the idempotency key, so a run re-advanced for the
  same reason raises nothing new, and a run stuck for two different reasons is two things to look at.
- **Priority `high`, not `critical`** — `recovery.ts` reserves critical for an imminent deadline, and
  this driver does not know the deadline.
- **Status `escalated`**, which `dueRuns` already excludes.
- **`reason` and `detail` are artefact facts** — a field ref, a document ref, a label, a host — never
  a value the student gave, which is why they can go to a specialist unredacted.

## §5 · A correction to ADR-0064 §2

ADR-0064 said the stop returns a position rather than falling through *"because the ordinary
checkpoint would put the status back to `running`"*. **That is wrong.** `saveCheckpoint` writes
`input.status ?? from` (`postgres-workflow.ts:166`), so omitting the status **preserves** it.

The mutation that removed the early return survived, which is how the error was found. What falling
through actually costs is the **revision**: the stop has already saved at `record.revision`, so
`checkpointAfter` passes a stale one, `saveCheckpoint` raises `RunConcurrencyError`, and `#decide`
spends one of its three attempts re-reading and deciding again. The outcome still comes out right —
which is precisely why nothing noticed — but every stop would burn an attempt from a budget that
exists for two clicks racing.

Both stops now assert it: the checkpoint is written **once**.

## §6 · The two `requiredDocuments`, and what is still open

There are two, and neither is derived from the other:

| | Type | Read by | Effect today |
|---|---|---|---|
| `BlueprintPage.requiredDocuments` | `RequiredDocument[]` — ref, label, accepted formats, `required`, `requiredWhen` | the mapping, via a `document`-sourced mapping → `plan.uploads` → `buildPreview` | **stops the run** (this ADR) |
| `CatalogueEntry.requiredDocuments` | `string[]` | `InterviewState`, and the published target listing | **nothing plans from it** |

The second is the gap ADR-0064 §4 recorded, and this phase **narrowed it rather than closing it**.
Measured and asserted: a run against a reviewed entry that declares `["passport"]` whose blueprint
attaches no document reaches `request_secret`, still `running` — it walks past the declaration to
asking for a portal password. Closing that means deciding what an entry-level declaration *means*,
which is a product question, not an engineering one (§7c).

## §7 · What ADR-0022 and ADR-0023 actually block

Split three ways, because collapsing them into "documents are blocked" is what hid §3's first problem.

**(a) Blocked until the determinations are approved.** Accepting a document from a student; holding
one anywhere; transmitting one to a portal. ADR-0022 requires a `DisclosureAuthorisation` carrying
what (ID **and content hash**), where (institution and portal host), why (the application), and
authority (a lawful-basis determination, plus specific authorisation where that says so — consent is
not the default basis and, where relied on, the text must name both the document and the
destination). ADR-0023 requires a retention period from an authoritative source, distinguishing
`legal_requirement`, `operational_requirement` and `policy_decision`, or the requirement is recorded
as **unresolved**, and unresolved **blocks**. Version 0 configures no policies and twelve unresolved
requirements. Nothing can be stored, by design.

**(b) Safe now, and done here.** Detecting that the run cannot proceed; stopping it; raising a
durable intervention that names which document; telling the student truthfully; leaving the case
where it was; surviving a reload; not being handed to the worker again. None of this holds, reads,
requests or transmits a document.

**(c) Product decisions, not engineering ones.** Whether AskiMate ever collects documents at all or
only ever identifies them; whether the student uploads to the portal themselves with the specialist
walking them through it; what an entry-level `requiredDocuments` declaration is supposed to mean
(§6). No amount of code answers these, and guessing at one would be inventing the policy ADR-0022 and
ADR-0023 exist to stop being invented.

## §8 · What the student is told

> *"I have had to pass your Example University application to a member of the team. There is
> something about it I cannot complete on my own, and I would rather a person looked at it than
> guess. Nothing you have given me is lost, and nothing has been submitted."*

Three deliberate choices:

- **It does not name the document.** Naming it would read as a request, and there is nothing to
  receive one with — no upload path, and (a) above unapproved. Telling a student to send a passport
  we cannot accept is worse than telling them nothing. The specialist, who *can* act on it, has it in
  `encountered`.
- **It is not `reviewMessage`.** That one says this is *"a rule we apply every time, not something
  that has gone wrong"*, which would be false: something did go wrong.
- **It does not name the step.** ADR-0064 §5 settled that; `waitsOnAPerson` in the client already
  renders `escalated` as waiting on a person, so nothing in the client changed.

## Consequences

- A run cannot sit at `specialist` being advanced for ever with nobody told.
- A third caller of ADR-0048's intervention store, and still no second state machine.
- No schema change, no new state, no migration.
- Document upload remains out of scope, with the blocking decisions named, split, and — for the parts
  that need no decision — implemented.
- ADR-0064 §2's stated reason is corrected, and both stops now have the assertion that would have
  caught it.
