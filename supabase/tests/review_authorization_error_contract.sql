BEGIN;
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',true);
DO $$
DECLARE message_text text; detail_text text;
BEGIN
  BEGIN
    PERFORM public.haven_assert_authorized_request();
    RAISE EXCEPTION 'Missing actor was accepted';
  EXCEPTION WHEN SQLSTATE 'PGRST' THEN
    GET STACKED DIAGNOSTICS message_text=MESSAGE_TEXT,detail_text=PG_EXCEPTION_DETAIL;
    IF message_text::jsonb->>'code' IS DISTINCT FROM 'HAVEN_AUTHORIZATION_STALE'
      OR detail_text::jsonb->>'status' IS DISTINCT FROM '401'
      OR jsonb_typeof(detail_text::jsonb->'headers') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Custom denial is not a valid PostgREST HTTP error';
    END IF;
  END;
END $$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT public.haven_assert_authorized_request();
ROLLBACK;
