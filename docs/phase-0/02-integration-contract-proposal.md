# Phase 0 · Deliverable 2 — Integration Contract Proposal

**Date:** 2026-08-26
**Status:** Proposal — requires Vahid's decision
**Depends on:** [01 — Existing System Inventory](./01-existing-system-inventory.md)

---

## 0. The constraint that shapes everything

From Deliverable 1:

- **AskiMate runs on Replit.** Not a GCP project we control. There is no VPC to peer, no IAM to
  federate, no private link to establish.
- **AAS will run on AWS.**
- **AskiMate has no student profile beyond name/email/mobile/DOB, and no document vault at all.**
- **The live askimate.com codebase is not available to me.** I have the pre-split archive only.

The first two points mean the boundary is necessarily **public-internet HTTPS with
application-level authentication**. That is not a compromise — given two managed platforms with
limited network control, it is also the cleanest and most testable option.

The third point is the important one, and I want to state it plainly before the options, because
it changes what "sharing the profile" even means:

> **There is almost nothing to share.** AskiMate holds a name, a verified email, a mobile
> number, and a free-text date of birth. It holds no qualifications, no grades, no test scores,
> no passport data, no financial evidence, and no documents. Any integration option that is
> framed around "how do we sync the profile" is solving a problem that does not exist yet.

The real question is therefore not *how do we share data* but *who owns the confirmed profile*.
I have a firm recommendation on that, in §2.

---

## 1. The three things the contract must do

1. **Trigger** — AskiMate tells AAS that a student has explicitly asked to apply.
2. **Status** — AAS tells AskiMate what is happening to the case, durably.
3. **Data** — the student's profile and documents are available to AAS.

Product rule 1 constrains (1) absolutely: *explicit request before consequential action; silence
is not consent.* Whatever the transport, the trigger payload must carry **evidence of an
explicit student request** — not merely the fact that AskiMate decided to call the endpoint. I
have made that a required, non-nullable field in every option below.

---

## 2. The architectural decision underneath the options

**Recommendation: AAS is the system of record for the application profile. AskiMate's data
enters only as an unconfirmed seed hint.**

This is not a preference. It follows from product rule 3 — *extract, then confirm, then store;
only confirmed information enters the profile* — plus a fact from Deliverable 1:

`askimate_users.dateOfBirth` is a **nullable, free-text, unvalidated `TEXT` column.** Nobody
confirmed it. Nobody validated its format. It may be `"1999-04-02"`, `"2 April 1999"`, `"02/04/99"`,
or empty.

Now consider product rule 6: *minors are detected from date of birth and trigger a parental
consent flow.* If AAS imports that column as confirmed profile data, then:

- an ambiguous `02/04/99` could be read as April 2nd or February 4th;
- a null could be silently treated as "not a minor";
- and the parental-consent flow — a legal safeguard — would be skipped on the strength of a
  field nobody ever checked.

**Copying unconfirmed data into a confirmed-only store defeats the entire premise of the
system.** So:

| Data | Direction | Status on arrival in AAS |
|---|---|---|
| `student_ref` (opaque AskiMate id) | AskiMate → AAS | Confirmed identity link |
| Email | AskiMate → AAS | **Seed hint.** Verified for *login*; must be separately confirmed as the official application contact (rule 7). |
| First/last name | AskiMate → AAS | **Seed hint.** Pre-fills the confirm step; is not itself confirmed. |
| Date of birth | AskiMate → AAS | **Seed hint, explicitly untrusted.** Must be re-confirmed in ISO-8601. If it cannot be parsed unambiguously, AAS asks. It never assumes adult. |
| Mobile | AskiMate → AAS | Seed hint. |
| Everything else | — | Does not exist. AAS collects it. |
| All documents | — | Does not exist. AAS owns the vault outright. |

Seed hints arrive in a dedicated `seed_hints` object, typed distinctly from confirmed profile
fields, so no code path can mistake one for the other. Same principle as §3.1 of the brief,
applied to the integration boundary.

**The upside for Vahid:** this makes AAS's correctness independent of AskiMate's data quality.
AskiMate can change its schema freely and never break an application submission.

---

## 3. Option A — Shared database

AAS connects directly to AskiMate's Postgres. Reads student rows; writes case rows into new
tables in the same database.

**How the three needs are met:** trigger = AskiMate inserts a row AAS polls for; status =
AskiMate reads AAS's tables; data = direct SQL.

