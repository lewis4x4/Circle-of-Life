-- COL-595 (Home W3): Quick note that becomes a task, and the collections
-- contact log on Home. Shipped dark: quick_note and collections_log are
-- switched on per facility through home_set_module_release (466).
--
-- Why a new table instead of "the existing team-task engine": there is none
-- that fits. operation_task_instances has no browser write path, no free title,
-- no vendor assignee and no update thread (its manual occurrences take only a
-- catalog activity and a note); workspace_cards are private to their owner.
-- home_notes is one object updated in place: the note is the first entry, later
-- updates append to home_note_updates, and a note with an assignee or a
-- follow-up date is a task that appears in On tap.
--
-- Collections contact entries land in the existing collection_activities
-- (the resident's contact history, read by the rent roll). A voicemail
-- schedules the retry for the next facility day; an escalation is readable by
-- the named Facility Executive. Letters stay off until templates exist.
--
-- Rolls forward only.

BEGIN;

ALTER TABLE public.home_module_releases DROP CONSTRAINT IF EXISTS home_module_releases_module_key_check;
ALTER TABLE public.home_module_releases ADD CONSTRAINT home_module_releases_module_key_check
  CHECK (module_key IN ('record_payment', 'past_due', 'quick_note', 'collections_log', 'call_out'));

-- ---------------------------------------------------------------------------
-- 1. Notes and tasks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.home_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  resident_id uuid REFERENCES public.residents(id),
  note_type text NOT NULL CHECK (note_type IN ('collections', 'maintenance', 'staffing', 'resident', 'other')),
  body text NOT NULL CHECK (btrim(body) <> '' AND length(body) <= 4000),
  assignee_user_id uuid REFERENCES auth.users(id),
  assignee_vendor_id uuid REFERENCES public.vendors(id),
  follow_up_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES auth.users(id),
  closed_at timestamptz,
  deleted_at timestamptz,
  CHECK (assignee_user_id IS NULL OR assignee_vendor_id IS NULL),
  CHECK ((status = 'done') = (closed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_home_notes_facility_open ON public.home_notes (facility_id, status, follow_up_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_home_notes_assignee ON public.home_notes (assignee_user_id) WHERE deleted_at IS NULL AND status = 'open';
CREATE INDEX IF NOT EXISTS idx_home_notes_type ON public.home_notes (facility_id, note_type, created_at DESC) WHERE deleted_at IS NULL;
COMMENT ON TABLE public.home_notes IS
  'COL-595: a note typed on Home. With an assignee (a Home user or a vendor) or a follow-up date it is a task and appears in On tap; without either it stays a note on the facility (and resident, if linked). One object updated in place: later entries append to home_note_updates.';

CREATE TABLE IF NOT EXISTS public.home_note_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.home_notes(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  body text NOT NULL CHECK (btrim(body) <> '' AND length(body) <= 4000),
  closed_note boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_home_note_updates_note ON public.home_note_updates (note_id, created_at);

ALTER TABLE public.home_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_note_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Facility operators see Home notes" ON public.home_notes;
CREATE POLICY "Facility operators see Home notes" ON public.home_notes
  FOR SELECT TO authenticated USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND deleted_at IS NULL
    AND (haven.app_role()::text IN ('owner', 'org_admin', 'facility_admin', 'manager') OR assignee_user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Facility operators see Home note updates" ON public.home_note_updates;
CREATE POLICY "Facility operators see Home note updates" ON public.home_note_updates
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.home_notes n WHERE n.id = home_note_updates.note_id)
  );
REVOKE ALL ON public.home_notes, public.home_note_updates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.home_notes, public.home_note_updates TO authenticated;

CREATE OR REPLACE FUNCTION haven.refuse_home_note_update_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Home note updates are append-only' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION haven.refuse_home_note_update_mutation() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS home_note_updates_append_only ON public.home_note_updates;
CREATE TRIGGER home_note_updates_append_only BEFORE UPDATE OR DELETE ON public.home_note_updates
  FOR EACH ROW EXECUTE FUNCTION haven.refuse_home_note_update_mutation();
DROP TRIGGER IF EXISTS home_notes_audit_trigger ON public.home_notes;
CREATE TRIGGER home_notes_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON public.home_notes
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
DROP TRIGGER IF EXISTS home_note_updates_audit_trigger ON public.home_note_updates;
CREATE TRIGGER home_note_updates_audit_trigger AFTER INSERT ON public.home_note_updates
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- Who may write on Home: the operator roles, with access to the facility, and
-- the module switched on there.
CREATE OR REPLACE FUNCTION haven.home_operator_for(p_facility_id uuid, p_module text)
RETURNS record LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM haven.current_authorized_actor();
  IF a.actor_user_id IS NULL OR a.actor_role_text NOT IN ('owner', 'org_admin', 'facility_admin', 'manager')
     OR NOT EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = p_facility_id AND f.organization_id = a.actor_organization_id AND f.deleted_at IS NULL)
     OR p_facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'Home is for facility operators' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.home_module_releases r
                 WHERE r.facility_id = p_facility_id AND r.module_key = p_module
                   AND r.released_from <= clock_timestamp() AND (r.released_until IS NULL OR r.released_until > clock_timestamp())) THEN
    RAISE EXCEPTION 'This is not switched on for this facility yet' USING ERRCODE = '42501';
  END IF;
  RETURN a;
END $$;
REVOKE ALL ON FUNCTION haven.home_operator_for(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.home_note_create(
  p_id uuid, p_facility_id uuid, p_note_type text, p_body text,
  p_resident_id uuid DEFAULT NULL, p_assignee_user_id uuid DEFAULT NULL,
  p_assignee_vendor_id uuid DEFAULT NULL, p_follow_up_date date DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record; v_existing public.home_notes; v_row public.home_notes;
BEGIN
  IF p_id IS NULL THEN RAISE EXCEPTION 'Note identity required' USING ERRCODE = '22023'; END IF;
  a := haven.home_operator_for(p_facility_id, 'quick_note');
  SELECT * INTO v_existing FROM public.home_notes WHERE id = p_id;
  IF FOUND THEN
    IF v_existing.facility_id <> p_facility_id OR v_existing.created_by <> a.actor_user_id OR v_existing.body <> btrim(p_body) THEN
      RAISE EXCEPTION 'Note identity already used for a different note' USING ERRCODE = '23505';
    END IF;
    RETURN to_jsonb(v_existing) || jsonb_build_object('replayed', true);
  END IF;
  IF p_resident_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.residents r WHERE r.id = p_resident_id AND r.facility_id = p_facility_id AND r.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Resident is not in this facility' USING ERRCODE = '22023';
  END IF;
  -- A person assignee must be able to open this facility's Home.
  IF p_assignee_user_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.user_facility_access u JOIN public.user_profiles p ON p.id = u.user_id
       WHERE u.user_id = p_assignee_user_id AND u.facility_id = p_facility_id AND u.revoked_at IS NULL
         AND p.is_active AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'That person does not work in this facility in Haven' USING ERRCODE = '22023';
  END IF;
  IF p_assignee_vendor_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.vendor_facilities vf JOIN public.vendors v ON v.id = vf.vendor_id
       WHERE vf.vendor_id = p_assignee_vendor_id AND vf.facility_id = p_facility_id AND v.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'That vendor is not linked to this facility' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.home_notes (id, organization_id, facility_id, resident_id, note_type, body,
                                 assignee_user_id, assignee_vendor_id, follow_up_date, created_by)
  VALUES (p_id, a.actor_organization_id, p_facility_id, p_resident_id, p_note_type, btrim(p_body),
          p_assignee_user_id, p_assignee_vendor_id, p_follow_up_date, a.actor_user_id)
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row) || jsonb_build_object('replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.home_note_create(uuid, uuid, text, text, uuid, uuid, uuid, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.home_note_create(uuid, uuid, text, text, uuid, uuid, uuid, date) TO authenticated;
COMMENT ON FUNCTION public.home_note_create(uuid, uuid, text, text, uuid, uuid, uuid, date) IS
  'COL-37 ruling: definer required — home_notes has no browser write grant so every note is attributable to the current operator; the function asserts an owner/org_admin/facility_admin/manager actor with facility access and the quick_note release, checks the resident, person and vendor belong to the facility, and inserts one row; a repeated id replays (COL-595).';

CREATE OR REPLACE FUNCTION public.home_note_append(p_id uuid, p_note_id uuid, p_body text, p_close boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record; v_note public.home_notes; v_update public.home_note_updates;
BEGIN
  SELECT * INTO v_note FROM public.home_notes WHERE id = p_note_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Note unavailable' USING ERRCODE = '42501'; END IF;
  a := haven.home_operator_for(v_note.facility_id, 'quick_note');
  SELECT * INTO v_update FROM public.home_note_updates WHERE id = p_id;
  IF FOUND THEN
    IF v_update.note_id <> p_note_id OR v_update.body <> btrim(p_body) THEN
      RAISE EXCEPTION 'Update identity already used' USING ERRCODE = '23505';
    END IF;
    RETURN to_jsonb(v_update) || jsonb_build_object('replayed', true);
  END IF;
  IF v_note.status = 'done' THEN RAISE EXCEPTION 'This note is closed' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.home_note_updates (id, note_id, organization_id, facility_id, body, closed_note, created_by)
  VALUES (p_id, p_note_id, v_note.organization_id, v_note.facility_id, btrim(p_body), coalesce(p_close, false), a.actor_user_id)
  RETURNING * INTO v_update;
  UPDATE public.home_notes
     SET updated_at = now(),
         status = CASE WHEN p_close THEN 'done' ELSE status END,
         closed_at = CASE WHEN p_close THEN now() ELSE closed_at END,
         closed_by = CASE WHEN p_close THEN a.actor_user_id ELSE closed_by END
   WHERE id = p_note_id;
  RETURN to_jsonb(v_update) || jsonb_build_object('replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.home_note_append(uuid, uuid, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.home_note_append(uuid, uuid, text, boolean) TO authenticated;
COMMENT ON FUNCTION public.home_note_append(uuid, uuid, text, boolean) IS
  'COL-37 ruling: definer required — the thread is append-only with no browser write grant; the function asserts the current operator for the note''s facility and the quick_note release, appends one entry and optionally closes the note (COL-595).';

-- What reaches On tap: open tasks for the caller, or for the facility queue
-- (vendor-assigned or date-only), on or after their follow-up date.
CREATE OR REPLACE FUNCTION public.home_notes_on_tap(p_facility_id uuid, p_as_of timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH f AS (
    SELECT (p_as_of AT TIME ZONE COALESCE(fa.timezone, 'America/New_York'))::date AS local_date
    FROM public.facilities fa WHERE fa.id = p_facility_id AND fa.deleted_at IS NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'noteId', n.id, 'noteType', n.note_type, 'body', n.body, 'followUpDate', n.follow_up_date,
      'overdue', n.follow_up_date < f.local_date,
      'assignee', CASE WHEN n.assignee_user_id IS NOT NULL THEN jsonb_build_object('kind', 'user', 'userId', n.assignee_user_id, 'displayName', p.full_name)
                       WHEN n.assignee_vendor_id IS NOT NULL THEN jsonb_build_object('kind', 'vendor', 'vendorId', n.assignee_vendor_id, 'displayName', v.name)
                       ELSE jsonb_build_object('kind', 'queue') END,
      'residentId', n.resident_id,
      'updates', (SELECT count(*) FROM public.home_note_updates u WHERE u.note_id = n.id)
    ) ORDER BY n.follow_up_date NULLS LAST, n.created_at), '[]'::jsonb)
  FROM public.home_notes n
  CROSS JOIN f
  LEFT JOIN public.user_profiles p ON p.id = n.assignee_user_id
  LEFT JOIN public.vendors v ON v.id = n.assignee_vendor_id
  WHERE n.facility_id = p_facility_id AND n.deleted_at IS NULL AND n.status = 'open'
    AND (n.assignee_user_id IS NOT NULL OR n.assignee_vendor_id IS NOT NULL OR n.follow_up_date IS NOT NULL)
    AND (n.assignee_user_id IS NULL OR n.assignee_user_id = auth.uid())
    AND (n.follow_up_date IS NULL OR n.follow_up_date <= f.local_date)
$$;
REVOKE ALL ON FUNCTION public.home_notes_on_tap(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_notes_on_tap(uuid, timestamptz) TO authenticated;

-- People a note can be assigned to: active Haven users with access to the
-- facility and a Home role. Names only.
CREATE OR REPLACE FUNCTION public.home_note_assignees(p_facility_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM haven.current_authorized_actor();
  IF a.actor_user_id IS NULL OR a.actor_role_text NOT IN ('owner', 'org_admin', 'facility_admin', 'manager')
     OR p_facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'Home is for facility operators' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'people', COALESCE((SELECT jsonb_agg(jsonb_build_object('userId', p.id, 'displayName', p.full_name, 'title', p.job_title) ORDER BY p.full_name)
       FROM public.user_profiles p JOIN public.user_facility_access u ON u.user_id = p.id
       WHERE u.facility_id = p_facility_id AND u.revoked_at IS NULL AND p.is_active AND p.deleted_at IS NULL
         AND p.organization_id = a.actor_organization_id
         AND p.app_role::text IN ('owner', 'org_admin', 'facility_admin', 'manager')), '[]'::jsonb),
    'vendors', COALESCE((SELECT jsonb_agg(jsonb_build_object('vendorId', v.id, 'displayName', v.name) ORDER BY v.name)
       FROM public.vendors v JOIN public.vendor_facilities vf ON vf.vendor_id = v.id
       WHERE vf.facility_id = p_facility_id AND v.deleted_at IS NULL AND v.organization_id = a.actor_organization_id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.home_note_assignees(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.home_note_assignees(uuid) TO authenticated;
COMMENT ON FUNCTION public.home_note_assignees(uuid) IS
  'COL-37 ruling: definer required — a facility administrator cannot read other users'' profiles or every vendor directly; the function asserts a Home operator with facility access and returns only names of that facility''s active Home users and linked vendors (COL-595).';

-- ---------------------------------------------------------------------------
-- 2. Collections contact log
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.home_log_collection_contact(
  p_id uuid, p_resident_id uuid, p_kind text, p_note text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a record;
  v_resident record;
  v_local date;
  v_existing public.collection_activities;
  v_row public.collection_activities;
  v_type text;
BEGIN
  IF p_kind NOT IN ('call', 'voicemail', 'escalate') THEN
    RAISE EXCEPTION 'Contact kind must be call, voicemail or escalate' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Say what happened' USING ERRCODE = '22023';
  END IF;
  SELECT r.id, r.facility_id, r.organization_id, COALESCE(f.timezone, 'America/New_York') AS tz INTO v_resident
    FROM public.residents r JOIN public.facilities f ON f.id = r.facility_id
   WHERE r.id = p_resident_id AND r.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE = '42501'; END IF;
  a := haven.home_operator_for(v_resident.facility_id, 'collections_log');

  SELECT * INTO v_existing FROM public.collection_activities WHERE id = p_id;
  IF FOUND THEN
    IF v_existing.resident_id <> p_resident_id OR v_existing.performed_by <> a.actor_user_id OR v_existing.description <> btrim(p_note) THEN
      RAISE EXCEPTION 'Contact identity already used' USING ERRCODE = '23505';
    END IF;
    RETURN to_jsonb(v_existing) || jsonb_build_object('replayed', true);
  END IF;

  v_local := (now() AT TIME ZONE v_resident.tz)::date;
  v_type := CASE p_kind WHEN 'call' THEN 'phone_call' WHEN 'voicemail' THEN 'voicemail' ELSE 'escalation' END;
  INSERT INTO public.collection_activities (id, resident_id, facility_id, organization_id, activity_type, activity_date,
                                            performed_by, description, follow_up_date, follow_up_notes)
  VALUES (p_id, p_resident_id, v_resident.facility_id, v_resident.organization_id, v_type, v_local,
          a.actor_user_id, btrim(p_note),
          CASE WHEN p_kind = 'voicemail' THEN v_local + 1 END,
          CASE WHEN p_kind = 'voicemail' THEN 'Voicemail left; call again.'
               WHEN p_kind = 'escalate' THEN 'Escalated to the Facility Executive.' END)
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row) || jsonb_build_object('replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.home_log_collection_contact(uuid, uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.home_log_collection_contact(uuid, uuid, text, text) TO authenticated;
COMMENT ON FUNCTION public.home_log_collection_contact(uuid, uuid, text, text) IS
  'COL-37 ruling: definer required — collection_activities is written only by finance roles and the admin API; Home adds managers, so the function asserts the current operator for the resident''s facility and the collections_log release, then inserts one attributable row with the follow-up the kind implies (voicemail: retry next facility day). A repeated id replays (COL-595).';

-- Collection escalations reach the named Facility Executive (read only).
CREATE OR REPLACE FUNCTION public.home_collection_escalations_for_executive()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'activityId', c.id, 'facilityId', c.facility_id, 'facilityName', f.name, 'residentId', c.resident_id,
      'residentName', r.last_name || ', ' || COALESCE(nullif(r.preferred_name, ''), r.first_name),
      'note', c.description, 'activityDate', c.activity_date, 'by', p.full_name)
    ORDER BY c.activity_date DESC, c.created_at DESC), '[]'::jsonb)
  FROM public.collection_activities c
  JOIN public.facility_executives fe ON fe.facility_id = c.facility_id AND fe.user_id = auth.uid()
  JOIN public.facilities f ON f.id = c.facility_id
  JOIN public.residents r ON r.id = c.resident_id
  LEFT JOIN public.user_profiles p ON p.id = c.performed_by
  WHERE c.activity_type = 'escalation' AND c.deleted_at IS NULL AND c.activity_date >= current_date - 14
$$;
REVOKE ALL ON FUNCTION public.home_collection_escalations_for_executive() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.home_collection_escalations_for_executive() TO authenticated;
COMMENT ON FUNCTION public.home_collection_escalations_for_executive() IS
  'COL-37 ruling: definer required — the Facility Executive may not hold a finance role on collection_activities; the function returns only escalation entries from the last 14 days for facilities where auth.uid() is the named executive, nothing else (COL-595).';

COMMIT;

NOTIFY pgrst, 'reload schema';
