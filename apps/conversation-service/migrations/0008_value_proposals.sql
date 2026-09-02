-- ── The interview's proposal exchange (ADR-0051) ─────────────────────────
--
-- A reading the agent understood from what the student said, the playback it
-- was shown as, and their answer to it.
--
-- ON THIS LOG, and not the case log, because a proposal is NOT a fact about
-- the application. It is a fact about the conversation — "this is what we
-- understood, and this is what we showed you" — and it becomes a fact about
-- the application only when the student agrees, at which point it lives in the
-- confirmed profile. ADR-0031 reserves the case log for business facts.
--
-- Beside the playback message it is about, because the confirmation is bound
-- by a hash of that message and the two need one ordinal sequence to be
-- ordered by. `secret_requested` is the precedent: a pending, non-message,
-- structurally-typed event on this log, closed by a later one.

ALTER TABLE conversation_events
    DROP CONSTRAINT conversation_events_kind_check;

ALTER TABLE conversation_events
    ADD CONSTRAINT conversation_events_kind_check CHECK (kind IN (
        'message',
        'secret_requested',
        'secret_received',
        'secret_consumed',
        'secret_expired',
        'secret_cancelled',
        'secret_rejected',
        'value_proposed',
        'value_confirmed',
        'value_rejected'));

-- ── Why `secure_events_name_a_request` had to be rewritten ───────────────
--
-- It read `CHECK ((kind = 'message') = (request_id IS NULL))`: every kind that
-- is not a message names a secure request. That was correct only while every
-- non-message kind WAS a secure one. Stated as a complement it would now
-- demand a request id from a value proposal, which has nothing to do with a
-- secure request.
--
-- The replacement names the secure kinds explicitly and keeps both halves of
-- the original guarantee: a message never names a request, and every secure
-- event does.
ALTER TABLE conversation_events
    DROP CONSTRAINT secure_events_name_a_request;

ALTER TABLE conversation_events
    ADD CONSTRAINT secure_events_name_a_request CHECK (
        (kind IN ('secret_requested', 'secret_received', 'secret_consumed',
                  'secret_expired', 'secret_cancelled', 'secret_rejected'))
        = (request_id IS NOT NULL));

-- Which field the exchange is about. A closed shape rather than free text:
-- a profile field key, as `ProfileFieldKey` writes them.
ALTER TABLE conversation_events
    ADD COLUMN field_key text CHECK (field_key IS NULL OR field_key ~ '^[a-z_]+\.[a-z_]+$');

-- ── The one place a non-message event holds student data ─────────────────
--
-- `only_messages_have_bodies` exists so a secure event cannot hold what a
-- student typed, and it is unchanged: none of these kinds has a body.
--
-- This column is a deliberate, narrow exception to the SPIRIT of that rule and
-- is worth naming as one. It holds the structured reading — a date, a name —
-- and it is the same data the playback message beside it already holds in
-- prose. It is stored rather than re-parsed from that message on confirmation,
-- because re-parsing would depend on `render ∘ parse` being lossless for every
-- field spec and would fail silently where it is not.
--
-- Only a proposal may have one. A confirmation carries no value: what was
-- agreed is the proposal the hash names.
ALTER TABLE conversation_events
    ADD COLUMN proposal jsonb;

-- The hash of the playback text the student was shown. On the proposal, and on
-- the confirmation that answers it, so "what exactly did I agree to?" is
-- answerable from two events and the message between them.
ALTER TABLE conversation_events
    ADD COLUMN playback_hash text CHECK (playback_hash IS NULL OR playback_hash ~ '^sha256:[0-9a-f]{64}$');

ALTER TABLE conversation_events
    ADD CONSTRAINT a_proposal_exchange_names_a_field CHECK (
        (kind IN ('value_proposed', 'value_confirmed', 'value_rejected'))
        = (field_key IS NOT NULL));

ALTER TABLE conversation_events
    ADD CONSTRAINT only_a_proposal_carries_a_value CHECK (
        (kind = 'value_proposed') = (proposal IS NOT NULL));

ALTER TABLE conversation_events
    ADD CONSTRAINT a_playback_hash_belongs_to_the_exchange CHECK (
        (kind IN ('value_proposed', 'value_confirmed')) = (playback_hash IS NOT NULL));

-- The open proposal for a conversation, if any.
--
-- A view rather than a query in the application, for the reason
-- `open_secret_requests` is one: "which is open" is a rule about the log, and a
-- rule written in the application is a rule each caller can get subtly wrong.
-- Deliberately contains no `now()` — a proposal does not expire, and a view
-- that read the clock would make its answer untestable.
CREATE VIEW open_value_proposals AS
    SELECT p.conversation_id, p.ordinal, p.field_key, p.proposal, p.playback_hash
      FROM conversation_events p
     WHERE p.kind = 'value_proposed'
       AND NOT EXISTS (
           SELECT 1 FROM conversation_events answer
            WHERE answer.conversation_id = p.conversation_id
              AND answer.ordinal > p.ordinal
              AND answer.kind IN ('value_confirmed', 'value_rejected'));
