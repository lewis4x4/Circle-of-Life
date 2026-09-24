-- COL-753 (part of COL-749): Monday Stand Up arrives prefilled from Haven and
-- the administrator verifies it.
--
-- Brian, 2026-09-24: "10000%". Earlier, 2026-09-15: "the morning stand up is
-- basically prefilled by everything through Haven. Administrators should only
-- have to verify."
--
-- What this adds:
--
--   * haven.stand_up_monday_prefill(org, facility, week): every Monday figure
--     Haven can compute, with the source it was computed from and the time it
--     was computed. A figure Haven cannot compute is null with the reason
--     (COL-649), never 0:
--       - Current AR (monthly_rent_roll_cents): unsettled invoices (drafts plus
--         sent, partial, overdue) with a balance. The status list mirrors
--         CURRENT_AR_INVOICE_STATUSES in src/lib/billing/receivables.ts
--         (COL-665 ruling); src/lib/stand-up/prefill.test.ts fails if they part.
--         Null when the facility has no invoice in Haven at all.
--       - Census and hospital/rehab: the resident roster
--         (stand_up_roster_census), exactly the COL-351 suggestion. Null when
--         the facility has no residents in Haven.
--       - The four open-bed figures: available, unblocked, unoccupied beds by
--         their Stand Up class. Null when the facility has no beds in Haven or
--         an open bed has no Stand Up class (a count would silently miss it).
--       - Expected admissions: admission cases targeting a move-in during the
--         meeting week that have not arrived and are not cancelled.
--       - Expected discharges: residents in census with a discharge target date
--         in the meeting week.
--       - Callouts: callout, late callout and no-show attendance events in the
--         completed payroll week (COL-374). Null when the facility has no
--         attendance record in Haven.
--       - Terminations: staff whose termination date falls in the completed
--         payroll week. Null when the facility has no staff in Haven.
--       - Open positions and overtime: always null. Haven records no budgeted
--         establishment (COL-416) and has no approved time source (COL-417).
--       - Expected tours: tour records (COL-332) scheduled in the meeting week
--         that were not cancelled or rescheduled.
--       - Home-health activities and outreach: outreach activities planned or
--         done for the meeting week, home-health providers and in-person
--         outreach apart; digital outreach is not counted (the field
--         definition: emails and calls are not counted).
--
--   * stand_up_command('prefill', {facility_id}) returns it for the facility's
--     open reporting period, with the facility's Stand Up authority.
--
--   * One version of Monday's numbers: stand_up_command('submitted_latest')
--     returns what each readable facility last submitted. The Executive Stand
--     Up pack reads Monday's figures from it instead of computing its own.
--
--   * public.stand_up_prefill_confirmations: on every save of the open
--     reporting period the server recomputes the prefill and records, per
--     figure other than census and hospital (which keep their roster
--     confirmation), whether the saved figure is Haven's (haven_confirmed),
--     differs (overridden, with the reason chosen) or had nothing to compare
--     with (entered_no_source). Submitting a figure that differs from Haven
--     needs a reason; a draft may be saved first. Historical corrections and
--     imports record nothing, as for the roster.
--
-- Nothing here is read by the Front Office publisher, the history publisher or
-- the Google export: Monday's published rows are unchanged in shape and value.
-- The confirmation is written by haven.stand_up_roster_confirm, which
-- stand_up_save already calls on exactly the open-period, no-batch saves;
-- migration 404's text is kept and the prefill step added after it.
BEGIN;

CREATE TABLE public.stand_up_prefill_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 report_id uuid NOT NULL REFERENCES public.stand_up_reports(id),
 revision_id uuid NOT NULL REFERENCES public.stand_up_revisions(id),
 field_key text NOT NULL,
 haven_value bigint CHECK (haven_value IS NULL OR haven_value >= 0),
 confirmed_value numeric NOT NULL CHECK (confirmed_value >= 0),
 source text NOT NULL CHECK (source IN ('haven_confirmed','overridden','entered_no_source')),
 override_reason text CHECK (override_reason IS NULL OR override_reason IN ('haven_not_current','counted_differently','other')),
 haven_source text,
 computed_at timestamptz NOT NULL,
 confirmed_by uuid NOT NULL,
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((source = 'entered_no_source') = (haven_value IS NULL)),
 CHECK (override_reason IS NULL OR source = 'overridden'),
 UNIQUE (revision_id, field_key)
);
CREATE INDEX idx_stand_up_prefill_confirmations_report_id ON public.stand_up_prefill_confirmations(report_id, field_key, confirmed_at DESC);
CREATE INDEX idx_stand_up_prefill_confirmations_facility_id ON public.stand_up_prefill_confirmations(facility_id);
CREATE TRIGGER stand_up_prefill_confirmation_immutable BEFORE UPDATE OR DELETE ON public.stand_up_prefill_confirmations
 FOR EACH ROW EXECUTE FUNCTION haven.stand_up_immutable();
