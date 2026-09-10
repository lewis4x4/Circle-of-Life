#!/usr/bin/env python3
"""COL-146: observed PostgreSQL lock races for interrupted-save drafts in an
explicitly run-owned scratch cluster (native PostgreSQL, never Docker).
Requires psycopg. Clones the migrated scratch database named by
HFO_DRAFT_BASELINE_DB (default col146_base345, which must already carry
migration 345) and applies the probe's fixture section. Every clone is
dropped by exact name in finally.

Cases:
1. Two resumes of one draft race: the second is observed waiting on the
   draft row lock held by the first; after the first commits it re-reads the
   draft, finds the record and replays it (replayed = true); exactly one
   receipt exists and the draft was reconciled once, by the first.
2. A resume racing a discard, in both orders: when the discard lands first
   the resume is refused after the wait (Draft was discarded) and no receipt
   exists; when the resume lands first the discard is refused after the wait
   (Draft is not pending) and the one receipt stands. A receipt never comes
   from a discarded draft.
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
baseline = os.environ.get('HFO_DRAFT_BASELINE_DB', 'col146_base345')
probe = (root / 'supabase/tests/review_hfo_command_drafts.sql').read_text()
fixture_sql = probe.split('-- FIXTURES-BEGIN')[1].split('-- FIXTURES-END')[0]
helpers_sql = probe.split('BEGIN;')[1].split('-- Nothing in the migrations')[0].replace('ALTER ROLE service_role BYPASSRLS;', '')


def session(database, fixture, who, role):
    conn = psycopg.connect(**connection, dbname=database)
    conn.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps(dict(
        sub=str(fixture[who]), session_id=str(fixture[who.replace('_actor', '') + '_session']), role='authenticated', app_role=role, organization_id=str(fixture['org']),
        auth_claim_version=conn.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s', (fixture[who],)).fetchone()[0])),))
    conn.execute('SET ROLE authenticated')
    return conn


def save(conn, task, key):
    payload = json.dumps({"command": "record_work", "target_id": str(task), "arguments": {"payload": {"outcome": "performed", "values": {"pads_ok": True, "battery_pct": 60}, "note": "race"}}})
    return conn.execute('SELECT public.save_operation_command_draft_review(%s,%s::jsonb)', (key, payload)).fetchone()[0]


def resume(conn, draft):
    return conn.execute('SELECT public.resume_operation_command_draft_review(%s)', (draft,)).fetchone()[0]


def discard(conn, draft):
    return conn.execute('SELECT public.discard_operation_command_draft_review(%s)', (draft,)).fetchone()[0]


def wait_for_lock(observer, backend, thread, name):
    """Returns the relation whose row the backend is observed waiting on: a row
    lock waiter holds a granted tuple lock on that relation while it waits on
    the holder's transaction id (pg_locks), so the relation is read, not assumed."""
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if observer.execute("SELECT wait_event_type='Lock' AND wait_event IN('transactionid','tuple') FROM pg_stat_activity WHERE pid=%s", (backend,)).fetchone()[0]:
            relations = observer.execute("SELECT DISTINCT c.relname FROM pg_locks l JOIN pg_class c ON c.oid=l.relation WHERE l.pid=%s AND l.locktype='tuple'", (backend,)).fetchall()
            if relations:
                return sorted(r[0] for r in relations)
        if not thread.is_alive():
            raise AssertionError(f'{name}: command did not reach the row lock wait')
        time.sleep(0.03)
    raise AssertionError(f'{name}: did not observe database lock wait')


def prepare(database):
    setup = psycopg.connect(**connection, dbname=database)
    setup.execute(helpers_sql)
    setup.execute(fixture_sql)
    fixture = dict(zip([x.name for x in setup.execute('SELECT * FROM df').description], setup.execute('SELECT * FROM df').fetchone()))
    ids = dict(setup.execute('SELECT label,id FROM df_ids').fetchall())
    setup.commit()
    setup.close()
    return fixture, ids


