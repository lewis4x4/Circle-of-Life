-- Facility Launch Round-2 config promoter targets.
-- These tables hold source-backed facility configuration that is operationally useful
-- before resident/staff PHI source files arrive.

CREATE TABLE IF NOT EXISTS public.facility_billing_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  field_path text NOT NULL,
  value jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  promoted_from_module_value_id uuid REFERENCES public.facility_launch_module_values(id),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.facility_medication_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  field_path text NOT NULL,
  value jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  promoted_from_module_value_id uuid REFERENCES public.facility_launch_module_values(id),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.facility_dining_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  field_path text NOT NULL,
  value jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  promoted_from_module_value_id uuid REFERENCES public.facility_launch_module_values(id),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.facility_maintenance_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  field_path text NOT NULL,
  value jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  promoted_from_module_value_id uuid REFERENCES public.facility_launch_module_values(id),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.facility_admissions_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  field_path text NOT NULL,
  value jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  promoted_from_module_value_id uuid REFERENCES public.facility_launch_module_values(id),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.facility_incident_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  field_path text NOT NULL,
  value jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  promoted_from_module_value_id uuid REFERENCES public.facility_launch_module_values(id),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.facility_vendor_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  field_path text NOT NULL,
  value jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  promoted_from_module_value_id uuid REFERENCES public.facility_launch_module_values(id),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.facility_launch_scoreboard_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  field_path text NOT NULL,
  value jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  promoted_from_module_value_id uuid REFERENCES public.facility_launch_module_values(id),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.incident_workflow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  source_template_id text,
  incident_type text NOT NULL,
  severity_rule text,
  immediate_actions text,
  family_notification_rule text,
  state_reporting_threshold text,
  claims_routing text,
  investigation_owner text,
  follow_up_cadence text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  promoted_from_module_value_id uuid REFERENCES public.facility_launch_module_values(id),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.facility_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  source_vendor_id text,
  organization text NOT NULL,
  category text,
  primary_contact text,
  phone text,
  after_hours_phone text,
  account_number text,
  contract_status text,
  insurance_required text,
  escalation_owner text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  promoted_from_module_value_id uuid REFERENCES public.facility_launch_module_values(id),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.facility_kpi_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  source_kpi_id text,
  kpi_name text NOT NULL,
  business_question text,
  data_source text,
  owner text,
  refresh_cadence text,
  target text,
  launch_threshold text,
  action_if_off_track text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  promoted_from_module_value_id uuid REFERENCES public.facility_launch_module_values(id),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_billing_config_active_key ON public.facility_billing_config (facility_id, field_path) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_medication_config_active_key ON public.facility_medication_config (facility_id, field_path) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_dining_config_active_key ON public.facility_dining_config (facility_id, field_path) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_maintenance_config_active_key ON public.facility_maintenance_config (facility_id, field_path) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_admissions_config_active_key ON public.facility_admissions_config (facility_id, field_path) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_incident_config_active_key ON public.facility_incident_config (facility_id, field_path) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_vendor_config_active_key ON public.facility_vendor_config (facility_id, field_path) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_launch_scoreboard_config_active_key ON public.facility_launch_scoreboard_config (facility_id, field_path) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_incident_workflow_templates_active_key ON public.incident_workflow_templates (facility_id, incident_type) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_vendors_active_source_key ON public.facility_vendors (facility_id, source_vendor_id) WHERE deleted_at IS NULL AND source_vendor_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_vendors_active_fallback_key ON public.facility_vendors (facility_id, organization, COALESCE(category, ''), COALESCE(phone, '')) WHERE deleted_at IS NULL AND source_vendor_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_kpi_definitions_active_key ON public.facility_kpi_definitions (facility_id, kpi_name) WHERE deleted_at IS NULL;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'facility_billing_config',
    'facility_medication_config',
    'facility_dining_config',
    'facility_maintenance_config',
    'facility_admissions_config',
    'facility_incident_config',
    'facility_vendor_config',
    'facility_launch_scoreboard_config',
    'incident_workflow_templates',
    'facility_vendors',
    'facility_kpi_definitions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_org_read', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organization_id = haven.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT haven.accessible_facility_ids()))',
      table_name || '_org_read',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_admin_insert', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (organization_id = haven.organization_id() AND haven.app_role() IN (''owner'', ''org_admin'', ''facility_admin'') AND facility_id IN (SELECT haven.accessible_facility_ids()))',
      table_name || '_admin_insert',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_admin_update', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (organization_id = haven.organization_id() AND haven.app_role() IN (''owner'', ''org_admin'', ''facility_admin'') AND facility_id IN (SELECT haven.accessible_facility_ids())) WITH CHECK (organization_id = haven.organization_id() AND haven.app_role() IN (''owner'', ''org_admin'', ''facility_admin'') AND facility_id IN (SELECT haven.accessible_facility_ids()))',
      table_name || '_admin_update',
      table_name
    );

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'tr_' || table_name || '_set_updated_at', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at()',
      'tr_' || table_name || '_set_updated_at',
      table_name
    );

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'tr_' || table_name || '_audit', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log()',
      'tr_' || table_name || '_audit',
      table_name
    );
  END LOOP;
END $$;

COMMENT ON TABLE public.facility_billing_config IS 'Facility-scoped billing settings promoted from Facility Launch M6.';
COMMENT ON TABLE public.facility_medication_config IS 'Facility-scoped medication integration settings promoted from Facility Launch M10.';
COMMENT ON TABLE public.facility_dining_config IS 'Facility-scoped dining and dietary settings promoted from Facility Launch M11.';
COMMENT ON TABLE public.facility_maintenance_config IS 'Facility-scoped maintenance settings promoted from Facility Launch M13.';
COMMENT ON TABLE public.facility_admissions_config IS 'Facility-scoped admissions settings promoted from Facility Launch M14.';
COMMENT ON TABLE public.facility_incident_config IS 'Facility-scoped incident/risk settings promoted from Facility Launch M16.';
COMMENT ON TABLE public.facility_vendor_config IS 'Facility-scoped vendor settings promoted from Facility Launch M18.';
COMMENT ON TABLE public.facility_launch_scoreboard_config IS 'Facility-scoped launch KPI settings promoted from Facility Launch M19.';
COMMENT ON TABLE public.incident_workflow_templates IS 'Facility incident response templates promoted from Facility Launch M16.';
COMMENT ON TABLE public.facility_vendors IS 'Facility vendor/contact directory records promoted from Facility Launch M18.';
COMMENT ON TABLE public.facility_kpi_definitions IS 'Facility launch KPI definitions promoted from Facility Launch M19.';
