-- 0036: a resolution carries its own mark (P259).
--
-- Decided by Vahid on 2026-10-01, in his words: *"the resolution carries its
-- own mark on the log, not the asking's attempt. … The asking's attempt
-- number means 'this is the Nth time I asked'; borrowing it to mean 'a person
-- intervened and the count starts again' makes one field carry two meanings,
-- and the next person reading the log cannot tell a fresh asking from a
-- reset one. … I would rather pay a migration than add another."*
--
-- A seventeenth event kind, `stop_resolved`, written by the resolution of an
-- interview stop before the question it puts out again. It names the field
-- (so it joins the field-key constraint) and carries nothing else: who
-- resolved the stop and why is on the intervention row. The failed-answer
-- count the stop rule reads (P256, ADR-0152) begins again at it.
--
-- Nothing is backfilled: no resolution before 0.254.0 ever resumed an
-- interview stop, and 0.254.0's resumption wrote its asking as attempt 1,
-- which this migration leaves as the record of what that version did.

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
        'value_offered',
        'value_part_read',
        'value_part_demanded',
        'value_confirmed',
        'value_rejected',
        'answer_unread',
        'stop_resolved',
        'target_offered',
        'target_requested',
        'reapplication_advised'));
ALTER TABLE conversation_events
    DROP CONSTRAINT a_proposal_exchange_names_a_field;
ALTER TABLE conversation_events
    ADD CONSTRAINT a_proposal_exchange_names_a_field CHECK (
        (kind IN ('value_asked', 'value_proposed', 'value_offered', 'value_part_read',
                  'value_part_demanded', 'value_confirmed', 'value_rejected', 'answer_unread',
                  'stop_resolved'))
        = (field_key IS NOT NULL));
