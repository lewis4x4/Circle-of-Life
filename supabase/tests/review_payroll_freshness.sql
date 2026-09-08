-- Disposable PostgreSQL replay only. Fixture records and auth adaptation roll back.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE payroll_fixture AS SELECT gen_random_uuid() actor, gen_random_uuid() actor_session, gen_random_uuid() account, gen_random_uuid() deposit,
 gen_random_uuid() withdrawal,gen_random_uuid() journal,gen_random_uuid() debit_account,gen_random_uuid() credit_account,
 gen_random_uuid() employee,gen_random_uuid() punch,gen_random_uuid() resident,f.id facility,f.entity_id entity,f.organization_id org
 FROM public.facilities f WHERE f.deleted_at IS NULL AND f.entity_id IS NOT NULL LIMIT 1;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM payroll_fixture) THEN RAISE EXCEPTION 'Replay seed facility required'; END IF; END $$;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),jsonb_build_object('full_name','Review finance') FROM payroll_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT actor,actor||'@review.invalid','Review finance','owner',org,true FROM payroll_fixture
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT actor,facility,org FROM payroll_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT actor_session,actor FROM payroll_fixture;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,
  'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,
  'role','authenticated','app_role','owner','organization_id',f.org,
  'app_metadata',jsonb_build_object('app_role','owner','organization_id',f.org))::text,true)
FROM payroll_fixture f JOIN public.user_profiles p ON p.id=f.actor;
INSERT INTO public.staff(id,organization_id,facility_id,user_id,first_name,last_name,staff_role,hire_date)
 SELECT employee,org,facility,actor,'Payroll','Employee','resident_aide',current_date FROM payroll_fixture;
INSERT INTO public.time_records(id,staff_id,facility_id,organization_id,clock_in,clock_out,clock_in_method,break_minutes,approved,approved_at,approved_by)
 SELECT punch,employee,facility,org,'2090-01-02 12:00Z','2090-01-02 20:00Z','manual',30,true,now(),actor FROM payroll_fixture;
