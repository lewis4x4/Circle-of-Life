#!/usr/bin/env python3
"""Observed waits on owned native clones; no hosted target or real clinical data."""
import json, os, time, threading, uuid, hashlib
from pathlib import Path
import psycopg
ROOT=Path(__file__).resolve().parents[2]
SOCKET=Path(os.environ['PG_VERIFY_NATIVE_SOCKET']).resolve()
assert str(SOCKET).startswith(str(Path.home()/'.hermes/tmp/agent-runs')+'/')
PORT=int(os.environ.get('PG_VERIFY_NATIVE_PORT','55519'))
BASE=os.environ['HFO_PROVIDER_REPORT_BASELINE_DB'];assert BASE.startswith('col158_')
def conn(db):return psycopg.connect(host=str(SOCKET),port=PORT,user='postgres',dbname=db,autocommit=True)
def setup(db):
    sql=(ROOT/'supabase/tests/review_hfo_provider_reports.sql').read_text().split('CREATE FUNCTION pg_temp.pp_revision')[0]
    with conn(db) as c:
        c.execute(sql)
        f=c.execute("SELECT jsonb_build_object('actor',a.id,'session',a.session,'org',org,'site',site,'resident',resident,'task',task,'expectation',expectation,'version',version,'revision',revision,'day',(clock_timestamp() AT TIME ZONE 'America/New_York')::date,'document',(SELECT native_document_id FROM public.resident_document_versions WHERE id=pp.version)) FROM pp,pa a WHERE a.role='owner'").fetchone()[0]
        c.execute('COMMIT');return f
def login(c,f):
    c.execute('BEGIN');v=c.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s',(f['actor'],)).fetchone()[0]
    c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':f['actor'],'session_id':f['session'],'organization_id':f['org'],'role':'authenticated','app_role':'owner','auth_claim_version':v,'iat':int(time.time())}),));c.execute('SET LOCAL ROLE authenticated')
def receipt(f):return {'expectation_id':f['expectation'],'expected_revision':f['expectation'],'version_id':f['version'],'received_on':f['day'],'receipt_provenance':'Synthetic actual receipt'}
def direct(c,f,key='race-event-001',kind='attach_receipt',details=None,revision=None):
    if details is None:details={k:v for k,v in receipt(f).items() if k not in ['expectation_id','expected_revision']}
    c.execute('INSERT INTO haven.provider_report_events(expectation_id,task_id,kind,details,expected_revision,request_key) VALUES(%s,%s,%s,%s::jsonb,%s,%s)',(f['expectation'],f['task'],kind,json.dumps(details),revision or f['expectation'],key))
def pending_version(db,f):
    data=b'%PDF-1.7 xyz';sha=hashlib.sha256(data).hexdigest();md5=hashlib.md5(data).hexdigest()
    with conn(db) as c:
        login(c,f);v=c.execute('SELECT public.prepare_provider_document(%s,%s,%s::jsonb)',(f['task'],'race-new-intake',json.dumps({'document_type':'support_plan','title':'Second synthetic version','declared_mime':'application/pdf','declared_size_bytes':len(data),'declared_sha256':sha,'supersedes_version_id':f['version']}))).fetchone()[0]['version']
        obj=c.execute('INSERT INTO storage.objects(bucket_id,name,owner,version,metadata) VALUES(%s,%s,%s,%s,%s::jsonb) RETURNING id,version',('resident-documents',v['object_path'],f['actor'],'race-object-v2',json.dumps({'size':len(data),'mimetype':'application/pdf','eTag':md5}))).fetchone();c.execute('COMMIT')
        c.execute('BEGIN');c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");c.execute('SET LOCAL ROLE service_role')
        c.execute('SELECT public.attest_resident_document_bytes(%s,%s,%s,%s,%s,%s,%s,%s,%s)',(v['id'],obj[0],obj[1],md5,len(data),'application/pdf',sha,md5,f['actor']));c.execute('COMMIT');return v
