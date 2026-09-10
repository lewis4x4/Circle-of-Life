#!/usr/bin/env python3
"""COL-139: observed PostgreSQL lock races for occurrence generation in an
explicitly run-owned scratch cluster (native PostgreSQL, never Docker).
Requires psycopg. Clones the migrated scratch database named by
HFO_OCCURRENCE_BASELINE_DB (default col139_base340, which must already carry
migration 340) and applies the probe's fixture section. Every clone is
dropped by exact name in finally.

Cases:
1. Two generators for the same configuration and period race: exactly one
   row; both report the same task id (created / existing); the second is
   observed waiting on the per-subject advisory lock.
2. A binding retirement commits while a generator for the same subject waits
   on the advisory lock held by another generator: after the wait the
   generator re-reads the binding, reports no_binding and inserts nothing.
3. A session retirement is in flight (FOR UPDATE held, uncommitted) before the
   generator starts and commits while the generator waits on the binding row
   (KEY SHARE behind the retirement): the generator reports no_binding and
   inserts nothing.
"""
import json
import os
from pathlib import Path
import threading
import time
import uuid

import psycopg
from psycopg import sql

root = Path(__file__).resolve().parents[2]
socket = Path(os.environ['PG_VERIFY_NATIVE_SOCKET']).resolve()
allowed = Path.home() / '.hermes/tmp/agent-runs'
if not socket.is_relative_to(allowed.resolve()):
    raise RuntimeError('Only an explicitly run-owned temporary cluster is allowed')
manifest = json.loads((socket / 'manifest.json').read_text())
if manifest.get('created_by') != 'codex' or manifest.get('run_id') != socket.name:
    raise RuntimeError('Scratch cluster ownership manifest does not match')
connection = dict(host=str(socket), port=os.environ.get('PG_VERIFY_NATIVE_PORT', '55443'), user='postgres')
baseline = os.environ.get('HFO_OCCURRENCE_BASELINE_DB', 'col139_base340')
probe = (root / 'supabase/tests/review_hfo_occurrences.sql').read_text()
fixture_sql = probe.split('-- FIXTURES-BEGIN')[1].split('-- FIXTURES-END')[0]
helpers_sql = probe.split('BEGIN;')[1].split('-- Nothing in the migrations')[0].replace('ALTER ROLE service_role BYPASSRLS;', '')
RULE = {"rule_version": 1, "timezone": "America/New_York", "recurrence": {"kind": "weekly", "weekday": "tuesday"}, "deadline": {"time": "10:00"}}


def service(conn):
    conn.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)")
    conn.execute('SET ROLE service_role')


def generate(conn, site, configuration, day, run_id):
    return conn.execute(
        "SELECT public.generate_operation_occurrences_service(%s,%s,jsonb_build_array(pg_temp.occ(%s,'America/New_York','10:00',NULL)),pg_temp.run(%s,%s,%s,%s::jsonb))",
        (site, configuration, day, run_id, day, day, json.dumps(RULE)),
    ).fetchone()[0]


def wait_for_lock(observer, backend, thread, name, wait_event='advisory'):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if observer.execute("SELECT wait_event_type='Lock' AND wait_event=%s FROM pg_stat_activity WHERE pid=%s", (wait_event, backend)).fetchone()[0]:
            return
        if not thread.is_alive():
            raise AssertionError(f'{name}: generator did not reach the advisory lock wait')
        time.sleep(0.03)
    raise AssertionError(f'{name}: did not observe database lock wait')


