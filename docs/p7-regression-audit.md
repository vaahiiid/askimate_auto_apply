# P7 — the deliberate regressions, and what an end-to-end journey does not prove

Six regressions against the journey's own properties. Each applied to a clean
tree, **proved to have applied** by reading the file back from disk, gated on a
named check, and reverted byte-for-byte.

| | The regression | Detected by |
| --- | --- | --- |
| **R1** | The run does not read the intent ledger, so the account is created twice | `journey` — *does NOT create a second account for a student who has one* |
| **R2** | An unverifiable half-creation is treated as a completed one | `run-driver` — *does NOT offer work again for an action that may already have happened* |
| **R3** | A cleanly FAILED creation is treated as a successful one | `run-driver` — *does NOT treat a cleanly FAILED creation as an account* |
| **R4** | The account id is random rather than derived | **not detected — see below** |
| **R5** | The account's email is invented rather than taken from the confirmed profile | `account-created` — *takes its email from the CONFIRMED profile* |
| **R6** | An account is `active` even where the portal verifies the email first | `account-created` — *waits for the student where the portal verifies the address* |

## The finding: five of six were invisible to the journey

On the first run, **only R1 was detected**. The other five changed behaviour
only in states the end-to-end journey never reaches — it walks the happy path,
with a confirmed email, an observation saying no verification is needed, and a
creation that succeeded. Every variant those functions decide was unexercised.

That is worth stating plainly, because it is the standing temptation of a phase
called "the end-to-end journey": **an end-to-end test proves the pieces fit. It
is not where the pieces are checked.** The journey was kept as the proof that
four planes, two databases, a real browser and a real portal actually compose;
the properties moved to where they can be varied — `account-created.test.ts` in
the orchestrator, and the intent-verdict tests in the run driver.

## The defect the regressions found

R2 was not merely untested — it was **wrong**. `#withAccountIfCreated` ignored
every verdict but `already_done`, which meant a run whose `create_portal_account`
intent had been *started and never completed* fell through to `create_account`
and was offered to a runner again. An account may already exist on a real portal
in that state, so the run would have created a second one for a student who
already had one — the exact failure `assessIntent`'s comment names, in a
mechanism built on top of it.

`claimWork` now refuses to hand out work for a run with an unfinished
consequential action. The verdict is `verify_first` — look before acting — and
nothing in this system can look yet, so the run stops visibly: its position stays
`creating_account` and no runner is offered it. That is what "a specialist looks
at the portal and says which it was" means while there is no verification
capability to automate.

## R4, and why it is not claimed as tested

The account id is derived (`acct_<runId>`) rather than random, for the same
reason the run id and the case id are: a random value regenerated after a
restart describes something different from what the last request described.

**It has no observable consequence today.** Nothing persists or consumes
`PortalAccount.accountId` — the account is reconstructed from the intent ledger
on each request and used only for its stage, email and plan. So a random id
breaks nothing that any test could see, and inventing a consumer in order to
make an assertion pass would be testing the test.

It is recorded here, and in a comment at the site, as a property held by
construction. When something does consume the id, that is the change that should
bring a test with it.
