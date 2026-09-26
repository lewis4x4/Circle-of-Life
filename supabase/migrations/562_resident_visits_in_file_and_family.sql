-- Visits in the resident's file and in the family portal (COL-871).
--
-- Brian, 2026-09-26: a visit was findable only on the Front Desk log, by date range. It
-- was not on the resident's Timeline, and family could not see it at all.
--
--   1. v_resident_timeline gains a 'visit' branch. Only the new branch is added; the
--      columns and their order are unchanged, so this is an in-place CREATE OR REPLACE
--      and every reader of the view keeps working. The view is security_invoker, so the
--      staff SELECT policy on visitor_log_entries (412) decides who sees a visit: every
--      staff role with facility access, never family, never a housekeeper (473).
--   2. facility_communication_settings.family_visit_history: what a facility shares with
--      family. A runtime setting; the column default is the only place the default lives.
--   3. public.family_resident_visits: the family read. Family still has no SELECT on the
--      building's visitor log (412); this returns only visits to a resident the caller
--      holds a live link to, shaped by the facility setting.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Timeline: every visit to the resident
-- ---------------------------------------------------------------------------
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
  WHERE ol.deleted_at IS NULL
UNION ALL
  -- Every visit to the resident (COL-871): front desk and kiosk alike, once the entry names
  -- the resident (a kiosk entry joins as soon as the desk uses Match resident). A voided
  -- entry is not a visit. Kind is the visitor type; the detail says who came, what for,
  -- when they left in the facility's time, and a health screening flag when one was raised.
  SELECT
    v.resident_id,
    v.organization_id,
    v.facility_id,
    v.checked_in_at,
    'visit'::text,
    v.id,
    v.visitor_type,
    NULL::incident_severity,
    CASE
      WHEN v.visitor_type IN ('family_friend', 'family') THEN 'Visit from family or a friend'
      WHEN v.visitor_type IN ('healthcare_provider', 'medical') THEN 'Healthcare provider visit'
      WHEN v.visitor_type IN ('vendor_contractor', 'vendor', 'contractor') THEN 'Vendor or contractor visit'
      WHEN v.visitor_type IN ('surveyor_regulator', 'official') THEN 'Inspector or official visit'
      ELSE 'Visit' END::text,
    NULLIF(concat_ws(' ',
      btrim(v.visitor_name) || COALESCE(' · ' || NULLIF(btrim(v.visitor_company), ''), '') || '.',
      'Purpose: ' || NULLIF(btrim(v.purpose), '') || '.',
      CASE WHEN v.checked_out_at IS NULL THEN 'Not signed out.'
        ELSE 'Left ' || pg_catalog.to_char(v.checked_out_at AT TIME ZONE COALESCE(NULLIF(btrim(f.timezone), ''), 'America/New_York'), 'FMHH12:MI AM') || '.' END,
      CASE WHEN v.symptoms_reported THEN 'Reported symptoms at sign-in.' END), ''),
    NULL::uuid,
    NULL::uuid,
    CASE WHEN v.checked_out_at IS NULL THEN 'open' ELSE 'signed_out' END::text
  FROM public.visitor_log_entries v
  JOIN public.facilities f ON f.id = v.facility_id
  WHERE v.resident_id IS NOT NULL
    AND v.deleted_at IS NULL
    AND v.voided_at IS NULL;

COMMENT ON VIEW public.v_resident_timeline IS
  'The digital Resident Observation Log: care events plus pre-launch incidents, condition changes and behavior logs that have no care event, shift notes, every Smart Rounding safety check (source safety_check, or observation_exception when something was wrong), and every unvoided visit to the resident (source visit, kind = visitor_type, COL-871). security_invoker: the caller''s RLS on every source table applies, so family and housekeepers never read a visit through it. Order is left to the caller.';

-- Timeline reads a resident's visits newest first.
CREATE INDEX IF NOT EXISTS idx_visitor_log_entries_resident_checked_in
  ON public.visitor_log_entries (resident_id, checked_in_at DESC)
  WHERE resident_id IS NOT NULL AND deleted_at IS NULL AND voided_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. What a facility shares with family about visits