def prepare(database):
    setup = psycopg.connect(**connection, dbname=database)
    setup.execute(helpers_sql)
    setup.execute(fixture_sql)
    fixture = dict(zip([x.name for x in setup.execute('SELECT * FROM of').description], setup.execute('SELECT * FROM of').fetchone()))
    ids = dict(setup.execute('SELECT label,id FROM of_ids').fetchall())
    # Bind the two assets as the site administrator; the pg_temp helpers only
    # live in this session, so re-create the evaluator-output builders per runner.
    setup.execute('RESET ROLE')
    setup.execute("SELECT pg_temp.o_login('admin_a')")
    setup.execute('SET ROLE authenticated')
    for label, subject in (('b_asset1', 'subj_asset1'), ('b_asset2', 'subj_asset2')):
        setup.execute("SELECT public.enroll_operation_binding_review(%s,%s,%s,'asset',NULL,'{\"source\":\"admin_log\",\"reason\":\"race fixture\"}',clock_timestamp())", (fixture['act_asset'], fixture['site_a'], fixture[subject]))
    setup.execute('RESET ROLE')
    bindings = dict(setup.execute('SELECT subject_id,id FROM public.operation_activity_bindings').fetchall())
    setup.commit()
    setup.close()
    return fixture, ids, bindings


BUILDERS = """
CREATE FUNCTION pg_temp.occ(d date,tzname text,hh text,p_shift text,grace_minutes int DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurrence_date',to_char(d,'YYYY-MM-DD'),'period',jsonb_build_object('start_date',to_char(d,'YYYY-MM-DD'),'end_date',to_char(d+6,'YYYY-MM-DD')),
  'due_at',((d::timestamp+hh::time) AT TIME ZONE tzname),'grace_ends_at',NULL,'remind_at',NULL,'timezone',tzname,'adjustments','[]'::jsonb,'shift',p_shift)
$$;
CREATE FUNCTION pg_temp.run(p_id text,d_from date,d_to date,p_rule jsonb DEFAULT NULL,p_kind text DEFAULT 'scheduled') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('run_id',p_id,'evaluator_version','hfo-evaluator/1','date_from',to_char(d_from,'YYYY-MM-DD'),'date_to',to_char(d_to,'YYYY-MM-DD'),'rule',p_rule,'occurrence_kind',p_kind))
$$;
GRANT ALL ON FUNCTION pg_temp.occ(date,text,text,text,int),pg_temp.run(text,date,date,jsonb,text) TO service_role;
"""


def runner(database):
    conn = psycopg.connect(**connection, dbname=database)
    conn.execute(BUILDERS)
    service(conn)
    return conn


