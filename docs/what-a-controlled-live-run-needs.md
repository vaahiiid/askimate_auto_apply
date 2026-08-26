# What a controlled live run still needs

**Date:** 2026-08-26 (revised, later the same day)
**Scope:** one real application, on the real portal, **stopping before submission**.
**Target:** Ulster University Birmingham · MSc International Business · September 2026

The Stage D proof runs the whole chain against a replay. This is the gap between that and doing it
once, for real, safely.

Every one of the eighteen areas you named appears below with its status, honestly. Nothing has been
marked done because it is "basically done" — several rows say *built, unproven against a real
portal*, which is a different thing and the difference is the point of the exercise.

---

## The short version

**Six things block it. Five are yours, one is mine and it is waiting on you.**

| | Blocker | Whose | Area |
|---|---|---|---|
| 1 | **Real portal discovery** — nothing downstream is real until this exists | Yours to run | 1, 3, 6 |
| 2 | **Specialist review** of the blueprint, then a mapping set reviewed by a second person | Yours | 6, 9 |
| 3 | **Bedrock credentials**, then the four model IDs | Yours | 17 |
| 4 | **An account** — QA HE sandbox, or a consenting applicant | Yours | 18 |
| 5 | **Retention determinations** — twelve open questions, one named owner | Yours to decide | 5 |
| 6 | **AskiMate Chat integration** for the interview | Mine, once 1–2 land | 7 |

Nothing on this list is waiting on me except 6, and 6 cannot start before the blueprint is real.

---

## The eighteen areas

Legend: **✅ built and proven** against the replay · **🟡 built, unproven** against a real portal ·
**⛔ blocked** · **❌ not built**

### 1 · Real portal authentication behaviour — ⛔

**Blocked on discovery.** This environment cannot reach the three hosts and I have not tried to get
round that.

What exists: the *shape* of the answer, typed. `ObservedPortalAuthentication` has one field per
question, and `chooseApproach` refuses until all eight are answered — an unobserved answer is not a
"no" ([ADR-0020](./decisions/0020-the-account-belongs-to-the-student.md)).

| | Question | Answerable from a page capture? |
|---|---|---|
| 1 | Does the applicant choose their own password at account creation? | Partly |
| 2 | Does the portal generate a credential and email it to them? | **No** |
| 3 | Is there passwordless sign-in — a magic link or emailed code? | **No** |
| 4 | Must the email be verified before the form is reachable? | Partly |
| 5 | Is MFA or a one-time code required, and where? | Partly |
| 6 | Is a CAPTCHA present, and where? | Partly |
| 7 | Does "Forgot password" work, and does the reset reach the account's own address? | **No** |
| 8 | Can control be handed back cleanly? | **No** |

Four of the eight need a portal we are permitted to try, not a capture — which is why area 18 and
this one are the same blocker wearing two hats.

### 2 · Account ownership and handover — 🟡

Built: `packages/account`. The account's email is a `ConfirmedValue` (there is no path that puts an
AskiMate address there); handover is all-or-nothing; a case cannot conclude while an account is
outstanding; the system has **no capability to read a mailbox**, enforced by the dependency-boundary
check rather than by intent.

The preferred order is now structural rather than advisory: we hold a credential only where a plan
built from observations says the portal required it, and `mintCredentialUnder` refuses otherwise.
`EphemeralCredential` has one constructor and it generates — there is no way to supply a secret.

**Unproven** because area 1 is blocked. The approach the real portal forces is unknown, and that is
exactly what discovery decides.

### 3 · Real application requirements — ⛔

The Requirements Service is built on AskiMate's own `kb_pending_entries → review → kb_entries`
workflow, with a second official-source channel and a gate that refuses conflicting or uncorroborated
evidence at every criticality.

**No requirement for this course has been curated.** That is a specialist's work, not mine
([ADR-0019](./decisions/0019-requirements-curation-ownership.md)), and it starts once the course page
is captured.

Financial evidence is **out of scope** for this application — a university application requirement is
not a visa requirement ([ADR-0021](./decisions/0021-application-requirements-are-not-visa-requirements.md)) —
with every existing safety control kept.

### 4 · Document requirements, and secure disclosure — 🟡 / ⛔

Built and proven: nothing is transmitted without a `DisclosureAuthorisation` naming the document, its
content hash, the destination host and the purpose. `mayTransmit` re-checks all of that **at the
moment of upload** and refuses on a changed hash, a wrong host, or a withdrawal
([ADR-0022](./decisions/0022-a-document-in-the-vault-is-not-permission-to-send-it.md)).

⛔ **Blocked:** the lawful-basis determination for `disclose_document_to_institution` is not
registered. The register can miss and a missing determination throws — deliberately. It needs a named
determiner, which is one of the decisions in area 5.

Which documents this course requires is part of area 3.

### 5 · Retention policy — ⛔ **and it is a hard stop**

The vault refuses to store any document type with no configured policy. No default, no fallback to
"keep indefinitely" ([ADR-0010](./decisions/0010-policy-driven-document-retention.md),
[ADR-0023](./decisions/0023-retention-periods-are-determined-not-invented.md)).