def run_case(name, discard_first=False, resume_first=False):
    database = 'hfo_draft_probe_' + uuid.uuid4().hex[:16]
    admin = psycopg.connect(**connection, dbname='postgres', autocommit=True)
    admin.execute(sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(database), sql.Identifier(baseline)))
    try:
        fixture, ids = prepare(database)
        observer = psycopg.connect(**connection, dbname=database, autocommit=True)
        task = ids['occ_a1_d1']
        key = 'col146-race-' + ('000021' if discard_first else '000031' if resume_first else '000011')
        first = session(database, fixture, 'maint', 'maintenance_role')
        second = session(database, fixture, 'maint', 'maintenance_role')
        saved = save(first, task, key)
        first.commit()
        draft = saved['draft']['id']
        assert saved['replayed'] is False and saved['draft']['state'] == 'pending', saved
        result = {}
        if discard_first:
            first_value = discard(first, draft)
            assert first_value['draft']['state'] == 'discarded', first_value
        else:
            first_value = resume(first, draft)
            assert first_value['outcome'] == 'saved' and first_value['reply']['replayed'] is False and first_value['draft']['state'] == 'reconciled', first_value

        def command():
            try:
                result['value'] = discard(second, draft) if resume_first else resume(second, draft)
                second.commit()
            except psycopg.Error as error:
                result['sqlstate'] = error.sqlstate
                result['error'] = str(error)
                second.rollback()

        thread = threading.Thread(target=command)
        thread.start()
        waited_on = wait_for_lock(observer, second.info.backend_pid, thread, name)
        assert waited_on == ['operation_command_drafts'], (name, waited_on)
        first.commit()
        thread.join(8)
        if thread.is_alive():
            second.cancel()
            thread.join(2)
            raise AssertionError(f'{name}: waiting command did not finish after release')
        receipts = observer.execute('SELECT id::text,request_key FROM public.operation_execution_receipts WHERE task_instance_id=%s', (task,)).fetchall()
        row = observer.execute('SELECT state,reconciled_record,discarded_at IS NOT NULL FROM public.operation_command_drafts WHERE id=%s', (draft,)).fetchone()
        if discard_first:
            assert result.get('sqlstate') == 'P0001' and 'Draft was discarded' in result['error'], (name, result)
            assert receipts == [], (name, receipts)
            assert row[0] == 'discarded' and row[1] is None and row[2] is True, (name, row)
            summary = dict(outcome='resume refused after the wait; nothing recorded from the discarded draft', sqlstate='P0001', receipts=0, draft_state='discarded', waited_on=waited_on)
        elif resume_first:
            assert result.get('sqlstate') == 'P0001' and 'Draft is not pending' in result['error'], (name, result)
            assert len(receipts) == 1 and receipts[0][1] == key and receipts[0][0] == first_value['reply']['receipt']['id'], (name, receipts)
            assert row[0] == 'reconciled' and row[1]['id'] == receipts[0][0] and row[1]['replayed'] is False and row[2] is False, (name, row)
            summary = dict(outcome='discard refused after the wait; the resumed record stands', sqlstate='P0001', receipts=1, draft_state='reconciled', waited_on=waited_on)
        else:
            assert 'value' in result, (name, result)
            assert result['value']['outcome'] == 'saved' and result['value']['reply']['replayed'] is True and result['value']['reply']['receipt']['id'] == first_value['reply']['receipt']['id'], (name, result)
            assert result['value']['draft'] == first_value['draft'], (name, result)
            assert len(receipts) == 1 and receipts[0][0] == first_value['reply']['receipt']['id'], (name, receipts)
            assert row[0] == 'reconciled' and row[1]['id'] == receipts[0][0] and row[1]['replayed'] is False, (name, row)
            summary = dict(outcome='second resume replayed the one receipt after the wait; draft reconciled once', receipts=1, draft_state='reconciled', waited_on=waited_on)
        second.close()
        first.close()
        observer.close()
        return summary
    finally:
        admin.execute(sql.SQL('DROP DATABASE IF EXISTS {} WITH (FORCE)').format(sql.Identifier(database)))
        admin.close()


def main():
    report = {
        'issue': 'COL-146',
        'baseline_database': baseline,
        'cases': [
            dict(name='two resumes of one draft', **run_case('resume-resume')),
            dict(name='discard lands first, resume waits', **run_case('discard-then-resume', discard_first=True)),
            dict(name='resume lands first, discard waits', **run_case('resume-then-discard', resume_first=True)),
        ],
        'boundary': 'local PostgreSQL 17 with Supabase auth stubs; run-owned socket-only cluster',
    }
    print(json.dumps(report, indent=2, default=str))
    print('COL-146 draft concurrency PASS')


if __name__ == '__main__':
    main()
