-- COL demo: payroll export batches/lines (all 5 facilities) + Resident Assurance templates
-- for Rising Oaks, Homewood, Plantation, Grande Cypress (Oakridge already has RA seed in 129).

-- ── Payroll: one exported batch per facility (March 2026 pay period), two time-record lines each ──

INSERT INTO payroll_export_batches (
  id,
  organization_id,
  facility_id,
  period_start,
  period_end,
  provider,
  status,
  notes
) VALUES
  (
    'e2000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0002-000000000001',
    '2026-03-01',
    '2026-03-31',
    'generic',
    'exported',
    'COL demo seed — Oakridge ALF March 2026 payroll export.'
  ),
  (
    'e2000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0002-000000000002',
    '2026-03-01',
    '2026-03-31',
    'generic',
    'exported',
    'COL demo seed — Rising Oaks ALF March 2026 payroll export.'
  ),
  (
    'e2000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0002-000000000003',
    '2026-03-01',
    '2026-03-31',
    'generic',
    'exported',
    'COL demo seed — Homewood Lodge ALF March 2026 payroll export.'
  ),
  (
    'e2000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0002-000000000004',
    '2026-03-01',
    '2026-03-31',
    'generic',
    'exported',
    'COL demo seed — Plantation ALF March 2026 payroll export.'
  ),
  (
    'e2000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0002-000000000005',
    '2026-03-01',
    '2026-03-31',
    'generic',
    'exported',
    'COL demo seed — Grande Cypress ALF March 2026 payroll export.'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO payroll_export_lines (
  id,
  organization_id,
  batch_id,
  staff_id,
  line_kind,
  amount_cents,
  payload,
  time_record_id,
  idempotency_key
) VALUES
  (
    'e2100000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000003',
    'time_record_hours',
    NULL,
    '{"time_record_id":"ba000000-0000-0000-0000-000000000001","regular_hours":8.17,"actual_hours":8.17,"overtime_hours":0}'::jsonb,
    'ba000000-0000-0000-0000-000000000001',
    'col-demo-seed-oakridge-tr-ba000000-000000000001'
  ),
  (
    'e2100000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000004',
    'time_record_hours',
    NULL,
    '{"time_record_id":"ba000000-0000-0000-0000-000000000002","regular_hours":8.03,"actual_hours":8.03,"overtime_hours":0}'::jsonb,
    'ba000000-0000-0000-0000-000000000002',
    'col-demo-seed-oakridge-tr-ba000000-000000000002'
  ),
  (
    'e2100000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000002',
    '50000002-0000-0000-0000-000000000003',
    'time_record_hours',
    NULL,
    '{"time_record_id":"ba000002-0000-0000-0000-000000000001","regular_hours":8.1,"actual_hours":8.1,"overtime_hours":0}'::jsonb,
    'ba000002-0000-0000-0000-000000000001',
    'col-demo-seed-rising-tr-ba000002-000000000001'
  ),
  (
    'e2100000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000002',
    '50000002-0000-0000-0000-000000000004',
    'time_record_hours',
    NULL,
    '{"time_record_id":"ba000002-0000-0000-0000-000000000002","regular_hours":7.98,"actual_hours":7.98,"overtime_hours":0}'::jsonb,
    'ba000002-0000-0000-0000-000000000002',
    'col-demo-seed-rising-tr-ba000002-000000000002'
  ),
  (
    'e2100000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000003',
    '50000003-0000-0000-0000-000000000003',
    'time_record_hours',
    NULL,
    '{"time_record_id":"ba000003-0000-0000-0000-000000000001","regular_hours":8.03,"actual_hours":8.03,"overtime_hours":0}'::jsonb,
    'ba000003-0000-0000-0000-000000000001',
    'col-demo-seed-homewood-tr-ba000003-000000000001'
  ),
  (
    'e2100000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000003',
    '50000003-0000-0000-0000-000000000004',
    'time_record_hours',
    NULL,
    '{"time_record_id":"ba000003-0000-0000-0000-000000000002","regular_hours":8.08,"actual_hours":8.08,"overtime_hours":0}'::jsonb,
    'ba000003-0000-0000-0000-000000000002',
    'col-demo-seed-homewood-tr-ba000003-000000000002'
  ),
  (
    'e2100000-0000-0000-0000-000000000007',
    '00000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000004',
    '50000004-0000-0000-0000-000000000003',
    'time_record_hours',
    NULL,
    '{"time_record_id":"ba000004-0000-0000-0000-000000000001","regular_hours":8.07,"actual_hours":8.07,"overtime_hours":0}'::jsonb,
    'ba000004-0000-0000-0000-000000000001',
    'col-demo-seed-plantation-tr-ba000004-000000000001'
  ),
  (
    'e2100000-0000-0000-0000-000000000008',
    '00000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000004',
    '50000004-0000-0000-0000-000000000004',
    'time_record_hours',
    NULL,
    '{"time_record_id":"ba000004-0000-0000-0000-000000000002","regular_hours":7.98,"actual_hours":7.98,"overtime_hours":0}'::jsonb,
    'ba000004-0000-0000-0000-000000000002',
    'col-demo-seed-plantation-tr-ba000004-000000000002'
  ),
  (
    'e2100000-0000-0000-0000-000000000009',
    '00000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000005',
    '50000005-0000-0000-0000-000000000003',
    'time_record_hours',
    NULL,
    '{"time_record_id":"ba000005-0000-0000-0000-000000000001","regular_hours":8.08,"actual_hours":8.08,"overtime_hours":0}'::jsonb,
    'ba000005-0000-0000-0000-000000000001',
    'col-demo-seed-grande-tr-ba000005-000000000001'
  ),
  (
    'e2100000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000005',
    '50000005-0000-0000-0000-000000000004',
    'time_record_hours',
    NULL,
    '{"time_record_id":"ba000005-0000-0000-0000-000000000002","regular_hours":8.08,"actual_hours":8.08,"overtime_hours":0}'::jsonb,
    'ba000005-0000-0000-0000-000000000002',
    'col-demo-seed-grande-tr-ba000005-000000000002'
  )
ON CONFLICT (id) DO NOTHING;

-- ── Resident Assurance: observation templates + watch protocol (facilities 002–005) ──

INSERT INTO resident_observation_templates (
  id,
  organization_id,
  entity_id,
  facility_id,
  name,
  description,
  category,
  preset_definition
) VALUES
  (
    'd1000000-0000-0000-0000-000000000211',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000002',
    '00000000-0000-0000-0002-000000000002',
    'Hourly Safety Rounds',
    'Routine safety and presence confirmation for higher-risk residents.',
    'routine_rounding',
    '{"interval_minutes":60,"grace_minutes":15,"quick_status_default":"awake"}'::jsonb
  ),
  (
    'd1000000-0000-0000-0000-000000000212',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000002',
    '00000000-0000-0000-0002-000000000002',
    'Q30 Wandering Watch',
    'Temporary enhanced checks for residents with wandering risk.',
    'enhanced_safety',
    '{"interval_minutes":30,"grace_minutes":10,"quick_status_default":"awake"}'::jsonb
  ),
  (
    'd1000000-0000-0000-0000-000000000213',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000002',
    '00000000-0000-0000-0002-000000000002',
    'Post-Fall Watch',
    'Q15 to Q30 stepped protocol after a fall or acute event.',
    'watch_protocol',
    '{"steps":[{"minutes":15,"duration_minutes":60},{"minutes":30,"duration_minutes":120}]}'::jsonb
  ),
  (
    'd1000000-0000-0000-0000-000000000221',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000003',
    '00000000-0000-0000-0002-000000000003',
    'Hourly Safety Rounds',
    'Routine safety and presence confirmation for higher-risk residents.',
    'routine_rounding',
    '{"interval_minutes":60,"grace_minutes":15,"quick_status_default":"awake"}'::jsonb
  ),
  (
    'd1000000-0000-0000-0000-000000000222',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000003',
    '00000000-0000-0000-0002-000000000003',
    'Q30 Wandering Watch',
    'Temporary enhanced checks for residents with wandering risk.',
    'enhanced_safety',
    '{"interval_minutes":30,"grace_minutes":10,"quick_status_default":"awake"}'::jsonb
  ),
  (
    'd1000000-0000-0000-0000-000000000223',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000003',
    '00000000-0000-0000-0002-000000000003',
    'Post-Fall Watch',
    'Q15 to Q30 stepped protocol after a fall or acute event.',
    'watch_protocol',
    '{"steps":[{"minutes":15,"duration_minutes":60},{"minutes":30,"duration_minutes":120}]}'::jsonb
  ),
  (
    'd1000000-0000-0000-0000-000000000231',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000004',
    '00000000-0000-0000-0002-000000000004',
    'Hourly Safety Rounds',
    'Routine safety and presence confirmation for higher-risk residents.',
    'routine_rounding',
    '{"interval_minutes":60,"grace_minutes":15,"quick_status_default":"awake"}'::jsonb
  ),
  (
    'd1000000-0000-0000-0000-000000000232',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000004',
    '00000000-0000-0000-0002-000000000004',
    'Q30 Wandering Watch',
    'Temporary enhanced checks for residents with wandering risk.',
    'enhanced_safety',
    '{"interval_minutes":30,"grace_minutes":10,"quick_status_default":"awake"}'::jsonb
  ),
  (
    'd1000000-0000-0000-0000-000000000233',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000004',
    '00000000-0000-0000-0002-000000000004',
    'Post-Fall Watch',
    'Q15 to Q30 stepped protocol after a fall or acute event.',
    'watch_protocol',
    '{"steps":[{"minutes":15,"duration_minutes":60},{"minutes":30,"duration_minutes":120}]}'::jsonb
  ),
  (
    'd1000000-0000-0000-0000-000000000241',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000005',
    '00000000-0000-0000-0002-000000000005',
    'Hourly Safety Rounds',
    'Routine safety and presence confirmation for higher-risk residents.',
    'routine_rounding',
    '{"interval_minutes":60,"grace_minutes":15,"quick_status_default":"awake"}'::jsonb
  ),
  (
    'd1000000-0000-0000-0000-000000000242',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000005',
    '00000000-0000-0000-0002-000000000005',
    'Q30 Wandering Watch',
    'Temporary enhanced checks for residents with wandering risk.',
    'enhanced_safety',
    '{"interval_minutes":30,"grace_minutes":10,"quick_status_default":"awake"}'::jsonb
  ),
  (
    'd1000000-0000-0000-0000-000000000243',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000005',
    '00000000-0000-0000-0002-000000000005',
    'Post-Fall Watch',
    'Q15 to Q30 stepped protocol after a fall or acute event.',
    'watch_protocol',
    '{"steps":[{"minutes":15,"duration_minutes":60},{"minutes":30,"duration_minutes":120}]}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_watch_protocols (
  id,
  organization_id,
  entity_id,
  facility_id,
  name,
  trigger_type,
  duration_rule,
  rule_definition_json,
  approval_required,
  active
) VALUES
  (
    'd1100000-0000-0000-0000-000000000211',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000002',
    '00000000-0000-0000-0002-000000000002',
    'Post-Fall Watch',
    'incident_fall',
    '1 hour q15, 2 hours q30, then hourly for 24 hours',
    '{"steps":[{"interval_minutes":15,"duration_minutes":60},{"interval_minutes":30,"duration_minutes":120},{"interval_minutes":60,"duration_minutes":1440}]}'::jsonb,
    true,
    true
  ),
  (
    'd1100000-0000-0000-0000-000000000221',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000003',
    '00000000-0000-0000-0002-000000000003',
    'Post-Fall Watch',
    'incident_fall',
    '1 hour q15, 2 hours q30, then hourly for 24 hours',
    '{"steps":[{"interval_minutes":15,"duration_minutes":60},{"interval_minutes":30,"duration_minutes":120},{"interval_minutes":60,"duration_minutes":1440}]}'::jsonb,
    true,
    true
  ),
  (
    'd1100000-0000-0000-0000-000000000231',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000004',
    '00000000-0000-0000-0002-000000000004',
    'Post-Fall Watch',
    'incident_fall',
    '1 hour q15, 2 hours q30, then hourly for 24 hours',
    '{"steps":[{"interval_minutes":15,"duration_minutes":60},{"interval_minutes":30,"duration_minutes":120},{"interval_minutes":60,"duration_minutes":1440}]}'::jsonb,
    true,
    true
  ),
  (
    'd1100000-0000-0000-0000-000000000241',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000005',
    '00000000-0000-0000-0002-000000000005',
    'Post-Fall Watch',
    'incident_fall',
    '1 hour q15, 2 hours q30, then hourly for 24 hours',
    '{"steps":[{"interval_minutes":15,"duration_minutes":60},{"interval_minutes":30,"duration_minutes":120},{"interval_minutes":60,"duration_minutes":1440}]}'::jsonb,
    true,
    true
  )
ON CONFLICT (id) DO NOTHING;
