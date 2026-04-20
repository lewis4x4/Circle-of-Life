DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'standup_bed_availability_class') THEN
    CREATE TYPE standup_bed_availability_class AS ENUM ('private', 'sp_female', 'sp_male', 'sp_flexible');
  END IF;
END $$;

ALTER TABLE beds
  ADD COLUMN IF NOT EXISTS standup_availability_class standup_bed_availability_class,
  ADD COLUMN IF NOT EXISTS is_temporarily_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_reason text;

UPDATE beds b
SET standup_availability_class = CASE
  WHEN r.room_type = 'private' THEN 'private'::standup_bed_availability_class
  ELSE 'sp_flexible'::standup_bed_availability_class
END
FROM rooms r
WHERE b.room_id = r.id
  AND b.standup_availability_class IS NULL;

CREATE INDEX IF NOT EXISTS idx_beds_standup_class
  ON beds (facility_id, standup_availability_class)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_beds_standup_open
  ON beds (facility_id, status, is_temporarily_blocked)
  WHERE deleted_at IS NULL;
