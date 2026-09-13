-- F03 scoped discovery. Each response is a live page, never an export snapshot.
BEGIN;
CREATE INDEX finance_batches_review_order ON public.finance_batches(entity_id,created_at DESC,id DESC);
CREATE INDEX finance_rules_review_order ON public.finance_batch_rule_versions(entity_id,created_at DESC,id DESC);
CREATE FUNCTION haven.finance_review_queue(
 p_entity uuid,p_facility uuid,p_kind text,p_after_created_at timestamptz,p_after_id uuid,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_items jsonb; v_more boolean; v_cursor jsonb; v_count bigint; v_gaps bigint; v_stopped boolean;
BEGIN
 PERFORM haven.assert_finance_batch_actor(p_entity,p_facility);
 IF p_kind IS NULL OR p_kind NOT IN('events','batches','rules') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
  OR (p_after_created_at IS NULL)<>(p_after_id IS NULL)
  OR (p_after_created_at IS NOT NULL AND NOT isfinite(p_after_created_at)) THEN
  RAISE EXCEPTION 'Valid queue kind, bounded page size and complete cursor required' USING ERRCODE='22023';
 END IF;

 -- Keep payload/membership/session evidence on the separately authorized detail
 -- endpoint. A facility-scoped preparer cannot discover broader batch contents.
 WITH records AS NOT MATERIALIZED (
  SELECT e.id,e.created_at,jsonb_build_object('id',e.id,'created_at',e.created_at,
   'facility_id',e.facility_id,'operation',e.operation,'source_type',e.source_type,
   'source_id',e.source_id,'source_version',e.source_version,'amount_basis',e.amount_basis,
   'control_total_cents',e.control_total_cents::text,'claimed',claim.event_id IS NOT NULL,
   'claimed_batch_id',CASE WHEN (p_facility IS NULL OR b.facility_id=p_facility)
     AND haven.can_read_finance_staging(b.organization_id,b.entity_id,b.facility_id) THEN b.id ELSE NULL END
  ) AS document
  FROM public.finance_source_events e
  LEFT JOIN public.finance_batch_event_claims claim ON claim.event_id=e.id
  LEFT JOIN public.finance_batches b ON b.id=claim.batch_id
  WHERE p_kind='events' AND e.organization_id=haven.organization_id() AND e.entity_id=p_entity
   AND (p_facility IS NULL OR e.facility_id=p_facility)
   AND haven.can_read_finance_staging(e.organization_id,e.entity_id,e.facility_id)
  UNION ALL
  SELECT b.id,b.created_at,jsonb_build_object('id',b.id,'created_at',b.created_at,
   'facility_id',b.facility_id,'accounting_date',to_char(b.accounting_date,'YYYY-MM-DD'),
   'status',CASE WHEN b.status IN('prepared','locally_approved_dispatch_disabled') AND invalid.reason IS NOT NULL THEN 'invalidated' ELSE b.status END,
   'invalid_reason',invalid.reason,'source_controls',b.source_controls,'binding_sha256',b.binding_sha256,
   'accounting_classification',b.accounting_classification,'business_release_eligible',b.business_release_eligible,
   'dispatch_enabled',b.dispatch_enabled
  ) FROM public.finance_batches b
  CROSS JOIN LATERAL (SELECT haven.finance_batch_invalid_reason(b) AS reason) invalid
  WHERE p_kind='batches' AND b.organization_id=haven.organization_id() AND b.entity_id=p_entity
   AND (p_facility IS NULL OR b.facility_id=p_facility)
   AND haven.can_read_finance_staging(b.organization_id,b.entity_id,b.facility_id)
  UNION ALL
  SELECT r.id,r.created_at,jsonb_build_object('id',r.id,'created_at',r.created_at,
   'mapping',r.mapping,'content_sha256',r.content_sha256,'policy_reference_sha256',r.policy_reference_sha256,
   'status',r.status,'is_current',binding.version_id=r.id,
   'current_generation',binding.generation::text
  ) FROM public.finance_batch_rule_versions r
  LEFT JOIN public.finance_batch_rule_bindings binding ON binding.entity_id=r.entity_id
  WHERE p_kind='rules' AND r.organization_id=haven.organization_id() AND r.entity_id=p_entity
 ), candidates AS MATERIALIZED (
  SELECT * FROM records WHERE p_after_created_at IS NULL OR (created_at,id)<(p_after_created_at,p_after_id)
  ORDER BY created_at DESC,id DESC LIMIT p_limit+1
 ), page AS MATERIALIZED (
  SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT p_limit
 ) SELECT
  (SELECT coalesce(jsonb_agg(document ORDER BY created_at DESC,id DESC),'[]'::jsonb) FROM page),
  (SELECT count(*)>p_limit FROM candidates),
  (SELECT jsonb_build_object('created_at',created_at,'id',id) FROM page ORDER BY created_at,id LIMIT 1),
  (SELECT count(*) FROM records)
 INTO v_items,v_more,v_cursor,v_count;

 SELECT count(*) INTO v_gaps FROM public.finance_command_receipts r
 WHERE r.organization_id=haven.organization_id() AND r.entity_id=p_entity
  AND r.command_type IN('payment','invoice_post','manual_post','reversal')
  AND (p_facility IS NULL OR r.facility_id=p_facility)
  AND haven.can_read_finance_staging(r.organization_id,r.entity_id,r.facility_id)
  AND NOT EXISTS(SELECT 1 FROM public.finance_source_events e WHERE e.receipt_type=r.command_type AND e.receipt_id=r.id);
 SELECT coalesce((SELECT stopped FROM public.finance_staging_controls WHERE entity_id=p_entity),true) INTO v_stopped;
 RETURN jsonb_build_object('kind',p_kind,'organization_id',haven.organization_id(),'entity_id',p_entity,'facility_id',p_facility,
  'observed_at',statement_timestamp(),'consistency','live_page','items',v_items,
  'total_count',v_count::text,'returned_count',jsonb_array_length(v_items),
  'has_more',v_more,'next_cursor',CASE WHEN v_more THEN v_cursor ELSE NULL END,
  'coverage_scope','finance_command_receipts_336_only','unrepresented_eligible_receipts',v_gaps::text,
  'staging_stopped',v_stopped,'business_release_eligible',false,'dispatch_enabled',false);
END $$;
CREATE FUNCTION public.finance_review_queue(
 p_entity uuid,p_facility uuid DEFAULT NULL,p_kind text DEFAULT 'events',
 p_after_created_at timestamptz DEFAULT NULL,p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT haven.finance_review_queue(p_entity,p_facility,p_kind,p_after_created_at,p_after_id,p_limit)
$$;
REVOKE ALL ON FUNCTION haven.finance_review_queue(uuid,uuid,text,timestamptz,uuid,integer),public.finance_review_queue(uuid,uuid,text,timestamptz,uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.finance_review_queue(uuid,uuid,text,timestamptz,uuid,integer),public.finance_review_queue(uuid,uuid,text,timestamptz,uuid,integer) TO authenticated;
COMMIT;
