-- COL-354: what stands between a captured care event and the paper it replaces.
--
-- Spec: docs/specs/07A-something-happened-capture.md section 5 (witness
-- statements), section 2 (attachments), Appendix A (the paper artifacts).
-- As-built audit: docs/homewood/care-events-as-built-2026-09-16.md section 3.
--
-- Numbered 412 because main stops at 411 and migrations:check enforces a
-- contiguous sequence. COL-353 (PR #579) also holds 412 on its branch; whichever
-- merges second renumbers. Re-check origin/main immediately before pushing.
--
-- Additive only. Migrations 400 to 403 are applied and ledgered on production
-- and on Haven HFO Staging; this file extends them and revokes nothing.
--
-- Three things:
--
--   1. Witness statements. The tasks already generate. Nobody could complete
--      one: there was no function that took a choice, the reporter received a
--      task for their own event, Heads-up events produced none at all, and any
--      caregiver at the facility could complete any other caregiver's task.
--   2. Attachments. The bucket took images under 15 MB with no kind and no cap,
--      so a scanned incident form or a faxed physician order had nowhere to go.
--   3. A print record. audit_log.action only admits INSERT, UPDATE and DELETE,
--      so a print is written as an INSERT of a synthetic table_name, following
--      the survey_print_pack_record pattern rather than inventing a second one.
--
-- No named person appears in this file.

BEGIN;

-- ===========================================================================
-- 1. Witness statements
-- ===========================================================================

-- The choice the caregiver taps. No required typing anywhere on this path:
-- the choice is the answer and the note is optional.
ALTER TABLE public.incident_followups
  ADD COLUMN IF NOT EXISTS witness_choice text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'incident_followups_witness_choice_check'
  ) THEN
    ALTER TABLE public.incident_followups
      ADD CONSTRAINT incident_followups_witness_choice_check
      CHECK (witness_choice IS NULL OR witness_choice IN ('saw_it','did_not_see_it','arrived_after'));
  END IF;
END
$$;

COMMENT ON COLUMN public.incident_followups.witness_choice IS
  'Witness statement answer: saw_it, did_not_see_it or arrived_after. Set only through complete_incident_followup. NULL on every other task type.';

CREATE INDEX IF NOT EXISTS idx_followups_witness_open
  ON public.incident_followups (assigned_to, due_at)
  WHERE deleted_at IS NULL AND completed_at IS NULL AND task_type = 'witness_statement';

-- A Heads-up event is exactly the case where memory of who was standing there
-- fades fastest, and the 2019 procedure asks for the Administrator on every
-- incident. Lower the organization default from Urgent to Heads-up. A facility
-- row, if one is ever added, still wins; a hand-edited row is left alone.
UPDATE public.incident_followup_protocols
SET min_level = 'level_2'
WHERE task_type = 'witness_statement'
  AND facility_id IS NULL
  AND min_level = 'level_3'
  AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- care_event_sync_witness_tasks: the one place a witness task is created.
-- ---------------------------------------------------------------------------
-- Called by submit_care_event (replaced below) and by care_event_add_witness,
-- so an administrator-added witness gets a row identical to a generated one.
-- Idempotent: an existing task for a user is left as it is, completed or not.
CREATE OR REPLACE FUNCTION public.care_event_sync_witness_tasks(p_care_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event record;
  v_incident record;
  v_tz text;
  v_proto record;
  v_user uuid;
  v_added integer := 0;
BEGIN
  SELECT ce.* INTO v_event
  FROM public.care_events ce
  WHERE ce.id = p_care_event_id AND ce.deleted_at IS NULL;
  IF v_event.id IS NULL OR v_event.incident_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT i.incident_number INTO v_incident
  FROM public.incidents i WHERE i.id = v_event.incident_id;

  SELECT COALESCE(f.timezone, 'America/New_York') INTO v_tz
  FROM public.facilities f WHERE f.id = v_event.facility_id;

  -- The facility row wins over the organization default, as everywhere else.
  SELECT p.* INTO v_proto
  FROM public.incident_followup_protocols p
  WHERE p.is_active AND p.deleted_at IS NULL
    AND p.organization_id = v_event.organization_id
    AND (p.facility_id = v_event.facility_id OR p.facility_id IS NULL)
    AND p.task_type = 'witness_statement'
    AND p.min_level <= v_event.final_level
  ORDER BY p.facility_id NULLS LAST
  LIMIT 1;
  IF v_proto.id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_user IN
    SELECT DISTINCT s.user_id
    FROM public.shift_assignments sa
    JOIN public.staff s ON s.id = sa.staff_id AND s.deleted_at IS NULL
    WHERE sa.facility_id = v_event.facility_id
      AND sa.deleted_at IS NULL
      AND sa.shift_date = (v_event.occurred_at AT TIME ZONE v_tz)::date
      AND sa.shift_type = v_event.shift
      AND sa.status NOT IN ('called_out','no_show')
      AND s.user_id IS NOT NULL
      -- Never the reporter. Their account is the event.
      AND s.user_id <> v_event.reported_by
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.incident_followups f
      WHERE f.incident_id = v_event.incident_id
        AND f.task_type = 'witness_statement'
        AND f.assigned_to = v_user
        AND f.deleted_at IS NULL
    );
    INSERT INTO public.incident_followups (
      incident_id, resident_id, facility_id, organization_id,
      task_type, description, due_at, assigned_to
    ) VALUES (
      v_event.incident_id, v_event.resident_id, v_event.facility_id, v_event.organization_id,
      'witness_statement',
      format('Witness statement for %s', COALESCE(v_incident.incident_number, 'this incident')),
      v_event.occurred_at + make_interval(mins => v_proto.due_offset_minutes),
      v_user
    );
    v_added := v_added + 1;
  END LOOP;

  -- Nobody else on shift. Leave one unassigned row so the administrator can see
  -- that Section 3 was considered and name a witness by hand.
  IF v_added = 0 AND NOT EXISTS (
    SELECT 1 FROM public.incident_followups f
    WHERE f.incident_id = v_event.incident_id
      AND f.task_type = 'witness_statement'
      AND f.deleted_at IS NULL
  ) THEN
    INSERT INTO public.incident_followups (
      incident_id, resident_id, facility_id, organization_id,
      task_type, description, due_at, assigned_to
    ) VALUES (
      v_event.incident_id, v_event.resident_id, v_event.facility_id, v_event.organization_id,
      'witness_statement',
      format('Witness statement for %s', COALESCE(v_incident.incident_number, 'this incident')),
      v_event.occurred_at + make_interval(mins => v_proto.due_offset_minutes),
      NULL
    );
    v_added := 1;
  END IF;

  RETURN v_added;
