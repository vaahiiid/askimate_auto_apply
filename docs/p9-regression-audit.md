# P9 — the deliberate regressions, and the two properties that had no test

Nine regressions against ADR-0047's page progress, each applied to a clean tree,
proved to have applied by reading the file back from disk, gated on a named
check, and reverted byte-for-byte.

| | The regression | Detected by |
| --- | --- | --- |
| **R1** | Every page shares one intent again, so page two is never offered | `journey` — *RESUMES on the second page after a restart* |
| **R2** | A page already saved is offered again | `run-driver` — *offers the SECOND page once the first is recorded, and never the first again* |
| **R3** | An unfinished page is handed out anyway | `run-driver` — *STOPS the run when a page's save may or may not have landed* |
| **R4** | Only the next page's uncertainty stops the run, not an earlier one | `run-driver` — *stops the run for an EARLIER page's uncertainty* |
| **R5** | The lease stops naming the page it holds | `journey` — the report keys the wrong intent and page two is never offered |
| **R6** | The run is filled while a page still remains | `run-driver` — *offers NOTHING once every page is recorded, and the run is filled* |
| **R7** | A run with no page ever saved is marked filled | `run-driver` — *does NOT call a run filled when no page was ever saved* |
| **R8** | The portal lets page two be reached without page one | `fixture-portal` — *will not show page two until page one is saved* |
| **R9** | An account-creation lease may name a page | `schema` — *refuses an account-creation lease that names a page* |

## The two that were NOT detected first time

**R9 — the CHECK constraint had no test.** `work_leases_only_fill_names_a_page`
was written with the migration and nothing exercised it, so removing it changed
nothing observable. The schema suite now asserts both halves: an
account-creation lease naming a page is refused, and a fill lease naming one is
accepted. Both halves, because a constraint that refuses everything passes the
first assertion and is useless.

**R7 — the test could not reach the property.** `markFilled` must mean *a page
was actually saved*, not *no page remains*; the two differ for a blueprint whose
only mapped fields are on the registration page, which the Secure Plane and
account creation complete between them. Without the distinction such a run
reports `ready_to_submit` having typed nothing into the application.

The first version of that test built the run and asserted the step — and passed
either way, because the run stopped at `authorise` long before `markFilled`
mattered. It now records the account's intent and captures the student's
authorisation first, so the only thing left deciding the answer is the property
under test.

That is the same failure the P7 audit describes, in a new place: a test that
never reaches the branch it is about proves nothing, and looks exactly like a
test that does.

## A finding worth recording: the mapping layer refused the first fixture

The R7 test originally trimmed the blueprint to its registration page and left
the mapping set alone. `checkUsable` refused the pair — a mapping set may not
target fields the blueprint does not have — and the run was refused with
`unusable_mapping_set` before anything under test ran.

That is the mapping layer doing exactly its job, on a test fixture, and it is
worth writing down: the same refusal is what would stop a real blueprint being
re-reviewed without its mapping set.

## What this phase deliberately does not do

**Self-heal a page that cannot be reached.** A portal that will not navigate to
page three until something happens elsewhere leaves a stuck run, reported as
such. Resolving it needs a verification capability this system does not have —
the same gap `assessIntent`'s `verify_first` verdict names, and the same reason
an uncertain page stops the run rather than being retried.

**Re-offer work the instant a page fails.** The claim path narrows candidates by
the checkpoint's phase, which is a cache refreshed by `advance`. In the real flow
a cleanly-failed page leaves the checkpoint at `filling`, so the run stays a
candidate — but a run whose checkpoint has moved past `filling` for another
reason would wait for its next advance. That is visible in the driver tests,
where three of them reset the phase after moving the ledger backwards, with a
comment saying why: no production path moves it backwards.
