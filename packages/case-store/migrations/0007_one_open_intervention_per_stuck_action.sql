-- 0007 · The uniqueness is one OPEN intervention per stuck action, not one for ever.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ── What 0003 said, and what it meant to say ─────────────────────────────
--
-- 0003 carried `CONSTRAINT interventions_one_per_stuck_action UNIQUE
-- (run_id, idempotency_key)`, and its reason was the poller: a run is
-- examined every few seconds, so one stuck account creation must not become
-- a queue of identical cases. That reason is about the interventions a
-- person is HOLDING. The constraint was written without the condition that
-- says so, and an unconditional unique key means something stronger and
-- unintended — one intervention per stuck action for the lifetime of the
-- run, resolved or not.
--
-- ── What it cost, on a real run (blocker 48) ─────────────────────────────
--
-- Found by Vahid on 2026-09-21, on Run A. A page fill stuck on 18 September
-- raised an intervention; he resolved it `did_not_happen` on the morning of
-- the 21st, which is the resolution that says *carry on, the act did not
-- land* — and the run carried on and stuck on the SAME page, because the
-- entry's save locator was wrong for it. The second raise hit this
-- constraint, inserted nothing, and `raise` answered with the RESOLVED row
-- and `created: false`. `#pause` then read an `announcedAt` from September
-- the 18th, so the student was told nothing, and moved the run to
-- `uncertain` — which is outside `AUTOMATABLE_STATUSES`, so no later poll
-- could reach it and raise what the first one had swallowed.
--
-- The result was an application stopped where nobody could see it: no open
-- intervention for a specialist to act on, and no route that would move the
-- run. Not a duplicate in a queue — the opposite, and worse.
--
-- ── The condition, and what it does not change ───────────────────────────
--
-- A partial unique INDEX rather than a table constraint, because `ON
-- CONFLICT` can only infer a partial index: `raise` names the same columns
-- and the same predicate. The poller's guarantee is untouched — two pollers
-- racing on one stuck run still produce one intervention, because both see
-- the same unresolved row. What changes is only what happens AFTER a
-- specialist has answered: the next episode of the same stuck action is its
-- own intervention, with its own announcement, rather than nothing at all.
--
-- A resolved intervention is never reopened by this. It stays resolved,
-- under the name of the person who resolved it — the record ADR-0082 to
-- ADR-0084 spent their phases making truthful.
ALTER TABLE interventions
    DROP CONSTRAINT IF EXISTS interventions_one_per_stuck_action;

CREATE UNIQUE INDEX IF NOT EXISTS interventions_one_open_per_stuck_action
    ON interventions (run_id, idempotency_key)
    WHERE resolved_at IS NULL;
