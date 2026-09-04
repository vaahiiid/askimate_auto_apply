-- 0014 · The question the run is waiting on.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ADR-0062. `nextAction` composes an interview question during step
-- derivation, the step carries it, and the run driver threw it away. A student
-- sitting at `interviewing` saw nothing to answer: the interview was a
-- conversation with one voice.
--
--   value_asked   the service put a question about this field to the student.
--                 The assistant message beside it is what they read.
--
-- Modelled on 0008's value_proposed, and for the same reason that one exists:
-- "what exactly was I asked, and what did I say?" should be answerable from the
-- log rather than by re-running a model.
-- ═══════════════════════════════════════════════════════════════════════════

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
        'value_asked',
        'value_proposed',
        'value_confirmed',
        'value_rejected',
        'target_offered',
        'target_requested'));

-- ── Widened, not weakened ────────────────────────────────────────────────
--
-- 0008's constraint said a `field_key` belongs to the value exchange and to
-- nothing else. A question about a field IS that exchange — it is the turn the
-- exchange was missing — so the kind joins the list rather than the constraint
-- becoming vaguer. Every other kind still may not carry one.
ALTER TABLE conversation_events
    DROP CONSTRAINT a_proposal_exchange_names_a_field;

ALTER TABLE conversation_events
    ADD CONSTRAINT a_proposal_exchange_names_a_field CHECK (
        (kind IN ('value_asked', 'value_proposed', 'value_confirmed', 'value_rejected'))
        = (field_key IS NOT NULL));

-- `only_a_proposal_carries_a_value` and `a_playback_hash_belongs_to_the_exchange`
-- are deliberately untouched. A question carries neither: there is no value yet,
-- and nothing to confirm against a hash — what the student agrees to is the
-- READING, later, and binding a hash here would invite confirming a question.

-- The question outstanding for a conversation, if any.
--
-- A view rather than a query in the application, for the reason
-- `open_value_proposals` is one: "which is open" is a rule about the log, and a
-- rule written in the application is a rule each caller can get subtly wrong.
--
-- Answered or superseded by any of four things. A student MESSAGE closes it
-- even when nothing could be read from it — they answered, the reading failed,
-- and they are owed a fresh question rather than the same one standing open
-- for ever.
--
-- No `now()`: a question does not expire, and a view that read the clock would
-- make its answer untestable.
CREATE VIEW open_value_questions AS
    SELECT q.conversation_id, q.ordinal, q.field_key
      FROM conversation_events q
     WHERE q.kind = 'value_asked'
       AND NOT EXISTS (
           SELECT 1 FROM conversation_events answer
            WHERE answer.conversation_id = q.conversation_id
              AND answer.ordinal > q.ordinal
              AND (answer.kind IN ('value_proposed', 'value_confirmed', 'value_rejected')
                   OR (answer.kind = 'message' AND answer.actor = 'student')));
