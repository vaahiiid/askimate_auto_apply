-- 0009 · A lease names the page VERSION it is holding.
--
-- Forward-only and reviewed, per ADR-0003. 0007 is NOT edited.
--
-- ADR-0051 §6, amending ADR-0047 §1: an `advance_portal_page` intent is keyed
-- on the page AND the content, so the ledger can answer "was the CORRECTED
-- value written?" — which it could not, because it recorded only that a page
-- was saved and not what was saved.
--
-- 0007 already gave the reason this column has to exist rather than being
-- re-derived at report time, and it named this exact case:
--
--     "a plan that had changed in between — A CORRECTED ANSWER, a re-reviewed
--      mapping set — would complete an intent for a page the runner never
--      touched."
--
-- A separate column rather than folding the hash into `page_ref`, because
-- `page_ref` means "which page" and would then mean two things. The target is
-- rebuilt from the pair.
ALTER TABLE work_leases
    ADD COLUMN IF NOT EXISTS page_version text
        CHECK (page_version IS NULL OR page_version ~ '^sha256:[0-9a-f]{64}$');

-- A version without a page is a claim about content on no page at all.
ALTER TABLE work_leases
    DROP CONSTRAINT IF EXISTS work_leases_a_version_belongs_to_a_page;
ALTER TABLE work_leases
    ADD CONSTRAINT work_leases_a_version_belongs_to_a_page
    CHECK (page_version IS NULL OR page_ref IS NOT NULL);
