#!/usr/bin/env python3
"""Synthetic COL-140 two-session proof in manifest-owned native PostgreSQL only.
Creates and drops one exact ephemeral database; never contacts a hosted target.
"""
import json
import hashlib
import os
from pathlib import Path
import subprocess
import threading
import time
import uuid
import psycopg
from psycopg import sql

root = Path(__file__).resolve().parents[3]
socket = Path(os.environ['PG_VERIFY_NATIVE_SOCKET']).resolve()
assert socket.is_relative_to((Path.home() / '.hermes/tmp/agent-runs').resolve())
manifest = json.loads((socket / 'manifest.json').read_text())
assert manifest['created_by'] == 'codex' and manifest['run_id'] == socket.name
connection = dict(host=str(socket), port=os.environ['PG_VERIFY_NATIVE_PORT'], user='postgres')
bin_path = Path(os.environ['PG_VERIFY_NATIVE_BIN'])
database = 'col140_concurrency_' + uuid.uuid4().hex[:12]
report = {'probe_sha256': hashlib.sha256((root/'supabase/tests/review_hfo_profile_drafts.sql').read_bytes()).hexdigest(), 'migration_sha256': hashlib.sha256((root/'supabase/migrations/366_hfo_profile_draft_preparation.sql').read_bytes()).hexdigest(), 'database': database, 'environment': 'native PostgreSQL with synthetic Supabase stubs', 'cases': [], 'cleaned': False}
admin = psycopg.connect(**connection, dbname='postgres', autocommit=True)
connections = []

def connect(autocommit=False):
    c = psycopg.connect(**connection, dbname=database, autocommit=autocommit)
    connections.append(c)
    return c

def actor_session(f, who='admin_a'):
    c = connect()
    role = 'owner' if who=='owner_actor' else 'facility_admin'
    version = c.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s', (f[who],)).fetchone()[0]
    c.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps(dict(sub=str(f[who]),session_id=str(f[who.replace('_actor','')+'_session']),role='authenticated',app_role=role,organization_id=str(f['org']),auth_claim_version=version)),))
    c.execute('SET ROLE authenticated')
    c.commit()
    return c

def run_waiting(conn, fn, observer):
    result = {}
    def execute():
        try:
            result['value'] = fn()
            conn.commit()
        except Exception as exc:
            result['error'] = str(exc)
            result['sqlstate'] = getattr(exc, 'sqlstate', None)
            conn.rollback()
    thread = threading.Thread(target=execute)
    thread.start()
    until = time.monotonic() + 20
    while time.monotonic() < until:
        state = observer.execute('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=%s', (conn.info.backend_pid,)).fetchone()
        if state and state[0] == 'Lock': return thread, result
        if not thread.is_alive(): raise AssertionError(f'Query failed before observed lock: {result}')
        time.sleep(.02)
    conn.cancel(); thread.join(5)
    raise AssertionError('No actual lock wait observed')

try:
    admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(database)))
    args = [str(bin_path/'psql'), '-h', str(socket), '-p', str(connection['port']), '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q']
    for path in [root/'scripts/pg-verify-stub.sql', *sorted((root/'supabase/migrations').glob('*.sql'))]: args += ['-f', str(path)]
    migrated = subprocess.run(args, capture_output=True, text=True, timeout=120)
    if migrated.returncode: raise RuntimeError(migrated.stderr[-8000:])
    # Focused final SQL probe includes full catalog/retry/cross-site and actual
    # unknown-schedule recording. It rolls back before concurrency setup.
    probe = subprocess.run([str(bin_path/'psql'),'-h',str(socket),'-p',str(connection['port']),'-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-q','-f',str(root/'supabase/tests/review_hfo_profile_drafts.sql')],capture_output=True,text=True,timeout=120)
    if probe.returncode: raise RuntimeError(probe.stderr[-8000:])
    report['focused_sql_probe']='PASS'
    setup = connect()
    fixture = (root/'supabase/tests/review_hfo_corrections.sql').read_text().split('-- FIXTURES-END')[0]
    setup.execute(fixture)
    f = dict(zip([d.name for d in setup.execute('SELECT * FROM cf').description], setup.execute('SELECT * FROM cf').fetchone()))
    setup.execute("CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$")
    setup.execute("SELECT set_config('request.jwt.claims','',true)")
    target=setup.execute("SELECT a.id FROM public.operation_activities a JOIN public.operation_activity_source_mappings m ON m.activity_id=a.id JOIN public.operation_activity_source_items s ON s.id=m.source_item_id WHERE s.source_payload->>'disposition'='mapped' AND a.subject_kind='facility' ORDER BY a.id LIMIT 1").fetchone()[0]
    setup.commit()
    observer = connect(autocommit=True)
    human = actor_session(f, 'owner_actor')
    human.execute('SELECT public.save_operation_requirement_draft_review(%s,%s::jsonb)',(target,json.dumps({'wording':'Concurrent human draft first text'})))
    preparing = actor_session(f, 'owner_actor')
    thread,result=run_waiting(preparing,lambda: preparing.execute('SELECT public.prepare_operation_profile_drafts(%s)',(f['site_a'],)).fetchone()[0],observer)
    # Normal writer keeps its activity SHARE lock until commit; it can finish
    # a second edit while preparation waits for the activity exclusive lock.
    human.execute('SELECT public.save_operation_requirement_draft_review(%s,%s::jsonb)',(target,json.dumps({'wording':'Concurrent human draft final text'})))
    saved=human.execute("SELECT to_jsonb(r) FROM public.operation_requirement_versions r WHERE activity_id=%s AND status='draft'",(target,)).fetchone()[0]
    human.commit();thread.join(30)
    assert not thread.is_alive() and 'error' not in result,result
    actual=observer.execute('SELECT to_jsonb(r) FROM public.operation_requirement_versions r WHERE id=%s',(saved['id'],)).fetchone()[0]
    assert actual==saved
    assert len(result['value']['results'])==110
    repeated=preparing.execute('SELECT public.prepare_operation_profile_drafts(%s)',(f['site_a'],)).fetchone()[0];preparing.commit()
    assert repeated['prepared']==0
    report['cases'].append({'case':'concurrent normal human draft create and edit preserved after observed activity lock wait','result':'PASS','observed_lock':True,'existing_draft_unchanged':True,'repeat_prepared':0,'components':110})
    holder=connect()
    holder.execute('UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id=%s AND facility_id=%s',(f['owner_actor'],f['site_a']))
    denied=actor_session(f,'owner_actor')
    before=observer.execute('SELECT count(*) FROM public.operation_requirement_versions').fetchone()[0]
    thread,result=run_waiting(denied,lambda: denied.execute('SELECT public.prepare_operation_profile_drafts(%s)',(f['site_a'],)).fetchone()[0],observer)
    holder.commit();thread.join(30)
    assert not thread.is_alive() and result.get('sqlstate')=='42501',result
    assert observer.execute('SELECT count(*) FROM public.operation_requirement_versions').fetchone()[0]==before
    report['cases'].append({'case':'facility grant revocation committed while preparation waits on authority grant lock','result':'PASS','observed_lock':True,'sqlstate':'42501','no_new_drafts':True})
    report['result']='PASS'
except Exception as exc:
    report['result'] = 'FAIL'
    report['error'] = str(exc)
    raise
finally:
    for c in connections:
        try: c.close()
        except Exception: pass
    admin.execute(sql.SQL('DROP DATABASE IF EXISTS {} WITH (FORCE)').format(sql.Identifier(database)))
    report['cleaned'] = True
    admin.close()
    print(json.dumps(report, indent=2))
