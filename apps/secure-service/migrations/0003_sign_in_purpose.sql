-- 0003 · `portal_sign_in` is a purpose a secret request can be opened for.
--
-- Forward-only and reviewed, per ADR-0003. 0001 is NOT edited: it has been
-- applied, and a change to an applied file does nothing everywhere it already
-- ran while looking correct on an empty database.
--
-- ADR-0101 §3 (P72): the resume path. When a run needs a signed-in session and
-- no runner holds one, the student is asked — once more, and the run says why —
-- for the password they chose, through the same secure box, and a runner signs
-- in with it. The handle is single-use and destroyed exactly as the creation's.
--
-- `portal_password_reset` leaves at the same time. Nothing ever opened a
-- request for it: a password reset is the student's own act on their own
-- device (ADR-0020 §3), not a password typed through this plane. The domain's
-- `SECRET_PURPOSES` and the published contract now agree, and
-- `scripts/contract-drift.test.ts` — which recorded the divergence since P27 —
-- asserts the agreement.
--
-- Still a closed set, and still deliberately: a purpose comes from the case and
-- the blueprint, never from model output.

ALTER TABLE secret_requests DROP CONSTRAINT IF EXISTS secret_requests_purpose_check;

ALTER TABLE secret_requests
    ADD CONSTRAINT secret_requests_purpose_check
    CHECK (purpose IN ('portal_account_creation', 'portal_sign_in'));