INSERT INTO public.payroll_export_batches(id,organization_id,facility_id,period_start,period_end)
 SELECT journal,org,facility,'2090-01-01','2090-01-31' FROM payroll_fixture;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON payroll_fixture TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.payroll_export_lines,public.payroll_export_batches,public.time_records,public.staff TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; receipt jsonb; original_id uuid; revision bigint; old_payload jsonb; BEGIN
 SELECT * INTO f FROM payroll_fixture;
 receipt:=public.refresh_payroll_time_records(f.journal,f.actor);
 IF (receipt->>'added')::int<>1 THEN RAISE EXCEPTION 'Initial import failed'; END IF;
 SELECT id,payload,source_revision INTO original_id,old_payload,revision FROM payroll_export_lines WHERE batch_id=f.journal;
 PERFORM public.refresh_payroll_time_records(f.journal,f.actor);
 IF (SELECT count(*) FROM payroll_export_lines WHERE batch_id=f.journal)<>1 THEN RAISE EXCEPTION 'Retry duplicates wages'; END IF;
 PERFORM public.payroll_export_snapshot(f.journal);
 -- A correction and reapproval refreshes the ordinary active line in place too.
 UPDATE time_records SET clock_out='2090-01-02 20:30Z' WHERE id=f.punch;
 UPDATE time_records SET approved=true,approved_at=clock_timestamp(),approved_by=f.actor WHERE id=f.punch;
 BEGIN PERFORM public.payroll_export_snapshot(f.journal); RAISE EXCEPTION 'reapproved stale accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Payroll punches changed%' THEN RAISE; END IF; END;
 receipt:=public.refresh_payroll_time_records(f.journal,f.actor);
 IF (receipt->>'refreshed')::int<>1 OR (receipt->>'added')::int<>0
  OR (SELECT id FROM payroll_export_lines WHERE batch_id=f.journal)<>original_id
  OR (SELECT payload->>'actual_hours' FROM payroll_export_lines WHERE id=original_id)::numeric<>8 THEN
  RAISE EXCEPTION 'Corrected active draft line was not refreshed in place';
 END IF;
 PERFORM public.payroll_export_snapshot(f.journal);
 UPDATE time_records SET clock_out='2090-01-02 21:00Z' WHERE id=f.punch;
 BEGIN PERFORM public.payroll_export_snapshot(f.journal); RAISE EXCEPTION 'stale accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Payroll punches changed%' THEN RAISE; END IF; END;
 receipt:=public.refresh_payroll_time_records(f.journal,f.actor);
 IF (receipt->>'needs_review')::int<>1 THEN RAISE EXCEPTION 'Missing review path'; END IF;
 PERFORM public.exclude_payroll_draft_punch(f.journal,original_id,f.actor);
 IF (public.payroll_export_snapshot(f.journal)->>'line_count')::int<>0 THEN RAISE EXCEPTION 'Excluded line exported'; END IF;
 UPDATE time_records SET approved=true,approved_at=clock_timestamp(),approved_by=f.actor WHERE id=f.punch;
 BEGIN PERFORM public.payroll_export_snapshot(f.journal); RAISE EXCEPTION 'restored omission accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Payroll punches changed%' THEN RAISE; END IF; END;
 BEGIN UPDATE payroll_export_batches SET status='exported' WHERE id=f.journal; RAISE EXCEPTION 'restored omission frozen';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Payroll punches changed%' THEN RAISE; END IF; END;
 receipt:=public.refresh_payroll_time_records(f.journal,f.actor);
 IF (SELECT id FROM payroll_export_lines WHERE batch_id=f.journal)<>original_id
 OR (SELECT payload->>'actual_hours' FROM payroll_export_lines WHERE id=original_id)::numeric<>8.5 THEN RAISE EXCEPTION 'Refresh lost identity or hours'; END IF;
 BEGIN UPDATE payroll_export_lines SET source_revision=999999 WHERE id=original_id; RAISE EXCEPTION 'forged accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Payroll line must match a current approved punch' THEN RAISE; END IF; END;
 BEGIN UPDATE payroll_export_lines SET payload=jsonb_set(payload,'{actual_hours}','100') WHERE id=original_id; RAISE EXCEPTION 'forged accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Payroll line must match a current approved punch' THEN RAISE; END IF; END;
 BEGIN PERFORM public.refresh_payroll_time_records(f.journal,gen_random_uuid()); RAISE EXCEPTION 'wrong actor accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.payroll_export_snapshot(gen_random_uuid()); RAISE EXCEPTION 'unknown accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.exclude_payroll_draft_punch(f.journal,original_id,f.actor); RAISE EXCEPTION 'eligible exclusion accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Only ineligible draft%' THEN RAISE; END IF; END;
 UPDATE time_records SET payroll_source_revision=999999 WHERE id=f.punch;
 IF (SELECT payroll_source_revision FROM time_records WHERE id=f.punch)=999999 THEN RAISE EXCEPTION 'revision forge accepted'; END IF;
 -- Current draft export also blocks deleted and out-of-period sources; restoration is explicit.
 EXECUTE 'RESET ROLE'; -- privileged fixture setup: ordinary RLS forbids soft deletion
 UPDATE time_records SET deleted_at=clock_timestamp() WHERE id=f.punch;
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM public.payroll_export_snapshot(f.journal); RAISE EXCEPTION 'deleted accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Payroll punches changed%' THEN RAISE; END IF; END;
 EXECUTE 'RESET ROLE';
 UPDATE time_records SET deleted_at=NULL WHERE id=f.punch;
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM public.refresh_payroll_time_records(f.journal,f.actor);
 UPDATE time_records SET clock_in='2089-12-31 12:00Z' WHERE id=f.punch;
 BEGIN UPDATE payroll_export_batches SET status='exported' WHERE id=f.journal; RAISE EXCEPTION 'stale transition accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Payroll punches changed%' THEN RAISE; END IF; END;
 PERFORM public.exclude_payroll_draft_punch(f.journal,original_id,f.actor);
 UPDATE time_records SET clock_in='2090-01-02 12:00Z' WHERE id=f.punch;
 UPDATE time_records SET approved=true,approved_at=clock_timestamp(),approved_by=f.actor WHERE id=f.punch;
 PERFORM public.refresh_payroll_time_records(f.journal,f.actor);
 BEGIN UPDATE payroll_export_lines SET organization_id=gen_random_uuid() WHERE id=original_id; RAISE EXCEPTION 'scope accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Payroll line identity cannot change' THEN RAISE; END IF; END;
 UPDATE payroll_export_batches SET status='queued' WHERE id=f.journal;
 UPDATE payroll_export_batches SET status='failed' WHERE id=f.journal;
 UPDATE payroll_export_batches SET status='draft' WHERE id=f.journal;
 PERFORM public.refresh_payroll_time_records(f.journal,f.actor);
 UPDATE payroll_export_batches SET status='queued' WHERE id=f.journal;
 UPDATE payroll_export_batches SET status='exported' WHERE id=f.journal;
 SELECT payload INTO old_payload FROM payroll_export_lines WHERE id=original_id;
 UPDATE time_records SET clock_out='2090-01-02 22:00Z' WHERE id=f.punch;
 receipt:=public.payroll_export_snapshot(f.journal);
 IF receipt->'lines'->0->'payload' IS DISTINCT FROM old_payload THEN RAISE EXCEPTION 'Historical evidence changed'; END IF;
 BEGIN UPDATE payroll_export_lines SET payload='{}' WHERE id=original_id; RAISE EXCEPTION 'history edit accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Only draft payroll lines are editable' THEN RAISE; END IF; END;
 BEGIN UPDATE payroll_export_batches SET status='draft' WHERE id=f.journal; RAISE EXCEPTION 'reopen accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Historical payroll evidence cannot be changed' THEN RAISE; END IF; END;
 INSERT INTO payroll_export_batches(id,organization_id,facility_id,period_start,period_end) VALUES(f.account,f.org,f.facility,'2090-01-01','2090-01-31');
 UPDATE time_records SET approved=true,approved_at=clock_timestamp() WHERE id=f.punch;
 receipt:=public.refresh_payroll_time_records(f.account,f.actor);
 IF (receipt->>'other_batch')::int<>1 OR (SELECT count(*) FROM payroll_export_lines WHERE batch_id=f.account)<>0 THEN RAISE EXCEPTION 'Historical ownership was duplicated'; END IF;
 INSERT INTO payroll_export_lines(organization_id,batch_id,staff_id,line_kind,amount_cents,idempotency_key,payload) VALUES(f.org,f.account,f.employee,'manual_adjustment',123,'manual:'||f.account::text,'{}');
 IF (public.payroll_export_snapshot(f.account)->>'line_count')::int<>1 THEN RAISE EXCEPTION 'Manual line lost'; END IF;
 RAISE NOTICE 'PASS: stale source rejected; explicit exclusion/restoration retains identity; forged data rejected; history stable';
END $$;
ROLLBACK;
