-- Smart Rounding: chip capture and the composed narrative.
-- Spec: docs/specs/25A-smart-rounding-cadence-and-watchlist.md section 3.
--
-- An observation is recorded by tapping chips. The chips assemble a readable
-- sentence at write time and the sentence is stored, not derived on read, so a
-- later vocabulary edit cannot rewrite what a caregiver recorded. The free text
-- note appends to the sentence and is never required.
--
-- The chip codes are stored alongside the sentence in their own queryable
-- column. The Watchlist reads refused medications, agitation, confusion and
-- meal refusals out of the observation record; if the only trace of a chip were
-- the sentence, those signals would be string matching against operator prose.
--
-- A refused medication chip records an observation and nothing else. It does
-- not read, write or reconcile against a medication order, a MAR row or any
-- external medication system. That is a decision, not a gap.
--
-- Rounding evidence is immutable once written (tr_rounding_logs_immutable from
-- migration 331), so the sentence and the chip codes are written on the insert
-- that creates the log row. public.submit_observation validates and composes,
-- then hands the write to the existing locked completion command so replay
-- receipts, integrity flags, assignment authority and the on-time rule all
-- continue to apply to a chip observation exactly as they do today.

BEGIN;

-- ---------------------------------------------------------------------------
-- Vocabulary: three new chip groups.
--
-- The CHECK is a column level constraint from migration 219, which PostgreSQL
-- named observation_vocab_field_name_check. It is dropped and recreated with
-- the existing five field names plus the three new ones. The list is extended,
-- never replaced.
-- ---------------------------------------------------------------------------
ALTER TABLE public.observation_vocab
  DROP CONSTRAINT IF EXISTS observation_vocab_field_name_check;

ALTER TABLE public.observation_vocab
  ADD CONSTRAINT observation_vocab_field_name_check
  CHECK (field_name IN ('location', 'state', 'activity', 'position', 'intervention', 'meal_intake', 'mood_state', 'med_response'));

-- Seeded org-wide (facility_id IS NULL) so every facility inherits them, using
-- the insert-then-update pattern from 219 so a replay is idempotent and a
-- hand edit to a label is restored to the seeded value.
WITH chip_seed AS (
  SELECT
    '00000000-0000-0000-0000-000000000001'::uuid AS organization_id,
    NULL::uuid AS facility_id,
    v.field_name,
    v.value_code,
    v.display_label,
    v.display_order
  FROM (
    VALUES
      -- What the resident ate this window.
      ('meal_intake', 'ate_well', 'Ate well', 1),
      ('meal_intake', 'ate_some', 'Ate some', 2),
      ('meal_intake', 'refused_meal', 'Refused meal', 3),
      ('meal_intake', 'ate_in_room', 'Ate in room', 4),
      ('meal_intake', 'no_meal_this_window', 'No meal this window', 5),
      -- How the resident presented.
      ('mood_state', 'pleasant', 'Pleasant', 1),
      ('mood_state', 'quiet', 'Quiet', 2),
      ('mood_state', 'grouchy', 'Grouchy', 3),
      ('mood_state', 'agitated', 'Agitated', 4),
      ('mood_state', 'confused', 'Confused', 5),
      ('mood_state', 'tearful', 'Tearful', 6),
      -- Whether the resident took what was offered. Observation only.
      ('med_response', 'took_meds', 'Took meds', 1),
      ('med_response', 'refused_meds', 'Refused meds', 2),
      ('med_response', 'no_meds_this_window', 'No meds this window', 3)
  ) AS v (field_name, value_code, display_label, display_order)
)
INSERT INTO public.observation_vocab (organization_id, facility_id, field_name, value_code, display_label, display_order, is_oof)
SELECT
  s.organization_id,
  s.facility_id,
  s.field_name,
  s.value_code,
  s.display_label,
  s.display_order,
  FALSE
FROM
  chip_seed s
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      public.observation_vocab existing
    WHERE
      existing.organization_id = s.organization_id
      AND existing.facility_id IS NOT DISTINCT FROM s.facility_id
      AND existing.field_name = s.field_name
      AND existing.value_code = s.value_code);

WITH chip_seed AS (
  SELECT
    '00000000-0000-0000-0000-000000000001'::uuid AS organization_id,
    NULL::uuid AS facility_id,
    v.field_name,
    v.value_code,
    v.display_label,
    v.display_order
  FROM (
    VALUES
      ('meal_intake', 'ate_well', 'Ate well', 1),
      ('meal_intake', 'ate_some', 'Ate some', 2),
      ('meal_intake', 'refused_meal', 'Refused meal', 3),
      ('meal_intake', 'ate_in_room', 'Ate in room', 4),
      ('meal_intake', 'no_meal_this_window', 'No meal this window', 5),
      ('mood_state', 'pleasant', 'Pleasant', 1),
      ('mood_state', 'quiet', 'Quiet', 2),
      ('mood_state', 'grouchy', 'Grouchy', 3),
      ('mood_state', 'agitated', 'Agitated', 4),
      ('mood_state', 'confused', 'Confused', 5),
      ('mood_state', 'tearful', 'Tearful', 6),
      ('med_response', 'took_meds', 'Took meds', 1),
      ('med_response', 'refused_meds', 'Refused meds', 2),
      ('med_response', 'no_meds_this_window', 'No meds this window', 3)
  ) AS v (field_name, value_code, display_label, display_order)
)
UPDATE
  public.observation_vocab existing
SET
  display_label = s.display_label,
  display_order = s.display_order,
  is_oof = FALSE,
  active = TRUE,
  deleted_at = NULL,
  updated_at = now()
FROM
  chip_seed s
WHERE
  existing.organization_id = s.organization_id
  AND existing.facility_id IS NOT DISTINCT FROM s.facility_id
  AND existing.field_name = s.field_name
  AND existing.value_code = s.value_code;

