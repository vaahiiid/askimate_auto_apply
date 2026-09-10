# What a controlled live run still needs

**Date:** 2026-08-26 · **Revised:** 2026-09-10 (P76), against the code and the ADRs as they stand
**Scope:** one real application, on the real portal, **stopping before submission**.
**Target:** the first blueprint's target is the University of Sheffield, PGT, September intake,
direct application — Vahid's selection of 2026-09-08, recorded in
[`target-sheffield-pgt.md`](./target-sheffield-pgt.md) *"for the blueprint phase, not for the
transport phase"*. The controlled run's own target is his to restate; this document does not.

The 2026-08-26 text is in the git history at that revision. It was written against a replay and an
in-memory store; most of what it called unproven has since been built and proved against real
PostgreSQL, real Redis, a real browser and a served fixture portal — and none of it has yet met a
real university's portal. That last sentence is the whole of what this revision changes: the rows
below say *built and proved against the fixture*, not *proved*, wherever that is the truth.

Nothing has been marked done because it is "basically done". Where a row says **built, unproven
against a real portal**, the difference is the point of the exercise.

---

## The short version

**Five things block it. Four are yours; one is mine and waits on access.**

| | Blocker | Whose | Area |
|---|---|---|---|
| 1 | **Real portal discovery** — nothing downstream is real until this exists. Vahid's precondition stands: *"Do not run discovery against the live portal until you tell me what a discovery run would actually do to it."* The measurement is in the target file; **no run has been made** | Yours to run | 1, 3, 6 |
| 2 | **Specialist review** of the blueprint, then a mapping set reviewed by a second person | Yours | 6, 9 |
| 3 | **Bedrock credentials**, then the four model IDs | Yours | 8, 17 |
| 4 | **An account** — a sandbox, or a consenting applicant — and **the vault's bucket** (blocker 17 in the state document: the service role, the CORS rule, the lifecycle). *"AWS spend stays my act."* | Yours | 4, 18 |
| 5 | **The AskiMate production integration** for the conversation | Mine, once there is access (state document, blocker 10) | 7 |

Two that were on the 2026-08-26 list are off it: the twelve retention determinations
([ADR-0078](./decisions/0078-documents-are-held-and-reused.md), Vahid,
2026-09-07) and the lawful-basis determination for disclosure
([ADR-0087](./decisions/0087-the-four-lawful-basis-determinations.md),
Vahid, 2026-09-08).

---

## The eighteen areas

Legend: **✅ built and proved** against the fixture portal, real stores and a real browser ·
**🟡 built, unproven** against a real portal · **⛔ blocked** · **❌ not built**

### 1 · Real portal authentication behaviour — ⛔

**Blocked on discovery.** No run has been made against any live site, and none will be until Vahid
says so.

What exists: the *shape* of the answer, typed. `ObservedPortalAuthentication` has one field per
question, and `chooseApproach` refuses until all eight are answered — an unobserved answer is not a
"no" ([ADR-0020](./decisions/0020-the-account-belongs-to-the-student.md)). Since 2026-08-26 the runner
also *meets* two of the answers rather than only recording them: a CAPTCHA or a second factor met on
any page stops the run and says which ([ADR-0101 §6](./decisions/0101-the-yes-comes-first-and-a-runner-is-signed-in-for-one-sitting.md),
P70), and the two preconditions Vahid set for any live request — `robots.txt` read, obeyed and
kept, and a one-second floor on request pacing — are built and cannot be lowered
([ADR-0091](./decisions/0091-robots-txt-is-read-obeyed-and-kept.md), P58).

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

Built, and proved against the fixture portal in a real browser: the account's email is a
`ConfirmedValue` (there is no path that puts an AskiMate address there); the password is typed by the
student into the Secure Plane's own frame and this plane never holds it
([ADR-0034](./decisions/0034-the-vault-is-ephemeral.md)); the yes
comes *before* the password box and the account ([ADR-0101](./decisions/0101-the-yes-comes-first-and-a-runner-is-signed-in-for-one-sitting.md),
P69); the runner keeps its signed-in context in memory for five minutes and no longer
([ADR-0101 §2](./decisions/0101-the-yes-comes-first-and-a-runner-is-signed-in-for-one-sitting.md), P71); a lost
session asks the student for their password a second time, once, as the resume path only, and says
why (§3, P72); handover is all-or-nothing and a case cannot conclude while an account is outstanding
([ADR-0050](./decisions/0050-the-account-lifecycle-completes-through-the-students-own-decision.md),
P12). The system has **no capability to read a mailbox**, enforced by the dependency-boundary check.

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
with every existing safety control kept, and the line that guards the visa path has no caller
(P46).

