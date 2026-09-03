# ADR-0058 — A case opens from an offer the student accepted, not from an identifier they sent

**Status:** **Accepted** — Vahid's decision, 2026-09-03
**Amends:** [ADR-0049](./0049-the-run-driver-drives-the-case-machine.md) — the case spine loses three members ·
[ADR-0001](./0001-integration-via-https-api-and-signed-webhooks.md) §`request_evidence` — the channel vocabulary
**Depends on:** [ADR-0051](./0051-the-student-supplies-through-the-conversation.md) (this system's own
conversation is the student surface), [ADR-0057](./0057-approval-binds-to-content-not-to-claims.md)
(an approval binds to content)

## What the investigation found, before any of this was designed

Three things measured on `main` at `e70ed23`, two of which contradicted the phase as originally
proposed.

**1. The consequential boundary already existed, and was already safe.**
`POST /v1/conversations/{id}/runs` already requires an authenticated session, answers 404 — never
403 — for another student's conversation, requires a `studentStatement` that becomes
`CaseOpened.requestEvidence`, refuses an unknown blueprint, and is idempotent through
`conversations_one_conversation_per_case` plus a row lock rather than through a header. Nothing
parses prose for intent and no model can reach it. So *"only an explicit student action can create a
case"* was already true.

What was missing was not the gate. It was that **nothing could reach it** — the endpoint had no
production caller, the catalogue could not be listed, and the request named a bare `blueprintId`, so
nothing proved the student had been shown what that identifier *was*.

**2. `REQUIREMENTS_RESOLUTION` and `ELIGIBILITY_REVIEW` were not states any decision produced.**
`caseStateFor(phase)` is total over `WorkflowPhase` and maps **no phase** to either. They were
entered only because `nextCaseHop` walks `CASE_SPINE` one element at a time, so a case travelling
`INTAKE → READY_TO_PREPARE` passed *through* them. They were traversal waypoints with a plausible
sentence attached in `HOP_REASONS`. `BLUEPRINT_REQUIRED` was never entered at all.

**3. Gate 1 was already substantially built.** `loadCatalogueDirectory` runs `checkExecutable` and
`checkUsable` on every entry and fails the whole load if any refuses, so a registry-backed catalogue
cannot *contain* an unreviewed, retired, superseded or unusable target.

## The decision

### The journey, and the two gates

```
  advice / recommendation            elsewhere; no durable effect here
        │
  student interest                   a `message`. NOT consequential.
        │
  target resolution  ────────────▶   GATE 1: the reviewed catalogue, and nothing else
        │
  deterministic offer                appended to the log, hashed
        │
  explicit request   ────────────▶   GATE 2: the student names the offer hash
        │
  CaseOpened + requestEvidence       the FIRST consequential transition
        │
  the existing run / interview journey
```

**Gate 1 — the reviewed catalogue.** An offer can only be built from a `CatalogueEntry`. Since
ADR-0057 the served catalogue contains only entries an approval registry vouched for and that passed
`checkExecutable` and `checkUsable` at startup. A listing is a **read-only view over already
approved artefacts**: listing something neither creates nor implies approval, and there is no second
unreviewed catalogue anywhere.

**Gate 2 — the explicit request.** A case opens only when the authenticated student names the hash
of an offer this server built for *them*, in *this* conversation. The run-start request therefore
takes an **offer hash and not a `blueprintId`**: an identifier alone is exactly the thing that must
not be able to open a case, because it carries no evidence that the student was shown what it means.

### What the offer hash binds, and what it does not prove

