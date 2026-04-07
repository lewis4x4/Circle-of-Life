-- Oakridge demo seed for Resident Assurance Engine
-- Safe to re-run: uses fixed UUIDs and ON CONFLICT DO NOTHING / idempotent updates.

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
    'd1000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'Hourly Safety Rounds',
    'Routine safety and presence confirmation for higher-risk residents.',
    'routine_rounding',
    '{"interval_minutes":60,"grace_minutes":15,"quick_status_default":"awake"}'::jsonb
  ),
  (
    'd1000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'Q30 Wandering Watch',
    'Temporary enhanced checks for residents with wandering risk.',
    'enhanced_safety',
    '{"interval_minutes":30,"grace_minutes":10,"quick_status_default":"awake"}'::jsonb
  ),
  (
    'd1000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
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
) VALUES (
  'd1100000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0001-000000000001',
  '00000000-0000-0000-0002-000000000001',
  'Post-Fall Watch',
  'incident_fall',
  '1 hour q15, 2 hours q30, then hourly for 24 hours',
  '{"steps":[{"interval_minutes":15,"duration_minutes":60},{"interval_minutes":30,"duration_minutes":120},{"interval_minutes":60,"duration_minutes":1440}]}'::jsonb,
  true,
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_observation_plans (
  id,
  organization_id,
  entity_id,
  facility_id,
  resident_id,
  status,
  source_type,
  effective_from,
  rationale
) VALUES
  (
    'd1200000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'active',
    'care_plan',
    now() - interval '7 days',
    'High fall and wandering risk requires hourly safety rounds overnight.'
  ),
  (
    'd1200000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'c0000000-0000-0000-0000-000000000002',
    'active',
    'manual',
    now() - interval '3 days',
    'Daytime safety checks every two hours while awake.'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_observation_plan_rules (
  id,
  plan_id,
  organization_id,
  entity_id,
  facility_id,
  resident_id,
  interval_type,
  interval_minutes,
  daypart_start,
  daypart_end,
  days_of_week,
  grace_minutes,
  required_fields_schema,
  sort_order,
  active
) VALUES
  (
    'd1300000-0000-0000-0000-000000000001',
    'd1200000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'fixed_minutes',
    60,
    '20:00',
    '06:00',
    ARRAY[0,1,2,3,4,5,6],
    15,
    '{"note_on_exception":true}'::jsonb,
    1,
    true
  ),
  (
    'd1300000-0000-0000-0000-000000000002',
    'd1200000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'c0000000-0000-0000-0000-000000000002',
    'fixed_minutes',
    120,
    '06:00',
    '22:00',
    ARRAY[0,1,2,3,4,5,6],
    20,
    '{"note_on_exception":true}'::jsonb,
    1,
    true
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_watch_instances (
  id,
  organization_id,
  entity_id,
  facility_id,
  resident_id,
  protocol_id,
  triggered_by_type,
  triggered_by_id,
  starts_at,
  ends_at,
  status,
  end_reason
) VALUES (
  'd1400000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0001-000000000001',
  '00000000-0000-0000-0002-000000000001',
  'c0000000-0000-0000-0000-000000000001',
  'd1100000-0000-0000-0000-000000000001',
  'manual_review',
  NULL,
  now() - interval '2 hours',
  now() + interval '22 hours',
  'active',
  NULL
)
ON CONFLICT (id) DO NOTHING;

WITH base AS (
  SELECT
    date_trunc('minute', now()) AS t
)
INSERT INTO resident_observation_tasks (
  id,
  organization_id,
  entity_id,
  facility_id,
  resident_id,
  plan_id,
  plan_rule_id,
  watch_instance_id,
  shift_assignment_id,
  assigned_staff_id,
  scheduled_for,
  due_at,
  grace_ends_at,
  status,
  notes
) VALUES
  (
    'd1500000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'd1200000-0000-0000-0000-000000000001',
    'd1300000-0000-0000-0000-000000000001',
    'd1400000-0000-0000-0000-000000000001',
    'b9000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000003',
    (SELECT t - interval '45 minutes' FROM base),
    (SELECT t - interval '45 minutes' FROM base),
    (SELECT t - interval '30 minutes' FROM base),
    'overdue',
    'Maggie nightly safety round now overdue.'
  ),
  (
    'd1500000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'c0000000-0000-0000-0000-000000000002',
    'd1200000-0000-0000-0000-000000000002',
    'd1300000-0000-0000-0000-000000000002',
    NULL,
    'b9000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000004',
    (SELECT t - interval '5 minutes' FROM base),
    (SELECT t - interval '5 minutes' FROM base),
    (SELECT t + interval '15 minutes' FROM base),
    'due_now',
    'Harold routine daytime check due now.'
  ),
  (
    'd1500000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'c0000000-0000-0000-0000-000000000002',
    'd1200000-0000-0000-0000-000000000002',
    'd1300000-0000-0000-0000-000000000002',
    NULL,
    'b9000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000004',
    (SELECT t + interval '55 minutes' FROM base),
    (SELECT t + interval '55 minutes' FROM base),
    (SELECT t + interval '75 minutes' FROM base),
    'upcoming',
    'Next daytime safety check.'
  ),
  (
    'd1500000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'd1200000-0000-0000-0000-000000000001',
    'd1300000-0000-0000-0000-000000000001',
    'd1400000-0000-0000-0000-000000000001',
    'b9000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000003',
    (SELECT t - interval '2 hours' FROM base),
    (SELECT t - interval '2 hours' FROM base),
    (SELECT t - interval '105 minutes' FROM base),
    'completed_on_time',
    'Completed example task for dashboard history.'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_observation_assignments (
  id,
  organization_id,
  entity_id,
  facility_id,
  resident_id,
  task_id,
  shift_assignment_id,
  staff_id,
  assignment_type,
  assigned_at,
  reason
) VALUES
  (
    'd1600000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'd1500000-0000-0000-0000-000000000001',
    'b9000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000003',
    'primary',
    now() - interval '45 minutes',
    'Night shift east hall assignment.'
  ),
  (
    'd1600000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'c0000000-0000-0000-0000-000000000002',
    'd1500000-0000-0000-0000-000000000002',
    'b9000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000004',
    'primary',
    now() - interval '5 minutes',
    'Day shift west hall assignment.'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO resident_observation_logs (
  id,
  organization_id,
  entity_id,
  facility_id,
  resident_id,
  task_id,
  assigned_staff_id,
  staff_id,
  observed_at,
  entered_at,
  entry_mode,
  quick_status,
  resident_location,
  resident_position,
  resident_state,
  hydration_offered,
  exception_present,
  note
) VALUES (
  'd1700000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0001-000000000001',
  '00000000-0000-0000-0002-000000000001',
  'c0000000-0000-0000-0000-000000000001',
  'd1500000-0000-0000-0000-000000000004',
  '50000000-0000-0000-0000-000000000003',
  '50000000-0000-0000-0000-000000000003',
  now() - interval '115 minutes',
  now() - interval '112 minutes',
  'live',
  'asleep',
  'in room',
  'in bed',
  'resting comfortably',
  false,
  false,
  'Resident resting in bed, breathing regular, no distress observed.'
)
ON CONFLICT (id) DO NOTHING;

UPDATE resident_observation_tasks
SET
  completed_log_id = 'd1700000-0000-0000-0000-000000000001',
  status = 'completed_on_time'
WHERE
  id = 'd1500000-0000-0000-0000-000000000004'
  AND completed_log_id IS DISTINCT FROM 'd1700000-0000-0000-0000-000000000001';

INSERT INTO resident_watch_events (
  id,
  organization_id,
  entity_id,
  facility_id,
  resident_id,
  watch_instance_id,
  task_id,
  log_id,
  event_type,
  occurred_at,
  note
) VALUES
  (
    'd1800000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'd1400000-0000-0000-0000-000000000001',
    NULL,
    NULL,
    'watch_started',
    now() - interval '2 hours',
    'Demo active watch created for resident assurance dashboards.'
  ),
  (
    'd1800000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0002-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'd1400000-0000-0000-0000-000000000001',
    'd1500000-0000-0000-0000-000000000004',
    'd1700000-0000-0000-0000-000000000001',
    'check_completed',
    now() - interval '112 minutes',
    'Example successful watch check.'
  )
ON CONFLICT (id) DO NOTHING;