### 4 · Document requirements, and secure disclosure — 🟡 / ⛔

Built and proved end to end against the fixture portal (P57–P66, P73–P75): a document enters through
a pre-signed upload the student's own page makes, is hashed and bound before the port moves
([ADR-0092](./decisions/0092-the-document-never-enters-a-process-we-run.md),
[ADR-0093](./decisions/0093-an-upload-url-cannot-be-minted-unbound.md)); nothing is transmitted
without a `DisclosureAuthorisation` naming the document, its content hash, the destination host and
the purpose, and `mayTransmit` re-checks all of that **at the moment of upload** — on both sides of
the plane boundary — and refuses on a changed hash, a wrong host, a different case or a withdrawal
([ADR-0022](./decisions/0022-a-document-in-the-vault-is-not-permission-to-send-it.md),
[ADR-0069](./decisions/0069-an-authorisation-is-spendable-only-in-the-application-it-names.md)). The preview names each
attachment — which document, going where, for what — and the destination is inside the hash the
student says yes to ([ADR-0098](./decisions/0098-one-yes-over-a-preview-that-names-each-attachment-and-a-closed-set-of-refusals.md)).
One `attach_document` intent per upload, and a record of what left (P73). The runner has attached a
held passport to a served page and the portal held the same hash (P74).

The lawful-basis determination for `disclose_document_to_institution` is **registered**
([ADR-0087](./decisions/0087-the-four-lawful-basis-determinations.md),
Vahid, 2026-09-08), and the same register is wired in the Conversation Service and the runner —
in code, not on the wire.

⛔ **Blocked on the vault's bucket:** the production transport needs the service role, the CORS rule
and the lifecycle ([`provisioning-request-document-vault.md`](./provisioning-request-document-vault.md);
state document blocker 17). Until then the service starts without the transport and answers 503, and
the attachment path is proved against a vault stand-in. Which documents this course requires is part
of area 3.

### 5 · Retention policy — 🟡, no longer a stop

The vault still refuses to store any document type with no configured policy, with no default
([ADR-0010](./decisions/0010-policy-driven-document-retention.md),
[ADR-0023](./decisions/0023-retention-periods-are-determined-not-invented.md)). What changed is that
the periods are now **determined**: schedule `1.2026-09-07`, approved by Vahid Mohammadi, sets a
period for ten of the eleven document/purpose pairs in scope
([ADR-0078](./decisions/0078-documents-are-held-and-reused.md)). The
one unresolved pair is `bank_statement / financial_evidence`, which is **out of scope** for this run
(ADR-0021) and is recorded so that it blocks rather than goes missing.

`pnpm run retention-status` today prints:

> *10 of 11 pairs have a RETENTION POLICY today. 1 question(s) recorded as unresolved.*

A retention policy is not permission to store: `assertStorable` also requires the registered lawful
basis for the storing activity, which ADR-0087 supplied. Both gates are open for every document this
run will touch.

### 6 · Real Application Blueprint — ⛔

The discovery runner is built, tested, and produces a replayable capture. It cannot fill, click or
submit ([ADR-0014](./decisions/0014-discovery-cannot-submit.md)); it reads and obeys `robots.txt`
and paces itself (ADR-0091). What one run would do to Sheffield's site — how many requests, no
account, nothing submitted — is measured from the code in the target file, per Vahid's precondition.

Run it per [the runbook](./runbook-discovery-handoff.md) and send the output. `pnpm run
inspect-discovery` then reports what the portal is, where it differs from what the fixture proved,
and which of the eight authentication questions the capture leaves open.

Then a specialist reviews the draft. Since P20 the review binds to the content
([ADR-0057](./decisions/0057-approval-binds-to-content-not-to-claims.md)): the reviewed entry is
hashed, and the same reviewed blueprint can be run against a UAT deployment through
`portalOrigin` without the hash — or the review — changing. Until a review exists `checkExecutable`
refuses the draft and nothing downstream runs. That refusal is the design working.

