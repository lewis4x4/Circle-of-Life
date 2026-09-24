-- 487: sequence placeholder (no-op).
--
-- This number was claimed by a Codex draft (#833 / #834) that was renumbered
-- to 496/497 with Brian's OK, after later migrations (488–495) had already
-- been applied to production and Haven HFO Staging. migrations:check requires
-- an unbroken sequence, so this no-op fills the slot. Recorded in both hosted
-- ledgers as ('487', 'sequence_placeholder'). Safe to replay anywhere.
SELECT 1;
