# ADR-0114 — A failed account creation is offered to the student again once, and stops for a person on the second failure; the student is always told

**Status:** Accepted · 2026-09-15 · decides blocker 26 · continues 0054 (the intent ledger's reopen), 0065 (the run stops for a person), 0101 (the secure box as the resume path)
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-15, from
[`decision-sheet-blocker-26-…md`](../decision-sheet-blocker-26-a-failed-account-creation-is-re-claimed-without-limit.md). **Not yet built**; the build follows the three registry shapes of ADR-0115 or precedes them at his word.

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