### 7 · Conversational interview — 🟡 in the Conversation Service's own page; ❌ in AskiMate

The interview **engine** is built and proved: it derives its worklist from the blueprint rather than
a fixed list, never invents a value, and every stored value is a `ConfirmedValue`. And the student
no longer talks to a terminal: the Conversation Service serves the student's page from its own
origin ([ADR-0060](./decisions/0060-the-conversation-service-owns-the-student-surface.md),
P25), the run's question reaches them there ([ADR-0062](./decisions/0062-the-question-the-run-is-waiting-on-is-in-the-log.md),
P26), their decision to stop reaches the system ([ADR-0064](./decisions/0064-the-interviews-decision-to-stop-reaches-the-system.md),
P28), and the journey test drives the whole chain through that page in a real browser.

What does not exist is the integration with AskiMate Chat itself
([ADR-0015](./decisions/0015-interview-is-a-capability-of-askimate-chat.md); state document blocker
10). ADRs 0001–0002 describe it and are Accepted; it needs access to the production system, then me.

**And the interview's model is the deterministic stand-in in every code path of the service.**
Found 2026-09-10 (P79): `apps/conversation-service/src/wiring.ts` constructs
`DeterministicModelClient` unconditionally. There is no code path in the service that builds a
Bedrock client, with or without credentials; only the demonstration scripts and `verify-bedrock`
do. So blocker 3 (credentials, then four model IDs) is necessary and not sufficient: the service
also needs the adapter wired behind the port, which is mine. Vahid: *"It does not change this path,
but it is a gap between what the system is and what I would have said it was."* Recorded here so
the checklist says what the system is.

### 8 · Confirmed profile and document extraction — ✅ / 🟡

Profile: proved. A model proposes, the student confirms, and only a confirmation produces a
`ConfirmedValue` — there is no conversion path ([ADR-0004](./decisions/0004-branded-types-for-confirmed-values.md)).

Extraction: built and proved against fixtures. Any reading whose quoted span is not present in the
document is **discarded**, at any confidence ([ADR-0016](./decisions/0016-extraction-must-quote-the-document.md)).

🟡 Unproven against a real model, because of area 17 — and because the service has no path to one:
see area 7. **Test extraction first** when Bedrock lands: a model that paraphrases its own
quotations will fail every extraction, and it is the cheapest thing to check and the most likely to
surprise.

### 9 · Exact field mapping — ⛔

The package is built and proved. The mapping for *this* portal does not exist and cannot until the
blueprint does.

Someone decides, per required field, whether it comes from a profile field (and in what notation), a
document, a student handoff, or a reviewed constant — and then **a second person reviews it**. A set
signed off by its own author is refused ([ADR-0017](./decisions/0017-mapping-is-reviewed-data.md)).
It is configuration, not code, hashed with the blueprint it belongs to (ADR-0057), and
`inspect-discovery` prints the exact list of fields it must cover.

### 10 · Validation — ✅

Built and proved. Every value is checked against the portal's own recorded rules before anything is
typed, and a value the portal would reject goes back for a fix rather than forward to authorisation.
Content over a limit goes to the **student** to shorten; it is never truncated for them.

Post-fill verification catches the portal silently truncating or reformatting a value, and
distinguishes the two.

### 11 · Human recovery at the exact failure point — 🟡

Built: the escalation model, the checkpoint on every intervention record, `failurePointOf`, and the
stop itself — a run only a person can carry on stops, says so in the conversation, and takes the
student's messages while it waits ([ADR-0065](./decisions/0065-a-run-only-a-person-can-carry-on-stops-and-says-so.md),
P29, P40). Every intent a runner attempts is in a ledger before the attempt, so a crash mid-action
is a known unknown rather than a silent one ([ADR-0054](./decisions/0054-the-intent-is-durable-before-the-action.md)).

