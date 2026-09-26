-- Every safety check shows in the resident's file (COL-864).
--
-- Found in the COL-849 Homewood test (2026-09-25): a charted safety check appeared nowhere in
-- the resident's file. The Timeline (v_resident_timeline, migration 402) listed a Smart
-- Rounding check only when something was wrong. Brian ruled 2026-09-25: show every check.
-- Only the last branch changes; the columns and their order are unchanged, so this is an
-- in-place CREATE OR REPLACE and every reader of the view keeps working.

BEGIN;

CREATE OR REPLACE VIEW public.v_resident_timeline
WITH (security_invoker = true)
AS
  SELECT
    ce.resident_id,
    ce.organization_id,
    ce.facility_id,
    ce.occurred_at,
    'care_event'::text AS source,
    ce.id AS source_id,
    ce.kind AS kind,
    ce.final_level AS level,
    CASE ce.kind
      WHEN 'fall' THEN 'Fall'
      WHEN 'injury_found' THEN 'Hurt'
      WHEN 'condition_change' THEN 'Sick or not themselves'
      WHEN 'behavior' THEN 'Upset or behavior'
      WHEN 'wandering' THEN 'Wandering or left'
      WHEN 'medication' THEN 'Medicine'
      WHEN 'family_complaint' THEN 'Family or complaint'
      ELSE 'Building or other' END AS title,
    ce.sentence AS detail,
    ce.incident_id,
    ce.id AS care_event_id,
    ce.status
  FROM public.care_events ce
  WHERE ce.deleted_at IS NULL
UNION ALL
  SELECT
    i.resident_id,
    i.organization_id,
    i.facility_id,
    i.occurred_at,
    'incident'::text,
    i.id,
    i.category::text,
    i.severity,
    initcap(replace(i.category::text, '_', ' ')),
    i.description,
    i.id,
    NULL::uuid,
    i.status::text
  FROM public.incidents i
  WHERE i.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.care_events ce WHERE ce.incident_id = i.id)
UNION ALL
  SELECT
    cc.resident_id,
    cc.organization_id,
    cc.facility_id,
    cc.reported_at,
    'condition_change'::text,
    cc.id,
    cc.change_type,
    NULL::incident_severity,
    'Condition change'::text,
    cc.description,
    cc.linked_incident_id,
    NULL::uuid,
    CASE WHEN cc.resolved_at IS NULL THEN 'open' ELSE 'resolved' END
  FROM public.condition_changes cc
  WHERE cc.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.care_events ce WHERE ce.condition_change_id = cc.id)
UNION ALL
  SELECT
    bl.resident_id,
    bl.organization_id,
    bl.facility_id,
    bl.occurred_at,
    'behavior'::text,
    bl.id,
    bl.behavior_type,
    NULL::incident_severity,
    'Behavior'::text,
    bl.behavior,
    NULL::uuid,
    NULL::uuid,
    NULL::text
  FROM public.behavioral_logs bl
  WHERE bl.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.care_events ce WHERE ce.behavioral_log_id = bl.id)
UNION ALL
  SELECT
    dl.resident_id,
    dl.organization_id,
    dl.facility_id,
    dl.created_at,
    'daily_log'::text,
    dl.id,
    'note'::text,
    NULL::incident_severity,
    'Shift note'::text,
    dl.general_notes,
    NULL::uuid,
    NULL::uuid,
    NULL::text
  FROM public.daily_logs dl
  WHERE dl.deleted_at IS NULL
    AND NULLIF(btrim(COALESCE(dl.general_notes, '')), '') IS NOT NULL
UNION ALL
  -- Every Smart Rounding safety check (COL-864). A check with something wrong keeps the
  -- observation_exception source other readers count; a routine one is a safety_check.
  -- The detail is what was seen as composed at charting, the note, and who charted it.
  SELECT
    ol.resident_id,
    ol.organization_id,
    ol.facility_id,
    ol.observed_at,
    CASE WHEN ol.exception_present THEN 'observation_exception' ELSE 'safety_check' END::text,
    ol.id,
    'observation'::text,
    NULL::incident_severity,
    CASE WHEN ol.exception_present THEN 'Safety check: something wrong' ELSE 'Safety check' END::text,
    NULLIF(concat_ws(' ',
      NULLIF(btrim(ol.composed_summary), ''),
      'Note: ' || NULLIF(btrim(ol.note), ''),
      'Charted by ' || NULLIF(btrim(concat_ws(' ', COALESCE(NULLIF(btrim(s.preferred_name), ''), s.first_name), s.last_name)), '') || '.'), ''),
    NULL::uuid,
    NULL::uuid,
    NULL::text
  FROM public.resident_observation_logs ol
  LEFT JOIN public.staff s ON s.id = ol.staff_id AND s.deleted_at IS NULL
  WHERE ol.deleted_at IS NULL;

COMMENT ON VIEW public.v_resident_timeline IS
  'The digital Resident Observation Log: care events plus pre-launch incidents, condition changes and behavior logs that have no care event, shift notes, and every Smart Rounding safety check (source safety_check, or observation_exception when something was wrong). security_invoker: the caller''s RLS on every source table applies. Order is left to the caller.';

COMMIT;

NOTIFY pgrst, 'reload schema';
