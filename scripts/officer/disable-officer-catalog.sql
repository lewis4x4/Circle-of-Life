-- Officer capability catalog kill switch (hard). Modelled on scripts/stand-up/disable-pilot.sql.
-- Revokes the only doors Front Office can reach; retains every audit row, receipt,
-- registry row and key. The Edge Function then answers 503 target_unavailable.
-- Soft alternative that keeps the grants: UPDATE officer.gateway_keys SET enabled = false WHERE key_id = 'front_office_v1';
BEGIN;
REVOKE EXECUTE ON FUNCTION public.officer_catalog(text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.officer_execute(text,uuid,text,text,text,uuid,timestamptz,text,integer,jsonb,text,jsonb) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.officer_key_secret_env(text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.officer_record_refusal(text,uuid,text,integer,uuid,text) FROM service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
-- Reactivation restores only the four grants above (the section 8 block of
-- migration 339) after the cause is understood; never re-run migration 308's sweep.
