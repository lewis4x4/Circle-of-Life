-- COL-686: Haven shows a person as "First Last" everywhere on screen.
--
-- 1. v_incident_reports_log gains resident_display ("First Last"), appended
--    as the last column so CREATE OR REPLACE VIEW keeps every existing column.
--    resident stays "Last, First": the surveyor CSV mirrors the paper log,
--    which is written and sorted by surname.
-- 2. The Operator Home read functions home_past_due (464),
--    home_collection_escalations_for_executive (465) and home_shifts_today
--    (466) returned "Last, Preferred-or-First". Each is re-created verbatim
--    from its migration with only the name expression changed; ordering is
--    still by surname. Hosted bodies were fingerprinted (md5 of prosrc) against
--    those migrations before this was written. CREATE OR REPLACE keeps the
--    existing grants, owner and COL-37 ruling comments.

BEGIN;

CREATE OR REPLACE VIEW public.v_incident_reports_log
WITH (security_invoker = true)
AS
  SELECT
    i.organization_id,
    i.facility_id,
    i.id AS incident_id,
    ce.id AS care_event_id,
    i.incident_number,
    (i.occurred_at AT TIME ZONE COALESCE(f.timezone, 'America/New_York'))::date AS log_date,
    i.occurred_at,
    rm.room_number AS room,
    CASE WHEN r.id IS NULL THEN NULL ELSE r.last_name || ', ' || r.first_name END AS resident,
    (i.category::text LIKE 'fall%') AS fall,
    (COALESCE(ce.answers -> 'seen' ? 'bruise', false) OR COALESCE(i.injury_description, '') ILIKE '%bruise%') AS bruise,
    (COALESCE(ce.answers -> 'seen' ? 'burn', false)
      OR COALESCE(i.injury_description, '') ILIKE '%scrape%'
      OR COALESCE(i.injury_description, '') ILIKE '%burn%') AS scrapes_or_burn,
    (COALESCE(ce.answers -> 'seen' ? 'skin_tear', false)
      OR COALESCE(i.injury_description, '') ILIKE ANY (ARRAY['%cut%','%laceration%','%puncture%','%tear%'])) AS cut_laceration_puncture,
    (i.injury_occurred
      AND NOT (COALESCE(ce.answers -> 'seen' ? 'bruise', false) OR COALESCE(i.injury_description, '') ILIKE '%bruise%')
      AND NOT (COALESCE(ce.answers -> 'seen' ? 'burn', false) OR COALESCE(i.injury_description, '') ILIKE '%scrape%' OR COALESCE(i.injury_description, '') ILIKE '%burn%')
      AND NOT (COALESCE(ce.answers -> 'seen' ? 'skin_tear', false) OR COALESCE(i.injury_description, '') ILIKE ANY (ARRAY['%cut%','%laceration%','%puncture%','%tear%']))
    ) AS non_apparent,
    (NOT i.injury_occurred AND NOT (i.category::text LIKE 'fall%')) AS other,
    array_to_string(i.contributing_factors, '; ') AS contributing_factors,
    i.shift,
    i.severity,
    i.category,
    CASE WHEN r.id IS NULL THEN NULL ELSE r.first_name || ' ' || r.last_name END AS resident_display
  FROM public.incidents i
  JOIN public.facilities f ON f.id = i.facility_id
  LEFT JOIN public.care_events ce ON ce.incident_id = i.id AND ce.deleted_at IS NULL
  LEFT JOIN public.residents r ON r.id = i.resident_id
  LEFT JOIN public.beds b ON b.id = r.bed_id
  LEFT JOIN public.rooms rm ON rm.id = b.room_id
  WHERE i.deleted_at IS NULL;

COMMENT ON VIEW public.v_incident_reports_log IS
  'The paper Incident Reports Log, one row per incident: date, room, resident, fall, bruise, scrapes or burn, cut or laceration or puncture, non-apparent, other, contributing factors, shift. resident is "Last, First" as the paper log and its CSV write it; resident_display is "First Last" for the screen (COL-686). security_invoker: the caller''s RLS on incidents, residents and care_events applies.';