-- ---------------------------------------------------------------------------
-- The log row carries both the sentence and the codes that composed it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.resident_observation_logs
  ADD COLUMN IF NOT EXISTS composed_summary text NULL,
  ADD COLUMN IF NOT EXISTS chip_selections jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.resident_observation_logs
  DROP CONSTRAINT IF EXISTS resident_observation_logs_chip_selections_shape;

ALTER TABLE public.resident_observation_logs
  ADD CONSTRAINT resident_observation_logs_chip_selections_shape
  CHECK (jsonb_typeof(chip_selections) = 'object');

COMMENT ON COLUMN public.resident_observation_logs.composed_summary IS
  'The observation sentence as it read when the check was recorded. Composed at write time from the display labels in force at that moment and stored, never derived on read, so editing the vocabulary later cannot rewrite what a caregiver said about a resident.';

COMMENT ON COLUMN public.resident_observation_logs.chip_selections IS
  'Chip codes that composed the sentence, as an object keyed by observation_vocab.field_name to an array of value_code. Example: {"meal_intake": ["refused_meal"], "mood_state": ["agitated"], "med_response": ["refused_meds"]}. Groups with no selection are absent rather than present and empty. Queried with the containment operator through idx_obs_logs_chip_selections so signal reads never string match the sentence.';

CREATE INDEX IF NOT EXISTS idx_obs_logs_chip_selections ON public.resident_observation_logs USING gin (chip_selections jsonb_path_ops)
WHERE
  deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Composition. One place composes the sentence: the backfill below, the write
