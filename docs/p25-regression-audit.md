# P25 — deliberate regression audit

Eleven mutations against the student's page, its transport, and the boundary rule that polices
them. Each was applied to a file on disk, **read back from disk to prove the edit landed**, run
against the suites that should catch it, and then restored from a byte copy taken before the edit
— never from `git checkout`.

All eleven are caught. Two of them are only caught because the first attempt at them **survived**,
and the survival was treated as a finding rather than as a result to be re-run until it looked
better. Both survivals are recorded below with what they exposed.

| # | Mutation | File | Result | Caught by |
|---|----------|------|--------|-----------|
| R1 | The page remembers the run in `localStorage` instead of re-reading it | `client/journey.ts` | **CAUGHT** | student page ×3 |
| R2 | The page works out which decision applies from the step, not from `pending` | `client/journey.ts` | **CAUGHT** | student page |
| R3 | An application is requested with no statement of the student's own | `client/journey.ts` | **CAUGHT** | student page |
| R4 | The page hides what distinguishes two colliding routes | `client/journey.ts` | **CAUGHT** | student page |
| R5 | The offer is composed by the page instead of shown as served | `client/journey.ts` | **CAUGHT** | student page |
| R6 | The composer clears before the server has taken the message | `client/journey.ts` | **CAUGHT** | student page |
| R7 | A page with no session draws a journey anyway | `client/journey.ts` | **CAUGHT** | student page |
| R8 | The client's forbidden-capability list loses the orchestrator | `check-boundaries.ts` | **CAUGHT** ¹ | `ci-guard` |
| R9 | The page moves and the boundary rule silently looks at nothing | layout | **CAUGHT** | `boundaries` + `ci-guard` |
| R10 | The transport accepts a body the contract refuses | `client/transport.ts` | **CAUGHT** ² | student page |
| R11 | The page keeps the run it read a moment ago when the re-read fails | `client/journey.ts` | **CAUGHT** ² | student page |

¹ Caught only after the control was rewritten. The boundary **script** does not catch it, and the
audit says so rather than rounding up. See below.
² R10's first version survived, honestly. R11 exists because chasing that survival found a defect.

## R8 — a rule that nothing violates yet is a rule nothing tests

`scripts/check-boundaries.ts` forbids the student's page from importing the orchestrator, the
domain, the case store, the catalogue, the preparation package or `pg` — the capabilities that
would let a browser decide what the run does next.

The mutation removed `@askimate/aas-orchestrator` from that list and ran `pnpm run boundaries`.
It passed. Not because the rule is decorative, but because **the mutation never executed**: the
loop it lives in matches import specifiers in client files, and no client file imports the
orchestrator. There is nothing for a shortened list to fail to match.

That is not coverage, and it is not a control either. The whole value of the rule is in the
future — the day someone reaches for `fold()` in the page because it is right there in the
workspace — and on that day the list will be whatever it has silently decayed into.

So the rule is now asserted **as data**, in `scripts/ci-guard.test.ts`:

```
the client cannot reach the server it is served by
  ✓ names the capabilities a browser must not hold
  ✓ refuses to pass when it is looking at nothing
  ✓ still has client files to look at
```

Re-run with the same mutation:

```
× the client cannot reach the server it is served by > names the capabilities a browser must not hold
  Tests  1 failed | 31 passed (32)
```

The audit records both halves: `boundaries` **SURVIVED (unreachable)**, `ci-guard` **CAUGHT**. The
second is the control; the first is a rule waiting for a violation that has not happened.

## R9 — the vacuity guard, tested by actually making it vacuous

The first version of R9 wrapped the guard's own `if` in `if (false)` and ran the script. It
reported CAUGHT — for an unrelated reason, and that reason was itself a defect in this phase's
work: `playwright` had been added to `apps/conversation-service`, and the boundary script was
failing on that, not on the mutation. (Fixed by moving `playwright` to `forbiddenInProduction`
for that app, which is what it already is for `secure-service` and for the same reason: it is a
test dependency, and `production` is where it must not appear.)

A guard against vacuity cannot be tested by editing the guard. It has to be tested by **making
the situation vacuous**. So R9 now moves `apps/conversation-service/src/client` aside and runs
the real script:

```
✗  No client file found under apps/conversation-service/src/client. This rule polices the
   student's page; a rule looking at nothing passes for the wrong reason.
× the client cannot reach the server it is served by > still has client files to look at
```

Both controls fire, and the directory is moved back and asserted present — with `journey.ts`
inside it — before the case is scored.

## R10 and R11 — a survival that was a defect, not a gap in the harness

R10 deleted the transport's contract check: every read stopped consulting the contract's own
parser and returned whatever came back. **The mutation executed on every single read** and the
suite still passed, because nothing in it ever handed the page a body the contract refuses. The
real server is correct, so the check had nothing to do.

A control whose only evidence is "the server happens to be right" is an assumption about a
service that will be redeployed independently of this page. So the response is now corrupted in
the browser at the network boundary, with `page.route`, exactly as a version-skewed or proxied
server would corrupt it: a **200** with a plausible body whose `runId` is missing.

Chasing that test surfaced a genuine defect in `refresh()`. It read:

```ts
if (run.ok) view.run = run.value;
```

A failed read left the **previous** reading in place, and the page went on drawing it. That is
the client holding workflow state that the server did not just confirm — precisely what ADR-0060
forbids — and concretely it means a decision button still bound to a hash the server has not
just named. The failed half is now cleared and reported, and the target listing is suppressed on
a failed run read, because offering a fresh choice of where to apply to someone who may already
have a case is the most misleading screen this page could draw.

R11 is the regression for that fix: restore the silent-hold behaviour and the same test fails.

```
R10  CAUGHT   × REFUSES a body the contract does not describe, rather than drawing it
R11  CAUGHT   × REFUSES a body the contract does not describe, rather than drawing it
```

## What the page is not tested for, and is not claimed to be

- **The interview question is never shown.** `#putToTheStudent` appends only the *playback*, after
  an answer; the question itself is not in the log, so there is nothing for the page to render. The
  test waits on `pending` instead. This is a real gap in the journey, recorded here and in the test,
  and it is a server-side gap — not this phase's to close.
- **No visual design is asserted.** The document is deliberately empty of content: every sentence a
  student reads comes from the server. A restyle should not touch `journey.ts`.
- **`/dev/session` is how the browser gets a cookie in these tests.** The `__Host-` prefix is
  browser-enforced, so `addCookies` cannot mint one; the route mints a real one, as it does for the
  chat-integration suite.
