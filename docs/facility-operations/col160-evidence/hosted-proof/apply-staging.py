#!/usr/bin/env python3
"""Apply exactly reviewed371 and its ledger row atomically to verified staging."""
import argparse,datetime,json
from guarded import Runtime,ROOT,OUT,REF,MIGRATION,digest,require
def literal(v):return "'"+str(v).replace("'","''")+"'"
def validate_ledger(ledger,migration_paths):
 """Accept the exact reviewed local version set, before or after371 only.

 Timestamp migrations are ordinary members of that set, not numeric successors
 of371. Unknown timestamps, omissions and duplicates still fail closed.
 """
 local_versions=[path.name.split('_',1)[0] for path in migration_paths]
 require(len(local_versions)==len(set(local_versions)),'Duplicate local migration versions')
 expected=set(local_versions);target=MIGRATION.split('_',1)[0]
 require(target in expected,'Reviewed target migration absent locally')
 require(isinstance(ledger,list) and all(isinstance(row,dict) and isinstance(row.get('version'),str) for row in ledger),'Invalid ledger metadata')
 versions=[row['version'] for row in ledger]
 require(len(versions)==len(set(versions)),'Duplicate ledger versions')
 actual=set(versions)
 require(actual in (expected-{target},expected),'Unexpected ledger version set')
 return actual

def build_apply_query(source,versions):
 require(source.strip().startswith('BEGIN;') and source.strip().endswith('COMMIT;'),'Unexpected migration transaction shape')
 body=source.strip()[6:-7]
 expected_array='ARRAY['+','.join(literal(v) for v in sorted(versions))+']::text[]'
 return "BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s'; LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE; DO $$ BEGIN IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>"+str(len(versions))+" OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='371') OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='370') OR (SELECT array_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations) IS DISTINCT FROM "+expected_array+" THEN RAISE EXCEPTION 'Ledger changed'; END IF; END $$;\n"+body+"\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('371','hfo_corporate_deliverables',ARRAY["+literal(source)+"]); NOTIFY pgrst,'reload schema'; COMMIT;"

def read_posture(runtime):
 """The reviewed371 API uses current-authority-checked definers, not invokers."""
 posture={}
 for signature in ['public.corporate_deliverable_snapshot(uuid,date,date)','public.corporate_deliverable_command(uuid,text,text,jsonb)','public.corporate_deliverable_history(uuid,uuid,integer,bigint)']:
  query="SELECT json_build_object('security_definer',p.prosecdef,'fixed_empty_search_path',coalesce(p.proconfig,ARRAY[]::text[])=ARRAY['search_path=\"\"']::text[],'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'anon_denied',NOT has_function_privilege('anon',p.oid,'EXECUTE'),'service_denied',NOT has_function_privilege('service_role',p.oid,'EXECUTE'),'public_denied',NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p WHERE p.oid=to_regprocedure("+literal(signature)+")"
  value=json.loads(runtime.sql(query));require(isinstance(value,dict) and len(value)==6 and all(v is True for v in value.values()),'Unexpected reviewed corporate RPC posture: '+signature);posture[signature]=value
 return posture

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['inspect','apply']);p.add_argument('--ready',required=True);args=p.parse_args()
 r=Runtime(args.ready);project=r.identify();source=(ROOT/'supabase/migrations'/MIGRATION).read_text();sha=digest(source.encode())
 ledger=json.loads(r.sql("SELECT json_agg(x ORDER BY version) FROM (SELECT version,name FROM supabase_migrations.schema_migrations) x"))
 versions=validate_ledger(ledger,(ROOT/'supabase/migrations').glob('*.sql'))
 if '371' in versions:
  stored=r.sql("SELECT statements[1] FROM supabase_migrations.schema_migrations WHERE version='371'")
  require(stored.strip()==source.strip(),'Existing371 ledger does not match reviewed source')
 elif args.action=='apply':
  query=build_apply_query(source,versions)
  r.identify();r.sql(query)
 else:
  print(json.dumps({'target':REF,'pending':'371','mutation':False}));return
 posture=read_posture(r)
 result={'result':'PASS','target':REF,'sourceSha':r.ready['sourceSha'],'migration_sha256':sha,'project':project,'posture':posture,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Staging additive371 only; no rule publication or operating acceptance'}
 (OUT/'staging-readiness.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main()
