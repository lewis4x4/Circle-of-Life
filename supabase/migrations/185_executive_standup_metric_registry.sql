DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'exec_standup_value_type'
  ) THEN
    CREATE TYPE exec_standup_value_type AS ENUM ('currency', 'count', 'percent', 'hours', 'text');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'exec_standup_source_mode'
  ) THEN
    CREATE TYPE exec_standup_source_mode AS ENUM ('auto', 'manual', 'hybrid', 'forecast');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'exec_standup_confidence_band'
  ) THEN
    CREATE TYPE exec_standup_confidence_band AS ENUM ('high', 'medium', 'low');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS exec_standup_metric_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  key text NOT NULL,
  section_key text NOT NULL,
  label text NOT NULL,
  description text NOT NULL,
  value_type exec_standup_value_type NOT NULL,
  source_mode exec_standup_source_mode NOT NULL,
  aggregation_mode text NOT NULL CHECK (aggregation_mode IN ('sum', 'average', 'derived', 'manual')),
  time_grain text NOT NULL CHECK (time_grain IN ('live', 'daily', 'weekly')),
  facility_scope boolean NOT NULL DEFAULT true,
  total_scope boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_exec_standup_metric_definitions_org_key
  ON exec_standup_metric_definitions (organization_id, key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_exec_standup_metric_definitions_section
  ON exec_standup_metric_definitions (organization_id, section_key, display_order)
  WHERE deleted_at IS NULL;

INSERT INTO exec_standup_metric_definitions (
  organization_id,
  key,
  section_key,
  label,
  description,
  value_type,
  source_mode,
  aggregation_mode,
  time_grain,
  facility_scope,
  total_scope,
  display_order
)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'ar_goal_cents', 'ar_census', 'Goal', 'Weekly AR target used during executive standup.', 'currency', 'manual', 'manual', 'weekly', true, true, 10),
  ('00000000-0000-0000-0000-000000000001', 'current_ar_cents', 'ar_census', 'Current AR', 'Current open invoice balances for the selected scope.', 'currency', 'auto', 'sum', 'live', true, true, 20),
  ('00000000-0000-0000-0000-000000000001', 'current_total_census', 'ar_census', 'Current Total Census', 'Current active census including hospital hold / LOA when used in executive reporting.', 'count', 'auto', 'sum', 'live', true, true, 30),
  ('00000000-0000-0000-0000-000000000001', 'average_rent_cents', 'ar_census', 'Average Rent', 'Average current monthly rent / revenue basis for occupied residents.', 'currency', 'hybrid', 'average', 'live', true, true, 40),
  ('00000000-0000-0000-0000-000000000001', 'uncollected_ar_total_cents', 'ar_census', 'Uncollected AR Total', 'Overdue / uncollected open balances for the selected scope.', 'currency', 'auto', 'sum', 'live', true, true, 50),
  ('00000000-0000-0000-0000-000000000001', 'sp_female_beds_open', 'bed_availability', 'SP Female Beds Open', 'Semi-private female-designated beds currently available.', 'count', 'hybrid', 'sum', 'live', true, true, 60),
  ('00000000-0000-0000-0000-000000000001', 'sp_male_beds_open', 'bed_availability', 'SP Male Beds Open', 'Semi-private male-designated beds currently available.', 'count', 'hybrid', 'sum', 'live', true, true, 70),
  ('00000000-0000-0000-0000-000000000001', 'sp_flexible_beds_open', 'bed_availability', 'SP Male or Female Beds Open', 'Semi-private flexible beds currently available.', 'count', 'hybrid', 'sum', 'live', true, true, 80),
  ('00000000-0000-0000-0000-000000000001', 'private_beds_open', 'bed_availability', 'Private Beds Open', 'Private beds currently available.', 'count', 'hybrid', 'sum', 'live', true, true, 90),
  ('00000000-0000-0000-0000-000000000001', 'total_beds_open', 'bed_availability', 'Total Beds Open', 'Total currently available beds for the selected scope.', 'count', 'auto', 'sum', 'live', true, true, 100),
  ('00000000-0000-0000-0000-000000000001', 'admissions_expected', 'admissions', 'Admissions Expected', 'Expected admissions for the current standup week.', 'count', 'forecast', 'manual', 'weekly', true, true, 110),
  ('00000000-0000-0000-0000-000000000001', 'hospital_and_rehab_total', 'risk_management', 'Total at the Hospital & Rehab', 'Residents currently away in hospital hold / rehab status.', 'count', 'hybrid', 'sum', 'live', true, true, 120),
  ('00000000-0000-0000-0000-000000000001', 'expected_discharges', 'risk_management', 'Expected Discharges', 'Expected discharges during the current standup week.', 'count', 'forecast', 'manual', 'weekly', true, true, 130),
  ('00000000-0000-0000-0000-000000000001', 'callouts_last_week', 'staffing', 'Call Outs Last Week', 'Attendance-related callouts recorded in the prior completed week.', 'count', 'hybrid', 'sum', 'weekly', true, true, 140),
  ('00000000-0000-0000-0000-000000000001', 'terminations_last_week', 'staffing', 'Terminations Last Week', 'Staff terminations recorded in the prior completed week.', 'count', 'auto', 'sum', 'weekly', true, true, 150),
  ('00000000-0000-0000-0000-000000000001', 'current_open_positions', 'staffing', 'Current Open Positions', 'Open requisitions / vacancies at the time of the standup.', 'count', 'manual', 'manual', 'weekly', true, true, 160),
  ('00000000-0000-0000-0000-000000000001', 'overtime_hours', 'staffing', 'Overtime', 'Overtime hours recorded in the prior completed week.', 'hours', 'auto', 'sum', 'weekly', true, true, 170),
  ('00000000-0000-0000-0000-000000000001', 'tours_expected', 'marketing', 'Tours Expected', 'Expected tours for the current standup week.', 'count', 'forecast', 'manual', 'weekly', true, true, 180),
  ('00000000-0000-0000-0000-000000000001', 'provider_activities_expected', 'marketing', 'Activities on the calendar to be completed by Home Health Providers', 'Expected provider calendar activities for the standup week.', 'count', 'manual', 'manual', 'weekly', true, true, 190),
  ('00000000-0000-0000-0000-000000000001', 'outreach_engagements', 'marketing', 'Outreach & Engagements (Providers, Facilities, Events)', 'Outreach and engagement activities planned or completed for the standup week.', 'count', 'manual', 'manual', 'weekly', true, true, 200)
ON CONFLICT DO NOTHING;
