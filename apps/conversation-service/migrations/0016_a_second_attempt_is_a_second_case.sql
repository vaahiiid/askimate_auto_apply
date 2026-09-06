-- 0016 · The system advised on a re-application, and said what it advised.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ADR-0006 §3, as amended in P38. A re-application opens a NEW case that
-- references the prior one; the wait recommendation is "advisory in effect but
-- MANDATORY in presentation — the system must show it before accepting the
-- instruction, and must record that it did".
--
-- This is that record. `reapply` reads it, and refuses an instruction with no
-- advice before it, so rule 4 is a fact about the log rather than a promise the
-- application keeps.
--
-- Modelled on 0012's target exchange, which is modelled on 0008's value
-- exchange: the structured event carries the facts, and the words the student
-- read are the assistant message beside it. Nothing here holds prose, so
-- `only_messages_have_bodies` is untouched.
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
        'target_requested',
        'reapplication_advised'));

-- The concluded application a second attempt would follow. Bounded like every
-- other identifier column; NOT a foreign key, because case logs live in the
-- case store's own tables and this service's `cases` table is a binding record
-- rather than the case itself.
ALTER TABLE conversation_events
    ADD COLUMN prior_case_id text
        CHECK (prior_case_id IS NULL OR length(prior_case_id) BETWEEN 1 AND 128);

-- What the STUDENT says happened to it. A claim, never a fact this system
-- established: MVP responsibility ends at submission confirmation and there is
-- no journey tracking (brief §2.8), so AAS does not know of its own accord
-- that an application was rejected. The closed set is the same one
-- `PriorOutcomeAssertion.outcome` names.
ALTER TABLE conversation_events
    ADD COLUMN prior_outcome text
        CHECK (prior_outcome IS NULL OR prior_outcome IN ('rejected', 'withdrawn'));

-- What we advised. `none` is a real answer, not an absence: it records that the
-- circumstances did not warrant advising a wait, which is a different fact from
-- never having advised at all.
ALTER TABLE conversation_events
    ADD COLUMN advice text
        CHECK (advice IS NULL OR advice IN ('next_intake', 'six_months', 'none'));

-- The intake we suggested instead. Same shape the catalogue's intake refs use.
ALTER TABLE conversation_events
    ADD COLUMN suggested_intake text
        CHECK (suggested_intake IS NULL OR suggested_intake ~ '^[0-9]{4}-[0-9]{2}$');

-- All three facts belong to the exchange, and to nothing else. One constraint
-- over the three rather than three: they are one event's payload, and a row
-- carrying two of them would be a half-written record of advice.
ALTER TABLE conversation_events
    ADD CONSTRAINT advice_belongs_to_the_reapplication_exchange CHECK (
        (kind = 'reapplication_advised')
        = (prior_case_id IS NOT NULL AND prior_outcome IS NOT NULL AND advice IS NOT NULL));

-- An intake is suggested only WITH the advice to wait for one. Without this a
-- row could say `six_months` and name an intake, which is advice nobody gave.
ALTER TABLE conversation_events
    ADD CONSTRAINT an_intake_is_only_suggested_with_the_advice_to_wait CHECK (
        (advice = 'next_intake') = (suggested_intake IS NOT NULL));

-- The advice given in one conversation, in order.
--
-- A view for the reason `conversation_target_exchange` is one: "was the
-- recommendation shown, and what was it?" is a rule about the log, and the
-- driver reading it here rather than filtering the whole log itself is what
-- keeps the rule in one place.
CREATE OR REPLACE VIEW conversation_reapplication_advice AS
SELECT conversation_id,
       ordinal,
       prior_case_id,
       prior_outcome,
       advice,
       suggested_intake,
       created_at
  FROM conversation_events
 WHERE kind = 'reapplication_advised';

COMMENT ON VIEW conversation_reapplication_advice IS
    'Wait recommendations shown to a student before a re-application, per '
    'ADR-0006 rule 4. An instruction with no row here for its prior case is '
    'refused: the recommendation is advisory in effect and mandatory in '
    'presentation.';
