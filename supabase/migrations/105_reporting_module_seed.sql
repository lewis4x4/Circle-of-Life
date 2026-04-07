-- Module 26 - Reporting template seed (launch minimum set)
-- Safe to rerun using fixed UUIDs and ON CONFLICT.

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
VALUES
  (
    'e2000000-0000-0000-0000-000000000001',
    NULL,
    'system',
    'Occupancy and Census Summary',
    'occupancy-census-summary',
    'executive',
    'Tracks occupancy and census shifts by facility and date range.',
    ARRAY['executive', 'operations', 'census'],
    ARRAY['owner', 'org_admin', 'facility_admin']::app_role[],
    true,
    false,
    true,
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000002',
    NULL,
    'system',
    'Facility Operating Scorecard',
    'facility-operating-scorecard',
    'executive',
    'Cross-domain operating scorecard across census, incidents, and staffing.',
    ARRAY['executive', 'scorecard'],
    ARRAY['owner', 'org_admin', 'facility_admin']::app_role[],
    true,
    false,
    true,
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000003',
    NULL,
    'system',
    'Incident Trend Summary',
    'incident-trend-summary',
    'risk',
    'Shows incident trends over time by facility, unit, and shift.',
    ARRAY['incident', 'risk', 'compliance'],
    ARRAY['owner', 'org_admin', 'facility_admin']::app_role[],
    true,
    false,
    true,
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000004',
    NULL,
    'system',
    'Staffing Coverage by Shift',
    'staffing-coverage-by-shift',
    'workforce',
    'Compares planned vs assigned coverage by shift and role.',
    ARRAY['workforce', 'staffing'],
    ARRAY['owner', 'org_admin', 'facility_admin']::app_role[],
    true,
    false,
    true,
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000005',
    NULL,
    'system',
    'Overtime and Labor Pressure',
    'overtime-labor-pressure',
    'workforce',
    'Overtime concentration and labor pressure indicators.',
    ARRAY['workforce', 'labor', 'finance'],
    ARRAY['owner', 'org_admin', 'facility_admin']::app_role[],
    true,
    false,
    true,
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000006',
    NULL,
    'system',
    'Medication Exception Report',
    'medication-exception-report',
    'clinical',
    'Medication pass exceptions and error trends.',
    ARRAY['clinical', 'medication', 'compliance'],
    ARRAY['owner', 'org_admin', 'facility_admin']::app_role[],
    true,
    true,
    true,
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000007',
    NULL,
    'system',
    'Resident Assurance Rounding Compliance',
    'resident-assurance-rounding-compliance',
    'clinical',
    'Expected vs completed resident observation tasks and overdue trends.',
    ARRAY['resident-assurance', 'rounding', 'compliance'],
    ARRAY['owner', 'org_admin', 'facility_admin']::app_role[],
    true,
    true,
    true,
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000008',
    NULL,
    'system',
    'AR Aging Summary',
    'ar-aging-summary',
    'financial',
    'Aging and receivable pressure by facility and payer.',
    ARRAY['finance', 'ar', 'billing'],
    ARRAY['owner', 'org_admin']::app_role[],
    true,
    true,
    true,
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000009',
    NULL,
    'system',
    'Training and Certification Expiry',
    'training-certification-expiry',
    'workforce',
    'Active and upcoming training/certification expiration risk.',
    ARRAY['training', 'certifications', 'workforce'],
    ARRAY['owner', 'org_admin', 'facility_admin']::app_role[],
    true,
    false,
    true,
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000010',
    NULL,
    'system',
    'Survey Readiness Summary',
    'survey-readiness-summary',
    'compliance',
    'Deficiencies, timeliness, and readiness status by facility.',
    ARRAY['compliance', 'survey', 'audit'],
    ARRAY['owner', 'org_admin', 'facility_admin']::app_role[],
    true,
    true,
    true,
    'active'
  ),
  (
    'e2000000-0000-0000-0000-000000000011',
    NULL,
    'system',
    'Executive Weekly Operating Pack',
    'executive-weekly-operating-pack',
    'executive',
    'Bundle of high-value weekly executive templates.',
    ARRAY['executive', 'pack', 'board'],
    ARRAY['owner', 'org_admin']::app_role[],
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
SELECT
  ('e2100000-0000-0000-0000-' || right(t.id::text, 12))::uuid AS id,
  t.id,
  1,
  jsonb_build_object(
    'source_type', t.slug,
    'default_view_type', CASE WHEN t.slug LIKE '%pack%' THEN 'pdf_packet' ELSE 'mixed' END,
    'export_formats', ARRAY['csv', 'pdf', 'print'],
    'default_date_range', CASE WHEN t.category = 'financial' THEN 'last_30' ELSE 'last_7' END,
    'supports_schedule', true,
    'supports_pack_membership', true,
    'supports_nlq_mapping', true
  ),
  'Initial system launch template definition.',
  'active'
FROM
  report_templates t
WHERE
  t.id BETWEEN 'e2000000-0000-0000-0000-000000000001'::uuid AND 'e2000000-0000-0000-0000-000000000011'::uuid
ON CONFLICT (template_id, version_number) DO NOTHING;

INSERT INTO report_nlq_mappings (
  id,
  organization_id,
  template_id,
  prompt_pattern,
  intent_json,
  confidence_threshold
)
VALUES
  (
    'e2200000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000003',
    'falls by facility over last 90 days',
    '{"mode":"template_suggestion","filters":{"date_range":"last_90","incident_type":"fall"}}'::jsonb,
    0.75
  ),
  (
    'e2200000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000008',
    'board-ready census and labor summary',
    '{"mode":"pack_suggestion","pack":"executive-weekly-operating-pack"}'::jsonb,
    0.70
  )
ON CONFLICT (id) DO NOTHING;
