-- PostgREST's safeupdate rejects unqualified DELETE without a WHERE clause,
-- including temporary tables. Hosted API red proof: SQLSTATE 21000,
-- "DELETE requires a WHERE clause". The isolated replay lacks that extension;
-- verify the reset contract plus its actual per-call isolation here.
BEGIN;
DO $$
DECLARE v_fac uuid; v_result jsonb; v_definition text;
BEGIN
 SELECT pg_get_functiondef('public.evaluate_watchlist_signals(uuid,timestamptz)'::regprocedure)
 INTO v_definition;
 IF v_definition !~* 'TRUNCATE\s+TABLE\s+pg_temp\.watchlist_eval_match'
   OR v_definition ~* 'DELETE\s+FROM\s+watchlist_eval_match\s*;'
 THEN RAISE EXCEPTION 'Watchlist scratch reset is not hosted-safeupdate compatible'; END IF;
 SELECT id INTO STRICT v_fac FROM facilities WHERE deleted_at IS NULL ORDER BY id LIMIT 1;
 v_result := public.evaluate_watchlist_signals(v_fac,now());
 IF (v_result->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'First evaluation failed'; END IF;
 INSERT INTO pg_temp.watchlist_eval_match(signal_rule_id,signal_key,resident_id,observed_count,evidence)
 VALUES(gen_random_uuid(),'synthetic_previous_call_sentinel',gen_random_uuid(),1,'{}');
 v_result := public.evaluate_watchlist_signals(v_fac,now());
 IF (v_result->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Repeated evaluation failed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.watchlist_eval_match WHERE signal_key='synthetic_previous_call_sentinel')
 THEN RAISE EXCEPTION 'Repeated evaluation retained previous-call working rows'; END IF;
 IF has_function_privilege('authenticated','public.evaluate_watchlist_signals(uuid,timestamptz)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.evaluate_watchlist_signals(uuid,timestamptz)','EXECUTE')
 THEN RAISE EXCEPTION 'Evaluator service-only grant changed'; END IF;
END $$;
ROLLBACK;
