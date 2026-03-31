-- Immutable audit log + updated_at triggers (foundation tables)

CREATE OR REPLACE FUNCTION public.haven_set_updated_at ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $func$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$func$;

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_fields text[],
  user_id uuid REFERENCES auth.users (id),
  ip_address inet,
  user_agent text,
  organization_id uuid,
  facility_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_table ON audit_log (table_name, created_at DESC);

CREATE INDEX idx_audit_log_record ON audit_log (record_id, created_at DESC);

CREATE INDEX idx_audit_log_user ON audit_log (user_id, created_at DESC);

CREATE INDEX idx_audit_log_org ON audit_log (organization_id, created_at DESC);

CREATE INDEX idx_audit_log_created ON audit_log (created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- No policies: authenticated cannot read/write; service_role bypasses RLS.

CREATE OR REPLACE FUNCTION public.haven_capture_audit_log ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $func$
DECLARE
  _old_data jsonb;
  _new_data jsonb;
  _changed text[];
  _org_id uuid;
  _fac_id uuid;
  _row jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _old_data := to_jsonb (OLD);
    _new_data := NULL;
    _row := to_jsonb (OLD);
  ELSIF TG_OP = 'UPDATE' THEN
    _old_data := to_jsonb (OLD);
    _new_data := to_jsonb (NEW);
    _row := to_jsonb (NEW);
  ELSE
    _old_data := NULL;
    _new_data := to_jsonb (NEW);
    _row := to_jsonb (NEW);
  END IF;

  IF TG_TABLE_NAME = 'organizations' THEN
    _org_id := COALESCE(NEW.id, OLD.id);
  ELSE
    _org_id := (_row ->> 'organization_id')::uuid;
  END IF;

  _fac_id := (_row ->> 'facility_id')::uuid;

  IF TG_OP = 'UPDATE' AND _new_data IS NOT NULL AND _old_data IS NOT NULL THEN
    SELECT
      array_agg(key) INTO _changed
    FROM
      jsonb_each(_new_data) n
    WHERE
      n.value IS DISTINCT FROM _old_data -> n.key
      AND n.key NOT IN ('updated_at', 'updated_by');
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, changed_fields, user_id, organization_id, facility_id)
    VALUES (TG_TABLE_NAME, COALESCE(NEW.id, OLD.id), TG_OP, _old_data, _new_data, _changed, auth.uid(), _org_id, _fac_id);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$func$;

-- BEFORE UPDATE: timestamps
CREATE TRIGGER tr_organizations_set_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_entities_set_updated_at
  BEFORE UPDATE ON entities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_facilities_set_updated_at
  BEFORE UPDATE ON facilities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_units_set_updated_at
  BEFORE UPDATE ON units
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_rooms_set_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_beds_set_updated_at
  BEFORE UPDATE ON beds
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_user_profiles_set_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

-- AFTER: audit trail
CREATE TRIGGER tr_organizations_audit
  AFTER INSERT OR UPDATE OR DELETE ON organizations
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_entities_audit
  AFTER INSERT OR UPDATE OR DELETE ON entities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_facilities_audit
  AFTER INSERT OR UPDATE OR DELETE ON facilities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_units_audit
  AFTER INSERT OR UPDATE OR DELETE ON units
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_rooms_audit
  AFTER INSERT OR UPDATE OR DELETE ON rooms
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_beds_audit
  AFTER INSERT OR UPDATE OR DELETE ON beds
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_user_profiles_audit
  AFTER INSERT OR UPDATE OR DELETE ON user_profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_user_facility_access_audit
  AFTER INSERT OR UPDATE OR DELETE ON user_facility_access
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_family_resident_links_audit
  AFTER INSERT OR UPDATE OR DELETE ON family_resident_links
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