-- path, and the caregiver preview in the browser all follow this order.
--
-- Clause order, each clause comma joined and closed with a period:
--   1. chips, group order meal_intake then mood_state then med_response,
--      each group in vocabulary display order
--   2. the quick status, then how the resident presented
--   3. where the resident was, then the position
--   4. interventions performed
-- Only the first chip keeps its capital; the rest of clause 1 reads as prose.
-- Empty clauses are omitted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.observation_quick_status_label (p_quick_status text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = ''
  AS $func$
  SELECT
    CASE p_quick_status
    WHEN 'awake' THEN
      'Awake'
    WHEN 'asleep' THEN
      'Asleep'
    WHEN 'calm' THEN
      'Calm'
    WHEN 'agitated' THEN
      'Agitated'
    WHEN 'confused' THEN
      'Confused'
    WHEN 'distressed' THEN
      'Distressed'
    WHEN 'not_found' THEN
      'Not found'
    WHEN 'refused' THEN
      'Declined the check'
    ELSE
      NULL
    END;
$func$;

COMMENT ON FUNCTION haven.observation_quick_status_label (text) IS
  'Operator wording for a quick status. The stored value never reaches a surface; this is the only place it is turned into words.';

CREATE OR REPLACE FUNCTION haven.observation_vocab_label (p_organization_id uuid, p_facility_id uuid, p_field_name text, p_value text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = ''
  AS $func$
  SELECT
    COALESCE((
      SELECT
        vocab.display_label
      FROM public.observation_vocab AS vocab
      WHERE
        vocab.organization_id = p_organization_id
        AND (vocab.facility_id IS NULL OR vocab.facility_id = p_facility_id)
        AND vocab.field_name = p_field_name
        AND (vocab.value_code = p_value OR vocab.display_label = p_value)
        AND vocab.deleted_at IS NULL
      ORDER BY
        (vocab.facility_id IS NOT NULL) DESC,
        (vocab.value_code = p_value) DESC,
        vocab.display_order
      LIMIT 1), NULLIF(btrim(p_value), ''));
$func$;

COMMENT ON FUNCTION haven.observation_vocab_label (uuid, uuid, text, text) IS
  'Resolves a stored observation value to its operator label, preferring a facility row over the org-wide one. Accepts either a value_code or a display_label because the capture surface stored labels before this migration, and falls back to the stored text so an archived value still reads as something.';

CREATE OR REPLACE FUNCTION haven.compose_observation_summary (p_organization_id uuid, p_facility_id uuid, p_chip_selections jsonb, p_quick_status text, p_resident_state text, p_resident_location text, p_resident_position text, p_intervention_codes text[])
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = ''
  AS $func$
DECLARE
  v_groups CONSTANT text[] := ARRAY['meal_intake', 'mood_state', 'med_response'];
  v_group text;
  v_label text;
  v_code text;
  v_segments text[];
  v_clauses text[] := ARRAY[]::text[];
  v_first boolean := TRUE;
BEGIN
  -- Clause 1: the chips.
  v_segments := ARRAY[]::text[];
  FOREACH v_group IN ARRAY v_groups LOOP
    FOR v_label IN
    SELECT
      resolved.display_label
    FROM (
      SELECT DISTINCT ON (selected.code)
        vocab.display_label,
        vocab.display_order
      FROM jsonb_array_elements_text(COALESCE(p_chip_selections -> v_group, '[]'::jsonb)) AS selected (code)
      JOIN public.observation_vocab AS vocab ON vocab.organization_id = p_organization_id
        AND (vocab.facility_id IS NULL OR vocab.facility_id = p_facility_id)
        AND vocab.field_name = v_group
        AND vocab.value_code = selected.code
        AND vocab.deleted_at IS NULL
      ORDER BY
        selected.code,
        (vocab.facility_id IS NOT NULL) DESC) AS resolved
    ORDER BY
      resolved.display_order,
      resolved.display_label LOOP
        IF v_first THEN
          v_segments := v_segments || v_label;
          v_first := FALSE;
        ELSE
          v_segments := v_segments || (lower(left(v_label, 1)) || substr(v_label, 2));
        END IF;
      END LOOP;
  END LOOP;
  IF array_length(v_segments, 1) IS NOT NULL THEN
    v_clauses := v_clauses || (array_to_string(v_segments, ', ') || '.');
  END IF;

  -- Clause 2: status and presentation.
  v_segments := ARRAY[]::text[];
  v_label := haven.observation_quick_status_label(p_quick_status);
  IF v_label IS NOT NULL THEN
    v_segments := v_segments || v_label;
  END IF;
  v_label := haven.observation_vocab_label(p_organization_id, p_facility_id, 'state', p_resident_state);
  IF v_label IS NOT NULL THEN
    v_segments := v_segments || v_label;
  END IF;
  IF array_length(v_segments, 1) IS NOT NULL THEN
    v_clauses := v_clauses || (array_to_string(v_segments, ', ') || '.');
  END IF;

  -- Clause 3: where, and how the resident was positioned.
  v_segments := ARRAY[]::text[];
  v_label := haven.observation_vocab_label(p_organization_id, p_facility_id, 'location', p_resident_location);
  IF v_label IS NOT NULL THEN
    -- Free text locations recorded before this migration sometimes already
    -- start with the preposition, so strip it rather than say "In in room".
    v_segments := v_segments || ('In ' || regexp_replace(v_label, '^[Ii]n +', ''));
  END IF;
  v_label := haven.observation_vocab_label(p_organization_id, p_facility_id, 'position', p_resident_position);
  IF v_label IS NOT NULL THEN
    v_segments := v_segments || v_label;
  END IF;
  IF array_length(v_segments, 1) IS NOT NULL THEN
    v_clauses := v_clauses || (array_to_string(v_segments, ', ') || '.');
  END IF;

  -- Clause 4: what the caregiver did while there.
  v_segments := ARRAY[]::text[];
  IF p_intervention_codes IS NOT NULL THEN
    FOREACH v_code IN ARRAY p_intervention_codes LOOP
      v_label := haven.observation_vocab_label(p_organization_id, p_facility_id, 'intervention', v_code);
      IF v_label IS NOT NULL THEN
        v_segments := v_segments || v_label;
      END IF;
    END LOOP;
  END IF;
  IF array_length(v_segments, 1) IS NOT NULL THEN
    v_clauses := v_clauses || (array_to_string(v_segments, ', ') || '.');
  END IF;

  IF array_length(v_clauses, 1) IS NULL THEN
    RETURN 'Check recorded with no details captured.';
  END IF;
  RETURN array_to_string(v_clauses, ' ');
END;
$func$;

COMMENT ON FUNCTION haven.compose_observation_summary (uuid, uuid, jsonb, text, text, text, text, text[]) IS
  'Composes the stored observation sentence. Called once, on the insert that creates the log row. Never called on read: the sentence a surveyor or a family member reads is the one that was true when the check happened.';

-- ---------------------------------------------------------------------------
-- Every log row gets a sentence, whatever wrote it. The column cannot be added
-- NOT NULL in one step against existing rows, so it arrives nullable, existing
-- rows are composed from what they already hold, and the constraint follows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.haven_compose_observation_summary ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = ''
  AS $func$
BEGIN
  IF NULLIF(btrim(NEW.composed_summary), '') IS NULL THEN
    NEW.composed_summary := haven.compose_observation_summary(NEW.organization_id, NEW.facility_id, COALESCE(NEW.chip_selections, '{}'::jsonb), NEW.quick_status::text, NEW.resident_state, NEW.resident_location, NEW.resident_position, NEW.intervention_codes);
  END IF;
  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION public.haven_compose_observation_summary () IS
  'Insert-time safety net for composed_summary. A writer that supplies its own sentence keeps it; a writer that does not gets one composed from the row, so the column is never null and never blank regardless of which command created the log.';

DROP TRIGGER IF EXISTS tr_resident_observation_logs_compose_summary ON public.resident_observation_logs;

CREATE TRIGGER tr_resident_observation_logs_compose_summary
  BEFORE INSERT ON public.resident_observation_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_compose_observation_summary ();

-- Migration 331 made rounding evidence immutable through a BEFORE UPDATE
-- trigger that refuses every update from every role. Adding a column to the
-- evidence is a schema change rather than a clinical correction, so the guard
-- is lifted for exactly this statement and restored before the transaction
-- ends. The audit trigger stays on: the backfill is recorded like any other
-- write to a clinical table.
ALTER TABLE public.resident_observation_logs DISABLE TRIGGER tr_rounding_logs_immutable;

UPDATE
  public.resident_observation_logs AS log
SET
  composed_summary = haven.compose_observation_summary(log.organization_id, log.facility_id, '{}'::jsonb, log.quick_status::text, log.resident_state, log.resident_location, log.resident_position, log.intervention_codes)
WHERE
  NULLIF(btrim(log.composed_summary), '') IS NULL;

ALTER TABLE public.resident_observation_logs ENABLE TRIGGER tr_rounding_logs_immutable;

ALTER TABLE public.resident_observation_logs
  ALTER COLUMN composed_summary SET NOT NULL;

ALTER TABLE public.resident_observation_logs
  DROP CONSTRAINT IF EXISTS resident_observation_logs_composed_summary_present;

ALTER TABLE public.resident_observation_logs
  ADD CONSTRAINT resident_observation_logs_composed_summary_present
  CHECK (btrim(composed_summary) <> '');

-- ---------------------------------------------------------------------------
-- The locked completion command carries the sentence and the chips.
--
-- Both functions below are the approved bodies from migrations 326 and 333,
-- replayed unchanged except for two additions each: the log writer inserts
-- composed_summary and chip_selections, and the reviewed command whitelists
-- them into the payload it hands down. Nothing about actor authority, replay
-- receipts, integrity flags, or the on-time rule is touched. A chip
-- observation is completed by exactly the command that completes every other
-- observation, and the task still moves to completed_on_time when the
-- observation time is at or before the task's own grace_ends_at.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.complete_rounding_task_core(
  p_task_id uuid,p_actor_id uuid,p_actor_role text,p_session_id uuid,p_claim_version integer,
  p_organization_id uuid,p_facility_id uuid,p_actual_staff_id uuid,p_payload jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_task public.resident_observation_tasks%ROWTYPE;
  v_actor jsonb;
  v_role text;
  v_staff_id uuid;
  v_has_active_assignment boolean;
  v_is_active_assignee boolean;
  v_log_id uuid;
  v_status public.resident_observation_task_status;
BEGIN
  SELECT * INTO STRICT v_task FROM public.resident_observation_tasks
  WHERE id=p_task_id AND organization_id=p_organization_id AND facility_id=p_facility_id AND deleted_at IS NULL
  FOR UPDATE;
  v_actor:=haven.assert_rounding_service_actor(p_actor_id,p_actor_role,p_session_id,p_claim_version,
    p_organization_id,p_facility_id,false,true);
  v_role:=v_actor->>'role';
  v_staff_id:=(v_actor->>'staff_id')::uuid;
  IF v_staff_id IS DISTINCT FROM p_actual_staff_id THEN
    RAISE EXCEPTION 'Rounding actor staff identity changed' USING ERRCODE='42501';
  END IF;

  PERFORM 1 FROM public.resident_observation_assignments AS assignment
  WHERE assignment.task_id=v_task.id AND assignment.organization_id=p_organization_id
    AND assignment.facility_id=p_facility_id AND assignment.released_at IS NULL
  ORDER BY assignment.id FOR SHARE;
  SELECT EXISTS(SELECT 1 FROM public.resident_observation_assignments AS assignment
      WHERE assignment.task_id=v_task.id AND assignment.organization_id=p_organization_id
        AND assignment.facility_id=p_facility_id AND assignment.released_at IS NULL),
    EXISTS(SELECT 1 FROM public.resident_observation_assignments AS assignment
      WHERE assignment.task_id=v_task.id AND assignment.organization_id=p_organization_id
        AND assignment.facility_id=p_facility_id AND assignment.released_at IS NULL
        AND assignment.staff_id=v_staff_id)
  INTO v_has_active_assignment,v_is_active_assignee;

  -- Assignee guard, unchanged from the approved 327 body. `IS NOT TRUE` rather
  -- than `NOT (...)` is deliberate: an unassigned task compares NULL, and NULL
  -- must refuse rather than pass. supabase/tests/review_authoritative_actor.sql
  -- asserts a caregiver cannot complete a task whose assigned_staff_id is null
  -- and whose assignment rows are all released. That tested invariant outranks
  -- the spec's facility pool wording; see the build notes, decision D12.
  IF v_role NOT IN('owner','org_admin','facility_admin','nurse')
     AND (CASE WHEN v_has_active_assignment THEN v_is_active_assignee ELSE v_task.assigned_staff_id=v_staff_id END) IS NOT TRUE THEN
    RAISE EXCEPTION 'Rounding task assignee changed' USING ERRCODE='42501';
  END IF;
  IF v_task.status IN('completed_on_time','completed_late','excused') THEN
    RAISE EXCEPTION 'Observation task is no longer completable' USING ERRCODE='P0001';
  END IF;
  v_status:=(p_payload->>'completion_status')::public.resident_observation_task_status;
  IF v_status NOT IN('completed_on_time','completed_late') THEN
    RAISE EXCEPTION 'Invalid completion status' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.resident_observation_logs(
    organization_id,entity_id,facility_id,resident_id,task_id,assigned_staff_id,staff_id,
    observed_at,entered_at,entry_mode,quick_status,resident_location,resident_position,resident_state,
    distress_present,breathing_concern,pain_concern,toileting_assisted,hydration_offered,repositioned,
    skin_concern_observed,fall_hazard_observed,refused_assistance,intervention_codes,exception_present,
    note,late_reason,composed_summary,chip_selections,created_by
  ) VALUES(
    v_task.organization_id,v_task.entity_id,v_task.facility_id,v_task.resident_id,v_task.id,
    v_task.assigned_staff_id,v_staff_id,(p_payload->>'observed_at')::timestamptz,
    (p_payload->>'entered_at')::timestamptz,(p_payload->>'entry_mode')::public.resident_observation_entry_mode,
    (p_payload->>'quick_status')::public.resident_observation_quick_status,p_payload->>'resident_location',
    p_payload->>'resident_position',p_payload->>'resident_state',
    coalesce((p_payload->>'distress_present')::boolean,false),coalesce((p_payload->>'breathing_concern')::boolean,false),
    coalesce((p_payload->>'pain_concern')::boolean,false),coalesce((p_payload->>'toileting_assisted')::boolean,false),
    coalesce((p_payload->>'hydration_offered')::boolean,false),coalesce((p_payload->>'repositioned')::boolean,false),
    coalesce((p_payload->>'skin_concern_observed')::boolean,false),coalesce((p_payload->>'fall_hazard_observed')::boolean,false),
    coalesce((p_payload->>'refused_assistance')::boolean,false),ARRAY(SELECT pg_catalog.jsonb_array_elements_text(
      coalesce(p_payload->'intervention_codes','[]'::jsonb))),coalesce((p_payload->>'exception_present')::boolean,false),
    p_payload->>'note',p_payload->>'late_reason',
    nullif(btrim(p_payload->>'composed_summary'),''),coalesce(p_payload->'chip_selections','{}'::jsonb),p_actor_id
  ) RETURNING id INTO v_log_id;

  IF nullif(p_payload->>'exception_type','') IS NOT NULL THEN
    INSERT INTO public.resident_observation_exceptions(
      organization_id,entity_id,facility_id,resident_id,log_id,exception_type,severity,requires_follow_up,follow_up_status
    ) VALUES(v_task.organization_id,v_task.entity_id,v_task.facility_id,v_task.resident_id,v_log_id,
      (p_payload->>'exception_type')::public.resident_observation_exception_type,
      coalesce(nullif(p_payload->>'exception_severity',''),'medium')::public.resident_observation_severity,true,'open');
  END IF;

  UPDATE public.resident_observation_tasks SET status=v_status,completed_log_id=v_log_id,updated_by=p_actor_id
  WHERE id=v_task.id;
  RETURN pg_catalog.jsonb_build_object('log_id',v_log_id,'status',v_status::text);
END $function$;
REVOKE ALL ON FUNCTION haven.complete_rounding_task_core(uuid,uuid,text,uuid,integer,uuid,uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.complete_rounding_task_review(
 p_task_id uuid,p_actor_id uuid,p_actor_role text,p_session_id uuid,p_claim_version integer,
 p_organization_id uuid,p_facility_id uuid,p_actual_staff_id uuid,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_request uuid:=(p_payload->>'request_id')::uuid;
 v_task public.resident_observation_tasks%ROWTYPE;
 v_receipt public.rounding_completion_receipts%ROWTYPE;
 v_actor jsonb; v_staff uuid; v_role text; v_has_assignment boolean; v_is_assignee boolean;
 v_payload jsonb; v_result jsonb; v_log uuid; v_observed timestamptz; v_entered timestamptz;
 v_mode text; v_status text; v_exception text; v_delay integer; v_severity text; v_flag text;
 v_late boolean:=false; v_pattern boolean:=false; v_minute integer; v_recent integer; v_residents integer;
BEGIN
 IF v_request IS NULL OR p_payload->>'observed_at' IS NULL THEN
  RAISE EXCEPTION 'A request identity and observation time are required' USING ERRCODE='22023';
 END IF;
 -- Same key is serialized even across distinct tasks/actors, then task and
 -- staff/facility locks serialize completion and pattern threshold detection.
 PERFORM pg_advisory_xact_lock(hashtextextended('rounding-request:'||v_request::text,0));
 SELECT * INTO v_task FROM public.resident_observation_tasks
 WHERE id=p_task_id AND organization_id=p_organization_id AND facility_id=p_facility_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Observation task not found' USING ERRCODE='P0002'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('rounding-pattern:'||p_facility_id::text||':'||p_actual_staff_id::text,0));
 v_actor:=haven.assert_rounding_service_actor(p_actor_id,p_actor_role,p_session_id,p_claim_version,p_organization_id,p_facility_id,false,true);
 v_staff:=(v_actor->>'staff_id')::uuid; v_role:=v_actor->>'role';
 IF v_staff IS DISTINCT FROM p_actual_staff_id THEN RAISE EXCEPTION 'Rounding actor staff identity changed' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.resident_observation_assignments a
 WHERE a.task_id=v_task.id AND a.organization_id=p_organization_id AND a.facility_id=p_facility_id AND a.released_at IS NULL
 ORDER BY a.id FOR SHARE;
 SELECT EXISTS(SELECT 1 FROM public.resident_observation_assignments a WHERE a.task_id=v_task.id AND a.organization_id=p_organization_id AND a.facility_id=p_facility_id AND a.released_at IS NULL),
 EXISTS(SELECT 1 FROM public.resident_observation_assignments a WHERE a.task_id=v_task.id AND a.organization_id=p_organization_id AND a.facility_id=p_facility_id AND a.released_at IS NULL AND a.staff_id=v_staff)
 INTO v_has_assignment,v_is_assignee;
 -- Assignee guard, unchanged from the approved 331 body. A task with no assigned
 -- staff stays uncompletable by a floor role: supabase/tests/review_authoritative_actor.sql
 -- asserts exactly that, and a tested authorization invariant outranks the
 -- spec's facility pool wording. See the build notes, decision D12.
 IF v_role NOT IN('owner','org_admin','facility_admin','nurse')
 AND (CASE WHEN v_has_assignment THEN v_is_assignee ELSE v_task.assigned_staff_id=v_staff END) IS NOT TRUE THEN
  RAISE EXCEPTION 'Rounding task assignee changed' USING ERRCODE='42501';
 END IF;
 v_observed:=(p_payload->>'observed_at')::timestamptz;
 IF NOT isfinite(v_observed) THEN RAISE EXCEPTION 'Invalid observation time' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(coalesce(p_payload->'intervention_codes','[]'))<>'array'
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_payload->'intervention_codes','[]')) code WHERE jsonb_typeof(code)<>'string') THEN
  RAISE EXCEPTION 'Invalid intervention codes' USING ERRCODE='22023';
 END IF;
 v_exception:=coalesce(nullif(p_payload->>'exception_type',''),CASE
  WHEN p_payload->>'quick_status'='not_found' THEN 'resident_not_found'
  WHEN p_payload->>'quick_status'='refused' THEN 'resident_declined_interaction'
  WHEN coalesce((p_payload->>'fall_hazard_observed')::boolean,false) THEN 'environmental_hazard_present' END);
 v_payload:=jsonb_build_object(
  'observed_at',v_observed,'quick_status',p_payload->>'quick_status',
  'resident_location',p_payload->>'resident_location','resident_position',p_payload->>'resident_position','resident_state',p_payload->>'resident_state',
  'distress_present',coalesce((p_payload->>'distress_present')::boolean,false),'breathing_concern',coalesce((p_payload->>'breathing_concern')::boolean,false),
  'pain_concern',coalesce((p_payload->>'pain_concern')::boolean,false),'toileting_assisted',coalesce((p_payload->>'toileting_assisted')::boolean,false),
  'hydration_offered',coalesce((p_payload->>'hydration_offered')::boolean,false),'repositioned',coalesce((p_payload->>'repositioned')::boolean,false),
  'skin_concern_observed',coalesce((p_payload->>'skin_concern_observed')::boolean,false),'fall_hazard_observed',coalesce((p_payload->>'fall_hazard_observed')::boolean,false),
  'refused_assistance',coalesce((p_payload->>'refused_assistance')::boolean,false),
  'intervention_codes',coalesce((SELECT jsonb_agg(code ORDER BY code) FROM jsonb_array_elements_text(coalesce(p_payload->'intervention_codes','[]')) code),'[]'),
  'note',p_payload->>'note','late_reason',p_payload->>'late_reason','exception_type',v_exception,
  'chip_selections',coalesce(p_payload->'chip_selections','{}'::jsonb),
  'composed_summary',nullif(btrim(p_payload->>'composed_summary'),''),
  'exception_severity',coalesce(nullif(p_payload->>'exception_severity',''),'medium'),'exception_present',v_exception IS NOT NULL);
 SELECT * INTO v_receipt FROM public.rounding_completion_receipts WHERE id=v_request;
 IF FOUND THEN
  IF v_receipt.actor_id IS DISTINCT FROM p_actor_id OR v_receipt.task_id IS DISTINCT FROM p_task_id
    OR v_receipt.organization_id IS DISTINCT FROM p_organization_id OR v_receipt.facility_id IS DISTINCT FROM p_facility_id
    OR v_receipt.staff_id IS DISTINCT FROM v_staff OR v_receipt.payload IS DISTINCT FROM v_payload THEN
   RAISE EXCEPTION 'Completion request conflicts with an existing observation' USING ERRCODE='23505';
  END IF;
  RETURN v_receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF v_task.status IN('completed_on_time','completed_late','excused') OR v_task.completed_log_id IS NOT NULL THEN
  RAISE EXCEPTION 'Observation task is no longer completable' USING ERRCODE='P0001';
 END IF;
 v_entered:=clock_timestamp();
 IF v_observed>v_entered THEN RAISE EXCEPTION 'Observation time cannot be in the future' USING ERRCODE='22023'; END IF;
 v_mode:=CASE WHEN coalesce((p_payload->>'offline')::boolean,false) THEN 'offline_synced'
  WHEN v_observed<v_entered-interval '5 minutes' THEN 'late' ELSE 'live' END;
 IF v_mode='late' AND nullif(haven.rounding_trim_text(v_payload->>'late_reason'),'') IS NULL THEN
  RAISE EXCEPTION 'lateReason is required for late entries' USING ERRCODE='22023';
 END IF;
 v_status:=CASE WHEN v_observed<=v_task.grace_ends_at THEN 'completed_on_time' ELSE 'completed_late' END;
 v_result:=haven.complete_rounding_task_core(p_task_id,p_actor_id,p_actor_role,p_session_id,p_claim_version,p_organization_id,p_facility_id,v_staff,
  v_payload||jsonb_build_object('entered_at',v_entered,'entry_mode',v_mode,'completion_status',v_status));
 v_log:=(v_result->>'log_id')::uuid;
 IF v_mode='late' THEN
  v_delay:=greatest(1,round(extract(epoch FROM (v_entered-v_observed))/60)::integer);
  v_severity:=CASE WHEN v_delay>=240 THEN 'critical' WHEN v_delay>=60 THEN 'high' ELSE 'medium' END;
  IF v_exception IS NOT NULL AND v_severity='medium' THEN v_severity:='high'; END IF;
  IF v_exception IS NOT NULL AND v_severity='high' AND v_delay>=120 THEN v_severity:='critical'; END IF;
  v_flag:=CASE WHEN v_exception IS NOT NULL THEN 'late_entry_with_exception' WHEN v_delay>=240 THEN 'late_entry_over_4h' WHEN v_delay>=60 THEN 'late_entry_over_60m' ELSE 'late_entry_review' END;
  INSERT INTO public.resident_observation_integrity_flags(organization_id,entity_id,facility_id,resident_id,log_id,staff_id,flag_type,severity,status,disposition_note,updated_by)
  VALUES(v_task.organization_id,v_task.entity_id,v_task.facility_id,v_task.resident_id,v_log,v_staff,v_flag,v_severity::public.resident_observation_severity,'open',
   format('Auto-created from a late observation entry (%s min after observation). Reason: %s',v_delay,btrim(v_payload->>'late_reason')),p_actor_id);
  v_late:=true;
 END IF;
 SELECT count(*) FILTER(WHERE entered_at>=date_trunc('minute',v_entered)),count(*) INTO v_minute,v_recent
 FROM public.resident_observation_logs WHERE organization_id=p_organization_id AND facility_id=p_facility_id AND staff_id=v_staff AND deleted_at IS NULL
 AND entered_at>=v_entered-interval '5 minutes' AND entered_at<=v_entered;
 IF v_minute>=3 OR v_recent>=8 THEN
  v_flag:=CASE WHEN v_recent>=8 THEN 'high_velocity_documentation' ELSE 'same_minute_batch_entry' END;
  v_severity:=CASE WHEN v_minute>=6 OR v_recent>=12 THEN 'critical' ELSE 'high' END;
  INSERT INTO public.resident_observation_integrity_flags(organization_id,entity_id,facility_id,resident_id,log_id,staff_id,flag_type,severity,status,disposition_note,updated_by)
  VALUES(v_task.organization_id,v_task.entity_id,v_task.facility_id,v_task.resident_id,v_log,v_staff,v_flag,v_severity::public.resident_observation_severity,'open',
   format('Auto-created from a suspicious documentation pattern: %s entries in the same minute and %s entries in the last 5 minutes.',v_minute,v_recent),p_actor_id);
  v_pattern:=true;
 END IF;
 SELECT count(DISTINCT log.resident_id) INTO v_residents FROM public.resident_observation_logs log
 WHERE log.organization_id=p_organization_id AND log.facility_id=p_facility_id AND log.staff_id=v_staff AND log.deleted_at IS NULL
 AND log.entered_at>=v_entered-interval '15 minutes' AND log.entered_at<=v_entered
 AND haven.rounding_pattern_signature(to_jsonb(log))=haven.rounding_pattern_signature(v_payload);
 IF v_residents>=3 THEN
  INSERT INTO public.resident_observation_integrity_flags(organization_id,entity_id,facility_id,resident_id,log_id,staff_id,flag_type,severity,status,disposition_note,updated_by)
  VALUES(v_task.organization_id,v_task.entity_id,v_task.facility_id,v_task.resident_id,v_log,v_staff,'identical_payload_multi_resident',
   (CASE WHEN v_residents>=5 THEN 'critical' ELSE 'high' END)::public.resident_observation_severity,'open',
   format('Auto-created from repeated identical payload signatures across %s residents within 15 minutes.',v_residents),p_actor_id);
  v_pattern:=true;
 END IF;
 v_result:=v_result||jsonb_build_object('integrityFlagCreated',v_late,'suspiciousPatternFlagCreated',v_pattern,'replayed',false);
 INSERT INTO public.rounding_completion_receipts(id,organization_id,facility_id,actor_id,staff_id,task_id,payload,result)
 VALUES(v_request,p_organization_id,p_facility_id,p_actor_id,v_staff,p_task_id,v_payload,v_result);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.complete_rounding_task_review(uuid,uuid,text,uuid,integer,uuid,uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_rounding_task_review(uuid,uuid,text,uuid,integer,uuid,uuid,uuid,jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- public.submit_observation: the composing submit command.
--
-- It validates the chips against the vocabulary in force for the facility,
-- refuses a code it does not recognize rather than quietly dropping it,
-- composes the sentence, and hands the write to the locked completion command
-- above. The three retained required fields are required. At least one chip
-- from the three new groups is required. The note is never required, never
-- validated, and never the reason a submission fails.
--
-- A refused medication chip is an observation. This function does not read,
-- write or reconcile any medication order, administration record or external
-- medication artifact, and no later change should make it do so.
--
-- Two callers. A browser session is identified from its own signed claims. The
-- server route passes the actor it already verified, which is the only way a
-- service_role connection can name an observer at all; those arguments are
-- ignored whenever a signed session is present, so they cannot be used to
-- record an observation under someone else's name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_observation (p_task_id uuid, p_chip_selections jsonb, p_resident_location text, p_resident_state text, p_quick_status text, p_note text DEFAULT NULL, p_resident_position text DEFAULT NULL, p_intervention_codes text[] DEFAULT NULL, p_observed_at timestamptz DEFAULT NULL, p_late_reason text DEFAULT NULL, p_request_id uuid DEFAULT NULL, p_offline boolean DEFAULT FALSE, p_actor_id uuid DEFAULT NULL, p_actor_role text DEFAULT NULL, p_session_id uuid DEFAULT NULL, p_claim_version integer DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $func$
DECLARE
  -- Resident Aide and above, resolved onto the authentication role enum.
  -- Recorded in HANDOFFS/2026-09-16__smart-rounding-build-notes.md section 1.5.
  v_observer_roles CONSTANT text[] := ARRAY['caregiver', 'med_tech', 'nurse', 'manager', 'coordinator', 'admin_assistant', 'facility_admin', 'org_admin', 'owner'];
  v_chip_groups CONSTANT text[] := ARRAY['meal_intake', 'mood_state', 'med_response'];
  v_task public.resident_observation_tasks%ROWTYPE;
  v_caller uuid;
  v_actor_id uuid;
  v_actor_role text;
  v_session_id uuid;
  v_claim_version integer;
  v_staff_id uuid;
  v_group text;
  v_values jsonb;
  v_codes jsonb;
  v_unknown text;
  v_selections jsonb := '{}'::jsonb;
  v_chip_count integer := 0;
  v_summary text;
BEGIN
  SELECT
    * INTO v_task
  FROM
    public.resident_observation_tasks
  WHERE
    id = p_task_id
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Observation task not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_caller := auth.uid();
  IF v_caller IS NOT NULL THEN
    v_actor_id := v_caller;
    v_actor_role := haven.app_role()::text;
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
    SELECT
      profile.auth_claim_version INTO v_claim_version
    FROM
      public.user_profiles AS profile
    WHERE
      profile.id = v_actor_id;
    IF haven.organization_id() IS DISTINCT FROM v_task.organization_id OR NOT haven.has_facility_access(v_task.facility_id) THEN
      RAISE EXCEPTION 'Not allowed to record an observation at this facility'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    v_actor_id := p_actor_id;
    v_actor_role := p_actor_role;
    v_session_id := p_session_id;
    v_claim_version := p_claim_version;
  END IF;

  IF v_actor_id IS NULL OR v_actor_role IS NULL OR v_session_id IS NULL THEN
    RAISE EXCEPTION 'An authorized observer is required to record an observation'
      USING ERRCODE = '42501';
  END IF;
  IF NOT (v_actor_role = ANY (v_observer_roles)) THEN
    RAISE EXCEPTION 'This role cannot record an observation'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    staff.id INTO v_staff_id
  FROM
    public.staff AS staff
  WHERE
    staff.user_id = v_actor_id
    AND staff.organization_id = v_task.organization_id
    AND staff.facility_id = v_task.facility_id
    AND staff.employment_status = 'active'
    AND staff.deleted_at IS NULL
  ORDER BY
    staff.id
  LIMIT 1;
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'An active staff profile is required to record an observation'
      USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(p_resident_location), '') IS NULL OR NULLIF(btrim(p_resident_state), '') IS NULL OR NULLIF(btrim(p_quick_status), '') IS NULL THEN
    RAISE EXCEPTION 'Where the resident was, how they presented, and their status are required on every check'
      USING ERRCODE = '22023';
  END IF;
  IF haven.observation_quick_status_label(p_quick_status) IS NULL THEN
    RAISE EXCEPTION 'That status is not one this facility records'
      USING ERRCODE = '22023';
  END IF;

  IF p_chip_selections IS NULL OR jsonb_typeof(p_chip_selections) <> 'object' THEN
    RAISE EXCEPTION 'Chip selections must arrive as a group to code map'
      USING ERRCODE = '22023';
  END IF;
  SELECT
    key INTO v_unknown
  FROM
    jsonb_object_keys(p_chip_selections) AS key
  WHERE
    NOT (key = ANY (v_chip_groups))
  LIMIT 1;
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'There is no observation chip group named %', v_unknown
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_group IN ARRAY v_chip_groups LOOP
    v_values := p_chip_selections -> v_group;
    CONTINUE WHEN v_values IS NULL OR jsonb_typeof(v_values) = 'null';
    IF jsonb_typeof(v_values) <> 'array' THEN
      RAISE EXCEPTION 'Chip selections for one group must be a list of codes'
        USING ERRCODE = '22023';
    END IF;
    SELECT
      selected.code INTO v_unknown
    FROM
      jsonb_array_elements_text(v_values) AS selected (code)
    WHERE
      NOT EXISTS (
        SELECT
          1
        FROM
          public.observation_vocab AS vocab
        WHERE
          vocab.organization_id = v_task.organization_id
          AND (vocab.facility_id IS NULL OR vocab.facility_id = v_task.facility_id)
          AND vocab.field_name = v_group
          AND vocab.value_code = selected.code
          AND vocab.active
          AND vocab.deleted_at IS NULL)
    LIMIT 1;
    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION 'The observation chip % is not available at this facility', v_unknown
        USING ERRCODE = '22023';
    END IF;
    SELECT
      COALESCE(jsonb_agg(resolved.value_code ORDER BY resolved.display_order, resolved.value_code), '[]'::jsonb) INTO v_codes
    FROM (
      SELECT DISTINCT ON (selected.code)
        vocab.value_code,
        vocab.display_order
      FROM jsonb_array_elements_text(v_values) AS selected (code)
      JOIN public.observation_vocab AS vocab ON vocab.organization_id = v_task.organization_id
        AND (vocab.facility_id IS NULL OR vocab.facility_id = v_task.facility_id)
        AND vocab.field_name = v_group
        AND vocab.value_code = selected.code
        AND vocab.active
        AND vocab.deleted_at IS NULL
      ORDER BY
        selected.code,
        (vocab.facility_id IS NOT NULL) DESC) AS resolved;
    IF jsonb_array_length(v_codes) > 0 THEN
      v_selections := v_selections || jsonb_build_object(v_group, v_codes);
      v_chip_count := v_chip_count + jsonb_array_length(v_codes);
    END IF;
  END LOOP;

  IF v_chip_count = 0 THEN
    RAISE EXCEPTION 'Tap at least one meal, mood or medication chip before recording this check'
      USING ERRCODE = '22023';
  END IF;

  v_summary := haven.compose_observation_summary(v_task.organization_id, v_task.facility_id, v_selections, p_quick_status, p_resident_state, p_resident_location, p_resident_position, p_intervention_codes);

  RETURN public.complete_rounding_task_review(p_task_id, v_actor_id, v_actor_role, v_session_id, v_claim_version, v_task.organization_id, v_task.facility_id, v_staff_id, jsonb_build_object('request_id', COALESCE(p_request_id, pg_catalog.gen_random_uuid()), 'observed_at', COALESCE(p_observed_at, clock_timestamp()), 'offline', COALESCE(p_offline, FALSE), 'quick_status', p_quick_status, 'resident_location', p_resident_location, 'resident_state', p_resident_state, 'resident_position', p_resident_position, 'intervention_codes', COALESCE(to_jsonb(p_intervention_codes), '[]'::jsonb), 'chip_selections', v_selections, 'composed_summary', v_summary, 'note', NULLIF(btrim(p_note), ''), 'late_reason', NULLIF(btrim(p_late_reason), '')));
END;
$func$;

COMMENT ON FUNCTION public.submit_observation (uuid, jsonb, text, text, text, text, text, text[], timestamptz, text, uuid, boolean, uuid, text, uuid, integer) IS
  'Records a chip composed observation. Validates every chip against the vocabulary the facility actually has, composes the stored sentence, and delegates the write to the locked completion command so replay receipts, integrity flags, assignment authority and the on-time rule are the same ones every observation has always gone through. The note is optional by design and no submission is ever refused for the absence of one. Chips that name a medication response record an observation only and touch nothing in any medication system. COL-37 ruling: definer required -- recording a check writes clinical evidence and moves a task, and browser roles hold no INSERT on resident_observation_logs and no UPDATE on a completed task by design (migration 331). The privilege is confined: the function reads the caller''s own signed claims, refuses any role below Resident Aide, refuses a facility the caller has no grant to, resolves the observer''s own active staff row rather than accepting one, and hands the write to the locked completion command, which re-verifies the actor against live session, profile and grant state before anything is written.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION haven.observation_quick_status_label (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.observation_quick_status_label (text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION haven.observation_vocab_label (uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.observation_vocab_label (uuid, uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION haven.compose_observation_summary (uuid, uuid, jsonb, text, text, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.compose_observation_summary (uuid, uuid, jsonb, text, text, text, text, text[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_observation (uuid, jsonb, text, text, text, text, text, text[], timestamptz, text, uuid, boolean, uuid, text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_observation (uuid, jsonb, text, text, text, text, text, text[], timestamptz, text, uuid, boolean, uuid, text, uuid, integer) TO authenticated, service_role;

NOTIFY pgrst,
'reload schema';

COMMIT;
