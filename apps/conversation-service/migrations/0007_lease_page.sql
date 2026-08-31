-- 0007 · A lease names the page it is holding.
--
-- Forward-only and reviewed, per ADR-0003. 0005 and 0006 are NOT edited.
--
-- ADR-0047. Page progress itself lives in `workflow_action_intents`, one
-- `advance_portal_page` intent per page — no table is added for it, because a
-- second record of what has happened to a run is the failure ADR-0041 exists to
-- prevent. This column answers a different question: WHICH PAGE is the runner
-- currently holding, so that its report keys the right intent.
--
-- The two do not overlap. A lease is transient operational state that expires
-- on its own; an intent is a durable record that never changes once written.
--
-- ── Why the report cannot just re-derive it ──────────────────────────────
--
-- Because a report arrives with a lease id and nothing else. Deriving the page
-- again at report time would mean rebuilding the plan, and a plan that had
-- changed in between — a corrected answer, a re-reviewed mapping set — would
-- complete an intent for a page the runner never touched.
--
-- ── Nullable, and deliberately ───────────────────────────────────────────
--
-- `create_account` has no page: it is one form, and the account either exists
-- or does not. A NOT NULL column would need a sentinel, and a sentinel page ref
-- is a page ref that could collide with a real one.

ALTER TABLE work_leases
    ADD COLUMN IF NOT EXISTS page_ref text
        CHECK (page_ref IS NULL OR length(page_ref) BETWEEN 1 AND 200);

-- Only fill work names a page. An account-creation lease with one would be a
-- claim about a page nobody is on.
ALTER TABLE work_leases
    DROP CONSTRAINT IF EXISTS work_leases_only_fill_names_a_page;
ALTER TABLE work_leases
    ADD CONSTRAINT work_leases_only_fill_names_a_page
    CHECK ((kind = 'execute') OR page_ref IS NULL);
