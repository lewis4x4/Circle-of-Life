-- COL-597: the resident record names its gaps and can now close them.
--
-- Until now the only writer of a resident's clinical facts was the intake
-- document flow (386: propose → approve → apply). The overview's fourteen
-- "record it" links all pointed back at the overview. This adds an in-place
-- writer that keeps the intake flow's two guarantees:
--
--   * the same role gate. Every field is gated by the intake flow's own
--     `haven.resident_record_expected_reviewer` + `resident_record_reviewer_allowed`,
--     so clinical facts need the same reviewer class here as there, and a
--     change to that rule changes both writers at once;
--   * provenance. A value typed on the record is logged with who, when, what it
--     was before and the surface it came from (`resident_record_field_edits`),
--     and the document a value came from is still read from the intake's own
--     applied facts. Nothing here rewrites an intake row: an approved-but-unapplied
--     fact for a field edited here goes `stale` on apply, which is the intake
--     flow's existing fingerprint rule doing its job.
--
-- Two facts the record had no column for: Do Not Hospitalize (the overview
-- inferred it from `advance_directive_on_file`, which says a document exists,
-- not what it says) and feeding tube (inferred by regex on `diet_order`).
-- Both get a column; NULL means "not recorded", never "no".
BEGIN;

ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS do_not_hospitalize boolean,
  ADD COLUMN IF NOT EXISTS feeding_tube text
    CHECK (feeding_tube IS NULL OR feeding_tube IN ('none','g_tube','j_tube','gj_tube','peg','ng_tube','other')),
  ADD COLUMN IF NOT EXISTS feeding_tube_notes text
    CHECK (feeding_tube_notes IS NULL OR length(feeding_tube_notes) <= 500);

COMMENT ON COLUMN public.residents.do_not_hospitalize IS
'COL-597. True when a Do Not Hospitalize order is in effect, false when recorded as not in effect, NULL when not recorded.';
COMMENT ON COLUMN public.residents.feeding_tube IS
'COL-597. Feeding tube type; ''none'' when recorded as no tube, NULL when not recorded.';

CREATE TABLE public.resident_record_field_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  resident_id uuid NOT NULL REFERENCES public.residents(id),
  field_code text NOT NULL CHECK (field_code IN (
    'code_status','allergy_list','diagnoses','primary_physician','do_not_hospitalize',
    'feeding_tube','hospice_status','polst_molst')),
  action text NOT NULL CHECK (action IN ('set','verify')),
  previous_value jsonb,
  new_value jsonb NOT NULL,
  -- Where the write was made. One surface today; a CHECK so a new one is a decision.
  surface text NOT NULL CHECK (surface IN ('resident_record')),
  request_key uuid NOT NULL,
  recorded_by uuid NOT NULL REFERENCES public.user_profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  UNIQUE (recorded_by, request_key)
);

