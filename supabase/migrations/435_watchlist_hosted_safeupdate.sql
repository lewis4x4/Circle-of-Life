-- Hosted PostgREST enables safeupdate, which rejects DELETE without WHERE even
-- against this session-local scratch table. Reset the temporary working set
-- explicitly; no persistent signal or clinical data is truncated.
BEGIN;

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
  TRUNCATE TABLE pg_temp.watchlist_eval_match;

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
