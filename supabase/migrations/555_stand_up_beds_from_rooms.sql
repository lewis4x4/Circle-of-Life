-- COL-374 / DEC-2026-09-22-01: the four Stand Up bed figures are suggested from
-- Haven's rooms, beds and residents and confirmed by the administrator, exactly
-- like census and hospital (COL-351, migration 404; enforced by 457).
--
-- Why: the facility typed these four numbers, and the stored
-- beds.standup_availability_class (migration 192) froze a room as "female"
-- because of whoever was in it last. Michelle Norris, 2026-09-22: an empty
-- single or double room takes a man or a woman; a bed is female or male only
-- while a woman or a man holds another bed in that room.
--
-- Rules (mirror of src/lib/stand-up/bed-classification.ts; one shared fixture,
-- supabase/tests/review_stand_up_roster_beds.sql):
--   held      a resident with status IN('active','hospital_hold','loa') is
--             attached to the bed (residents.bed_id or beds.current_resident_id),
--             or the bed points at a resident the caller cannot see
--   reserved  not held, and bed status 'hold' or a pending_admission resident
--             is attached (DEC-2026-09-21-03: a reserved bed is not open)
--   open      neither. Out of service (status IN('maintenance','offline') or
--             is_temporarily_blocked) IS open (DEC-2026-09-21-03) and is also
--             counted in out_of_service_open
--   category  private room -> private; otherwise the sex of everyone holding
--             or reserved for the room's other beds: nobody -> flexible, all
--             women -> female, all men -> male, anything else -> unclassified
-- Counts only; no resident name, room number or id leaves this migration.
BEGIN;

CREATE FUNCTION public.stand_up_roster_beds(p_organization_id uuid,p_facility_id uuid)
RETURNS TABLE(sp_female_open integer,sp_male_open integer,sp_flexible_open integer,private_open integer,unclassified_open integer,out_of_service_open integer,reserved_count integer,bed_count_in_haven integer,beds_as_of timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH b AS (
  SELECT b.id,b.room_id,b.status::text AS status,b.current_resident_id,coalesce(b.is_temporarily_blocked,false) AS blocked,rm.room_type::text AS room_type,b.updated_at
  FROM public.beds b JOIN public.rooms rm ON rm.id=b.room_id AND rm.deleted_at IS NULL
  WHERE b.organization_id=p_organization_id AND b.facility_id=p_facility_id AND b.deleted_at IS NULL
 ), res AS (
  SELECT r.id,r.bed_id,r.status::text AS status,r.gender::text AS gender FROM public.residents r
  WHERE r.organization_id=p_organization_id AND r.facility_id=p_facility_id AND r.deleted_at IS NULL
 ), occ AS (
  SELECT b.id AS bed_id,x.status,x.gender FROM b JOIN res x ON x.bed_id=b.id OR x.id=b.current_resident_id
 ), st AS (
  -- A duplicated assignment cannot pick one person's sex. Every attached
  -- holder/reservation must agree; an unseen pointer keeps the holder unknown.
  SELECT b.*,
   (EXISTS(SELECT 1 FROM occ o WHERE o.bed_id=b.id AND o.status IN('active','hospital_hold','loa'))
    OR (b.current_resident_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM res x WHERE x.id=b.current_resident_id))) AS held,
   CASE WHEN b.current_resident_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM res x WHERE x.id=b.current_resident_id) THEN 'unknown'
    ELSE (SELECT CASE WHEN bool_and(coalesce(o.gender='female',false)) THEN 'female'
      WHEN bool_and(coalesce(o.gender='male',false)) THEN 'male' ELSE 'unknown' END
     FROM occ o WHERE o.bed_id=b.id AND o.status IN('active','hospital_hold','loa')) END AS holder_gender,
   EXISTS(SELECT 1 FROM occ o WHERE o.bed_id=b.id AND o.status='pending_admission') AS has_reservation,
   (SELECT CASE WHEN bool_and(coalesce(o.gender='female',false)) THEN 'female'
     WHEN bool_and(coalesce(o.gender='male',false)) THEN 'male' ELSE 'unknown' END
    FROM occ o WHERE o.bed_id=b.id AND o.status='pending_admission') AS reserved_gender
  FROM b
 ), s AS (
  SELECT st.*,(NOT held AND (status='hold' OR has_reservation)) AS reserved FROM st
 ), sx AS (
  SELECT s.*,CASE
    WHEN held THEN CASE WHEN holder_gender IN('female','male') THEN holder_gender ELSE 'unknown' END
    WHEN reserved THEN CASE WHEN reserved_gender IN('female','male') THEN reserved_gender ELSE 'unknown' END
   END AS sex FROM s
 ), open_beds AS (
  SELECT o.*,
   (o.status IN('maintenance','offline') OR o.blocked) AS out_of_service,
   CASE
    WHEN o.room_type='private' THEN 'private'
    WHEN NOT EXISTS(SELECT 1 FROM sx m WHERE m.room_id=o.room_id AND m.id<>o.id AND m.sex IS NOT NULL) THEN 'flexible'
    WHEN NOT EXISTS(SELECT 1 FROM sx m WHERE m.room_id=o.room_id AND m.id<>o.id AND m.sex IS NOT NULL AND m.sex<>'female') THEN 'female'
    WHEN NOT EXISTS(SELECT 1 FROM sx m WHERE m.room_id=o.room_id AND m.id<>o.id AND m.sex IS NOT NULL AND m.sex<>'male') THEN 'male'
    ELSE 'unclassified'
   END AS category
  FROM sx o WHERE NOT o.held AND NOT o.reserved
 )
 SELECT
  (SELECT count(*) FROM open_beds WHERE category='female')::integer,
  (SELECT count(*) FROM open_beds WHERE category='male')::integer,
  (SELECT count(*) FROM open_beds WHERE category='flexible')::integer,
  (SELECT count(*) FROM open_beds WHERE category='private')::integer,
  (SELECT count(*) FROM open_beds WHERE category='unclassified')::integer,
  (SELECT count(*) FROM open_beds WHERE out_of_service)::integer,
  (SELECT count(*) FROM s WHERE reserved)::integer,
  (SELECT count(*) FROM b)::integer,
  (SELECT max(updated_at) FROM b)