END;
$function$;

REVOKE ALL ON FUNCTION public.care_event_sync_witness_tasks(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.care_event_sync_witness_tasks(uuid) IS
  'Private helper: creates one witness statement task per staff member on that shift at that facility, excluding the reporter, from the applicable incident_followup_protocols row. Idempotent per assignee. Called by submit_care_event and care_event_add_witness only; no request role may execute it.';

-- ---------------------------------------------------------------------------
-- complete_incident_followup: the assignee taps one of three choices.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_incident_followup(
  p_followup_id uuid,
  p_choice text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := haven.app_role()::text;
  v_task record;
  v_choice text := NULLIF(btrim(COALESCE(p_choice, '')), '');
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_is_admin boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  v_is_admin := v_role IN ('owner','org_admin','facility_admin','admin_assistant','manager');

  SELECT f.* INTO v_task
  FROM public.incident_followups f
  WHERE f.id = p_followup_id AND f.deleted_at IS NULL
  FOR UPDATE;
  IF v_task.id IS NULL
     OR v_task.organization_id <> haven.organization_id()
     OR v_task.facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'followup: forbidden';
  END IF;

  -- A witness statement is testimony. Only the person it was assigned to may
  -- give it; an administrator may close an unassigned one. Nobody signs for
  -- somebody else, which is the whole point of Section 3 of the paper form.
  IF v_task.task_type = 'witness_statement' THEN
    IF v_task.assigned_to IS NOT NULL AND v_task.assigned_to <> v_uid THEN
      RAISE EXCEPTION 'followup: a witness statement is given by the person it was assigned to';
    END IF;
    IF v_task.assigned_to IS NULL AND NOT v_is_admin THEN
      RAISE EXCEPTION 'followup: forbidden';
    END IF;
    IF v_choice IS NULL OR v_choice NOT IN ('saw_it','did_not_see_it','arrived_after') THEN
      RAISE EXCEPTION 'followup: choose I saw it, I did not see it, or I arrived after';
    END IF;
  ELSE
    IF NOT v_is_admin AND v_task.assigned_to IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'followup: forbidden';
    END IF;
    v_choice := NULL;
  END IF;

  IF v_task.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'followup: this task is already complete';
  END IF;

  UPDATE public.incident_followups
  SET completed_at = now(),
      completed_by = v_uid,
      witness_choice = v_choice,
      completion_notes = v_note
  WHERE id = v_task.id;

  RETURN jsonb_build_object(
    'followup_id', v_task.id,
    'task_type', v_task.task_type,
    'witness_choice', v_choice,
    'completed_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_incident_followup(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_incident_followup(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.complete_incident_followup(uuid, text, text) IS
  'Completes one follow-up task, once. A witness statement requires one of saw_it, did_not_see_it or arrived_after and may be given only by its assignee (an administrator may close an unassigned one); the note is always optional. COL-37 ruling: definer required -- the incident_followups UPDATE policy is facility-scoped, so RLS alone cannot tell caregiver A''s task from caregiver B''s, and the assignee test has to live in one place that also takes FOR UPDATE against a double completion. The body checks auth.uid(), haven.app_role(), the organization and haven.accessible_facility_ids() first.';

-- ---------------------------------------------------------------------------
-- The administrator adds or removes a witness from the completion form.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.care_event_add_witness(p_care_event_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := haven.app_role()::text;
  v_event record;
  v_incident record;
  v_tz text;
  v_offset integer;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','org_admin','facility_admin','admin_assistant','manager') THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;

  SELECT ce.* INTO v_event
  FROM public.care_events ce
  WHERE ce.id = p_care_event_id AND ce.deleted_at IS NULL;
  IF v_event.id IS NULL
     OR v_event.organization_id <> haven.organization_id()
     OR v_event.facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;
  IF v_event.incident_id IS NULL THEN
    RAISE EXCEPTION 'care_event: a Note has no incident to attach a witness statement to';
  END IF;
  IF p_user_id = v_event.reported_by THEN
    RAISE EXCEPTION 'care_event: the reporter already gave the account this event is built from';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.user_id = p_user_id
      AND s.organization_id = v_event.organization_id
      AND s.deleted_at IS NULL
      AND s.facility_id IN (SELECT haven.accessible_facility_ids())
  ) THEN
    RAISE EXCEPTION 'care_event: that staff member is not at a facility you can see';
  END IF;

  SELECT f.id INTO v_id
  FROM public.incident_followups f
  WHERE f.incident_id = v_event.incident_id
    AND f.task_type = 'witness_statement'
    AND f.assigned_to = p_user_id
    AND f.deleted_at IS NULL;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('followup_id', v_id, 'created', false);
  END IF;

  SELECT i.incident_number INTO v_incident FROM public.incidents i WHERE i.id = v_event.incident_id;
  SELECT COALESCE(f.timezone, 'America/New_York') INTO v_tz FROM public.facilities f WHERE f.id = v_event.facility_id;
  SELECT p.due_offset_minutes INTO v_offset
  FROM public.incident_followup_protocols p
  WHERE p.is_active AND p.deleted_at IS NULL
    AND p.organization_id = v_event.organization_id
    AND (p.facility_id = v_event.facility_id OR p.facility_id IS NULL)
    AND p.task_type = 'witness_statement'
  ORDER BY p.facility_id NULLS LAST
  LIMIT 1;

  INSERT INTO public.incident_followups (
    incident_id, resident_id, facility_id, organization_id,
    task_type, description, due_at, assigned_to
  ) VALUES (
    v_event.incident_id, v_event.resident_id, v_event.facility_id, v_event.organization_id,
    'witness_statement',
    format('Witness statement for %s', COALESCE(v_incident.incident_number, 'this incident')),
    v_event.occurred_at + make_interval(mins => COALESCE(v_offset, 480)),
    p_user_id
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('followup_id', v_id, 'created', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.care_event_add_witness(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.care_event_add_witness(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.care_event_add_witness(uuid, uuid) IS
  'Administrator adds a witness the shift roster did not catch. Refuses the reporter and anyone outside the caller''s facilities; returns the existing task rather than a duplicate. COL-37 ruling: definer required -- it writes incident_followups on behalf of another user and has to read staff and the protocol table to build a row identical to a generated one.';

CREATE OR REPLACE FUNCTION public.care_event_remove_witness(p_followup_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := haven.app_role()::text;
  v_task record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','org_admin','facility_admin','admin_assistant','manager') THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;

  SELECT f.* INTO v_task
  FROM public.incident_followups f
  WHERE f.id = p_followup_id AND f.deleted_at IS NULL AND f.task_type = 'witness_statement'
  FOR UPDATE;
  IF v_task.id IS NULL
     OR v_task.organization_id <> haven.organization_id()
     OR v_task.facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;

  -- A given statement is a record. Removing the person who gave it would erase
  -- testimony; the administrator can only withdraw a request nobody answered.
  IF v_task.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'care_event: a statement that has been given stays on the record';
  END IF;

  UPDATE public.incident_followups
  SET deleted_at = now(),
      completion_notes = NULLIF(btrim(COALESCE(p_reason, '')), '')
  WHERE id = v_task.id;

  RETURN jsonb_build_object('followup_id', v_task.id, 'removed', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.care_event_remove_witness(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.care_event_remove_witness(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.care_event_remove_witness(uuid, text) IS
  'Administrator withdraws an unanswered witness statement request (soft delete). A completed statement is refused: testimony that was given stays on the record. COL-37 ruling: definer required -- no DELETE or soft-delete policy exists on incident_followups for any request role, deliberately.';

-- ---------------------------------------------------------------------------
-- RLS: a caregiver may complete their own task, not somebody else's.
-- ---------------------------------------------------------------------------
-- 022 shipped one FOR ALL policy, facility-scoped, with no assignee test, so a
-- caregiver could complete any task in the building. Replaced with the same
-- reach for admin roles and own-or-unassigned rows for everyone else. This
-- narrows access; nothing that could be read or written before is widened.
DROP POLICY IF EXISTS clinical_staff_manage_incident_followups ON public.incident_followups;

CREATE POLICY clinical_staff_insert_incident_followups ON public.incident_followups
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','admin_assistant','manager','nurse','caregiver')
  );

CREATE POLICY clinical_staff_update_incident_followups ON public.incident_followups
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (
      haven.app_role() IN ('owner','org_admin','facility_admin','admin_assistant','manager','nurse')
      OR assigned_to = auth.uid()
      OR assigned_to IS NULL
    )
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (
      haven.app_role() IN ('owner','org_admin','facility_admin','admin_assistant','manager','nurse')
      OR assigned_to = auth.uid()
      OR assigned_to IS NULL
    )
  );

-- ===========================================================================
-- 2. Attachments
-- ===========================================================================

ALTER TABLE public.incident_photos
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'photo';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incident_photos_kind_check') THEN
    ALTER TABLE public.incident_photos
      ADD CONSTRAINT incident_photos_kind_check
      CHECK (kind IN ('photo','scanned_form','physician_order','other'));
  END IF;
END
$$;

COMMENT ON COLUMN public.incident_photos.kind IS
  'photo, scanned_form, physician_order or other. Existing rows default to photo, which is what the caregiver receipt uploader has only ever produced.';

-- The bucket: PDF for a scanned incident form or a faxed physician order, and
-- 20 MB because a phone photograph of a full letter page clears 15. Still
-- private, and the three policies from 400 (organization and facility scoped)
-- are untouched. Re-running 400 after this would revert both values: its
-- ON CONFLICT (id) DO UPDATE writes the old limit and MIME list back.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    EXECUTE $sql$
      UPDATE storage.buckets
      SET file_size_limit = 20971520,
          allowed_mime_types = ARRAY[
            'image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'
          ]::text[],
          public = false
      WHERE id = 'incident-photos'
    $sql$;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- attach_care_event_file: one file, with a kind, behind a cap.
-- ---------------------------------------------------------------------------
-- append_care_event_note (402) keeps working and keeps writing kind 'photo'.
-- This is the path that accepts a scanned form or a physician order.
CREATE OR REPLACE FUNCTION public.attach_care_event_file(
  p_care_event_id uuid,
  p_path text,
  p_kind text DEFAULT 'photo',
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := haven.app_role()::text;
  v_event record;
  v_path text := NULLIF(btrim(COALESCE(p_path, '')), '');
  v_kind text := COALESCE(NULLIF(btrim(COALESCE(p_kind, '')), ''), 'photo');
  v_attachments jsonb;
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_kind NOT IN ('photo','scanned_form','physician_order','other') THEN
    RAISE EXCEPTION 'care_event: unknown attachment kind';
  END IF;
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'care_event: a file path is required';
  END IF;

  SELECT ce.id, ce.organization_id, ce.facility_id, ce.reported_by, ce.incident_id, ce.answers
    INTO v_event
  FROM public.care_events ce
  WHERE ce.id = p_care_event_id AND ce.deleted_at IS NULL;
  IF v_event.id IS NULL
     OR v_event.organization_id <> haven.organization_id()
     OR v_event.facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;
  IF v_event.reported_by <> v_uid
     AND (v_role IS NULL OR v_role NOT IN ('owner','org_admin','facility_admin','admin_assistant','manager','nurse')) THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;

  -- Path law, same as append_care_event_note: the storage policies scope on the
  -- first two segments, so a path shaped any other way is refused here rather
  -- than landing somewhere the policies do not cover.
  IF v_path !~ ('^' || v_event.organization_id::text || '/' || v_event.facility_id::text || '/' || v_event.id::text || '/[^/]+$') THEN
    RAISE EXCEPTION 'care_event: file path must be <organization_id>/<facility_id>/<care_event_id>/<file>';
  END IF;

  PERFORM set_config('haven.care_event_definer', '1', true);

  v_attachments := CASE WHEN jsonb_typeof(v_event.answers -> 'attachments') = 'array'
                        THEN v_event.answers -> 'attachments' ELSE '[]'::jsonb END;
  v_count := jsonb_array_length(v_attachments);
  IF v_count >= 10 THEN
    RAISE EXCEPTION 'care_event: ten files is the limit for one incident';
  END IF;
  IF v_attachments @> to_jsonb(v_path) THEN
    RAISE EXCEPTION 'care_event: that file is already attached';
  END IF;

  v_attachments := v_attachments || to_jsonb(v_path);
  UPDATE public.care_events
  SET answers = answers || jsonb_build_object('attachments', v_attachments)
  WHERE id = v_event.id;

  IF v_event.incident_id IS NOT NULL THEN
    INSERT INTO public.incident_photos (
      incident_id, facility_id, organization_id, storage_path, description, kind, taken_by
    ) VALUES (
      v_event.incident_id, v_event.facility_id, v_event.organization_id, v_path,
      NULLIF(btrim(COALESCE(p_description, '')), ''), v_kind, v_uid
    );
  END IF;

  RETURN jsonb_build_object(
    'care_event_id', v_event.id,
    'path', v_path,
    'kind', v_kind,
    'count', jsonb_array_length(v_attachments)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.attach_care_event_file(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_care_event_file(uuid, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.attach_care_event_file(uuid, text, text, text) IS
  'Records one attachment against a care event and its incident: photo, scanned_form, physician_order or other, at most ten per incident, no duplicate paths. Enforces the <organization_id>/<facility_id>/<care_event_id>/<file> path law the storage policies depend on. COL-37 ruling: definer required -- the reporter holds no INSERT policy on incident_photos and no UPDATE policy on care_events beyond the note. The body checks auth.uid(), the organization and haven.accessible_facility_ids() first.';

-- The list an administrator reads: kind, uploader and when, never the bytes.
CREATE OR REPLACE VIEW public.v_care_event_attachments
WITH (security_invoker = true)
AS
  SELECT
    ce.id AS care_event_id,
    ip.id AS attachment_id,
    ip.incident_id,
    ip.organization_id,
    ip.facility_id,
    ip.storage_path,
    ip.kind,
    ip.description,
    ip.taken_at,
    ip.taken_by,
    up.full_name AS taken_by_name
  FROM public.incident_photos ip
  JOIN public.care_events ce ON ce.incident_id = ip.incident_id AND ce.deleted_at IS NULL
  LEFT JOIN public.user_profiles up ON up.id = ip.taken_by;

COMMENT ON VIEW public.v_care_event_attachments IS
  'Attachments for a care event with their kind and who uploaded them. security_invoker: the caller''s RLS on incident_photos, care_events and user_profiles applies. Holds paths, never signed URLs; the client signs for five minutes at read time.';

REVOKE ALL ON public.v_care_event_attachments FROM PUBLIC, anon;
GRANT SELECT ON public.v_care_event_attachments TO authenticated, service_role;

-- ===========================================================================
-- 3. The print record
-- ===========================================================================
-- audit_log.action is CHECK (action IN ('INSERT','UPDATE','DELETE')), so a read
-- cannot be recorded as its own verb. Same shape as COL-353's
-- survey_print_pack_record: a synthetic table_name and an event key in new_data.
-- Consolidating the two is COL-379.
--
-- Ids, a kind and a range. No resident name, no staff name, no incident number.
CREATE OR REPLACE FUNCTION public.care_event_print_record(
  p_print_kind text,
  p_care_event_id uuid DEFAULT NULL,
  p_facility_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := haven.app_role()::text;
  v_org uuid := haven.organization_id();
  v_facility uuid := p_facility_id;
  v_record uuid;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_print_kind NOT IN ('incident_form','physician_sheet','incident_reports_log','taxonomy_packet') THEN
    RAISE EXCEPTION 'print: unknown print kind';
  END IF;

  -- The physician sheet and the incident form carry a resident's clinical
  -- detail; the log and the packet are facility-wide. Neither is for the floor.
  IF p_print_kind IN ('incident_form','physician_sheet','incident_reports_log') THEN
    IF v_role IS NULL OR v_role NOT IN ('owner','org_admin','facility_admin','admin_assistant','manager','nurse') THEN
      RAISE EXCEPTION 'print: forbidden';
    END IF;
  ELSE
    IF v_role IS NULL OR v_role NOT IN ('owner','org_admin') THEN
      RAISE EXCEPTION 'print: forbidden';
    END IF;
  END IF;

  IF p_care_event_id IS NOT NULL THEN
    SELECT ce.facility_id INTO v_facility
    FROM public.care_events ce
    WHERE ce.id = p_care_event_id AND ce.deleted_at IS NULL AND ce.organization_id = v_org;
    IF v_facility IS NULL THEN
      RAISE EXCEPTION 'print: forbidden';
    END IF;
    v_record := p_care_event_id;
  ELSE
    v_record := v_facility;
  END IF;

  IF v_facility IS NULL OR v_facility NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'print: forbidden';
  END IF;

  INSERT INTO public.audit_log (
    table_name, record_id, action, new_data, user_id, organization_id, facility_id
  ) VALUES (
    'care_event_print', v_record, 'INSERT',
    jsonb_build_object(
      'event', 'care_event_printed',
      'print_kind', p_print_kind,
      'care_event_id', p_care_event_id,
      'range_from', p_from,
      'range_to', p_to
    ),
    v_uid, v_org, v_facility
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.care_event_print_record(text, uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.care_event_print_record(text, uuid, uuid, date, date) TO authenticated;

COMMENT ON FUNCTION public.care_event_print_record(text, uuid, uuid, date, date) IS
  'Records that an incident form, physician sheet, incident reports log or taxonomy packet was printed: ids, a kind and a range, never a name. The print view renders nothing unless this succeeds, so a sheet handed to a physician or a surveyor always has a row saying what it was. COL-37 ruling: definer required -- public.audit_log has row level security enabled and only SELECT policies, so no caller authority can write it; that immutability is the point. Role is checked per print kind and the facility grant is asserted before the row is written.';

-- ===========================================================================
-- 4. submit_care_event, with the witness block delegating to the helper
-- ===========================================================================
-- Identical to 402 apart from the witness branch, which now calls
-- care_event_sync_witness_tasks so that generated and administrator-added
-- witness tasks are built by the same code and the reporter is excluded.
CREATE OR REPLACE FUNCTION public.submit_care_event(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := haven.app_role()::text;
  v_org uuid := haven.organization_id();
  v_client_event_id uuid;
  v_facility_id uuid;
  v_resident_id uuid;
  v_kind text;
  v_answers jsonb;
  v_note text;
  v_occurred_at timestamptz;
  v_location_code text;
  v_location_label text;
  v_captured_offline boolean;
  v_tz text;
  v_time_label text;
  v_hour integer;
  v_shift shift_type;
  v_existing record;
  v_context jsonb;
  v_derived jsonb;
  v_level integer;
  v_derived_level integer;
  v_final_level incident_severity;
  v_derived_sev incident_severity;
  v_category incident_category;
  v_flags jsonb;
  v_sentence text;
  v_worried boolean;
  v_care_event_id uuid;
  v_behavioral_log_id uuid;
  v_condition_change_id uuid;
  v_incident_id uuid;
  v_incident_number text;
  v_immediate_actions text;
  v_injury_occurred boolean;
  v_injury_severity text;
  v_injury_description text;
  v_where text;
  v_hurt text;
  v_what text;
  v_touched text;
  v_first_sign text;
  v_seen_labels text;
  v_proto record;
  v_due timestamptz;
  v_offset integer;
  v_assignee uuid;
  v_policy record;
  v_level_word text;
  v_tile_word text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','caregiver','med_tech') THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'care_event: payload must be an object';
  END IF;

  PERFORM set_config('haven.care_event_definer', '1', true);

  BEGIN
    v_client_event_id := (p_payload ->> 'client_event_id')::uuid;
    v_facility_id := (p_payload ->> 'facility_id')::uuid;
    v_resident_id := NULLIF(p_payload ->> 'resident_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'care_event: invalid identifier in payload';
  END;
  IF v_client_event_id IS NULL THEN
    RAISE EXCEPTION 'care_event: client_event_id required';
  END IF;
  IF v_facility_id IS NULL THEN
    RAISE EXCEPTION 'care_event: facility_id required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.facilities f
    WHERE f.id = v_facility_id AND f.organization_id = v_org AND f.deleted_at IS NULL
  ) OR v_facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'care_event: forbidden';
  END IF;

  v_kind := p_payload ->> 'kind';
  IF v_kind IS NULL OR v_kind NOT IN ('fall','injury_found','condition_change','behavior','wandering','medication','family_complaint','environment') THEN
    RAISE EXCEPTION 'care_event: unknown kind';
  END IF;

  IF v_resident_id IS NULL AND v_kind <> 'environment' THEN
    RAISE EXCEPTION 'care_event: resident required';
  END IF;
  IF v_resident_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.residents r
    WHERE r.id = v_resident_id AND r.facility_id = v_facility_id AND r.organization_id = v_org AND r.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'care_event: resident not at facility';
  END IF;

  -- Idempotent replay: same organization and client_event_id returns the same receipt.
  SELECT ce.id, ce.final_level, ce.incident_id
    INTO v_existing
  FROM public.care_events ce
  WHERE ce.organization_id = v_org AND ce.client_event_id = v_client_event_id;
  IF v_existing.id IS NOT NULL THEN
    RETURN public.care_event_receipt(v_existing.id, true);
  END IF;

  v_answers := CASE WHEN jsonb_typeof(p_payload -> 'answers') = 'object' THEN p_payload -> 'answers' ELSE '{}'::jsonb END;
  v_note := NULLIF(btrim(COALESCE(p_payload ->> 'note', '')), '');
  v_occurred_at := COALESCE(NULLIF(p_payload ->> 'occurred_at', '')::timestamptz, now());
  v_location_code := NULLIF(btrim(COALESCE(p_payload ->> 'location_code', '')), '');
  v_captured_offline := COALESCE((p_payload ->> 'captured_offline')::boolean, false);
  v_worried := lower(COALESCE(v_answers ->> 'worried', 'false')) = 'true';

  SELECT COALESCE(f.timezone, 'America/New_York') INTO v_tz FROM public.facilities f WHERE f.id = v_facility_id;

  IF v_location_code IS NOT NULL THEN
    SELECT ov.display_label INTO v_location_label
    FROM public.observation_vocab ov
    WHERE ov.organization_id = v_org
      AND ov.field_name = 'location'
      AND ov.value_code = v_location_code
      AND ov.active
      AND ov.deleted_at IS NULL
      AND (ov.facility_id = v_facility_id OR ov.facility_id IS NULL)
    ORDER BY ov.facility_id NULLS LAST
    LIMIT 1;
  END IF;

  v_time_label := to_char(v_occurred_at AT TIME ZONE v_tz, 'FMHH12:MI AM');
  v_hour := EXTRACT(HOUR FROM (v_occurred_at AT TIME ZONE v_tz))::integer;
  v_shift := CASE WHEN v_hour >= 7 AND v_hour < 15 THEN 'day' WHEN v_hour >= 15 AND v_hour < 23 THEN 'evening' ELSE 'night' END;

  v_context := jsonb_build_object(
    'active_watch', v_resident_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.resident_watch_instances w
      WHERE w.resident_id = v_resident_id
        AND w.deleted_at IS NULL
        AND w.status IN ('active','pending_approval')
        AND (w.ends_at IS NULL OR w.ends_at > now())),
    'elopement_risk', COALESCE((SELECT r.elopement_risk FROM public.residents r WHERE r.id = v_resident_id), false),
    'prior_unexplained_bruise_30d', v_resident_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM public.care_events ce
        WHERE ce.resident_id = v_resident_id
          AND ce.category = 'unexplained_bruise'
          AND ce.deleted_at IS NULL
          AND ce.occurred_at >= v_occurred_at - interval '30 days'
          AND ce.client_event_id <> v_client_event_id)
      OR EXISTS (
        SELECT 1 FROM public.incidents i
        WHERE i.resident_id = v_resident_id
          AND i.category = 'unexplained_bruise'
          AND i.deleted_at IS NULL
          AND i.occurred_at >= v_occurred_at - interval '30 days')),
    'location_label', v_location_label,
    'time_label', v_time_label
  );

  v_derived := public.care_event_derive(v_kind, v_answers, v_context);
  v_level := (v_derived ->> 'level')::integer;
  v_derived_level := (v_derived ->> 'derived_level')::integer;
  v_final_level := ('level_' || v_level)::incident_severity;
  v_derived_sev := ('level_' || v_derived_level)::incident_severity;
  v_category := (v_derived ->> 'category')::incident_category;
  v_flags := v_derived -> 'flags';
  v_sentence := v_derived ->> 'sentence';

  INSERT INTO public.care_events (
    organization_id, facility_id, resident_id, client_event_id, kind, answers,
    derived_level, final_level, level_bumped_by_reporter, category, flags, sentence, note,
    occurred_at, discovered_at, shift, location_code, reported_by, captured_offline
  ) VALUES (
    v_org, v_facility_id, v_resident_id, v_client_event_id, v_kind, v_answers,
    v_derived_sev, v_final_level, v_worried, v_category, v_flags, v_sentence, v_note,
    v_occurred_at, now(), v_shift, v_location_code, v_uid, v_captured_offline
  )
  RETURNING id INTO v_care_event_id;

  v_hurt := v_answers ->> 'hurt';
  v_what := v_answers ->> 'what';
  v_touched := v_answers ->> 'touched';
  v_where := v_answers ->> 'where';

  -- ---- behavioral_logs ----------------------------------------------------
  IF v_kind = 'behavior' THEN
    INSERT INTO public.behavioral_logs (
      resident_id, facility_id, organization_id, occurred_at, shift, logged_by,
      behavior, behavior_type, injury_occurred, involved_staff, notes
    ) VALUES (
      v_resident_id, v_facility_id, v_org, v_occurred_at, v_shift, v_uid,
      v_sentence, COALESCE(v_what, 'other'),
      v_touched IS NOT NULL AND v_touched <> 'no_one',
      CASE WHEN v_touched = 'staff' THEN '{}'::uuid[] ELSE NULL END,
      v_note
    )
    RETURNING id INTO v_behavioral_log_id;
    UPDATE public.care_events SET behavioral_log_id = v_behavioral_log_id WHERE id = v_care_event_id;
  END IF;

  -- ---- condition_changes (BEFORE INSERT trigger raises the care plan alert)
  IF v_kind = 'condition_change' THEN
    SELECT x INTO v_first_sign
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_answers -> 'signs') = 'array' THEN v_answers -> 'signs' ELSE '[]'::jsonb END) AS t(x)
    LIMIT 1;
    INSERT INTO public.condition_changes (
      resident_id, facility_id, organization_id, reported_at, reported_by, shift,
      change_type, description, severity
    ) VALUES (
      v_resident_id, v_facility_id, v_org, v_occurred_at, v_uid, v_shift,
      COALESCE(v_first_sign, 'not_themselves'), v_sentence,
      CASE WHEN v_level >= 4 THEN 'severe' WHEN v_level = 3 THEN 'moderate' ELSE 'mild' END
    )
    RETURNING id INTO v_condition_change_id;
    UPDATE public.care_events SET condition_change_id = v_condition_change_id WHERE id = v_care_event_id;
  END IF;

  -- ---- incidents for Level 2 and above --------------------------------------
  IF v_level >= 2 THEN
    v_incident_number := public.allocate_incident_number(v_facility_id);

    v_immediate_actions := CASE
      WHEN v_kind = 'fall' AND v_answers ->> 'going_out' = 'yes' THEN 'Emergency care requested.'
      WHEN v_kind = 'fall' AND v_hurt = 'badly' THEN 'Emergency care requested.'
      WHEN v_kind = 'fall' AND v_hurt = 'a_little' THEN 'First aid given.'
      WHEN v_kind = 'medication' AND v_answers ->> 'reaction' = 'yes' THEN 'Administrator alerted for medical follow-up.'
      WHEN v_kind = 'wandering' AND v_where = 'not_found' THEN 'Search started and Administrator alerted.'
      ELSE 'Resident checked and made safe. Administrator alerted.'
    END;

    v_injury_occurred := CASE
      WHEN v_kind = 'fall' THEN v_hurt IS NOT NULL AND v_hurt <> 'not_hurt'
      WHEN v_kind = 'injury_found' THEN true
      WHEN v_kind = 'wandering' THEN COALESCE(v_hurt = 'yes', false)
      WHEN v_kind = 'behavior' THEN v_touched IS NOT NULL AND v_touched <> 'no_one'
      ELSE false
    END;

    v_injury_severity := CASE
      WHEN v_kind = 'fall' AND v_hurt = 'a_little' THEN 'minor'
      WHEN v_kind = 'fall' AND v_hurt = 'badly' THEN 'major'
      WHEN v_kind = 'injury_found' AND v_answers ->> 'care' = 'first_aid_enough' THEN 'minor'
      WHEN v_kind = 'injury_found' AND v_answers ->> 'care' = 'more_than_first_aid' THEN 'major'
      ELSE NULL
    END;

    IF v_kind = 'injury_found' AND jsonb_typeof(v_answers -> 'seen') = 'array' THEN
      SELECT string_agg(CASE x
        WHEN 'bruise' THEN 'bruise'
        WHEN 'skin_tear' THEN 'skin tear or cut'
        WHEN 'burn' THEN 'burn'
        WHEN 'swelling_pain' THEN 'swelling or pain'
        WHEN 'other' THEN 'other' END, ', ' ORDER BY ord)
        INTO v_seen_labels
      FROM jsonb_array_elements_text(v_answers -> 'seen') WITH ORDINALITY AS t(x, ord)
      WHERE x IN ('bruise','skin_tear','burn','swelling_pain','other');
      v_injury_description := v_seen_labels;
    END IF;

    INSERT INTO public.incidents (
      resident_id, facility_id, organization_id, incident_number, category, severity, status,
      occurred_at, discovered_at, shift, location_description, location_type,
      description, immediate_actions,
      fall_witnessed, injury_occurred, injury_severity, injury_description,
      elopement_last_seen_at, elopement_found_at, elopement_found_location, elopement_outcome,
      reported_by, created_by, ahca_reportable, insurance_reportable, regulatory_flags
    ) VALUES (
      v_resident_id, v_facility_id, v_org, v_incident_number, v_category, v_final_level, 'open',
      v_occurred_at, now(), v_shift, COALESCE(v_location_label, 'Not specified'), v_location_code,
      v_sentence || CASE WHEN v_note IS NOT NULL THEN E'\n\nStaff note: ' || v_note ELSE '' END,
      v_immediate_actions,
      CASE WHEN v_kind = 'fall' THEN CASE v_answers ->> 'witnessed' WHEN 'yes' THEN true WHEN 'no' THEN false ELSE NULL END ELSE NULL END,
      v_injury_occurred, v_injury_severity, v_injury_description,
      CASE WHEN v_kind = 'wandering' THEN v_occurred_at ELSE NULL END,
      CASE WHEN v_kind = 'wandering' AND v_where IN ('found_inside','found_grounds','found_off_property') THEN now() ELSE NULL END,
      CASE WHEN v_kind = 'wandering' THEN CASE v_where
        WHEN 'found_inside' THEN 'Inside'
        WHEN 'found_grounds' THEN 'Outside on the grounds'
        WHEN 'found_off_property' THEN 'Off the property'
        ELSE NULL END ELSE NULL END,
      CASE WHEN v_kind = 'wandering' THEN v_where ELSE NULL END,
      v_uid, v_uid,
      COALESCE((v_flags ->> 'ahca_reportable')::boolean, false),
      COALESCE((v_flags ->> 'insurance_reportable')::boolean, false),
      v_flags
    )
    RETURNING id INTO v_incident_id;

    UPDATE public.care_events SET incident_id = v_incident_id WHERE id = v_care_event_id;
    IF v_condition_change_id IS NOT NULL THEN
      UPDATE public.condition_changes SET linked_incident_id = v_incident_id WHERE id = v_condition_change_id;
    END IF;

    -- ---- incident_followups from incident_followup_protocols ---------------
    FOR v_proto IN
      SELECT p.*
      FROM public.incident_followup_protocols p
      WHERE p.is_active
        AND p.deleted_at IS NULL
        AND p.organization_id = v_org
        AND (p.facility_id = v_facility_id OR p.facility_id IS NULL)
        AND (p.kind = v_kind OR p.kind = 'any')
        AND p.min_level <= v_final_level
        AND (p.requires_flag IS NULL OR v_flags ->> p.requires_flag = 'true')
        AND NOT (
          p.facility_id IS NULL
          AND EXISTS (
            SELECT 1 FROM public.incident_followup_protocols q
            WHERE q.is_active AND q.deleted_at IS NULL
              AND q.organization_id = v_org
              AND q.facility_id = v_facility_id
              AND q.task_type = p.task_type
              AND (q.kind = v_kind OR q.kind = 'any')
              AND q.min_level <= v_final_level
              AND (q.requires_flag IS NULL OR v_flags ->> q.requires_flag = 'true')))
      ORDER BY p.due_offset_minutes, p.task_type
    LOOP
      v_assignee := CASE v_proto.assign_to_role
        WHEN 'reporter' THEN v_uid
        WHEN 'caregiver' THEN v_uid
        ELSE NULL END;

      -- Section 3 of the paper form. One task per staff member on that shift at
      -- that facility, never the reporter: the reporter already gave the account
      -- the event is built from, and a witness statement asking them whether they
      -- saw what they just reported is noise on the floor and a false corroboration
      -- on the printed form. The whole rule lives in care_event_sync_witness_tasks
      -- so the administrator's add and remove path creates identical rows (COL-354).
      IF v_proto.task_type = 'witness_statement' THEN
        PERFORM public.care_event_sync_witness_tasks(v_care_event_id);
        CONTINUE;
      END IF;

      IF v_proto.repeat_every_minutes IS NOT NULL AND v_proto.repeat_every_minutes > 0 THEN
        v_offset := v_proto.due_offset_minutes;
        WHILE v_offset <= COALESCE(v_proto.repeat_until_minutes, v_proto.due_offset_minutes) LOOP
          INSERT INTO public.incident_followups (
            incident_id, resident_id, facility_id, organization_id, task_type, description, due_at, assigned_to
          ) VALUES (
            v_incident_id, v_resident_id, v_facility_id, v_org, v_proto.task_type, v_proto.description,
            v_occurred_at + make_interval(mins => v_offset), v_assignee
          );
          v_offset := v_offset + v_proto.repeat_every_minutes;
        END LOOP;
      ELSE
        INSERT INTO public.incident_followups (
          incident_id, resident_id, facility_id, organization_id, task_type, description, due_at, assigned_to
        ) VALUES (
          v_incident_id, v_resident_id, v_facility_id, v_org, v_proto.task_type, v_proto.description,
          v_occurred_at + make_interval(mins => v_proto.due_offset_minutes), v_assignee
        );
      END IF;
    END LOOP;

    -- ---- regulatory_reporting_obligations when the flags say AHCA ----------
    IF COALESCE((v_flags ->> 'ahca_reportable')::boolean, false) THEN
      PERFORM public.care_event_create_ahca_obligations(v_incident_id, v_facility_id, v_org, v_occurred_at, v_tz);
    END IF;

    -- ---- exec_alerts row for the in-app feed (no resident name; entity_id is the legal entity)
    v_level_word := CASE v_level WHEN 2 THEN 'Heads-up' WHEN 3 THEN 'Urgent' ELSE 'Emergency' END;
    v_tile_word := CASE v_kind
      WHEN 'fall' THEN 'Fall'
      WHEN 'injury_found' THEN 'Hurt'
      WHEN 'condition_change' THEN 'Sick or not themselves'
      WHEN 'behavior' THEN 'Upset or behavior'
      WHEN 'wandering' THEN 'Wandering or left'
      WHEN 'medication' THEN 'Medicine'
      WHEN 'family_complaint' THEN 'Family or complaint'
      ELSE 'Building or other' END;
    INSERT INTO public.exec_alerts (
      organization_id, source_module, severity, title, body, entity_id, facility_id,
      deep_link_path, category, status
    ) VALUES (
      v_org, 'incidents',
      (CASE v_level WHEN 2 THEN 'info' WHEN 3 THEN 'warning' ELSE 'critical' END)::exec_alert_severity,
      v_level_word || ' ' || v_tile_word, v_incident_number,
      (SELECT f.entity_id FROM public.facilities f WHERE f.id = v_facility_id), v_facility_id,
      '/admin/care-events/' || v_care_event_id::text, 'care_event', 'open'
    );

    -- ---- deliveries: step rows whose after_minutes = 0 ----------------------
    FOR v_policy IN
      SELECT * FROM public.care_event_applicable_policies(v_org, v_facility_id, v_final_level)
      WHERE after_minutes = 0
      ORDER BY step
    LOOP
      PERFORM public.care_event_expand_targets(v_care_event_id, v_policy.id);
    END LOOP;
  END IF;

  RETURN public.care_event_receipt(v_care_event_id, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_care_event(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_care_event(jsonb) TO authenticated;

COMMENT ON FUNCTION public.submit_care_event(jsonb) IS
  'Writes one care event and fans out into incidents, behavioral_logs, condition_changes, incident_followups, regulatory_reporting_obligations, exec_alerts and care_event_deliveries in one transaction. Idempotent on (organization_id, client_event_id). Witness statement tasks are created by care_event_sync_witness_tasks, which excludes the reporter. COL-37 ruling: definer required -- the caller (a caregiver) has no INSERT policy on exec_alerts, regulatory_reporting_obligations or care_event_deliveries, and the level must be derived server-side from the same statement that writes it. The body checks auth.uid(), haven.app_role(), the organization and haven.accessible_facility_ids() before writing, and reported_by is always auth.uid().';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback: DROP VIEW public.v_care_event_attachments; DROP FUNCTION
-- public.care_event_print_record(text,uuid,uuid,date,date),
-- public.attach_care_event_file(uuid,text,text,text),
-- public.care_event_remove_witness(uuid,text), public.care_event_add_witness(uuid,uuid),
-- public.complete_incident_followup(uuid,text,text),
-- public.care_event_sync_witness_tasks(uuid); restore submit_care_event and the
-- clinical_staff_manage_incident_followups policy from their 402 and 022 bodies;
-- ALTER TABLE public.incident_photos DROP COLUMN kind; ALTER TABLE
-- public.incident_followups DROP COLUMN witness_choice; reset the bucket's
-- file_size_limit to 15728640 and its MIME list to the five image types.
-- Witness statements and attachments already given are records: keep the rows.
