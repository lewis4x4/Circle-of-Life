-- COL-353: the register Homewood actually reads, and one visitor log.
--
-- Three things ship here:
--   1. public.admission_discharge_register() - every admission, readmission,
--      discharge, death, hospital hold and leave for a facility and range,
--      DERIVED from public.resident_status_history. Nothing is retyped, so a
--      wrong row is fixed by correcting the resident's status and the register
--      follows.
--   2. public.census_record_monthly() - per resident per month, physical
--      presence days and billable days as separate figures.
--   3. Hardening for public.visitor_log_entries (migration 294), which already
--      exists and already has a front desk screen. A second visitor table would
--      give the building two places a visitor might have signed in.
--
-- Additive: no existing column changes meaning, and every new visitor column is
-- nullable or checked so rows written before this migration stay valid.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Billable status, tied to the compatibility view
-- ---------------------------------------------------------------------------
-- public.resident_billable_status (217, security_invoker since 389) decides what
-- billable means, but it reads residents.status - the CURRENT status - so it
-- cannot answer "was this resident billable last March". This helper carries the
-- same rule for a historical status. It is not a second list: the view is
-- untouched and stays the authority, and review_admission_discharge_register.sql
-- asserts the two agree for EVERY value of the enum. Change the view and that
-- probe fails.
CREATE FUNCTION haven.resident_status_is_billable(p_status public.resident_status)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_status IN ('active', 'hospital_hold', 'loa') THEN true
    WHEN p_status IN ('inquiry', 'pending_admission', 'discharged', 'deceased') THEN false
    ELSE false
  END
$$;
COMMENT ON FUNCTION haven.resident_status_is_billable(public.resident_status) IS
  'COL-353: is a historical resident status billable. Mirrors public.resident_billable_status (217) for a status the view cannot see because it reads the current one. Kept honest by review_admission_discharge_register.sql, which compares the two across the whole enum.';

