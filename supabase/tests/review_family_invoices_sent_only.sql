-- COL-709: a family member with financial access sees sent invoices, never
-- drafts or never-sent voids. Disposable local replay only; rolls back.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
-- The replay has no Supabase default privileges; hosted grants SELECT already.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;

CREATE TEMP TABLE fam_fixture AS
SELECT gen_random_uuid() family_user, gen_random_uuid() family_session,
  i.resident_id, i.facility_id, i.organization_id org, i.entity_id
FROM public.invoices i WHERE i.deleted_at IS NULL LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM fam_fixture) THEN RAISE EXCEPTION 'Local replay seed invoice required'; END IF; END $$;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT family_user, family_user||'@review.invalid', jsonb_build_object('organization_id',org,'app_role','family'),
  jsonb_build_object('full_name','Review family') FROM fam_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
SELECT family_user, family_user||'@review.invalid','Review family','family'::public.app_role,org,true FROM fam_fixture
ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT family_session,family_user FROM fam_fixture;
INSERT INTO public.family_resident_links(user_id,resident_id,organization_id,relationship,can_view_financial)
SELECT family_user,resident_id,org,'child',true FROM fam_fixture;

-- The resident's seeded invoices are replaced by one of each case.
UPDATE public.invoices SET deleted_at = now() WHERE resident_id = (SELECT resident_id FROM fam_fixture) AND deleted_at IS NULL;
INSERT INTO public.invoices(resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,
  period_start,period_end,status,subtotal,total,amount_paid,balance_due,sent_at)
SELECT f.resident_id,f.facility_id,f.org,f.entity_id,'COL709-'||v.label,v.period_start,v.period_start + 29,
  v.period_start,v.period_start + 29,v.status::public.invoice_status,100,100,0,100,v.sent_at
FROM fam_fixture f CROSS JOIN (VALUES
  ('draft','draft',NULL::timestamptz,DATE '2031-01-01'),
  ('sent','sent',NULL,DATE '2031-02-01'),
  ('overdue','overdue',NULL,DATE '2031-03-01'),
  ('void-unsent','void',NULL,DATE '2031-04-01'),
  ('void-sent','void',TIMESTAMPTZ '2031-05-02 12:00Z',DATE '2031-05-01')
) AS v(label,status,sent_at,period_start);

SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.family_user,'session_id',f.family_session,
  'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,
  'role','authenticated','app_role','family','organization_id',f.org,
  'app_metadata',jsonb_build_object('app_role','family','organization_id',f.org))::text,true)
FROM fam_fixture f JOIN public.user_profiles p ON p.id=f.family_user;
GRANT SELECT ON fam_fixture TO authenticated;
SET LOCAL ROLE authenticated;

DO $$
DECLARE seen text;
BEGIN
  SELECT string_agg(replace(invoice_number,'COL709-',''),',' ORDER BY invoice_number) INTO seen
  FROM public.invoices WHERE resident_id = (SELECT resident_id FROM fam_fixture) AND invoice_number LIKE 'COL709-%';
  IF seen IS DISTINCT FROM 'overdue,sent,void-sent' THEN
    RAISE EXCEPTION 'family invoice visibility wrong: saw %, expected overdue,sent,void-sent', coalesce(seen,'nothing');
  END IF;
END $$;

ROLLBACK;
