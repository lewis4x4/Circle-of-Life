-- HFA-014: rollback-only synthetic local PostgreSQL replay, not hosted Auth proof.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA haven,auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE TEMP TABLE money_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() actor_session,
 gen_random_uuid() canonical_resident,gen_random_uuid() mixed_resident,gen_random_uuid() legacy_resident,
 gen_random_uuid() canonical_account,gen_random_uuid() mixed_account,
 id facility,entity_id entity,organization_id org FROM public.facilities WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT actor,actor||'@money.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{}' FROM money_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT actor,actor||'@money.invalid','Synthetic money reviewer','owner',org,true FROM money_fixture
 ON CONFLICT(id) DO UPDATE SET app_role='owner',organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT actor_session,actor FROM money_fixture;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,
 'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,
 'role','authenticated','app_metadata',jsonb_build_object('app_role','owner','organization_id',f.org))::text,true)
 FROM money_fixture f JOIN public.user_profiles p ON p.id=f.actor;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender)
 SELECT canonical_resident,org,facility,'Synthetic','Canonical','1940-01-01','female'::public.gender FROM money_fixture
 UNION ALL SELECT mixed_resident,org,facility,'Synthetic','Mixed','1940-01-01'::date,'female'::public.gender FROM money_fixture
 UNION ALL SELECT legacy_resident,org,facility,'Synthetic','Legacy','1940-01-01'::date,'female'::public.gender FROM money_fixture;
INSERT INTO public.resident_trust_accounts(id,organization_id,facility_id,resident_id)
 SELECT canonical_account,org,facility,canonical_resident FROM money_fixture
 UNION ALL SELECT mixed_account,org,facility,mixed_resident FROM money_fixture;
SELECT public.post_cash_transaction('trust',gen_random_uuid(),canonical_account,'deposit',2000000000,'other','Synthetic canonical funds') FROM money_fixture;
SELECT public.post_cash_transaction('trust',gen_random_uuid(),mixed_account,'deposit',2000000000,'other','Synthetic mixed funds') FROM money_fixture;
INSERT INTO public.trust_account_entries(resident_id,organization_id,facility_id,entry_date,entry_type,amount_cents,balance_after_cents)
 SELECT mixed_resident,org,facility,current_date,'deposit',250,250 FROM money_fixture
 UNION ALL SELECT legacy_resident,org,facility,current_date,'deposit',300,300 FROM money_fixture;
GRANT SELECT ON money_fixture TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; snapshot jsonb; canonical jsonb; mixed jsonb; legacy jsonb; BEGIN
 SELECT * INTO f FROM money_fixture;
 snapshot:=public.resident_money_snapshot(f.org,f.facility);
 SELECT value INTO canonical FROM jsonb_array_elements(snapshot->'rows') WHERE value->>'resident_id'=f.canonical_resident::text;
 SELECT value INTO mixed FROM jsonb_array_elements(snapshot->'rows') WHERE value->>'resident_id'=f.mixed_resident::text;
 SELECT value INTO legacy FROM jsonb_array_elements(snapshot->'rows') WHERE value->>'resident_id'=f.legacy_resident::text;
 IF canonical->>'balance_cents'<>'2000000000' OR canonical->>'legacy_review_required'<>'false' OR canonical->>'ledger_matches_balance'<>'true' THEN RAISE EXCEPTION 'Canonical account and ledger disagree'; END IF;
 IF mixed->>'balance_cents'<>'2000000000' OR mixed->>'legacy_balance_cents'<>'250' OR mixed->>'legacy_review_required'<>'true' THEN RAISE EXCEPTION 'Mixed records were silently summed/discarded'; END IF;
 IF legacy->>'balance_cents' IS NOT NULL OR legacy->>'legacy_balance_cents'<>'300' OR legacy->>'legacy_review_required'<>'true' THEN RAISE EXCEPTION 'Legacy-only source became fake canonical zero'; END IF;
 IF (canonical->>'balance_cents')::bigint+(mixed->>'balance_cents')::bigint<>4000000000::bigint THEN RAISE EXCEPTION 'Aggregate exceeded32-bit representation'; END IF;
 IF snapshot->>'external_reconciliation'<>'NOT_VERIFIED' THEN RAISE EXCEPTION 'Snapshot claimed unperformed bank/book reconciliation'; END IF;
 BEGIN PERFORM public.resident_money_snapshot(gen_random_uuid(),NULL); RAISE EXCEPTION 'Wrong org read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'HFA-014/HFA-016:6 snapshot assertions passed';
END $$;
RESET ROLE;
DELETE FROM auth.sessions WHERE id=(SELECT actor_session FROM money_fixture);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.resident_money_snapshot((SELECT org FROM money_fixture),NULL); RAISE EXCEPTION 'Revoked reader accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'HFA-011/HFA-014:revoked reader denied';
END $$;
ROLLBACK;