| | |
|---|---|
| ✅ | Fastest to build. No API, no auth handshake, no serialisation. |
| ✅ | No data duplication or sync problem. |
| ❌ | **Couples two systems at their most brittle layer.** Any AskiMate schema change can break a live application submission. |
| ❌ | **Cross-cloud database access.** AWS compute → a Replit-managed Postgres over the public internet, credentials in both places. Latency and availability now depend on a link neither system controls. |
| ❌ | **Violates the brief's §8 isolation requirement.** Browser automation runs untrusted page content and "must have no access to application secrets or the primary database." A shared database makes the strongest isolation boundary in the design much harder to hold. |
| ❌ | **Blast radius.** A bug in AAS can corrupt live AskiMate user records. |
| ❌ | **Unauditable.** Two writers, one table, no single ordering — the append-only event log stops being authoritative. |
| ❌ | Cannot be tested against fixtures; needs a live database to exercise the boundary. |

**Verdict: reject.** I would not build this even under time pressure. It trades a week of work
for a permanent, compounding coupling in the highest-stakes part of the system.

---

## 4. Option B — HTTPS API + signed webhooks *(recommended)*

AAS exposes a small, versioned, authenticated HTTPS API. AskiMate calls it to open a case. AAS
calls an AskiMate webhook on every state change. A pull endpoint exists for reconciliation and is
the authoritative source.

```
  AskiMate (Replit)                              AAS (AWS)
  ─────────────────                              ─────────
  student explicitly asks to apply
        │
        │  POST /v1/application-cases
        │  Authorization: HMAC-SHA256 …
        │  Idempotency-Key: <uuid>
        ├────────────────────────────────────────▶  validate · dedupe · create case
        │                                           emit CaseCreated to event log
        │  ◀────────────────────────────────────┤  201 { case_id, state, event_seq }
        │
        │                                        ┌── case progresses (worker, hours→weeks)
        │  POST {askimate}/hooks/aas             │
        │  X-AAS-Signature: HMAC-SHA256 …        │
        │  ◀────────────────────────────────────┤  at-least-once, per state transition
        │  200                                   └──
        │
        │  GET /v1/application-cases/{id}         ← reconciliation. THE source of truth.
        ├────────────────────────────────────────▶
        │  ◀────────────────────────────────────┤  { state, event_seq, tasks[], blocked_on }
```

### 4.1 Trigger

```http
POST /v1/application-cases
Authorization: HMAC-SHA256 keyId=askimate-prod, signature=…, ts=…
Idempotency-Key: 9f2c…            ← required
Content-Type: application/json

{
  "student_ref": "askimate:user:4812",

  "request_evidence": {                        ← REQUIRED. Product rule 1.
    "requested_at": "2026-08-26T10:14:22Z",
    "channel": "askimate_chat",
    "conversation_ref": "askimate:conversation:9931",
    "message_ref": "askimate:message:71204",
    "student_statement": "Yes, please apply to Leeds for me."
  },

  "intent": {
    "institution": "University of Leeds",
    "course": "MSc Data Science and Analytics",
    "intake": "2027-09"
  },

  "seed_hints": {                              ← UNCONFIRMED. Never enters the profile directly.
    "email": "…", "first_name": "…", "last_name": "…",
    "date_of_birth_raw": "02/04/99",           ← deliberately named _raw
    "mobile": "…"
  }
}
```

`request_evidence` is non-nullable and structurally required. **AAS refuses to open a case
without it** (`422`). That turns product rule 1 from a policy into an enforced precondition, and
it means every case can answer "who asked for this, when, and in what words?" from stored data
alone — which is also what the brief's §4 audit requirement demands.

`Idempotency-Key` makes a retried or double-clicked trigger a no-op returning the same
`case_id`. Duplicate *case creation* is prevented here; duplicate *submission* is prevented
separately and more strictly inside the domain (Phase 1 / Phase 6).

### 4.2 Status — webhook push, pull as truth

Webhook on every transition:

```json
{ "case_id": "…", "event_seq": 47, "state": "AWAITING_STUDENT_AUTHORISATION",
  "occurred_at": "…", "blocked_on": { "kind": "authorisation_required", "handoff_url": "https://…" } }
```

- Signed `X-AAS-Signature` (HMAC-SHA256 over raw body + timestamp), replay window enforced.
- **At-least-once**, with exponential backoff and a DLQ. AskiMate must treat handlers as idempotent.
- `event_seq` is monotonic per case, so AskiMate can discard out-of-order deliveries.

**And a pull endpoint that is the authority:**

```http
GET /v1/application-cases/{case_id}
GET /v1/application-cases?student_ref=…&updated_since=…
```

This matters more than it looks. **Replit restarts and redeploys.** From Deliverable 1 §7 we
know AskiMate has no durable queue — a webhook arriving during a redeploy is simply lost, with
no retry queue on the receiving side to catch it. Webhooks alone would silently desynchronise.
So: **webhooks are an optimisation for latency; the pull endpoint is the contract.** AskiMate
reconciles on a schedule and after every restart. This is the single most important resilience
decision in the integration, and it exists specifically because of what the inventory found.

### 4.3 Data

