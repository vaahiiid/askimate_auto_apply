# P22 — deliberate regression audit

Thirteen mutations, each applied to a source file on disk, **read back from disk to prove the edit
landed**, run against the suites that should catch it, and then restored from a byte copy taken
before the edit — never from `git checkout`, because a restore that consults version control cannot
distinguish "put back" from "was never changed".

Ten were caught on the first pass. Three survived. All three are now caught.

| # | Mutation | File | Result | Caught by |
|---|----------|------|--------|-----------|
| R1 | The preview route stops checking who owns the conversation | `routes.ts` | **CAUGHT** | driver e2e |
| R2 | The preview is served cacheable | `routes.ts` | **CAUGHT** | driver e2e |
| R3 | A run that is **not at the gate** still returns a preview | `run-driver.ts` | **CAUGHT** ¹ | driver e2e |
| R4 | The text and the hash come from two different renderings | `run-driver.ts` | **CAUGHT** | driver e2e, journey |
| R5 | `renderPreview` starts listing the credential fields | `preview.ts` | **CAUGHT** | preparation |
| R6 | The preview stops naming the reference the approval binds to | `preview.ts` | **CAUGHT** | preparation, journey |
| R7 | The preview is summarised instead of shown in full | `preview.ts` | **CAUGHT** | preparation, journey |
| R8 | The authorise stop goes silent again | `run-driver.ts` | **CAUGHT** | driver e2e |
| R9 | The announcement is written on every advance, not once | `run-driver.ts` | **CAUGHT** | driver e2e |
| R10 | The announcement carries the application itself | `run-driver.ts` | **CAUGHT** | driver e2e |
| R11 | The contract parser accepts a preview with no text | `runs.ts` | **CAUGHT** ¹ | contracts |
| R12 | The contract parser accepts any hash shape | `runs.ts` | **CAUGHT** ¹ | contracts |
| R13 | The preview may be serialised after all | `preview.ts` | **CAUGHT** | preparation |

¹ Survived the first pass. See below.

## The three that survived, and what they were hiding

### R3 — the named control was shadowed by the check in front of it

`previewFor` returns `null` unless `awaitsStudentAuthorisation(step)`. Removing that check broke
nothing, because the only test covering it asked for **a run that does not exist** — so
`runs.load` returned `null` and the method returned before the guard was reached. The test named the
property and never touched it.

The replacement asks for a run that is real, belongs to this student, and has simply not got as far
as asking: started, standing at its first step. There is nothing to approve, and the test now proves
that "nothing to approve" does not render as an empty application. The old case is kept as a second
test, because the two answering *identically* is itself the property — a client able to tell them
apart could probe which of another student's runs exist.

This is the same shape as P21's R3 and P20's R3, and the pattern is worth naming: **a refusal test
that reaches the refusal through the cheapest possible input usually reaches a different refusal.**

### R11 and R12 — a parser whose refusals nothing asked for

`parseRunPreview` refuses an empty `presentedText` and a hash that is not `sha256:<64 hex>`. Both
mutations passed the whole suite, because every test fed it a well-formed preview: the parser was
exercised only on its accepting path.

That matters more than it looks. The parser is what a client uses to decide whether the bytes it got
are a preview, and both refusals guard a real failure: an empty rendering would put a blank page in
front of a student to approve, and a hash of any shape would be sent back to the decision route to
be refused there, far from the cause. Six bad hashes and three bad texts are now asserted directly.

## What the exercise confirmed about the design

**The two halves really are coupled.** R4 changes `presentedText` alone, leaving the hash correct —
and the journey fails at the *fill*, not at the read: the student approved a hash for content they
were not shown, and the difference surfaced three steps later. That is exactly the failure the
one-call shape exists to prevent, and it is why the route does not compose its own text.

**The credential omission is a real absence, not the fixture's.** R5 is caught by a test that hands
`renderPreview` a preview *carrying* a credential — added during this phase precisely because the
first version of that test looped over an empty list and asserted nothing.

**The announcement is idempotent by construction, not by a flag.** R9 widens the hop so it fires on
every advance, and it is caught immediately — but note *where*: by the driver's own coordination
tests, because widening the hop breaks the case walk as well. The announcement rides on a transition
that already happens exactly once; it needed no marker column, and R8/R10 confirm it says something
and says only that.

## Scope note

Nothing here fabricated review evidence, invented a blueprint, or approved an artefact through
production code. No test in this phase re-derives a preview in order to *pass* — `journey.test.ts`
still re-derives one, but only to assert that the route served the same content the run will fill
from, which is the opposite use.
