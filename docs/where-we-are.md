# Where we are

**Date:** 2026-08-26
**Supersedes the state table in** [`gap-analysis-to-first-end-to-end-run.md`](./gap-analysis-to-first-end-to-end-run.md)
(its account of the blockers and the account options still stands)

---

## The headline

**The full chain now runs end to end and stops before submission.**

```bash
pnpm run end-to-end
```

> discover a portal read-only → capture every page → replay it locally →
> **interview the student in conversation** → plan the fill → validate against the portal's own
> recorded rules → **show exactly what will be submitted** → capture the authorisation →
> fill the form → **STOP**

That is Stage D from the gap analysis: the milestone I said was the real proof point, reachable
without an account and without touching anything live. It is reached.

**528 tests.** Typecheck, lint, dependency-boundary checks and CI all green.

---

## What is built, and what remains

Legend: ✅ built and tested · 🟡 partial · ❌ not built

| # | Step | State | Notes |
|---|---|---|---|
| 1 | **Discovery** | ✅ | Read-only. Now also captures each page for replay. The *live run* is still blocked on egress. |
| 2 | **Application Blueprint** | ✅ | Draft → specialist review → executable. An unreviewed one cannot drive anything. |
| 3 | **Requirements** | 🟡 | Model, provenance and the evidence bar are built. **The Requirements Service and its curated content are not** — see below. |
| 4 | **Conversational interview** | ✅ | A capability of AskiMate Chat (ADR-0015). No new interface, and none will be built. |
| 5 | **Confirmed profile** | ✅ | In-memory. Postgres is deferrable and not on the critical path. |
| 6 | **Documents** | ✅ | Vault, deterministic validity, and extraction with the grounding rule (ADR-0016). |
| 7 | **Field mapping** | ✅ | Reviewed data pinned to a blueprint version (ADR-0017). |
| 8 | **Autonomous completion** | ✅ | Fills a real form. Proven against a real Chromium and a replay of a captured portal. |
| 9 | **Validation** | ✅ | Against rules the blueprint *observed*. There is no such thing as a guessed rule. |
| 10 | **Preview** | ✅ | Every field, no summarising, rendered deterministically. Hashed. |
| 11 | **Authorisation** | ✅ | Ledger stores the preview text verbatim, not only the hash. |
| 12 | **Submission** | ❌ | **Deliberately not built. This is where we stop.** |

---

## The three guarantees worth knowing about

Each was verified by attacking it, not by asserting it.

**A model cannot invent a value into an application.** Extraction must quote the span of the
document it read, and a span the document does not contain means the reading is discarded — at any
confidence. A confabulating model client producing perfectly passport-shaped data at confidence 1.0
has **all eight** of its readings thrown away before the student ever sees them. That matters
because a student skim-reading "I read your passport number as K98765432 — is that right?" will say
yes. See [ADR-0016](./decisions/0016-extraction-must-quote-the-document.md).

**A dropdown option is never approximated.** Confirmed nationality `Iranian` does not become
`Iran (Islamic Republic of)` because it is close. The case blocks and asks. The wrong answer here
would look entirely reasonable in the preview, which is exactly why software must not choose it.

**Preparation cannot submit.** Four layers: the session type has no `submit`; only controls the
blueprint records as *advance* controls may be clicked; a control whose name reads as a submission
is refused **even if it is on the allow-list**; and where the blueprint records the submission
endpoint it is refused at the network layer too. Tested by deliberately allow-listing the submit
button and asserting the fixture server received nothing.

---

## What still needs a decision from you

Four, unchanged in substance from the gap analysis. Two of them now gate everything else.

### 1. Model provider and a credential — *gates real conversation quality*

Bedrock (draws on the AWS credits) or the Anthropic API direct (cash). Everything is built against
a port with a deterministic stand-in, so adding the real client is **one adapter and no rework
anywhere**. Until it is wired in, the interview's phrasing is a stand-in and its quality tells you
nothing.

### 2. Live portal access — *gates the real Ulster blueprint*

Egress for `apply.qahighereducation.com`, `qahighereducation.com`, `www.ulster.ac.uk` — **or** run
`pnpm run discover targets/ulster-birmingham-msc-ib-2026.json` on your own machine and send back
the output directory. Discovery now captures the pages, so what you send back is directly
replayable and everything downstream can be built against the real portal without any further
access.

### 3. Who curates requirements — *gates Phase 4 proper*

ADR-0009 requires a human-reviewed knowledge-base entry **and** an official-source check, agreeing
and fresh, for anything `critical`. A visa rule cannot go live on one source. The gate exists and
is enforced; what does not exist is the service that fetches, the store that holds curated entries,
and a person who approves them.

### 4. Account approach for the eventual live run

Unchanged: ask QA Higher Education for a sandbox (A), fall back to a genuinely consenting real
applicant (B), and **do not** create a fabricated test account in a live admissions system (C).
I can draft the sandbox request whenever you want it.

---

## What I would do next, in order

1. **Wire the real model client** the moment a provider is chosen. One adapter; unblocks judging
   whether the conversation is actually good.
2. **Run discovery against Ulster Birmingham** — by egress or by you running it locally — and
   build the real blueprint and mapping set for it, reviewed.
3. **Re-run the end-to-end chain against a replay of the real portal.** Everything is already in
   place for this; it becomes a data exercise rather than a code one, which is what the
   architecture was for.
4. **Then, and only then**, the live run stopping before submit — under option A or B, and with
   your explicit approval at that point.

Steps 1 and 2 are independent and can happen in either order.

---

## What has deliberately not been built

Said plainly so nothing here reads as further along than it is.

- **Submission.** No code path exists. Phase 6, with its own approval.
- **The Requirements Service.** The gate is built; the service behind it is not.
- **AWS, Postgres, SQS, the API, the AskiMate integration.** None is needed for the demonstration,
  and building them now would have delayed it. `$0` of the AWS credit is spent.
- **A student-facing interface of any kind**, and there never will be one — the interview is a
  capability the existing AskiMate Chat calls (ADR-0015). The CLI harnesses in `scripts/` are test
  drivers and ship nowhere near a product.