The hash covers a canonical value (ADR-0057's canonicaliser, reused rather than re-invented) built
from four things:

| | Why it is in the hash |
|---|---|
| the authenticated student's id | so an offer made to one student cannot be spent by another |
| the conversation id | so an offer made in one conversation cannot be spent in another |
| the target's identity — institution, campus, course, intake, route, portal host | so two materially different routes to the same course are two different offers |
| the catalogue entry's own content hash | so an offer is bound to the exact reviewed artefact that supported it |

**What it does not prove.** A hash proves that two values are the same value. It does not prove the
offer was ever shown, that the student read it, or that the catalogue still holds that artefact. The
first is established by the durable offer event, the second is not establishable by software at all,
and the third is why the request **re-derives** rather than trusting.

### The request re-derives; possession is never sufficient

The request handler checks **two independent conditions**, and neither is sufficient alone.

1. **The offer is in this conversation's log** — a `target_offered` event carrying that hash. This
   is what makes progression structural rather than conventional: a request can only accept
   something that was actually offered here, so *recommendation ≠ selection* is enforced by
   evidence.
2. **Some reviewed target, rebuilt from the catalogue as it is now for this student and this
   conversation, hashes to it.** This is what makes possession insufficient.

The log alone would accept an offer whose target has since been retired or re-reviewed.
Re-derivation alone would accept a hash a client **computed for itself** and was never offered —
the fields are server-side today, but a gate that holds only because a listing withholds two
columns is not a gate. Requiring both costs one array lookup.

*Amended during implementation.* The first draft of this ADR treated the stored event as audit only
and let re-derivation decide alone. Writing the refusal tests made the gap visible; the log check
went in and the ADR was corrected rather than the code being left to disagree with it.

Condition 2 answers all six integrity questions without any expiry logic:

| Question | Answer |
|---|---|
| Target retired after the offer? | It is no longer in the catalogue, so the rebuild fails. **Refused.** |
| Catalogue content changed or superseded? | The rebuild produces a different hash. **Refused.** |
| Does an offer expire? | **No, and it needs no clock.** An offer stays valid exactly as long as the thing it describes is unchanged, which is the property that actually matters. A timeout would refuse unchanged offers and accept changed ones within the window. |
| May an offer be replayed? | Both conditions still hold, so the request is accepted — and then the one-case-per-conversation schema makes the second case impossible, returning the first. A replay is therefore **idempotent, not a second application.** The `target_requested` event is written **once per offer**, not once per call: a log that grew one on every retry would say the student asked to apply five times when they asked once. A request naming a *different* offer is a different fact and *is* recorded, even though the existing case is what comes back — one case per conversation is a real constraint, and a student running into it should be visible rather than silently dropped. |
| Another student? | The hash covers the student id. **Refused.** |
| Another conversation? | The hash covers the conversation id. **Refused.** |

### Ambiguity is the student's to resolve, and it is a safety property

`submissionKey` is `(student, institution, course, intake, attempt)` — **`blueprintId` is not in
it.** So two reviewed routes to the same course and intake produce the *same* key: starting one
permanently blocks the other for that student. The choice between them is irreversible, which is why
the system must never pick a default, a best match, or a first match. Where several reviewed targets
share institution, course and intake, the listing must surface the distinguishing route and portal
host and the student must choose one.

### An unavailable target is not a case

A student asking for something the reviewed catalogue does not hold gets an honest refusal. No case
is opened to represent the demand, and no blueprint is invented. The record already exists and needs
no new mechanism: their message asking, and the reply refusing, are both durable events in the
conversation log.

### `requestEvidence.channel` was false, and that is a correctness defect

`channel` was `"askimate_chat" | "askimate_ui" | "specialist_recorded"` and the driver wrote
`"askimate_chat"` unconditionally. Since ADR-0051 made this system's own conversation the student
surface, **every case this system has opened has asserted in an audit field that the request arrived
through a product that did not receive it.** A new member names this surface truthfully, and the
contract-drift guard covers the vocabulary on every surface that carries it.

## The case machine loses three states

Applying the test — *does this represent a real, durable, business-level transition in the lifecycle
of an application case?* — to each:

| State | Verdict |
|---|---|
| `REQUIREMENTS_RESOLUTION` | **No.** No phase maps to it. Under this ADR the target is resolved, approved and validated *before* `CaseOpened` exists, so a case can never be in the act of resolving one. **Removed.** |
| `ELIGIBILITY_REVIEW` | **No.** Its actual behaviour was `checkExecutable` + `checkUsable` passing — an implementation validation, and one that now also happens before the case exists. **Removed.** |
| `BLUEPRINT_REQUIRED` | **No.** Never entered, and an unavailable target does not become a case. **Removed rather than repurposed**, deliberately: keeping a state so that an existing name has somewhere to live is how a state machine stops describing the business. |

The spine becomes:

```
INTAKE → READY_TO_PREPARE → PREPARING → AWAITING_STUDENT_AUTHORISATION → AUTHORISED
```

with `PROFILE_INCOMPLETE` and `DOCUMENTS_PENDING` remaining as branches, which is already where
"waiting on the student" lives.

**Why now.** Case state is not a column, an enum or a constraint — it lives inside
`case_events.event` (jsonb) and is replayed by `machine.ts`. Nothing has been released or deployed.
So today this is a code change over zero rows. After first production use it would need a permanent
alias in the reducer and a decision about what a specialist reading an old log is shown.

## What was built, and where it lives

| Piece | Where | What it is |
|---|---|---|
| `ReviewedTarget`, `offerCanonical`, `offerFor`, `renderOffer` | `packages/catalogue/src/target.ts` | Gate 1's output and Gate 2's input. Pure; no knowledge of runs, cases or HTTP. |
| `ambiguousGroups`, `isAmbiguous` | same | The submission-key collision, as a function. |
| `ReviewedCatalogue.targets()`, `.hashOf()` | `packages/catalogue/src/loader.ts` | Gate 1. Needs almost no code because ADR-0057 already refuses to start on an unreviewed entry. |
| `makeOffer`, `verifyRequest` | `apps/conversation-service/src/target-offers.ts` | The two gates as decisions, with refusals as outcomes rather than exceptions. |
| `GET /v1/application-targets` | `routes.ts` | Authenticated listing. Carries neither `contentHash` nor `blueprintVersion`. |
| `POST /v1/conversations/{id}/target-offers` | `routes.ts` | Resolves a chosen target and puts it to the student. Opens nothing. |
| `POST /v1/conversations/{id}/runs` | `routes.ts` | Reads `offerHash`; **does not read `blueprintId` at all**. |
| `target_offered`, `target_requested` | migration `0012` | Two events, two CHECK constraints, and `conversation_target_exchange` — the view the run route reads Gate 2's first condition from. |

The listing withholding `contentHash` is defence in depth, not the gate. The gate is condition 1.

## Consequences

- **A student can, for the first time, start an application through the product.** Every phase from
  P4 to P20 built something downstream of a step nobody could take.
- **`blueprintId` leaves the run-start contract.** A breaking change to an endpoint with no
  production caller and no deployment — verified by search, not assumed: no source outside the two
  test suites that exercise the route ever posted one, and `apps/chat-integration` never called the
  route at all. The old contract does not survive as a second path, because the route does not read
  the field: a body carrying only a `blueprintId` is answered as one that named no offer.
- **Starting a case still authorises nothing.** Filling requires `authorise` against the preview's
  content hash; nothing submits at all (ADR-0014). Those boundaries are untouched by this ADR.
- **The requirements boundary is unchanged.** Nothing here consumes requirement knowledge, and no
  student data leaves. ADR-0009's service stays unwired.