`pnpm run retention-status` today prints:

> *0 of 10 document types could be stored today. 12 question(s) recorded as unresolved.*

**That is the designed state, and the first real document upload will fail loudly.** Per your
instruction I invented no periods: twelve questions are recorded with the authoritative source that
answers each and an owner field that is empty.

**What I need from you:** a name against those twelve. Then, in this order — (a) is "defending a
legal claim" a purpose we rely on, which moves most of the table; (b) ask QA HE what they require us
to retain, one extra paragraph in the email you are already sending; (c) advice on the three
children's-data entries, where minimisation and Article 7(1) genuinely conflict.

### 6 · Real Application Blueprint — ⛔

The runner is built, tested, and produces a replayable capture. It cannot fill, click or submit
([ADR-0014](./decisions/0014-discovery-cannot-submit.md)).

Run it per [the runbook](./runbook-discovery-handoff.md) — about five minutes — and send the output.
`pnpm run inspect-discovery` then reports what the portal is, where it differs from what the replay
proved, and which of the eight authentication questions the capture leaves open.

Then a specialist reviews the draft against the real portal. Until that happens `checkExecutable`
refuses it and nothing downstream runs. That refusal is the design working.

### 7 · Conversational interview inside the existing AskiMate Chat — ❌ not built

The interview **engine** is built and proven: it derives its worklist from the blueprint rather than
a fixed list, never invents a value, and every stored value is a `ConfirmedValue`.

What does not exist is the integration with AskiMate Chat. The engine is a capability of the existing
chat, not a new interface ([ADR-0015](./decisions/0015-interview-is-a-capability-of-askimate-chat.md)),
and no new interview UI has been built or will be.

A CLI harness stands in for the replay proof. **For a real run with a real applicant, the harness is
not good enough** — they should be talking to AskiMate, not to a terminal. This is mine to build, and
it is the one item on the blocker list that is.

### 8 · Confirmed profile and document extraction — ✅ / 🟡

Profile: proven. A model proposes, the student confirms, and only a confirmation produces a
`ConfirmedValue` — there is no conversion path ([ADR-0004](./decisions/0004-branded-types-for-confirmed-values.md)).

Extraction: built and proven against fixtures. Any reading whose quoted span is not present in the
document is **discarded**, at any confidence ([ADR-0016](./decisions/0016-extraction-must-quote-the-document.md)).

🟡 Unproven against a real model, because of area 17. **Test extraction first** when Bedrock lands: a
model that paraphrases its own quotations will fail every extraction, and it is the cheapest thing to
check and the most likely to surprise.

### 9 · Exact field mapping — ⛔

The package is built and proven. The mapping for *this* portal does not exist and cannot until the
blueprint does.

Someone decides, per required field, whether it comes from a profile field (and in what notation), a
document, a student handoff, or a reviewed constant — and then **a second person reviews it**. A set
signed off by its own author is refused ([ADR-0017](./decisions/0017-mapping-is-reviewed-data.md)).
It is configuration, not code, and `inspect-discovery` prints the exact list of fields it must cover.

### 10 · Validation — ✅

Built and proven. Every value is checked against the portal's own recorded rules before anything is
typed, and a value the portal would reject goes back for a fix rather than forward to authorisation.
Content over a limit goes to the **student** to shorten; it is never truncated for them.

Post-fill verification catches the portal silently truncating or reformatting a value, and
distinguishes the two.

### 11 · Human recovery at the exact failure point — 🟡

Built: the escalation model, the checkpoint on every intervention record, and `failurePointOf`. A run
that stops names where it stopped and what it was doing.

The **transport** — how a specialist is actually alerted, and the console they act in — is modelled,
not built. For one controlled run that is acceptable: a human is in the room, so the alert is "the
person watching notices". It is not acceptable for a second run, and it is not a substitute for the
console ([ADR-0008](./decisions/0008-recovery-first-escalation-and-the-learning-loop.md)).

### 12 · Learning loop, with human validation and publication gates — 🟡

Built: `InterventionRecord`, the reusability assessment, the lifecycle, and the branded
`ReusableResolution` that only `asReusable` can produce — so "this fix can be reused" is a conclusion
reached through the gate, never a flag someone set. `canTransitionLifecycle` enforces the ordering, so
nothing reaches published without having been validated.

Not wired to anything that captures a real run. For the first run, capturing by hand loses nothing.

### 13 · Exact submission preview — ✅

Built and proven. The preview is rendered **deterministically** from the fill plan — not by a model —
and carries a content hash of exactly what will be sent. Documents appear by filename and hash.

### 14 · Explicit student authorisation — ✅

Built and proven. `AuthorisablePreview` is branded and can only come from `checkAuthorisable`. The
authorisation records the verbatim text the student was shown, and it is bound to the content hash:
if anything changes after they approve, the authorisation no longer matches and the run stops.

### 15 · Final submission — deliberately absent

Not built, and it will not be built until you say so. The run stops at `ready_to_submit` and there is
no code path past it. That is the point of the run.

