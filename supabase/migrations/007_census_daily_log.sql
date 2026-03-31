-- Daily census history (writes typically via service role / Edge cron)

CREATE TABLE census_daily_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  log_date date NOT NULL,
  total_licensed_beds integer NOT NULL,
  occupied_beds integer NOT NULL,
  available_beds integer NOT NULL,
  hold_beds integer NOT NULL,
  maintenance_beds integer NOT NULL,
  occupancy_rate numeric(5, 4) NOT NULL,
  residents_by_acuity jsonb NOT NULL DEFAULT '{}',
  residents_by_payer jsonb NOT NULL DEFAULT '{}',
  admissions_today integer NOT NULL DEFAULT 0,
  discharges_today integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE census_daily_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_see_census_for_accessible_facilities ON census_daily_log
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE UNIQUE INDEX idx_census_daily_facility_date ON census_daily_log (facility_id, log_date);

CREATE INDEX idx_census_daily_org_date ON census_daily_log (organization_id, log_date DESC);

CREATE TRIGGER tr_census_daily_log_audit
  AFTER INSERT OR UPDATE OR DELETE ON census_daily_log
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
