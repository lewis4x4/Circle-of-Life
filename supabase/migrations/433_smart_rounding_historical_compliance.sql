-- Smart Rounding review: preserve historical facility and cadence boundaries.
BEGIN;


CREATE OR REPLACE FUNCTION public.fn_resident_status_history_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, haven
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := COALESCE(NEW.updated_by, NEW.created_by, auth.uid());

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.resident_status_history (
      organization_id,
      facility_id,
      resident_id,
      status,
      effective_from,
      created_by,
      updated_by
    ) VALUES (
      NEW.organization_id,
      NEW.facility_id,
      NEW.id,
      NEW.status,
      COALESCE(NEW.admission_date::timestamp AT TIME ZONE (SELECT COALESCE(timezone,'America/New_York') FROM public.facilities WHERE id=NEW.facility_id), now()),
      v_actor,
      v_actor
    )
    ON CONFLICT (resident_id) WHERE effective_to IS NULL AND deleted_at IS NULL DO NOTHING;

    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status OR OLD.facility_id IS DISTINCT FROM NEW.facility_id THEN
    -- Residents predating history capture still need an outgoing interval.
    INSERT INTO public.resident_status_history(organization_id,facility_id,resident_id,status,effective_from,created_by,updated_by)
    SELECT OLD.organization_id,OLD.facility_id,OLD.id,OLD.status,
      COALESCE(OLD.admission_date::timestamp AT TIME ZONE (SELECT COALESCE(timezone,'America/New_York') FROM public.facilities WHERE id=OLD.facility_id),OLD.created_at),v_actor,v_actor
    WHERE NOT EXISTS(SELECT 1 FROM public.resident_status_history WHERE resident_id=OLD.id AND deleted_at IS NULL);
    UPDATE public.resident_status_history
       SET effective_to = now(),
           updated_at = now(),
           updated_by = v_actor
     WHERE resident_id = NEW.id
       AND effective_to IS NULL
       AND deleted_at IS NULL;

    INSERT INTO public.resident_status_history (
      organization_id,
      facility_id,
      resident_id,
      status,
      effective_from,
      created_by,
      updated_by
    ) VALUES (
      NEW.organization_id,
      NEW.facility_id,
      NEW.id,
      NEW.status,
      now(),
      v_actor,
      v_actor
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_residents_status_history_capture ON public.residents;
CREATE TRIGGER tr_residents_status_history_capture AFTER INSERT OR UPDATE OF status, facility_id ON public.residents
FOR EACH ROW EXECUTE FUNCTION public.fn_resident_status_history_capture();

-- Recover already-recorded facility-only transfers from the immutable audit
-- ledger. Split existing status intervals; never infer a transfer timestamp
-- from today's facility or from a migration deployment time.
DO $backfill$
DECLARE e record; h public.resident_status_history%ROWTYPE; v_end timestamptz;
BEGIN
 FOR e IN SELECT a.record_id AS resident_id,a.created_at AS changed_at,
   (a.old_data->>'facility_id')::uuid AS old_facility,(a.new_data->>'facility_id')::uuid AS new_facility,
   lead(a.created_at) OVER(PARTITION BY a.record_id ORDER BY a.created_at,a.id) AS next_change
 FROM public.audit_log a
 WHERE a.table_name='residents' AND a.action='UPDATE'
   AND a.old_data->>'facility_id' IS NOT NULL AND a.new_data->>'facility_id' IS NOT NULL
   AND a.old_data->>'facility_id' IS DISTINCT FROM a.new_data->>'facility_id'
 ORDER BY a.created_at,a.id LOOP
  SELECT * INTO h FROM public.resident_status_history sh
  WHERE sh.resident_id=e.resident_id AND sh.deleted_at IS NULL
    AND sh.effective_from<=e.changed_at AND (sh.effective_to IS NULL OR sh.effective_to>e.changed_at)
  ORDER BY sh.effective_from DESC LIMIT 1;
  IF h.id IS NOT NULL THEN
   IF h.effective_from<e.changed_at THEN
    v_end:=h.effective_to;
    UPDATE public.resident_status_history SET effective_to=e.changed_at,facility_id=e.old_facility WHERE id=h.id;
    INSERT INTO public.resident_status_history(organization_id,facility_id,resident_id,status,effective_from,effective_to,reason,notes)
    VALUES(h.organization_id,e.new_facility,h.resident_id,h.status,e.changed_at,v_end,'Facility transfer recovered from audit ledger','Historical transfer boundary restored by migration 433');
   ELSE
    UPDATE public.resident_status_history SET facility_id=e.new_facility WHERE id=h.id;
   END IF;
   UPDATE public.resident_status_history SET facility_id=e.new_facility
   WHERE resident_id=e.resident_id AND deleted_at IS NULL AND effective_from>=e.changed_at
     AND (e.next_change IS NULL OR effective_from<e.next_change);
  ELSE
   RAISE WARNING 'Resident % has an audited transfer at % but no covering status history; historical occupancy requires review',e.resident_id,e.changed_at;
  END IF;
 END LOOP;
END;
$backfill$;


-- Effective shift workability, independently of mutable display definitions.
CREATE TABLE public.facility_observation_shift_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 shift_key text NOT NULL,
 enabled boolean NOT NULL,
 effective_from timestamptz NOT NULL,
 effective_to timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
ALTER TABLE public.facility_observation_shift_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY observation_shift_history_select ON public.facility_observation_shift_history FOR SELECT TO authenticated
USING(organization_id=haven.organization_id() AND facility_id IN(SELECT haven.accessible_facility_ids()) AND deleted_at IS NULL);
REVOKE ALL ON public.facility_observation_shift_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.facility_observation_shift_history TO authenticated;
GRANT ALL ON public.facility_observation_shift_history TO service_role;
CREATE UNIQUE INDEX idx_observation_shift_history_current ON public.facility_observation_shift_history(facility_id,shift_key) WHERE effective_to IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_observation_shift_history_lookup ON public.facility_observation_shift_history(facility_id,shift_key,effective_from,effective_to) WHERE deleted_at IS NULL;
CREATE TRIGGER tr_observation_shift_history_audit AFTER INSERT OR UPDATE OR DELETE ON public.facility_observation_shift_history FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
-- Existing configuration is the baseline. It is not a claim about unknown
-- earlier changes; recorded audit transitions below supersede it where present.
INSERT INTO public.facility_observation_shift_history(organization_id,facility_id,shift_key,enabled,effective_from)
SELECT organization_id,facility_id,shift_key,active AND deleted_at IS NULL,'-infinity'::timestamptz FROM public.facility_shift_definitions;
DO $history$
DECLARE e record;
BEGIN
 FOR e IN SELECT a.*,s.organization_id AS shift_org,s.facility_id AS shift_facility,s.shift_key
   FROM public.audit_log a JOIN public.facility_shift_definitions s ON s.id=a.record_id
   WHERE a.table_name='facility_shift_definitions' AND a.action='UPDATE'
     AND (a.old_data->>'active' IS DISTINCT FROM a.new_data->>'active'
       OR a.old_data->>'deleted_at' IS DISTINCT FROM a.new_data->>'deleted_at')
   ORDER BY a.created_at,a.id LOOP
  UPDATE public.facility_observation_shift_history
    SET enabled=COALESCE((e.old_data->>'active')::boolean,false) AND e.old_data->>'deleted_at' IS NULL
    WHERE facility_id=e.shift_facility AND shift_key=e.shift_key AND effective_from='-infinity'::timestamptz AND effective_to IS NULL;
  UPDATE public.facility_observation_shift_history SET effective_to=e.created_at
    WHERE facility_id=e.shift_facility AND shift_key=e.shift_key AND effective_to IS NULL;
  INSERT INTO public.facility_observation_shift_history(organization_id,facility_id,shift_key,enabled,effective_from)
    VALUES(e.shift_org,e.shift_facility,e.shift_key,COALESCE((e.new_data->>'active')::boolean,false) AND e.new_data->>'deleted_at' IS NULL,e.created_at);
 END LOOP;
 -- Several writes in one transaction share now(); the current row is the
 -- authoritative final state at that indistinguishable instant.
 UPDATE public.facility_observation_shift_history h SET enabled=s.active AND s.deleted_at IS NULL
 FROM public.facility_shift_definitions s WHERE s.facility_id=h.facility_id AND s.shift_key=h.shift_key AND h.effective_to IS NULL;
END;
$history$;
CREATE OR REPLACE FUNCTION haven.capture_observation_shift_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $func$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.facility_observation_shift_history(organization_id,facility_id,shift_key,enabled,effective_from)
  VALUES(NEW.organization_id,NEW.facility_id,NEW.shift_key,NEW.active AND NEW.deleted_at IS NULL,now());
 ELSIF OLD.shift_key IS DISTINCT FROM NEW.shift_key OR OLD.active IS DISTINCT FROM NEW.active OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
  UPDATE public.facility_observation_shift_history SET effective_to=now()
  WHERE facility_id=OLD.facility_id AND shift_key=OLD.shift_key AND effective_to IS NULL AND deleted_at IS NULL;
  INSERT INTO public.facility_observation_shift_history(organization_id,facility_id,shift_key,enabled,effective_from)
  VALUES(NEW.organization_id,NEW.facility_id,NEW.shift_key,NEW.active AND NEW.deleted_at IS NULL,now());
 END IF;
 RETURN NEW;
END;
$func$;
REVOKE ALL ON FUNCTION haven.capture_observation_shift_state() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION haven.capture_observation_shift_state() TO service_role;
CREATE TRIGGER tr_observation_shift_state_capture AFTER INSERT OR UPDATE OF active,deleted_at,shift_key ON public.facility_shift_definitions FOR EACH ROW EXECUTE FUNCTION haven.capture_observation_shift_state();

CREATE OR REPLACE FUNCTION haven.guard_observation_shift_key()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $func$
BEGIN
 IF OLD.shift_key IS DISTINCT FROM NEW.shift_key AND EXISTS(
  SELECT 1 FROM public.facility_cadence_windows w JOIN public.facility_cadence_versions v ON v.id=w.cadence_version_id
  WHERE w.facility_id=OLD.facility_id AND w.shift_key=OLD.shift_key AND v.status IN ('active','superseded') AND v.deleted_at IS NULL
 ) THEN
  RAISE EXCEPTION 'A shift key used by effective cadence history is immutable; edit its display label or create a new shift' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END;
$func$;
REVOKE ALL ON FUNCTION haven.guard_observation_shift_key() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS tr_guard_observation_shift_key ON public.facility_shift_definitions;
CREATE TRIGGER tr_guard_observation_shift_key BEFORE UPDATE OF shift_key ON public.facility_shift_definitions FOR EACH ROW EXECUTE FUNCTION haven.guard_observation_shift_key();


CREATE OR REPLACE FUNCTION public.facility_observation_windows_for_date (p_facility_id uuid, p_service_date date)
  RETURNS TABLE (
    cadence_version_id uuid,
    window_key text,
    label text,
    shift_key text,
    due_at_utc timestamptz,
    window_opens_at_utc timestamptz,
    window_closes_at_utc timestamptz)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    w.cadence_version_id,
    w.window_key,
    w.label,
    w.shift_key,
    w.due_at_utc,
    w.window_opens_at_utc,
    w.window_closes_at_utc
  FROM
    public.facilities fac
    JOIN public.facility_cadence_versions v ON v.facility_id = fac.id AND v.deleted_at IS NULL AND v.status IN ('active', 'superseded')
    CROSS JOIN LATERAL public.facility_observation_windows_for_version (fac.id, v.id, p_service_date) w
  WHERE
    fac.id = p_facility_id
    AND fac.deleted_at IS NULL
    AND w.due_at_utc >= v.effective_from
    AND (v.effective_to IS NULL OR w.due_at_utc < v.effective_to);
$func$;

-- Unknown pre-history can be inferred only from the globally first interval.
-- Invoker RLS alone makes a destination's transfer interval look like the first
-- interval by hiding the source building. Return one authorized boolean, never
-- the other building's identity, dates, or status.
CREATE OR REPLACE FUNCTION haven.observation_history_starts_after(p_resident_id uuid,p_facility_id uuid,p_at timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $func$
DECLARE allowed boolean;
BEGIN
 allowed := COALESCE(haven.has_facility_access(p_facility_id),FALSE)
   OR COALESCE(current_setting('role',true)='service_role',FALSE)
   OR (session_user='postgres' AND current_setting('role',true) IN ('none','postgres'));
 IF NOT allowed THEN RETURN FALSE; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.residents r WHERE r.id=p_resident_id AND r.facility_id=p_facility_id AND r.deleted_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM public.resident_status_history h WHERE h.resident_id=p_resident_id AND h.facility_id=p_facility_id AND h.deleted_at IS NULL)
 THEN RETURN FALSE; END IF;
 RETURN EXISTS(SELECT 1 FROM public.resident_status_history h
   WHERE h.resident_id=p_resident_id AND h.facility_id=p_facility_id AND h.deleted_at IS NULL AND h.effective_from>p_at
   AND NOT EXISTS(SELECT 1 FROM public.resident_status_history earlier WHERE earlier.resident_id=p_resident_id AND earlier.deleted_at IS NULL AND earlier.effective_from<h.effective_from));
END;
$func$;
REVOKE ALL ON FUNCTION haven.observation_history_starts_after(uuid,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.observation_history_starts_after(uuid,uuid,timestamptz) TO authenticated,service_role;


CREATE OR REPLACE FUNCTION public.observation_compliance_for_range (p_facility_id uuid, p_from date, p_to date)
  RETURNS TABLE (
    organization_id uuid,
    facility_id uuid,
    resident_id uuid,
    service_date date,
    window_key text,
    window_label text,
    shift_key text,
    cadence_version_id uuid,
    stamped_cadence_version_id uuid,
    projected_cadence_version_id uuid,
    cadence_version_matches_projection boolean,
    no_cadence_in_force boolean,
    due_at_utc timestamptz,
    window_opens_at_utc timestamptz,
    window_closes_at_utc timestamptz,
    task_id uuid,
    task_status text,
    covered_by_monitoring_order_id uuid,
    satisfied_by_log_id uuid,
    satisfied_at timestamptz,
    satisfied_by_monitoring_order_id uuid,
    satisfied boolean,
    absorbed boolean,
    expectation_source text)
  LANGUAGE plpgsql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
#variable_conflict use_column
DECLARE
  v_span integer;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'observation_compliance_for_range requires a from date and a to date'
      USING ERRCODE = '22023';
  END IF;

  IF p_to < p_from THEN
    RAISE EXCEPTION 'observation_compliance_for_range was called with % after %, which would return nothing; a compliance read must not answer an impossible question with silence', p_from, p_to
      USING ERRCODE = '22023';
  END IF;

  v_span := (p_to - p_from) + 1;
  IF v_span > 366 THEN
    RAISE EXCEPTION 'observation_compliance_for_range covers % days; the limit is 366', v_span
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH facility AS (
    SELECT
      f.id,
      f.organization_id AS org_id,
      COALESCE(f.timezone, 'America/New_York') AS tz
    FROM
      public.facilities f
    WHERE
      f.deleted_at IS NULL
      AND (p_facility_id IS NULL
        OR f.id = p_facility_id)
),
spine AS (
  SELECT
    d::date AS the_date
  FROM
    generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') AS d
),
occupancy AS (
 SELECT h.organization_id AS org_id,h.facility_id AS fac_id,h.resident_id AS res_id,s.the_date
 FROM public.resident_status_history h JOIN facility fac ON fac.id=h.facility_id CROSS JOIN spine s
 WHERE h.deleted_at IS NULL AND h.effective_from < ((s.the_date+1)::timestamp AT TIME ZONE fac.tz)
   AND (h.effective_to IS NULL OR h.effective_to > (s.the_date::timestamp AT TIME ZONE fac.tz))
 UNION
 SELECT r.organization_id,r.facility_id,r.id,s.the_date
 FROM public.residents r JOIN facility fac ON fac.id=r.facility_id CROSS JOIN spine s
 WHERE r.admission_date<=s.the_date AND (r.discharge_date IS NULL OR r.discharge_date>=s.the_date)
   AND ((r.status='active' AND NOT EXISTS(SELECT 1 FROM public.resident_status_history h WHERE h.resident_id=r.id AND h.deleted_at IS NULL))
     OR haven.observation_history_starts_after(r.id,r.facility_id,(s.the_date::timestamp AT TIME ZONE fac.tz)))
),
coverage AS (
  SELECT
    org_id,
    fac_id,
    res_id,
    the_date
  FROM
    occupancy
  UNION
  SELECT
    t.organization_id,
    t.facility_id,
    t.resident_id,
    t.service_date
  FROM
    public.resident_observation_tasks t
    JOIN facility fac ON fac.id = t.facility_id
  WHERE
    t.deleted_at IS NULL
    AND t.window_key IS NOT NULL
    AND t.service_date BETWEEN p_from AND p_to
  UNION
  SELECT
    o.organization_id,
    o.facility_id,
    o.resident_id,
    covered_day::date
  FROM
    public.resident_monitoring_orders o
    JOIN facility fac ON fac.id = o.facility_id
    CROSS JOIN LATERAL generate_series(GREATEST(date_trunc('day', o.starts_at AT TIME ZONE fac.tz), p_from::timestamp), LEAST(date_trunc('day', LEAST(haven.monitoring_order_in_force_until (o.status, o.ends_at, o.cancelled_at, o.closed_at), now()) AT TIME ZONE fac.tz), p_to::timestamp), interval '1 day') AS covered_day
  WHERE
    o.deleted_at IS NULL
),
resolved AS (SELECT * FROM coverage
)
SELECT
  r.org_id,
  r.fac_id,
  r.res_id,
  r.the_date,
  w.window_key,
  w.label,
  w.shift_key,
  COALESCE(standard_task.cadence_version_id, w.cadence_version_id),
  standard_task.cadence_version_id,
  public.facility_cadence_in_force(r.fac_id, w.due_at_utc),
  CASE WHEN w.window_key IS NULL THEN
    NULL::boolean
  ELSE
    (standard_task.cadence_version_id IS NULL OR standard_task.cadence_version_id IS NOT DISTINCT FROM public.facility_cadence_in_force(r.fac_id, w.due_at_utc))
  END,
  (w.cadence_version_id IS NULL),
  w.due_at_utc,
  w.window_opens_at_utc,
  w.window_closes_at_utc,
  standard_task.id,
  standard_task.status::text,
  covering_order.id,
  satisfying_log.id,
  satisfying_log.observed_at,
  satisfying_log.monitoring_order_id,
  (satisfying_log.id IS NOT NULL),
  (covering_order.id IS NOT NULL
    AND satisfying_log.monitoring_order_id IS NOT NULL),
  CASE WHEN w.window_key IS NULL THEN
    'no_cadence'
  WHEN covering_order.id IS NOT NULL THEN
    'monitoring_order'
  WHEN standard_task.id IS NOT NULL THEN
    'standard_task'
  WHEN live_shift.shift_key IS NULL THEN
    'orphaned_shift'
  ELSE
    'projected_only'
  END
FROM
  resolved r
  LEFT JOIN LATERAL (
    SELECT DISTINCT ON (candidate.window_key) candidate.cadence_version_id, candidate.window_key,
      candidate.label, candidate.shift_key, candidate.due_at_utc, candidate.window_opens_at_utc, candidate.window_closes_at_utc
    FROM (
      SELECT pw.*, 1 AS priority FROM public.facility_observation_windows_for_date(r.fac_id,r.the_date) pw
      UNION ALL
      SELECT tw.*, 0 AS priority FROM public.resident_observation_tasks stamped
      CROSS JOIN LATERAL public.facility_observation_windows_for_version(r.fac_id,stamped.cadence_version_id,r.the_date) tw
      WHERE stamped.resident_id=r.res_id AND stamped.facility_id=r.fac_id AND stamped.service_date=r.the_date
        AND stamped.deleted_at IS NULL AND stamped.monitoring_order_id IS NULL AND stamped.window_key=tw.window_key
    ) candidate ORDER BY candidate.window_key, candidate.priority, candidate.due_at_utc
  ) w ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      s.shift_key
    FROM
      public.facility_observation_shift_history s
    WHERE
      s.facility_id = r.fac_id
      AND s.shift_key = w.shift_key
      AND s.deleted_at IS NULL
      AND s.enabled AND s.effective_from<=w.due_at_utc AND (s.effective_to IS NULL OR s.effective_to>w.due_at_utc)) live_shift ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      t.id,
      t.status,
      t.cadence_version_id
    FROM
      public.resident_observation_tasks t
    WHERE
      t.resident_id = r.res_id
      AND t.facility_id = r.fac_id
      AND t.service_date = r.the_date
      AND t.window_key = w.window_key
      AND t.monitoring_order_id IS NULL
      AND t.deleted_at IS NULL
    ORDER BY
      (t.status = 'excused'),
      t.due_at
    LIMIT 1) standard_task ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      o.id
    FROM
      public.resident_monitoring_orders o
    WHERE
      o.resident_id = r.res_id
      AND o.facility_id = r.fac_id
      AND o.deleted_at IS NULL
      AND o.starts_at <= w.window_closes_at_utc
      AND haven.monitoring_order_in_force_until (o.status, o.ends_at, o.cancelled_at, o.closed_at) > w.window_opens_at_utc
    ORDER BY
      o.starts_at DESC
    LIMIT 1) covering_order ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      l.id,
      l.observed_at,
      lt.monitoring_order_id
    FROM
      public.resident_observation_logs l
      JOIN public.resident_observation_tasks lt ON lt.id = l.task_id
    WHERE
      l.resident_id = r.res_id
      AND l.facility_id = r.fac_id
      AND l.deleted_at IS NULL
      AND l.observed_at >= w.window_opens_at_utc
      AND l.observed_at <= w.window_closes_at_utc
    ORDER BY
      l.observed_at
    LIMIT 1) satisfying_log ON TRUE
  WHERE
    (EXISTS(SELECT 1 FROM public.resident_status_history h
      WHERE h.resident_id=r.res_id AND h.facility_id=r.fac_id AND h.status='active' AND h.deleted_at IS NULL
      AND (CASE WHEN w.due_at_utc IS NULL THEN
        h.effective_from < ((r.the_date+1)::timestamp AT TIME ZONE (SELECT tz FROM facility WHERE id=r.fac_id))
        AND (h.effective_to IS NULL OR h.effective_to > (r.the_date::timestamp AT TIME ZONE (SELECT tz FROM facility WHERE id=r.fac_id)))
      ELSE h.effective_from<=w.due_at_utc AND (h.effective_to IS NULL OR h.effective_to>w.due_at_utc) END))
     OR (NOT EXISTS(SELECT 1 FROM public.resident_status_history h WHERE h.resident_id=r.res_id AND h.deleted_at IS NULL)
         AND EXISTS(SELECT 1 FROM public.residents present WHERE present.id=r.res_id AND present.facility_id=r.fac_id AND present.status='active'))
     OR haven.observation_history_starts_after(r.res_id,r.fac_id,COALESCE(w.due_at_utc,(r.the_date::timestamp AT TIME ZONE (SELECT tz FROM facility WHERE id=r.fac_id)))))
    OR standard_task.id IS NOT NULL
    OR satisfying_log.id IS NOT NULL
    OR covering_order.id IS NOT NULL
  ORDER BY
    r.fac_id,
    r.the_date,
    r.res_id,
    w.due_at_utc NULLS FIRST;
