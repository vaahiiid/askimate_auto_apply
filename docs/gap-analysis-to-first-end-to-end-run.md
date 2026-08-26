# Gap analysis: from here to a complete end-to-end application preparation

**Date:** 2026-08-26
**Target:** Ulster University Birmingham · MSc International Business · September 2026
**Goal:** *"The student only talks to AskiMate. AskiMate asks whatever it needs, obtains confirmed
information and documents, autonomously completes the university application, validates it, and
prepares it for final authorisation."* — stopping immediately before submission.

---

## 1. The headline

**One external dependency blocks one strand. It does not block the project.**

Of the twelve steps in the chain, **only two** genuinely need the live portal. The other ten can be
built and proven now, against a faithful local replay. That reordering is the single biggest
accelerator available, and it is also the safest sequence — you do not want to be debugging fill
logic against a live admissions system.

---

## 2. Step-by-step gap analysis

Legend: ✅ built and tested · 🟡 partial · ❌ not built

| # | Step | State | What is actually missing |
|---|---|---|---|
| 1 | **Discovery** | ✅ runner built, tested | The *run*. Blocked on egress, or run it locally. |
| 2 | **Application Blueprint** | 🟡 schema ✅ | A real blueprint. Needs step 1, then a specialist review to make it executable. |
| 3 | **Requirements** | 🟡 model + gate ✅ | The Requirements Service (fetch official source, curated KB store) **and the curated content itself** — ADR-0009 needs corroboration for anything critical. |
| 4 | **Conversational interview** | ❌ | Everything. `packages/llm`, the interview loop, and a chat channel. **The largest single gap.** |
| 5 | **Confirmed profile** | ✅ | Nothing for a demo. Persistence is in-memory; fine for one run. |
| 6 | **Documents** | 🟡 vault + validity ✅ | **Extraction** — reading a passport or transcript into a `ProposedValue`. S3/KMS deferrable. |
| 7 | **Field mapping** | ❌ | `packages/mapping` — canonical field → blueprint field. Config, not code. Needs the blueprint. |
| 8 | **Autonomous completion** | 🟡 interface only | `FillableSession` has **zero implementations**. Needs the Playwright fill/click layer + orchestration against the blueprint. |
| 9 | **Validation** | ❌ | Checking the filled application against the blueprint's recorded rules. |
| 10 | **Preview** | ❌ | Rendering exactly what will be submitted. |
| 11 | **Authorisation** | 🟡 domain events ✅ | The ledger store and the capture flow. The hashing rule is already in the state machine. |
| 12 | **Submission** | 🟡 interface only | **Deliberately not built. This is where we stop.** |

**Cross-cutting, and missing:**

- `packages/llm` — the only package permitted to call a model. Needed by steps 4, 6 and 8.
- An orchestrator to run the loop. For a demo this is a **CLI**, not ECS, not SQS, not an API.
- Postgres, AWS, AskiMate integration — **all deferrable.** None is needed for the demonstration.

---

## 3. Immediately implementable vs externally blocked

### 🟢 Can start now — no external dependency

| Work | Why unblocked |
|---|---|
| **Validation engine** | Needs only the blueprint *schema*, which exists |
| **Preview + authorisation capture** | Needs only profile + blueprint schema |
| **`FillableSession` implementation** | Testable against the existing local fixture |
| **Replay harness** | Serve a saved portal locally and run the whole chain against it |
| **Interview engine skeleton** | The profile package already answers "what is missing?" |

### 🔴 Needs something from you

| Blocker | What exactly | Blocks |
|---|---|---|
| **1. Live portal access** | Egress for `apply.qahighereducation.com`, `qahighereducation.com`, `www.ulster.ac.uk` — **or** you run `pnpm run discover` locally and send the output | Steps 1, 2, 7 |
| **2. Model provider + credentials** | Bedrock (draws on the AWS credits) **or** Anthropic API direct (cash). A decision plus a key. | Steps 4, 6, 8 |
| **3. Requirements curation** | Who reviews and approves KB entries. ADR-0009 requires corroboration for critical requirements — a visa rule cannot go live on one source. | Step 3 |
| **4. Account approach for the live run** | See §5 — this is the significant one | Step 8 on the real portal |
| **5. Demo channel** | Is a CLI chat acceptable for the first demonstration, or must it be inside AskiMate? | Step 4 |

