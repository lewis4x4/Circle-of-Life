#!/usr/bin/env python3
"""Synthetic COL-151 two-session proof in manifest-owned native PostgreSQL only.
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
database = 'col151_concurrency_' + uuid.uuid4().hex[:12]
report = {'migration_sha256': hashlib.sha256((root/'supabase/migrations/365_hfo_activity_history_exports.sql').read_bytes()).hexdigest(), 'database': database, 'environment': 'native PostgreSQL with synthetic Supabase stubs', 'cases': [], 'cleaned': False}
admin = psycopg.connect(**connection, dbname='postgres', autocommit=True)
connections = []

def connect(autocommit=False):
    c = psycopg.connect(**connection, dbname=database, autocommit=autocommit)
    connections.append(c)
    return c

def actor_session(f, who='admin_a'):
    c = connect()
    role = 'facility_admin'
    version = c.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s', (f[who],)).fetchone()[0]
    c.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps(dict(sub=str(f[who]),session_id=str(f[who+'_session']),role='authenticated',app_role=role,organization_id=str(f['org']),auth_claim_version=version)),))
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
    setup = connect()
    fixture = (root/'supabase/tests/review_hfo_corrections.sql').read_text().split('-- FIXTURES-END')[0]
    setup.execute(fixture)
    f = dict(zip([d.name for d in setup.execute('SELECT * FROM cf').description], setup.execute('SELECT * FROM cf').fetchone()))
    ids = dict(setup.execute('SELECT label,id FROM cf_ids').fetchall())
    setup.execute("CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$")
    setup.execute("SELECT set_config('request.jwt.claims','',true)")
    setup.execute('''CREATE FUNCTION haven.col151_pause_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.table_name='operation_history_exports' THEN PERFORM pg_advisory_xact_lock(151001); END IF; RETURN NEW; END $$;
      CREATE TRIGGER col151_pause_snapshot BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION haven.col151_pause_snapshot();''')
    setup.commit()
    observer = connect(autocommit=True)
    holder = connect()
    holder.execute('SELECT pg_advisory_xact_lock(151001)')
    exporter = actor_session(f)
    key = uuid.uuid4()
    thread, result = run_waiting(exporter, lambda: exporter.execute('SELECT public.create_operation_history_export(%s,%s,%s)', (f['site_a'],f['act_asset'],key)).fetchone()[0], observer)
    # INSERT SELECT has materialized its rows and is now blocked in metadata audit.
    writer = actor_session(f)
    revision = writer.execute('SELECT revision FROM public.operation_execution_receipts WHERE id=%s', (ids['r_a1'],)).fetchone()[0]
    corrected = writer.execute('SELECT public.correct_operation_work_review(%s,%s,%s,%s,%s::jsonb)', (ids['occ_a1_d1'],'export-race-correct',ids['r_a1'],revision,json.dumps({'reason':'Concurrent correction','outcome':'performed','values':{'pads_ok':True,'battery_pct':72}}))).fetchone()[0]
    writer.execute('SELECT public.create_operation_manual_occurrence_review(%s,%s,%s,%s,%s::jsonb)', (f['act_asset'],f['site_a'],f['subj_asset1'],'export-race-new','{}'))
    writer.commit()
    holder.commit(); thread.join(20)
    assert not thread.is_alive() and 'error' not in result, result
    snapshot = result['value']
    page = exporter.execute('SELECT public.read_operation_history_export(%s,0,500)', (snapshot['export_id'],)).fetchone()[0]
    row = next(r for r in page['rows'] if r['id'] == str(ids['occ_a1_d1']))
    assert page['manifest']['total'] == 12 and page['manifest']['receipt_total'] == 2
    assert row['effective_receipt_id'] == str(ids['r_a1']) and len(row['receipts']) == 1
    assert row['receipts'][0]['superseded_by_receipt_id'] is None
    fresh = exporter.execute('SELECT public.create_operation_history_export(%s,%s,%s)', (f['site_a'],f['act_asset'],uuid.uuid4())).fetchone()[0]
    assert fresh['manifest']['total'] == 13 and fresh['manifest']['receipt_total'] == 3
    exporter.commit()
    report['cases'].append({'case':'source correction and new occurrence commit during snapshot materialization lock','result':'PASS','old_total':12,'fresh_total':13,'old_receipts':2,'fresh_receipts':3,'observed_lock':True})
    observer.execute('DROP TRIGGER col151_pause_snapshot ON public.audit_log')
    # Empty authorized activity is explicit; its cached manifest still needs current scope.
    empty_activity = uuid.uuid4()
    observer.execute('INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,activity_kind,subject_kind,origin) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',
                     (empty_activity,f['org'],f['site_a'],'export-empty-'+str(empty_activity),'Empty export activity','attestation','facility','admin_log'))
    empty = exporter.execute('SELECT public.create_operation_history_export(%s,%s,%s)', (f['site_a'],empty_activity,uuid.uuid4())).fetchone()[0]
    assert empty['manifest']['total'] == 0 and empty['manifest']['complete'] is True
    exporter.commit()
    # A request waiting at its idempotency lock must re-read authority after release.
    requester = actor_session(f)
    denied_key = uuid.uuid4()
    holder.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', (str(f['admin_a'])+str(denied_key),))
    thread, denied = run_waiting(requester, lambda: requester.execute('SELECT public.create_operation_history_export(%s,%s,%s)', (f['site_a'],f['act_asset'],denied_key)).fetchone()[0], observer)
    observer.execute("SELECT set_config('request.jwt.claims','',false)")
    observer.execute('UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id=%s', (f['admin_a'],))
    holder.commit(); thread.join(20)
    assert not thread.is_alive() and denied.get('sqlstate') == '42501', denied
    assert observer.execute('SELECT count(*) FROM haven.operation_history_exports WHERE request_id=%s', (denied_key,)).fetchone()[0] == 0
    report['cases'].append({'case':'facility grant revoked during advisory lock wait','result':'PASS','sqlstate':denied['sqlstate'],'no_snapshot_created':True,'observed_lock':True})
    try:
        exporter.execute('SELECT public.read_operation_history_export(%s,0,500)', (empty['export_id'],))
        raise AssertionError('Empty snapshot returned despite revoked site')
    except psycopg.Error as error:
        assert error.sqlstate == '42501', error
        exporter.rollback()
    report['cases'].append({'case':'authorized empty export denied after facility grant revocation','result':'PASS','initial_total':0,'sqlstate':'42501'})
    report['result'] = 'PASS'
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
