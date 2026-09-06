# P37 — ADRs 0005–0021, read against the code

**Date:** 2026-09-06 · **Decision:** [ADR-0072](./decisions/0072-two-decisions-enforced-by-nothing.md)

## Why this audit happened

Five consecutive phases each found that an **older ADR asserted a guarantee the code did not
provide**:

| Phase | The ADR said | The code did |
|---|---|---|
| P19 | ADR-0038 described a verified-email guard on the secure step | Nothing implemented it |
| P17 | ADR-0045 §4 said a crash was detectable | It was not |
| P31 | ADR-0022 said the system refuses to store without a registered basis | True of sending, false of storing |
| P34 | ADR-0022 required the application context before transmission | It was recorded and never compared |
| P35 | Two layers shared the name `documentRef` | Both readings were in the tree |

That is a pattern, not a run of coincidences, and the remaining unaudited records were the oldest.
So: read ADRs 0005–0021, extract every falsifiable claim, and check it.

**Method.** For each ADR, find the code artefact it names, then ask two questions — *does it do what
the ADR says?* and *does anything in production call it?* The second question is the one that found
most of this.

## The sweep

| ADR | Verdict |
|---|---|
| 0005 · Contract-first OpenAPI | ⚠️ **False as written** — Finding A |
| 0006 · Re-application requires an explicit student instruction | ❌ **Two defects** — Findings B, C, E |
| 0007 · Agent-led conversational intake | ✅ Holds. No form anywhere; `ProposedValue` has no conversion path; the interview loop is closed (P26, P28) |
| 0008 · Recovery-first escalation | ⚠️ **Out of date** — Finding D |
| 0009 · Requirements provenance | ✅ Holds. `packages/requirements` has no production caller, and the ADR says so itself: *"Built later (Phase 4)"* |
| 0010 · Policy-driven retention | ✅ Holds, and was made true where it was not: P32 |
| 0011 · Minor detection | ✅ Holds — see below, this one was checked hardest |
| 0012 · eu-west-2 | ✅ Holds. `bedrock-config.ts` defaults to `eu-west-2`, overridable, and nothing is provisioned |
| 0013 · Minor is not a blocker | ✅ Holds |
| 0014 · Discovery cannot submit | ✅ Holds, structurally, and tested against a real browser |
| 0015 · The interview is a capability of AskiMate Chat | ✅ Holds, as narrowed by ADR-0051 |
| 0016 · An extracted value must quote the document | ✅ Holds within `packages/extraction`; unreachable, and recorded as such since P31 |
| 0017 · Field mapping is reviewed data | ✅ Holds. `checkUsable` refuses an unreviewed set and has six production callers |
| 0018 · Bedrock, no model named | ✅ Holds. No model is chosen; `verify-bedrock` reads rather than guesses |
| 0019 · A specialist curates requirements | ✅ Holds. The ADR is explicit that the service is not built |
| 0020 · The account belongs to the student | ✅ Holds. Handover is a checklist with no partial credit (P12) |
| 0021 · Application requirements ≠ visa requirements | ✅ Holds. Financial evidence is out of scope and `isFinancialField` forces mandatory review where it appears |

## The findings

### A · ADR-0005 — "generated from it, never hand-written" is false

There is no generator in this repository. `packages/contracts/src/` is hand-written TypeScript;
`packages/contracts/openapi/*.yaml` are hand-written documents.

**Not a defect, and stronger than the ADR asked for.** ADR-0063 checks the published `paths` against
the real Express router — a generator produces a client matching the spec and says nothing about
whether the *server* matches it. The correction is recorded in ADR-0005 rather than reworded away,
because that sentence is one a future reader would rely on.

### B · ADR-0006 — the "second line of defence" is not armed

> *"An automatic retry never creates a new application… This is what makes duplicate submission
> structurally impossible, and it holds unconditionally — no configuration, no override, no
> exception."*
> `machine.ts`: *"The database unique index on the submission key is the second line of defence."*

> **Closed in P38 (2026-09-06).** The key is claimed at case-open, the refusal is `already_applying`,
> and the re-application it produces opens a NEW case — Finding C with it. ADR-0006 §3 is amended.
> What follows is the P37 record as written.

**`claimSubmissionKey` has exactly one caller in the repository, and it is `scripts/walkthrough.ts`.**
No production path claims a submission key. `RunDriver.start` opens a case with a
`submissionIdentity` and never claims its key.

**Reachable through published routes today.** `POST /v1/conversations` creates a fresh conversation
for any authenticated student; each conversation may request the same target; `withBinding` is
per-conversation, so two conversations produce two cases with the **same** `(studentId,
institutionId, courseId, intake, attemptOrdinal: 1)`. Two runs, two automations, one course.

**Blast radius today: nil** — nothing submits (ADR-0014) and no live portal is connected. **Blast
radius at the first live run: the brief's named catastrophic failure.**

**Not fixed in P37, deliberately.** Claiming the key at case open is the right fix and it is
incomplete on its own: a student whose case has *concluded* would then be unable to apply again,
because a second attempt needs `attemptOrdinal: 2`, which needs the re-application path — Finding C,
which does not exist. Closing B without C would replace a silent duplicate with a silent dead end,
and this repository has spent four phases removing exactly that shape. **B and C are one phase, and
it is the next one.**

