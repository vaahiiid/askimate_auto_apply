-- 0005 · How many times an action was actually attempted, and which secret the
--        last attempt spent (ADR-0114).
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ── Still ONE row per (run, action, target) ──────────────────────────────
--
-- The primary key is unchanged, and so is what `interventions.idempotency_key`
-- pairs with. A second attempt is not a second row (ADR-0054); what a reopen
-- lost until now was any memory that there had been a first. Vahid,
-- 2026-09-15: *"Blocker 26: C, and the number is two."* — *"once is chance,
-- twice is the portal."* The number has to be counted somewhere durable, and
-- this is the row that already records each attempt's start and end.
--
-- ── `attempts_made` counts attempts against the WORLD, not hand-outs ─────
--
-- A runner handed a password it could not use attempted nothing on the
-- portal: it is completed `failed_cleanly` (nothing happened out there) with
-- the count untouched. The caller says which it was; this table records it.
-- A reopen leaves the count alone — that is the point of it.
--
-- ── `spent_secret_request_id` is an id, never a secret ───────────────────
--
-- `sr_` and 32 hex digits: the Secure Plane's request id, which resolves to
-- nothing outside its vault (ADR-0026). It says which box's password the
-- attempt was handed, so a handle spent on a failed attempt is never offered
-- to the next one, and the Secure Plane's own `secret_consumed` — which
-- arrives through an outbox, later — is not what the decision waits on.
-- Cleared by a reopen: it describes the completed attempt, not the row.
ALTER TABLE workflow_action_intents
    ADD COLUMN IF NOT EXISTS attempts_made integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS spent_secret_request_id text;

-- A spent secret belongs to a completed attempt. A reopened row (outcome NULL)
-- carries none, so the two cannot describe different attempts.
ALTER TABLE workflow_action_intents
    DROP CONSTRAINT IF EXISTS workflow_action_intents_spent_secret_is_completed;
ALTER TABLE workflow_action_intents
    ADD CONSTRAINT workflow_action_intents_spent_secret_is_completed
        CHECK (spent_secret_request_id IS NULL OR outcome IS NOT NULL);
