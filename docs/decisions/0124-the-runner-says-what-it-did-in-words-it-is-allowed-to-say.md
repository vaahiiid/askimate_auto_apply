# ADR-0124 — The runner says what it did, in words it is allowed to say: the outcome of every turn, the start of every sign-in attempt, and a thrown error through a closed vocabulary; both attempts' codes reach the person

**Status:** Accepted · 2026-09-18 · closes blocker 36 · completes [ADR-0120](./0120-a-failed-sign-in-is-tried-twice-then-stops-for-a-person-and-the-student-is-told-what-cannot-be-told-apart.md) (the sign-in record now holds every attempt's code, as [ADR-0122](./0122-a-failed-page-fill-is-tried-twice-then-stops-for-a-person.md) already did for a page) · found by Run A
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-18. **Built in P157**, the same day.

## Context — a live run failed twice and wrote two words

Run A reached the portal. The sign-in failed twice with `runner_fault`, ADR-0120's cap stopped the
run for a person exactly as designed, and the runner's entire account of it on disk was:

```
runner runner-local-1 polling http://127.0.0.1:4870
turn: worked
turn: worked
```

Two causes, neither subtle. The runner had **no logging**: one call site printed the turn's kind,
and `worked` there means *a turn ran*, not *it succeeded*, so a sign-in that failed against a live
portal and one that succeeded printed the same word. And every failure site in the sign-in path was
a **bare `catch {`** that did not bind the error at all, so there was nothing to print even had a
logger existed. Vahid: *"Whatever it does between 'turn' and 'worked', none of it is on disk, and
that is the first thing I would fix before trying again — not the connection, the silence."*

What the failure actually was could still be narrowed, from the Secure Plane's log rather than the
runner's: `secret_consumed` on both attempts proves the password was typed, which happens after the
navigation, the challenge probe and the e-mail fill. So the fault is at the submit and the load that
follows. That is a deduction, not a reading, and this ADR exists so the next one is a reading.

## Decision 1 — the outcome, never the fact that a turn ended

> *"'worked' has to go. A word that means the same thing for a successful sign-in and a failed one
> is worse than no word. Print the outcome — succeeded, failed with which code, or stopped — not
> the fact that a turn ended."*

`turnInWords` takes the turn's own result type, so a new turn kind is a compile error rather than a
line that silently says nothing. An idle turn says nothing, at a poll a second.

## Decision 2 — a vocabulary, not a scrubber

> *"The scrubbed message rule is the important half and I would rather it were strict than useful.
> An error's class and a scrubbed message, through the same allowlist the secure logger uses. If a
> message cannot be scrubbed with confidence, print the class alone and say the message was
> withheld. A URL with a token in a log is a worse outcome than a log I cannot read."*

The Secure Plane's own logger permits an `errorClass` and forbids a message outright, so there is no
message allowlist to share: there is a discipline to extend. A scrubber decides what to remove,
which is a guess about every message it has not seen, and the cost of the guess being wrong is a
credential in a log file. So `describeThrown` matches the message against a **closed set of
patterns** and prints the phrase written in our own source for that pattern — never any slice,
prefix, first line or redacted form of the thrown text. A message matching nothing is withheld
entirely and the line says so. The one datum quoted from a message is a Chromium network code
(`ERR_CONNECTION_RESET` and its siblings), a fixed engine enum naming no page, host or value.

## Decision 3 — a line before the attempt, not only after it

> *"a line at the start of each sign-in attempt, not only at the end: which attempt, which URL,
> when. If the runner dies mid-attempt, I want to know it started."*

The URL is the reviewed blueprint's login page, not a URL from a page, so it carries no token. The
attempt number is the **plane's** count, carried on the work item as `signInAttempt`: the runner is
stateless between turns and a number it invented would be the thing this project keeps finding. An
older plane that sends none makes the line say the attempt is unknown rather than defaulting to one.

## Decision 4 — both attempts' codes reach the person (blocker 36)

> *"Raise the missing first code as a blocker, and carry the first attempt's code onto the sign-in
> record in the same phase. Same shape as ADR-0122, and the reason is the one you gave: when the two
> codes differ, a person reading one of them is reading half the story."*

`run_sign_in_failures` held `last_failure`, one code per run, so a sign-in that lost its connection
and was then refused reached a person as a refusal alone. Migration 0022 adds `attempt_failures`,
appended per attempt MADE, on the same line `attempts` already draws; the intervention names every
code in the order they happened.

## Not decided — the submit/load race

The leading hypothesis for Run A's fault is the `Promise.all` racing `submit.click()` against
`waitForLoadState("load")`, which destroys the context the click runs in when the click navigates.
It is **left exactly as it was**, and the catch there now carries a comment saying so. Vahid:
*"It is exactly the kind of thing that gets 'fixed' on a guess and then the real cause shows up
behind it. One attempt with a real error message is worth more than a fix that might be right."*

## Built — P157, 2026-09-18

Tests first, red. `apps/browser-runner/runner-log.ts`: `describeThrown`, `thrownInWords`,
`turnInWords`, `signInStartLine`, and the closed pattern set. `sign-in.ts`: the start line, and
every catch binds its error and says which step failed. `performer.ts` and `main.ts` thread the
log. `packages/contracts`: `ClaimedWork.signInAttempt`, parsed, published, and named in the
compile-time constraint that keeps free text off the wire — a count is exempt by being NAMED, so a
`retryBudget` added later still fails the build. The driver fills it from the plane's own count at
the claim. Migration 0022, the store append, and both codes in the intervention.

## Consequences

- The next sign-in attempt writes: that it started, which attempt, which URL; and then its outcome
  with the code and our phrase for what threw, or the class with the message withheld.
- Nothing of a portal's page can reach a runner log by any path this ADR opens.
- A person reading a stopped sign-in sees every attempt's code, not the last one.
