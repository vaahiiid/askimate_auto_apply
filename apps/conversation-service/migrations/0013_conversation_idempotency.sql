-- 0013 · An idempotency key may name a conversation, not only an event.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ADR-0060. `POST /v1/conversations` is the first step of the student journey
-- and it had no implementation, so nothing had ever needed to make one
-- repeatable. `idempotency_keys` was built for the message endpoint and its
-- only result column is `event_id` — a conversation is not an event, and a
-- retried create would otherwise leave a second empty conversation behind.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE idempotency_keys
    ADD COLUMN conversation_id text
        REFERENCES conversations(id) ON DELETE CASCADE;

-- Exactly one result, never both and never neither.
--
-- Written as an equality on two booleans rather than as three OR'd clauses,
-- for the reason the target-exchange constraints in 0012 are: a constraint
-- that says "exactly one" is checkable at a glance, and a row that names both
-- an event and a conversation would be a key whose replay had two answers.
ALTER TABLE idempotency_keys
    ADD CONSTRAINT a_key_names_one_result CHECK (
        (event_id IS NOT NULL) <> (conversation_id IS NOT NULL));
