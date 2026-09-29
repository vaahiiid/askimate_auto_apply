-- 0031 · A reading keeps its structure: the entries, the parts, the gaps.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ADR-0148 §9, P248. Vahid, 2026-09-29: *"When the interface exists, a
-- student who uploads a CV should see everything that was read from it as a
-- table — every job, every qualification, every part — and confirm it there,
-- with the gaps visible in the same view… keep the report's structure intact
-- rather than collapsing it into prose — the table needs the parts, the
-- entries and the gaps, and if the only thing that survives is a sentence we
-- will be rebuilding it later."*
--
-- So a reading that ended `read` keeps what the report was made of: per
-- list, whether the walk was seeded from it; per entry, which parts the
-- document gave, which it did not, which it gave in part and which are the
-- student's to state (ADR-0149); and how many entries it could not read
-- whole. PART KEYS AND COUNTS ONLY. No value and no span: those are on the
-- conversation log as part readings (0025), keyed `item{n}.<part>` with the
-- document as their origin, and the table is the join of the two. The
-- sentence the student reads today is derived from this and said once.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE document_readings
    ADD COLUMN structure jsonb;
-- Only a reading that was read has a structure; a failed one has a word.
ALTER TABLE document_readings
    ADD CONSTRAINT document_readings_only_a_reading_has_a_structure CHECK (
        (structure IS NULL) OR (state = 'read'));
