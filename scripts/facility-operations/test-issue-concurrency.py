#!/usr/bin/env python3
"""COL-144: observed PostgreSQL lock races for the issue lifecycle in an
explicitly run-owned scratch cluster (native PostgreSQL, never Docker).
Requires psycopg. Clones the migrated scratch database named by
HFO_ISSUE_BASELINE_DB (default col144_base342, which must already carry
migration 342) and applies the probe's fixture section. Every clone is
dropped by exact name in finally.

Cases:
1. Two managers assign the same open issue with the same expected revision:
   the second is observed waiting on the issue row lock held by the first;
   after the first commits it re-reads the row and is refused because the
   revision moved; exactly one assignment event exists and the first owner
   stands.
2. Two identical replays (same actor, same key, same content) race: exactly
   one event; the second returns it with replayed = true after the wait.
3. Two resolutions of the same issue with the same expected revision race:
   one resolved event; the loser is refused after the wait because the
   revision moved; the issue is resolved once by the winner.
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
baseline = os.environ.get('HFO_ISSUE_BASELINE_DB', 'col144_base342')
probe = (root / 'supabase/tests/review_hfo_issue_lifecycle.sql').read_text()
fixture_sql = probe.split('-- FIXTURES-BEGIN')[1].split('-- FIXTURES-END')[0]
helpers_sql = probe.split('BEGIN;')[1].split('-- Nothing in the migrations')[0].replace('ALTER ROLE service_role BYPASSRLS;', '')


def session(database, fixture, who, role):
    conn = psycopg.connect(**connection, dbname=database)
    conn.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps(dict(
        sub=str(fixture[who]), session_id=str(fixture[who.replace('_actor', '') + '_session']), role='authenticated', app_role=role, organization_id=str(fixture['org']),
        auth_claim_version=conn.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s', (fixture[who],)).fetchone()[0])),))
    conn.execute('SET ROLE authenticated')
    return conn


def revision(conn, issue):
    return conn.execute('SELECT issue_revision FROM public.operation_issues WHERE id=%s', (issue,)).fetchone()[0]


def assign(conn, issue, key, rev, owner):
    payload = json.dumps({"owner_user_id": str(owner)})
    return conn.execute('SELECT public.assign_operation_issue_review(%s,%s,%s,%s::jsonb)', (issue, key, rev, payload)).fetchone()[0]


def resolve(conn, issue, key, rev, summary):
    payload = json.dumps({"resolution_summary": summary})
    return conn.execute('SELECT public.resolve_operation_issue_review(%s,%s,%s,%s::jsonb)', (issue, key, rev, payload)).fetchone()[0]


def wait_for_lock(observer, backend, thread, name):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if observer.execute("SELECT wait_event_type='Lock' AND wait_event IN('transactionid','tuple') FROM pg_stat_activity WHERE pid=%s", (backend,)).fetchone()[0]:
            return
        if not thread.is_alive():
            raise AssertionError(f'{name}: command did not reach the row lock wait')
        time.sleep(0.03)
    raise AssertionError(f'{name}: did not observe database lock wait')


def prepare(database):
    setup = psycopg.connect(**connection, dbname=database)
    setup.execute(helpers_sql)
    setup.execute(fixture_sql)
    fixture = dict(zip([x.name for x in setup.execute('SELECT * FROM ifx').description], setup.execute('SELECT * FROM ifx').fetchone()))
    ids = dict(setup.execute('SELECT label,id FROM ifx_ids').fetchall())
    setup.commit()
    setup.close()
    return fixture, ids


def run_case(name, identical=False, resolving=False):
    database = 'hfo_issue_probe_' + uuid.uuid4().hex[:16]
    admin = psycopg.connect(**connection, dbname='postgres', autocommit=True)
    admin.execute(sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(database), sql.Identifier(baseline)))
    try:
        fixture, ids = prepare(database)
        observer = psycopg.connect(**connection, dbname=database, autocommit=True)
        issue = ids['issue_cab']
        result = {}
        if resolving:
            first = session(database, fixture, 'mgr', 'manager')
            second = session(database, fixture, 'mgr2', 'manager')
            rev = revision(first, issue)
            first_value = resolve(first, issue, 'col144-race-000031', rev, 'Latch tightened')
            assert first_value['replayed'] is False and first_value['issue']['status'] == 'resolved', first_value
        elif identical:
            first = session(database, fixture, 'mgr', 'manager')
            second = session(database, fixture, 'mgr', 'manager')
            rev = revision(first, issue)
            first_value = assign(first, issue, 'col144-race-000021', rev, fixture['nurse'])
            assert first_value['replayed'] is False and first_value['issue']['status'] == 'assigned', first_value
        else:
            first = session(database, fixture, 'mgr', 'manager')
            second = session(database, fixture, 'mgr2', 'manager')
            rev = revision(first, issue)
            first_value = assign(first, issue, 'col144-race-000011', rev, fixture['nurse'])
            assert first_value['replayed'] is False and first_value['issue']['status'] == 'assigned', first_value

        def command():
            try:
                if resolving:
                    result['value'] = resolve(second, issue, 'col144-race-000032', rev, 'Latch replaced')
                elif identical:
                    result['value'] = assign(second, issue, 'col144-race-000021', rev, fixture['nurse'])
                else:
                    result['value'] = assign(second, issue, 'col144-race-000012', rev, fixture['aide'])
                second.commit()
            except psycopg.Error as error:
                result['sqlstate'] = error.sqlstate
                result['error'] = str(error)
                second.rollback()

        thread = threading.Thread(target=command)
        thread.start()
        wait_for_lock(observer, second.info.backend_pid, thread, name)
        first.commit()
        thread.join(8)
        if thread.is_alive():
            second.cancel()
            thread.join(2)
            raise AssertionError(f'{name}: waiting command did not finish after release')
        events = observer.execute('SELECT id::text,event_kind,request_key FROM public.operation_issue_events WHERE issue_id=%s ORDER BY event_seq', (issue,)).fetchall()
        row = observer.execute('SELECT status,owner_user_id::text,resolution_summary,issue_revision FROM public.operation_issues WHERE id=%s', (issue,)).fetchone()
        if resolving:
            assert result.get('sqlstate') == 'P0001' and 'changed since it was read' in result['error'], (name, result)
            assert len(events) == 1 and events[0][1] == 'resolved' and events[0][0] == first_value['event']['id'], (name, events)
            assert row[0] == 'resolved' and row[2] == 'Latch tightened', (name, row)
            summary = dict(outcome='second resolution refused by the moved revision after the wait', sqlstate='P0001', events=1, waited_on='issue row')
        elif identical:
            assert 'value' in result, (name, result)
            assert result['value']['replayed'] is True and result['value']['event']['id'] == first_value['event']['id'], (name, result)
            assert len(events) == 1, (name, events)
            summary = dict(outcome='same event replayed after the wait', events=1, waited_on='issue row')
        else:
            assert result.get('sqlstate') == 'P0001' and 'changed since it was read' in result['error'], (name, result)
            assert len(events) == 1 and events[0][1] == 'assigned' and events[0][0] == first_value['event']['id'], (name, events)
            assert row[0] == 'assigned' and row[1] == str(fixture['nurse']), (name, row)
            summary = dict(outcome='second assignment refused by the moved revision after the wait', sqlstate='P0001', events=1, waited_on='issue row')
        second.close()
        first.close()
        observer.close()
        return summary
    finally:
        admin.execute(sql.SQL('DROP DATABASE IF EXISTS {} WITH (FORCE)').format(sql.Identifier(database)))
        admin.close()


def main():
    report = {
        'issue': 'COL-144',
        'baseline_database': baseline,
        'cases': [
            dict(name='two managers assign one issue with the same revision', **run_case('assign')),
            dict(name='two identical assignment replays', **run_case('identical', identical=True)),
            dict(name='two resolutions with the same revision', **run_case('resolve', resolving=True)),
        ],
        'boundary': 'local PostgreSQL 17 with Supabase auth stubs; run-owned socket-only cluster',
    }
    print(json.dumps(report, indent=2, default=str))
    print('COL-144 issue concurrency PASS')


if __name__ == '__main__':
    main()
