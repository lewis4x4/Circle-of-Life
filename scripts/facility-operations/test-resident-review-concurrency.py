#!/usr/bin/env python3
"""COL155 actual local PostgreSQL races. Explicit run-owned socket/baseline only."""
import json
import os
from pathlib import Path
import threading
import time
import uuid
import psycopg
from psycopg.types.json import Jsonb

SOCKET = Path(os.environ['PG_VERIFY_NATIVE_SOCKET']).resolve()
assert str(SOCKET).startswith(str(Path.home() / '.hermes/tmp/agent-runs') + '/')
PORT = int(os.environ.get('PG_VERIFY_NATIVE_PORT', '55519'))
BASE = os.environ['HFO_RESIDENT_REVIEW_BASELINE_DB']
assert BASE.startswith('col155_')
ROOT = Path(__file__).resolve().parents[2]

def connect(db): return psycopg.connect(host=str(SOCKET), port=PORT, user='postgres', dbname=db, autocommit=True)
def fixture(db):
    text = (ROOT / 'supabase/tests/review_hfo_resident_source_reviews.sql').read_text()
    text = text[:text.index('RESET ROLE; SELECT pg_temp.c_clear();\nCREATE TEMP TABLE rr_native')]
    with connect(db) as c:
        c.execute(text)
        data = c.execute("SELECT jsonb_build_object('actor',admin_a,'session',admin_a_session,'org',org,'site',site_a,'task',pg_temp.rid('manual_review'),'contact',contact,'start',today-7,'end',today-1,'version',(SELECT result->>'source_version' FROM rr_source),'revision',(SELECT occurrence_revision FROM public.operation_task_instances WHERE id=pg_temp.rid('manual_review'))) FROM cf,rr").fetchone()[0]
        c.execute('COMMIT')
        return data

def login(c, f):
    c.execute('BEGIN')
    c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub':f['actor'],'session_id':f['session'],'role':'authenticated','app_role':'facility_admin','organization_id':f['org'],'iat':int(time.time()),'auth_claim_version':1}),))
    # Read the actual generated profile claim version without printing identity records.
    c.execute("SELECT set_config('request.jwt.claims', (current_setting('request.jwt.claims')::jsonb || jsonb_build_object('auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=%s)))::text,true)",(f['actor'],))
    c.execute('SET LOCAL ROLE authenticated')

def record(c, f, key):
    return c.execute('SELECT public.record_resident_source_review(%s,%s,%s,%s,%s,%s,%s)',(f['task'],key,f['revision'],f['start'],f['end'],Jsonb([{'family':'resident_contact','source_id':f['contact'],'source_version':f['version']}]),Jsonb({'outcome':'performed'}))).fetchone()[0]

def wait_block(observer, pid):
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        if observer.execute('SELECT cardinality(pg_blocking_pids(%s))>0',(pid,)).fetchone()[0]: return
        time.sleep(.03)
    raise AssertionError('Expected database lock wait was not observed')

results=[]
for case in ('same-key','native-revocation','native-change','old-receipt'):
    db='col155_race_'+uuid.uuid4().hex[:10]
    admin=connect('postgres');admin.execute(psycopg.sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(psycopg.sql.Identifier(db),psycopg.sql.Identifier(BASE)))
    try:
        f=fixture(db)
        with connect(db) as first,connect(db) as second,connect(db) as observer:
            if case=='old-receipt':
                login(first,f); out=record(first,f,'race-old-001');first.execute('COMMIT')
                receipt=out['receipt_outcome']['receipt']['id']
                login(first,f)
                # An authorized correction updates the old receipt's supersession
                # projection/xmin; its immutable issuance still belongs to the prior transaction.
                first.execute('SELECT public.correct_operation_work_review(%s,%s,%s,%s,%s)',
                    (f['task'],'race-old-correct-001',receipt,out['receipt_outcome']['receipt']['revision'],Jsonb({'reason':'Synthetic reviewed correction','outcome':'performed'})))
                try:
                    first.execute("INSERT INTO haven.resident_review_references(receipt_id,family,source_id,source_version,period_start,period_end) VALUES(%s,'resident_contact',%s,%s,%s,%s)",(receipt,f['contact'],f['version'],f['start'],f['end']))
                    raise AssertionError('Old receipt accepted a new source reference')
                except psycopg.errors.InsufficientPrivilege: pass
                first.execute('ROLLBACK');results.append({'case':case,'status':'PASS'});continue
            if case=='same-key':
                login(first,f); one=record(first,f,'race-same-001')
            else:
                first.execute('BEGIN');first.execute('SELECT id FROM public.operation_task_instances WHERE id=%s FOR UPDATE',(f['task'],))
            login(second,f);pid=second.info.backend_pid;answer={}
            def run():
                try:answer['result']=record(second,f,'race-same-001' if case=='same-key' else 'race-deny-001');second.execute('COMMIT')
                except Exception as e:answer['error']=getattr(e,'sqlstate',None);second.execute('ROLLBACK')
            thread=threading.Thread(target=run);thread.start();wait_block(observer,pid)
            if case=='native-revocation':
                observer.execute("CREATE POLICY col155_native_deny ON public.resident_contacts AS RESTRICTIVE FOR SELECT TO authenticated USING(false)")
            elif case=='native-change':observer.execute("UPDATE public.resident_contacts SET phone='555-0199' WHERE id=%s",(f['contact'],))
            first.execute('COMMIT');thread.join(15);assert not thread.is_alive()
            if case=='same-key':
                assert answer['result']['replayed'] is True and answer['result']['receipt_outcome']['receipt']['id']==one['receipt_outcome']['receipt']['id']
                assert observer.execute('SELECT count(*) FROM haven.resident_review_references').fetchone()[0]==1
            else:
                assert answer.get('error')==('42501' if case=='native-revocation' else '40001'),answer
                assert observer.execute('SELECT count(*) FROM public.operation_execution_receipts WHERE request_key=%s',('race-deny-001',)).fetchone()[0]==0
            results.append({'case':case,'wait_observed':True,'status':'PASS'})
    finally:
        admin.execute(psycopg.sql.SQL('DROP DATABASE {} WITH (FORCE)').format(psycopg.sql.Identifier(db)));admin.close()
print(json.dumps({'scope':'local native synthetic races','results':results},indent=2))
