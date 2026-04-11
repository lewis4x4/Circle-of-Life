-- Seed persisted search tool policy defaults for all existing organizations.
-- This aligns the admin dashboard and knowledge-agent governance behavior.

WITH orgs AS (
  SELECT id
  FROM public.organizations
),
defaults AS (
  SELECT *
  FROM (
    VALUES
      ('semantic_kb_search', 'kb_documents', 'caregiver', true),
      ('semantic_kb_search', 'kb_documents', 'nurse', true),
      ('semantic_kb_search', 'kb_documents', 'coordinator', true),
      ('semantic_kb_search', 'kb_documents', 'manager', true),
      ('semantic_kb_search', 'kb_documents', 'admin_assistant', true),
      ('semantic_kb_search', 'kb_documents', 'facility_admin', true),
      ('semantic_kb_search', 'kb_documents', 'org_admin', true),
      ('semantic_kb_search', 'kb_documents', 'owner', true),

      ('resident_lookup', 'clinical', 'caregiver', true),
      ('resident_lookup', 'clinical', 'nurse', true),
      ('resident_lookup', 'clinical', 'coordinator', true),
      ('resident_lookup', 'clinical', 'manager', true),
      ('resident_lookup', 'clinical', 'admin_assistant', false),
      ('resident_lookup', 'clinical', 'facility_admin', true),
      ('resident_lookup', 'clinical', 'org_admin', true),
      ('resident_lookup', 'clinical', 'owner', true),

      ('daily_ops_search', 'clinical', 'caregiver', true),
      ('daily_ops_search', 'clinical', 'nurse', true),
      ('daily_ops_search', 'clinical', 'coordinator', true),
      ('daily_ops_search', 'clinical', 'manager', true),
      ('daily_ops_search', 'clinical', 'admin_assistant', false),
      ('daily_ops_search', 'clinical', 'facility_admin', true),
      ('daily_ops_search', 'clinical', 'org_admin', true),
      ('daily_ops_search', 'clinical', 'owner', true),

      ('medication_search', 'clinical', 'caregiver', true),
      ('medication_search', 'clinical', 'nurse', true),
      ('medication_search', 'clinical', 'coordinator', true),
      ('medication_search', 'clinical', 'manager', true),
      ('medication_search', 'clinical', 'admin_assistant', false),
      ('medication_search', 'clinical', 'facility_admin', true),
      ('medication_search', 'clinical', 'org_admin', true),
      ('medication_search', 'clinical', 'owner', true),

      ('incident_search', 'clinical', 'caregiver', true),
      ('incident_search', 'clinical', 'nurse', true),
      ('incident_search', 'clinical', 'coordinator', true),
      ('incident_search', 'clinical', 'manager', true),
      ('incident_search', 'clinical', 'admin_assistant', false),
      ('incident_search', 'clinical', 'facility_admin', true),
      ('incident_search', 'clinical', 'org_admin', true),
      ('incident_search', 'clinical', 'owner', true),

      ('census_snapshot', 'clinical', 'caregiver', true),
      ('census_snapshot', 'clinical', 'nurse', true),
      ('census_snapshot', 'clinical', 'coordinator', true),
      ('census_snapshot', 'clinical', 'manager', true),
      ('census_snapshot', 'clinical', 'admin_assistant', false),
      ('census_snapshot', 'clinical', 'facility_admin', true),
      ('census_snapshot', 'clinical', 'org_admin', true),
      ('census_snapshot', 'clinical', 'owner', true),

      ('staff_directory', 'operational', 'caregiver', false),
      ('staff_directory', 'operational', 'nurse', true),
      ('staff_directory', 'operational', 'coordinator', true),
      ('staff_directory', 'operational', 'manager', true),
      ('staff_directory', 'operational', 'admin_assistant', true),
      ('staff_directory', 'operational', 'facility_admin', true),
      ('staff_directory', 'operational', 'org_admin', true),
      ('staff_directory', 'operational', 'owner', true),

      ('compliance_search', 'operational', 'caregiver', false),
      ('compliance_search', 'operational', 'nurse', true),
      ('compliance_search', 'operational', 'coordinator', true),
      ('compliance_search', 'operational', 'manager', true),
      ('compliance_search', 'operational', 'admin_assistant', false),
      ('compliance_search', 'operational', 'facility_admin', true),
      ('compliance_search', 'operational', 'org_admin', true),
      ('compliance_search', 'operational', 'owner', true),

      ('billing_search', 'financial', 'caregiver', false),
      ('billing_search', 'financial', 'nurse', false),
      ('billing_search', 'financial', 'coordinator', false),
      ('billing_search', 'financial', 'manager', false),
      ('billing_search', 'financial', 'admin_assistant', false),
      ('billing_search', 'financial', 'facility_admin', true),
      ('billing_search', 'financial', 'org_admin', true),
      ('billing_search', 'financial', 'owner', true),

      ('payroll_search', 'payroll', 'caregiver', false),
      ('payroll_search', 'payroll', 'nurse', false),
      ('payroll_search', 'payroll', 'coordinator', false),
      ('payroll_search', 'payroll', 'manager', false),
      ('payroll_search', 'payroll', 'admin_assistant', false),
      ('payroll_search', 'payroll', 'facility_admin', true),
      ('payroll_search', 'payroll', 'org_admin', true),
      ('payroll_search', 'payroll', 'owner', true)
  ) AS t(tool_name, tool_tier, app_role, enabled)
)
INSERT INTO public.search_tool_policies (
  organization_id,
  tool_name,
  tool_tier,
  app_role,
  enabled
)
SELECT
  orgs.id,
  defaults.tool_name,
  defaults.tool_tier::public.search_tool_tier,
  defaults.app_role,
  defaults.enabled
FROM orgs
CROSS JOIN defaults
ON CONFLICT (organization_id, tool_name, app_role) DO NOTHING;
