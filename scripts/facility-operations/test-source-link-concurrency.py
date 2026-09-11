#!/usr/bin/env python3
"""COL-147: observed PostgreSQL lock races for source-record links in an
explicitly run-owned scratch cluster (native PostgreSQL, never Docker).
Requires psycopg. Clones the migrated scratch database named by
HFO_SOURCE_BASELINE_DB (default col147_base346, which must already carry
migration 346) and applies the probe's fixture section (synthetic adapter,
synthetic source table, versions, configurations, bindings, occurrences).
Every clone is dropped by exact name in finally.

Cases:
1. Two deliveries of one final source version under different request keys
   race: the second is observed waiting on the per-record advisory lock held
   by the first; after the first commits it converges on the one ledger row
   (replayed) and exactly one receipt exists.
2. A source delivery races a human recording of the same occurrence, both
   orders. Human first: the delivery waits on the occurrence row, then finds
   the human receipt and lands as a pending conflict without overwriting.
   Delivery first: the recording waits, then is refused with `Work is
   already recorded` naming the source receipt.
3. A void of a source record races a human correction of the source receipt,
   both orders. Correction first: the void waits, then refuses as
   source_not_effective with attention; the correction stays effective.
   Void first: the correction waits, then conflicts naming the reversal and
   the occurrence stays unrecorded.
5. An administrator's retry of a refused-with-attention row races a
   re-delivery of the same version: the same advisory-lock-first order on
   both sides means the second waits and converges; no deadlock.
4. Versions 1 and 2 of one record race: whichever holds the advisory lock
   first settles; the live source is version 2, so version 1 is refused as
   source_version_changed when it lands second, or version 2 corrects the
   version-1 receipt when it lands second. Either order leaves one effective
   receipt at version 2.
"""
from datetime import timedelta
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
baseline = os.environ.get('HFO_SOURCE_BASELINE_DB', 'col147_base346')
probe = (root / 'supabase/tests/review_hfo_source_links.sql').read_text()
fixture_sql = probe.split('-- FIXTURES-BEGIN')[1].split('-- FIXTURES-END')[0]
helpers_sql = probe.split('BEGIN;')[1].split('-- Nothing in the migrations')[0].replace('ALTER ROLE service_role BYPASSRLS;', '')


