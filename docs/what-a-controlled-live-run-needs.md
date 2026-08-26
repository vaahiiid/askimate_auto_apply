# What a controlled live run still needs

**Date:** 2026-08-26
**Scope:** one real application, on the real portal, **stopping before submission**.
**Target:** Ulster University Birmingham · MSc International Business · September 2026

The Stage D proof runs the whole chain against a replay. This is the gap between that and doing it
once, for real, safely. Written as a checklist because that is what it is.

---

## The short version

**Six things block it. Four are yours, two are mine.**

Everything else on the list is either done or is a decision that follows from those six.

| | Blocker | Whose |
|---|---|---|
| 1 | Real portal discovery output → the real blueprint | Yours (run it), then mine |
| 2 | Specialist review of the blueprint, and a reviewed mapping set | Yours (a specialist) |
| 3 | Bedrock credentials, then model IDs chosen | Yours |
| 4 | A sandbox account, or a consenting applicant | Yours |
| 5 | **Portal authentication handoff** — not built | Mine |
| 6 | **A configured retention schedule** — not built, and the vault refuses without it | Yours to decide, mine to implement |

Items 5 and 6 are the two I want to be loudest about, because neither is visible from the Stage D
demonstration and both are hard stops.

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

## 5 · Portal authentication handoff — **not built**

This is the gap that does not show up in the Stage D demonstration, because the fixture portal has
no login.

The real portal requires an account and a login, and the rules are absolute: **no student portal
passwords are stored**, and MFA, OTP and CAPTCHA are never bypassed. So authentication happens by
**session handoff** — the student authenticates themselves, and the run continues in the
authenticated session.

What exists: the domain models it (`HandoffRequested`, `HandoffCompleted`, `AWAITING_HANDOFF`, and
an `ExecutionCheckpoint` to resume from), and the fill plan reports per-field handoffs.

What does not exist: **anything that actually pauses a browser session, hands it to a student, and
resumes it.** The orchestrator has no `RunStep` for it. Concretely, the run cannot get past the
login page.

I have not built it because its shape depends on facts I do not have yet — whether the sandbox
requires MFA at all, whether the session is cookie-based or token-based, and whether the student is
sitting next to the specialist or somewhere else entirely. Discovery answers the first two.

**This is a genuine product decision and I would rather ask than guess.** Roughly, the options are:

- **Supervised, one sitting** — the student logs in on a screen the specialist can see, and the run
  continues. Simplest, fine for one controlled run, does not generalise.
- **Session handoff proper** — the student authenticates in their own browser and the session is
  transferred. Generalises, and is more work.
- **Specialist-assisted** — the specialist drives the login with the student present. Fastest to a
  first run, and closest to the thing ADR-0008 warns about, so it needs a clear boundary.

## 6 · A retention schedule — **not built, and it is a hard stop**

The document vault **refuses to store any document type with no configured retention policy**. There
is no default and no fallback to "keep indefinitely" — that is deliberate
([ADR-0010](./decisions/0010-policy-driven-document-retention.md)), because "kept forever because
nobody configured it" is the characteristic UK GDPR failure: breached silently, by omission, with
nothing ever complaining.

Nothing is configured. So **the first real document upload will fail**, loudly, by design.

What is needed is a policy decision per `(document type, purpose)`: how long, from what trigger, and
delete or anonymise. For the first run that is at minimum passport (identity verification), academic
transcript and English test certificate (application submission), and bank statement (financial
evidence) if financial evidence is in scope.

Per your earlier instruction I have not invented periods. They follow from ICO guidance, the
university's own requirements, and the application route — and they are yours to set, not mine to
assume.

---

## What is *not* blocking, and why

Worth listing, so the six above are not lost in a longer list.

| | Status | Why it does not block one controlled run |
|---|---|---|
| **Requirements Service** | Not built (gate is) | Only if the run touches a `critical` requirement — financial evidence, a visa rule, anything about a minor. Avoid those for the first run and it does not bite. **If financial evidence is in scope, this blocks.** |
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
6. Retention schedule configured; handoff approach decided and built
7. Account obtained
8. **Then** the live run — supervised, stopping before submit, with your explicit approval at that
   point

Step 5 is the one worth insisting on. It costs nothing, it is repeatable, and it is where every
mismatch between the fixture and the real portal will surface — on a laptop rather than in a real
admissions system.

---

## Two questions for you

1. **Which authentication handoff approach** (§5)? It changes what I build next, and I do not want to
   guess. Discovery may narrow it — if the portal turns out not to require MFA, the answer gets
   easier.
2. **Is financial evidence in scope for the first run?** If yes, the Requirements Service moves from
   "not blocking" to blocking, because a 31-day recency window is a `critical` requirement and the
   evidence bar will not let it through on one source.
