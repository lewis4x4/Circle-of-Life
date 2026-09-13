BEGIN;

-- COL-137 / HFO-03: one recurrence and due-date evaluator. The evaluator
-- itself lives in shared TypeScript (src/lib/operations/schedule-evaluator.ts)
-- and is used by the scheduler, task list, history and exception views. This
-- migration gives the database the same version-1 rule shape so that a
-- facility requirement can only hold, and only publish, a schedule rule the
-- evaluator can interpret. It confirms no schedule for any facility: every
-- schedule_status stays needs_confirmation until a site administrator
-- publishes a configuration with a valid rule under COL-135's commands.
-- No occurrence is generated, no table is added and no recording path is
-- blocked by this migration.

-- ---------------------------------------------------------------------------
-- Rule-shape helpers. Problem wording and order mirror validateScheduleRule
-- so the same fixtures produce the same first problem in both runtimes
-- (asserted by supabase/tests/review_hfo_schedule_evaluator.sql and the
-- Vitest suite).
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_schedule_date_valid(p_value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v text;
BEGIN
 IF p_value IS NULL OR jsonb_typeof(p_value)<>'string' THEN RETURN false; END IF;
 v:=p_value#>>'{}';
 IF v !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN false; END IF;
 BEGIN
  RETURN to_char(v::date,'YYYY-MM-DD')=v;
 EXCEPTION WHEN OTHERS THEN RETURN false; END;
END $$;

CREATE FUNCTION haven.operation_schedule_int(p_value jsonb,p_lo numeric,p_hi numeric) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_value IS NOT NULL AND jsonb_typeof(p_value)='number'
  AND (p_value#>>'{}')::numeric=trunc((p_value#>>'{}')::numeric)
  AND (p_value#>>'{}')::numeric BETWEEN p_lo AND p_hi
$$;

CREATE FUNCTION haven.operation_schedule_weekdays_problem(p_value jsonb,p_allow_empty boolean) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE e jsonb; seen text[]:='{}';
BEGIN
 IF p_value IS NULL OR jsonb_typeof(p_value)<>'array' THEN RETURN 'weekdays must be a list'; END IF;
 IF NOT p_allow_empty AND jsonb_array_length(p_value)=0 THEN RETURN 'weekdays must not be empty'; END IF;
 FOR e IN SELECT * FROM jsonb_array_elements(p_value) LOOP
  IF jsonb_typeof(e)<>'string' OR (e#>>'{}') NOT IN('monday','tuesday','wednesday','thursday','friday','saturday','sunday') THEN RETURN 'weekdays must be weekday names'; END IF;
  IF (e#>>'{}')=ANY(seen) THEN RETURN 'weekdays must be unique'; END IF;
  seen:=array_append(seen,e#>>'{}');
 END LOOP;
 RETURN NULL;
END $$;

CREATE FUNCTION haven.operation_schedule_calendar_problem(p_cal jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; e jsonb; seen text[]:='{}'; wp text; cf date; ct date;
BEGIN
 IF p_cal IS NULL OR jsonb_typeof(p_cal)<>'object' THEN RETURN 'calendar must be an object'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_cal) LOOP
  IF k NOT IN('key','version','covers_from','covers_to','weekend','holidays') THEN RETURN 'calendar has an unknown field: '||k; END IF;
 END LOOP;
 IF jsonb_typeof(p_cal->'key') IS DISTINCT FROM 'string' OR (p_cal->>'key') !~ '^[a-z][a-z0-9-]{0,63}$' THEN RETURN 'calendar key must be a slug'; END IF;
 IF jsonb_typeof(p_cal->'version') IS DISTINCT FROM 'string' OR length(btrim(p_cal->>'version'))=0 OR length(p_cal->>'version')>64 THEN RETURN 'calendar version is required'; END IF;
 IF NOT haven.operation_schedule_date_valid(p_cal->'covers_from') OR NOT haven.operation_schedule_date_valid(p_cal->'covers_to') THEN RETURN 'calendar coverage must be calendar dates'; END IF;
 cf:=(p_cal->>'covers_from')::date; ct:=(p_cal->>'covers_to')::date;
 IF cf>ct THEN RETURN 'calendar coverage must start before it ends'; END IF;
 wp:=haven.operation_schedule_weekdays_problem(p_cal->'weekend',true);
 IF wp IS NOT NULL THEN RETURN 'calendar '||wp; END IF;
 IF jsonb_typeof(p_cal->'holidays') IS DISTINCT FROM 'array' OR jsonb_array_length(p_cal->'holidays')>400 THEN RETURN 'calendar holidays must be a list of at most 400 dates'; END IF;
 FOR e IN SELECT * FROM jsonb_array_elements(p_cal->'holidays') LOOP
  IF NOT haven.operation_schedule_date_valid(e) THEN RETURN 'calendar holidays must be calendar dates'; END IF;
  IF (e#>>'{}')::date<cf OR (e#>>'{}')::date>ct THEN RETURN 'calendar holidays must lie inside the coverage'; END IF;
  IF (e#>>'{}')=ANY(seen) THEN RETURN 'calendar holidays must be unique'; END IF;
  seen:=array_append(seen,e#>>'{}');
 END LOOP;
 RETURN NULL;
END $$;

CREATE FUNCTION haven.operation_schedule_recurrence_problem(p_rec jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; kind text; wp text; e jsonb; seen numeric[]:='{}'; allowed text[];
BEGIN
 IF p_rec IS NULL OR jsonb_typeof(p_rec)<>'object' THEN RETURN 'recurrence must be an object'; END IF;
 kind:=p_rec->>'kind';
 allowed:=CASE kind
  WHEN 'weekday_set' THEN ARRAY['kind','weekdays','on_holiday']
  WHEN 'weekly' THEN ARRAY['kind','weekday']
  WHEN 'monthly' THEN ARRAY['kind','day','short_month']
  WHEN 'monthly_business_day' THEN ARRAY['kind','ordinal','from']
  WHEN 'fixed_months' THEN ARRAY['kind','months','day','short_month']
  WHEN 'interval_months' THEN ARRAY['kind','every','anchor','short_month']
  WHEN 'expiry' THEN ARRAY['kind','expires_on']
  WHEN 'event' THEN ARRAY['kind','event_key']
  ELSE NULL END;
 IF allowed IS NULL THEN RETURN 'recurrence kind is unknown'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_rec) LOOP
  IF NOT (k=ANY(allowed)) THEN RETURN 'recurrence has an unknown field: '||k; END IF;
 END LOOP;
 IF kind='weekday_set' THEN
  wp:=haven.operation_schedule_weekdays_problem(p_rec->'weekdays',false);
  IF wp IS NOT NULL THEN RETURN wp; END IF;
  IF p_rec ? 'on_holiday' AND (jsonb_typeof(p_rec->'on_holiday')<>'string' OR (p_rec->>'on_holiday') NOT IN('occurs','skipped')) THEN RETURN 'on_holiday must be occurs or skipped'; END IF;
 ELSIF kind='weekly' THEN
  IF jsonb_typeof(p_rec->'weekday') IS DISTINCT FROM 'string' OR (p_rec->>'weekday') NOT IN('monday','tuesday','wednesday','thursday','friday','saturday','sunday') THEN RETURN 'weekday must be a weekday name'; END IF;
 ELSIF kind='monthly' OR kind='fixed_months' THEN
  IF kind='fixed_months' THEN
   IF jsonb_typeof(p_rec->'months') IS DISTINCT FROM 'array' OR jsonb_array_length(p_rec->'months')=0 OR jsonb_array_length(p_rec->'months')>12 THEN RETURN 'months must be a non-empty list'; END IF;
   FOR e IN SELECT * FROM jsonb_array_elements(p_rec->'months') LOOP
    IF NOT haven.operation_schedule_int(e,1,12) THEN RETURN 'months must be 1 to 12'; END IF;
    IF (e#>>'{}')::numeric=ANY(seen) THEN RETURN 'months must be unique'; END IF;
    seen:=array_append(seen,(e#>>'{}')::numeric);
   END LOOP;
  END IF;
  IF NOT (coalesce(p_rec->'day'='"last"'::jsonb,false) OR haven.operation_schedule_int(p_rec->'day',1,31)) THEN RETURN 'day must be 1 to 31 or last'; END IF;
  IF p_rec ? 'short_month' AND (jsonb_typeof(p_rec->'short_month')<>'string' OR (p_rec->>'short_month') NOT IN('clamp','skip')) THEN RETURN 'short_month must be clamp or skip'; END IF;
 ELSIF kind='monthly_business_day' THEN
  IF NOT haven.operation_schedule_int(p_rec->'ordinal',1,15) THEN RETURN 'ordinal must be 1 to 15'; END IF;
  IF jsonb_typeof(p_rec->'from') IS DISTINCT FROM 'string' OR (p_rec->>'from') NOT IN('start','end') THEN RETURN 'from must be start or end'; END IF;
 ELSIF kind='interval_months' THEN
  IF NOT haven.operation_schedule_int(p_rec->'every',1,120) THEN RETURN 'every must be 1 to 120 months'; END IF;
  IF NOT haven.operation_schedule_date_valid(p_rec->'anchor') THEN RETURN 'anchor must be a calendar date'; END IF;
  IF p_rec ? 'short_month' AND (jsonb_typeof(p_rec->'short_month')<>'string' OR (p_rec->>'short_month') NOT IN('clamp','skip')) THEN RETURN 'short_month must be clamp or skip'; END IF;
 ELSIF kind='expiry' THEN
  IF NOT haven.operation_schedule_date_valid(p_rec->'expires_on') THEN RETURN 'expires_on must be a calendar date'; END IF;
 ELSIF kind='event' THEN
  IF jsonb_typeof(p_rec->'event_key') IS DISTINCT FROM 'string' OR (p_rec->>'event_key') !~ '^[a-z][a-z0-9-]{0,63}$' THEN RETURN 'event_key must be a slug'; END IF;
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION haven.operation_schedule_deadline_problem(p_dl jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text;
BEGIN
 IF p_dl IS NULL OR jsonb_typeof(p_dl)<>'object' THEN RETURN 'deadline must be an object'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_dl) LOOP
  IF k NOT IN('time','day_offset','offset_minutes','grace_minutes') THEN RETURN 'deadline has an unknown field: '||k; END IF;
 END LOOP;
 IF jsonb_typeof(p_dl->'time') IS DISTINCT FROM 'string' OR (p_dl->>'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RETURN 'deadline time must be HH:MM'; END IF;
 IF p_dl ? 'day_offset' AND NOT haven.operation_schedule_int(p_dl->'day_offset',0,366) THEN RETURN 'deadline day_offset must be 0 to 366'; END IF;
 IF p_dl ? 'offset_minutes' AND NOT haven.operation_schedule_int(p_dl->'offset_minutes',0,10080) THEN RETURN 'deadline offset_minutes must be 0 to 10080'; END IF;
 IF p_dl ? 'grace_minutes' AND NOT haven.operation_schedule_int(p_dl->'grace_minutes',0,44640) THEN RETURN 'deadline grace_minutes must be 0 to 44640'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION haven.operation_schedule_reminder_problem(p_rm jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text;
BEGIN
 IF p_rm IS NULL OR jsonb_typeof(p_rm)='null' THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_rm)<>'object' THEN RETURN 'reminder must be an object'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_rm) LOOP
  IF k<>'lead_minutes' THEN RETURN 'reminder has an unknown field: '||k; END IF;
 END LOOP;
 IF NOT haven.operation_schedule_int(p_rm->'lead_minutes',1,86400) THEN RETURN 'reminder lead_minutes must be 1 to 86400'; END IF;
 RETURN NULL;
END $$;

-- Every problem with a rule, in the evaluator's order; empty when valid.
CREATE FUNCTION haven.operation_schedule_rule_problems(p_rule jsonb) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE problems text[]:='{}'; k text; p text; rec jsonb; kind text; has_calendar boolean:=false; rec_ok boolean; day_json jsonb;
BEGIN
 IF p_rule IS NULL OR jsonb_typeof(p_rule)<>'object' THEN RETURN ARRAY['schedule rule must be an object']; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_rule) LOOP
  IF k NOT IN('rule_version','timezone','recurrence','deadline','reminder','calendar') THEN RETURN ARRAY['schedule rule has an unknown field: '||k]; END IF;
 END LOOP;
 IF p_rule->'rule_version' IS DISTINCT FROM '1'::jsonb THEN problems:=array_append(problems,'schedule rule version must be 1'); END IF;
 IF jsonb_typeof(p_rule->'timezone') IS DISTINCT FROM 'string' OR (p_rule->>'timezone') !~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE lower(z.name)=lower(p_rule->>'timezone') AND z.name NOT LIKE 'posix/%' AND z.name NOT LIKE 'right/%') THEN
  problems:=array_append(problems,'schedule rule timezone must be an IANA zone name');
 END IF;
 IF p_rule ? 'calendar' AND jsonb_typeof(p_rule->'calendar')<>'null' THEN
  p:=haven.operation_schedule_calendar_problem(p_rule->'calendar');
  IF p IS NOT NULL THEN problems:=array_append(problems,'schedule rule '||p); ELSE has_calendar:=true; END IF;
 END IF;
 rec:=p_rule->'recurrence';
 p:=haven.operation_schedule_recurrence_problem(rec);
 rec_ok:=p IS NULL;
 IF NOT rec_ok THEN problems:=array_append(problems,'schedule rule '||p); END IF;
 p:=haven.operation_schedule_deadline_problem(p_rule->'deadline');
 IF p IS NOT NULL THEN problems:=array_append(problems,'schedule rule '||p); END IF;
 p:=haven.operation_schedule_reminder_problem(p_rule->'reminder');
 IF p IS NOT NULL THEN problems:=array_append(problems,'schedule rule '||p); END IF;
 IF rec_ok THEN
  kind:=rec->>'kind';
  IF (kind='monthly_business_day' OR (kind='weekday_set' AND rec->>'on_holiday'='skipped')) AND NOT has_calendar THEN
   problems:=array_append(problems,'schedule rule recurrence needs a calendar');
  END IF;
  day_json:=CASE WHEN kind IN('monthly','fixed_months') THEN rec->'day' ELSE NULL END;
  IF (kind IN('monthly','fixed_months') AND jsonb_typeof(day_json)='number' AND (day_json#>>'{}')::numeric>28 AND NOT (rec ? 'short_month'))
   OR (kind='interval_months' AND extract(day FROM (rec->>'anchor')::date)>28 AND NOT (rec ? 'short_month')) THEN
   problems:=array_append(problems,'schedule rule recurrence needs a short_month policy');
  END IF;
 END IF;
 RETURN problems;
END $$;

CREATE FUNCTION haven.operation_schedule_rule_valid(p_rule jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$ SELECT coalesce(cardinality(haven.operation_schedule_rule_problems(p_rule)),0)=0 $$;

REVOKE ALL ON FUNCTION haven.operation_schedule_date_valid(jsonb),haven.operation_schedule_int(jsonb,numeric,numeric),haven.operation_schedule_weekdays_problem(jsonb,boolean),
 haven.operation_schedule_calendar_problem(jsonb),haven.operation_schedule_recurrence_problem(jsonb),haven.operation_schedule_deadline_problem(jsonb),
 haven.operation_schedule_reminder_problem(jsonb),haven.operation_schedule_rule_problems(jsonb),haven.operation_schedule_rule_valid(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.operation_schedule_rule_problems(jsonb),haven.operation_schedule_rule_valid(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- A stored schedule rule must have the evaluator's shape. The guard reports
-- the first problem plainly through the draft command's error contract.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.guard_operation_facility_schedule_rule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE problems text[];
BEGIN
 -- Validate a rule when it is stored or changed. Published rows are immutable
 -- (operation_facility_requirement_guard fires first); closing their window
 -- must not depend on re-validating a rule that was valid when published.
 IF NEW.schedule_rule IS NOT NULL AND (TG_OP='INSERT' OR NEW.schedule_rule IS DISTINCT FROM OLD.schedule_rule) THEN
  problems:=haven.operation_schedule_rule_problems(NEW.schedule_rule);
  IF coalesce(cardinality(problems),0)>0 THEN
   RAISE EXCEPTION 'Facility requirement draft contains an invalid value: %',problems[1] USING ERRCODE='22023';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_facility_schedule_rule() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_facility_requirement_schedule_rule BEFORE INSERT OR UPDATE ON public.operation_facility_requirements
 FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_facility_schedule_rule();

-- ---------------------------------------------------------------------------
-- Publication problems (replaces the 338 body). A confirmed schedule is
-- publishable only with a valid rule and only on an applicable configuration;
-- everything else in the 338 contract is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.operation_facility_requirement_problems(fr public.operation_facility_requirements,p_effective_from timestamptz) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE problems text[]:='{}'; latest public.operation_facility_requirements; in_force uuid;
BEGIN
 IF fr.applicability='applicable' THEN
  in_force:=haven.operation_requirement_in_force(fr.activity_id,coalesce(p_effective_from,clock_timestamp()));
  IF in_force IS NULL THEN problems:=array_append(problems,'applicable requires a central version in force at the effective time');
  ELSIF fr.requirement_version_id IS DISTINCT FROM in_force THEN problems:=array_append(problems,'applicable must reference the central version in force at the effective time'); END IF;
 END IF;
 IF fr.applicability='not_applicable' AND length(btrim(coalesce(fr.applicability_reason,'')))=0 THEN problems:=array_append(problems,'not applicable requires a reason'); END IF;
 IF fr.override_source<>'central' AND length(btrim(coalesce(fr.applicability_reason,'')))=0 THEN problems:=array_append(problems,'a local override requires a reason'); END IF;
 IF (fr.local_procedure IS NOT NULL OR fr.local_allowed_recorder_roles IS NOT NULL OR fr.local_required_inputs IS NOT NULL OR fr.local_required_evidence IS NOT NULL)
  AND fr.override_source='central' THEN problems:=array_append(problems,'local changes must name their source'); END IF;
 -- COL-137: the evaluator defines rule shapes; a confirmed schedule needs a
 -- valid rule and an applicable configuration. Nothing here confirms one.
 IF fr.schedule_status='confirmed' THEN
  IF fr.schedule_rule IS NULL THEN problems:=array_append(problems,'schedule confirmation requires a rule');
  ELSE problems:=problems||haven.operation_schedule_rule_problems(fr.schedule_rule); END IF;
  IF fr.applicability<>'applicable' THEN problems:=array_append(problems,'schedule confirmation requires applicable'); END IF;
 END IF;
 IF fr.owner_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.user_facility_access g WHERE g.user_id=fr.owner_user_id AND g.facility_id=fr.facility_id AND g.revoked_at IS NULL) THEN problems:=array_append(problems,'owner needs current access to this site'); END IF;
 IF fr.backup_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.user_facility_access g WHERE g.user_id=fr.backup_user_id AND g.facility_id=fr.facility_id AND g.revoked_at IS NULL) THEN problems:=array_append(problems,'backup needs current access to this site'); END IF;
 IF p_effective_from IS NULL THEN problems:=array_append(problems,'effective time is required');
 ELSIF p_effective_from<clock_timestamp()-interval '1 day' THEN problems:=array_append(problems,'effective time cannot rewrite history'); END IF;
 SELECT * INTO latest FROM public.operation_facility_requirements WHERE activity_id=fr.activity_id AND facility_id=fr.facility_id AND status='published' ORDER BY effective_from DESC LIMIT 1;
 IF FOUND AND p_effective_from IS NOT NULL AND p_effective_from<=latest.effective_from THEN problems:=array_append(problems,'effective time must follow the latest published site configuration'); END IF;
 RETURN problems;
END $$;

-- The preview now carries the proposed and in-force rules so the server can
-- show next-due occurrences from the same evaluator before publication.
CREATE OR REPLACE FUNCTION haven.preview_operation_facility_requirement_publication(p_draft_id uuid,p_effective_from timestamptz) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE draft public.operation_facility_requirements; latest public.operation_facility_requirements; in_force public.operation_facility_requirements; problems text[]; retained bigint;
BEGIN
 SELECT * INTO draft FROM public.operation_facility_requirements WHERE id=p_draft_id AND status='draft' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facility requirement draft unavailable' USING ERRCODE='42501'; END IF;
 PERFORM haven.assert_operation_requirement_actor(draft.organization_id,draft.facility_id);
 problems:=haven.operation_facility_requirement_problems(draft,p_effective_from);
 SELECT * INTO latest FROM public.operation_facility_requirements WHERE activity_id=draft.activity_id AND facility_id=draft.facility_id AND status='published' ORDER BY effective_from DESC LIMIT 1;
 SELECT * INTO in_force FROM public.operation_facility_requirements WHERE id=haven.operation_facility_requirement_in_force(draft.activity_id,draft.facility_id,clock_timestamp());
 SELECT count(*) INTO retained FROM public.operation_task_instances WHERE latest.id IS NOT NULL AND facility_requirement_id=latest.id
  AND p_effective_from IS NOT NULL AND assigned_shift_date>=p_effective_from::date;
 PERFORM haven.assert_operation_requirement_actor(draft.organization_id,draft.facility_id);
 RETURN jsonb_build_object('draft_id',draft.id,'activity_id',draft.activity_id,'facility_id',draft.facility_id,'next_version',draft.version,
  'in_force_configuration_id',in_force.id,'in_force_applicability',in_force.applicability,'latest_configuration_id',latest.id,'latest_applicability',latest.applicability,
  'proposed_applicability',draft.applicability,'in_force_schedule_status',in_force.schedule_status,'proposed_schedule_status',draft.schedule_status,
  'in_force_schedule_rule',in_force.schedule_rule,'proposed_schedule_rule',draft.schedule_rule,'schedule_rule_version',1,'effective_from',p_effective_from,
  'publishable',coalesce(cardinality(problems),0)=0,'problems',to_jsonb(problems),'future_occurrences_keeping_latest_snapshot',retained);
END $$;

-- Any rule already stored on a target must satisfy the shape the evaluator
-- interprets; none exists before this migration is applied anywhere.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.operation_facility_requirements WHERE schedule_rule IS NOT NULL AND NOT haven.operation_schedule_rule_valid(schedule_rule)) THEN
  RAISE EXCEPTION 'COL-137: a stored schedule rule does not match the evaluator shape; repair before applying';
 END IF;
END $$;

COMMENT ON TABLE public.operation_facility_requirements IS 'COL-135/COL-137: effective-dated site applicability, local constraints, owner/backup and independent schedule-confirmation state. needs_confirmation is an explicit state, not a default rule; a confirmed schedule needs a valid version-1 evaluator rule and an applicable configuration, and is published only through the site commands.';
COMMENT ON FUNCTION haven.operation_schedule_rule_problems(jsonb) IS 'COL-137: version-1 schedule rule shape, mirrored from src/lib/operations/schedule-evaluator.ts. Empty when valid; otherwise every problem in evaluator order.';
COMMENT ON TRIGGER operation_facility_requirement_schedule_rule ON public.operation_facility_requirements IS 'COL-137: a stored schedule rule must have the evaluator shape; publication additionally requires an applicable configuration.';

COMMIT;
