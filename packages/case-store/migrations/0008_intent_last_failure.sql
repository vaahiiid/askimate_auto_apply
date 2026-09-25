-- 0008 · The code the LAST completion closed with, attempt or not (ADR-0144).
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ── Still ONE row per (run, action, target) ──────────────────────────────
--
-- 0006 gave the row the codes of the attempts MADE, and drew the line the
-- count draws: a hand-out that reached no page appends nothing. That line is
-- right for the count and wrong for one question the Run Driver has to
-- answer from this row alone — WHY did the last completion close, when it
-- closed without an attempt?
--
-- The case that needs it (P219): the account creation met the portal's
-- consent notice before it typed anything (`consent_banner_met`). That is
-- not an attempt — nothing was typed, no password was spent, the count is
-- untouched — and it is also the one fact the next advance has to know, so
-- the run's next step is the student's choice on the notice rather than a
-- second hand-out onto the same notice. The sign-in keeps the same fact in
-- its own session record (0021, 0022); the creation has no session yet, and
-- this row is its only durable memory.
--
-- ── A closed code, never the portal's text ───────────────────────────────
--
-- The runner's failure code from the closed set the wire contract names
-- (`WORK_FAILURES`), as 0006's list is. Set by every `failed_cleanly`
-- completion that carries a code, whether or not it counted as an attempt;
-- NULL on a success; cleared by a reopen, because a reopened row is in
-- flight again and the code described the completion just closed — the
-- same rule `spent_secret_request_id` follows.
ALTER TABLE workflow_action_intents
    ADD COLUMN IF NOT EXISTS last_failure text;

ALTER TABLE workflow_action_intents
    DROP CONSTRAINT IF EXISTS workflow_action_intents_last_failure_with_completion;
ALTER TABLE workflow_action_intents
    ADD CONSTRAINT workflow_action_intents_last_failure_with_completion
        CHECK (last_failure IS NULL OR outcome IS NOT NULL);
