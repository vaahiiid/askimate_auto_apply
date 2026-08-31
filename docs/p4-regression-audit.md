# P4 — the deliberate regressions, and what each one proved

Nine regressions, applied one at a time to a clean tree. Each was **proved to
have applied** by reading the file back from disk and asserting both that the
content changed and that the new text is present — never that the anchor is
gone, which is only true for replacements and reported six false negatives when
it was tried in an earlier phase. The named gate was then run and required to
fail on a **named assertion**, and every file was restored byte-for-byte, with
`git diff` checked afterwards.

The harness itself is a throwaway; what is durable is the list below and the
tests that caught each one.

| | The regression | Detected by |
| --- | --- | --- |
| **R1** | The driver returns `null` instead of `secure_plane_unavailable` when no opener is configured, so the run carries on past `request_secret` | `run-driver` — *REFUSES rather than skipping when the plane is unreachable* |
| **R2** | The explanation the model wrote is appended to the conversation log as a message before the lifecycle event | `run-driver` — *puts NO text about a password in the conversation's durable log* (and two others) |
| **R3** | The driver writes a request id it invented instead of the one the Secure Plane minted | `run-driver` — *asks the Secure Plane, and appends the authoritative event* |
| **R4** | The "is a request already live?" guard is dropped, so a second request is opened over a live one | `run-driver` — *does NOT open a second request while the first is live* |
| **R5** | The app mints a frame token locally instead of delegating to the secure-plane port | `run-driver` — *mints the frame capability through the SAME port that opened the request* |
| **R6** | The bootstrap endpoint stops checking the request is open **in this conversation's own log** | `run-driver` — *refuses a bootstrap for a request that is NOT open in this conversation* |
| **R7** | `parseOpened` casts the response body instead of rebuilding it field by field | `check-boundaries` — the P4 secure-client rule |
| **R8** | The loser of a checkpoint race is not sent back to decide again | `run-driver` — *does not create two cases when two starts race*, and *opens ONE request when two starts race* |
| **R9** | The read → open → append sequence is no longer serialised per conversation | `run-driver` — *opens ONE request when two starts race for the same conversation* |

## The three worth explaining

**R1 is the one that costs a student an account.** A run that walked past a
password it could not ask for would create a portal account with no credential
the student could ever use — and would look, from the outside, like a successful
run. The refusal is what makes an unreachable Secure Plane a visible stop rather
than a silent one, and it is why `secure_plane_unavailable` is a refusal kind
rather than a logged warning.

**R2 is the whole reason the contract does not echo the title back.** The title
this plane composes and the explanation the model writes both cross to the
Secure Interaction Service, which stores them and renders them inside the frame.
Neither comes back, so this plane has nothing to write down. The test does not
check a type — it scans every row of `conversation_events` for this conversation
and requires that no row's text contains the word at all. R2 puts one there; the
scan finds it.

**R5 is the drift that would look like an expiry.** Opening a request and
minting a frame token are two calls to the same service, and until P4 they could
have been wired to two different ones. A deployment that opened against service
A and minted against service B would answer `not_found` for every bootstrap, and
the student would see a secure step that never loads — indistinguishable, from a
support ticket, from a request that timed out. Wiring both through one
`SecureRequestOpener` makes them unable to disagree; R5 breaks the delegation and
the test names the token that came back as locally invented.

## The concurrency defect this phase surfaced

R8 and R9 exist because wiring the secure open into the driver **exposed a real
race that had been latent since P1**, and then a second one that was new.

`withBinding` serialises bind → open case → start run and then releases, so two
callers racing to start the same conversation both leave the critical section
holding a record at the same revision and both write a checkpoint against it.
One wins; the other got an uncaught `RunConcurrencyError`, which a student would
have seen as a 500. It passed before this phase only because the window was
narrow enough to miss — the extra log read P4 adds widened it, and the full suite
failed on it under load. The fix is the one the error's own message names:
re-load and decide again, bounded at three attempts.

The second race is the one that matters more. The checkpoint is **not** a mutex
for "ask the student for a password": two callers advancing the same conversation
can both hold a valid revision, because the second loads the record after the
first has already checkpointed and nothing conflicts. Both then read a log with
no live request in it and both ask. The student watches one secure box be
replaced by another, and whichever they type into settles a request the run is no
longer watching.

So the read → open → append sequence is serialised per conversation. The obvious
implementation — `SELECT … FOR UPDATE` on the conversation row, as `withBinding`
uses — **deadlocks**, and was written that way first: appending an event updates
`conversations.last_ordinal` on a different connection, so the transaction
holding the row waits for the append that is waiting for the row. It hung rather
than failed. An advisory lock is a lock on a name, excludes only other holders of
that name, and lets the append through.

The test that catches this is deterministic rather than lucky: the stub opener
delays its answer by 150ms, which guarantees the second caller reads the log
before the first has appended. Without the delay the race resolves by timing and
the test passes whether or not the lock is there — R9 was recorded as **not
detected** on the first attempt for exactly that reason, and the delay is what
turned it into a real proof.

## What is deliberately not regression-tested here

**The open-then-append window.** The secure request is opened first because the
event needs the id the open produces, so a crash between the two leaves an
orphaned secure request the conversation log does not know about. That is not a
defect to detect — it is the safe direction, chosen: the student is never shown a
box for a request their log has no record of, the orphan expires within the
five-minute ceiling of ADR-0034, and the next call opens a fresh one. The
opposite order would put a request id in a durable log that no secure service
ever minted.
