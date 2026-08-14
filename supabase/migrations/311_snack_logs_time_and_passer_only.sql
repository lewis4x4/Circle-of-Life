-- COL owner decision 2026-08-14: snack logs are facility-level time + who passed only.
-- Drop description, offered/accepted counts, and notes. No data backfill or row rewrite.

ALTER TABLE public.snack_logs
  DROP COLUMN IF EXISTS snack_description,
  DROP COLUMN IF EXISTS residents_offered_count,
  DROP COLUMN IF EXISTS residents_accepted_count,
  DROP COLUMN IF EXISTS notes;

COMMENT ON TABLE public.snack_logs IS
  'Facility-level snack pass log: snack_at timestamp and passed_by_user_id only (COL operational proof).';
