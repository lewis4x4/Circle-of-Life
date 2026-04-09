-- Module 12: inservice_log_sessions + inservice_log_attendees (Track D D41; spec 12-training-competency)

CREATE TABLE inservice_log_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  training_program_id uuid REFERENCES training_programs (id),
  session_date date NOT NULL,
  topic text NOT NULL,
  trainer_name text NOT NULL,
  trainer_user_id uuid REFERENCES auth.users (id),
  hours numeric(4, 2) NOT NULL,
  location text,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_inservice_sessions_facility ON inservice_log_sessions (facility_id, session_date DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_inservice_sessions_org ON inservice_log_sessions (organization_id)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE inservice_log_sessions IS 'In-service training events (digital sign-in sheet header); RLS + audit below.';

CREATE TABLE inservice_log_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  session_id uuid NOT NULL REFERENCES inservice_log_sessions (id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff (id),
  signed_in boolean NOT NULL DEFAULT true,
  notes text,
  UNIQUE (session_id, staff_id)
);

CREATE INDEX idx_inservice_attendees_staff ON inservice_log_attendees (staff_id);

CREATE INDEX idx_inservice_attendees_session ON inservice_log_attendees (session_id);

COMMENT ON TABLE inservice_log_attendees IS 'Staff sign-in rows for an in-service session; RLS + audit below.';

ALTER TABLE inservice_log_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE inservice_log_attendees ENABLE ROW LEVEL SECURITY;

-- Sessions: facility-scoped read for org members with facility access
CREATE POLICY inservice_log_sessions_select ON inservice_log_sessions
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY inservice_log_sessions_insert ON inservice_log_sessions
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY inservice_log_sessions_update ON inservice_log_sessions
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY inservice_log_sessions_delete ON inservice_log_sessions
  FOR DELETE
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

-- Attendees: visible when session is visible (facility access) or row is self
CREATE POLICY inservice_log_attendees_select ON inservice_log_attendees
  FOR SELECT
  USING (
    EXISTS (
      SELECT
        1
      FROM
        inservice_log_sessions s
      WHERE
        s.id = inservice_log_attendees.session_id
        AND s.organization_id = haven.organization_id ()
        AND s.deleted_at IS NULL
        AND (
          s.facility_id IN (
            SELECT
              haven.accessible_facility_ids ())
          OR EXISTS (
            SELECT
              1
            FROM
              staff st
            WHERE
              st.id = inservice_log_attendees.staff_id
              AND st.user_id = auth.uid ()
              AND st.deleted_at IS NULL))));

CREATE POLICY inservice_log_attendees_insert ON inservice_log_attendees
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT
        1
      FROM
        inservice_log_sessions s
      WHERE
        s.id = inservice_log_attendees.session_id
        AND s.organization_id = haven.organization_id ()
        AND s.deleted_at IS NULL
        AND s.facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY inservice_log_attendees_update ON inservice_log_attendees
  FOR UPDATE
  USING (
    EXISTS (
      SELECT
        1
      FROM
        inservice_log_sessions s
      WHERE
        s.id = inservice_log_attendees.session_id
        AND s.organization_id = haven.organization_id ()
        AND s.deleted_at IS NULL
        AND s.facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'))
  WITH CHECK (
    EXISTS (
      SELECT
        1
      FROM
        inservice_log_sessions s
      WHERE
        s.id = inservice_log_attendees.session_id
        AND s.organization_id = haven.organization_id ()
        AND s.deleted_at IS NULL
        AND s.facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY inservice_log_attendees_delete ON inservice_log_attendees
  FOR DELETE
  USING (
    EXISTS (
      SELECT
        1
      FROM
        inservice_log_sessions s
      WHERE
        s.id = inservice_log_attendees.session_id
        AND s.organization_id = haven.organization_id ()
        AND s.deleted_at IS NULL
        AND s.facility_id IN (
          SELECT
            haven.accessible_facility_ids ()))
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE TRIGGER tr_inservice_log_sessions_set_updated_at
  BEFORE UPDATE ON inservice_log_sessions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_inservice_log_sessions_audit
  AFTER INSERT OR UPDATE OR DELETE ON inservice_log_sessions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_inservice_log_attendees_audit
  AFTER INSERT OR UPDATE OR DELETE ON inservice_log_attendees
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