### 16 · Post-submission confirmation and account handover — 🟡 / ❌

Handover is built (area 2) and a case **cannot conclude** until it is done — the student sets their
own password through the portal's own reset flow, confirms they can sign in, and AskiMate retains no
operational access.

Post-submission confirmation capture is **not built**, because there is no submission. It follows
submission, not this run.

### 17 · Real AWS credentials and Bedrock model verification — ⛔

The adapter is built behind the existing LLM port, with **no default model and four separate
workloads** (interview, interpretation, document extraction, navigation), each its own environment
variable. The config throws naming every missing one.

**I could not verify model availability.** The credentials in this environment are placeholders —
`AWS_ACCESS_KEY_ID` begins `prox…`, STS returns `InvalidClientTokenId`, and Bedrock's
`ListFoundationModels` returns `UnrecognizedClientException` in both eu-west-2 and us-east-1. So
[ADR-0018](./decisions/0018-amazon-bedrock-as-the-model-provider.md) names no model, which is the
correct outcome of your instruction not to assume one.

With real credentials, `pnpm run verify-bedrock` prints what the account can actually use against
what each workload needs, and the choice becomes mechanical.

### 18 · QA HE sandbox/UAT, or a genuine consenting applicant — ⛔

[The request is drafted and ready to send](./qa-higher-education-sandbox-request.md), including the
eight authentication questions, what to ask for, and what to do if they decline.

Preferred: a sandbox. Fallback: a real applicant who has given written informed consent, with the
run supervised and stopping before submission. **No fabricated applicant account in a live admissions
system**, which rules out the third option entirely.

---

## Summary table

| # | Area | Status |
|---|---|---|
| 1 | Real portal authentication behaviour | ⛔ discovery |
| 2 | Account ownership and handover | 🟡 built, unproven |
| 3 | Real application requirements | ⛔ curation |
| 4 | Document requirements and secure disclosure | 🟡 / ⛔ lawful basis |
| 5 | Retention policy | ⛔ **hard stop** |
| 6 | Real Application Blueprint | ⛔ discovery |
| 7 | Interview inside AskiMate Chat | ❌ mine to build |
| 8 | Confirmed profile and document extraction | ✅ / 🟡 needs a real model |
| 9 | Exact field mapping | ⛔ needs the blueprint |
| 10 | Validation | ✅ |
| 11 | Human recovery at the failure point | 🟡 transport not built |
| 12 | Learning loop with gates | 🟡 not wired |
| 13 | Exact submission preview | ✅ |
| 14 | Explicit student authorisation | ✅ |
| 15 | Final submission | deliberately absent |
| 16 | Post-submission confirmation and handover | 🟡 / ❌ |
| 17 | AWS credentials and Bedrock model verification | ⛔ |
| 18 | Sandbox or consenting applicant | ⛔ |

---

## What is *not* blocking, and why

| | Status | Why it does not block one controlled run |
|---|---|---|
| **Persistence (Postgres)** | In-memory | A supervised run in one sitting survives it. It does not survive a crash, and it does not survive the applicant going away for two days to find their passport — so it blocks the *second* run, not the first. |
| **Specialist console** | Modelled | A human is watching, so the alert is "the person in the room notices". |
| **AWS infrastructure** | None, $0 spent | Not needed. The run happens on a laptop. |

---

## The sequence, once the blockers clear

1. Discovery output arrives → `inspect-discovery` → **real draft blueprint**, and the eight
   authentication questions answered as far as a capture can
2. The sandbox answers questions 2, 3, 7 and 8 → **the authentication approach is chosen**, from
   observations rather than in advance
3. Specialist reviews the blueprint → **executable blueprint**
4. Specialist authors, and a second reviews, the mapping set → **usable mapping set**
5. Bedrock verified, models chosen, extraction spot-checked against a real document
6. **Replay the captured real portal and run the whole chain against it, offline**
7. Retention schedule v1 configured, covering every document the run will touch
8. Lawful-basis determination registered
9. AskiMate Chat carries the interview
10. **Then** the live run — supervised, stopping before submit, with your explicit approval at that
    point

Step 6 is the one worth insisting on. It costs nothing, it is repeatable, and it is where every
mismatch between the fixture and the real portal will surface — on a laptop rather than in a real
admissions system.

---

## Must be true during the run, whatever else changes

- The applicant's **own** email is the account's address, and stays the official contact
- The authentication approach came from `chooseApproach` over real observations — not a default
- Any credential we hold was **generated**, expires, and is destroyed at handover
- Nothing bypasses MFA, CAPTCHA, email verification, payment, a legal declaration, or an
  account-ownership control. Each is a handoff to the applicant.
- Every upload carries a `DisclosureAuthorisation` naming the document, its hash, the destination and
  the purpose
- The run **stops** at `ready_to_submit`
- A named specialist is watching and able to stop it
- The applicant is present or reachable, for handoffs and to approve the content

And afterwards: the account is handed back, they confirm they can sign in, and AskiMate retains no
operational access. **The case cannot conclude until that is done** — that is a gate, not a promise.