Per §2 — `student_ref` plus seed hints at creation. AAS owns the confirmed profile and the
document vault. **No document ever transits AskiMate**: students upload directly to AAS via
short-lived pre-signed S3 URLs. Passports and bank statements never touch Replit's disk, never
appear in AskiMate's logs, and stay inside the KMS-encrypted vault. That is both simpler and
materially better for GDPR.

### 4.4 Authentication

Shared-secret **HMAC request signing** in both directions, secrets in AWS Secrets Manager and
Replit Secrets, rotatable via overlapping `keyId`s. Chosen over mTLS (Replit gives limited
control over client certificates) and over a bearer token (a signature also covers body
integrity and replay).

| | |
|---|---|
| ✅ | Clean, explicit, versioned boundary. Either side can be rewritten independently. |
| ✅ | **Works regardless of what askimate.com is written in** — which matters, because I have not seen it. |
| ✅ | Fully testable from recorded fixtures; no live systems needed in CI. |
| ✅ | Enforces product rule 1 structurally via `request_evidence`. |
| ✅ | Documents bypass AskiMate entirely — smaller PII surface, simpler compliance. |
| ✅ | Survives Replit restarts through pull-based reconciliation. |
| ⚠️ | Requires AskiMate-side work: an outbound signed client, a webhook receiver, a reconciliation poller. **Estimate: 2–4 days**, contingent on seeing that codebase. |
| ⚠️ | Two secrets to manage and rotate. |

### 4.5 What AskiMate must build

Small, and worth stating precisely so it can be scheduled:

1. An outbound HMAC-signing client (~1 file).
2. `POST /hooks/aas` — verify signature, upsert cached case state by `event_seq`, return 200 fast.
3. A reconciliation poller — `GET /v1/application-cases?updated_since=…` on a timer and after boot.
4. A UI surface showing case state and any `handoff_url` the student must act on.

---

## 5. Option C — Queue-based (SQS both directions)

AskiMate publishes trigger messages to an SQS queue; AAS consumes. AAS publishes state changes
to a second queue; AskiMate polls.

| | |
|---|---|
| ✅ | Durable and decoupled by construction; no lost messages across restarts. |
| ✅ | No public inbound API surface on AAS. |
| ✅ | Natural fit with the SQS the worker fleet already needs. |
| ❌ | **Replit must hold long-lived AWS credentials** and run a poller — but Deliverable 1 §7 shows AskiMate has no worker process at all, only in-process `setInterval`. Building one is *more* work than an HTTP handler, not less. |
| ❌ | **No synchronous response.** AskiMate cannot tell the student "your case is open" — it must publish and wait, complicating the UX at the exact moment the student expects confirmation. |
| ❌ | Harder to debug and to demo; no `curl` equivalent. |
| ❌ | Couples AskiMate's deployment to AWS credentials and SDK versions. |

**Verdict: right mechanism, wrong boundary.** SQS is exactly correct *inside* AAS, between the
orchestrator and its workers — and that is where the design uses it. Pushing it out to the
Replit edge imports AWS coupling into a system that should stay ignorant of AWS.

---

## 6. Recommendation

**Option B — HTTPS API + signed webhooks + authoritative pull reconciliation.**

Reasoning, in order of weight:

1. **It is robust to what I do not know.** Option B works whatever askimate.com turns out to be.
   Given I could not read that codebase, an option that depends least on its internals is worth
   real weight — this is a decision made under acknowledged uncertainty, and B is the one that
   stays correct if the uncertainty resolves badly.
2. **It enforces product rule 1 in the type system**, not in a policy document.
3. **It keeps student documents off Replit entirely** — smaller PII surface, better GDPR story.
4. **It survives the restart behaviour the inventory actually found**, via pull reconciliation.
5. **It preserves the isolation the brief requires**, which Option A structurally undermines.
6. **It is the cheapest to test.** Fixtures on both sides; no live dependency in CI.

Option A is rejected on coupling and blast radius. Option C is the right idea in the wrong
place — adopted internally, declined at the boundary.

---

## 7. What I need from Vahid

Two decisions, and one piece of access. Details and priority in
[05 — Open Questions](./05-open-questions.md).

1. **Approve Option B** (or tell me which trade-off you disagree with).
2. **Confirm AAS is the system of record for the confirmed profile** (§2). This is the load-bearing
   decision — most of Phase 2 rests on it.
3. **Read access to the live askimate.com repository.** Needed to finalise exact endpoint shapes
   and to size the AskiMate-side work honestly. **This does not block Phase 1.**

---

## 8. Explicitly out of scope

Per brief §2.8 — MVP responsibility ends at submission confirmation. The contract deliberately
contains **no** inbox integration, no email parsing, no proactive journey tracking, and no
post-submission status polling beyond `checkStatus` on the adapter interface. `GET
/v1/application-cases` is designed to extend to those later without a breaking change, but they
are not being built.

---

*Deliverable 2 of 5. Continue to [03 — Repository and Project Structure](./03-repository-structure-proposal.md).*