### C · ADR-0006 — the re-application path is unreachable

`decideReapplication` and `recommendWait` have one caller between them: `scripts/walkthrough.ts`.
There is no route, no student decision kind and no driver path. The ADR's consequence —

> *"Every re-application can answer, from stored data alone: who asked, when, in what words, what we
> advised, and whether they chose to proceed anyway."*

— describes a path nobody can walk.

Everything it needs is decided and mostly built: `recommendWait` already produces the advice text,
`StudentDecision` is already a hash-bound union (so "the recommendation was shown" can be proved the
same way P22 proves "the preview was shown"), and `decide` already admits the intent on a terminal
case. What is missing is the wiring.

### D · ADR-0008 — out of date, now corrected

> *"Not built, and explicitly not claimed: the alerting transport…"*

Built in P36 (ADR-0071). A note was added rather than the sentence edited, so the record of what was
true when the decision was taken survives.

### E · ADR-0006 — two implementations of one decision, and the weaker one was on the path

**Fixed in P37.** `decideReapplication`'s own doc comment has said since Phase 1:

> *"The single gate. `machine.ts` calls this; nothing else may increment an attempt ordinal."*

`machine.ts` imported only the **type**. Its `instruct_reapplication` case checked one of the five
rules — that the ordinal increases by exactly one — and accepted everything else. So the state
machine would have emitted `ReapplicationInstructed` for:

| Rule | Enforced by `decideReapplication` | Enforced by `machine.ts` |
|---|---|---|
| only a student may ask | ✅ | ❌ — `automatic_retry`, `specialist` and `operator` all accepted |
| the prior case must have concluded | ✅ | ❌ |
| the instruction must carry the student's own words | ✅ | ❌ |
| the recommendation must have been shown first | ✅ | ❌ |
| the ordinal increases by one | ✅ | ✅ |

ADR-0041's failure inside the domain: one decision, two implementations, the weaker one live.

**Not exploitable today**, because Finding C means nothing can reach the intent. That is exactly why
it is worth fixing now — the person who builds the re-application path will read that comment and
trust it. The constraint ships before the thing it constrains (ADR-0019).

### F · The walkthrough had stopped demonstrating anything, and could not fail

Found while fixing E. `pnpm run walkthrough` — which the README calls *"the fastest way to see what
has been built"* — was **refusing nine consecutive steps** and exiting 0.

```
✗ REFUSED  Mark ready          No transition exists from READY_TO_PREPARE to READY_TO_PREPARE
✗ REFUSED  Student authorises  Authorisation can only be captured from
                               AWAITING_STUDENT_AUTHORISATION, case is PREPARING
✗ REFUSED  Submit              No transition exists from AWAITING_STUDENT_AUTHORISATION to SUBMITTING
✗ REFUSED  Mark submitted      …
✗ REFUSED  Confirm             …
```

Two later decisions did it, neither wrongly:

- **ADR-0058** made a case open directly into `READY_TO_PREPARE`, so the script's explicit "Mark
  ready" step became a self-transition — and every step after it inherited the wrong state.
- Capturing an authorisation became the act that **moves** the case to `AUTHORISED`, so submitting
  straight from `AWAITING_STUDENT_AUTHORISATION` is correctly refused.

The script also never retried the authorisation transition after the mandatory financial-evidence
review it exists to demonstrate, so the review was requested and its satisfaction never shown.

**The defect is not the drift. It is that a demonstration with no expectations cannot be wrong.**
Every step now declares whether it expects acceptance or refusal, the script exits non-zero when any
step disagrees with the story it tells, and `scripts/walkthrough.test.ts` runs it inside
`pnpm run verify`.

## What was checked hardest, and holds

**Minors.** A standing hard stop, so this one was checked in both directions.

- `mandatoryTriggersOf` raises `involves_minor` from `suggestsMinority` on the **confirmed** date of
  birth, and the code carries the record of getting this wrong once: a first version used
  `determineAge`, which returns `requires_identity_check` for *any* merely stated date of birth and
  raised the trigger on every case in the system. The two answer different questions and only the
  second is what the trigger is about.
- Nothing concludes "adult" from absent, unparseable or merely stated evidence.
- No parental-consent requirement is hardcoded anywhere; conditions are determined.
- `checkMinorGate` has no production caller, and that is correct rather than a gap: its one blocking
  condition is at the `submission` stage, and submission does not exist (ADR-0014). It is the
  vault's situation — a correct control waiting for the thing it constrains.

**Financial evidence.** `isFinancialField` is read by the run driver on every mandatory-review
derivation. The gate is live and the walkthrough now demonstrates it being satisfied by a review
rather than merely requested.

## What P37 changed

| | |
|---|---|
| Fixed | **E** — `machine.ts` calls `decideReapplication`; the intent carries the actor and no longer proposes an ordinal |
| Fixed | **F** — the walkthrough follows the real state machine, asserts every step, and is in `pnpm run verify` |
| Corrected | **A** in ADR-0005, **D** in ADR-0008 |
| Recorded, not fixed | **B** and **C**, which are one phase and are the next one |
