-- COL-627: face-sheet prints are audited, and the resident record gets a
-- history of its in-place edits.
--
-- Owner rulings (2026-09-22): face-sheet prints must be logged; the resident
-- record needs a history screen for in-place edits; and when an admission
-- document value goes stale because someone edited the same field on the
-- record first, people are told.
--
--   * public.record_resident_face_sheet_print writes one audit_log row per
--     face sheet opened. The print page renders nothing until it succeeds, so
--     a sheet handed to EMS, a hospital or a surveyor always has a row saying
--     who printed it and when. The row carries ids and a kind, never a name.
--   * public.resident_record_field_history reads the in-place edit log (461)
--     beside the intake facts applied to the same fields, newest first and
--     capped, plus the approved facts that went `stale` on apply because the
--     record changed first.
BEGIN;

-- ===========================================================================
-- 1. Face-sheet print audit
-- ===========================================================================
CREATE FUNCTION public.record_resident_face_sheet_print(p_resident_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_uid uuid := auth.uid();
  r record;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Printing a face sheet needs a signed-in user' USING ERRCODE = '42501';
  END IF;

  SELECT res.id, res.organization_id, res.facility_id INTO r
    FROM public.residents res
    WHERE res.id = p_resident_id AND res.deleted_at IS NULL;
  -- One refusal for "no such resident" and "not yours", so the answer does not
  -- say which residents exist in other facilities.
  IF r.id IS NULL OR r.organization_id IS DISTINCT FROM haven.organization_id()
    OR NOT haven.has_facility_access(r.facility_id) THEN
    RAISE EXCEPTION 'Resident unavailable' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, new_data, user_id, organization_id, facility_id)
  VALUES ('resident_face_sheet_print', r.id, 'INSERT',
    jsonb_build_object('event', 'resident_face_sheet_printed', 'print_kind', 'face_sheet'),
    v_uid, r.organization_id, r.facility_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END
$function$;
REVOKE ALL ON FUNCTION public.record_resident_face_sheet_print(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_resident_face_sheet_print(uuid) TO authenticated;

COMMENT ON FUNCTION public.record_resident_face_sheet_print(uuid) IS
'COL-627. Records that a resident face sheet was opened for printing: the resident id, the facility, the person and the time, never a name or a clinical fact. The print page renders nothing unless this succeeds. COL-37 ruling: definer required -- public.audit_log has row level security enabled and only SELECT policies, so no caller authority can write it; that immutability is the point. The caller must be signed in, in the resident''s organization and hold facility access to the resident (haven.has_facility_access) before the row is written; actor is auth.uid().';

-- ===========================================================================
-- 2. Resident record field history
-- ===========================================================================
-- Per in-place field, newest first: in-place edits (who, before, after) and
-- intake facts applied to the same field (reviewer, document title where the
-- caller may read intake). Capped at p_limit (default 50, at most 200) with a
-- `truncated` flag. `stale` lists approved admission-document facts for these
-- fields that were refused on apply because the record changed first, and that
-- no later applied fact for the same field has since replaced.
CREATE FUNCTION public.resident_record_field_history(p_resident_id uuid, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  r public.residents%ROWTYPE;
  can_read_documents boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_entries jsonb;
  v_count integer;
  v_stale jsonb;
BEGIN
  SELECT * INTO r FROM public.residents WHERE id = p_resident_id AND deleted_at IS NULL;
  IF NOT FOUND OR r.organization_id IS DISTINCT FROM haven.organization_id()
    OR NOT haven.has_facility_access(r.facility_id) THEN
    RAISE EXCEPTION 'Resident unavailable' USING ERRCODE = '42501';
  END IF;
  can_read_documents := haven.resident_record_intake_can_read(r.organization_id, r.facility_id);

  WITH field_map(field, intake_code) AS (
    -- The same intake codes resident_record_field_sources (461) reads for each field.
    VALUES ('code_status','resident.code_status'), ('allergy_list','resident.allergy_list'),
      ('diagnoses','resident.primary_diagnosis'), ('diagnoses','resident.diagnosis_list'),
      ('primary_physician','resident.primary_physician_name'), ('primary_physician','resident.primary_physician_phone'),
      ('polst_molst','resident.advance_directive')
  ), edits AS (
    SELECT e.field_code AS field, 'person'::text AS kind, e.action, e.recorded_at AS at, p.full_name AS by_name,
      e.previous_value, e.new_value, NULL::text AS document_value, NULL::text AS document_title, e.id
    FROM public.resident_record_field_edits e
    LEFT JOIN public.user_profiles p ON p.id = e.recorded_by
    WHERE e.resident_id = r.id AND e.deleted_at IS NULL
  ), applied AS (
    SELECT m.field, 'document'::text AS kind, 'set'::text AS action, x.applied_at AS at, p.full_name AS by_name,
      NULL::jsonb AS previous_value, NULL::jsonb AS new_value, CASE WHEN can_read_documents THEN x.display_value END AS document_value,
      CASE WHEN can_read_documents THEN s.title END AS document_title, x.id
    FROM public.resident_record_extracted_facts x
    JOIN field_map m ON m.intake_code = x.field_code
    JOIN public.resident_record_intakes i ON i.id = x.intake_id AND i.resident_id = r.id
    JOIN public.resident_record_intake_sources s ON s.id = x.source_id
    LEFT JOIN public.user_profiles p ON p.id = x.reviewed_by
    WHERE x.state = 'applied' AND x.deleted_at IS NULL
  ), combined AS (
    SELECT * FROM edits UNION ALL SELECT * FROM applied
  ), page AS (
    SELECT * FROM combined ORDER BY at DESC, id DESC LIMIT v_limit + 1
  )
  SELECT count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'field', q.field, 'kind', q.kind, 'action', q.action, 'at', q.at, 'by_name', q.by_name,
      'previous_value', q.previous_value, 'new_value', q.new_value,
      'document_value', q.document_value, 'document_title', q.document_title) ORDER BY q.at DESC, q.id DESC)
      FILTER (WHERE q.rn <= v_limit), '[]'::jsonb)
  INTO v_count, v_entries
  FROM (SELECT page.*, row_number() OVER (ORDER BY at DESC, id DESC) AS rn FROM page) q;

  WITH field_map(field, intake_code) AS (
    VALUES ('code_status','resident.code_status'), ('allergy_list','resident.allergy_list'),
      ('diagnoses','resident.primary_diagnosis'), ('diagnoses','resident.diagnosis_list'),
      ('primary_physician','resident.primary_physician_name'), ('primary_physician','resident.primary_physician_phone'),
      ('polst_molst','resident.advance_directive')
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'field', t.field, 'at', t.at,
      'intake_id', CASE WHEN can_read_documents THEN t.intake_id END,
      'document_title', CASE WHEN can_read_documents THEN t.title END) ORDER BY t.at DESC), '[]'::jsonb)
  INTO v_stale
  FROM (
    SELECT DISTINCT ON (m.field, x.intake_id) m.field, x.reviewed_at AS at, x.intake_id, s.title
    FROM public.resident_record_extracted_facts x
    JOIN field_map m ON m.intake_code = x.field_code
    JOIN public.resident_record_intakes i ON i.id = x.intake_id AND i.resident_id = r.id
    JOIN public.resident_record_intake_sources s ON s.id = x.source_id
    WHERE x.state = 'stale' AND x.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.resident_record_extracted_facts later
        JOIN field_map lm ON lm.intake_code = later.field_code
        JOIN public.resident_record_intakes li ON li.id = later.intake_id AND li.resident_id = r.id
        WHERE lm.field = m.field AND later.state = 'applied' AND later.deleted_at IS NULL
          AND later.applied_at > x.reviewed_at)
    ORDER BY m.field, x.intake_id, x.reviewed_at DESC
  ) t;

  RETURN jsonb_build_object('entries', v_entries, 'limit', v_limit, 'truncated', v_count > v_limit, 'stale', v_stale);
END
$function$;
REVOKE ALL ON FUNCTION public.resident_record_field_history(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resident_record_field_history(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.resident_record_field_history(uuid, integer) IS
'COL-627. COL-37 ruling: definer required to join the in-place edit log to intake provenance (resident_record_extracted_facts, intakes and intake sources), whose tables are closed to direct reads, and to name the person behind each change. Read-only; requires org match and facility access for the resident (haven.has_facility_access); document titles, applied document values and intake ids are returned only to roles that may read intake (haven.resident_record_intake_can_read); stale document values are never returned. Capped at 200 rows.';

NOTIFY pgrst, 'reload schema';
COMMIT;