CREATE INDEX idx_resident_record_field_edits_resident
  ON public.resident_record_field_edits(resident_id, field_code, recorded_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.resident_record_field_edits ENABLE ROW LEVEL SECURITY;

-- Hosted Supabase grants new tables to anon/authenticated by default ACL. The
-- log is written only by the definer below and is never updated or deleted.
REVOKE ALL ON public.resident_record_field_edits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.resident_record_field_edits TO authenticated;

CREATE POLICY "Staff see resident record edits in accessible facilities"
  ON public.resident_record_field_edits FOR SELECT TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE TRIGGER tr_resident_record_field_edits_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.resident_record_field_edits
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- The intake reviewer field code each in-place field is gated as.
CREATE FUNCTION haven.resident_record_edit_reviewer_field(p_field_code text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
  SELECT CASE p_field_code
    WHEN 'code_status' THEN 'resident.code_status'
    WHEN 'allergy_list' THEN 'resident.allergy_list'
    WHEN 'diagnoses' THEN 'resident.diagnosis_list'
    WHEN 'primary_physician' THEN 'resident.primary_physician_name'
    -- Directive facts are the intake flow's `resident.advance_directive`.
    WHEN 'do_not_hospitalize' THEN 'resident.advance_directive'
    WHEN 'hospice_status' THEN 'resident.advance_directive'
    WHEN 'polst_molst' THEN 'resident.advance_directive'
    -- A feeding tube is a nutrition order, reviewed as the diet order is.
    WHEN 'feeding_tube' THEN 'resident.diet_order'
  END
$function$;
REVOKE ALL ON FUNCTION haven.resident_record_edit_reviewer_field(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION haven.resident_record_edit_allowed(p_field_code text, p_organization_id uuid, p_facility_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT coalesce(
    haven.resident_record_edit_reviewer_field(p_field_code) IS NOT NULL
    AND EXISTS (SELECT 1 FROM haven.current_authorized_actor() a
      WHERE a.actor_is_managed AND a.actor_user_id = auth.uid() AND a.actor_organization_id = p_organization_id)
    AND haven.has_facility_access(p_facility_id)
    AND haven.resident_record_reviewer_allowed(
      haven.resident_record_expected_reviewer(haven.resident_record_edit_reviewer_field(p_field_code))),
    false)
$function$;
REVOKE ALL ON FUNCTION haven.resident_record_edit_allowed(text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION haven.resident_record_edit_text(p_value jsonb, p_key text, p_max integer)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $function$
DECLARE v text;
BEGIN
  IF p_value IS NULL OR NOT (p_value ? p_key) OR jsonb_typeof(p_value -> p_key) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_value -> p_key) <> 'string' THEN
    RAISE EXCEPTION '% must be text', p_key USING ERRCODE = '22023';
  END IF;
  v := nullif(btrim(p_value ->> p_key), '');
  IF v IS NOT NULL AND length(v) > p_max THEN
    RAISE EXCEPTION '% is too long', p_key USING ERRCODE = '22023';
  END IF;
  RETURN v;
END
$function$;
REVOKE ALL ON FUNCTION haven.resident_record_edit_text(jsonb, text, integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION haven.resident_record_edit_list(p_value jsonb, p_key text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $function$
DECLARE out_list text[];
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value -> p_key) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '% must be a list', p_key USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_value -> p_key) e WHERE jsonb_typeof(e) <> 'string') THEN
    RAISE EXCEPTION '% must be a list of text', p_key USING ERRCODE = '22023';
  END IF;
  -- Entered order kept; a repeat differing only in case is the same entry.
  SELECT coalesce(array_agg(t ORDER BY ord), '{}') INTO out_list FROM (
    SELECT DISTINCT ON (lower(t)) t, ord FROM (
      SELECT nullif(btrim(e), '') t, ord FROM jsonb_array_elements_text(p_value -> p_key) WITH ORDINALITY x(e, ord)
    ) s WHERE t IS NOT NULL ORDER BY lower(t), ord
  ) d;
  IF cardinality(out_list) > 50 OR EXISTS (SELECT 1 FROM unnest(out_list) t WHERE length(t) > 200) THEN
    RAISE EXCEPTION '% is too long', p_key USING ERRCODE = '22023';
  END IF;
  RETURN out_list;
END
$function$;
REVOKE ALL ON FUNCTION haven.resident_record_edit_list(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.resident_record_field_save(
  p_resident_id uuid,
  p_field_code text,
  p_action text,
  p_value jsonb,
  p_expected_updated_at timestamptz,
  p_request_key uuid,
  p_surface text DEFAULT 'resident_record'
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  r public.residents%ROWTYPE;
  actor uuid := auth.uid();
  prior public.resident_record_field_edits%ROWTYPE;
  previous jsonb;
  saved jsonb;
  v_text text;
  v_list text[];
  v_bool boolean;
  v_date date;
  v_doc_type text;
  v_polst public.polst_status;
  v_verified boolean;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Recording this needs a signed-in clinical reviewer' USING ERRCODE = '42501';
  END IF;
  IF p_request_key IS NULL THEN
    RAISE EXCEPTION 'A request key is required' USING ERRCODE = '22023';
  END IF;

  -- Idempotent retry: the same person sending the same request gets the same answer.
  SELECT * INTO prior FROM public.resident_record_field_edits
    WHERE recorded_by = actor AND request_key = p_request_key;
  IF FOUND THEN
    IF prior.resident_id <> p_resident_id OR prior.field_code <> p_field_code OR prior.action <> p_action THEN
      RAISE EXCEPTION 'This request key was used for a different change' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('edit_id', prior.id, 'field_code', prior.field_code,
      'updated_at', (SELECT updated_at FROM public.residents WHERE id = prior.resident_id), 'replayed', true);
  END IF;

  SELECT * INTO r FROM public.residents WHERE id = p_resident_id FOR UPDATE;
  IF NOT FOUND OR r.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Resident unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT haven.resident_record_edit_allowed(p_field_code, r.organization_id, r.facility_id) THEN
    RAISE EXCEPTION 'Your role cannot record this on the resident record' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('set','verify') OR (p_action = 'verify' AND p_field_code NOT IN ('code_status','allergy_list','diagnoses')) THEN
    RAISE EXCEPTION 'Unsupported change' USING ERRCODE = '22023';
  END IF;
  IF p_surface IS DISTINCT FROM 'resident_record' THEN
    RAISE EXCEPTION 'Unsupported surface' USING ERRCODE = '22023';
  END IF;
  -- P0409, not 40001: PostgREST retries serialization failures on its own.
  IF p_expected_updated_at IS NULL OR r.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'The resident record changed since you opened it. Refresh and try again.' USING ERRCODE = 'P0409';
  END IF;
  IF p_value IS NOT NULL AND jsonb_typeof(p_value) <> 'object' THEN
    RAISE EXCEPTION 'Value must be an object' USING ERRCODE = '22023';
  END IF;
  IF p_value IS NOT NULL AND NOT haven.resident_record_payload_safe(p_value) THEN
    RAISE EXCEPTION 'That value looks like a credential or an SSN and was not saved' USING ERRCODE = '22023';
  END IF;

  IF p_field_code = 'code_status' THEN
    previous := jsonb_build_object('code_status', r.code_status,
      'verified_at', r.code_status_verified_at, 'verified_by', r.code_status_verified_by);
    IF p_action = 'verify' THEN
      IF r.code_status IS NULL THEN
        RAISE EXCEPTION 'Record a code status before verifying it' USING ERRCODE = '22023';
      END IF;
      UPDATE public.residents SET code_status_verified_at = clock_timestamp(), code_status_verified_by = actor,
        updated_by = actor WHERE id = r.id;
      saved := jsonb_build_object('code_status', r.code_status, 'verified', true);
    ELSE
      v_text := haven.resident_record_edit_text(p_value, 'code_status', 80);
      IF v_text IS NULL THEN RAISE EXCEPTION 'Choose a code status' USING ERRCODE = '22023'; END IF;
      v_verified := coalesce((p_value ->> 'verified')::boolean, false);
      -- A changed code status is unverified until someone says they checked it
      -- against the signed order; the verifier and time are recorded, not a flag.
      UPDATE public.residents SET code_status = v_text,
        code_status_verified_at = CASE WHEN v_verified THEN clock_timestamp() END,
        code_status_verified_by = CASE WHEN v_verified THEN actor END,
        updated_by = actor WHERE id = r.id;
      saved := jsonb_build_object('code_status', v_text, 'verified', v_verified);
    END IF;

  ELSIF p_field_code = 'allergy_list' THEN
    previous := jsonb_build_object('allergy_list', to_jsonb(r.allergy_list),
      'reviewed_at', r.allergy_list_reviewed_at, 'reviewed_by', r.allergy_list_reviewed_by);
    -- Recording the list is a review of it, as the intake apply treats it; an
    -- empty list recorded here is "no known allergies", reviewed by this person.
    v_list := CASE WHEN p_action = 'verify' THEN coalesce(r.allergy_list, '{}') ELSE haven.resident_record_edit_list(p_value, 'allergies') END;
    UPDATE public.residents SET allergy_list = v_list, allergy_list_reviewed_at = clock_timestamp(),
      allergy_list_reviewed_by = actor, updated_by = actor WHERE id = r.id;
    saved := jsonb_build_object('allergy_list', to_jsonb(v_list), 'reviewed', true);

  ELSIF p_field_code = 'diagnoses' THEN
    previous := jsonb_build_object('primary_diagnosis', r.primary_diagnosis, 'diagnosis_list', to_jsonb(r.diagnosis_list),
      'reviewed_at', r.primary_diagnosis_reviewed_at, 'reviewed_by', r.primary_diagnosis_reviewed_by);
    IF p_action = 'verify' THEN
      UPDATE public.residents SET primary_diagnosis_reviewed_at = clock_timestamp(),
        primary_diagnosis_reviewed_by = actor, updated_by = actor WHERE id = r.id;
      saved := jsonb_build_object('primary_diagnosis', r.primary_diagnosis, 'diagnosis_list', to_jsonb(r.diagnosis_list), 'reviewed', true);
    ELSE
      v_text := haven.resident_record_edit_text(p_value, 'primary_diagnosis', 500);
      v_list := haven.resident_record_edit_list(p_value, 'diagnosis_list');
      UPDATE public.residents SET primary_diagnosis = v_text, diagnosis_list = v_list,
        primary_diagnosis_reviewed_at = clock_timestamp(), primary_diagnosis_reviewed_by = actor,
        updated_by = actor WHERE id = r.id;
      saved := jsonb_build_object('primary_diagnosis', v_text, 'diagnosis_list', to_jsonb(v_list), 'reviewed', true);
    END IF;

  ELSIF p_field_code = 'primary_physician' THEN
    previous := jsonb_build_object('name', r.primary_physician_name, 'phone', r.primary_physician_phone);
    v_text := haven.resident_record_edit_text(p_value, 'name', 200);
    IF v_text IS NULL THEN RAISE EXCEPTION 'Enter the physician''s name' USING ERRCODE = '22023'; END IF;
    UPDATE public.residents SET primary_physician_name = v_text,
      primary_physician_phone = haven.resident_record_edit_text(p_value, 'phone', 40),
      updated_by = actor WHERE id = r.id;
    saved := jsonb_build_object('name', v_text, 'phone', haven.resident_record_edit_text(p_value, 'phone', 40));

  ELSIF p_field_code = 'do_not_hospitalize' THEN
    previous := jsonb_build_object('do_not_hospitalize', r.do_not_hospitalize);
    IF jsonb_typeof(p_value -> 'do_not_hospitalize') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Say whether a Do Not Hospitalize order is in effect' USING ERRCODE = '22023';
    END IF;
    v_bool := (p_value ->> 'do_not_hospitalize')::boolean;
    UPDATE public.residents SET do_not_hospitalize = v_bool, updated_by = actor WHERE id = r.id;
    saved := jsonb_build_object('do_not_hospitalize', v_bool);

  ELSIF p_field_code = 'feeding_tube' THEN
    previous := jsonb_build_object('feeding_tube', r.feeding_tube, 'notes', r.feeding_tube_notes);
    v_text := haven.resident_record_edit_text(p_value, 'feeding_tube', 20);
    IF v_text IS NULL THEN RAISE EXCEPTION 'Choose a feeding tube entry' USING ERRCODE = '22023'; END IF;
    UPDATE public.residents SET feeding_tube = v_text,
      feeding_tube_notes = haven.resident_record_edit_text(p_value, 'notes', 500),
      updated_by = actor WHERE id = r.id;
    saved := jsonb_build_object('feeding_tube', v_text, 'notes', haven.resident_record_edit_text(p_value, 'notes', 500));

  ELSIF p_field_code = 'hospice_status' THEN
    previous := jsonb_build_object('hospice_status', r.hospice_status);
    v_text := haven.resident_record_edit_text(p_value, 'hospice_status', 20);
    IF v_text IS NULL OR v_text NOT IN ('none','pending','active','ended') THEN
      RAISE EXCEPTION 'Choose a hospice election state' USING ERRCODE = '22023';
    END IF;
    UPDATE public.residents SET hospice_status = v_text::public.hospice_status, updated_by = actor WHERE id = r.id;
    saved := jsonb_build_object('hospice_status', v_text);

  ELSIF p_field_code = 'polst_molst' THEN
    previous := (SELECT to_jsonb(d) - 'scanned_document_storage_path' FROM public.advance_directive_documents d
      WHERE d.resident_id = r.id AND d.deleted_at IS NULL ORDER BY d.created_at DESC LIMIT 1);
    v_doc_type := haven.resident_record_edit_text(p_value, 'document_type', 20);
    IF v_doc_type IS NULL OR v_doc_type NOT IN ('polst','molst') THEN
      RAISE EXCEPTION 'Choose POLST or MOLST' USING ERRCODE = '22023';
    END IF;
    v_text := haven.resident_record_edit_text(p_value, 'polst_status', 20);
    IF v_text IS NULL OR v_text NOT IN ('on_file','verified','revoked') THEN
      RAISE EXCEPTION 'Choose on file, verified or revoked' USING ERRCODE = '22023';
    END IF;
    v_polst := v_text::public.polst_status;
    v_date := nullif(haven.resident_record_edit_text(p_value, 'physician_signature_date', 10), '')::date;
    -- A typed entry records that the form exists and what it says; the scanned
    -- form itself still arrives through admission documents, which keeps its source.
    INSERT INTO public.advance_directive_documents(resident_id, facility_id, organization_id, document_type,
      polst_status, physician_signature_date, verified_by, verified_at, notes, created_by, updated_by)
    VALUES (r.id, r.facility_id, r.organization_id, v_doc_type, v_polst, v_date,
      CASE WHEN v_polst = 'verified' THEN actor END, CASE WHEN v_polst = 'verified' THEN clock_timestamp() END,
      haven.resident_record_edit_text(p_value, 'notes', 500), actor, actor);
    -- The document row is the record; touch the resident so the next editor's
    -- expected version moves and two people cannot talk past each other.
    UPDATE public.residents SET updated_by = actor WHERE id = r.id;
    saved := jsonb_build_object('document_type', v_doc_type, 'polst_status', v_text,
      'physician_signature_date', v_date);

  ELSE
    RAISE EXCEPTION 'Unsupported field' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.resident_record_field_edits(organization_id, facility_id, resident_id, field_code, action,
    previous_value, new_value, surface, request_key, recorded_by)
  VALUES (r.organization_id, r.facility_id, r.id, p_field_code, p_action, previous, saved, p_surface, p_request_key, actor)
  RETURNING id INTO prior.id;

  RETURN jsonb_build_object('edit_id', prior.id, 'field_code', p_field_code,
    'updated_at', (SELECT updated_at FROM public.residents WHERE id = r.id), 'replayed', false);
END
$function$;
REVOKE ALL ON FUNCTION public.resident_record_field_save(uuid, text, text, jsonb, timestamptz, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resident_record_field_save(uuid, text, text, jsonb, timestamptz, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.resident_record_field_save(uuid, text, text, jsonb, timestamptz, uuid, text) IS
'COL-597. COL-37 ruling: definer required so a typed clinical fact, its verification stamp and its provenance row are one atomic write that no caller can split, and so the log table stays write-closed to request roles. Authority is the intake reviewer rule (haven.resident_record_expected_reviewer + resident_record_reviewer_allowed) on the current server-derived actor with facility access; actor is auth.uid(); optimistic version check raises P0409; request key makes retries idempotent.';

-- Per field: may the caller record it here, and where did the current value come from.
CREATE FUNCTION public.resident_record_field_sources(p_resident_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE r public.residents%ROWTYPE; out_fields jsonb := '{}'; f text; edit record; fact record;
  intake_codes text[]; can_read_documents boolean;
BEGIN
  SELECT * INTO r FROM public.residents WHERE id = p_resident_id AND deleted_at IS NULL;
  IF NOT FOUND OR r.organization_id IS DISTINCT FROM haven.organization_id()
    OR NOT haven.has_facility_access(r.facility_id) THEN
    RAISE EXCEPTION 'Resident unavailable' USING ERRCODE = '42501';
  END IF;
  can_read_documents := haven.resident_record_intake_can_read(r.organization_id, r.facility_id);

  FOREACH f IN ARRAY ARRAY['code_status','allergy_list','diagnoses','primary_physician','do_not_hospitalize',
    'feeding_tube','hospice_status','polst_molst'] LOOP
    intake_codes := CASE f
      WHEN 'code_status' THEN ARRAY['resident.code_status']
      WHEN 'allergy_list' THEN ARRAY['resident.allergy_list']
      WHEN 'diagnoses' THEN ARRAY['resident.primary_diagnosis','resident.diagnosis_list']
      WHEN 'primary_physician' THEN ARRAY['resident.primary_physician_name','resident.primary_physician_phone']
      WHEN 'polst_molst' THEN ARRAY['resident.advance_directive']
      ELSE ARRAY[]::text[] END;

    SELECT e.recorded_at AS at, e.action, p.full_name AS by_name INTO edit
      FROM public.resident_record_field_edits e LEFT JOIN public.user_profiles p ON p.id = e.recorded_by
      WHERE e.resident_id = r.id AND e.field_code = f AND e.deleted_at IS NULL
      ORDER BY e.recorded_at DESC LIMIT 1;

    SELECT x.applied_at AS at, p.full_name AS by_name, s.title AS document_title INTO fact
      FROM public.resident_record_extracted_facts x
      JOIN public.resident_record_intake_sources s ON s.id = x.source_id
      LEFT JOIN public.user_profiles p ON p.id = x.reviewed_by
      WHERE x.applied_record_id IS NOT NULL AND x.state = 'applied' AND x.deleted_at IS NULL
        AND x.field_code = ANY(intake_codes)
        AND x.applied_record_id = CASE WHEN f = 'polst_molst' THEN x.applied_record_id ELSE r.id END
        AND EXISTS (SELECT 1 FROM public.resident_record_intakes i WHERE i.id = x.intake_id AND i.resident_id = r.id)
      ORDER BY x.applied_at DESC LIMIT 1;

    out_fields := out_fields || jsonb_build_object(f, jsonb_build_object(
      'can_edit', haven.resident_record_edit_allowed(f, r.organization_id, r.facility_id),
      'source', CASE
        WHEN edit.at IS NOT NULL AND (fact.at IS NULL OR edit.at >= fact.at) THEN jsonb_build_object(
          'kind', 'person', 'at', edit.at, 'by_name', edit.by_name, 'action', edit.action, 'surface', 'resident_record')
        WHEN fact.at IS NOT NULL THEN jsonb_build_object(
          'kind', 'document', 'at', fact.at, 'by_name', fact.by_name,
          'document_title', CASE WHEN can_read_documents THEN fact.document_title END)
        ELSE NULL END));
  END LOOP;
  RETURN out_fields;
END
$function$;
REVOKE ALL ON FUNCTION public.resident_record_field_sources(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resident_record_field_sources(uuid) TO authenticated;

COMMENT ON FUNCTION public.resident_record_field_sources(uuid) IS
'COL-597. COL-37 ruling: definer required to join the resident record to intake provenance (resident_record_extracted_facts / intake sources), whose tables are closed to direct reads, and to report the caller''s edit authority from the same private rule the writer uses. Read-only; requires org match and facility access for the resident; document titles are returned only to roles that may read intake.';

NOTIFY pgrst, 'reload schema';
COMMIT;
