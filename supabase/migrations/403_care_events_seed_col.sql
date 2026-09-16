-- 07A "Something happened" capture: organization default configuration for
-- Circle of Life (organization 00000000-0000-0000-0000-000000000001).
--
-- Spec: docs/specs/07A-something-happened-capture.md sections 4 and 6.2 (403).
--
-- Everything here is facility_id NULL, the organization default. A facility
-- row with the same task_type (protocols) or the same level (policies, as a
-- whole set) overrides it. Every timer in this file is configuration, not
-- code: change the row, not a function. Owner decisions D1 to D3 in the spec
-- may change these values before the Homewood go-live.
--
-- No named person appears in this file. The Corporate route ships with an
-- empty user_targets list; recipients are added on the settings page.
-- Idempotent: every insert is guarded by NOT EXISTS.

BEGIN;

-- ---------------------------------------------------------------------------
-- incident_followup_protocols
-- ---------------------------------------------------------------------------
WITH protocol_seed (kind, min_level, requires_flag, task_type, description, due_offset_minutes, repeat_every_minutes, repeat_until_minutes, assign_to_role) AS (
  VALUES
    -- Fall, Heads-up and above (spec 07 post-fall table)
    ('fall', 'level_2', NULL, 'vitals_check', 'Vital signs check', 0, NULL, NULL, 'reporter'),
    ('fall', 'level_2', NULL, 'vitals_recheck', 'Vital signs recheck', 240, NULL, NULL, 'caregiver'),
    ('fall', 'level_2', NULL, 'vitals_recheck_8h', 'Vital signs recheck', 480, NULL, NULL, 'caregiver'),
    ('fall', 'level_2', NULL, 'fall_risk_reassessment', 'Fall risk reassessment', 1440, NULL, NULL, 'facility_admin'),
    ('fall', 'level_2', NULL, 'enhanced_monitoring', '72-hour enhanced monitoring', 4320, NULL, NULL, 'caregiver'),
    -- Fall, Urgent and above
    ('fall', 'level_3', 'neuro_checks', 'neuro_check', 'Neuro check', 120, 120, 1440, 'caregiver'),
    ('fall', 'level_3', NULL, 'environment_assessment', 'Environment assessment', 1440, NULL, NULL, 'facility_admin'),
    ('fall', 'level_3', NULL, 'care_plan_review', 'Care plan review', 2880, NULL, NULL, 'facility_admin'),
    ('fall', 'level_3', NULL, 'root_cause_analysis', 'Root cause analysis', 4320, NULL, NULL, 'facility_admin'),
    -- Any kind, Urgent and above: Section 3 of the paper form
    ('any', 'level_3', NULL, 'witness_statement', 'Witness statement', 480, NULL, NULL, 'caregiver'),
    -- Any kind, Emergency
    ('any', 'level_4', NULL, 'ahca_report_preparation', 'Prepare the AHCA adverse incident report', 60, NULL, NULL, 'facility_admin'),
    ('any', 'level_4', NULL, 'staff_debrief', 'Staff debrief', 1440, NULL, NULL, 'facility_admin'),
    -- Resident complaint about care: grievance clock (10 and 21 days)
    ('family_complaint', 'level_2', 'grievance_clock', 'grievance_acknowledgment', 'Acknowledge the grievance in writing', 14400, NULL, NULL, 'facility_admin'),
    ('family_complaint', 'level_2', 'grievance_clock', 'grievance_resolution', 'Resolve the grievance', 30240, NULL, NULL, 'facility_admin'),
    -- Wandering, Urgent and above
    ('wandering', 'level_3', NULL, 'care_plan_review', 'Care plan review', 2880, NULL, NULL, 'facility_admin'),
    ('wandering', 'level_3', NULL, 'root_cause_analysis', 'Root cause analysis', 4320, NULL, NULL, 'facility_admin'),
    -- Sick or not themselves, Urgent and above
    ('condition_change', 'level_3', NULL, 'physician_followup', 'Physician follow-up', 60, NULL, NULL, 'facility_admin'),
    ('condition_change', 'level_3', NULL, 'care_plan_review', 'Care plan review', 2880, NULL, NULL, 'facility_admin')
)
INSERT INTO public.incident_followup_protocols (
  organization_id, facility_id, kind, min_level, requires_flag, task_type, description,
  due_offset_minutes, repeat_every_minutes, repeat_until_minutes, assign_to_role, is_active
)
SELECT
  '00000000-0000-0000-0000-000000000001', NULL, s.kind, s.min_level::incident_severity, s.requires_flag, s.task_type, s.description,
  s.due_offset_minutes, s.repeat_every_minutes, s.repeat_until_minutes, s.assign_to_role, true
