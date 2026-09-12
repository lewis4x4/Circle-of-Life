-- STAGING ONLY. Not a migration; apply once immediately after replay and before
-- enabling email login or creating proof users. Retains every catalog/foreign key.
-- The integrator must independently confirm project iwcnajanvjvynolltflw via
-- Management API, then execute this file in the same SQL session as:
-- SET haven.staging_project_ref = 'iwcnajanvjvynolltflw';
-- The setting is an execution acknowledgment, not independent target evidence.
BEGIN;
DO $$ BEGIN
 IF current_setting('haven.staging_project_ref',true) IS DISTINCT FROM 'iwcnajanvjvynolltflw' THEN
  RAISE EXCEPTION 'Refusing sanitization without the independently verified HFO staging target acknowledgment';
 END IF;
END $$;
-- All auth users at this point came from repository replay, before proof users.
-- Fresh staging only: ban every inherited login; randomize hashes so no known
-- demo password remains usable if a ban is accidentally removed.
DO $sanitize$ DECLARE crypto_schema text; BEGIN
 SELECT n.nspname INTO STRICT crypto_schema FROM pg_catalog.pg_extension e
 JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto';
 EXECUTE format($update$UPDATE auth.users SET banned_until='2099-01-01'::timestamptz,
 encrypted_password=%I.crypt(gen_random_uuid()::text,%I.gen_salt('bf')),
 email='disabled-seed-'||id||'@example.invalid',
 raw_user_meta_data='{"full_name":"Disabled synthetic seed"}'::jsonb$update$,crypto_schema,crypto_schema);
END $sanitize$;
UPDATE auth.identities SET identity_data=jsonb_set(identity_data,'{email}',to_jsonb('disabled-seed-'||user_id||'@example.invalid'))
 WHERE provider='email';
UPDATE public.user_profiles SET is_active=false,
 full_name='Disabled synthetic seed',email='disabled-seed-'||id||'@example.invalid',phone=NULL;
UPDATE public.organizations SET name='Synthetic HFO staging organization',dba_name='Synthetic HFO staging',
 primary_contact_name='Synthetic contact',primary_contact_email='staging-contact@example.invalid',primary_contact_phone=NULL,
 address_line_1='Synthetic address',city='Synthetic city',state='FL',zip='00000'
 WHERE id='00000000-0000-0000-0000-000000000001';
UPDATE public.entities SET name='Synthetic entity '||right(id::text,4),dba_name='Synthetic entity '||right(id::text,4),
 fein=NULL,address_line_1='Synthetic address',city='Synthetic city',state='FL',zip='00000'
 WHERE organization_id='00000000-0000-0000-0000-000000000001';
UPDATE public.facilities SET name='Synthetic facility '||right(id::text,4),
 address_line_1='Synthetic address',city='Synthetic city',state='FL',zip='00000',county='Synthetic county',phone=NULL,
 email='facility-'||right(id::text,4)||'@example.invalid'
 WHERE organization_id='00000000-0000-0000-0000-000000000001';
COMMIT;
