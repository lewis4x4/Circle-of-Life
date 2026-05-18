-- P0: Facility admin mutations use Supabase **service_role** from Next.js routes.
-- In PL/pgSQL triggers, auth.uid() is NULL for those commits. The legacy
-- haven.facility_audit_trigger() substituted the all-zero UUID, which violates
-- facility_audit_log.changed_by → auth.users(id) FK. The EXCEPTION handler then
-- swallowed the failure ("Audit is non-blocking"), so **zero rows landed** despite
-- real facility activity.
--
-- Fix: nullable actor + persist NULL changed_by instead of dummy UUID.

ALTER TABLE public.facility_audit_log
  ALTER COLUMN changed_by DROP NOT NULL;

COMMENT ON COLUMN public.facility_audit_log.changed_by IS
  'Auth user for the change when JWT context is present. NULL for service_role writes without impersonation, migrations, or jobs.';

CREATE OR REPLACE FUNCTION haven.facility_audit_trigger()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven
  AS $func$
DECLARE
  v_facility_id uuid;
  v_org_id uuid;
  v_action text;
  v_old jsonb;
  v_new jsonb;
  v_user_id uuid;
  col_name text;
  old_val jsonb;
  new_val jsonb;
BEGIN
  v_action := TG_OP;
  v_user_id := auth.uid();

  IF v_action = 'DELETE' THEN
    v_facility_id := OLD.facility_id;
    v_org_id := OLD.organization_id;
    INSERT INTO public.facility_audit_log (facility_id, organization_id, table_name, record_id, action, old_value, changed_by)
    VALUES (v_facility_id, v_org_id, TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), v_user_id);
    RETURN OLD;
  END IF;

  IF v_action = 'INSERT' THEN
    v_facility_id := NEW.facility_id;
    v_org_id := NEW.organization_id;
    INSERT INTO public.facility_audit_log (facility_id, organization_id, table_name, record_id, action, new_value, changed_by)
    VALUES (v_facility_id, v_org_id, TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), v_user_id);
    RETURN NEW;
  END IF;

  v_facility_id := NEW.facility_id;
  v_org_id := NEW.organization_id;
  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);

  FOR col_name IN SELECT key FROM jsonb_each(v_new) LOOP
    IF col_name IN ('updated_at', 'updated_by') THEN CONTINUE; END IF;
    old_val := v_old -> col_name;
    new_val := v_new -> col_name;
    IF old_val IS DISTINCT FROM new_val THEN
      INSERT INTO public.facility_audit_log (facility_id, organization_id, table_name, record_id, action, field_name, old_value, new_value, changed_by)
      VALUES (v_facility_id, v_org_id, TG_TABLE_NAME, NEW.id, 'UPDATE', col_name, old_val, new_val, v_user_id);
    END IF;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'facility_audit_trigger failed: %', SQLERRM;
  IF v_action = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$func$;

-- Facility vendor rows were only routed to immutable audit_log via haven_capture_audit_log().
-- Duplicate into facility_audit_log for facility-scoped compliance UI (same semantics as FEC/FD/RSV).
DROP TRIGGER IF EXISTS trg_audit_facility_vendors ON public.facility_vendors;

CREATE TRIGGER trg_audit_facility_vendors
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_vendors
  FOR EACH ROW EXECUTE FUNCTION haven.facility_audit_trigger ();
