# What the missing Replit access actually blocks

**Date:** 2026-08-27
**Status of access:** the production AskiMate application is hosted on **Replit**. That project is
not currently accessible to this session. Access is expected.
**Purpose:** to make the blocked set as small and as precise as it really is, so nothing else stops.

> Vahid, 2026-08-27: *"This must not become a blocker for building the product… Only the first
> category should be blocked."*

---

## The short version

**Three items are genuinely blocked. Everything else in the product can continue.**

The blocked set is small because of a decision made early and deliberately: AskiMate Chat was
always modelled as an *external caller* of this system ([ADR-0015](./decisions/0015-interview-is-a-capability-of-askimate-chat.md)),
never as something this repository contains. The orchestrator answers *"given where this case is,
what happens next?"* and renders nothing. So the surface that touches AskiMate is one function's
return type, not a subsystem — and everything behind it was always independent.

---

## 1. Genuinely blocked by Replit access

| # | Item | Why it needs the production source | Current state |
|---|---|---|---|
| **B1** | **Production chat data-path audit** | The whole question is *what does the live code do* — which middleware runs, whether a logger was added, how history is assembled. Cannot be inferred. | Not started. |
| **B2** | **Production secure-endpoint integration** | The endpoint has to be committed into the production repository, registered in its real route table, and ordered ahead of its real middleware. | `apps/chat-integration` is a **research build** against the 2026-06-18 archive. Labelled as such in its README and `index.ts`. |
| **B3** | **Verifying the `err.body` finding against production** | Measured on Express 5 + body-parser 2.3.0 in the archive's stack shape. Whether the live app has a logger that would serialise a caught error is **unverifiable** from here. | Finding documented; mitigation (`scrubParseErrorBody`) written and tested against the research build. |

### What B1–B3 do *not* block

They do not block the secret channel's **architecture**, which is complete and tested
([ADR-0026](./decisions/0026-a-password-the-model-can-ask-for-and-never-see.md)): the handle, the
absence of a getter, single-use destruction before the callback runs, the five binding checks, the
four lifecycle words, and the untraced browser consumption path. None of that depends on how
AskiMate Chat is written. Only the *transport into it* does.

---

## 2. Blocked by something else entirely (not Replit)

Recorded so the two are not confused. These were blocked before the Replit question arose and are
unaffected by it.

| Item | Blocked on | Whose |
|---|---|---|
| Real portal authentication behaviour (8 questions) | a portal we are permitted to try | Vahid |
| Real application requirements | specialist curation | Vahid |
| Executable blueprint · usable mapping set | specialist review, then a second reviewer | Vahid |
| Retention determinations | twelve open questions, one named owner | Vahid |
| Bedrock credentials and the four model IDs | AWS access | Vahid |
| A sandbox account or a consenting applicant | QA Higher Education, or a real student | Vahid |
| Any live run | all of the above, plus explicit written approval | Vahid |

---

## 3. Can continue immediately — nothing external required

Ordered by my assessment of value. Each is a real piece of the product, buildable and testable here.

| # | Work | Why it matters | Depends on |
|---|---|---|---|
| **C1** | **Postgres case store** behind the existing `CaseStore` port | The repo's own analysis says in-memory persistence *"does not survive the applicant going away for two days to find their passport — so it blocks the second run"*. `contract.ts` exists precisely so a second implementation must pass the identical suite, and the CI job is already written and disabled awaiting it. | nothing |
| **C2** | **Recovery transport** — the human-recovery path is modelled but has no transport | A failure mid-run currently has nowhere to go except a person watching the screen. | nothing |
| **C3** | **Learning loop wiring** — `ReusableResolution` exists and is not connected | An intervention that taught us something is currently thrown away. | nothing |
| **C4** | **Post-submission confirmation and handover** | Modelled; the confirmation half is not built. | nothing |
| **C5** | **Idempotency across process restarts** | Submission keys are claimed in memory. With C1 this becomes a real unique constraint. | C1 |
| **C6** | **Specialist console read-model** | A queryable view of what a specialist must decide. | C1 |
| **C7** | **Blueprint drift detection against a stored capture** | Built but unwired to storage. | C1 |

**C1 is the correct next piece of work**, and it is what this phase proceeds with. It is not a new
architectural decision — the port, the contract suite, the ADR and the CI job all already exist and
name it. It unblocks C5, C6 and C7.

---

## 4. When Replit access arrives

In this order, and none of it merged before the first two are done:

1. **Inspect** the production source; record repository, branch, deployed commit, versioning.
2. **Diff** against `archive/askimate/` — enumerate what changed in the ten weeks.
3. **Audit** the real chat and message data path, middleware, logging, telemetry, error handling.
4. **Re-measure** the `err.body` behaviour on the versions production actually runs.
5. **Verify** the secure-channel properties against the real implementation, not the research one.
6. **Then** integrate, as its own versioned change, with its own tests.

Nothing from `apps/chat-integration` should be merged into production before step 4.