REVOKE ALL ON public.v_incident_reports_log FROM PUBLIC, anon;
GRANT SELECT ON public.v_incident_reports_log TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.home_past_due(p_facility_id uuid, p_as_of timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH f AS (
    SELECT fa.id, (p_as_of AT TIME ZONE COALESCE(fa.timezone, 'America/New_York'))::date AS local_date
    FROM public.facilities fa WHERE fa.id = p_facility_id AND fa.deleted_at IS NULL
  ), cfg AS (
    SELECT s.default_due_day, s.grace_days, s.effective_from
    FROM public.home_rent_settings s JOIN f ON s.facility_id = f.id
    WHERE s.effective_from <= f.local_date
    ORDER BY s.effective_from DESC LIMIT 1
  ), open_invoices AS (
    SELECT i.resident_id, i.balance_due,
           make_date(extract(year FROM i.period_start)::int, extract(month FROM i.period_start)::int,
                     COALESCE(r.rent_due_day, cfg.default_due_day)::int) AS due_on
    FROM public.invoices i
    JOIN public.residents r ON r.id = i.resident_id AND r.deleted_at IS NULL
    CROSS JOIN cfg
    WHERE i.facility_id = p_facility_id AND i.deleted_at IS NULL
      AND i.status IN ('sent', 'partial', 'overdue') AND i.balance_due > 0
  ), late AS (
    SELECT o.resident_id, min(o.due_on) AS oldest_due, sum(o.balance_due)::bigint AS open_cents
    FROM open_invoices o CROSS JOIN cfg CROSS JOIN f
    WHERE o.due_on + cfg.grace_days < f.local_date
    GROUP BY o.resident_id
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM cfg) THEN
      jsonb_build_object('configured', false, 'localDate', (SELECT local_date FROM f), 'residents', '[]'::jsonb)
    ELSE jsonb_build_object(
      'configured', true,
      'localDate', (SELECT local_date FROM f),
      'graceDays', (SELECT grace_days FROM cfg),
      'defaultDueDay', (SELECT default_due_day FROM cfg),
      'residents', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'residentId', l.resident_id,
                 'name', COALESCE(nullif(r.preferred_name, ''), r.first_name) || ' ' || r.last_name,
                 'oldestDueDate', l.oldest_due,
                 'daysPastDue', (SELECT local_date FROM f) - l.oldest_due,
                 'openCents', l.open_cents)
               ORDER BY l.oldest_due, r.last_name)
        FROM late l JOIN public.residents r ON r.id = l.resident_id), '[]'::jsonb))
  END
$$;

CREATE OR REPLACE FUNCTION public.home_collection_escalations_for_executive()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'activityId', c.id, 'facilityId', c.facility_id, 'facilityName', f.name, 'residentId', c.resident_id,
      'residentName', COALESCE(nullif(r.preferred_name, ''), r.first_name) || ' ' || r.last_name,
      'note', c.description, 'activityDate', c.activity_date, 'by', p.full_name)
    ORDER BY c.activity_date DESC, c.created_at DESC), '[]'::jsonb)
  FROM public.collection_activities c
  JOIN public.facility_executives fe ON fe.facility_id = c.facility_id AND fe.user_id = auth.uid()
  JOIN public.facilities f ON f.id = c.facility_id
  JOIN public.residents r ON r.id = c.resident_id
  LEFT JOIN public.user_profiles p ON p.id = c.performed_by
  WHERE c.activity_type = 'escalation' AND c.deleted_at IS NULL AND c.activity_date >= current_date - 14
$$;

CREATE OR REPLACE FUNCTION public.home_shifts_today(p_facility_id uuid, p_as_of timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record; v_local date;
BEGIN
  a := haven.home_operator_for(p_facility_id, 'call_out');
  SELECT (p_as_of AT TIME ZONE COALESCE(f.timezone, 'America/New_York'))::date INTO v_local
    FROM public.facilities f WHERE f.id = p_facility_id;
  RETURN jsonb_build_object(
    'localDate', v_local,
    'shifts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'assignmentId', sa.id, 'staffId', sa.staff_id,
          'staffName', COALESCE(nullif(s.preferred_name, ''), s.first_name) || ' ' || s.last_name,
          'shiftType', sa.shift_type, 'status', sa.status,
          'customStart', sa.custom_start_time, 'customEnd', sa.custom_end_time,
          'coversAssignmentId', sa.covers_assignment_id,
          'uncovered', sa.status IN ('called_out', 'no_show') AND NOT EXISTS (
            SELECT 1 FROM public.shift_assignments c WHERE c.covers_assignment_id = sa.id
              AND c.deleted_at IS NULL AND c.status NOT IN ('called_out', 'no_show')))
        ORDER BY sa.shift_type, s.last_name)
      FROM public.shift_assignments sa JOIN public.staff s ON s.id = sa.staff_id
      WHERE sa.facility_id = p_facility_id AND sa.shift_date = v_local AND sa.deleted_at IS NULL), '[]'::jsonb),
    'staff', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('staffId', s.id,
          'staffName', COALESCE(nullif(s.preferred_name, ''), s.first_name) || ' ' || s.last_name) ORDER BY s.last_name, s.first_name)
      FROM public.staff s
      WHERE s.facility_id = p_facility_id AND s.deleted_at IS NULL AND s.employment_status::text = 'active'
        AND COALESCE(s.excluded_from_care, false) = false), '[]'::jsonb));
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