END;
$func$;

CREATE OR REPLACE FUNCTION public.facility_current_and_next_shift_observation_windows (p_facility_id uuid, p_at timestamptz)
  RETURNS TABLE (
    cadence_version_id uuid,
    window_key text,
    label text,
    shift_key text,
    roster_shift_type public.shift_type,
    shift_service_date date,
    service_date date,
    due_at_utc timestamptz,
    window_opens_at_utc timestamptz,
    window_closes_at_utc timestamptz,
    starts_shift boolean)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  WITH facility AS (
    SELECT
      f.id,
      f.timezone
    FROM
      public.facilities f
    WHERE
      f.id = p_facility_id
      AND f.deleted_at IS NULL
),
nxt AS (
  SELECT
    n.shift_key AS key,
    n.roster_shift_type AS roster_type,
    n.shift_service_date AS service_day,
    n.starts_at_utc,
    n.ends_at_utc
  FROM
    (SELECT * FROM public.facility_shift_window_at(p_facility_id, p_at)
    UNION SELECT * FROM public.facility_next_shift_window(p_facility_id, p_at)) n
),
spanned_date AS (
  SELECT DISTINCT
    d AS local_date
  FROM
    nxt n
    CROSS JOIN facility fac
    CROSS JOIN LATERAL unnest(ARRAY[(n.starts_at_utc AT TIME ZONE fac.timezone)::date, (n.ends_at_utc AT TIME ZONE fac.timezone)::date]) AS d
)
SELECT
  w.cadence_version_id,
  w.window_key,
  w.label,
  w.shift_key,
  n.roster_type,
  n.service_day,
  sd.local_date,
  w.due_at_utc,
  w.window_opens_at_utc,
  w.window_closes_at_utc,
  EXISTS (
    SELECT
      1
    FROM
      public.facility_shift_definitions s
      CROSS JOIN facility fac
    WHERE
      s.facility_id = p_facility_id
      AND s.deleted_at IS NULL
      AND s.active
      AND s.shift_key = w.shift_key
      AND ((sd.local_date + s.starts_at_local) AT TIME ZONE fac.timezone) = w.due_at_utc)