FROM protocol_seed s
WHERE EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = '00000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (
    SELECT 1 FROM public.incident_followup_protocols p
    WHERE p.organization_id = '00000000-0000-0000-0000-000000000001'
      AND p.facility_id IS NULL
      AND p.kind = s.kind
      AND p.min_level = s.min_level::incident_severity
      AND p.task_type = s.task_type
      AND p.deleted_at IS NULL
  );

-- ---------------------------------------------------------------------------
-- notification_routes (organization level)
-- ---------------------------------------------------------------------------
WITH route_seed (name, severity_min, channels, staff_role_targets, user_targets) AS (
  VALUES
    ('Administrator or Assistant', 'level_2', ARRAY['in_app','push','sms']::text[], ARRAY['administrator','assistant_administrator']::text[], NULL::uuid[]),
    ('Corporate', 'level_3', ARRAY['push','sms']::text[], NULL::text[], '{}'::uuid[]),
    ('Owner', 'level_4', ARRAY['push','sms','voice']::text[], ARRAY['owner']::text[], NULL::uuid[])
)
INSERT INTO public.notification_routes (organization_id, facility_id, name, severity_min, channels, staff_role_targets, user_targets, is_active)
SELECT
  '00000000-0000-0000-0000-000000000001', NULL, s.name, s.severity_min::incident_severity, s.channels,
  s.staff_role_targets::staff_role[], s.user_targets, true
FROM route_seed s
WHERE EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = '00000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (
    SELECT 1 FROM public.notification_routes nr
    WHERE nr.organization_id = '00000000-0000-0000-0000-000000000001'
      AND nr.facility_id IS NULL
      AND nr.name = s.name
      AND nr.deleted_at IS NULL
  );

-- ---------------------------------------------------------------------------
-- care_event_escalation_policies (organization level), spec section 4
-- ---------------------------------------------------------------------------
WITH policy_seed (level, step, after_minutes, target_kind, route_name, channels, ack_within_minutes, repeat_every_minutes) AS (
  VALUES
    -- Heads-up: Administrator or Assistant, then on-call primary after 30 minutes
    ('level_2', 0, 0, 'route', 'Administrator or Assistant', ARRAY['in_app','push']::text[], 30, NULL::integer),
    ('level_2', 1, 30, 'on_call_primary', NULL, ARRAY['sms']::text[], NULL, NULL),
    -- Urgent: Administrator or Assistant and on-call primary now; secondary at 10; corporate at 20
    ('level_3', 0, 0, 'route', 'Administrator or Assistant', ARRAY['in_app','push','sms']::text[], 10, NULL),
    ('level_3', 1, 0, 'on_call_primary', NULL, ARRAY['sms']::text[], NULL, NULL),
    ('level_3', 2, 10, 'on_call_secondary', NULL, ARRAY['sms','voice']::text[], NULL, NULL),
    ('level_3', 3, 20, 'route', 'Corporate', ARRAY['push','sms']::text[], NULL, NULL),
    -- Emergency: everyone at once; voice repeats every 5 minutes until acknowledged
    ('level_4', 0, 0, 'route', 'Administrator or Assistant', ARRAY['in_app','push','sms','voice']::text[], 5, NULL),
    ('level_4', 1, 0, 'on_call_primary', NULL, ARRAY['sms','voice']::text[], NULL, NULL),
    ('level_4', 2, 0, 'route', 'Owner', ARRAY['push','sms','voice']::text[], NULL, NULL),
    ('level_4', 3, 0, 'route', 'Corporate', ARRAY['push','sms']::text[], NULL, NULL),
    ('level_4', 4, 5, 'route', 'Administrator or Assistant', ARRAY['voice']::text[], NULL, 5),
    ('level_4', 5, 5, 'on_call_primary', NULL, ARRAY['voice']::text[], NULL, 5)
)
INSERT INTO public.care_event_escalation_policies (
  organization_id, facility_id, level, ack_within_minutes, step, after_minutes, target_kind,
  notification_route_id, channels, repeat_every_minutes, is_active
)
SELECT
  '00000000-0000-0000-0000-000000000001', NULL, s.level::incident_severity, s.ack_within_minutes, s.step, s.after_minutes, s.target_kind,
  CASE WHEN s.route_name IS NULL THEN NULL ELSE (
    SELECT nr.id FROM public.notification_routes nr
    WHERE nr.organization_id = '00000000-0000-0000-0000-000000000001'
      AND nr.facility_id IS NULL
      AND nr.name = s.route_name
      AND nr.deleted_at IS NULL
    ORDER BY nr.created_at
    LIMIT 1
  ) END,
  s.channels, s.repeat_every_minutes, true
FROM policy_seed s
WHERE EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = '00000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (
    SELECT 1 FROM public.care_event_escalation_policies p
    WHERE p.organization_id = '00000000-0000-0000-0000-000000000001'
      AND p.facility_id IS NULL
      AND p.level = s.level::incident_severity
      AND p.step = s.step
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