def session(database, fixture, who, role):
    conn = psycopg.connect(**connection, dbname=database)
    conn.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps(dict(
        sub=str(fixture[who]), session_id=str(fixture[who.replace('_actor', '') + '_session']), role='authenticated', app_role=role, organization_id=str(fixture['org']),
        auth_claim_version=conn.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s', (fixture[who],)).fetchone()[0])),))
    conn.execute('SET ROLE authenticated')
    return conn


def deliver(conn, key, source, record, version, kind, facility):
    payload = json.dumps(dict(source_key=source, source_record_id=record, source_record_version=version, event_kind=kind, facility_id=str(facility)))
    return conn.execute('SELECT public.deliver_operation_source_event_review(%s,%s::jsonb)', (key, payload)).fetchone()[0]


def record(conn, task, key, payload):
    return conn.execute('SELECT public.record_operation_work_review(%s,%s,%s::jsonb)', (task, key, json.dumps(payload))).fetchone()[0]


def correct(conn, task, key, receipt, revision, payload):
    return conn.execute('SELECT public.correct_operation_work_review(%s,%s,%s,%s,%s::jsonb)', (task, key, receipt, revision, json.dumps(payload))).fetchone()[0]


def put_source(observer, fixture, record_id, version, finality, activity, kind, native, by, at_offset_minutes, statement):
    """Upsert one synthetic source record directly (the probe's src() helper is session-local to the setup connection)."""
    recorded_at = fixture['past_due'] + timedelta(minutes=at_offset_minutes)
    observer.execute("""INSERT INTO public.hfo_probe_source_records(id,version,finality,facility_id,activity_id,subject_kind,subject_native_id,recorded_by,recorded_at,statement)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
        ON CONFLICT(id) DO UPDATE SET version=excluded.version,finality=excluded.finality,facility_id=excluded.facility_id,activity_id=excluded.activity_id,subject_kind=excluded.subject_kind,
         subject_native_id=excluded.subject_native_id,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at,statement=excluded.statement""",
                     (record_id, version, finality, fixture['site_a'], fixture[activity], kind, native, fixture[by], recorded_at, json.dumps(statement, default=str) if statement is not None else None))


def wait_for_lock(observer, backend, thread, name):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if observer.execute("SELECT wait_event_type='Lock' AND wait_event IN('transactionid','tuple','advisory') FROM pg_stat_activity WHERE pid=%s", (backend,)).fetchone()[0]:
            return observer.execute("SELECT wait_event FROM pg_stat_activity WHERE pid=%s", (backend,)).fetchone()[0]
        if not thread.is_alive():
            raise AssertionError(f'{name}: command did not reach the lock wait')
        time.sleep(0.03)
    raise AssertionError(f'{name}: did not observe database lock wait')


def prepare(database):
    setup = psycopg.connect(**connection, dbname=database)
    setup.execute(helpers_sql)
    setup.execute(fixture_sql)
    fixture = dict(zip([x.name for x in setup.execute('SELECT * FROM cf').description], setup.execute('SELECT * FROM cf').fetchone()))
    ids = dict(setup.execute('SELECT label,id FROM cf_ids').fetchall())
    setup.commit()
    # The fixture helpers live in pg_temp of the setup session; the observer needs its own copy of src().
    return fixture, ids, setup


def run_waiting(second, command, name, observer, release):
    """Run command on the second session in a thread, observe it waiting on a lock, release the holder, and return the outcome."""
    result = {}

    def target():
        try:
            result['value'] = command()
            second.commit()
        except psycopg.Error as error:
            result['sqlstate'] = error.sqlstate
            result['error'] = str(error)
            result['detail'] = error.diag.message_detail
            second.rollback()

    thread = threading.Thread(target=target)
    thread.start()
    result['waited_on'] = wait_for_lock(observer, second.info.backend_pid, thread, name)
    release()
    thread.join(8)
    if thread.is_alive():
        second.cancel()
        thread.join(2)
        raise AssertionError(f'{name}: waiting command did not finish after release')
    return result


def with_clone(fn):
    def runner(name, *args):
        database = 'hfo_source_probe_' + uuid.uuid4().hex[:16]
        admin = psycopg.connect(**connection, dbname='postgres', autocommit=True)
        admin.execute(sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(database), sql.Identifier(baseline)))
        try:
            fixture, ids, setup = prepare(database)
            observer = psycopg.connect(**connection, dbname=database, autocommit=True)
            try:
                return fn(name, database, fixture, ids, observer, *args)
            finally:
                observer.close()
                setup.close()
        finally:
            admin.execute(sql.SQL('DROP DATABASE IF EXISTS {} WITH (FORCE)').format(sql.Identifier(database)))
            admin.close()
    return runner


def receipts_of(observer, task):
    return observer.execute("SELECT receipt_kind,source_record_version,superseded_by_receipt_id IS NOT NULL FROM public.operation_execution_receipts WHERE task_instance_id=%s ORDER BY recorded_at,id", (task,)).fetchall()


@with_clone
def same_version_twice(name, database, fixture, ids, observer):
    first = session(database, fixture, 'admin_a', 'facility_admin')
    second = session(database, fixture, 'admin_a', 'facility_admin')
    held = deliver(first, 'col147-race-000001', 'probe-asset', 'aed-1', '1', 'final', fixture['site_a'])
    assert held['replayed'] is False and held['event']['state'] == 'satisfied', held
    result = run_waiting(second, lambda: deliver(second, 'col147-race-000002', 'probe-asset', 'aed-1', '1', 'final', fixture['site_a']), name, observer, lambda: (first.commit(), first.close()))
    assert 'value' in result, (name, result)
    value = result['value']
    assert value['replayed'] is True and value['event']['id'] == held['event']['id'] and value['receipt']['id'] == held['receipt']['id'], (name, value)
    rows = observer.execute("SELECT count(*) FROM public.operation_source_events WHERE source_record_id='aed-1'").fetchone()[0]
    receipts = observer.execute("SELECT count(*) FROM public.operation_execution_receipts WHERE source_record_id='aed-1'").fetchone()[0]
    assert (rows, receipts) == (1, 1), (name, rows, receipts)
    second.close()
    return dict(outcome='second delivery converged on the first ledger row after the wait; one receipt', ledger_rows=1, receipts=1, waited_on=result['waited_on'])


@with_clone
def delivery_vs_human(name, database, fixture, ids, observer, human_first):
    task = ids['occ_a1_d0']
    human = session(database, fixture, 'maint', 'maintenance_role')
    admin = session(database, fixture, 'admin_a', 'facility_admin')
    if human_first:
        held = record(human, task, 'col147-race-000010', {"outcome": "performed", "values": {"pads_ok": True, "battery_pct": 60}, "entry_kind": "late", "entry_reason": "Race fixture"})
        result = run_waiting(admin, lambda: deliver(admin, 'col147-race-000011', 'probe-asset', 'aed-1', '1', 'final', fixture['site_a']), name, observer, lambda: (human.commit(), human.close()))
        assert 'value' in result, (name, result)
        value = result['value']
        assert value['event']['state'] == 'conflict' and value['event']['reason'] == 'already_recorded' and value['event']['attention'] is True and value['receipt'] is None, (name, value['event'])
        occ = observer.execute('SELECT effective_receipt_id::text,status FROM public.operation_task_instances WHERE id=%s', (task,)).fetchone()
        assert occ == (held['receipt']['id'], 'completed'), (name, occ)
        summary = dict(outcome='delivery landed as a pending conflict after the human recording; the human receipt stays effective', sqlstate=None, receipts=1, waited_on=result['waited_on'])
    else:
        held = deliver(admin, 'col147-race-000012', 'probe-asset', 'aed-1', '1', 'final', fixture['site_a'])
        assert held['event']['state'] == 'satisfied', held['event']
        result = run_waiting(human, lambda: record(human, task, 'col147-race-000013', {"outcome": "performed", "values": {"pads_ok": True, "battery_pct": 60}, "entry_kind": "late", "entry_reason": "Race fixture"}),
                             name, observer, lambda: (admin.commit(), admin.close()))
        assert result.get('sqlstate') == '23505' and 'Work is already recorded' in result['error'], (name, result)
        assert result['detail'] == f"current_receipt_id={held['receipt']['id']}", (name, result)
        occ = observer.execute('SELECT effective_receipt_id::text,status FROM public.operation_task_instances WHERE id=%s', (task,)).fetchone()
        assert occ == (held['receipt']['id'], 'completed'), (name, occ)
        summary = dict(outcome='human recording refused after the wait naming the source receipt', sqlstate='23505', receipts=1, waited_on=result['waited_on'])
    for conn in (human, admin):
        if not conn.closed:
            conn.close()
    return summary


@with_clone
def void_vs_correction(name, database, fixture, ids, observer, correction_first):
    task = ids['occ_a1_d0']
    admin = session(database, fixture, 'admin_a', 'facility_admin')
    held = deliver(admin, 'col147-race-000020', 'probe-asset', 'aed-1', '1', 'final', fixture['site_a'])
    admin.commit()
    receipt = held['receipt']['id']
    revision = observer.execute('SELECT revision FROM public.operation_execution_receipts WHERE id=%s', (receipt,)).fetchone()[0]
    put_source(observer, fixture, 'aed-1', '2', 'voided', 'act_asset', 'asset', fixture['asset1'], 'maint', 30, None)
    corrector = session(database, fixture, 'maint', 'maintenance_role')
    voider = session(database, fixture, 'admin_a', 'facility_admin')
    payload = {"reason": "Battery misread", "entry_kind": "late", "outcome": "performed", "values": {"pads_ok": True, "battery_pct": 85}}
    if correction_first:
        held_c = correct(corrector, task, 'col147-race-000021', receipt, revision, payload)
        result = run_waiting(voider, lambda: deliver(voider, 'col147-race-000022', 'probe-asset', 'aed-1', '2', 'voided', fixture['site_a']), name, observer, lambda: (corrector.commit(), corrector.close()))
        assert 'value' in result, (name, result)
        value = result['value']
        assert value['event']['state'] == 'refused' and value['event']['reason'] == 'source_not_effective' and value['event']['attention'] is True and value['receipt'] is None, (name, value['event'])
        occ = observer.execute('SELECT effective_receipt_id::text,status,execution_state FROM public.operation_task_instances WHERE id=%s', (task,)).fetchone()
        assert occ == (held_c['receipt']['id'], 'completed', 'completed'), (name, occ)
        summary = dict(outcome='void refused after the wait as source_not_effective with attention; the human correction stays effective', receipts=2, waited_on=result['waited_on'])
    else:
        held_v = deliver(voider, 'col147-race-000023', 'probe-asset', 'aed-1', '2', 'voided', fixture['site_a'])
        assert held_v['event']['state'] == 'invalidated', held_v['event']
        result = run_waiting(corrector, lambda: correct(corrector, task, 'col147-race-000024', receipt, revision, payload), name, observer, lambda: (voider.commit(), voider.close()))
        assert result.get('sqlstate') == 'P0001' and 'Occurrence has no recorded work' in result['error'], (name, result)
        occ = observer.execute('SELECT effective_receipt_id,status,execution_state FROM public.operation_task_instances WHERE id=%s', (task,)).fetchone()
        assert occ[0] is None and occ[2] == 'none' and occ[1] in ('pending', 'missed'), (name, occ)
        rows = receipts_of(observer, task)
        assert rows == [('performance', '1', True), ('reversal', '2', False)], (name, rows)
        summary = dict(outcome='correction refused after the wait because the void reversed the source receipt; occurrence unrecorded with the reversed chain retained', sqlstate='P0001', receipts=2, waited_on=result['waited_on'])
    for conn in (corrector, voider):
        if not conn.closed:
            conn.close()
    return summary


@with_clone
def two_versions(name, database, fixture, ids, observer, v1_first):
    task = ids['occ_a1_d0']
    # The live source is already version 2 when both deliveries run.
    put_source(observer, fixture, 'aed-1', '2', 'final', 'act_asset', 'asset', fixture['asset1'], 'maint', 10, {"performed_at": fixture['past_due'].isoformat(), "outcome": "performed", "values": {"pads_ok": True, "battery_pct": 70}})
    a = session(database, fixture, 'admin_a', 'facility_admin')
    b = session(database, fixture, 'admin_a', 'facility_admin')
    first_version, second_version = ('1', '2') if v1_first else ('2', '1')
    held = deliver(a, 'col147-race-000030', 'probe-asset', 'aed-1', first_version, 'final', fixture['site_a'])
    result = run_waiting(b, lambda: deliver(b, 'col147-race-000031', 'probe-asset', 'aed-1', second_version, 'final', fixture['site_a']), name, observer, lambda: (a.commit(), a.close()))
    assert 'value' in result, (name, result)
    value = result['value']
    if v1_first:
        # Version 1 is stale against the live source: refused; version 2 then satisfies.
        assert held['event']['state'] == 'refused' and held['event']['reason'] == 'source_version_changed', held['event']
        assert value['event']['state'] == 'satisfied' and value['receipt']['source_record_version'] == '2', (name, value['event'])
        rows = receipts_of(observer, task)
        assert rows == [('performance', '2', False)], (name, rows)
        summary = dict(outcome='stale version 1 refused as source_version_changed; version 2 satisfied after the wait; one effective receipt at version 2', receipts=1, waited_on=result['waited_on'])
    else:
        assert held['event']['state'] == 'satisfied' and held['receipt']['source_record_version'] == '2', held['event']
        assert value['event']['state'] == 'refused' and value['event']['reason'] == 'source_version_changed', (name, value['event'])
        rows = receipts_of(observer, task)
        assert rows == [('performance', '2', False)], (name, rows)
        summary = dict(outcome='version 2 satisfied first; stale version 1 refused after the wait as source_version_changed; one effective receipt at version 2', receipts=1, waited_on=result['waited_on'])
    b.close()
    return summary


@with_clone
def retry_vs_redelivery(name, database, fixture, ids, observer):
    """An administrator's retry of a refused-with-attention row races a re-delivery of the same version: both take the per-record advisory lock first, so
    the second waits instead of deadlocking; exactly one live row exists afterwards."""
    # The aide is outside the AED recorder list, so the delivery is refused with attention; then the aide is promoted so a retry can satisfy.
    put_source(observer, fixture, 'aed-1', '1', 'final', 'act_asset', 'asset', fixture['asset1'], 'aide', 10, {"performed_at": fixture['past_due'].isoformat(), "outcome": "performed", "values": {"pads_ok": True, "battery_pct": 90}})
    admin = session(database, fixture, 'admin_a', 'facility_admin')
    first = deliver(admin, 'col147-race-000040', 'probe-asset', 'aed-1', '1', 'final', fixture['site_a'])
    admin.commit()
    assert first['event']['state'] == 'refused' and first['event']['reason'] == 'recorder_not_authorized' and first['event']['attention'] is True, first['event']
    observer.execute("UPDATE public.user_profiles SET app_role='maintenance_role' WHERE id=%s", (fixture['aide'],))
    event_id, revision = first['event']['id'], first['event']['revision']
    retrier = session(database, fixture, 'admin_a', 'facility_admin')
    redeliverer = session(database, fixture, 'admin_a', 'facility_admin')
    held = retrier.execute("SELECT public.reconcile_operation_source_event_review(%s,%s,%s,%s::jsonb)", (event_id, 'col147-race-000041', revision, json.dumps({"action": "retry"}))).fetchone()[0]
    result = run_waiting(redeliverer, lambda: deliver(redeliverer, 'col147-race-000042', 'probe-asset', 'aed-1', '1', 'final', fixture['site_a']), name, observer, lambda: (retrier.commit(), retrier.close()))
    assert 'value' in result, (name, result)
    assert held['event']['state'] == 'satisfied', held['event']
    assert result['value']['replayed'] is True and result['value']['event']['id'] == event_id, (name, result['value']['event'])
    live = observer.execute("SELECT count(*) FROM public.operation_source_events WHERE source_record_id='aed-1' AND state<>'refused'").fetchone()[0]
    receipts = observer.execute("SELECT count(*) FROM public.operation_execution_receipts WHERE source_record_id='aed-1'").fetchone()[0]
    assert (live, receipts) == (1, 1), (name, live, receipts)
    redeliverer.close()
    return dict(outcome='re-delivery waited on the advisory lock behind the retry and converged on the now-live row; no deadlock; one live row, one receipt', live_rows=1, receipts=1, waited_on=result['waited_on'])


def main():
    report = {
        'issue': 'COL-147',
        'baseline': baseline,
        'runtime': 'native PostgreSQL scratch cluster ' + socket.name,
        'recorded_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'cases': {},
    }
    report['cases']['same_version_twice'] = same_version_twice('same_version_twice')
    report['cases']['human_first_then_delivery'] = delivery_vs_human('human_first_then_delivery', True)
    report['cases']['delivery_first_then_human'] = delivery_vs_human('delivery_first_then_human', False)
    report['cases']['correction_first_then_void'] = void_vs_correction('correction_first_then_void', True)
    report['cases']['void_first_then_correction'] = void_vs_correction('void_first_then_correction', False)
    report['cases']['version1_first_then_version2'] = two_versions('version1_first_then_version2', True)
    report['cases']['version2_first_then_version1'] = two_versions('version2_first_then_version1', False)
    report['cases']['retry_vs_redelivery'] = retry_vs_redelivery('retry_vs_redelivery')
    report['status'] = 'PASS'
    print(json.dumps(report, indent=2, default=str))


if __name__ == '__main__':
    main()
