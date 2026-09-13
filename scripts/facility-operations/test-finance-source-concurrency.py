#!/usr/bin/env python3
"""Three actual local PostgreSQL waits; isolated synthetic clones only."""
import json, os, time, threading, uuid
from pathlib import Path
import psycopg
ROOT = Path(__file__).resolve().parents[2]
SOCKET = Path(os.environ['PG_VERIFY_NATIVE_SOCKET']).resolve()
assert str(SOCKET).startswith(str(Path.home()/'.hermes/tmp/agent-runs')+'/')
PORT = int(os.environ.get('PG_VERIFY_NATIVE_PORT', '55519'))
BASE = os.environ['HFO_FINANCE_SOURCE_BASELINE_DB']
assert BASE.startswith('col157_')
def conn(db):
    return psycopg.connect(host=str(SOCKET), port=PORT, user='postgres', dbname=db, autocommit=True)
def setup(db):
    source=(ROOT/'supabase/tests/review_hfo_finance_source_snapshots.sql').read_text().split('-- ASSERTIONS_BEGIN')[0]
    with conn(db) as c:
        c.execute(source)
        f=c.execute("SELECT jsonb_build_object('actor',actor,'session',actor_session,'org',org,'site',facility,'task',task,'start',start_date,'end',end_date,'census',census) FROM business_fixture,fs").fetchone()[0]
        c.execute('COMMIT')
        return f
def login(c,f):
    c.execute('BEGIN')
    version=c.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s',(f['actor'],)).fetchone()[0]
    claims={'sub':f['actor'],'session_id':f['session'],'organization_id':f['org'],'app_role':'owner','role':'authenticated','auth_claim_version':version,'iat':int(time.time())}
    c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps(claims),))
    c.execute('SET LOCAL ROLE authenticated')
results=[]
for case in ['same-key','native-permission-revocation','source-change','direct-insert-revocation','history-read-revocation']:
    db='col157_race_'+uuid.uuid4().hex[:8]
    with conn('postgres') as admin:
        admin.execute(psycopg.sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(psycopg.sql.Identifier(db),psycopg.sql.Identifier(BASE)))
        try:
            f=setup(db)
            with conn(db) as a,conn(db) as b,conn(db) as observer:
                if case=='direct-insert-revocation':
                    observer.execute('ALTER FUNCTION public.read_finance_operation_source_input(uuid,date,date) RENAME TO col157_test_original_read')
                    observer.execute("""CREATE FUNCTION public.read_finance_operation_source_input(p_task uuid,p_start date,p_end date) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ DECLARE result jsonb; BEGIN result:=public.col157_test_original_read(p_task,p_start,p_end); PERFORM pg_advisory_xact_lock(157369); RETURN result; END $$""")
                    observer.execute('GRANT EXECUTE ON FUNCTION public.read_finance_operation_source_input(uuid,date,date) TO authenticated')
                if case=='history-read-revocation':
                    a.execute('BEGIN');a.execute('LOCK TABLE haven.finance_source_transitions IN ACCESS EXCLUSIVE MODE')
                else:
                    login(a,f)
                args=(f['task'],f['start'],f['end'],'same-key-001')
                if case=='same-key':
                    a.execute('SELECT public.finance_operation_source_snapshot(%s,%s,%s,%s)',args)
                elif case=='direct-insert-revocation':
                    a.execute('SELECT pg_advisory_xact_lock(157369)')
                elif case!='history-read-revocation':
                    a.execute("SELECT pg_advisory_xact_lock(hashtextextended('hfo-finance-source:'||%s::text||':'||%s::text||':'||%s::text||':'||%s::text,0))",(f['task'],f['actor'],f['start'],f['end']))
                login(b,f)
                out={}
                def run():
                    try:
                        if case=='direct-insert-revocation':
                            b.execute('INSERT INTO haven.finance_source_transitions(task_id,start_date,end_date,source_version,visibility_key,sequence) VALUES(%s,%s,%s,%s,%s,%s)',(f['task'],f['start'],f['end'],'forged','forged',999999))
                        else:
                            out['result']=b.execute('SELECT public.finance_operation_source_snapshot(%s,%s,%s,%s)',args if case!='history-read-revocation' else (*args[:3],None)).fetchone()[0]
                        out['task_readable']=b.execute('SELECT haven.operation_task_readable(%s)',(f['task'],)).fetchone()[0]
                        b.execute('COMMIT')
                    except Exception as exc:
                        out['error']=getattr(exc,'sqlstate',None)
                        b.execute('ROLLBACK')
                thread=threading.Thread(target=run);thread.start();deadline=time.monotonic()+10
                while time.monotonic()<deadline:
                    if observer.execute('SELECT cardinality(pg_blocking_pids(%s))>0',(b.info.backend_pid,)).fetchone()[0]:break
                    time.sleep(.02)
                else:raise AssertionError('No actual blocked backend observed')
                if case in ['native-permission-revocation','direct-insert-revocation','history-read-revocation']:observer.execute('REVOKE SELECT ON public.payments FROM authenticated')
                elif case=='source-change':observer.execute('UPDATE public.census_daily_log SET occupied_beds=12,available_beds=8 WHERE id=%s',(f['census'],))
                a.execute('COMMIT');thread.join(15)
                assert not thread.is_alive()
                if case in ['direct-insert-revocation','history-read-revocation']:
                    assert out.get('error')=='42501',out
                    assert observer.execute('SELECT count(*) FROM haven.finance_source_transitions').fetchone()[0]==0
                    login(b,f)
                    assert b.execute('SELECT haven.operation_task_readable(%s)',(f['task'],)).fetchone()[0] is True
                    b.execute('ROLLBACK')
                    results.append({'case':case,'wait_observed':True,'current_hfo_task_readable':True,'rejected_sqlstate':'42501','stored_transitions':0,'status':'PASS'})
                    continue
                assert 'error' not in out,out
                result=out['result'];assert out['task_readable'] is True
                assert len(result['history'])==1 and result['history'][0]['source_version']==result['source_version']
                if case=='native-permission-revocation':assert result['families'][1]['availability']=='unavailable' and not result['families'][1]['records']
                if case=='source-change':assert result['families'][0]['records'][0]['metrics']['occupied_beds']==12
                results.append({'case':case,'wait_observed':True,'current_hfo_task_readable':True,'status':'PASS'})
        finally:
            admin.execute(psycopg.sql.SQL('DROP DATABASE {} WITH (FORCE)').format(psycopg.sql.Identifier(db)))
print(json.dumps({'scope':'local synthetic native concurrency','results':results},indent=2))
