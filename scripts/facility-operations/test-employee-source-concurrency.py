#!/usr/bin/env python3
"""Actual local task-source serialization; no hosted connection supported."""
import json,os,time,threading,uuid
from pathlib import Path
import psycopg
ROOT=Path(__file__).resolve().parents[2]
SOCKET=Path(os.environ['PG_VERIFY_NATIVE_SOCKET']).resolve();assert str(SOCKET).startswith(str(Path.home()/'.hermes/tmp/agent-runs')+'/')
PORT=int(os.environ.get('PG_VERIFY_NATIVE_PORT','55519'));BASE=os.environ['HFO_EMPLOYEE_SOURCE_BASELINE_DB'];assert BASE.startswith('col156_')
def conn(db):return psycopg.connect(host=str(SOCKET),port=PORT,user='postgres',dbname=db,autocommit=True)
def setup(db):
 s=(ROOT/'supabase/tests/review_hfo_employee_source_snapshots.sql').read_text().split('CREATE TEMP TABLE es_a AS')[0]
 with conn(db) as c:
  c.execute(s);f=c.execute("SELECT jsonb_build_object('actor',admin,'session',admin_session,'org',org,'site',facility,'employee',employee,'task',task) FROM employee_fixture,es").fetchone()[0];c.execute('COMMIT');return f
def login(c,f):
 c.execute('BEGIN');v=c.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s',(f['actor'],)).fetchone()[0]
 c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':f['actor'],'session_id':f['session'],'organization_id':f['org'],'app_role':'owner','role':'authenticated','auth_claim_version':v,'iat':int(time.time())}),));c.execute('SET LOCAL ROLE authenticated')
results=[]
for case in ['same-key','medical-revocation']:
 db='col156_race_'+uuid.uuid4().hex[:8];admin=conn('postgres');admin.execute(psycopg.sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(psycopg.sql.Identifier(db),psycopg.sql.Identifier(BASE)))
 try:
  f=setup(db)
  with conn(db) as a,conn(db) as b,conn(db) as observer:
   if case=='medical-revocation':
    observer.execute("INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record) VALUES(%s,%s,%s,'employee_medical',%s,'Synthetic medical race',true)",(f['org'],f['site'],f['actor'],f['actor']))
    login(a,f);a.execute("SELECT public.haven_employee_requirement_command(%s,'grant_medical',jsonb_build_object('user_id',%s::uuid,'review_note','Synthetic medical race'))",(f['site'],f['actor']));a.execute('COMMIT')
   login(a,f)
   if case=='same-key':a.execute('SELECT public.employee_operation_source_snapshot(%s,%s)',(f['task'],'race-refresh-001'))
   else:a.execute("SELECT pg_advisory_xact_lock(hashtextextended('employee-source:'||%s::text||':'||%s::text,0))",(f['task'],f['actor']))
   login(b,f);pid=b.info.backend_pid;out={}
   def run():
    try:out['result']=b.execute('SELECT public.employee_operation_source_snapshot(%s,%s)',(f['task'],'race-refresh-001')).fetchone()[0];b.execute('COMMIT')
    except Exception as e:out['error']=getattr(e,'sqlstate',None);b.execute('ROLLBACK')
   t=threading.Thread(target=run);t.start();deadline=time.monotonic()+10
   while time.monotonic()<deadline:
    if observer.execute('SELECT cardinality(pg_blocking_pids(%s))>0',(pid,)).fetchone()[0]:break
    time.sleep(.02)
   else:raise AssertionError('No actual wait')
   if case=='medical-revocation':observer.execute('UPDATE public.employee_medical_access SET revoked_at=now() WHERE user_id=%s AND facility_id=%s',(f['actor'],f['site']))
   a.execute('COMMIT');t.join(15);assert not t.is_alive() and 'error' not in out,out
   assert len(out['result']['history'])==1
   if case=='medical-revocation':assert out['result']['can_medical'] is False
   results.append({'case':case,'wait_observed':True,'status':'PASS'})
 finally:admin.execute(psycopg.sql.SQL('DROP DATABASE {} WITH (FORCE)').format(psycopg.sql.Identifier(db)));admin.close()
print(json.dumps({'scope':'native synthetic concurrency','results':results},indent=2))
