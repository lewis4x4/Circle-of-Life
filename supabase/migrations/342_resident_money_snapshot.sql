-- F02 read alignment only. No legacy balance is moved, summed or classified.
BEGIN;
CREATE FUNCTION public.resident_money_snapshot(p_organization_id uuid,p_facility_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF haven.authorized_user_id() IS NULL OR p_organization_id IS DISTINCT FROM haven.organization_id()
 OR haven.app_role() NOT IN('owner','org_admin','facility_admin')
 OR (p_facility_id IS NOT NULL AND NOT haven.has_facility_access(p_facility_id)) THEN
  RAISE EXCEPTION 'Resident money scope not authorized' USING ERRCODE='42501';
 END IF;
 -- All source reads share this statement snapshot and caller RLS. Missing
 -- canonical accounts remain null, never a fabricated zero or legacy sum.
 WITH accounts AS (
  SELECT * FROM public.resident_trust_accounts
  WHERE organization_id=p_organization_id AND deleted_at IS NULL
   AND (p_facility_id IS NULL OR facility_id=p_facility_id)
 ), legacy AS (
  SELECT DISTINCT ON(resident_id) resident_id,facility_id,balance_after_cents,entry_date,
   count(*) OVER(PARTITION BY resident_id) AS entry_count
  FROM public.trust_account_entries
  WHERE organization_id=p_organization_id AND deleted_at IS NULL
   AND (p_facility_id IS NULL OR facility_id=p_facility_id)
  ORDER BY resident_id,entry_date DESC,created_at DESC,id DESC
 ), scope AS (
  SELECT resident_id FROM accounts UNION SELECT resident_id FROM legacy
 ), movements AS (
  SELECT t.account_id,count(*) AS entry_count,
   sum(CASE WHEN t.direction='deposit' THEN t.amount_cents::bigint ELSE -t.amount_cents::bigint END) AS movement_cents,
   max(t.occurred_at) AS last_entry_at
  FROM public.resident_trust_transactions t JOIN accounts a ON a.id=t.account_id
  WHERE t.organization_id=p_organization_id AND t.deleted_at IS NULL
  GROUP BY t.account_id
 ) SELECT jsonb_build_object('as_of',statement_timestamp(),'canonical_ledger','resident_trust_transactions',
  'external_reconciliation','NOT_VERIFIED','rows',coalesce(jsonb_agg(jsonb_build_object(
   'resident_id',s.resident_id,'facility_id',coalesce(a.facility_id,l.facility_id),'account_id',a.id,
   'balance_cents',a.balance_cents,'ledger_movement_cents',coalesce(m.movement_cents,0)::text,
   'legacy_balance_cents',l.balance_after_cents,'legacy_entry_count',coalesce(l.entry_count,0),
   'ledger_entry_count',coalesce(m.entry_count,0),'last_entry_at',m.last_entry_at,
   'legacy_review_required',l.resident_id IS NOT NULL,
   'ledger_matches_balance',a.id IS NOT NULL AND a.balance_cents=coalesce(m.movement_cents,0)
  ) ORDER BY coalesce(a.facility_id,l.facility_id),s.resident_id),'[]')) INTO result
 FROM scope s LEFT JOIN accounts a USING(resident_id) LEFT JOIN legacy l USING(resident_id) LEFT JOIN movements m ON m.account_id=a.id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.resident_money_snapshot(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.resident_money_snapshot(uuid,uuid) TO authenticated;
COMMIT;
