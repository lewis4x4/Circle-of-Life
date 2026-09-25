-- COL-751 (part of COL-749): the census notice goes to the Administrator, the
-- Assistant Administrator and the Manager at the facility.
--
-- Brian, 2026-09-25 (ruling 2 on the batch-2 questions): the notice goes to the
-- "Administrator, Assistant Administrator (admin_assistant) and Manager at that
-- facility", and "the manager is basically the same as an assistant
-- administrator that just hasn't finished all of their classes yet." The
-- recipient roles stay a setting (stand_up.census_notice_roles, migration 523),
-- with these three as the default. Delivery stays inside Haven: Brian deferred
-- push and text (ruling 5), so stand_up.census_notice_channels stays ["in_app"].
--
--   1. A new organization row for stand_up.census_notice_roles, effective
--      2026-09-25, value ["facility_admin", "admin_assistant", "manager"]. The
--      2026-09-24 row (["facility_admin"]) stays as history. A facility's own
--      row, if any, still wins there.
--   2. The resolver's built-in default (used by an organization with no row)
--      becomes the same three roles. public.haven_operating_rule is migration
--      534's text with that one line changed.
--
-- The sweep (haven.stand_up_census_notice_sweep, 535) already writes one notice
-- per active user holding a listed role with access to the facility, and
-- public.stand_up_census_notices_for_me already returns a person's own notices
-- whatever their role, so nothing else in the database changes. The Home pages
-- and the Stand Up page show the notice to all three roles (the app change in
-- the same pull request).
BEGIN;

CREATE OR REPLACE FUNCTION public.haven_operating_rule(
  p_organization_id uuid,
  p_facility_id uuid,
  p_rule_key text,
  p_as_of date
)
RETURNS TABLE (value jsonb, rule_id uuid, effective_from date, facility_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT
    coalesce(r.value, CASE p_rule_key
      WHEN 'risk.score_bands' THEN '{"critical_below": 50, "high_below": 70, "moderate_below": 85}'::jsonb
      WHEN 'survey_binder.due_window_days' THEN '60'::jsonb
      WHEN 'resident_movement.backdate_window_days' THEN '3'::jsonb
      WHEN 'stand_up.census_reason_window_days' THEN '7'::jsonb
      WHEN 'stand_up.census_notice_lead_minutes' THEN '60'::jsonb
      WHEN 'stand_up.census_notice_roles' THEN '["facility_admin", "admin_assistant", "manager"]'::jsonb
      WHEN 'stand_up.census_reason_options' THEN '[{"key": "roster_not_current", "label": "Roster not updated yet"}, {"key": "change_not_entered", "label": "Admission or discharge not entered in Haven"}, {"key": "different_definition", "label": "Workbook counts census differently"}, {"key": "other", "label": "Other"}]'::jsonb
      WHEN 'stand_up.census_notice_channels' THEN '["in_app"]'::jsonb
      WHEN 'stand_up.thursday_census_vs_monday' THEN 'false'::jsonb
      WHEN 'stand_up.thursday_admission_notes_to_recruiters' THEN 'false'::jsonb
      WHEN 'admissions.arrival_approval_roles' THEN '["owner", "org_admin", "facility_admin"]'::jsonb
      ELSE 'null'::jsonb
    END),
    r.id,
    r.effective_from,
    r.facility_id
  FROM (SELECT 1) AS one
  LEFT JOIN LATERAL (
    SELECT o.value, o.id, o.effective_from, o.facility_id
    FROM public.operating_rules o
    WHERE o.organization_id = coalesce(p_organization_id, haven.organization_id())
      AND o.rule_key = p_rule_key
      AND (o.facility_id = p_facility_id OR o.facility_id IS NULL)
      AND o.effective_from <= p_as_of
    ORDER BY (o.facility_id IS NOT NULL) DESC, o.effective_from DESC, o.created_at DESC
    LIMIT 1
  ) r ON true
$$;

INSERT INTO public.operating_rules (organization_id, facility_id, rule_key, value, effective_from, change_reason)
SELECT o.id, NULL, 'stand_up.census_notice_roles', '["facility_admin", "admin_assistant", "manager"]'::jsonb, DATE '2026-09-25',
  'Brian''s ruling, 2026-09-25 (COL-751, applied by migration 541): census notices go to the Administrator, the Assistant Administrator (admin_assistant) and the Manager at that facility. Brian: "the manager is basically the same as an assistant administrator that just hasn''t finished all of their classes yet." Delivery stays in Haven; push and text are deferred by Brian''s decision.'
FROM public.organizations o
WHERE o.deleted_at IS NULL
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: restore migration 534's public.haven_operating_rule (default
-- ["facility_admin"]) and delete the 2026-09-25 stand_up.census_notice_roles
-- rows this migration wrote (export them first; they are the record of the
-- ruling). The 2026-09-24 rows then apply again.