results=[]
cases=['same-key-event','same-key-finalize','native-loss-after-wait','native-loss-after-capture','actor-loss-after-wait','history-native-loss','history-event-change']
for case in cases:
    db='col158_race_'+uuid.uuid4().hex[:8]
    with conn('postgres') as admin:
        admin.execute(psycopg.sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(psycopg.sql.Identifier(db),psycopg.sql.Identifier(BASE)))
        try:
            f=setup(db);pending=pending_version(db,f) if case=='same-key-finalize' else None
            with conn(db) as a,conn(db) as b,conn(db) as observer:
                if case.startswith('history-'):
                    login(observer,f);direct(observer,f,key='initial-receipt');observer.execute('COMMIT')
                    first=observer.execute('SELECT id FROM haven.provider_report_events WHERE expectation_id=%s',(f['expectation'],)).fetchone()[0]
                    observer.execute('ALTER FUNCTION haven.provider_report_headers(uuid) RENAME TO col158_original_headers')
                    observer.execute("""CREATE FUNCTION haven.provider_report_headers(p_task uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$ DECLARE n integer:=coalesce(nullif(current_setting('col158.header_calls',true),''),'0')::integer+1;r jsonb;BEGIN PERFORM set_config('col158.header_calls',n::text,true);r:=haven.col158_original_headers(p_task);IF n=2 THEN PERFORM pg_advisory_xact_lock(158371);END IF;RETURN r;END $$""")
                elif case=='native-loss-after-capture':
                    observer.execute('ALTER FUNCTION public.provider_document_target(uuid,uuid) RENAME TO col158_original_target')
                    observer.execute("""CREATE FUNCTION public.provider_document_target(p_task uuid,p_version uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$ DECLARE r jsonb;BEGIN r:=public.col158_original_target(p_task,p_version);PERFORM pg_advisory_xact_lock(158371);RETURN r;END $$""")
                login(a,f)
                if case=='same-key-event':a.execute('SELECT public.provider_report_command(%s,%s,%s,%s::jsonb)',(f['task'],'race-event-001','attach_receipt',json.dumps(receipt(f))))
                elif case=='same-key-finalize':a.execute('SELECT public.finalize_provider_document(%s,%s,%s,%s)',(f['task'],pending['id'],'race-final-001',pending['revision']))
                elif case.startswith('history-') or case=='native-loss-after-capture':a.execute('SELECT pg_advisory_xact_lock(158371)')
                else:a.execute("SELECT pg_advisory_xact_lock(hashtextextended('provider-report:'||%s::text,0))",(f['expectation'],))
                login(b,f);out={}
                def run():
                    try:
                        if case=='same-key-event':out['reply']=b.execute('SELECT public.provider_report_command(%s,%s,%s,%s::jsonb)',(f['task'],'race-event-001','attach_receipt',json.dumps(receipt(f)))).fetchone()[0]
                        elif case=='same-key-finalize':out['reply']=b.execute('SELECT public.finalize_provider_document(%s,%s,%s,%s)',(f['task'],pending['id'],'race-final-001',pending['revision'])).fetchone()[0]
                        elif case.startswith('history-'):out['reply']=b.execute('SELECT public.provider_report_snapshot(%s)',(f['task'],)).fetchone()[0]
                        else:direct(b,f)
                        b.execute('COMMIT')
                    except Exception as exc:out['error']=getattr(exc,'sqlstate',None);b.execute('ROLLBACK')
                t=threading.Thread(target=run);t.start();deadline=time.monotonic()+15
                while time.monotonic()<deadline:
                    if observer.execute('SELECT cardinality(pg_blocking_pids(%s))>0',(b.info.backend_pid,)).fetchone()[0]:break
                    time.sleep(.02)
                else:raise AssertionError('No actual wait observed')
                if case in ['native-loss-after-wait','native-loss-after-capture','history-native-loss']:observer.execute('UPDATE public.resident_documents SET deleted_at=clock_timestamp() WHERE id=%s',(f['document'],))
                elif case=='actor-loss-after-wait':observer.execute('UPDATE public.user_profiles SET is_active=false WHERE id=%s',(f['actor'],))
                elif case=='history-event-change':
                    login(observer,f);direct(observer,f,'concurrent-review','review',{'version_id':f['version'],'result':'reviewed','findings':'Concurrent administrative observation'},first);observer.execute('COMMIT')
                a.execute('COMMIT');t.join(20);assert not t.is_alive(),case
                if case in ['same-key-event','same-key-finalize']:
                    assert 'error' not in out,out
                    if case=='same-key-event':assert observer.execute('SELECT count(*) FROM haven.provider_report_events').fetchone()[0]==1
                    else:assert observer.execute('SELECT count(*) FROM public.resident_documents WHERE resident_id=%s',(f['resident'],)).fetchone()[0]==2
                else:assert out.get('error') in ['42501','40001'],out
                login(b,f);hfo=b.execute('SELECT haven.operation_task_readable(%s)',(f['task'],)).fetchone()[0];b.execute('ROLLBACK')
                assert hfo is (case!='actor-loss-after-wait')
                if case in ['native-loss-after-wait','native-loss-after-capture','actor-loss-after-wait']:assert observer.execute('SELECT count(*) FROM haven.provider_report_events').fetchone()[0]==0
                results.append({'case':case,'wait_observed':True,'hfo_access_after':hfo,'sqlstate':out.get('error'),'status':'PASS'})
        finally:admin.execute(psycopg.sql.SQL('DROP DATABASE {} WITH (FORCE)').format(psycopg.sql.Identifier(db)))
print(json.dumps({'scope':'owned native synthetic database barriers','results':results},indent=2))
