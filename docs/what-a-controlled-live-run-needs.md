# What a controlled live run still needs

**Date:** 2026-08-26
**Scope:** one real application, on the real portal, **stopping before submission**.
**Target:** Ulster University Birmingham · MSc International Business · September 2026

The Stage D proof runs the whole chain against a replay. This is the gap between that and doing it
once, for real, safely. Written as a checklist because that is what it is.

---

## The short version

**Five things block it. Four are yours, one is mine.**

*(Updated 2026-08-26, later: the authentication model is decided and built.)*

| | Blocker | Whose |
|---|---|---|
| 1 | Real portal discovery output → the real blueprint | Yours (run it), then mine |
| 2 | Specialist review of the blueprint, and a reviewed mapping set | Yours (a specialist) |
| 3 | Bedrock credentials, then model IDs chosen | Yours |
| 4 | A sandbox account, or a consenting applicant | Yours |
| 5 | ~~Portal authentication handoff~~ — **decided and built** ([ADR-0020](./decisions/0020-the-account-belongs-to-the-student.md)) | Done |
| 6 | **A configured retention schedule** — not built, and the vault refuses without it | Yours to decide, mine to implement |

Item 6 is the one I want to be loudest about: it is not visible from the Stage D demonstration and
it is a hard stop.

---

## 1 · Discovery and the real blueprint

**Status:** blocked on network access. The runner is built, tested, and produces a replayable capture.

Run it per [the runbook](./runbook-discovery-handoff.md) and send the output back. I run
`pnpm run inspect-discovery` on it, which reports what the portal actually is and — the useful part
— **where it differs from what the replay proved**.

Then a specialist reviews the draft blueprint against the real portal and marks it reviewed. Until
that happens `checkExecutable` refuses it, and nothing downstream will run. That refusal is the
design working.

## 2 · A reviewed mapping set

**Status:** the package is built; the mapping for *this* portal does not exist and cannot until the
blueprint does.

Someone decides, per required field, whether it comes from a profile field (and in what notation), a
document, a student handoff, or a reviewed constant. Then **a second person reviews it** — a set
signed off by its own author is refused ([ADR-0017](./decisions/0017-mapping-is-reviewed-data.md)).

It is configuration, not code, and `inspect-discovery` prints the exact list of fields it must cover.

## 3 · Bedrock

**Status:** adapter built; no model chosen, and deliberately no default.

`pnpm run verify-bedrock` against the AskiMate AWS account prints what that account can actually use
and what each of the four workloads needs. Choose against those criteria, set four environment
variables, and record the reasoning in
[ADR-0018](./decisions/0018-amazon-bedrock-as-the-model-provider.md).

**Test document extraction first.** [ADR-0016](./decisions/0016-extraction-must-quote-the-document.md)
discards any reading whose quoted span is not in the document, so a model that paraphrases its own
quotations will fail every extraction. It is the cheapest thing to check and the most likely to
surprise.

## 4 · An account

**Status:** blocked on QA Higher Education, or on finding a consenting applicant.

[The request is drafted and ready to send](./qa-higher-education-sandbox-request.md), including the
exact list of what to ask for and what to do if they decline.

---

## 5 · Portal authentication handoff — **decided and built**

The model is settled ([ADR-0020](./decisions/0020-the-account-belongs-to-the-student.md)): the
account uses the student's own confirmed email, a temporary credential may be generated, and control
is handed back through the portal's own password-reset flow before our involvement ends.

Built: `packages/account`, and three orchestrator steps — `create_account`, `student_handoff`,
`hand_over_account`. A case cannot conclude while an account is outstanding, and the system has no
capability to read a mailbox.

**It remains a model, not a certainty.** If the portal turns out to send its own initial credential
to the applicant's email, or to require MFA from account creation, or to have the university issue
accounts rather than applicants creating them, the flow changes. The ADR lists what each would
change. **Discovery answers it** — and this is now the main thing discovery is for, alongside the
blueprint.

## 6 · A retention schedule — **not built, and it is a hard stop**

The document vault **refuses to store any document type with no configured retention policy**. There
is no default and no fallback to "keep indefinitely" — that is deliberate
([ADR-0010](./decisions/0010-policy-driven-document-retention.md)), because "kept forever because
nobody configured it" is the characteristic UK GDPR failure: breached silently, by omission, with
nothing ever complaining.

Nothing is configured. So **the first real document upload will fail**, loudly, by design.

What is needed is a policy decision per `(document type, purpose)`: how long, from what trigger, and
delete or anonymise. For the first run that is at minimum passport (identity verification), academic
transcript and English test certificate (application submission). **Not** bank statements —
financial evidence is out of scope for this application ([ADR-0021](./decisions/0021-application-requirements-are-not-visa-requirements.md)).

Per your earlier instruction I have not invented periods. They follow from ICO guidance, the
university's own requirements, and the application route — and they are yours to set, not mine to
assume.

---

## What is *not* blocking, and why

Worth listing, so the blockers above are not lost in a longer list.

| | Status | Why it does not block one controlled run |
|---|---|---|
| **Requirements Service** | Not built (gate is) | Financial evidence is **out of scope** for the first UK application ([ADR-0021](./decisions/0021-application-requirements-are-not-visa-requirements.md)) — a university application requirement is not a visa requirement. So no `critical` requirement is in scope for this run and this does not block it. |
| **Persistence (Postgres)** | In-memory | A supervised run in one sitting survives it. It does not survive a crash, and it does not survive the student going away for two days to find their passport — so it blocks the *second* run, not the first. |
| **Escalation transport / specialist console** | Modelled, not built | A human is watching a controlled run, so the alert is "the person in the room notices". |
| **Learning-loop capture** | Modelled, not wired | Nothing is lost by capturing the first run by hand. |
| **AWS infrastructure** | None, $0 spent | Not needed. The run happens on a laptop. |
| **AskiMate Chat integration** | Not built | A CLI harness stands in. The student's real experience needs it; a controlled test does not. |
| **Submission** | Deliberately absent | The run stops before it. That is the point. |

---

## The sequence, once the blockers clear

1. Discovery output arrives → `inspect-discovery` → **real draft blueprint**
2. Specialist reviews it → **executable blueprint**
3. Specialist authors + second reviews the mapping set → **usable mapping set**
4. Bedrock verified, models chosen, extraction spot-checked against a real document
5. Replay the captured real portal → **run the whole chain against the real portal's pages**, offline
6. Retention schedule configured
7. Account obtained
8. **Then** the live run — supervised, stopping before submit, with your explicit approval at that
   point

Step 5 is the one worth insisting on. It costs nothing, it is repeatable, and it is where every
mismatch between the fixture and the real portal will surface — on a laptop rather than in a real
admissions system.

---

## Both earlier questions are answered

**Authentication** — decided ([ADR-0020](./decisions/0020-the-account-belongs-to-the-student.md))
and built. Discovery will say whether the real portal fits the model.

**Financial evidence** — out of scope for the first UK application
([ADR-0021](./decisions/0021-application-requirements-are-not-visa-requirements.md)), with every
existing safety control kept.

## What is left, in one line

**A retention schedule, and the four external blockers.** Everything else that can be built without
the real portal has been.