The **notice** is built: the Background Worker sends a `SpecialistNotice` to a configured webhook,
once per open intervention, carrying identifiers and nothing about the student
([ADR-0071](./decisions/0071-a-stopped-run-reaches-a-person.md),
P14). Not configuring it is a valid deployment. The **resolution** is built as
[ADR-0048](./decisions/0048-a-specialist-resolution-completes-an-intent.md) chose it: an internal
route on the Conversation Service (`GET /internal/v1/interventions`, `POST …/:id/resolution`) and
`pnpm run interventions` as its first interface — the CLI is a client of the route and never opens
the database, so the service stays the one writer. A resolution completes the intent that could not
be completed and the run resumes from the failure point, not from the start.

What is *not* built is authenticated specialist identity: whoever holds the service credential can
run the CLI, and `--specialist` is **asserted, not authenticated**. Vahid approved that on 2026-09-01
*"for the current controlled single-operator model"* and named what ends it: *"The moment we
introduce multiple specialists, authenticated individual identity becomes a required architectural
capability, not a deferred cosmetic improvement."* For one controlled run with one operator that is
the approved state (state document, blocker 11). A specialist-facing console beyond the CLI is not
built and not needed for it.

### 12 · Learning loop, with human validation and publication gates — 🟡

Built: `InterventionRecord`, the reusability assessment, the lifecycle, and the branded
`ReusableResolution` that only `asReusable` can produce — so "this fix can be reused" is a conclusion
reached through the gate, never a flag someone set. `canTransitionLifecycle` enforces the ordering, so
nothing reaches published without having been validated.

Still not wired to anything that captures a real run: `asReusable` has no caller outside the domain
package. For the first run, capturing by hand loses nothing.

### 13 · Exact submission preview — ✅

Built and proved. The preview is rendered **deterministically** from the fill plan — not by a model —
and carries a content hash of exactly what will be sent. It names each attachment plainly: which
document, going where, for what (ADR-0098). It names the portal host for every application, and the
host is inside the hash — where the bytes actually go, which is the deployment's host when the entry
names one (ADR-0098 as amended in P74; [ADR-0059](./decisions/0059-the-student-can-read-what-they-are-authorising.md)
as amended in P75). The student reads it over a route from their own page (ADR-0059).

### 14 · Explicit student authorisation — ✅

Built and proved. `AuthorisablePreview` is branded and can only come from `checkAuthorisable`. The
authorisation records the verbatim text the student was shown, bound to the content hash: if
anything changes after they approve — a value, a document, or the host the run is pointed at — the
authorisation no longer matches and the run stops at the yes again (P74, P75). The yes comes first:
a student is not asked for a portal password for an account they have not yet agreed to have created
(ADR-0101, P69). A second application is a second yes, never a reuse ([ADR-0069](./decisions/0069-an-authorisation-is-spendable-only-in-the-application-it-names.md)).

### 15 · Final submission — deliberately absent

Not built, and it will not be built until Vahid says so. The run stops at `ready_to_submit` and there
is no code path past it. That is the point of the run.

### 16 · Post-submission confirmation and account handover — 🟡 / ❌

Handover is built (area 2) and a case **cannot conclude** until it is done — the student sets their
own password through the portal's own reset flow, confirms they can sign in, and AskiMate retains no
operational access. The `hand_over_account` step is reached in the journey once every page is saved
and every document accounted for.

Post-submission confirmation capture is **not built**, because there is no submission. It follows
submission, not this run.

### 17 · Real AWS credentials and Bedrock model verification — ⛔

The adapter is built behind the existing LLM port, with **no default model and four separate
workloads** (interview, interpretation, document extraction, navigation), each its own environment
variable. The config throws naming every missing one.

