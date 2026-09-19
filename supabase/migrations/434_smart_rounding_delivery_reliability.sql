-- Reliable bounded transport for escalation, Monitoring Order and Acute Watchlist queues.
BEGIN;
DROP FUNCTION public.record_observation_escalation_delivery_outcome(uuid, uuid, text, text, text, text, timestamptz);
CREATE OR REPLACE FUNCTION public.record_observation_escalation_delivery_outcome (p_delivery_id uuid, p_claim_token uuid, p_status text, p_skip_reason text DEFAULT NULL, p_provider_message_id text DEFAULT NULL, p_error_message text DEFAULT NULL, p_sent_at timestamptz DEFAULT NULL, p_retryable boolean DEFAULT FALSE, p_retry_after_seconds integer DEFAULT NULL)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_rows integer;
BEGIN
  IF p_status NOT IN ('sent', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'An escalation delivery outcome must be sent, failed or skipped, not %', p_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE
    public.observation_escalation_deliveries d
  SET
    status = CASE WHEN p_status = 'failed' AND p_retryable AND d.send_attempts < haven.observation_delivery_max_attempts() THEN 'queued' ELSE p_status END,
    send_after = CASE WHEN p_status = 'failed' AND p_retryable THEN now() + make_interval(secs => LEAST(3600, GREATEST(1, COALESCE(p_retry_after_seconds, 60 * d.send_attempts)))) ELSE d.send_after END,
    skip_reason = p_skip_reason,
    provider_message_id = p_provider_message_id,
    error_message = p_error_message,
    sent_at = p_sent_at,
    claim_token = NULL,
    updated_at = now()
  WHERE
    d.id = p_delivery_id
    -- The holder of the claim, and only the holder. A tick that finishes after
    -- its claim was reclaimed must not overwrite the outcome of the tick that
    -- actually sent the message.
    AND d.claim_token = p_claim_token
    -- And only from the state the claim leaves the row in. This is the
    -- predicate whose first version said 'queued' and silently matched nothing.
    AND d.status = 'sending';

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Escalation delivery % is not held by this claim, so its outcome cannot be recorded', p_delivery_id
      USING ERRCODE = '40001';
  END IF;

  RETURN TRUE;
END;
$func$;
REVOKE ALL ON FUNCTION public.record_observation_escalation_delivery_outcome(uuid,uuid,text,text,text,text,timestamptz,boolean,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_observation_escalation_delivery_outcome(uuid,uuid,text,text,text,text,timestamptz,boolean,integer) TO service_role;

ALTER TABLE public.resident_monitoring_order_notifications
 ADD COLUMN claim_token uuid,
 ADD COLUMN claimed_at timestamptz,
 ADD COLUMN send_attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN error_message text,
 ADD COLUMN provider_message_id text;
ALTER TABLE public.resident_monitoring_order_notifications DROP CONSTRAINT resident_monitoring_order_notifications_status_check;
ALTER TABLE public.resident_monitoring_order_notifications ADD CONSTRAINT resident_monitoring_order_notifications_status_check CHECK (status IN ('queued','sending','sent','failed','skipped'));

ALTER TABLE public.watchlist_signal_notifications
 ADD COLUMN claim_token uuid,
 ADD COLUMN claimed_at timestamptz,
 ADD COLUMN send_attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN error_message text,
 ADD COLUMN provider_message_id text;
ALTER TABLE public.watchlist_signal_notifications DROP CONSTRAINT watchlist_signal_notifications_status_check;
ALTER TABLE public.watchlist_signal_notifications ADD CONSTRAINT watchlist_signal_notifications_status_check CHECK (status IN ('queued','sending','sent','failed','skipped'));

CREATE OR REPLACE FUNCTION public.claim_smart_rounding_notifications(p_organization_id uuid, p_facility_id uuid, p_claim_token uuid, p_at timestamptz, p_limit integer)
RETURNS TABLE (source text, id uuid, organization_id uuid, facility_id uuid, target_user_id uuid, target_phone text, channel text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $func$
DECLARE v_table text; v_source text; v_reference text;
BEGIN
 IF p_organization_id IS NULL OR p_claim_token IS NULL OR p_at IS NULL THEN RAISE EXCEPTION 'Organization, claim token and instant required' USING ERRCODE = '22023'; END IF;
 FOREACH v_table IN ARRAY ARRAY['resident_monitoring_order_notifications','watchlist_signal_notifications'] LOOP
  v_source := CASE WHEN v_table = 'watchlist_signal_notifications' THEN 'watchlist' ELSE 'monitoring_order' END;
  v_reference := CASE WHEN v_source='watchlist' THEN 'signal_instance_id' ELSE 'monitoring_order_id' END;
  -- Match care-event in-app transport: a real, visible facility alert precedes
  -- the sent receipt. Source UUID is the stable per-event alert identity, so
  -- multiple recipients and overlapping drains cannot create duplicate alerts.
  EXECUTE format($sql$INSERT INTO public.exec_alerts(id,organization_id,facility_id,source_module,severity,title,body,deep_link_path,category)
   SELECT DISTINCT d.%I,d.organization_id,d.facility_id,'compliance'::public.exec_alert_source_module,
    CASE WHEN $3='watchlist' THEN 'critical'::public.exec_alert_severity ELSE 'warning'::public.exec_alert_severity END,
    CASE WHEN $3='watchlist' THEN 'Acute Watchlist signal needs review' ELSE 'Monitoring order needs review' END,
    'Open Smart Rounding to review this item.','/admin/rounding','smart_rounding'
   FROM public.%I d WHERE d.organization_id=$1 AND ($2 IS NULL OR d.facility_id=$2)
    AND d.status='queued' AND d.channel='in_app' AND d.send_after <= $4
   ON CONFLICT(id) DO NOTHING$sql$,v_reference,v_table)
   USING p_organization_id,p_facility_id,v_source,p_at;
  EXECUTE format($sql$UPDATE public.%I d SET
    status=CASE WHEN EXISTS(SELECT 1 FROM public.user_profiles up WHERE up.id=d.target_user_id AND up.organization_id=d.organization_id AND up.is_active AND up.deleted_at IS NULL AND up.app_role IN ('owner','org_admin')) THEN 'sent' ELSE 'skipped' END,
    sent_at=CASE WHEN EXISTS(SELECT 1 FROM public.user_profiles up WHERE up.id=d.target_user_id AND up.organization_id=d.organization_id AND up.is_active AND up.deleted_at IS NULL AND up.app_role IN ('owner','org_admin')) THEN $3 ELSE NULL END,
    skip_reason=CASE WHEN EXISTS(SELECT 1 FROM public.user_profiles up WHERE up.id=d.target_user_id AND up.organization_id=d.organization_id AND up.is_active AND up.deleted_at IS NULL AND up.app_role IN ('owner','org_admin')) THEN NULL ELSE 'in_app_surface_unavailable' END
   WHERE d.organization_id=$1 AND ($2 IS NULL OR d.facility_id=$2)
    AND d.status='queued' AND d.channel='in_app' AND d.send_after <= $3
    AND EXISTS(SELECT 1 FROM public.exec_alerts a WHERE a.id=d.%I AND a.organization_id=d.organization_id AND a.facility_id=d.facility_id)$sql$,v_table,v_reference)
   USING p_organization_id,p_facility_id,p_at;

  EXECUTE format($sql$UPDATE public.%I d SET status='failed', error_message='Abandoned mid send and out of attempts', claim_token=NULL
    WHERE d.organization_id=$1 AND ($2 IS NULL OR d.facility_id=$2) AND d.status='sending'
    AND d.claimed_at < $3 - haven.observation_delivery_claim_timeout() AND d.send_attempts >= haven.observation_delivery_max_attempts()$sql$,v_table)
    USING p_organization_id,p_facility_id,p_at;
  RETURN QUERY EXECUTE format($sql$
   UPDATE public.%I d SET status='sending', claimed_at=$3, claim_token=$4, send_attempts=d.send_attempts+1
   WHERE d.id IN (SELECT c.id FROM public.%I c WHERE c.organization_id=$1 AND ($2 IS NULL OR c.facility_id=$2)
     AND c.send_after <= $3 AND c.send_attempts < haven.observation_delivery_max_attempts()
     AND (c.status='queued' OR (c.status='sending' AND c.claimed_at < $3 - haven.observation_delivery_claim_timeout()))
     ORDER BY c.send_after,c.id LIMIT LEAST(GREATEST(COALESCE($5,1),1),50) FOR UPDATE SKIP LOCKED)
   RETURNING $6::text,d.id,d.organization_id,d.facility_id,d.target_user_id,d.target_phone,d.channel$sql$,v_table,v_table)
   USING p_organization_id,p_facility_id,p_at,p_claim_token,p_limit,v_source;
 END LOOP;
END;
$func$;
REVOKE ALL ON FUNCTION public.claim_smart_rounding_notifications(uuid,uuid,uuid,timestamptz,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_smart_rounding_notifications(uuid,uuid,uuid,timestamptz,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.record_smart_rounding_notification_outcome(p_source text,p_delivery_id uuid,p_claim_token uuid,p_status text,p_skip_reason text DEFAULT NULL,p_provider_message_id text DEFAULT NULL,p_error_message text DEFAULT NULL,p_sent_at timestamptz DEFAULT NULL,p_retryable boolean DEFAULT FALSE,p_retry_after_seconds integer DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $func$
DECLARE v_table text; v_rows integer;
BEGIN
 v_table := CASE p_source WHEN 'watchlist' THEN 'watchlist_signal_notifications' WHEN 'monitoring_order' THEN 'resident_monitoring_order_notifications' END;
 IF v_table IS NULL OR p_status IS NULL OR p_status NOT IN ('sent','failed','skipped') THEN RAISE EXCEPTION 'Invalid notification source or outcome' USING ERRCODE='22023'; END IF;
 EXECUTE format($sql$UPDATE public.%I d SET
 status=CASE WHEN $3='failed' AND $8 AND d.send_attempts < haven.observation_delivery_max_attempts() THEN 'queued' ELSE $3 END,
 send_after=CASE WHEN $3='failed' AND $8 THEN now()+make_interval(secs=>LEAST(3600,GREATEST(1,COALESCE($9,60*d.send_attempts)))) ELSE d.send_after END,
 skip_reason=$4,provider_message_id=$5,error_message=$6,sent_at=$7,claim_token=NULL
 WHERE d.id=$1 AND d.claim_token=$2 AND d.status='sending'$sql$,v_table)
 USING p_delivery_id,p_claim_token,p_status,p_skip_reason,p_provider_message_id,p_error_message,p_sent_at,p_retryable,p_retry_after_seconds;
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows=0 THEN RAISE EXCEPTION 'Notification not held by this claim' USING ERRCODE='40001'; END IF;
 RETURN TRUE;
END;
$func$;
REVOKE ALL ON FUNCTION public.record_smart_rounding_notification_outcome(text,uuid,uuid,text,text,text,text,timestamptz,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_smart_rounding_notification_outcome(text,uuid,uuid,text,text,text,text,timestamptz,boolean,integer) TO service_role;
-- A receipt is sent only when its target can open the actual escalation board.
CREATE OR REPLACE FUNCTION public.claim_observation_escalation_deliveries (p_organization_id uuid, p_facility_id uuid, p_claim_token uuid, p_at timestamptz, p_limit integer)
  RETURNS TABLE (
    id uuid,
    organization_id uuid,
    facility_id uuid,
    dispatch_id uuid,
    rung_key text,
    target_user_id uuid,
    target_phone text,
    channel text,
    is_test boolean,
    message_body text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
  -- Two data modifying branches in one statement. They target disjoint rows,
  -- because one requires the attempt cap to be exhausted and the other requires
  -- it not to be, so neither can see or fight the other.
  WITH unavailable AS (
    UPDATE public.observation_escalation_deliveries d SET status='skipped',skip_reason='in_app_surface_unavailable',claim_token=NULL,updated_at=now()
    WHERE d.organization_id=p_organization_id AND (p_facility_id IS NULL OR d.facility_id=p_facility_id)
      AND (d.status='queued' OR (d.status='sending' AND d.claimed_at < p_at - haven.observation_delivery_claim_timeout() AND d.send_attempts < haven.observation_delivery_max_attempts())) AND d.channel='in_app' AND d.send_after <= p_at
      AND NOT (EXISTS (SELECT 1 FROM public.user_profiles up
 JOIN public.observation_escalation_dispatches dispatch ON dispatch.id=d.dispatch_id AND dispatch.escalation_id IS NOT NULL
 WHERE up.id=d.target_user_id AND up.organization_id=d.organization_id
 AND up.is_active AND up.deleted_at IS NULL
 AND (up.app_role IN ('owner','org_admin') OR (up.app_role IN ('facility_admin','manager','nurse')
 AND EXISTS(SELECT 1 FROM public.user_facility_access ufa WHERE ufa.user_id=up.id AND ufa.facility_id=d.facility_id AND ufa.organization_id=d.organization_id AND ufa.revoked_at IS NULL))))) RETURNING d.id
  ), exhausted AS (
    -- A claim nobody came back for, on a delivery that has already had its
    -- chances. Failed rather than handed out again: this is the branch that
    -- turns an unbounded resend into a terminal state somebody can see.
    UPDATE
      public.observation_escalation_deliveries d
    SET
      status = 'failed',
      error_message = 'Abandoned mid send and out of attempts',
      claim_token = NULL,
      updated_at = now()
    WHERE
      d.organization_id = p_organization_id
      AND (p_facility_id IS NULL
        OR d.facility_id = p_facility_id)
      AND d.status = 'sending'
      AND d.claimed_at < p_at - haven.observation_delivery_claim_timeout ()
      AND d.send_attempts >= haven.observation_delivery_max_attempts ()
    RETURNING
      d.id
),
claimed AS (
  UPDATE
    public.observation_escalation_deliveries d
  SET
    status = 'sending',
    claimed_at = p_at,
    claim_token = p_claim_token,
    send_attempts = d.send_attempts + 1,
    updated_at = now()
  WHERE
    d.id IN (
      SELECT
        candidate.id
      FROM
        public.observation_escalation_deliveries candidate
      WHERE
        candidate.organization_id = p_organization_id
        AND (p_facility_id IS NULL
          OR candidate.facility_id = p_facility_id)
        AND (candidate.channel <> 'in_app' OR (EXISTS (SELECT 1 FROM public.user_profiles up
 JOIN public.observation_escalation_dispatches dispatch ON dispatch.id=candidate.dispatch_id AND dispatch.escalation_id IS NOT NULL
 WHERE up.id=candidate.target_user_id AND up.organization_id=candidate.organization_id
 AND up.is_active AND up.deleted_at IS NULL
 AND (up.app_role IN ('owner','org_admin') OR (up.app_role IN ('facility_admin','manager','nurse')
 AND EXISTS(SELECT 1 FROM public.user_facility_access ufa WHERE ufa.user_id=up.id AND ufa.facility_id=candidate.facility_id AND ufa.organization_id=candidate.organization_id AND ufa.revoked_at IS NULL))))))
        AND candidate.send_after <= p_at
        AND candidate.send_attempts < haven.observation_delivery_max_attempts ()
        AND (candidate.status = 'queued'
          -- A claim its owner never finished. The tick that took it is gone.
          OR (candidate.status = 'sending'
            AND candidate.claimed_at < p_at - haven.observation_delivery_claim_timeout ()))
      ORDER BY
        candidate.send_after
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 500)
      FOR UPDATE
        SKIP LOCKED)
  RETURNING
    d.id,
    d.organization_id,
    d.facility_id,
    d.dispatch_id,
    d.rung_key,
    d.target_user_id,
    d.target_phone,
    d.channel,
    d.is_test,
    d.message_body
)
  SELECT
    *
  FROM
    claimed;
$func$;
COMMIT;
