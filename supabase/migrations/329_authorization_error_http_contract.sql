-- PostgREST requires a headers object in custom PGRST error DETAIL.
-- Preserve the denial predicate and named error while returning HTTP401 rather than PGRST121.
CREATE OR REPLACE FUNCTION public.haven_assert_authorized_request()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_claims jsonb;
BEGIN
  v_claims := auth.jwt();
  IF v_claims ->> 'role' IS DISTINCT FROM 'authenticated' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM haven.current_authorized_actor()) THEN
    RAISE SQLSTATE 'PGRST' USING
      MESSAGE=pg_catalog.json_build_object('code','HAVEN_AUTHORIZATION_STALE','message','Sign in again to continue.',
        'details','The Haven account, session, or authorization state is no longer current.','hint',NULL)::text,
      DETAIL=pg_catalog.json_build_object('status',401,'status_text','Unauthorized','headers',pg_catalog.json_build_object())::text;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.haven_assert_authorized_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.haven_assert_authorized_request() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
-- Rollback: retain this protocol correction; no data or permission expansion occurs.