-- ---------------------------------------------------------------------------
-- 2. Admission and discharge register
-- ---------------------------------------------------------------------------
-- security invoker: the caller's resident row level security decides what is
-- visible, so a user without the facility grant gets no rows rather than an
-- error. Events are classified in one pass with a window function over each
-- resident's ordered history; resident_status_history is an interval model with
-- no from_status column, so the previous status is lag(status).
CREATE FUNCTION public.admission_discharge_register(
  p_organization_id uuid,
  p_facility_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_include_holds boolean DEFAULT true
)
RETURNS TABLE (
  event_at timestamptz,
  event_type text,
  resident_id uuid,
  resident_display_name text,
  room_number text,
  bed_label text,
  room_as_of text,
  from_status public.resident_status,
  to_status public.resident_status,
  admission_source text,
  discharge_reason public.discharge_reason,
  discharge_destination text,
  recorded_by uuid,
  recorded_by_name text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH ordered AS (
    SELECT
      h.resident_id,
      h.status,
      h.effective_from,
      h.created_by,
      lag(h.status) OVER (PARTITION BY h.resident_id ORDER BY h.effective_from, h.id) AS prev_status
    FROM public.resident_status_history h
    WHERE h.organization_id = p_organization_id
      AND h.facility_id = p_facility_id
      AND h.deleted_at IS NULL
  ),
  classified AS (
    SELECT
      o.*,
      CASE o.status
        WHEN 'active' THEN CASE o.prev_status
          WHEN 'discharged' THEN 'readmission'
          WHEN 'hospital_hold' THEN 'hospital_return'
          WHEN 'loa' THEN 'leave_return'
          ELSE 'admission'
        END
        WHEN 'discharged' THEN 'discharge'
        WHEN 'deceased' THEN 'death'
        WHEN 'hospital_hold' THEN 'hospital_out'
        WHEN 'loa' THEN 'leave_out'
        ELSE NULL
      END AS event_type
    FROM ordered o
  ),
  -- residents holds ONE set of discharge columns, so a readmission overwrites
  -- the previous discharge's reason and destination. Showing them on an older
  -- row would show the wrong reason, so only the most recent ending event for
  -- each resident carries them.
  ranked AS (
    SELECT
      c.*,
      CASE WHEN c.event_type IN ('discharge', 'death')
        THEN row_number() OVER (
          PARTITION BY c.resident_id, (c.event_type IN ('discharge', 'death'))
          ORDER BY c.effective_from DESC)
        ELSE NULL
      END AS ending_rank
    FROM classified c
    WHERE c.event_type IS NOT NULL
  )
  SELECT
    r.effective_from,
    r.event_type,
    r.resident_id,
    btrim(res.first_name || ' ' || res.last_name),
    rm.room_number,
    b.bed_label,
    -- Haven has no bed assignment history, so this is where the resident is
    -- NOW, not where they were at the event. A discharged resident has no bed.
    'current'::text,
    r.prev_status,
    r.status,
    CASE WHEN r.event_type IN ('admission', 'readmission') THEN res.admission_source END,
    CASE WHEN r.ending_rank = 1 THEN res.discharge_reason END,
    CASE WHEN r.ending_rank = 1 THEN res.discharge_destination END,
    r.created_by,
    up.full_name
  FROM ranked r
  JOIN public.residents res ON res.id = r.resident_id AND res.deleted_at IS NULL
  LEFT JOIN public.beds b ON b.id = res.bed_id AND b.deleted_at IS NULL
  LEFT JOIN public.rooms rm ON rm.id = b.room_id AND rm.deleted_at IS NULL
  LEFT JOIN public.user_profiles up ON up.id = r.created_by
  -- Half open, so an event at exactly p_to belongs to the next range and no
  -- event prints twice across two adjacent packs.
  WHERE r.effective_from >= p_from
    AND r.effective_from < p_to
    AND (p_include_holds
         OR r.event_type NOT IN ('hospital_out', 'hospital_return', 'leave_out', 'leave_return'))
  ORDER BY r.effective_from, res.last_name, res.first_name
$$;
COMMENT ON FUNCTION public.admission_discharge_register(uuid,uuid,timestamptz,timestamptz,boolean) IS
  'COL-353 admission and discharge register for one facility and range, derived from resident_status_history. Never entered by hand: correct the resident status and the register follows. p_include_holds = false hides hospital and leave rows so the page can match a paper log.';

REVOKE ALL ON FUNCTION public.admission_discharge_register(uuid,uuid,timestamptz,timestamptz,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admission_discharge_register(uuid,uuid,timestamptz,timestamptz,boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Census record: physical presence and billable days, kept apart
-- ---------------------------------------------------------------------------
-- A day counts when the resident held the status at any point in it, evaluated
-- in America/New_York, so a DST day is still one day.
CREATE FUNCTION public.census_record_monthly(
  p_organization_id uuid,
  p_facility_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  resident_id uuid,
  resident_display_name text,
  month date,
  physical_presence_days integer,
  billable_days integer
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH days AS (
    SELECT d::date AS day FROM generate_series(p_from, p_to, interval '1 day') d
  ),
  hist AS (
    SELECT h.resident_id, h.status, h.effective_from, h.effective_to
    FROM public.resident_status_history h
    WHERE h.organization_id = p_organization_id
      AND h.facility_id = p_facility_id
      AND h.deleted_at IS NULL
  ),
  day_status AS (
    SELECT DISTINCT hist.resident_id, days.day, hist.status
    FROM days
    JOIN hist
      ON hist.effective_from < ((days.day + 1)::timestamp AT TIME ZONE 'America/New_York')
     AND (hist.effective_to IS NULL
          OR hist.effective_to > (days.day::timestamp AT TIME ZONE 'America/New_York'))
  )
  SELECT
    ds.resident_id,
    btrim(res.first_name || ' ' || res.last_name),
    date_trunc('month', ds.day)::date,
    count(DISTINCT ds.day) FILTER (WHERE ds.status = 'active')::integer,
    count(DISTINCT ds.day) FILTER (WHERE haven.resident_status_is_billable(ds.status))::integer
  FROM day_status ds
  JOIN public.residents res ON res.id = ds.resident_id AND res.deleted_at IS NULL
  GROUP BY ds.resident_id, res.first_name, res.last_name, date_trunc('month', ds.day)
  ORDER BY date_trunc('month', ds.day), res.last_name, res.first_name
$$;
COMMENT ON FUNCTION public.census_record_monthly(uuid,uuid,date,date) IS
  'COL-353 census record for the survey print pack: per resident per month, days physically present (active) and days billable. Billable follows haven.resident_status_is_billable, which is held equal to public.resident_billable_status by review_admission_discharge_register.sql.';

REVOKE ALL ON FUNCTION public.census_record_monthly(uuid,uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.census_record_monthly(uuid,uuid,date,date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Visitor log hardening (table from migration 294)
-- ---------------------------------------------------------------------------
-- checked_in_at and checked_out_at stay as they are. Renaming live columns would
-- break /admin/front-desk to gain nothing but a word.
ALTER TABLE public.visitor_log_entries
  ADD COLUMN IF NOT EXISTS visitor_phone text,
  ADD COLUMN IF NOT EXISTS visiting_type text,
  ADD COLUMN IF NOT EXISTS signed_in_by uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS signed_out_by uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS sign_out_method text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS void_reason text;

-- surveyor_regulator joins the vocabulary 294 already had. The existing values
-- stay: rows written before today keep their meaning and the screen labels them.
ALTER TABLE public.visitor_log_entries DROP CONSTRAINT IF EXISTS visitor_log_entries_visitor_type_check;
ALTER TABLE public.visitor_log_entries
  ADD CONSTRAINT visitor_log_entries_visitor_type_check
  CHECK (visitor_type IN ('family', 'vendor', 'contractor', 'medical', 'official', 'other',
                          'family_friend', 'healthcare_provider', 'vendor_contractor', 'surveyor_regulator'));

ALTER TABLE public.visitor_log_entries
  ADD CONSTRAINT visitor_log_entries_name_length_check
    CHECK (char_length(btrim(visitor_name)) BETWEEN 1 AND 120),
  ADD CONSTRAINT visitor_log_entries_phone_check
    CHECK (visitor_phone IS NULL OR visitor_phone ~ '^[0-9()+\-. ]{7,20}$'),
  ADD CONSTRAINT visitor_log_entries_visiting_type_check
    CHECK (visiting_type IS NULL OR visiting_type IN ('resident', 'staff', 'facility')),
  -- Only constrains rows that declare a visiting type, so 294's rows stay valid.
  ADD CONSTRAINT visitor_log_entries_visiting_resident_check
    CHECK (visiting_type IS NULL OR ((visiting_type = 'resident') = (resident_id IS NOT NULL))),
  ADD CONSTRAINT visitor_log_entries_sign_out_method_check
    CHECK (sign_out_method IS NULL OR sign_out_method IN ('individual', 'bulk_end_of_day')),
  ADD CONSTRAINT visitor_log_entries_void_reason_check
    CHECK (void_reason IS NULL OR void_reason IN ('entered_in_error', 'duplicate', 'wrong_facility')),
  ADD CONSTRAINT visitor_log_entries_void_complete_check
    CHECK ((voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL)),
  ADD CONSTRAINT visitor_log_entries_sign_out_order_check
    CHECK (checked_out_at IS NULL OR checked_out_at >= checked_in_at);

CREATE INDEX IF NOT EXISTS visitor_log_entries_open_idx
  ON public.visitor_log_entries (facility_id, checked_in_at)
  WHERE checked_out_at IS NULL AND voided_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS visitor_log_entries_range_idx
  ON public.visitor_log_entries (facility_id, checked_in_at DESC)
  WHERE deleted_at IS NULL;

-- A visitor is signed in against a resident in the building they are standing
-- in, or not at all. 294 let any resident id in.
CREATE FUNCTION haven.visitor_entry_resident_in_facility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.resident_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.residents r
    WHERE r.id = NEW.resident_id
      AND r.facility_id = NEW.facility_id
      AND r.organization_id = NEW.organization_id
      AND r.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A visitor is signed in against a resident of this facility only'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tr_visitor_log_entries_resident_in_facility
  BEFORE INSERT OR UPDATE OF resident_id, facility_id ON public.visitor_log_entries
  FOR EACH ROW EXECUTE FUNCTION haven.visitor_entry_resident_in_facility();

-- 294 gave every facility staff member a client UPDATE on this table, so a
-- visitor's name or arrival time could be rewritten after the fact with no
-- trail. Sign out, void and correction now go through definer functions.
DROP POLICY IF EXISTS "Staff update visitor log in accessible facilities" ON public.visitor_log_entries;

-- A visitor record and the resident visited are PHI adjacent: same facility
-- scope as the resident record, minus family, who must not read the building's
-- visitor log to see who called on somebody else.
DROP POLICY IF EXISTS "Staff see visitor log in accessible facilities" ON public.visitor_log_entries;
CREATE POLICY "Staff see visitor log in accessible facilities"
  ON public.visitor_log_entries FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() <> 'family'
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

DROP POLICY IF EXISTS "Staff record visitor log in accessible facilities" ON public.visitor_log_entries;
CREATE POLICY "Staff record visitor log in accessible facilities"
  ON public.visitor_log_entries FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() <> 'family'
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (signed_in_by IS NULL OR signed_in_by = auth.uid())
    AND voided_at IS NULL
    AND checked_out_at IS NULL
  );

-- ---------------------------------------------------------------------------
-- 5. Visitor write path
-- ---------------------------------------------------------------------------
-- The 04:00 America/New_York boundary, as its own function so a test can ask
-- what it says at 03:59 and 04:01 without pretending to move the clock.
CREATE FUNCTION haven.visitor_left_open_threshold(p_now timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN (p_now AT TIME ZONE 'America/New_York')::time >= time '04:00'
      THEN (((p_now AT TIME ZONE 'America/New_York')::date + time '04:00') AT TIME ZONE 'America/New_York')
    ELSE (((((p_now AT TIME ZONE 'America/New_York')::date) - 1) + time '04:00') AT TIME ZONE 'America/New_York')
  END
$$;
COMMENT ON FUNCTION haven.visitor_left_open_threshold(timestamptz) IS
  'COL-353: the most recent 04:00 America/New_York. A visitor still signed in from before it is flagged left_open and shown as an exception. Nothing is ever closed automatically.';

CREATE FUNCTION haven.visitor_entry_for_update(p_entry_id uuid)
RETURNS public.visitor_log_entries LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE e public.visitor_log_entries;
BEGIN
  SELECT * INTO e FROM public.visitor_log_entries
   WHERE id = p_entry_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visitor entry not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT haven.has_facility_access(e.facility_id) THEN
    RAISE EXCEPTION 'Not authorized for this facility' USING ERRCODE = '42501';
  END IF;
  IF haven.app_role() = 'family' THEN
    RAISE EXCEPTION 'Not authorized for this facility' USING ERRCODE = '42501';
  END IF;
  RETURN e;
END;
$$;

-- audit_log has RLS on and no policies, so only a definer function writes it.
-- The event carries who, where and what happened. No visitor name, ever.
CREATE FUNCTION haven.visitor_audit(p_entry public.visitor_log_entries, p_event text)
RETURNS void LANGUAGE sql VOLATILE SET search_path = public AS $$
  INSERT INTO public.audit_log (table_name, record_id, action, new_data, user_id, organization_id, facility_id)
  VALUES ('visitor_log_entries', p_entry.id, 'UPDATE',
          jsonb_build_object('event', p_event), auth.uid(), p_entry.organization_id, p_entry.facility_id)
$$;

CREATE FUNCTION public.visitor_sign_out(p_entry_id uuid)
RETURNS public.visitor_log_entries LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.visitor_log_entries;
BEGIN
  e := haven.visitor_entry_for_update(p_entry_id);
  IF e.voided_at IS NOT NULL THEN RAISE EXCEPTION 'This entry was voided' USING ERRCODE = '22023'; END IF;
  IF e.checked_out_at IS NOT NULL THEN RAISE EXCEPTION 'This visitor is already signed out' USING ERRCODE = '22023'; END IF;
  UPDATE public.visitor_log_entries
     SET checked_out_at = now(), signed_out_by = auth.uid(), sign_out_method = 'individual'
   WHERE id = e.id RETURNING * INTO e;
  PERFORM haven.visitor_audit(e, 'visitor_signed_out');
  RETURN e;
END;
$$;

CREATE FUNCTION public.visitor_sign_out_all_open(p_facility_id uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer; e public.visitor_log_entries;
BEGIN
  IF NOT haven.has_facility_access(p_facility_id) OR haven.app_role() = 'family' THEN
    RAISE EXCEPTION 'Not authorized for this facility' USING ERRCODE = '42501';
  END IF;
  FOR e IN
    UPDATE public.visitor_log_entries
       SET checked_out_at = now(), signed_out_by = auth.uid(), sign_out_method = 'bulk_end_of_day'
     WHERE facility_id = p_facility_id
       AND checked_out_at IS NULL
       AND voided_at IS NULL
       AND deleted_at IS NULL
    RETURNING *
  LOOP
    PERFORM haven.visitor_audit(e, 'visitor_signed_out_bulk_end_of_day');
  END LOOP;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN coalesce(n, 0);
END;
$$;

CREATE FUNCTION public.visitor_void(p_entry_id uuid, p_reason text)
RETURNS public.visitor_log_entries LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.visitor_log_entries;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('entered_in_error', 'duplicate', 'wrong_facility') THEN
    RAISE EXCEPTION 'Choose why this entry is wrong' USING ERRCODE = '22023';
  END IF;
  e := haven.visitor_entry_for_update(p_entry_id);
  IF e.voided_at IS NOT NULL THEN RAISE EXCEPTION 'This entry was already voided' USING ERRCODE = '22023'; END IF;
  UPDATE public.visitor_log_entries
     SET voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
   WHERE id = e.id RETURNING * INTO e;
  PERFORM haven.visitor_audit(e, 'visitor_entry_voided');
  RETURN e;
END;
$$;

-- security invoker: the reader's row level security decides what comes back.
CREATE FUNCTION public.visitor_log(
  p_organization_id uuid,
  p_facility_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_include_voided boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  visitor_name text,
  visitor_phone text,
  visitor_type text,
  visiting_type text,
  visiting_resident_id uuid,
  visiting_resident_name text,
  signed_in_at timestamptz,
  signed_in_by_name text,
  signed_out_at timestamptz,
  signed_out_by_name text,
  sign_out_method text,
  voided_at timestamptz,
  void_reason text,
  left_open boolean
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    v.id, v.visitor_name, v.visitor_phone, v.visitor_type, v.visiting_type,
    v.resident_id,
    CASE WHEN v.resident_id IS NULL THEN NULL ELSE btrim(res.first_name || ' ' || res.last_name) END,
    v.checked_in_at,
    si.full_name,
    v.checked_out_at,
    so.full_name,
    v.sign_out_method,
    v.voided_at,
    v.void_reason,
    v.checked_out_at IS NULL
      AND v.voided_at IS NULL
      AND v.checked_in_at < haven.visitor_left_open_threshold(now())
  FROM public.visitor_log_entries v
  LEFT JOIN public.residents res ON res.id = v.resident_id AND res.deleted_at IS NULL
  LEFT JOIN public.user_profiles si ON si.id = coalesce(v.signed_in_by, v.created_by)
  LEFT JOIN public.user_profiles so ON so.id = v.signed_out_by
  WHERE v.organization_id = p_organization_id
    AND v.facility_id = p_facility_id
    AND v.deleted_at IS NULL
    AND v.checked_in_at >= p_from
    AND v.checked_in_at < p_to
    AND (p_include_voided OR v.voided_at IS NULL)
  ORDER BY v.checked_in_at
$$;

COMMENT ON FUNCTION public.visitor_sign_out(uuid) IS
  'Signs one visitor out, once. COL-37 ruling: definer required -- authenticated has no UPDATE on public.visitor_log_entries and no UPDATE policy exists, deliberately, because migration 294 let any facility staff member rewrite a visitor name or arrival time from the client. The body asserts the caller''s facility grant with haven.has_facility_access, refuses the family role, takes FOR UPDATE, and writes an audit row. Keep it definer.';
COMMENT ON FUNCTION public.visitor_sign_out_all_open(uuid) IS
  'Signs out every visitor still in the building at end of day and returns the count. COL-37 ruling: definer required -- same missing UPDATE privilege as visitor_sign_out. The facility grant is asserted before the first row is touched, voided rows are skipped, and each closed entry writes its own audit row. Keep it definer.';
COMMENT ON FUNCTION public.visitor_void(uuid,text) IS
  'Voids a wrong visitor entry with a coded reason, leaving it visible. COL-37 ruling: definer required -- the correction path has to write columns the client cannot, and voiding rather than deleting is what keeps the mistake on the record. Facility grant asserted, reason checked against the coded set, second void refused. Keep it definer.';

REVOKE ALL ON FUNCTION
  public.visitor_sign_out(uuid),
  public.visitor_sign_out_all_open(uuid),
  public.visitor_void(uuid,text),
  public.visitor_log(uuid,uuid,timestamptz,timestamptz,boolean),
  haven.visitor_left_open_threshold(timestamptz),
  haven.visitor_entry_for_update(uuid),
  haven.visitor_audit(public.visitor_log_entries,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.visitor_sign_out(uuid),
  public.visitor_sign_out_all_open(uuid),
  public.visitor_void(uuid,text),
  public.visitor_log(uuid,uuid,timestamptz,timestamptz,boolean),
  haven.visitor_left_open_threshold(timestamptz)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Survey print pack: the print is the record of what a surveyor was handed
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.survey_print_pack_record(
  p_facility_id uuid,
  p_sections text[],
  p_from date,
  p_to date
)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_id uuid;
BEGIN
  IF NOT haven.has_facility_access(p_facility_id) OR haven.app_role() = 'family' THEN
    RAISE EXCEPTION 'Not authorized for this facility' USING ERRCODE = '42501';
  END IF;
  IF p_sections IS NULL OR array_length(p_sections, 1) IS NULL THEN
    RAISE EXCEPTION 'Choose at least one section to print' USING ERRCODE = '22023';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Choose a date range to print' USING ERRCODE = '22023';
  END IF;
  SELECT f.organization_id INTO v_org FROM public.facilities f WHERE f.id = p_facility_id;
  -- Sections and a range, never a name. What was provided, not who is in it.
  INSERT INTO public.audit_log (table_name, record_id, action, new_data, user_id, organization_id, facility_id)
  VALUES ('survey_print_pack', p_facility_id, 'INSERT',
          jsonb_build_object(
            'event', 'survey_print_pack_printed',
            'sections', to_jsonb(p_sections),
            'range_from', p_from,
            'range_to', p_to),
          auth.uid(), v_org, p_facility_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
COMMENT ON FUNCTION public.survey_print_pack_record(uuid,text[],date,date) IS
  'COL-353: records that a survey print pack was produced - facility, sections and range, no names. The print view does not render unless this succeeds, so a pack handed to a surveyor always has a row saying what it contained.';

COMMENT ON FUNCTION public.survey_print_pack_record(uuid,text[],date,date) IS
  'Records that a survey print pack was produced. COL-37 ruling: definer required -- public.audit_log has row level security enabled and no policies at all, so no caller authority can reach it; that immutability is the point. The body asserts the caller''s facility grant, refuses the family role, and writes sections and a range with no names. Keep it definer.';

REVOKE ALL ON FUNCTION public.survey_print_pack_record(uuid,text[],date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.survey_print_pack_record(uuid,text[],date,date) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: DROP FUNCTION public.survey_print_pack_record(uuid,text[],date,date),
-- public.visitor_log(uuid,uuid,timestamptz,timestamptz,boolean), public.visitor_void(uuid,text),
-- public.visitor_sign_out_all_open(uuid), public.visitor_sign_out(uuid),
-- haven.visitor_audit(public.visitor_log_entries,text), haven.visitor_entry_for_update(uuid),
-- haven.visitor_left_open_threshold(timestamptz), public.census_record_monthly(uuid,uuid,date,date),
-- public.admission_discharge_register(uuid,uuid,timestamptz,timestamptz,boolean),
-- haven.resident_status_is_billable(public.resident_status); DROP TRIGGER
-- tr_visitor_log_entries_resident_in_facility ON public.visitor_log_entries and its function;
-- drop the constraints and columns added above; restore the 294 UPDATE and SELECT policies.
-- Visitor rows are operational evidence: keep them.
