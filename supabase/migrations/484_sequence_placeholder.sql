-- 484: sequence placeholder (no-op).
--
-- This number was claimed by a draft that was later renumbered (COL-677 #814
-- moved to 494/495), after later migrations (485, 488–493) had already been
-- applied to production and Haven HFO Staging. migrations:check requires an
-- unbroken sequence, so this no-op fills the slot. Recorded in both hosted
-- ledgers as ('484', 'sequence_placeholder'). Safe to replay anywhere.
SELECT 1;