$$;
REVOKE ALL ON FUNCTION public.stand_up_roster_beds(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stand_up_roster_beds(uuid,uuid) TO authenticated,service_role;
COMMENT ON FUNCTION public.stand_up_roster_beds(uuid,uuid) IS 'COL-374: open beds per Stand Up category from rooms, beds and who holds or is reserved for them now. Reserved beds are not open; out-of-service beds are open and also counted separately; beds Haven cannot place are unclassified. Counts only. Mirror: src/lib/stand-up/bed-classification.ts.';

-- The four bed figures join census and hospital as roster-confirmed figures.
ALTER TABLE public.stand_up_roster_confirmations DROP CONSTRAINT stand_up_roster_confirmations_field_key_check;
ALTER TABLE public.stand_up_roster_confirmations ADD CONSTRAINT stand_up_roster_confirmations_field_key_check
 CHECK(field_key IN('current_total_census','hospital_and_rehab_total','sp_female_beds_open','sp_male_beds_open','sp_flexible_beds_open','private_beds_open'));

CREATE OR REPLACE FUNCTION haven.stand_up_roster_keys() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['current_total_census','hospital_and_rehab_total','sp_female_beds_open','sp_male_beds_open','sp_flexible_beds_open','private_beds_open']::text[]
$$;

CREATE OR REPLACE FUNCTION haven.stand_up_roster_label(k text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE k WHEN 'current_total_census' THEN 'Current census' WHEN 'hospital_and_rehab_total' THEN 'Residents at hospital or rehab'
  WHEN 'sp_female_beds_open' THEN 'Semi-private female beds open' WHEN 'sp_male_beds_open' THEN 'Semi-private male beds open'
  WHEN 'sp_flexible_beds_open' THEN 'Semi-private flexible beds open' WHEN 'private_beds_open' THEN 'Private beds open' END
$$;

-- Same contract as migration 404: the server recomputes every suggestion at
-- save time and decides the source; a client reason is kept only when the saved
-- figure differs. A facility with no beds in Haven records entered_no_roster
-- for the bed figures, just as one with no residents does for census.
CREATE OR REPLACE FUNCTION haven.stand_up_roster_confirm(p jsonb, p_organization uuid, p_facility uuid, p_actor uuid, p_report uuid, p_revision uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE roster jsonb:=p->'roster'; c record; bd record; asof timestamptz; k text; v jsonb; entry jsonb; reason text; suggested integer; confirmed integer; src text;
 prefill jsonb; given jsonb; field jsonb; haven_value bigint; typed numeric; week date; reason_label text;
BEGIN
 IF roster IS NULL THEN RETURN; END IF;
 IF jsonb_typeof(roster)<>'object' THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(roster) x WHERE x<>ALL(haven.stand_up_roster_keys())) THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
 SELECT * INTO c FROM public.stand_up_roster_census(p_organization,p_facility);
 SELECT * INTO bd FROM public.stand_up_roster_beds(p_organization,p_facility);
 FOREACH k IN ARRAY haven.stand_up_roster_keys() LOOP
  v:=p->'values'->k;
  IF v IS NULL OR v='null'::jsonb THEN CONTINUE; END IF; -- a blank figure confirms nothing
  entry:=roster->k;
  IF entry IS NOT NULL AND jsonb_typeof(entry)<>'object' THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
  reason:=nullif(btrim(coalesce(entry->>'override_reason','')),'');
  reason_label:=NULL;
  IF reason IS NOT NULL THEN
   reason_label:=haven.stand_up_census_reason_label(p_organization,p_facility,reason,(clock_timestamp() AT TIME ZONE 'America/New_York')::date);
   IF reason_label IS NULL THEN RAISE EXCEPTION 'Invalid override reason' USING ERRCODE='22023'; END IF;
  END IF;
  confirmed:=(v#>>'{}')::numeric::integer;
  IF k IN('current_total_census','hospital_and_rehab_total') THEN
   suggested:=CASE WHEN c.resident_count_in_haven=0 THEN NULL WHEN k='current_total_census' THEN c.roster_census_count ELSE c.hospital_hold_count END;
   asof:=c.roster_as_of;
  ELSE
   suggested:=CASE WHEN bd.bed_count_in_haven=0 THEN NULL
    WHEN k='sp_female_beds_open' THEN bd.sp_female_open WHEN k='sp_male_beds_open' THEN bd.sp_male_open
    WHEN k='sp_flexible_beds_open' THEN bd.sp_flexible_open ELSE bd.private_open END;
   asof:=bd.beds_as_of;
  END IF;
  src:=CASE WHEN suggested IS NULL THEN 'entered_no_roster' WHEN confirmed=suggested THEN 'roster_confirmed' ELSE 'overridden' END;
  IF src='overridden' AND reason IS NULL THEN
   RAISE EXCEPTION '% differs from the Haven roster (%). Choose why it is different or use the roster figure.',
    haven.stand_up_roster_label(k),suggested USING ERRCODE='22023';
  END IF;
  IF src<>'overridden' THEN reason:=NULL; reason_label:=NULL; END IF;
  INSERT INTO public.stand_up_roster_confirmations(organization_id,facility_id,report_id,revision_id,field_key,roster_suggested_value,confirmed_value,source,override_reason,override_reason_label,roster_as_of,confirmed_by)
  VALUES(p_organization,p_facility,p_report,p_revision,k,suggested,confirmed,src,reason,reason_label,asof,p_actor);
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

-- The suggestion now carries the bed counts beside the census counts.
CREATE OR REPLACE FUNCTION haven.stand_up_roster_suggestion(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; o uuid; c record; bd record; split record;
BEGIN
 f:=(p_payload->>'facility_id')::uuid;
 IF f IS NULL THEN RAISE EXCEPTION 'Facility required'; END IF;
 o:=haven.stand_up_assert(f);
 SELECT * INTO c FROM public.stand_up_roster_census(o,f);
 SELECT * INTO bd FROM public.stand_up_roster_beds(o,f);
 SELECT * INTO split FROM public.stand_up_bed_hold_split(o,f,NULL);
 RETURN jsonb_build_object('facility_id',f,'in_house_count',c.in_house_count,'hospital_hold_count',c.hospital_hold_count,'loa_count',c.loa_count,
  'roster_census_count',c.roster_census_count,'resident_count_in_haven',c.resident_count_in_haven,'roster_as_of',c.roster_as_of,
  'hospital_count',split.hospital_count,'rehab_count',split.rehab_count,'bed_hold_type_not_recorded_count',split.type_not_recorded_count,
  'sp_female_open',bd.sp_female_open,'sp_male_open',bd.sp_male_open,'sp_flexible_open',bd.sp_flexible_open,'private_open',bd.private_open,
  'unclassified_open',bd.unclassified_open,'out_of_service_open',bd.out_of_service_open,'reserved_count',bd.reserved_count,
  'bed_count_in_haven',bd.bed_count_in_haven,'beds_as_of',bd.beds_as_of,'server_now',clock_timestamp());
END $$;

-- Thursday still permits unexplained differences in drafts and requires a
-- configured reason on submission. Widen the shared key CHECK before using it.
ALTER TABLE public.stand_up_meeting_roster_confirmations
 DROP CONSTRAINT stand_up_meeting_roster_confirmations_field_key_check;
ALTER TABLE public.stand_up_meeting_roster_confirmations
 ADD CONSTRAINT stand_up_meeting_roster_confirmations_field_key_check
 CHECK(field_key IN('current_total_census','hospital_and_rehab_total','sp_female_beds_open','sp_male_beds_open','sp_flexible_beds_open','private_beds_open'));

CREATE OR REPLACE FUNCTION haven.stand_up_meeting_roster_confirm(p jsonb, p_organization uuid, p_facility uuid, p_actor uuid, p_report uuid, p_revision uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE roster jsonb := coalesce(p -> 'roster', '{}'::jsonb); c record; bd record; asof timestamptz; k text; v jsonb; entry jsonb; reason text; reason_label text;
  suggested integer; confirmed integer; src text; submitting boolean := coalesce(p ->> 'status', 'draft') = 'ready';
BEGIN
  IF jsonb_typeof(roster) <> 'object' THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(roster) x WHERE x <> ALL (haven.stand_up_roster_keys())) THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
  SELECT * INTO c FROM public.stand_up_roster_census(p_organization, p_facility);
  SELECT * INTO bd FROM public.stand_up_roster_beds(p_organization, p_facility);
  FOREACH k IN ARRAY haven.stand_up_roster_keys() LOOP
    v := p -> 'values' -> k;
    IF v IS NULL OR v = 'null'::jsonb THEN CONTINUE; END IF;
    entry := roster -> k;
    IF entry IS NOT NULL AND jsonb_typeof(entry) <> 'object' THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
    reason := nullif(btrim(coalesce(entry ->> 'override_reason', '')), '');
    reason_label := NULL;
    IF reason IS NOT NULL THEN
      reason_label := haven.stand_up_census_reason_label(p_organization, p_facility, reason, (clock_timestamp() AT TIME ZONE 'America/New_York')::date);
      IF reason_label IS NULL THEN RAISE EXCEPTION 'Invalid override reason' USING ERRCODE = '22023'; END IF;
    END IF;
    confirmed := (v #>> '{}')::numeric::integer;
    IF k IN ('current_total_census', 'hospital_and_rehab_total') THEN
      suggested := CASE WHEN c.resident_count_in_haven = 0 THEN NULL WHEN k = 'current_total_census' THEN c.roster_census_count ELSE c.hospital_hold_count END;
      asof := c.roster_as_of;
    ELSE
      suggested := CASE WHEN bd.bed_count_in_haven = 0 THEN NULL
        WHEN k = 'sp_female_beds_open' THEN bd.sp_female_open WHEN k = 'sp_male_beds_open' THEN bd.sp_male_open
        WHEN k = 'sp_flexible_beds_open' THEN bd.sp_flexible_open ELSE bd.private_open END;
      asof := bd.beds_as_of;
    END IF;
    src := CASE WHEN suggested IS NULL THEN 'entered_no_roster' WHEN confirmed = suggested THEN 'roster_confirmed'
      WHEN reason IS NOT NULL THEN 'overridden' ELSE 'differs_unexplained' END;
    IF src = 'differs_unexplained' AND submitting THEN
      RAISE EXCEPTION '% differs from the Haven roster (%). Choose why it is different or use the roster figure.',
        haven.stand_up_roster_label(k), suggested USING ERRCODE = '22023';
    END IF;
    IF src <> 'overridden' THEN reason := NULL; reason_label := NULL; END IF;
    INSERT INTO public.stand_up_meeting_roster_confirmations(organization_id, facility_id, report_id, revision_id, field_key, roster_suggested_value,
      confirmed_value, source, override_reason, override_reason_label, roster_as_of, confirmed_by)
    VALUES (p_organization, p_facility, p_report, p_revision, k, suggested, confirmed, src, reason, reason_label, asof, p_actor);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_meeting_roster_confirm(jsonb, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION haven.stand_up_monday_prefill(p_organization uuid, p_facility uuid, p_week date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 zone text := 'America/New_York';
 week_from timestamptz; week_to timestamptz; last_from timestamptz; last_to timestamptz;
 c record; fields jsonb := '{}'::jsonb; n bigint; has_rows boolean;
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

 -- COL-374: room category follows its current occupants and reservations.
 -- Out-of-service beds are open; unclassified beds are reported separately.
 SELECT * INTO bed_counts FROM public.stand_up_roster_beds(p_organization,p_facility);
 fields := fields || CASE WHEN bed_counts.bed_count_in_haven = 0 THEN jsonb_build_object(
   'sp_female_beds_open', jsonb_build_object('value', NULL, 'source', NULL, 'note', 'Haven has no beds for this facility'),
   'sp_male_beds_open', jsonb_build_object('value', NULL, 'source', NULL, 'note', 'Haven has no beds for this facility'),
   'sp_flexible_beds_open', jsonb_build_object('value', NULL, 'source', NULL, 'note', 'Haven has no beds for this facility'),
   'private_beds_open', jsonb_build_object('value', NULL, 'source', NULL, 'note', 'Haven has no beds for this facility'))
  ELSE jsonb_build_object(
   'sp_female_beds_open', jsonb_build_object('value', bed_counts.sp_female_open, 'source', 'Rooms, beds and current resident roster in Haven'),
   'sp_male_beds_open', jsonb_build_object('value', bed_counts.sp_male_open, 'source', 'Rooms, beds and current resident roster in Haven'),
   'sp_flexible_beds_open', jsonb_build_object('value', bed_counts.sp_flexible_open, 'source', 'Rooms, beds and current resident roster in Haven'),
   'private_beds_open', jsonb_build_object('value', bed_counts.private_open, 'source', 'Rooms, beds and current resident roster in Haven')) END;

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

REVOKE ALL ON FUNCTION haven.stand_up_roster_keys(),haven.stand_up_roster_label(text),haven.stand_up_roster_confirm(jsonb,uuid,uuid,uuid,uuid,uuid),haven.stand_up_roster_suggestion(jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION haven.stand_up_roster_confirm(jsonb,uuid,uuid,uuid,uuid,uuid) IS 'COL-351 + COL-374: records what the roster suggested and what was saved for census, hospital and the four bed figures on one open-period revision. Source decided by the server.';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='beds' AND column_name='standup_availability_class') THEN
  EXECUTE $c$COMMENT ON COLUMN public.beds.standup_availability_class IS 'Superseded by public.stand_up_roster_beds (COL-374, migration 555): the Stand Up category is derived from who is in the room now. Kept for history; nothing should read it for a Stand Up figure.'$c$;
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
-- Rollback: restore migration 521's roster suggestion, 534's Monday
-- confirmation, 535's Thursday confirmation and 522's Monday prefill.
-- Keep both wider field-key CHECKs and all append-only confirmation evidence.
-- Restore two census roster keys only after deploying a compatible application.
-- The derived-bed RPC and label can be dropped after all readers are retired.