Model availability has not been verified from this environment, whose credentials are placeholders;
[ADR-0018](./decisions/0018-amazon-bedrock-as-the-model-provider.md) still names no model, which is
the correct outcome of Vahid's instruction not to assume one. With real credentials, `pnpm run
verify-bedrock` prints what the account can actually use against what each workload needs, and the
choice becomes mechanical — and his, not the script's. Nothing is run against AWS without telling
him first.

### 18 · A sandbox, or a genuine consenting applicant — ⛔

[The QA Higher Education request is drafted](./qa-higher-education-sandbox-request.md), including the
eight authentication questions. Vahid has since selected Sheffield as the first blueprint's target
([`target-sheffield-pgt.md`](./target-sheffield-pgt.md)); whether that changes who is asked for an
account is his.

Preferred: a sandbox. Fallback: a real applicant who has given written informed consent, with the
run supervised and stopping before submission. **No fabricated applicant account in a live admissions
system**, which rules out the third option entirely.

---

## Summary table

| # | Area | Status |
|---|---|---|
| 1 | Real portal authentication behaviour | ⛔ discovery |
| 2 | Account ownership and handover | 🟡 built, unproven on a real portal |
| 3 | Real application requirements | ⛔ curation |
| 4 | Document requirements and secure disclosure | 🟡 built and proved on the fixture · ⛔ the vault's bucket |
| 5 | Retention policy | 🟡 determined; no longer a stop |
| 6 | Real Application Blueprint | ⛔ discovery |
| 7 | Conversational interview | 🟡 in the service's own page, on the deterministic stand-in · ❌ in AskiMate · ❌ no Bedrock path in the service |
| 8 | Confirmed profile and document extraction | ✅ / 🟡 needs a real model, and the service wired to one |
| 9 | Exact field mapping | ⛔ needs the blueprint |
| 10 | Validation | ✅ |
| 11 | Human recovery at the failure point | 🟡 notice and resolution built; identity asserted |
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
| **Persistence** | Real: PostgreSQL for cases, conversations, runs, intents and document metadata; Redis for the Secure Plane's envelope cache | A run survives a restart, and the journey proves it resuming on the second page after one (ADR-0049, P11; ADR-0052, P14). The 2026-08-26 row said "in-memory"; it no longer is. |
| **Specialist console** | Notice built (ADR-0071); resolution built as an internal route and an operator CLI (ADR-0048); identity asserted, not authenticated | A human is watching, the worker tells them, and they resolve through the service with `pnpm run interventions`. One operator holds the credential, which is the scope Vahid approved. |
| **AWS infrastructure** | One bucket exists, created and verified by Vahid on 2026-09-09 for the checksum binding (state document, blocker 16); the production vault is blocker 17 | The run's own documents need blocker 17. Everything else happens on a laptop. Nothing is provisioned by this repository. |

---

## The sequence, once the blockers clear

1. Discovery output arrives → `inspect-discovery` → **real draft blueprint**, and the eight
   authentication questions answered as far as a capture can — and Sheffield's shape (three cases,
   or one with three targets) reported *before* anything in the model changes
2. The sandbox answers questions 2, 3, 7 and 8 → **the authentication approach is chosen**, from
   observations rather than in advance
3. Specialist reviews the blueprint → **executable blueprint**, hashed (ADR-0057)
4. Specialist authors, and a second reviews, the mapping set → **usable mapping set**
5. Bedrock verified, models chosen by Vahid, extraction spot-checked against a real document
6. **Run the whole chain against the reviewed blueprint through a `portalOrigin` pointed at a replay
   or a UAT deployment, offline** — the preview names that host, and the student's yes covers it
7. ~~Retention schedule v1~~ — done (ADR-0078)
8. ~~Lawful-basis determination registered~~ — done (ADR-0087)
9. The vault's bucket provisioned (blocker 17) — Vahid's act
10. **Then** the live run — supervised, stopping before submit, with Vahid's explicit approval at
    that point

Step 6 is the one worth insisting on. It costs nothing, it is repeatable, and it is where every
mismatch between the fixture and the real portal will surface — on a laptop rather than in a real
admissions system.

---

## Must be true during the run, whatever else changes

- The applicant's **own** email is the account's address, and stays the official contact
- The authentication approach came from `chooseApproach` over real observations — not a default
- The applicant's portal password is typed by them into the Secure Plane's frame, held for at most
  five minutes, and never stored (ADR-0034, ADR-0101)
- Nothing bypasses MFA, CAPTCHA, email verification, payment, a legal declaration, or an
  account-ownership control. Each is a stop, named, and a handoff to the applicant.
- Every upload carries a `DisclosureAuthorisation` naming the document, its hash, the destination and
  the purpose — checked again at the moment of attaching, on the runner's side
- The preview the applicant says yes to names the host the bytes go to, and the run stops at the yes
  again if that changes
- The run **stops** at `ready_to_submit`
- A named specialist is watching and able to stop it
- The applicant is present or reachable, for handoffs and to approve the content

And afterwards: the account is handed back, they confirm they can sign in, and AskiMate retains no
operational access. **The case cannot conclude until that is done** — that is a gate, not a promise.
