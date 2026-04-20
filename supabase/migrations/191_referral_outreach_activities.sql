DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'referral_outreach_activity_type') THEN
    CREATE TYPE referral_outreach_activity_type AS ENUM (
      'home_health_provider',
      'provider_visit',
      'facility_outreach',
      'community_event',
      'digital_outreach'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'referral_outreach_activity_status') THEN
    CREATE TYPE referral_outreach_activity_status AS ENUM ('planned', 'completed', 'cancelled');
  END IF;
END $$;

ALTER TABLE referral_leads
  ADD COLUMN IF NOT EXISTS tour_scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS tour_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS tour_owner_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS tour_expected_week date;

CREATE TABLE IF NOT EXISTS referral_outreach_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  referral_lead_id uuid REFERENCES referral_leads(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES auth.users(id),
  activity_type referral_outreach_activity_type NOT NULL,
  status referral_outreach_activity_status NOT NULL DEFAULT 'planned',
  channel text,
  scheduled_for timestamptz,
  performed_for_week date,
  external_partner_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_referral_outreach_activities_facility_week
  ON referral_outreach_activities (facility_id, performed_for_week DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_referral_outreach_activities_scheduled_for
  ON referral_outreach_activities (facility_id, scheduled_for DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE referral_outreach_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referral_outreach_activities_select ON referral_outreach_activities;
CREATE POLICY referral_outreach_activities_select ON referral_outreach_activities
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant', 'coordinator')
  );

DROP POLICY IF EXISTS referral_outreach_activities_manage ON referral_outreach_activities;
CREATE POLICY referral_outreach_activities_manage ON referral_outreach_activities
  FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant', 'coordinator')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant', 'coordinator')
  );

DROP TRIGGER IF EXISTS tr_referral_outreach_activities_set_updated_at ON referral_outreach_activities;
CREATE TRIGGER tr_referral_outreach_activities_set_updated_at
  BEFORE UPDATE ON referral_outreach_activities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_referral_outreach_activities_audit ON referral_outreach_activities;
CREATE TRIGGER tr_referral_outreach_activities_audit
  AFTER INSERT OR UPDATE OR DELETE ON referral_outreach_activities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();
