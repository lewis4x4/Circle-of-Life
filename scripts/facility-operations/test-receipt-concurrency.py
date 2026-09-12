#!/usr/bin/env python3
"""COL-142: observed PostgreSQL lock races for execution receipts in an
explicitly run-owned scratch cluster (native PostgreSQL, never Docker).
Requires psycopg. Clones the migrated scratch database named by
HFO_RECEIPT_BASELINE_DB (default col142_base341, which must already carry
migration 341) and applies the probe's fixture section. Every clone is
dropped by exact name in finally.

Cases:
1. Two differing record attempts for the same occurrence race: the second is
   observed waiting on the occurrence row lock held by the first; after the
   first commits it receives the conflict naming the winner's receipt; exactly
   one receipt exists.
2. Two identical replays (same key, same content) race: exactly one receipt;
   both callers receive it (the second with replayed = true).
3. A recorder's can_record grant is revoked and committed while the recorder
   waits on the occurrence row: after the wait the command re-reads current
   authority and denies; no receipt exists.
4. Two independent reviewers verify the same awaiting occurrence at once: one
   verification receipt; the loser is refused after the wait because the
   occurrence is no longer awaiting verification.
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
baseline = os.environ.get('HFO_RECEIPT_BASELINE_DB', 'col142_base341')
probe = (root / 'supabase/tests/review_hfo_execution_receipts.sql').read_text()
fixture_sql = probe.split('-- FIXTURES-BEGIN')[1].split('-- FIXTURES-END')[0]
helpers_sql = probe.split('BEGIN;')[1].split('-- Nothing in the migrations')[0].replace('ALTER ROLE service_role BYPASSRLS;', '')
VALUES = json.dumps({"pads_ok": True, "battery_pct": 60})


def session(database, fixture, who, role):
    conn = psycopg.connect(**connection, dbname=database)
    conn.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps(dict(
        sub=str(fixture[who]), session_id=str(fixture[who.replace('_actor', '') + '_session']), role='authenticated', app_role=role, organization_id=str(fixture['org']),
        auth_claim_version=conn.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s', (fixture[who],)).fetchone()[0])),))
    conn.execute('SET ROLE authenticated')
    return conn


def record(conn, task, key, note, values=None):
    payload = json.dumps({"outcome": "performed", "values": json.loads(VALUES) if values is None else values, "note": note})
    return conn.execute('SELECT public.record_operation_work_review(%s,%s,%s::jsonb)', (task, key, payload)).fetchone()[0]


def verify(conn, task, key):
    return conn.execute("SELECT public.verify_operation_work_review(%s,%s,'{\"decision\":\"verified\"}'::jsonb)", (task, key)).fetchone()[0]


def wait_for_lock(observer, backend, thread, name):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if observer.execute("SELECT wait_event_type='Lock' AND wait_event IN('transactionid','tuple') FROM pg_stat_activity WHERE pid=%s", (backend,)).fetchone()[0]:
            return
        if not thread.is_alive():
            raise AssertionError(f'{name}: recorder did not reach the row lock wait')
        time.sleep(0.03)
    raise AssertionError(f'{name}: did not observe database lock wait')


def prepare(database):
    setup = psycopg.connect(**connection, dbname=database)
    setup.execute(helpers_sql)
    setup.execute(fixture_sql)
    fixture = dict(zip([x.name for x in setup.execute('SELECT * FROM rf').description], setup.execute('SELECT * FROM rf').fetchone()))
    ids = dict(setup.execute('SELECT label,id FROM rf_ids').fetchall())
    setup.commit()
    setup.close()
    return fixture, ids


def run_case(name, identical=False, revoke=False, reviewers=False):
    database = 'hfo_receipt_probe_' + uuid.uuid4().hex[:16]
    admin = psycopg.connect(**connection, dbname='postgres', autocommit=True)
    admin.execute(sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(database), sql.Identifier(baseline)))
    try:
        fixture, ids = prepare(database)
        observer = psycopg.connect(**connection, dbname=database, autocommit=True)
        result = {}
        if reviewers:
            task = ids['occ_res_d1']
            nurse = session(database, fixture, 'nurse', 'nurse')
            recorded = record(nurse, task, 'col142-race-000010', 'weight stable', values={})
            assert recorded['receipt']['completion_state'] == 'awaiting_verification', recorded
            nurse.commit()
            nurse.close()
            holder = session(database, fixture, 'admin_a', 'facility_admin')
            first_value = verify(holder, task, 'col142-race-000011')
            assert first_value['receipt']['receipt_kind'] == 'verification', first_value
            second = session(database, fixture, 'owner_actor', 'owner')
        elif revoke:
            task = ids['occ_res_d1']
            # The occurrence row is held by an unrelated transaction so the nurse's command waits.
            holder = psycopg.connect(**connection, dbname=database)
            holder.execute('SELECT id FROM public.operation_task_instances WHERE id=%s FOR UPDATE', (task,))
            second = session(database, fixture, 'nurse', 'nurse')
            first_value = None
        else:
            task = ids['occ_a1_d1']
            first = session(database, fixture, 'maint', 'maintenance_role')
            second = session(database, fixture, 'maint', 'maintenance_role')
            first_value = record(first, task, 'col142-race-000001', 'first attempt')
            assert first_value['replayed'] is False and first_value['receipt']['completion_state'] == 'completed', first_value
            holder = first

        def command():
            try:
                if reviewers:
                    result['value'] = verify(second, task, 'col142-race-000012')
                else:
                    key = 'col142-race-000001' if identical else 'col142-race-000002'
                    note = 'first attempt' if identical else 'second attempt'
                    result['value'] = record(second, task, key, note)
                second.commit()
            except psycopg.Error as error:
                result['sqlstate'] = error.sqlstate
                result['error'] = str(error)
                result['detail'] = error.diag.message_detail
                second.rollback()

        thread = threading.Thread(target=command)
        thread.start()
        wait_for_lock(observer, second.info.backend_pid, thread, name)
        if revoke:
            revoker = psycopg.connect(**connection, dbname=database)
            revoker.execute("UPDATE public.operation_subject_access SET revoked_at=clock_timestamp() WHERE user_id=%s AND scope='resident'", (fixture['nurse'],))
            revoker.commit()
            revoker.close()
        holder.commit()
        thread.join(8)
        if thread.is_alive():
            second.cancel()
            thread.join(2)
            raise AssertionError(f'{name}: waiting recorder did not finish after release')
        receipts = observer.execute('SELECT id::text,request_key,completion_state FROM public.operation_execution_receipts WHERE task_instance_id=%s ORDER BY recorded_at', (task,)).fetchall()
        if reviewers:
            assert result.get('sqlstate') == 'P0001' and 'not awaiting verification' in result['error'], (name, result)
            verifications = observer.execute("SELECT id::text FROM public.operation_execution_receipts WHERE task_instance_id=%s AND receipt_kind='verification'", (task,)).fetchall()
            assert len(verifications) == 1 and verifications[0][0] == first_value['receipt']['id'], (name, verifications)
            state = observer.execute('SELECT status,execution_state,verification_receipt_id::text FROM public.operation_task_instances WHERE id=%s', (task,)).fetchone()
            assert state == ('completed', 'completed', first_value['receipt']['id']), (name, state)
            summary = dict(outcome='second reviewer refused after the wait', sqlstate='P0001', verification_receipts=1, waited_on='occurrence row')
        elif revoke:
            assert result.get('sqlstate') == '42501', (name, result)
            assert receipts == [], (name, receipts)
            state = observer.execute('SELECT status,execution_state FROM public.operation_task_instances WHERE id=%s', (task,)).fetchone()
            assert state == ('pending', 'none'), (name, state)
            summary = dict(outcome='denied after the wait', sqlstate='42501', receipts=0, waited_on='occurrence row')
        elif identical:
            assert 'value' in result, (name, result)
            assert result['value']['replayed'] is True and result['value']['receipt']['id'] == first_value['receipt']['id'], (name, result)
            assert len(receipts) == 1 and receipts[0][0] == first_value['receipt']['id'], (name, receipts)
            summary = dict(outcome='same receipt replayed after the wait', receipts=1, waited_on='occurrence row')
        else:
            assert result.get('sqlstate') == '23505', (name, result)
            assert 'already recorded' in result['error'], (name, result)
            assert result['detail'] == 'current_receipt_id=' + first_value['receipt']['id'], (name, result)
            assert len(receipts) == 1 and receipts[0][0] == first_value['receipt']['id'], (name, receipts)
            summary = dict(outcome='conflict naming the winning receipt after the wait', sqlstate='23505', receipts=1, waited_on='occurrence row')
        second.close()
        holder.close()
        observer.close()
        return summary
    finally:
        admin.execute(sql.SQL('DROP DATABASE IF EXISTS {} WITH (FORCE)').format(sql.Identifier(database)))
        admin.close()


def main():
    report = {
        'issue': 'COL-142',
        'baseline_database': baseline,
        'cases': [
            dict(name='two differing record attempts for one occurrence', **run_case('differing')),
            dict(name='two identical replays for one occurrence', **run_case('identical', identical=True)),
            dict(name='can_record revoked while the recorder waits', **run_case('revoked', revoke=True)),
            dict(name='two reviewers verify the same occurrence', **run_case('reviewers', reviewers=True)),
        ],
        'boundary': 'local PostgreSQL 17 with Supabase auth stubs; run-owned socket-only cluster',
    }
    print(json.dumps(report, indent=2, default=str))
    print('COL-142 receipt concurrency PASS')


if __name__ == '__main__':
    main()
