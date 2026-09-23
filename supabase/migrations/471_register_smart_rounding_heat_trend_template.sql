-- COL-642: register the Smart Rounding Heat Trend report template.
--
-- `resident-assurance-heat-trend` has been in the code catalogue
-- (src/lib/reports/templates.ts) with a working executor since the Smart
-- Rounding build, but it never got a report_templates row. The templates list
-- counted 12 while the hub and governance counted 11, and the template could
-- be run but not scheduled, saved as a variant, or added to a pack (those all
-- resolve the template id from this table).
--
-- Same shape as the launch seed in 133_reporting_module_schema.sql. Idempotent.

BEGIN;

INSERT INTO report_templates (
  id,
  organization_id,
  owner_type,
  name,
  slug,
  category,
  short_description,
  tags,
  intended_roles,
  official_template,
  locked_definition,
  benchmark_capable,
  status
)
VALUES (
  'e2000000-0000-0000-0000-000000000012',
  NULL,
  'system',
  'Smart Rounding Heat Trend',
  'resident-assurance-heat-trend',
  'executive',
  '7-day watch, escalation, integrity, and critical-safety pressure by facility.',
  ARRAY['executive', 'clinical', 'risk', 'trend'],
  ARRAY['owner', 'org_admin', 'facility_admin']::app_role[],
  true,
  true,
  true,
  'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO report_template_versions (
  id,
  template_id,
  version_number,
  definition_json,
  change_summary,
  status
)
VALUES (
  'e2100000-0000-0000-0000-000000000012',
  'e2000000-0000-0000-0000-000000000012',
  1,
  jsonb_build_object(
    'source_type', 'resident-assurance-heat-trend',
    'default_view_type', 'mixed',
    'export_formats', ARRAY['csv', 'pdf', 'print'],
    'default_date_range', 'last_7',
    'supports_schedule', true,
    'supports_pack_membership', true,
    'supports_nlq_mapping', true
  ),
  'Initial registration of the Smart Rounding heat trend template (COL-642).',
  'active'
)
ON CONFLICT (template_id, version_number) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
