# P21 — deliberate regression audit

## Stage A — the three case states (commit `f89cbf2`)

Five mutations, all caught: a spine walk that skips states; one that runs
backwards and would un-prepare an authorised case; a removed state quietly
re-added to the spine; `ALLOWED_TRANSITIONS.INTAKE` widened to permit
`PREPARING`; and the mandatory-review gate on student authorisation deleted.

The fourth survived its first pass. `nextCaseHop` only ever proposes the next
element of `CASE_SPINE`, so a wider allow-list permits something no caller
attempts — the table's restrictiveness is load-bearing only for callers other
than the walk, such as a specialist recovery calling `decide()` directly. **An
allow-list can only be tested by asserting what it refuses**, so two direct
table assertions were added, and the mutation is caught.

The rest of this document covers **Stage B**: the target listing, the
deterministic offer, and the explicit request that opens a case.

## Stage B

Eighteen mutations, each applied to a source file on disk, **read back from disk
to prove the edit landed**, run against the suites that should catch it, and
then restored from a byte copy taken before the edit — never from
`git checkout`, because a restore that consults version control cannot
distinguish "put back" from "was never changed".

Sixteen were caught on the first pass. Two survived. Both were shadowed
controls, both are now caught by tests written specifically for them, and both
are worth recording because neither would have been visible from a green suite.

| # | Mutation | File | Result | Caught by |
|---|----------|------|--------|-----------|
| R1 | Gate 2 stops requiring the offer to be in this conversation's log | `target-offers.ts` | **CAUGHT** | p21 e2e |
| R2 | Gate 2 stops re-deriving — a logged hash is accepted as still valid | `target-offers.ts` | **CAUGHT** | p21 e2e |
| R3 | The offer hash stops binding to the **student** | `target.ts` | **CAUGHT** ¹ | catalogue unit |
| R4 | The offer hash stops binding to the **conversation** | `target.ts` | **CAUGHT** | unit, p21 e2e |
| R5 | The offer hash stops binding to the **reviewed content** | `target.ts` | **CAUGHT** | unit, p21 e2e |
| R6 | The run route falls back to a raw `blueprintId` when no offer is named | `routes.ts` | **CAUGHT** | p21 e2e, driver |
| R7 | The case is opened from the **body's** blueprint, not the verified offer | `routes.ts` | **CAUGHT** ¹ | p21 e2e |
| R8 | A deployment with no target directory starts runs anyway | `routes.ts` | **CAUGHT** | p21 e2e |
| R9 | Gate 1 falls back to the first target when the id is unknown | `target-offers.ts` | **CAUGHT** | p21 e2e |
| R10 | Ambiguity stops being detected at all | `target.ts` | **CAUGHT** | unit, p21 e2e |
| R11 | An ambiguous target is resolved by picking the first candidate | `target-offers.ts` | **CAUGHT** | p21 e2e |
| R12 | The explicit request stops being recorded | `routes.ts` | **CAUGHT** | p21 e2e |
| R13 | The offer stops being recorded | `routes.ts` | **CAUGHT** | p21 e2e |
| R14 | The offer route stops checking who owns the conversation | `routes.ts` | **CAUGHT** | p21 e2e |
| R15 | The rendered offer stops naming the route and the portal | `target.ts` | **CAUGHT** | unit, p21 e2e, journey |
| R16 | The log read stops carrying the offer hash | `event-store.ts` | **CAUGHT** ¹ | event-store |
| R17 | The database stops requiring a target event to name an offer | `0012_target_offers.sql` | **CAUGHT** | schema |
| R18 | The exchange view admits every kind of event | `0012_target_offers.sql` | **CAUGHT** | schema |

¹ Survived the first pass. See below.

## The two that survived, and what they were hiding

### R3 — the student binding, shadowed by the conversation binding

Deleting `studentId` from `offerCanonical` broke nothing. Not because the
binding is untested — three tests appeared to cover it — but because **a
conversation belongs to exactly one student**, enforced by
`conversations.student_id` and by the ownership check every route runs. So
every test that changed the student also changed the conversation, and the
conversation binding answered first, every time.

The tempting conclusion is that `studentId` is therefore redundant. It is
redundant *given* the ownership check, and that is exactly why it stays: it is
the binding that still holds if the ownership check is ever wrong, and it costs
one field in a hash. What is not acceptable is calling it a proven control
while no test can reach it.

So it is now asserted where it *is* reachable — at the function, in
`packages/catalogue/src/catalogue.test.ts`, holding the conversation fixed and
varying only the student. The route-level tests remain, and they still prove
what they always proved: the conversation binding.

### R7 — reading the body, where no test sent both

`blueprintId: readString(req.body, "blueprintId") ?? verified.target.blueprintId`
survived the whole suite. Every existing test sent **either** an `offerHash`
**or** a `blueprintId`, never both — so no test could tell which one the route
read. A client that sent a valid offer alongside a different blueprint id would
have had a case opened against its own choice.

`IGNORES a blueprintId sent alongside a valid offer` now sends both and asserts
the *consequence*: which blueprint the `cases` row was bound to. Not the status
code, which was 201 either way.

### R16 — a control that became unreachable while the code improved

`SELECT_EVENT` originally omitted the three new columns entirely, and that was
found by the P21 suite failing outright: Gate 2 read the log through
`store.since` and got `undefined` back. The route was then changed to read the
`conversation_target_exchange` **view** instead — a better design, and it is
what migration 0012's comment says the view is for — which had the side effect
of removing the only thing exercising the column in `SELECT_EVENT`.

So the same mutation that had been a hard failure became invisible. The read
still matters: `since` and the SSE stream are how a target event reaches a
client, and the published contract puts `offerHash` on both kinds. It is now
asserted directly by a round-trip test in `event-store.test.ts`, alongside the
view returning the same two rows.

This is the seventh consecutive phase in which a shadowed control has turned
up, and the first in which one was created *by* an improvement rather than
found in existing code. Worth remembering: moving a read to a better place can
orphan the test that was covering the old one.

## What the exercise confirmed about the design

**Re-derivation and the log are genuinely independent.** R1 and R2 remove one
each, and they fail on different tests: R1 lets a fabricated or foreign hash
through, R2 lets a retired or re-reviewed target through. Neither condition
subsumes the other, which is the argument for requiring both.

**The ambiguity refusal is load-bearing three times over.** R10 (never detect
it), R11 (detect and ignore it) and R15 (detect it but stop showing the student
what distinguishes the candidates) are three different ways to lose the same
property, and all three are caught separately.

**The 503 for a missing directory is a refusal, not a formality.** R8 replaced
it with a fallback that starts the run, and the test that catches it asserts
the case was not opened — not just that the status differed.

## Scope note

Nothing in this exercise fabricated review evidence, invented a blueprint, or
approved an artefact through production code. The catalogue the P21 suite loads
is written by the test as two named test specialists over the gated **test**
portal this repository owns and runs; there is still no `approve` command
anywhere in the repository. `AAS_CATALOGUE=fixtures` remains refused in
production (P20, R9).
