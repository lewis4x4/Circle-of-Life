-- Forward reconciliation: fresh installs and already-patched staging retain
-- the exact private-helper and service-only writer boundary.
BEGIN;
DO $privileges$
DECLARE signature text; function_id oid;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'haven.visitor_kiosk_note_failure(uuid)',
    'haven.visitor_kiosk_throttled(uuid)',
    'haven.observation_clock_in_lead(uuid)',
    'haven.observation_shift_owner_staff(uuid,timestamptz,timestamptz)',
    'haven.resolve_observation_task_assignees_at(uuid,date,text,uuid[],timestamptz)',
    'haven.observation_shift_staffing_state(uuid,text,date,timestamptz)'
  ] LOOP
    function_id:=signature::regprocedure;
    IF has_function_privilege('anon',function_id,'EXECUTE')
      OR has_function_privilege('authenticated',function_id,'EXECUTE')
      OR has_function_privilege('service_role',function_id,'EXECUTE')
      OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_id AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'Private prerequisite helper % exposes EXECUTE',signature;
    END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY[
    'public.visitor_kiosk_sign_out(text,uuid)',
    'public.record_observation_staffing_gap(uuid,text,date)',
    'public.resolve_observation_staffing_gap(uuid,text,date)'
  ] LOOP
    function_id:=signature::regprocedure;
    IF has_function_privilege('anon',function_id,'EXECUTE')
      OR has_function_privilege('authenticated',function_id,'EXECUTE')
      OR NOT has_function_privilege('service_role',function_id,'EXECUTE')
      OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=function_id AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'Prerequisite writer % is not service-only',signature;
    END IF;
  END LOOP;
END $privileges$;
ROLLBACK;
