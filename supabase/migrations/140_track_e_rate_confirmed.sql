-- Track E — E4: Client rate confirmation flag on effective-dated rate versions

ALTER TABLE rate_schedule_versions
ADD COLUMN IF NOT EXISTS rate_confirmed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN rate_schedule_versions.rate_confirmed IS 'When false, UI/billing must show “rate pending client confirmation” (semi-private ambiguity, etc.).';

-- Default: non–semi-private lines treated as confirmed; semi-private pending until owner resolves ($4,000 vs $4,400).
UPDATE rate_schedule_versions
SET
  rate_confirmed = CASE
    WHEN rate_type = 'semi_private_room' THEN false
    ELSE true
  END
WHERE
  deleted_at IS NULL;