def retiring_session(database, fixture):
    conn = psycopg.connect(**connection, dbname=database)
    conn.execute(helpers_sql.split('CREATE FUNCTION pg_temp.o_assert')[0])
    conn.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps(dict(
        sub=str(fixture['admin_a']), session_id=str(fixture['admin_a_session']), role='authenticated', app_role='facility_admin', organization_id=str(fixture['org']),
        auth_claim_version=conn.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s', (fixture['admin_a'],)).fetchone()[0])),))
    conn.execute('SET ROLE authenticated')
    return conn


def run_case(name, retire_during_wait, retire_in_flight=False):
    database = 'hfo_occurrence_probe_' + uuid.uuid4().hex[:16]
    admin = psycopg.connect(**connection, dbname='postgres', autocommit=True)
    admin.execute(sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(database), sql.Identifier(baseline)))
    try:
        fixture, ids, bindings = prepare(database)
        site, configuration = fixture['site_a'], ids['fr_asset1']
        d1, d2 = fixture['d1'], fixture['d2']
        observer = psycopg.connect(**connection, dbname=database, autocommit=True)
        first = runner(database)
        second = runner(database)
        result = {}
        target_day = d2 if retire_during_wait else d1
        retiring = None
        if retire_in_flight:
            # The retirement holds the binding rows FOR UPDATE before the generator starts.
            retiring = retiring_session(database, fixture)
            for binding in bindings.values():
                retiring.execute("SELECT public.retire_operation_binding_review(%s,clock_timestamp(),'retired while the generator ran')", (binding,))
            first_result = None
        elif retire_during_wait:
            # A generator that has serialised both subjects but not yet inserted
            # (an uncommitted insert would key-share the binding and make the
            # retirement itself wait); the waiting generator must re-read after it.
            for subject in (fixture['subj_asset1'], fixture['subj_asset2']):
                first.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', (str(fixture['act_asset']) + str(site) + str(subject),))
            first_result = None
        else:
            # The first generator holds the per-subject advisory locks until it commits.
            first_result = generate(first, site, configuration, d1, 'race-first')
            assert first_result['counts']['created'] == 2, first_result

        def command():
            try:
                result['value'] = generate(second, site, configuration, target_day, 'race-second')
                second.commit()
            except psycopg.Error as error:
                result['sqlstate'] = error.sqlstate
                result['error'] = str(error)
                second.rollback()

        thread = threading.Thread(target=command)
        thread.start()
        wait_for_lock(observer, second.info.backend_pid, thread, name, 'transactionid' if retire_in_flight else 'advisory')
        if retire_in_flight:
            retiring.commit()
            retiring.close()
        elif retire_during_wait:
            # A site administrator retires both bindings while the second generator waits.
            retiring = retiring_session(database, fixture)
            for binding in bindings.values():
                retiring.execute("SELECT public.retire_operation_binding_review(%s,clock_timestamp(),'retired during the generator wait')", (binding,))
            retiring.commit()
            retiring.close()
        first.commit()
        thread.join(8)
        if thread.is_alive():
            second.cancel()
            thread.join(2)
            raise AssertionError(f'{name}: second generator did not finish after release')
        assert 'value' in result, (name, result)
        outcome = result['value']
        rows = observer.execute("SELECT subject_id::text,id::text,status FROM public.operation_task_instances WHERE activity_id=%s AND assigned_shift_date=%s ORDER BY subject_id", (fixture['act_asset'], target_day)).fetchall()
        if retire_during_wait or retire_in_flight:
            assert outcome['counts'] == {'created': 0, 'existing': 0, 'conflict': 0, 'no_binding': 2, 'binding_not_current': 0, 'configuration_not_in_force': 0, 'invalid': 0}, (name, outcome)
            assert rows == [], (name, rows)
            assert all(o['outcome'] == 'no_binding' and 'retired' in o['reason'] for o in outcome['outcomes']), (name, outcome)
            assert observer.execute('SELECT count(*) FROM public.operation_activity_bindings WHERE effective_to IS NULL').fetchone()[0] == 0
            summary = dict(second_outcome='no_binding after the wait', rows_for_period=0, waited_on='binding row (transactionid)' if retire_in_flight else 'subject advisory lock')
        else:
            assert outcome['counts']['created'] == 0 and outcome['counts']['existing'] == 2, (name, outcome)
            assert len(rows) == 2, (name, rows)
            created = {o['subject_id']: o['task_id'] for o in first_result['outcomes']}
            existing = {o['subject_id']: o['existing_task_id'] for o in outcome['outcomes']}
            assert created == existing, (name, created, existing)
            assert all(status == 'pending' for _, _, status in rows), rows
            summary = dict(second_outcome='existing with the same identities', rows_for_period=2)
        assert observer.execute("SELECT count(*) FROM public.operation_task_instances WHERE activity_id=%s AND occurrence_kind='scheduled'", (fixture['act_asset'],)).fetchone()[0] == (0 if (retire_during_wait or retire_in_flight) else 2)
        first.close(); second.close(); observer.close()
        return dict(case=name, outcome='PASS', observed_lock_wait=True, **summary)
    finally:
        admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(database)))
        admin.close()


cases = [
    ('two generators for the same configuration and period', False),
    ('binding retired while the generator waits on the subject lock', True),
    ('binding retirement in flight before the generator, committed during its binding-row wait', False, True),
]
report = dict(cases=[run_case(*case) for case in cases], boundary='local PostgreSQL 17 with Supabase auth stubs; run-owned socket-only cluster')
print(json.dumps(report, indent=2))
print('COL-139 occurrence concurrency PASS')
