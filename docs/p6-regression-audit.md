# P6 — the deliberate regressions, and the two tests they forced

Ten regressions against account creation and the protected fill, each applied to
a clean tree, **proved to have applied** by reading the file back from disk and
asserting both that the content changed and that the new text is present, then
gated on a named check and required to fail. Every file restored byte-for-byte;
`git diff` checked afterwards.

| | The regression | Detected by |
| --- | --- | --- |
| **R1** | The agent stops checking that fields are masked, so nothing establishes the set before spending | `fill` — *refuses when the CONFIRMATION box is not masked* |
| **R2** | Only the FIRST field is checked for masking | `fill` — the same test |
| **R3** | The agent types into only the first locator | `account-creation-e2e` — *creates one on a REAL gated portal* (the portal's own confirmation check fails) |
| **R4** | The runner submits the form BEFORE the password is typed | `account-creation-e2e` — the same test |
| **R5** | The runner stops checking the form is on the bound host | `account-creation-e2e` — *REFUSES a registration URL that is not on the bound host* |
| **R6** | The runner opens an ORDINARY context, so tracing is available while a password is typed | `account-creation-e2e` — `fillSecret` throws `SecretIntoTracedContextError` |
| **R7** | A click that never lands is reported as a CLEAN failure | `account-creation-e2e` — *reports UNCERTAIN when the portal stops answering mid-submit* |
| **R8** | The work item's registration URL is not bound to the work's host | `run-driver` — *REFUSES a blueprint whose form is on a different host from its sign-in* |
| **R9** | The deployment origin moves the form but not the bound host | `run-driver` — *points a reviewed blueprint at the DEPLOYMENT's origin* |
| **R10** | `RegistrationTargets` grows a `defaultPassword` field | `tsc` — `REGISTRATION_CARRIES_ONLY_TARGETS` |

## The two that were NOT detected first time

**R7 had no test at all.** Changing `uncertain` to `failed` for a click that
never lands broke nothing, because nothing in the suite ever reached a click
that did not land. That is the most consequential distinction in the whole
mechanism: the click may have reached the portal and the account may exist, and
`failed` asserts that nothing happened on a university's system — a claim about
somebody else's database that nobody in the runner is entitled to make.

The test now stands up a server that serves the registration form and **never
answers the POST**. Not contrived: it is what a portal under load, or behind a
proxy that drops the connection, looks like from the runner. The password is
really typed and the handle is really spent before the click hangs, which is
exactly why the answer has to be "we do not know".

**R8's property was never exercised.** Every blueprint in the suite has its
registration page and its sign-in page on one host, so removing the check that
they agree changed nothing observable. The new test builds a blueprint whose
register page is on another host and requires the claim to be refused — and to
take no lease on the way to refusing. `portalHost` is what the secure request
binds the handle to and what the fill agent checks the live page against, so a
form elsewhere would mean opening a browser at host A holding a handle bound to
host B: refused by the agent, correctly, and a long way from the blueprint that
caused it.

> Same lesson as P4 and P5, and it keeps being worth the cost: a green suite is
> evidence only about the paths the tests take. Breaking things on purpose is
> how you find out which guard your tests are actually standing on.

## One thing the harness itself got wrong

The first version of the "no password in any log line" assertion checked that no
line contained `String(PASSWORD.length)` — the string `"26"`. That occurs inside
essentially any hex request id, so the assertion failed on a run where nothing
had leaked. It was replaced with two checks that cannot fail for the wrong
reason: no six-character run of the password appears anywhere (which also
catches a well-meaning "log the first few characters" change), and no log line
carries a `length=`, `size=`, `strength=` or `chars=` key at all.

## What is deliberately not regression-tested here

**That a compromised runner cannot read the field it had filled.** It can —
`readValue` on its own session is one call, and the runner owns the browser.
ADR-0042 records this as the honest residual rather than pretending otherwise;
what the architecture protects is the password's existence *outside* the browser
— in a heap, a log, an error object, a crash dump, a KMS grant. The boundary
rule added in this phase forbids `inputValue()` in `create-account.ts` because a
call in the shipped path is a different thing from a capability the architecture
concedes, but that rule is hygiene, not a security boundary, and it is not
claimed as one.
