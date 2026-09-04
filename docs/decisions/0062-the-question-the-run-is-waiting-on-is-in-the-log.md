# ADR-0062 — The question the run is waiting on is in the log

**Status:** **Accepted** — 2026-09-04
**Completes:** [ADR-0051](./0051-the-student-supplies-through-the-conversation.md) — it closed the
loop for the student's *answer*, and left the *question* uncollected
**Found by:** [ADR-0060](./0060-the-conversation-service-owns-the-student-surface.md) — the first
real client, which had nothing to render while the run said `interviewing`

## The measurement that produced this ADR

P25 built the student's page. Driving it through a full case, the interview stop drew a blank
screen: the run said `interviewing`, `pending` said nothing was awaited, and the transcript held
no question. The test that reached this state had to be written to wait on `#pending` containing
the word "interview" — because there was no question to wait for — and the gap was recorded rather
than papered over.

The cause is one line in `packages/orchestrator/src/run.ts`:

```ts
return { kind: "interview", action: await nextAction(state.interview, model) };
```

`nextAction` composes the question. The step carries it. **And the run driver throws it away.**

This is the same shape ADR-0051 opened with — *"the orchestrator composed questions and the run
driver threw them away"* — and the fix then went only half the distance. `answerStudent` was wired
to the message route, so an *answer* now becomes a `value_proposed` and a playback the student can
read. But nothing ever wrote the question that answer was answering. Every test that exercised the
interview supplied the answer from the test process, which is why nothing noticed: a test that knows
the question does not need it in the log.

So the interview was a conversation with one voice.

## The decision

**A question put to the student is an event in the conversation log, exactly as a reading is.**

Two writes, the same shape and the same order as `#putToTheStudent`:

| Event | Carries | Why |
|---|---|---|
| `value_asked` | `fieldKey` | the durable record that this field was asked about, so a second advance does not ask again |
| `message` (assistant) | the orchestrator's own `action.say` | what the student reads |

The text is **the step's own** — `interviewActionOf(step).say`, composed once by `nextAction` during
step derivation — not a second composition. A driver that called the model again could ask a
different question from the one the step is waiting on, which is the class of drift ADR-0059 refused
for the preview and ADR-0051 refused for the playback.

### Asked once, by the log

`openQuestion(events)` is the last `value_asked` with nothing after it that answers or supersedes
it: a student `message`, or any of `value_proposed`, `value_confirmed`, `value_rejected`. It is the
same reading `openProposal` makes, and the same reading `latestSecretRequest` makes of the secure
lifecycle — *which is open* is a rule about the log, so it is written once and read everywhere.

That gate is what makes the append idempotent without a marker column. A poll of a run already
waiting on the student finds a question outstanding and writes nothing, exactly as `#raiseHandoff`
is idempotent by token and `#openSecureStep` is idempotent by the live request in the log.

Under the conversation's row lock, with the log re-read **inside** it, for the reason
`#openSecureStep` takes that lock: two callers advancing the same conversation can both hold a
valid run revision, so the optimistic lock never fires, and both would otherwise find an empty log
and both ask.

### Where it is called from, and where it is not

Three moments can leave a question outstanding, and each is a place the driver already writes:

- **`#decideOnce`** — the run reaches `interviewing` for the first time.
- **`#confirmValue`** — a reading was accepted, so the next field is now the one wanted.
- **`answerStudent`**, on an answer the model could not read at all — the student said something,
  it did not land, and they are owed the question again.

It is **not** called from `runFor`, `previewFor`, or `#situation`. Those are reads, and a read that
appended an event would make polling a mutation — the same line ADR-0061 drew.

### What this does not change

**The attempt count.** `attemptsFrom` counts proposals superseded and readings rejected, and its own
comment says an answer the model could not read leaves no event and therefore does not count. A
`value_asked` now exists and *could* carry that counter, but making it do so would change when
`information_unobtainable` fires — a behavioural change to an escalation, not a gap in the journey.
Left alone deliberately, and named here so the next reader does not have to rediscover that it was a
choice.

## Consequences

- The student sees what they are being asked. The interview is usable by someone who is not holding
  the test fixture.
- One more event kind, one more migration, and `a_proposal_exchange_names_a_field` widened to
  include it — the constraint keeps saying exactly which kinds carry a `field_key`.
- The question is answerable after the fact: *"what was I asked, and what did I say?"* reads off
  `value_asked` → student `message` → `value_proposed` → `value_confirmed`, four events and the two
  rendered messages between them.
- A client renders the interview with no workflow knowledge at all: the question is a message like
  any other, and `pending` still names only decisions.
