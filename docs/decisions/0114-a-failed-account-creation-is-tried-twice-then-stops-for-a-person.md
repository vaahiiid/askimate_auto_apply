# ADR-0114 — A failed account creation is offered to the student again once, and stops for a person on the second failure; the student is always told

**Status:** Accepted · 2026-09-15 · decides blocker 26 · continues 0054 (the intent ledger's reopen), 0065 (the run stops for a person), 0101 (the secure box as the resume path)
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-15, from
[`decision-sheet-blocker-26-…md`](../decision-sheet-blocker-26-a-failed-account-creation-is-re-claimed-without-limit.md). **Built in P137**, 2026-09-15; see *Built* below.

## Context

P121's journey through the five real processes found that a failed account creation is
re-claimed without limit: the Runner reports `create_portal_account` failed, the ledger reopens
the intent as `failed_cleanly` (ADR-0054, right in itself), the Worker's next tick re-offers it,
the Runner re-claims about twice a second, and the Secure Service refuses each use as
`already_spent` because the password handle was spent on the first attempt. Nothing caps the
attempts, backs off, or asks the student again — and the student is told nothing, because the
failure is "clean".

## Decision

In his words:

> *"Blocker 26: C, and the number is two."*
>
> *"B alone loops when the portal refuses every time, which is the shape you actually observed. A
> alone leaves a student whose first attempt failed because the page was slow waiting for a
> person, which is a bad answer to a passing problem."*
>
> *"Two, not three. The distinction two draws is the one that matters: once is chance, twice is
> the portal. A third attempt adds a wait and tells nobody anything new."*
>
> *"The intervention's text must say which attempt failed and why, and the student must be told
> the account could not be created — not left with a conversation that has quietly stopped
> moving. A failure the student is not told about is the same defect as blocker 22 in a
> different place."*

So:

1. **On the first clean failure whose secret is spent** (`secret_unavailable`, or the Secure
   Service's `already_spent`), the plane does not re-offer the spent intent. It opens the secure
   box again, as the resume path does (ADR-0101 §3), and the intent waits for the student's
   second password before it is offered once more.
2. **On the second clean failure**, the plane stops re-offering, raises an intervention for a
   person whose text names the attempt (*second of two*) and the reported cause, and tells the
   student in the conversation that the account could not be created and that a person will
   look. The number is **two**; a third attempt is never made by the system.
3. **The student is told at both points** — that the first attempt failed and the box is open
   again, and that the second failed and the run has stopped — because a failure the student is
   not told about is blocker 22's defect in another place.

## Consequences

- The intent ledger counts a `create_portal_account` intent's attempts; the second clean failure
  completes it in a state the Worker does not re-offer.
- The Worker's tick, which today re-offers on every pass, offers a spent intent only after a
  fresh secret is available.
- Nothing here touches the transmission gate, the authorisation content hash, or the
  mandatory-review categories; the password still crosses once per attempt and is never held.

## Built — P137, 2026-09-15

Tests first, red, then the mechanism; the P121 loop reproduced as the third driver test's first
assertion before the fix (`create_account` offered with the secret the failed attempt had spent).

- **The ledger counts, and names the secret.** `workflow_action_intents` gains `attempts_made`
  and `spent_secret_request_id` (migration `0005_intent_attempts.sql`). `completeIntent` takes
  a detail: `attempted` (false for a hand-out that never reached the portal — the runner had no
  usable password — so the count is of attempts made, not hand-outs) and the `sr_…` request id
  the attempt was handed. A reopen keeps the count and clears the spent id; a duplicate report
  raises neither. One row per (run, action, target) still, as ADR-0054 requires.
- **The state carries the failure, and the step reads it.** The Run Driver reads the row into
  `RunState.accountCreationFailed { at, attempts, spentSecretRequestId? }`
  (`withAccountCreationFailure`). `secretStepFor` sends the run back to the box while the log's
  latest request is the one a failed attempt spent — by identity, not by the lifecycle word:
  `secret_consumed` arrives through the Secure Plane's outbox, and a runner that never reached
  the plane leaves the log saying `secret_received` for ever. The driver's own guard against a
  second box treats a spent request as settled for the same reason.
- **What follows a failed creation** (`reportWork`): a password the runner could not use is not
  an attempt — the student is told so when one was handed, and the box reopens; the first
  attempt's failure is told to the student in the closed set's words (*"the portal did not
  accept the details"*, *"my browser lost its connection"*, …) with why there will be one more
  and that the box opens again because we do not keep the password; the second raises an
  intervention (`timeout_exhausted` — *retries are exhausted*) whose text names *the second of
  two attempts* and the reported code, tells the student the account could not be created and
  a person will look, and sets `escalated`, which `claimWork` never offers. The stop is the
  same mechanism as the challenge stop (ADR-0101 §6), now one method for both.
- **Found by the build, and closed:** advancing a run a person holds could open a password box.
  `advance` has no held-run guard on purpose (P40: re-deriving a stopped run is a no-op that
  re-stops it), and the box was the one thing on that path that is not a no-op — the second
  failure's spent secret made the step say "ask again" on an escalated run. No box opens for a
  run a person holds; it waits for the person like everything else about the run.
- **Not done, raised as blocker 28:** a box the student *cancels*. `secret_cancelled` is read as
  "asked already" (only an expiry re-opens), so `create_account` is handed out with no handle,
  refused `secret_unavailable`, and handed out again on the next tick — the same loop for a
  different lifecycle word, silent (nothing is said for a hand-out that carried no password,
  because "the password you typed could not be used" would be false). Whether a cancel means
  "ask me again", "stop for a person" or "I am stopping" is his call, not a reading to pick.
- Under `already_exists` the second attempt is made with the student's second password, as
  the decision is uniform — two, then stop — and the intervention names the cause.
- Tests: the ledger contract (two, run against both stores), the orchestrator's step (one, three
  cases), the driver on real Postgres (three: first failure, unusable password, second failure).
  The P17 supervisor test that drives a real second attempt now proves the spent password is
  handed to nobody and supplies a fresh one, as the Secure Plane would, before the retry lands.
