# ADR-0076 — The student can instruct the second attempt the system refuses them into

**Status:** **Accepted** — approved by Vahid, 2026-09-07
**Completes:** [ADR-0006 §3](./0006-reapplication-requires-explicit-student-instruction.md) —
amended and built in P38; reachable by a student from P42
**Continues:** [ADR-0073](./0073-a-declared-capability-with-no-production-caller-fails-the-build.md) ·
[ADR-0075](./0075-a-refusal-reaches-the-person-it-is-for.md)

## Context

P38 armed `claimSubmissionKey` and built ADR-0006 §3's two-step exchange: the student says what
happened to their previous application, the system advises, and only then may they instruct a second
attempt. Both routes are published, both enforce rule 4's mandatory presentation, and both are
covered by driver tests.

**Nothing but a test had ever called either.**

The refusal that leads to them says so itself. `AlreadyApplyingProblem` carries `existingCaseId` and
`concluded`, and the contract explains why those fields are on the wire at all:

> It is on the wire because the refusal is otherwise a dead end. "You already have an application for
> this" is only useful if the client can take the student to it, or — when it has concluded — offer
> them a second attempt. `concluded` is the one bit of state that decides which.

The student's page read the refusal's `code` and discarded the rest. So a student whose earlier
application had finished — the exact case the system is ready to help with — was told they already
had one and shown nothing further.

This is the third consecutive phase to find the same shape: a decision that is correct, implemented,
tested, and stops one layer short of the person it was for. P39 found a capability with no caller;
P41 found a refusal with no reader; P42 finds a route with no client.

## Decision

**A refusal that names a way forward must offer it.**

1. **The refusal is read through the contract's own parser.** `transport.ts` now keeps the whole
   `Problem` document on a failed outcome, parsed by `parseProblem` rather than by reading fields off
   an object. A document the parser will not take still yields a code, because a refusal this client
   cannot fully read is still a refusal and must not become a success.

2. **`concluded` is the server's answer, and the only thing that decides the offer.** The page holds
   no case state and reads none. Offering a second attempt against a live application would be
   asking for `decideReapplication`'s refusal — two concurrent applications for one course and
   intake, which its own comment calls *"a different bug with the same blast radius"*.

3. **The advice comes before anything that can instruct.** The panel has two states, and the second
   is reachable only through a round trip whose reply is the server's advice. There is no path by
   which the page can put itself into the instructing state — which is ADR-0006 rule 4 obeyed, not
   re-implemented. The server enforces the same order independently, by looking for the advice event
   in the conversation's own log.

4. **The advice is shown verbatim.** `pre`, like the offer, because this client does not compose,
   summarise or re-flow a rendering it did not make. The suggested intake is appended only when the
   server sent one.

5. **The instruction carries the student's own words and nothing else.** Not the prior case, not the
   attempt ordinal, not the outcome, not the advice. Every one of those is a field through which a
   client could disagree with the system about the one number ADR-0006 exists to protect.

## What this deliberately does NOT do

- **It does not take the student to the application they already have.** The other half of what
  `existingCaseId` is for. A conversation owns at most one case, so "go to that one" means moving the
  student to a different conversation, and there is no read that lists a case's conversation yet.
  Recorded here rather than half-built.
- **It does not add a check that every published route has a client.** Most internal routes have no
  browser caller by design, so such a check would be an exception list wearing a guard's clothes. The
  reachability register carries `advisePriorOutcome` instead, whose only production caller is the
  page — so deleting the flow fails the build — and the exchange itself is proved end to end in a
  real browser.
- **It does not change the server.** Every route, refusal and guard involved already existed and is
  unchanged. P42 is entirely the client half.

## Consequences

- A student whose earlier application was rejected or withdrawn can apply again, from the page, in
  their own words, having been shown the advice ADR-0006 requires.
- A student whose earlier application is still live is told so and offered nothing, which is the
  same answer the domain would give.
- `Outcome`'s refusal member carries the parsed problem, so the next refusal that means more than its
  code does not need this work done again.
- The declared-but-unreachable surface is **unchanged at six**. The enforced count goes from thirteen
  to fourteen.
