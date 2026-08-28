# ADR-0031 — One append-only conversation event log, with message bodies by reference

**Status:** **Accepted** — delegated technical authority, 2026-08-28
**Supersedes:** the two-table arrangement introduced in 0.10.0 (`askimate_messages` +
`askimate_conversation_events`), which was correct for a research build integrating into a foreign
schema and is not correct for an independent product.

## What was wrong with two tables

0.10.0 stored ordinary messages in `askimate_messages` and secure-turn events in
`askimate_conversation_events`, with their positions aligned **by convention**. Two problems, both
structural:

1. **Nothing prevents two rows claiming the same position.** A message at ordinal 4 and an event at
   ordinal 4 are both legal. The transcript's correctness rests on application code getting it right
   every time, forever.
2. **The "no free text on a secure event" property is a convention, not a constraint.** It happens to
   hold because the events table has no content column — but the *reason* it has no content column is
   that somebody remembered.

## The decision

**One append-only log per conversation. A message is one kind of event, and it carries its text by
reference.**

```sql
CREATE TABLE conversation_events (
  id               bigserial PRIMARY KEY,
  conversation_id  bigint      NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  ordinal          integer     NOT NULL,
  kind             text        NOT NULL CHECK (kind IN (
                     'message','secret_requested','secret_received','secret_consumed',
                     'secret_expired','secret_cancelled','secret_rejected')),
  actor            text        NOT NULL CHECK (actor IN ('student','assistant','mentor','system')),
  body_id          bigint      NULL REFERENCES message_bodies(id) ON DELETE SET NULL,
  request_id       text        NULL,
  handle           text        NULL,
  reason_code      text        NULL CHECK (reason_code IS NULL OR reason_code IN (…closed set…)),
  created_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (conversation_id, ordinal),

  CONSTRAINT only_messages_have_bodies
    CHECK ((kind = 'message') = (body_id IS NOT NULL)),
  CONSTRAINT secure_events_name_a_request
    CHECK ((kind = 'message') = (request_id IS NULL)),
  CONSTRAINT only_received_has_a_handle
    CHECK (handle IS NULL OR kind = 'secret_received'),
  CONSTRAINT only_rejection_has_a_reason
    CHECK (reason_code IS NULL OR kind = 'secret_rejected')
);

CREATE TABLE message_bodies (
  id           bigserial PRIMARY KEY,
  content      text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  redacted_at  timestamptz NULL
);
```

## Why the body is a separate table

Three reasons, each sufficient on its own.

**1. The constraint becomes expressible.** With `content` on the event row, "a secure event must not
carry text" is something you ask a person to remember. With a foreign key, `CHECK ((kind = 'message')
= (body_id IS NOT NULL))` asks the database. `UNIQUE (conversation_id, ordinal)` then makes position
collisions impossible rather than merely unlikely.

**2. Erasure without holes.** A GDPR Article 17 request, or the retention policy of
[ADR-0010](./0010-policy-driven-document-retention.md) and
[ADR-0023](./0023-retention-periods-are-determined-not-invented.md), removes a body row and stamps
`redacted_at`. The event survives, so ordinals stay dense, replay stays correct, and the conversation
still reads as a conversation with the text replaced. Deleting a row out of a message table leaves a
gap that every downstream consumer has to reason about.

**3. The proof gets smaller.** "No secret is in the database" becomes "no secret is in
`message_bodies.content`" — one column, permanently, instead of a `FREE_TEXT_COLUMNS` list that grows
every time a table gains a field.

## Why append-only rather than mutable rows

An edit history that overwrites is a history that cannot be audited, and this system has to be able to
answer "what did the model actually see at the time?". Append-only makes the transcript, the model
context and the post-refresh replay **three projections of one list** — which is what
`projectTranscript` already assumes and what the two-table split quietly undermined.

## Consequences

- `replayEvents` becomes an ordinary read of the log rather than a special path. This closes F4, open
  since 0.10.0.
- `FREE_TEXT_COLUMNS` shrinks to one entry, and the adversarial database scan gets correspondingly
  stronger.
- `askimate_users`, `askimate_conversations`, `askimate_messages` as transcribed in 0.10.0 are
  retired. They carried another product's concerns — `is_guest`, `guest_session_id`,
  `needs_expert_review`, `is_user_message`, `password_hash`.