FROM
  nxt n
  CROSS JOIN spanned_date sd
  CROSS JOIN LATERAL public.facility_observation_windows_for_date (p_facility_id, sd.local_date) w
WHERE
  w.shift_key = n.key
  AND w.due_at_utc >= n.starts_at_utc
  AND w.due_at_utc < n.ends_at_utc
  AND w.window_closes_at_utc >= p_at
ORDER BY
  w.due_at_utc;
$func$;

REVOKE ALL ON FUNCTION public.facility_current_and_next_shift_observation_windows(uuid,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_current_and_next_shift_observation_windows(uuid,timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.observation_windows_under_monitoring_order (p_facility_id uuid, p_at timestamptz)
  RETURNS TABLE (
    resident_id uuid,
    window_key text,
    service_date date,
    monitoring_order_id uuid)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    o.resident_id,
    w.window_key,
    w.service_date,
    o.id
  FROM
    public.facility_current_and_next_shift_observation_windows (p_facility_id, p_at) w
    JOIN public.resident_monitoring_orders o ON o.facility_id = p_facility_id
      AND o.status = 'active'
      AND o.deleted_at IS NULL
  WHERE
    haven.monitoring_order_covers_window (o.starts_at, o.ends_at, w.window_opens_at_utc, w.window_closes_at_utc);
$func$;

CREATE OR REPLACE FUNCTION public.observation_escalations_due (p_organization_id uuid, p_facility_id uuid DEFAULT NULL, p_at timestamptz DEFAULT now(), p_limit integer DEFAULT 500)
  RETURNS TABLE (
    task_id uuid,
    organization_id uuid,
    facility_id uuid,
    resident_id uuid,
    escalation_version_id uuid,
    rung_key text,
    label text,
    is_terminal boolean,
    assigned_staff_only boolean,
    channels text[],
    shift_key text,
    window_closes_at timestamptz,
    fire_at timestamptz)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  WITH candidate AS (
    SELECT
      t.id,
      -- Aliased because the function's own OUT parameters carry these names.
      t.organization_id AS task_organization_id,
      t.facility_id AS task_facility_id,
      t.resident_id AS task_resident_id,
      public.observation_task_window_close (t.id) AS closes_at
    FROM
      public.resident_observation_tasks t
    WHERE
      t.organization_id = p_organization_id
      AND (p_facility_id IS NULL OR t.facility_id = p_facility_id)
      AND t.deleted_at IS NULL
      AND t.scheduled_for <= p_at
      AND t.status NOT IN ('completed_on_time', 'completed_late', 'missed', 'excused', 'reassigned')
),
shifted AS (
  SELECT
    c.id,
    c.task_organization_id,
    c.task_facility_id,
    c.task_resident_id,
    c.closes_at,
    sw.shift_key AS shift
  FROM
    candidate c
    LEFT JOIN LATERAL public.facility_shift_window_at (c.task_facility_id, c.closes_at) sw ON TRUE
  WHERE
    c.closes_at IS NOT NULL
)
SELECT
  s.id,
  s.task_organization_id,
  s.task_facility_id,
  s.task_resident_id,
  r.escalation_version_id,
  r.rung_key,
  r.label,
  r.is_terminal,
  r.assigned_staff_only,
  r.channels,
  s.shift,
  s.closes_at,
  s.closes_at + make_interval(mins => r.offset_minutes)
FROM
  shifted s
  CROSS JOIN LATERAL public.observation_escalation_rungs_at (s.task_facility_id, s.closes_at, s.shift) r
WHERE
  s.closes_at + make_interval(mins => r.offset_minutes) <= p_at
  AND s.closes_at >= r.version_effective_from
  AND (NOT r.assigned_staff_only OR EXISTS (
    SELECT 1 FROM public.resident_observation_tasks recipient_task
    CROSS JOIN LATERAL haven.observation_escalation_recipients(recipient_task.organization_id, recipient_task.facility_id, r.rung_id, recipient_task.assigned_staff_id) recipient
    WHERE recipient_task.id = s.id))
  AND NOT EXISTS (
    SELECT
      1
    FROM
      public.observation_escalation_dispatches d
    WHERE
      d.task_id = s.id
      AND d.rung_key = r.rung_key)
ORDER BY
  s.closes_at + make_interval(mins => r.offset_minutes)
LIMIT p_limit;
$func$;

REVOKE EXECUTE ON FUNCTION public.observation_escalations_due(uuid,uuid,timestamptz,integer) FROM authenticated; -- Service worker only; recipient resolver is deliberately private.

CREATE OR REPLACE FUNCTION haven.can_read_observation_config (p_facility_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = haven, pg_catalog
  AS $func$
  SELECT COALESCE(haven.app_role ()::text IN ('owner', 'org_admin', 'facility_admin', 'manager')
    AND haven.has_facility_access (p_facility_id), FALSE);
$func$;

CREATE OR REPLACE FUNCTION haven.can_edit_observation_config (p_facility_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = haven, pg_catalog
  AS $func$
  SELECT COALESCE(haven.app_role ()::text IN ('owner', 'org_admin')
    AND haven.has_facility_access (p_facility_id), FALSE);
$func$;

CREATE OR REPLACE FUNCTION haven.can_propose_observation_config (p_facility_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = haven, pg_catalog
  AS $func$
  SELECT COALESCE(haven.app_role ()::text IN ('owner', 'org_admin', 'facility_admin', 'manager')
    AND haven.has_facility_access (p_facility_id), FALSE);
$func$;

CREATE OR REPLACE FUNCTION public.simulate_cadence_change (p_facility_id uuid, p_proposed_cadence_version_id uuid DEFAULT NULL, p_proposed_escalation_version_id uuid DEFAULT NULL, p_lookback_days integer DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_tz text;
  v_lookback integer;
  v_from date;
  v_to date;
  v_recorded record;
  v_in_force jsonb;
  v_proposed jsonb;
  v_recorded_escalations integer;
BEGIN
  IF NOT haven.can_read_observation_config (p_facility_id) THEN
    RAISE EXCEPTION 'Simulating an observation configuration change needs a facility administrator or above with access to this building'
      USING ERRCODE = '42501';
  END IF;

  IF p_proposed_cadence_version_id IS NULL AND p_proposed_escalation_version_id IS NULL THEN
    RAISE EXCEPTION 'A simulation needs a proposed cadence version, a proposed escalation version, or both'
      USING ERRCODE = '22023';
  END IF;

  IF p_proposed_cadence_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.facility_cadence_versions v WHERE v.id = p_proposed_cadence_version_id AND v.facility_id = p_facility_id AND v.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Cadence version does not belong to this facility' USING ERRCODE = '42501';
  END IF;
  IF p_proposed_escalation_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.facility_escalation_versions v WHERE v.id = p_proposed_escalation_version_id AND v.facility_id = p_facility_id AND v.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Escalation version does not belong to this facility' USING ERRCODE = '42501';
  END IF;
  SELECT
    COALESCE(f.timezone, 'America/New_York') INTO v_tz
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'Facility not found'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(p_lookback_days, t.simulation_lookback_days) INTO v_lookback
  FROM
    public.facility_observation_thresholds t
  WHERE
    t.facility_id = p_facility_id
    AND t.deleted_at IS NULL;

  v_lookback := COALESCE(v_lookback, p_lookback_days);

  IF v_lookback IS NULL THEN
    RAISE EXCEPTION 'This building has no simulation lookback configured, so name the number of days to replay'
      USING ERRCODE = '22023';
  END IF;

  IF v_lookback < 1 OR v_lookback > 366 THEN
    RAISE EXCEPTION 'A simulation lookback of % days is outside the 1 to 366 day range the compliance read answers for', v_lookback
      USING ERRCODE = '22023';
  END IF;

  -- Complete days only. Today is still being worked and would read as a day of
  -- missed checks that nobody has missed yet.
  v_to := ((now() AT TIME ZONE v_tz)::date - 1);
  v_from := v_to - (v_lookback - 1);

  SELECT
    count(*) FILTER (WHERE c.expectation_source NOT IN ('no_cadence','orphaned_shift')) AS expected,
    count(*) FILTER (WHERE c.satisfied) AS satisfied,
    count(*) FILTER (WHERE NOT c.satisfied
      AND c.expectation_source NOT IN ('no_cadence','orphaned_shift')) AS missed,
    count(*) FILTER (WHERE c.expectation_source IN ('no_cadence','orphaned_shift')) AS unconfigured INTO v_recorded
  FROM
    public.observation_compliance_for_range (p_facility_id, v_from, v_to) c;

  SELECT
    count(*) INTO v_recorded_escalations
  FROM
    public.resident_observation_escalations e
  WHERE
    e.facility_id = p_facility_id
    AND e.deleted_at IS NULL
    AND e.triggered_at >= (v_from::timestamp AT TIME ZONE v_tz)
    AND e.triggered_at < ((v_to + 1)::timestamp AT TIME ZONE v_tz);

  v_in_force := haven.replay_observation_windows (p_facility_id, v_from, v_to, NULL, NULL);
  v_proposed := haven.replay_observation_windows (p_facility_id, v_from, v_to, p_proposed_cadence_version_id, p_proposed_escalation_version_id);

  RETURN jsonb_build_object('facility_id', p_facility_id, 'lookback_days', v_lookback, 'from_service_date', v_from, 'to_service_date', v_to, 'is_measurement_not_forecast', TRUE, 'measurement_note', 'This replays the proposed schedule against the observations staff actually recorded. Staff behavior changes when the schedule changes, so it measures the past and does not predict the future.', 'recorded', jsonb_build_object('expected', v_recorded.expected, 'satisfied', v_recorded.satisfied, 'missed', v_recorded.missed, 'unconfigured', v_recorded.unconfigured, 'escalations', v_recorded_escalations), 'in_force', v_in_force, 'proposed', v_proposed, 'change', jsonb_build_object('missed_delta', (v_proposed ->> 'would_be_missed')::integer - (v_in_force ->> 'would_be_missed')::integer, 'windows_delta', (v_proposed ->> 'windows_generated')::integer - (v_in_force ->> 'windows_generated')::integer, 'escalations_delta', (v_proposed ->> 'escalations_total')::integer - (v_in_force ->> 'escalations_total')::integer, 'nudges_delta', (v_proposed ->> 'nudges_total')::integer - (v_in_force ->> 'nudges_total')::integer));
END;
$func$;

CREATE OR REPLACE FUNCTION haven.replay_observation_windows (p_facility_id uuid, p_from date, p_to date, p_cadence_version_id uuid DEFAULT NULL, p_escalation_version_id uuid DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_tz text;
  v_escalation_version uuid;
  v_result jsonb;
BEGIN
  SELECT
    COALESCE(f.timezone, 'America/New_York') INTO v_tz
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'Facility not found'
      USING ERRCODE = '22023';
  END IF;

  v_escalation_version := COALESCE(p_escalation_version_id, public.facility_escalation_in_force (p_facility_id, now()));

  WITH compliance AS MATERIALIZED (SELECT * FROM public.observation_compliance_for_range(p_facility_id,p_from,p_to)), resident_day AS (
    SELECT DISTINCT
      c.resident_id,
      c.service_date
    FROM
      compliance c
),
  projected AS (
    SELECT c.resident_id,c.service_date,c.cadence_version_id,c.window_key,c.window_label AS label,c.shift_key,c.due_at_utc,c.window_opens_at_utc,c.window_closes_at_utc
    FROM compliance c WHERE p_cadence_version_id IS NULL AND c.expectation_source NOT IN ('no_cadence','orphaned_shift')
    UNION ALL
    SELECT rd.resident_id,rd.service_date,w.cadence_version_id,w.window_key,w.label,w.shift_key,w.due_at_utc,w.window_opens_at_utc,w.window_closes_at_utc
    FROM resident_day rd CROSS JOIN LATERAL public.facility_observation_windows_for_version(p_facility_id,p_cadence_version_id,rd.service_date) w
    WHERE p_cadence_version_id IS NOT NULL
),
  satisfaction AS (
    SELECT
      p.*,
      l.id AS log_id,
      l.observed_at
    FROM
      projected p
      LEFT JOIN LATERAL (
        SELECT
          lg.id,
          lg.observed_at
        FROM
          public.resident_observation_logs lg
        WHERE
          lg.resident_id = p.resident_id
          AND lg.facility_id = p_facility_id
          AND lg.deleted_at IS NULL
          AND lg.observed_at >= p.window_opens_at_utc
          AND lg.observed_at <= p.window_closes_at_utc
        ORDER BY
          lg.observed_at
        LIMIT 1) l ON TRUE
),
  rung AS (
    SELECT
      r.id AS rung_id,
      r.rung_key,
      r.label,
      r.offset_minutes,
      r.assigned_staff_only,
      r.sort_order
    FROM
      public.facility_escalation_rungs r
    WHERE
      r.escalation_version_id = v_escalation_version
      AND r.deleted_at IS NULL
      AND r.enabled
),
  fired AS (
    SELECT
      r.rung_key,
      r.label,
      r.assigned_staff_only,
      r.sort_order,
      count(*) FILTER (WHERE s.log_id IS NULL
        OR s.observed_at > s.window_closes_at_utc + make_interval(mins => COALESCE(ov.offset_minutes, r.offset_minutes))) AS fired_count
    FROM
      rung r
      CROSS JOIN satisfaction s
      LEFT JOIN public.facility_escalation_rung_shift_overrides ov ON ov.escalation_rung_id = r.rung_id
        AND ov.shift_key = s.shift_key
        AND ov.deleted_at IS NULL
    GROUP BY
      r.rung_key,
      r.label,
      r.assigned_staff_only,
      r.sort_order
)
  SELECT
    jsonb_build_object('cadence_version_id', p_cadence_version_id, 'escalation_version_id', v_escalation_version, 'resident_days', (
        SELECT
          count(*)
        FROM resident_day), 'windows_generated', (
      SELECT
        count(*)
      FROM satisfaction), 'would_be_satisfied', (
      SELECT
        count(*)
      FROM
        satisfaction
      WHERE
        log_id IS NOT NULL), 'would_be_missed', (
      SELECT
        count(*)
      FROM
        satisfaction
      WHERE
        log_id IS NULL), 'missed_by_shift', COALESCE((
        SELECT
          jsonb_agg (jsonb_build_object('shift_key', shift_key, 'missed', missed)
          ORDER BY shift_key)
        FROM (
          SELECT
            shift_key,
            count(*) FILTER (WHERE log_id IS NULL) AS missed
          FROM
            satisfaction
          GROUP BY
            shift_key) by_shift), '[]'::jsonb), 'escalations_by_rung', COALESCE((
        SELECT
          jsonb_agg (jsonb_build_object('rung_key', rung_key, 'label', label, 'fired', fired_count)
          ORDER BY sort_order, rung_key)
        FROM
          fired
        WHERE
          NOT assigned_staff_only), '[]'::jsonb), 'escalations_total', COALESCE((
        SELECT
          sum(fired_count)
        FROM
          fired
        WHERE
          NOT assigned_staff_only), 0), 'nudges_total', COALESCE((
        SELECT
          sum(fired_count)
        FROM
          fired
        WHERE
          assigned_staff_only), 0)) INTO v_result;

  RETURN v_result;
END;
$func$;

CREATE OR REPLACE FUNCTION public.evaluate_watchlist_signals (p_facility_id uuid, p_as_of timestamptz DEFAULT now())
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_facility record;
  v_local_date date;
  v_gap record;
  v_opened integer := 0;
  v_refreshed integer := 0;
  v_cleared integer := 0;
  v_notified integer := 0;
  v_matched integer := 0;
  v_gap_matched integer := 0;
BEGIN
  SELECT
    f.id,
    f.organization_id,
    f.entity_id,
    COALESCE(f.timezone, 'UTC') AS timezone INTO v_facility
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_facility.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'facility_not_found');
  END IF;

  v_local_date := (p_as_of AT TIME ZONE v_facility.timezone)::date;

  CREATE TEMP TABLE IF NOT EXISTS watchlist_eval_match (
    signal_rule_id uuid,
    signal_key text,
    resident_id uuid,
    observed_count integer,
    evidence jsonb
  ) ON COMMIT DROP;
  DELETE FROM watchlist_eval_match;

  INSERT INTO watchlist_eval_match (signal_rule_id, signal_key, resident_id, observed_count, evidence)
  WITH enabled_rules AS (
    SELECT
      *
    FROM
      public.watchlist_rules_for_facility (p_facility_id)
    WHERE
      enabled
),
-- Residents of record at this building. inquiry and pending_admission are not
-- in the building; discharged and deceased are not coming back.
occupants AS (
  SELECT
    res.id AS resident_id
  FROM
    public.residents res
  WHERE
    res.facility_id = p_facility_id
    AND res.deleted_at IS NULL
    AND res.status IN ('active', 'hospital_hold', 'loa')
),
-- A care event that became an incident is counted once, through the incident.
-- Counting both would report one fall as two and put a resident on the repeat
-- fall rule who has fallen once.
resident_events AS (
  SELECT
    i.resident_id,
    i.occurred_at,
    i.id AS source_id,
    'incident'::text AS source_table,
    i.category::text AS event_code
  FROM
    public.incidents i
  WHERE
    i.facility_id = p_facility_id
    AND i.deleted_at IS NULL
    AND i.resident_id IS NOT NULL
    AND i.occurred_at <= p_as_of
    AND i.occurred_at >= p_as_of - interval '400 days'
  UNION ALL
  SELECT
    ce.resident_id,
    ce.occurred_at,
    ce.id,
    'care_event',
    ce.kind
  FROM
    public.care_events ce
  WHERE
    ce.facility_id = p_facility_id
    AND ce.deleted_at IS NULL
    AND ce.resident_id IS NOT NULL
    AND ce.incident_id IS NULL
    AND ce.occurred_at <= p_as_of
    AND ce.occurred_at >= p_as_of - interval '400 days'
),
weights AS (
  SELECT
    d.resident_id,
    d.log_date,
    d.weight_lbs,
    d.id AS source_id
  FROM
    public.daily_logs d
  WHERE
    d.facility_id = p_facility_id
    AND d.deleted_at IS NULL
    AND d.weight_lbs IS NOT NULL
    AND d.weight_lbs > 0
    AND d.log_date <= v_local_date
),
latest_weight AS (
  SELECT DISTINCT ON (w.resident_id)
    w.resident_id,
    w.log_date,
    w.weight_lbs,
    w.source_id
  FROM
    weights w
  ORDER BY
    w.resident_id,
    w.log_date DESC,
    w.source_id
),
attendance AS (
  SELECT
    a.resident_id,
    s.session_date
  FROM
    public.activity_attendance a
    JOIN public.activity_sessions s ON s.id = a.activity_session_id
      AND s.deleted_at IS NULL
      AND NOT s.cancelled
  WHERE
    a.facility_id = p_facility_id
    AND a.deleted_at IS NULL
    AND a.attended
    AND s.session_date <= v_local_date
),
latest_form_1823 AS (
  SELECT DISTINCT ON (fr.resident_id)
    fr.resident_id,
    fr.id AS source_id,
    fr.expiration_date
  FROM
    public.form_1823_records fr
  WHERE
    fr.facility_id = p_facility_id
    AND fr.deleted_at IS NULL
    AND fr.expiration_date IS NOT NULL
  ORDER BY
    fr.resident_id,
    fr.expiration_date DESC,
    fr.id
)
-- Falls, repeat falls, and leaving the building.
SELECT
  r.id,
  r.signal_key,
  e.resident_id,
  count(*)::integer,
  jsonb_build_object('source', 'incidents_and_care_events', 'lookback_days', r.lookback_days, 'threshold_count', r.threshold_count, 'event_count', count(*), 'event_ids', jsonb_agg(DISTINCT e.source_id))
FROM
  enabled_rules r
  JOIN resident_events e ON e.occurred_at >= p_as_of - make_interval(days => r.lookback_days)
    AND ((e.source_table = 'incident'
        AND jsonb_exists(COALESCE(r.source_filter -> 'incident_categories', '[]'::jsonb), e.event_code))
      OR (e.source_table = 'care_event'
        AND jsonb_exists(COALESCE(r.source_filter -> 'care_event_kinds', '[]'::jsonb), e.event_code)))
  JOIN occupants o ON o.resident_id = e.resident_id
WHERE
  r.signal_key IN ('recent_fall', 'repeat_fall', 'elopement_or_wandering')
GROUP BY
  r.id,
  r.signal_key,
  r.lookback_days,
  r.threshold_count,
  e.resident_id
HAVING
  count(*) >= r.threshold_count
UNION ALL
-- Back from hospital. The history row's effective_to is the day they returned.
SELECT
  r.id,
  r.signal_key,
  h.resident_id,
  count(*)::integer,
  jsonb_build_object('source', 'resident_status_history', 'lookback_days', r.lookback_days, 'history_ids', jsonb_agg(DISTINCT h.id), 'returned_count', count(*))
FROM
  enabled_rules r
  JOIN public.resident_status_history h ON h.facility_id = p_facility_id
    AND h.deleted_at IS NULL
    AND jsonb_exists(COALESCE(r.source_filter -> 'statuses', '[]'::jsonb), h.status::text)
    AND h.effective_to IS NOT NULL
    AND h.effective_to <= p_as_of
    AND h.effective_to >= p_as_of - make_interval(days => r.lookback_days)
  JOIN occupants o ON o.resident_id = h.resident_id
WHERE
  r.signal_key = 'post_hospital_window'
GROUP BY
  r.id,
  r.signal_key,
  r.lookback_days,
  r.threshold_count,
  h.resident_id
HAVING
  count(*) >= r.threshold_count
UNION ALL
-- The three chip signals. Containment against chip_selections, never a string
-- match on the composed sentence, and a baseline of zero where the rule carries
-- one, which is what makes behavior change mean changed rather than present.
SELECT
  r.id,
  r.signal_key,
  l.resident_id,
  count(*) FILTER (WHERE l.observed_at >= p_as_of - make_interval(days => r.lookback_days))::integer,
  jsonb_build_object('source', 'resident_observation_logs.chip_selections', 'chip_any', COALESCE(r.source_filter -> 'chip_any', '[]'::jsonb), 'lookback_days', r.lookback_days, 'baseline_days', r.baseline_days, 'threshold_count', r.threshold_count, 'log_ids', COALESCE(jsonb_agg(DISTINCT l.id) FILTER (WHERE l.observed_at >= p_as_of - make_interval(days => r.lookback_days)), '[]'::jsonb), 'baseline_count', count(*) FILTER (WHERE l.observed_at < p_as_of - make_interval(days => r.lookback_days)))
FROM
  enabled_rules r
  JOIN public.resident_observation_logs l ON l.facility_id = p_facility_id
    AND l.deleted_at IS NULL
    AND l.observed_at <= p_as_of
    AND l.observed_at >= p_as_of - make_interval(days => r.lookback_days + COALESCE(r.baseline_days, 0))
    AND EXISTS (
      SELECT
        1
      FROM
        jsonb_array_elements(COALESCE(r.source_filter -> 'chip_any', '[]'::jsonb)) AS pattern
      WHERE
        l.chip_selections @> pattern.value)
  JOIN occupants o ON o.resident_id = l.resident_id
WHERE
  r.signal_key IN ('meal_refusal_trend', 'med_refusal_trend', 'behavior_change')
GROUP BY
  r.id,
  r.signal_key,
  r.lookback_days,
  r.baseline_days,
  r.threshold_count,
  r.source_filter,
  l.resident_id
HAVING
  count(*) FILTER (WHERE l.observed_at >= p_as_of - make_interval(days => r.lookback_days)) >= r.threshold_count
  AND (r.baseline_days IS NULL
    OR count(*) FILTER (WHERE l.observed_at < p_as_of - make_interval(days => r.lookback_days)) = 0)
UNION ALL
-- Awake at the overnight check. This one reads resident_state rather than a
-- chip: there is no sleep chip group, and the settled states are vocabulary
-- codes the rule names.
SELECT
  r.id,
  r.signal_key,
  l.resident_id,
  count(DISTINCT t.service_date)::integer,
  jsonb_build_object('source', 'resident_observation_logs.resident_state', 'window_key', r.source_filter ->> 'window_key', 'satisfying_states', COALESCE(r.source_filter -> 'satisfying_states', '[]'::jsonb), 'lookback_days', r.lookback_days, 'threshold_count', r.threshold_count, 'night_count', count(DISTINCT t.service_date), 'log_ids', jsonb_agg(DISTINCT l.id))
FROM
  enabled_rules r
  JOIN public.resident_observation_tasks t ON t.facility_id = p_facility_id
    AND t.deleted_at IS NULL
    AND t.window_key = (r.source_filter ->> 'window_key')
  JOIN public.resident_observation_logs l ON l.task_id = t.id
    AND l.deleted_at IS NULL
    AND l.resident_state IS NOT NULL
    AND l.observed_at <= p_as_of
    AND l.observed_at >= p_as_of - make_interval(days => r.lookback_days)
    AND NOT jsonb_exists(COALESCE(r.source_filter -> 'satisfying_states', '[]'::jsonb), l.resident_state)
  JOIN occupants o ON o.resident_id = l.resident_id
WHERE
  r.signal_key = 'night_restlessness'
GROUP BY
  r.id,
  r.signal_key,
  r.lookback_days,
  r.threshold_count,
  r.source_filter,
  l.resident_id
HAVING
  count(DISTINCT t.service_date) >= r.threshold_count
UNION ALL
-- Monitoring Orders, in force and past review.
SELECT
  r.id,
  r.signal_key,
  m.resident_id,
  1,
  jsonb_build_object('source', 'resident_monitoring_orders', 'monitoring_order_id', m.id, 'interval_minutes', m.interval_minutes, 'review_due_at', m.review_due_at, 'starts_at', m.starts_at)
FROM
  enabled_rules r
  JOIN public.resident_monitoring_orders m ON m.facility_id = p_facility_id
    AND m.deleted_at IS NULL
    AND jsonb_exists(COALESCE(r.source_filter -> 'statuses', '[]'::jsonb), m.status)
    AND (r.signal_key = 'active_monitoring_order'
      OR (m.review_due_at IS NOT NULL
        AND m.review_due_at <= p_as_of))
  JOIN occupants o ON o.resident_id = m.resident_id
WHERE
  r.signal_key IN ('active_monitoring_order', 'monitoring_order_review_overdue')
UNION ALL
-- Care plan review past due.
SELECT
  r.id,
  r.signal_key,
  a.resident_id,
  count(*)::integer,
  jsonb_build_object('source', 'care_plan_review_alerts', 'trigger_types', COALESCE(r.source_filter -> 'trigger_types', '[]'::jsonb), 'alert_ids', jsonb_agg(DISTINCT a.id), 'alert_count', count(*))
FROM
  enabled_rules r
  JOIN public.care_plan_review_alerts a ON a.facility_id = p_facility_id
    AND a.deleted_at IS NULL
    AND jsonb_exists(COALESCE(r.source_filter -> 'statuses', '[]'::jsonb), a.status)
    AND jsonb_exists(COALESCE(r.source_filter -> 'trigger_types', '[]'::jsonb), a.trigger_type)
  JOIN occupants o ON o.resident_id = a.resident_id
WHERE
  r.signal_key = 'care_plan_review_overdue'
GROUP BY
  r.id,
  r.signal_key,
  r.threshold_count,
  r.source_filter,
  a.resident_id
HAVING
  count(*) >= r.threshold_count
UNION ALL
-- Form 1823 expiring, or already expired.
SELECT
  r.id,
  r.signal_key,
  f.resident_id,
  1,
  jsonb_build_object('source', 'form_1823_records', 'form_1823_record_id', f.source_id, 'expiration_date', f.expiration_date, 'lookback_days', r.lookback_days)
FROM
  enabled_rules r
  JOIN latest_form_1823 f ON f.expiration_date <= v_local_date + r.lookback_days
  JOIN occupants o ON o.resident_id = f.resident_id
WHERE
  r.signal_key = 'form_1823_due'
UNION ALL
-- Stopped joining in. The baseline has to hold attendances before an absence
-- can mean anything, so a building that records no activities at all never
-- fires this.
SELECT
  r.id,
  r.signal_key,
  o.resident_id,
  0,
  jsonb_build_object('source', 'activity_attendance', 'lookback_days', r.lookback_days, 'baseline_days', r.baseline_days, 'baseline_attendances', baseline.n, 'recent_attendances', 0)
FROM
  enabled_rules r
  CROSS JOIN occupants o
  JOIN LATERAL (
    SELECT
      count(*)::integer AS n
    FROM
      attendance att
    WHERE
      att.resident_id = o.resident_id
      AND att.session_date < v_local_date - r.lookback_days
      AND att.session_date >= v_local_date - (r.lookback_days + COALESCE(r.baseline_days, 0))) baseline ON TRUE
WHERE
  r.signal_key = 'withdrawal'
  AND baseline.n >= r.threshold_count
  AND NOT EXISTS (
    SELECT
      1
    FROM
      attendance recent
    WHERE
      recent.resident_id = o.resident_id
      AND recent.session_date >= v_local_date - r.lookback_days)
UNION ALL
-- Weight loss, measured from the highest weight in the span to the latest one.
SELECT
  r.id,
  r.signal_key,
  lw.resident_id,
  1,
  jsonb_build_object('source', 'daily_logs.weight_lbs', 'latest_log_date', lw.log_date, 'latest_daily_log_id', lw.source_id, 'threshold_percent', r.threshold_percent, 'lookback_days', r.lookback_days, 'drop_percent', primary_span.drop_percent, 'secondary_threshold_percent', r.secondary_threshold_percent, 'secondary_lookback_days', r.secondary_lookback_days, 'secondary_drop_percent', secondary_span.drop_percent)
FROM
  enabled_rules r
  JOIN latest_weight lw ON TRUE
  JOIN occupants o ON o.resident_id = lw.resident_id
  LEFT JOIN LATERAL (
    SELECT
      round(((max(w.weight_lbs) - lw.weight_lbs) / NULLIF(max(w.weight_lbs), 0)) * 100, 2) AS drop_percent
    FROM
      weights w
    WHERE
      w.resident_id = lw.resident_id
      AND w.log_date >= v_local_date - r.lookback_days) primary_span ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      round(((max(w.weight_lbs) - lw.weight_lbs) / NULLIF(max(w.weight_lbs), 0)) * 100, 2) AS drop_percent
    FROM
      weights w
    WHERE
      r.secondary_lookback_days IS NOT NULL
      AND w.resident_id = lw.resident_id
      AND w.log_date >= v_local_date - r.secondary_lookback_days) secondary_span ON TRUE
WHERE
  r.signal_key = 'weight_loss'
  AND r.threshold_percent IS NOT NULL
  AND (COALESCE(primary_span.drop_percent, 0) >= r.threshold_percent
    OR (r.secondary_threshold_percent IS NOT NULL
      AND COALESCE(secondary_span.drop_percent, 0) >= r.secondary_threshold_percent));

  GET DIAGNOSTICS v_matched = ROW_COUNT;

  -- ---------------------------------------------------------------------
  -- The documentation signal, read from the compliance contract and never
  -- from a count of task rows.
  --
  -- Counting resident_observation_tasks would report a resident on a 30
  -- minute Monitoring Order as missing six windows a day, because while an
  -- order is in force the standard windows stop generating and there is no
  -- task row left to miss. public.observation_compliance_for_range projects
  -- the windows the cadence version in force defines and marks one satisfied
  -- when any log falls inside its span, whichever kind of task produced it.
  -- Consecutive is measured over the projection in window close order.
  -- ---------------------------------------------------------------------
  SELECT
    gap_rule.id,
    gap_rule.threshold_count,
    gap_rule.lookback_days INTO v_gap
  FROM
    public.watchlist_rules_for_facility (p_facility_id) gap_rule
  WHERE
    gap_rule.signal_key = 'observation_gap'
    AND gap_rule.enabled;

  IF v_gap.id IS NOT NULL THEN
    INSERT INTO watchlist_eval_match (signal_rule_id, signal_key, resident_id, observed_count, evidence)
    WITH closed_windows AS (
      SELECT
        c.resident_id,
        c.satisfied,
        c.window_closes_at_utc
      FROM
        public.observation_compliance_for_range (p_facility_id, v_local_date - v_gap.lookback_days, v_local_date) c
      WHERE
        c.expectation_source NOT IN ('no_cadence', 'orphaned_shift')
        AND c.window_key IS NOT NULL
        AND c.window_closes_at_utc IS NOT NULL
        AND c.window_closes_at_utc <= p_as_of
),
    islands AS (
      SELECT
        cw.resident_id,
        cw.satisfied,
        cw.window_closes_at_utc,
        row_number() OVER (PARTITION BY cw.resident_id ORDER BY cw.window_closes_at_utc) - row_number() OVER (PARTITION BY cw.resident_id,
          cw.satisfied ORDER BY cw.window_closes_at_utc) AS island
      FROM
        closed_windows cw
),
    runs AS (
      SELECT
        i.resident_id,
        i.island,
        count(*)::integer AS run_length,
        min(i.window_closes_at_utc) AS run_started_at,
        max(i.window_closes_at_utc) AS run_ended_at
      FROM
        islands i
      WHERE
        NOT i.satisfied
      GROUP BY
        i.resident_id,
        i.island
),
    longest AS (
      SELECT DISTINCT ON (r.resident_id)
        r.resident_id,
        r.run_length,
        r.run_started_at,
        r.run_ended_at
      FROM
        runs r
      ORDER BY
        r.resident_id,
        r.run_length DESC,
        r.run_ended_at DESC
)
    SELECT
      v_gap.id,
      'observation_gap',
      l.resident_id,
      l.run_length,
      jsonb_build_object('source', 'observation_compliance_for_range', 'threshold_count', v_gap.threshold_count, 'lookback_days', v_gap.lookback_days, 'consecutive_unrecorded_windows', l.run_length, 'run_started_at', l.run_started_at, 'run_ended_at', l.run_ended_at)
    FROM
      longest l
      JOIN public.residents res ON res.id = l.resident_id
        AND res.facility_id = p_facility_id
        AND res.deleted_at IS NULL
        AND res.status IN ('active', 'hospital_hold', 'loa')
    WHERE
      l.run_length >= v_gap.threshold_count;

    GET DIAGNOSTICS v_gap_matched = ROW_COUNT;
    v_matched := v_matched + v_gap_matched;
  END IF;

  -- ---------------------------------------------------------------------
  -- Refresh what still holds. No status change, so no ledger row: a signal
  -- that has been true for six days is one event, not six.
  -- ---------------------------------------------------------------------
  UPDATE
    public.watchlist_signal_instances i
  SET
    observed_count = m.observed_count,
    evidence = m.evidence,
    last_evaluated_at = GREATEST(p_as_of, i.first_detected_at)
  FROM
    watchlist_eval_match m
  WHERE
    i.facility_id = p_facility_id
    AND i.resident_id = m.resident_id
    AND i.signal_key = m.signal_key
    AND i.status <> 'cleared'
    AND i.deleted_at IS NULL;

  GET DIAGNOSTICS v_refreshed = ROW_COUNT;

  -- ---------------------------------------------------------------------
  -- Open what is new. The severity travels onto the instance so a later
  -- threshold edit changes what fires next rather than what a reviewer was
  -- looking at last week.
  -- ---------------------------------------------------------------------
  INSERT INTO public.watchlist_signal_instances (organization_id, entity_id, facility_id, resident_id, signal_rule_id, signal_key, severity_class, severity_weight, source_kind, first_detected_at, last_evaluated_at, observed_count, evidence, status)
  SELECT
    v_facility.organization_id,
    v_facility.entity_id,
    p_facility_id,
    m.resident_id,
    m.signal_rule_id,
    m.signal_key,
    r.severity_class,
    r.severity_weight,
    r.source_kind,
    p_as_of,
    p_as_of,
    m.observed_count,
    m.evidence,
    'new'
  FROM
    watchlist_eval_match m
    JOIN public.watchlist_signal_rules r ON r.id = m.signal_rule_id
  WHERE
    NOT EXISTS (
      SELECT
        1
      FROM
        public.watchlist_signal_instances existing
      WHERE
        existing.resident_id = m.resident_id
        AND existing.signal_key = m.signal_key
        AND existing.status <> 'cleared'
        AND existing.deleted_at IS NULL);

  GET DIAGNOSTICS v_opened = ROW_COUNT;

  -- ---------------------------------------------------------------------
  -- Close what no longer holds, but only where the rule is still running.
  -- Switching a rule off does not resolve the risk somebody already has to
  -- answer for, so an instance under a disabled rule stays open until a
  -- person clears it.
  -- ---------------------------------------------------------------------
  UPDATE
    public.watchlist_signal_instances i
  SET
    status = 'cleared',
    cleared_at = p_as_of,
    cleared_reason = 'condition_no_longer_met',
    last_evaluated_at = GREATEST(p_as_of, i.first_detected_at)
  WHERE
    i.facility_id = p_facility_id
    AND i.status <> 'cleared'
    AND i.deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        public.watchlist_rules_for_facility (p_facility_id) running
      WHERE
        running.signal_key = i.signal_key
        AND running.enabled)
    AND NOT EXISTS (
      SELECT
        1
      FROM
        watchlist_eval_match m
      WHERE
        m.resident_id = i.resident_id
        AND m.signal_key = i.signal_key);

  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  -- ---------------------------------------------------------------------
  -- Push the Acute ones. Spec section 7.9: the page is where the list is
  -- worked, not where it is discovered. Acute is whatever the band rules say
  -- it is, read from the rows rather than named here, and the stamp means a
  -- re-evaluation on the next tick does not wake anybody twice.
  -- ---------------------------------------------------------------------
  v_notified := haven.notify_watchlist_acute (p_facility_id, p_as_of);

  RETURN jsonb_build_object('ok', TRUE, 'facility_id', p_facility_id, 'evaluated_at', p_as_of, 'matches', v_matched, 'opened', v_opened, 'refreshed', v_refreshed, 'cleared', v_cleared, 'notified', v_notified);
END;
$func$;

NOTIFY pgrst, 'reload schema';
COMMIT;