-- ---------------------------------------------------------------------------
ALTER TABLE public.facility_communication_settings
  ADD COLUMN family_visit_history text NOT NULL DEFAULT 'with_visitor_name'
    CONSTRAINT facility_communication_settings_family_visit_history_check
    CHECK (family_visit_history IN ('off', 'times_only', 'with_visitor_name'));
COMMENT ON COLUMN public.facility_communication_settings.family_visit_history IS
  'COL-871: what the family portal shows about visits to a linked resident. off: nothing; times_only: when, and the kind of visitor; with_visitor_name: also the visitor''s short name ("Jordan P."). Phone, company, purpose and screening answers are never shown to family. Healthcare provider visits show only to links with can_view_clinical. Runtime setting; the column default is the only default.';

-- ---------------------------------------------------------------------------
-- 3. The family read
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.family_resident_visits(p_resident_id uuid, p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := haven.authorized_user_id();
  v_link record;
  v_setting text;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
  IF v_uid IS NULL OR p_resident_id IS NULL OR haven.app_role() IS DISTINCT FROM 'family'::public.app_role THEN
    RAISE EXCEPTION 'Visit history unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT l.can_view_clinical, r.organization_id, r.facility_id INTO v_link
  FROM public.family_resident_links l
  JOIN public.user_profiles p ON p.id = l.user_id
  JOIN public.residents r ON r.id = l.resident_id
  WHERE l.user_id = v_uid
    AND l.resident_id = p_resident_id
    AND l.revoked_at IS NULL
    AND l.organization_id = haven.organization_id()
    AND p.app_role = 'family'::public.app_role AND p.is_active AND p.deleted_at IS NULL
    AND r.organization_id = l.organization_id AND r.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visit history unavailable' USING ERRCODE = '42501';
  END IF;

  -- A facility without a settings row gets one with column defaults, so the column
  -- default stays the only place the default lives (same as the kiosk visitor cap, 494).
  INSERT INTO public.facility_communication_settings (organization_id, facility_id)
  VALUES (v_link.organization_id, v_link.facility_id)
  ON CONFLICT (facility_id) DO NOTHING;
  SELECT s.family_visit_history INTO v_setting
  FROM public.facility_communication_settings s
  WHERE s.facility_id = v_link.facility_id;

  IF v_setting = 'off' THEN
    RETURN jsonb_build_object('sharing', v_setting, 'visits', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'sharing', v_setting,
    'visits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', x.id,
        'arrived_at', x.checked_in_at,
        'left_at', x.checked_out_at,
        'visitor_type', x.visitor_type,
        'visitor_name', CASE WHEN v_setting = 'with_visitor_name' THEN haven.visitor_kiosk_display_name(x.visitor_name) END
      ) ORDER BY x.checked_in_at DESC)
      FROM (
        SELECT v.id, v.checked_in_at, v.checked_out_at, v.visitor_type, v.visitor_name
        FROM public.visitor_log_entries v
        WHERE v.resident_id = p_resident_id
          AND v.facility_id = v_link.facility_id
          AND v.organization_id = v_link.organization_id
          AND v.deleted_at IS NULL
          AND v.voided_at IS NULL
          AND (v_link.can_view_clinical OR v.visitor_type NOT IN ('healthcare_provider', 'medical'))
        ORDER BY v.checked_in_at DESC
        LIMIT v_limit
      ) x
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.family_resident_visits(uuid, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.family_resident_visits(uuid, integer) TO authenticated;
COMMENT ON FUNCTION public.family_resident_visits(uuid, integer) IS
  'Visits to one resident for the family portal, newest first, shaped by facility_communication_settings.family_visit_history; healthcare provider visits only when the link has can_view_clinical; never phone, company, purpose or screening. COL-37 ruling: definer required -- family holds no SELECT on visitor_log_entries by design (412: family must not read the building''s visitor log); the body refuses any caller who is not a managed family actor with a live family_resident_links row for the resident in their organization, and returns only that resident''s unvoided visits.';

COMMIT;

NOTIFY pgrst, 'reload schema';