---

## 4. The fastest safe path

### Stage A — build the unblocked two-thirds *(start immediately, in parallel with everything else)*

`packages/llm` · interview engine · document extraction · validation · preview + authorisation ·
`FillableSession` implementation. All tested against local fixtures.

### Stage B — discovery *(needs blocker 1)*

Run discovery → draft blueprint → **specialist review** → reviewed blueprint. Save the portal's
real HTML as a replay fixture at the same time.

### Stage C — mapping *(needs B)*

`packages/mapping`: canonical profile field → blueprint field, for this one target. Configuration
data, reviewed like a blueprint. Small.

### Stage D — 🎯 **the milestone: full end-to-end against a replay of the real portal**

Everything from Stage A, driven end to end against the *saved real* portal:

> student talks → agent interviews → documents extracted and confirmed → application filled →
> validated → preview rendered → authorisation captured → **stops before submit**

**Zero risk. Nothing touches a live system. This is the demonstration you described**, and it can
be reached without ever creating an account. I would treat this — not the live run — as the real
proof point.

### Stage E — live run, stopping before submit *(needs blocker 4)*

Only after D passes. The smallest, most controlled step, because everything has already been proven.

---

## 5. The account question — you asked specifically, so here is a direct answer

To fill a real form on the portal you need an account, and creating an account plus a draft
application **is itself consequential**, even if nothing is ever submitted. Three options:

### Option A — sandbox / UAT from QA Higher Education ✅ *cleanest*

Ask QA Higher Education for a test environment. Nothing in production, no fictitious records, no
ambiguity. You run Universitio, a consultancy with partner relationships in exactly this space, so
this ask is more available to you than to most. **Worth asking first — it costs an email.**

### Option B — a genuinely consenting real applicant ✅ *recommended fallback*

A real student who actually intends to apply to this course, with informed consent. Their account
is real, their draft is real, their data is theirs. **Nothing fictitious is created.** We stop
before submit and show them exactly what would be sent — which is a genuinely useful thing for
them, not merely a test.

### Option C — a fabricated test account in the live portal ❌ *advise against*

**This sounds safer than Option B and is actually the opposite.** It means creating a fake
applicant record in a live admissions system: likely a terms-of-service breach, damaging to the
partner relationship if noticed, and hard to defend afterwards. The word "test" does not change
what it is.

> **Recommendation:** ask for A. If it is not available, use B. Do not use C.

Either way, Stage D reaches the full demonstration **without needing any of them**.

---

## 6. Two risks worth planning for now

**The interview is the highest-variance piece.** Turning free conversation into reliably correct
structured fields is genuinely hard — the *architecture* is settled (nothing enters the profile
without confirmation), but quality will need iteration. It is the main reason to start Stage A now
rather than after discovery.

**Salesforce Experience Cloud is a hard automation target.** If the platform hypothesis holds, the
portal is Lightning-based: heavily dynamic DOM, generated IDs, components that re-render on
interaction. Filling it is materially harder than a plain HTML form, and the label-first locator
strategy in the blueprint schema was chosen with exactly that in mind. Discovery will tell us how
bad it is — and that answer should be treated as an input to the plan, not a surprise.

---

## 7. What I need from you to proceed

1. **Blocker 1** — open egress, or run `pnpm run discover targets/ulster-birmingham-msc-ib-2026.json`
   locally and send back `discovery-runs/<run-id>/`.
2. **Blocker 2** — Bedrock or Anthropic API direct, plus a credential.
3. **Blocker 4** — do you want me to draft the sandbox request to QA Higher Education?
4. **Blocker 5** — is a CLI chat acceptable for the first demonstration?

**Say the word on 2 and 5 and I start Stage A immediately** — it is roughly two thirds of the
remaining work and needs nothing from the portal.