ALTER TABLE public.stand_up_prefill_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stand_up_prefill_confirmations FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.stand_up_prefill_confirmations IS
 'COL-753: what Haven computed and what the administrator saved for each Monday Stand Up figure other than census and hospital (those are stand_up_roster_confirmations), on every open-period revision. Source is decided by the server. Read only through stand_up_command.';

-- ---------------------------------------------------------------------------
-- The prefill
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.stand_up_monday_prefill(p_organization uuid, p_facility uuid, p_week date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 zone text := 'America/New_York';
 week_from timestamptz; week_to timestamptz; last_from timestamptz; last_to timestamptz;
 c record; fields jsonb := '{}'::jsonb; n bigint; has_rows boolean; unclassified integer;
 bed_counts record;
BEGIN
 SELECT coalesce(f.timezone, 'America/New_York') INTO zone FROM public.facilities f WHERE f.id = p_facility;
 zone := coalesce(zone, 'America/New_York');
 -- The meeting week (forecasts) and the completed payroll week before it.
 week_from := p_week::timestamp AT TIME ZONE zone;
 week_to := (p_week + 7)::timestamp AT TIME ZONE zone;
 last_from := (p_week - 7)::timestamp AT TIME ZONE zone;
 last_to := week_from;

 -- Current AR (COL-665): mirrors CURRENT_AR_INVOICE_STATUSES.
 SELECT EXISTS(SELECT 1 FROM public.invoices i WHERE i.organization_id=p_organization AND i.facility_id=p_facility AND i.deleted_at IS NULL) INTO has_rows;
 SELECT coalesce(sum(greatest(i.balance_due, 0)), 0) INTO n FROM public.invoices i
  WHERE i.organization_id=p_organization AND i.facility_id=p_facility AND i.deleted_at IS NULL
    AND i.status IN ('draft','sent','partial','overdue');
 fields := fields || jsonb_build_object('monthly_rent_roll_cents', CASE WHEN has_rows
  THEN jsonb_build_object('value', n, 'source', 'Invoices in Haven: sent with a balance, plus drafts not yet sent')
  ELSE jsonb_build_object('value', NULL, 'source', NULL, 'note', 'Haven has no invoices for this facility') END);

 -- Census and hospital/rehab: the roster suggestion (COL-351).
 SELECT * INTO c FROM public.stand_up_roster_census(p_organization, p_facility);
 fields := fields || CASE WHEN c.resident_count_in_haven > 0 THEN jsonb_build_object(
   'current_total_census', jsonb_build_object('value', c.roster_census_count, 'source', 'Resident roster: in house, at hospital or rehab, and on leave'),
   'hospital_and_rehab_total', jsonb_build_object('value', c.hospital_hold_count, 'source', 'Resident roster: bed-hold stays at a hospital or in rehab'))
  ELSE jsonb_build_object(
   'current_total_census', jsonb_build_object('value', NULL, 'source', NULL, 'note', 'No residents in Haven for this facility'),
   'hospital_and_rehab_total', jsonb_build_object('value', NULL, 'source', NULL, 'note', 'No residents in Haven for this facility')) END;

 -- Open beds by Stand Up class.
 SELECT count(*) AS beds,
   count(*) FILTER (WHERE b.current_resident_id IS NULL AND NOT coalesce(b.is_temporarily_blocked,false) AND b.status='available' AND b.standup_availability_class IS NULL) AS unclassified,
   count(*) FILTER (WHERE b.current_resident_id IS NULL AND NOT coalesce(b.is_temporarily_blocked,false) AND b.status='available' AND b.standup_availability_class='sp_female') AS sp_female,
   count(*) FILTER (WHERE b.current_resident_id IS NULL AND NOT coalesce(b.is_temporarily_blocked,false) AND b.status='available' AND b.standup_availability_class='sp_male') AS sp_male,
   count(*) FILTER (WHERE b.current_resident_id IS NULL AND NOT coalesce(b.is_temporarily_blocked,false) AND b.status='available' AND b.standup_availability_class='sp_flexible') AS sp_flexible,
   count(*) FILTER (WHERE b.current_resident_id IS NULL AND NOT coalesce(b.is_temporarily_blocked,false) AND b.status='available' AND b.standup_availability_class='private') AS private
 INTO bed_counts
 FROM public.beds b WHERE b.organization_id=p_organization AND b.facility_id=p_facility AND b.deleted_at IS NULL;
 fields := fields || CASE
  WHEN bed_counts.beds = 0 THEN jsonb_build_object(
   'sp_female_beds_open', jsonb_build_object('value', NULL, 'source', NULL, 'note', 'Haven has no beds for this facility'),
   'sp_male_beds_open', jsonb_build_object('value', NULL, 'source', NULL, 'note', 'Haven has no beds for this facility'),
   'sp_flexible_beds_open', jsonb_build_object('value', NULL, 'source', NULL, 'note', 'Haven has no beds for this facility'),
   'private_beds_open', jsonb_build_object('value', NULL, 'source', NULL, 'note', 'Haven has no beds for this facility'))
  WHEN bed_counts.unclassified > 0 THEN jsonb_build_object(
   'sp_female_beds_open', jsonb_build_object('value', NULL, 'source', NULL, 'note', bed_counts.unclassified||' open bed(s) have no Stand Up class, so the counts would miss them'),
   'sp_male_beds_open', jsonb_build_object('value', NULL, 'source', NULL, 'note', bed_counts.unclassified||' open bed(s) have no Stand Up class, so the counts would miss them'),
   'sp_flexible_beds_open', jsonb_build_object('value', NULL, 'source', NULL, 'note', bed_counts.unclassified||' open bed(s) have no Stand Up class, so the counts would miss them'),
   'private_beds_open', jsonb_build_object('value', NULL, 'source', NULL, 'note', bed_counts.unclassified||' open bed(s) have no Stand Up class, so the counts would miss them'))
  ELSE jsonb_build_object(
   'sp_female_beds_open', jsonb_build_object('value', bed_counts.sp_female, 'source', 'Beds in Haven: available and unoccupied, by Stand Up class'),
   'sp_male_beds_open', jsonb_build_object('value', bed_counts.sp_male, 'source', 'Beds in Haven: available and unoccupied, by Stand Up class'),
   'sp_flexible_beds_open', jsonb_build_object('value', bed_counts.sp_flexible, 'source', 'Beds in Haven: available and unoccupied, by Stand Up class'),
   'private_beds_open', jsonb_build_object('value', bed_counts.private, 'source', 'Beds in Haven: available and unoccupied, by Stand Up class')) END;

 -- Expected admissions and discharges for the meeting week.
 SELECT count(*) INTO n FROM public.admission_cases a
  WHERE a.organization_id=p_organization AND a.facility_id=p_facility AND a.deleted_at IS NULL
    AND a.status NOT IN ('cancelled') AND a.actual_arrival_at IS NULL
    AND a.target_move_in_date BETWEEN p_week AND p_week + 6;
 fields := fields || jsonb_build_object('admissions_expected', jsonb_build_object('value', n, 'source', 'Admission cases with a target move-in this week, not yet arrived'));
 SELECT count(*) INTO n FROM public.residents r
  WHERE r.organization_id=p_organization AND r.facility_id=p_facility AND r.deleted_at IS NULL
    AND r.status IN ('active','hospital_hold','loa') AND r.discharge_target_date BETWEEN p_week AND p_week + 6;
 fields := fields || jsonb_build_object('expected_discharges', jsonb_build_object('value', n, 'source', 'Residents with a discharge target date this week'));

 -- The completed payroll week.
 SELECT EXISTS(SELECT 1 FROM public.staff_attendance_events e WHERE e.organization_id=p_organization AND e.facility_id=p_facility AND e.deleted_at IS NULL) INTO has_rows;
 SELECT count(*) INTO n FROM public.staff_attendance_events e
  WHERE e.organization_id=p_organization AND e.facility_id=p_facility AND e.deleted_at IS NULL
    AND e.event_type IN ('callout','late_callout','no_show') AND e.occurred_at >= last_from AND e.occurred_at < last_to;
 fields := fields || jsonb_build_object('callouts_last_week', CASE WHEN has_rows
  THEN jsonb_build_object('value', n, 'source', 'Attendance records: callouts, late callouts and no-shows last week')
  ELSE jsonb_build_object('value', NULL, 'source', NULL, 'note', 'Haven has no attendance records for this facility') END);
 SELECT EXISTS(SELECT 1 FROM public.staff s WHERE s.organization_id=p_organization AND s.facility_id=p_facility AND s.deleted_at IS NULL) INTO has_rows;
 SELECT count(*) INTO n FROM public.staff s
  WHERE s.organization_id=p_organization AND s.facility_id=p_facility AND s.deleted_at IS NULL
    AND s.termination_date BETWEEN p_week - 7 AND p_week - 1;
 fields := fields || jsonb_build_object('terminations_last_week', CASE WHEN has_rows
  THEN jsonb_build_object('value', n, 'source', 'Staff records: termination dates last week')
  ELSE jsonb_build_object('value', NULL, 'source', NULL, 'note', 'Haven has no staff records for this facility') END);
 fields := fields || jsonb_build_object(
  'current_open_positions', jsonb_build_object('value', NULL, 'source', NULL, 'note', 'Haven does not record how many positions each facility is budgeted for'),
  'overtime_reported', jsonb_build_object('value', NULL, 'source', NULL, 'note', 'Haven has no approved time source to count overtime from'));

 -- Marketing for the meeting week.
 SELECT count(*) INTO n FROM public.referral_tours t
  WHERE t.organization_id=p_organization AND t.facility_id=p_facility AND t.deleted_at IS NULL
    AND t.outcome NOT IN ('cancelled','rescheduled') AND t.scheduled_for >= week_from AND t.scheduled_for < week_to;
 fields := fields || jsonb_build_object('tours_expected', jsonb_build_object('value', n, 'source', 'Tour records scheduled this week'));
 SELECT count(*) INTO n FROM public.referral_outreach_activities o
  WHERE o.organization_id=p_organization AND o.facility_id=p_facility AND o.deleted_at IS NULL
    AND o.status <> 'cancelled' AND o.activity_type = 'home_health_provider'
    AND (o.performed_for_week = p_week OR (o.scheduled_for >= week_from AND o.scheduled_for < week_to));
 fields := fields || jsonb_build_object('provider_activities_expected', jsonb_build_object('value', n, 'source', 'Outreach calendar: home-health provider activities this week'));
 SELECT count(*) INTO n FROM public.referral_outreach_activities o
  WHERE o.organization_id=p_organization AND o.facility_id=p_facility AND o.deleted_at IS NULL
    AND o.status <> 'cancelled' AND o.activity_type IN ('provider_visit','facility_outreach','community_event')
    AND (o.performed_for_week = p_week OR (o.scheduled_for >= week_from AND o.scheduled_for < week_to));
 fields := fields || jsonb_build_object('outreach_engagements', jsonb_build_object('value', n, 'source', 'Outreach calendar: in-person provider, facility and event outreach this week'));

 RETURN jsonb_build_object('facility_id', p_facility, 'week_start', p_week, 'computed_at', clock_timestamp(), 'fields', fields);
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_monday_prefill(uuid,uuid,date) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION haven.stand_up_monday_prefill(uuid,uuid,date) IS
 'COL-753: every Monday Stand Up figure Haven can compute for one facility and meeting week, with its source and computed time; a figure Haven cannot compute is null with the reason. Current AR mirrors CURRENT_AR_INVOICE_STATUSES (src/lib/billing/receivables.ts). Reached through stand_up_command(''prefill'') and the save path only.';

-- The prefill an administrator sees, for the facility's open reporting period.
CREATE FUNCTION haven.stand_up_prefill_for(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid := (p_payload->>'facility_id')::uuid; o uuid;
BEGIN
 IF f IS NULL THEN RAISE EXCEPTION 'Facility required'; END IF;
 o := haven.stand_up_assert(f);
 RETURN haven.stand_up_monday_prefill(o, f, haven.stand_up_open_week(f));
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_prefill_for(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- What was recorded for one revision, keyed by figure.
CREATE FUNCTION haven.stand_up_prefill_confirmations(p_revision uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(c.field_key, jsonb_build_object('source', c.source, 'haven_value', c.haven_value, 'confirmed', c.confirmed_value,
   'override_reason', c.override_reason, 'haven_source', c.haven_source, 'computed_at', c.computed_at, 'confirmed_at', c.confirmed_at)), '{}'::jsonb)
 FROM public.stand_up_prefill_confirmations c WHERE c.revision_id = p_revision
$$;
REVOKE ALL ON FUNCTION haven.stand_up_prefill_confirmations(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- One version of Monday's numbers: what each facility last submitted
-- ---------------------------------------------------------------------------
-- The Executive Stand Up pack reads Monday's figures from here instead of
-- computing its own (COL-753 "Retire the old pack"). For each facility the
-- caller may read, the latest submitted revision of the most recent Monday
-- report up to the open reporting period: its week, when it was submitted and
-- its values. Owner, org_admin and facility_admin, as for every Monday read.
CREATE FUNCTION haven.stand_up_submitted_latest(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; o uuid; r text; f uuid := (p_payload->>'facility_id')::uuid;
BEGIN
 SELECT actor_user_id,actor_organization_id,actor_app_role::text INTO a,o,r FROM haven.current_authorized_actor() WHERE actor_is_managed;
 IF a IS NULL OR r NOT IN ('owner','org_admin','facility_admin') THEN RAISE EXCEPTION 'Stand Up access denied' USING ERRCODE='42501'; END IF;
 RETURN coalesce((
  SELECT jsonb_agg(jsonb_build_object('facility_id',x.facility_id,'week_start',x.week_start,'revision_id',x.revision_id,
    'submitted_at',x.created_at,'values',x.values) ORDER BY x.facility_id)
  FROM (
   SELECT DISTINCT ON (rp.facility_id) rp.facility_id, rp.week_start, v.id AS revision_id, v.created_at, v.values
   FROM public.stand_up_reports rp
   JOIN public.facilities fa ON fa.id=rp.facility_id AND fa.organization_id=o AND fa.deleted_at IS NULL
   JOIN public.stand_up_revisions v ON v.report_id=rp.id AND v.status='ready'
   WHERE rp.organization_id=o AND haven.has_facility_access(rp.facility_id)
     AND (f IS NULL OR rp.facility_id=f)
     AND rp.week_start<=haven.stand_up_open_week(rp.facility_id)
   ORDER BY rp.facility_id, rp.week_start DESC, v.version DESC
  ) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_submitted_latest(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Recording it on save: migration 404's roster confirmation, then the prefill.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.stand_up_roster_confirm(p jsonb, p_organization uuid, p_facility uuid, p_actor uuid, p_report uuid, p_revision uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE roster jsonb:=p->'roster'; c record; k text; v jsonb; entry jsonb; reason text; suggested integer; confirmed integer; src text;
 prefill jsonb; given jsonb; field jsonb; haven_value bigint; typed numeric; week date;
BEGIN
 IF roster IS NULL THEN RETURN; END IF;
 IF jsonb_typeof(roster)<>'object' THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(roster) x WHERE x<>ALL(haven.stand_up_roster_keys())) THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
 SELECT * INTO c FROM public.stand_up_roster_census(p_organization,p_facility);
 FOREACH k IN ARRAY haven.stand_up_roster_keys() LOOP
  v:=p->'values'->k;
  IF v IS NULL OR v='null'::jsonb THEN CONTINUE; END IF; -- a blank figure confirms nothing
  entry:=roster->k;
  IF entry IS NOT NULL AND jsonb_typeof(entry)<>'object' THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
  reason:=nullif(btrim(coalesce(entry->>'override_reason','')),'');
  IF reason IS NOT NULL AND reason NOT IN('roster_not_current','change_not_entered','different_definition','other') THEN RAISE EXCEPTION 'Invalid override reason'; END IF;
  confirmed:=(v#>>'{}')::numeric::integer;
  suggested:=CASE WHEN c.resident_count_in_haven=0 THEN NULL WHEN k='current_total_census' THEN c.roster_census_count ELSE c.hospital_hold_count END;
  src:=CASE WHEN suggested IS NULL THEN 'entered_no_roster' WHEN confirmed=suggested THEN 'roster_confirmed' ELSE 'overridden' END;
  IF src='overridden' AND reason IS NULL THEN
   RAISE EXCEPTION '% differs from the Haven roster (%). Choose why it is different or use the roster figure.',
    CASE WHEN k='current_total_census' THEN 'Current census' ELSE 'Residents at hospital or rehab' END,suggested USING ERRCODE='22023';
  END IF;
  IF src<>'overridden' THEN reason:=NULL; END IF;
  INSERT INTO public.stand_up_roster_confirmations(organization_id,facility_id,report_id,revision_id,field_key,roster_suggested_value,confirmed_value,source,override_reason,roster_as_of,confirmed_by)
  VALUES(p_organization,p_facility,p_report,p_revision,k,suggested,confirmed,src,reason,c.roster_as_of,p_actor);
 END LOOP;

 -- COL-753: every other figure against Haven's own, recomputed here.
 given:=coalesce(p->'prefill','{}'::jsonb);
 IF jsonb_typeof(given)<>'object' THEN RAISE EXCEPTION 'Invalid prefill confirmation'; END IF;
 SELECT r.week_start INTO week FROM public.stand_up_reports r WHERE r.id=p_report;
 prefill:=haven.stand_up_monday_prefill(p_organization,p_facility,week);
 FOR k IN SELECT jsonb_object_keys(prefill->'fields') LOOP
  IF k=ANY(haven.stand_up_roster_keys()) THEN CONTINUE; END IF;
  v:=p->'values'->k;
  IF v IS NULL OR v='null'::jsonb THEN CONTINUE; END IF;
  field:=prefill->'fields'->k;
  haven_value:=CASE WHEN field->'value' IS NULL OR field->'value'='null'::jsonb THEN NULL ELSE (field->>'value')::bigint END;
  typed:=(v#>>'{}')::numeric;
  entry:=given->k;
  IF entry IS NOT NULL AND jsonb_typeof(entry)<>'object' THEN RAISE EXCEPTION 'Invalid prefill confirmation'; END IF;
  reason:=nullif(btrim(coalesce(entry->>'override_reason','')),'');
  IF reason IS NOT NULL AND reason NOT IN('haven_not_current','counted_differently','other') THEN RAISE EXCEPTION 'Invalid override reason'; END IF;
  src:=CASE WHEN haven_value IS NULL THEN 'entered_no_source' WHEN typed=haven_value THEN 'haven_confirmed' ELSE 'overridden' END;
  IF src='overridden' AND reason IS NULL AND coalesce(p->>'status','draft')='ready' THEN
   RAISE EXCEPTION '% differs from Haven (%). Choose why it is different or use Haven''s figure.',
    CASE k WHEN 'monthly_rent_roll_cents' THEN 'Monthly rent roll' WHEN 'sp_female_beds_open' THEN 'Semi-private female beds open'
      WHEN 'sp_male_beds_open' THEN 'Semi-private male beds open' WHEN 'sp_flexible_beds_open' THEN 'Semi-private flexible beds open'
      WHEN 'private_beds_open' THEN 'Private beds open' WHEN 'admissions_expected' THEN 'Expected admissions this week'
      WHEN 'expected_discharges' THEN 'Expected discharges this week' WHEN 'callouts_last_week' THEN 'Callouts last week'
      WHEN 'terminations_last_week' THEN 'Terminations last week' WHEN 'tours_expected' THEN 'Expected tours this week'
      WHEN 'provider_activities_expected' THEN 'Home-health activities this week' WHEN 'outreach_engagements' THEN 'Outreach and engagements this week'
      ELSE k END,
    CASE WHEN k='monthly_rent_roll_cents' THEN to_char(haven_value/100.0,'FM$999,999,990.00') ELSE haven_value::text END
    USING ERRCODE='22023';
  END IF;
  IF src<>'overridden' THEN reason:=NULL; END IF;
  INSERT INTO public.stand_up_prefill_confirmations(organization_id,facility_id,report_id,revision_id,field_key,haven_value,confirmed_value,source,override_reason,haven_source,computed_at,confirmed_by)
  VALUES(p_organization,p_facility,p_report,p_revision,k,haven_value,typed,src,reason,field->>'source',(prefill->>'computed_at')::timestamptz,p_actor);
 END LOOP;
END $function$;
REVOKE ALL ON FUNCTION haven.stand_up_roster_confirm(jsonb,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- stand_up_command: migration 517's text plus 'prefill' and the recorded
-- prefill confirmations on reports and save receipts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.stand_up_command(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; reports jsonb; facilities jsonb; organization uuid;
BEGIN
 -- COL-752: the meeting schedule, and every meeting other than Monday, have
 -- their own command. A payload naming Monday runs the Monday path unchanged,
 -- with the key removed so receipts and results are exactly what they were.
 IF p_action='set_meeting_schedule' THEN RETURN haven.stand_up_set_meeting_schedule(p_payload); END IF;
 IF p_payload ? 'meeting_day' THEN
  IF p_payload->>'meeting_day' IS DISTINCT FROM 'monday' THEN RETURN haven.stand_up_meeting_command(p_action,p_payload); END IF;
  p_payload:=p_payload-'meeting_day';
 END IF;
 IF p_action='prefill' THEN RETURN haven.stand_up_prefill_for(p_payload); END IF;
 IF p_action='submitted_latest' THEN RETURN haven.stand_up_submitted_latest(p_payload); END IF;
 IF p_action='set_entry_window' THEN RETURN haven.stand_up_set_entry_window(p_payload); END IF;
 IF p_action='reverse_import' THEN RETURN haven.stand_up_reverse_import(p_payload); END IF;
 IF p_action='revisions' THEN RETURN haven.stand_up_revision_history(p_payload); END IF;
 IF p_action='post_submit_changes' THEN RETURN haven.stand_up_post_submit_history(p_payload); END IF;
 IF p_action='roster' THEN RETURN haven.stand_up_roster_suggestion(p_payload); END IF;
 result:=haven.stand_up_command_v1(p_action,p_payload);
 IF p_action IN('workspace','list') THEN
  organization:=haven.organization_id();
  SELECT coalesce(jsonb_agg(x||haven.stand_up_submission_metadata((x->>'revision_id')::uuid)
    ||jsonb_build_object('prefill_confirmations',haven.stand_up_prefill_confirmations((x->>'revision_id')::uuid)) ORDER BY x->>'week_start' DESC,x->>'facility_id'),'[]') INTO reports FROM jsonb_array_elements(result->'reports') x;
  SELECT coalesce(jsonb_agg(y||jsonb_build_object(
    'entry_open_lead_minutes',(SELECT s.entry_open_lead_minutes FROM public.stand_up_facility_settings s WHERE s.facility_id=(y->>'id')::uuid),
    'open_week',haven.stand_up_open_week((y->>'id')::uuid),
    'entry_opens_at',haven.stand_up_entry_opens_at((y->>'id')::uuid,haven.stand_up_open_week((y->>'id')::uuid))
   ) ORDER BY y->>'name'),'[]') INTO facilities FROM jsonb_array_elements(result->'facilities') y;
  RETURN result||jsonb_build_object(
   'reports',reports,
   'facilities',facilities,
   'server_now',clock_timestamp(),
   'actor_role',haven.app_role()::text,
   'can_edit_submitted',haven.app_role()::text IN('owner','org_admin','facility_admin'),
   'google_connection',haven.stand_up_google_health(organization)
  );
 ELSIF p_action IN('save','commit_recovery') THEN
  RETURN result||haven.stand_up_submission_metadata((result->>'revision_id')::uuid)
   ||jsonb_build_object('prefill_confirmations',haven.stand_up_prefill_confirmations((result->>'revision_id')::uuid));
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_command(text,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION haven.stand_up_command(text,jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: restore migration 517's haven.stand_up_command and migration 404's
-- haven.stand_up_roster_confirm, then DROP FUNCTION haven.stand_up_submitted_latest(jsonb),
-- haven.stand_up_prefill_confirmations(uuid), haven.stand_up_prefill_for(jsonb),
-- haven.stand_up_monday_prefill(uuid,uuid,date) and TABLE
-- public.stand_up_prefill_confirmations (append-only evidence; export it first).
