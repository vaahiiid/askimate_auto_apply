# Phase 0 · Deliverable 5 — Open Questions

**Date:** 2026-08-26
**Ordered by:** what blocks Phase 1 first, then Phase 2, then Phase 3, then later.

---

## The good news first

**Almost nothing blocks Phase 1.**

The brief designed Phase 1 to be *"entirely internal, fully testable with no external systems"* —
and the inventory confirms that holds. The domain core needs no AskiMate access, no AWS account,
no credentials, no target university, and no legal answers. Docker Postgres on a laptop is
sufficient.

There are exactly **three** questions I need answered before writing Phase 1 code, and two of
them are approvals rather than research. Everything else can be answered while Phase 1 is
underway.

---

## Tier 1 — Blocks Phase 1

### Q1. Do you approve the three structural decisions in this report?

| # | Decision | Where | Why it is load-bearing |
|---|---|---|---|
| a | **Integration = Option B** (HTTPS API + signed webhooks + pull reconciliation) | [02 §6](./02-integration-contract-proposal.md) | Determines what Phase 1's case model must expose. |
| b | **AAS is the system of record for the confirmed profile**; AskiMate data enters only as unconfirmed seed hints | [02 §2](./02-integration-contract-proposal.md) | The whole of Phase 2 rests on this. |
| c | **Repository structure + the divergences from Universitio** (strict TS, versioned migrations, CI from commit #1) | [03 §2, §6](./03-repository-structure-proposal.md) | Cheap now; painful to retrofit. |

**Needed:** yes / no / "change this specific thing" for each.

---

### Q2. What is the identity of a submission? *(This is the sharpest technical question in the report.)*

Brief §4: *"Every submission attempt carries an idempotency key. Duplicate submission is the
characteristic catastrophic failure of this class of system and must be structurally impossible,
not merely unlikely."*

Idempotency infrastructure is **Phase 1 work**, so I need this now. To make duplicates
*structurally* impossible I must know what makes two submissions "the same". The obvious answer
is `(student, institution, course, intake)` — but that answer forbids things a student may
legitimately want:

| Scenario | Should it be allowed? |
|---|---|
| Student applies to Leeds MSc Data Science, Sept 2027. Submits. Then clicks again / the worker retries. | ❌ **Must be blocked.** This is the catastrophic case. |
| Application is **rejected**. Student wants to re-apply to the same course for the **same** intake. | ❓ Universities usually forbid this. Do we enforce it, or defer to the portal? |
| Student applies to the same course for a **later** intake (2028 instead of 2027). | ✅ Presumably allowed — different intake, different key. |
| Student **withdraws** and wants to re-apply to the same course and intake. | ❓ Needs a rule. |
| Student applies to **two different courses** at the same university, same intake. | ✅ Presumably allowed. Some portals cap this — the blueprint would need to encode it. |

**My recommendation:** the idempotency key is
`(student_id, institution_id, course_id, intake, attempt_ordinal)`, where `attempt_ordinal`
starts at 1 and can **only** be incremented by an explicit, human-reviewed action recorded in the
event log — never automatically, and never by a retry. Retries always reuse the current ordinal.
That blocks the catastrophic case absolutely while leaving a deliberate, auditable path for a
genuine second attempt.

**Needed:** confirm this model, or tell me the rules for rejection/withdrawal re-application.

---

### Q3. Do you confirm the case state machine?

Phase 1 encodes this explicitly, so I would rather have it confirmed than guess. Proposed states:

**Preparation**
`INTAKE` → `PROFILE_INCOMPLETE` → `DOCUMENTS_PENDING` → `REQUIREMENTS_RESOLUTION` →
`ELIGIBILITY_REVIEW` → `BLUEPRINT_REQUIRED` → `READY_TO_PREPARE`

> **Superseded by [ADR-0058](../decisions/0058-a-case-opens-from-an-offer-the-student-accepted.md).**
> The three middle states were removed: no phase ever mapped to the first two, and the third was
> never entered. A case now walks `INTAKE` → `READY_TO_PREPARE` directly, because the target is
> resolved and validated before the case exists.

**Execution**
`PREPARING` → `VALIDATION_FAILED` (recoverable) → `AWAITING_HANDOFF` (MFA / OTP / CAPTCHA /
payment) → `AWAITING_HUMAN_REVIEW` → `AWAITING_STUDENT_AUTHORISATION` → `AUTHORISED`

**Submission**
`SUBMITTING` → `SUBMITTED` → `CONFIRMED` *(terminal — MVP responsibility ends here, per brief §2.8)*

**Off-ramps**
`ROUTE_FALLBACK` (an automated route failed → hand to `AssistedManualAdapter`) ·
`CANCELLED` *(terminal, student-initiated)* · `FAILED_PERMANENT` *(terminal)*

Three properties I want to call out because they encode product rules rather than mechanics:

- **`AWAITING_HUMAN_REVIEW` is not reachable only from a low-confidence score.** Per brief §2.5,
  financial evidence and anything involving a minor route here **unconditionally**, whatever the
  confidence. It is a hard gate in the transition table, not a flag.
- **`AUTHORISED` stores a content hash.** If the prepared content changes afterwards, the case is
  forced back to `AWAITING_STUDENT_AUTHORISATION` and the previous authorisation is void (brief §7).
- **`AWAITING_HANDOFF` is a normal state, not an error** (brief §6).

**Needed:** confirm, or tell me what is missing. This is product definition, so it is your call
rather than mine.

---

## Tier 2 — Blocks Phase 2 (profile and documents)

### Q4. Who is the authoritative source for requirement rules such as the 31-day window?

**This is the most important question in the report after Q1.**

Brief §2.4 makes the UK Student visa 31-day financial-evidence recency window the canonical
example, and says *"silently reusing a stale bank statement is the exact failure this system
exists to prevent."*

I can build the deterministic date engine. **I must not be the source of the rule itself.** If
the rule came from a language model's recollection of UKVI guidance, the system would be doing
precisely what brief §3.1 forbids — inventing a requirement — only now with legal consequences
for a real student. The Requirements Service is specified to carry source URL, retrieval
timestamp, evidence excerpt, confidence and revalidate-by date, which is the right shape. The
question is who fills it.

Options: (a) a human specialist curates rules against official UKVI/university sources, the way
the existing AskiMate knowledge base is curated by experts; (b) automated retrieval from official
sources with mandatory human approval before a rule goes live; (c) something you already have.

**My recommendation: (b)** — it mirrors the `kb_pending_entries` → human approval → `kb_entries`
pattern the team already runs successfully in AskiMate, so it is a known workflow rather than a
new one.

**Needed:** who owns rule correctness, and what source do we cite? Also: is 31 days still current,
and do you have a specialist who can confirm rules as they are added?

---

### Q5. What is the document retention and deletion policy?

The vault will hold passport scans and bank statements. UK GDPR requires a defined retention
period and a deletion path. This shapes S3 lifecycle rules, the schema, and the deletion API — it
is much cheaper to design in than to add.

- How long after `CONFIRMED` do we keep a document?
- What happens on `CANCELLED` or `FAILED_PERMANENT`?
- If a student asks for erasure, what must be retained for audit? (My assumption: the audit log
  keeps document **IDs and hashes**, never contents — per brief §8 — so erasure can delete the
  object while leaving the audit trail intact and verifiable. Please confirm this satisfies your
  legal position.)

**Needed:** a retention period, or confirmation that legal will supply one before Phase 2 ends.

---

### Q6. What does the parental consent flow actually require?

Brief §2.6: minors detected from DOB trigger a parental consent flow. To build it I need to know
what it *is*.

- Who consents — a parent, a legal guardian, either?
- What form does consent take — a typed name, a signature, an email confirmation, an uploaded document?
- Is it per-application or once per student?
- Does "involving a minor" mean only *the applicant* is under 18, or also cases where an adult
  applicant has a parent as financial sponsor? (Brief §2.5 escalates "anything involving a minor";
  the boundary matters.)
- Which age applies — under 18 at application, or at course start? These can differ.

Related finding: `askimate_users.dateOfBirth` is a **nullable, unvalidated `TEXT` column**
([01 §3](./01-existing-system-inventory.md)). AAS will require a confirmed ISO-8601 date and will
**never** assume adulthood from an unparseable or missing value.

**Needed:** the flow definition, or a decision to defer minors from MVP scope entirely (which is
a legitimate simplification if you want it — but it must be an explicit product decision, and the
system must then *refuse* minors rather than silently mishandle them).

---

### Q7. Region and data residency — confirm eu-west-2 (London)?

See [04 §2](./04-aws-bootstrap-plan.md). One-line change now, expensive migration later. Legal-adjacent,
flagged per brief §12.10, not treated as a blocker.

---

## Tier 3 — Blocks Phase 3 (browser runtime and discovery)

### Q8. Which university, which course, which intake?

Phase 3 produces a reviewed Application Blueprint for one nominated target. I need the specific
target to plan discovery. Ideally one with a **direct application portal** (not solely
UCAS-routed) so `DirectPortalAdapter` gets a genuine exercise.

### Q9. Networking posture for Phases 3–4

Public subnets without NAT (~$28/month cheaper) or private subnets with NAT from the start? See
[04 §4](./04-aws-bootstrap-plan.md). I have made a recommendation but will not decide this one
unilaterally.

### Q10. Terms-of-service position on automating the target's portal

Per brief §12.10 this is yours and is **explicitly not a blocker** — I will keep designing and
building. But it needs to be *in flight* before Phase 3 touches a live site, because it can change:

- whether we automate that university at all, or route it to `AssistedManualAdapter`;
- whether discovery may run against production or needs a sandbox;
- how we identify ourselves in the User-Agent.

I will not run anything against a live university application without your explicit written
go-ahead and a safe test target (brief §10).

### Q11. Access to the live askimate.com repository

Needed to finalise exact endpoint shapes and to size the AskiMate-side work honestly
([01 §0](./01-existing-system-inventory.md)). **Does not block Phases 1–3** — Option B was chosen
partly because it stays correct without this. But the integration cannot be *completed* without it.

Note: `vaahiiid/ai-admissions-platform` is an empty placeholder, not the live product.

### Q12. AWS credit expiry date and Bedrock eligibility

See [04 §6](./04-aws-bootstrap-plan.md). Changes the model-hosting recommendation, not the architecture.

---

## Tier 4 — Later phases

- **Q13. Who are the human specialists** for the Review Console, and how do they authenticate?
  The existing admin auth is a single shared credential pair ([01 §4a](./01-existing-system-inventory.md)),
  which cannot attribute an approval to a person. The authorisation ledger requires named
  reviewers. *(Phase 5.)*
- **Q14. Application fees.** Many applications require payment at submission. Brief §7 puts payment
  behind a handoff, which is right — but who pays, when, and what does the student see?
  *(Phase 5–6.)*
- **Q15. Second university for Phase 7** — ideally on a *different* portal platform, so Phase 7
  genuinely tests the abstraction rather than re-running the same shape.
- **Q16. Partner portals** (Navitas, ApplyBoard, StudyIn via Universitio) — out of current scope
  per brief §6, but the commercial relationships and API access will have long lead times. Worth
  starting early even though the code is later.

---

## Summary — what I need to start Phase 1

| | |
|---|---|
| **Blocking** | Q1 (approve three decisions) · Q2 (submission identity) · Q3 (confirm state machine) |
| **Not blocking, answer during Phase 1** | Q4–Q7 (before Phase 2) · Q8–Q12 (before Phase 3) |
| **No action needed from you** | AWS account, credentials, university access, legal answers |

Per brief §13 I am stopping here and awaiting your approval before starting Phase 1.

---

*Deliverable 5 of 5. Back to [the Phase 0 index](./README.md).*
