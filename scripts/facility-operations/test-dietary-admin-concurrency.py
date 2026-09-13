#!/usr/bin/env python3
"""COL-159: observed PostgreSQL lock races for facility service, dietary and
AED observation records in an explicitly run-owned scratch cluster (native
PostgreSQL, never Docker). Requires psycopg. Clones the migrated scratch
database named by HFO_SOURCE_BASELINE_DB (default col159_base348, which must
already carry migration 348) and applies the probe's fixture section (real
catalog activities at Homewood, synthetic versions, configurations, bindings
and occurrences; one AED, two extinguishers, a site-linked vendor). Every clone
is dropped by exact name in finally.

Cases:
1. Two staff record an AED operation check for the same AED and week under
   different keys: the second waits on the occurrence row behind the first
   and lands as a visible conflict; exactly one receipt exists.
2. A vendor extinguisher inspection races a person's recording of the same
   occurrence, both orders. Human first: the service record waits, is final,
   and its delivery is a pending conflict that overwrites nothing. Service
   first: the recording waits, then is refused with `Work is already
   recorded` naming the service receipt.
3. A correction and a void of one service record race, both orders: both take
   the record's advisory lock first, so the second waits and is answered by
   the first's state (void after correction invalidates the corrected
   version; correction after void is refused as voided).
4. The same request key raced from two sessions of one person for a meal
   substitution: the second waits on the request-key lock and replays the
   first's reply; one record.
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
baseline = os.environ.get('HFO_SOURCE_BASELINE_DB', 'col159_base348')
probe = (root / 'supabase/tests/review_hfo_dietary_admin_sources.sql').read_text()
fixture_sql = probe.split('-- FIXTURES-BEGIN')[1].split('-- FIXTURES-END')[0]
helpers_sql = probe.split('BEGIN;')[1].split('-- 0. Registration is exactly')[0].replace('ALTER ROLE service_role BYPASSRLS;', '')


def session(database, fixture, who, role):
    conn = psycopg.connect(**connection, dbname=database)
    conn.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps(dict(
        sub=str(fixture[who]), session_id=str(fixture[who.replace('_actor', '') + '_session']), role='authenticated', app_role=role, organization_id=str(fixture['org']),
        auth_claim_version=conn.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s', (fixture[who],)).fetchone()[0])),))
    conn.execute('SET ROLE authenticated')
    return conn


def record_observation(conn, key, fixture, asset, kind, observed_at, readings):
    payload = dict(facility_id=str(fixture['site_a']), asset_id=str(asset), observation_kind=kind, observed_at=observed_at.isoformat(), basis='staff_observed', outcome='pass', readings=readings)
    return conn.execute('SELECT public.record_asset_observation_review(%s,%s::jsonb)', (key, json.dumps(payload))).fetchone()[0]


def record_service(conn, key, fixture, kind, asset, performed_at, extra=None):
    payload = dict(facility_id=str(fixture['site_a']), service_kind=kind, performed_at=performed_at.isoformat(), outcome='pass')
    if asset is not None:
        payload['asset_id'] = str(asset)
    payload.update(extra or {})
    return conn.execute('SELECT public.record_facility_service_review(%s,%s::jsonb)', (key, json.dumps(payload))).fetchone()[0]


def correct_service(conn, record_id, key, expected_version, payload):
    return conn.execute('SELECT public.correct_facility_service_review(%s,%s,%s,%s::jsonb)', (record_id, key, expected_version, json.dumps(payload))).fetchone()[0]


def void_service(conn, record_id, key, reason):
    return conn.execute('SELECT public.void_facility_service_review(%s,%s,%s::jsonb)', (record_id, key, json.dumps(dict(reason=reason)))).fetchone()[0]


def record_substitution(conn, key, fixture, performed_at):
    payload = dict(facility_id=str(fixture['site_a']), record_kind='meal_substitution', performed_at=performed_at.isoformat(), service_date=fixture['d0'].isoformat(), meal_period='lunch',
                   planned_item='Baked chicken', substitute_item='Turkey loaf', substitution_reason='Delivery short')
    return conn.execute('SELECT public.record_dietary_record_review(%s,%s::jsonb)', (key, json.dumps(payload))).fetchone()[0]


def record_work(conn, task, key, payload):
    return conn.execute('SELECT public.record_operation_work_review(%s,%s,%s::jsonb)', (task, key, json.dumps(payload))).fetchone()[0]


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
        database = 'hfo_dietary_probe_' + uuid.uuid4().hex[:16]
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
def two_aed_checks_one_aed(name, database, fixture, ids, observer):
    task = ids['occ_aed_op_d0']
    first = session(database, fixture, 'maint', 'maintenance_role')
    second = session(database, fixture, 'admin_a', 'facility_admin')
    held = record_observation(first, 'col159-race-000001', fixture, fixture['aed1'], 'aed_operation_check', fixture['recent'], {"status_ok": True})
    assert held['linked'] is True and held['delivery']['event']['state'] == 'satisfied', held['delivery']['event']
    result = run_waiting(second, lambda: record_observation(second, 'col159-race-000002', fixture, fixture['aed1'], 'aed_operation_check', fixture['recent'], {"status_ok": True}), name, observer, lambda: (first.commit(), first.close()))
    assert 'value' in result, (name, result)
    value = result['value']
    assert value['linked'] is False and value['delivery']['event']['state'] == 'conflict' and value['delivery']['event']['reason'] == 'already_recorded' and value['delivery']['event']['attention'] is True, (name, value['delivery']['event'])
    occ = observer.execute('SELECT effective_receipt_id::text,status FROM public.operation_task_instances WHERE id=%s', (task,)).fetchone()
    assert occ == (held['delivery']['receipt']['id'], 'completed'), (name, occ)
    receipts = observer.execute('SELECT count(*) FROM public.operation_execution_receipts WHERE task_instance_id=%s', (task,)).fetchone()[0]
    records = observer.execute('SELECT count(*) FROM public.asset_observations').fetchone()[0]
    assert (receipts, records) == (1, 2), (name, receipts, records)
    eq = observer.execute('SELECT status FROM public.operation_task_instances WHERE id=%s', (ids['occ_aed_eq_d0'],)).fetchone()[0]
    assert eq == 'pending', (name, eq)
    second.close()
    return dict(outcome='second AED check waited on the occurrence and landed as a visible conflict; one receipt; the equipment component untouched', receipts=1, records=2, waited_on=result['waited_on'])


@with_clone
def service_vs_human(name, database, fixture, ids, observer, human_first):
    task = ids['occ_ext_insp1_d0']
    vendor_payload = dict(performer_kind='vendor', vendor_id=str(fixture['vendor_ok']), entry_reason='Race fixture vendor visit')
    human = session(database, fixture, 'maint', 'maintenance_role')
    admin = session(database, fixture, 'admin_a', 'facility_admin')
    if human_first:
        held = record_work(human, task, 'col159-race-000010', {"outcome": "performed", "entry_kind": "late", "entry_reason": "Race fixture"})
        result = run_waiting(admin, lambda: record_service(admin, 'col159-race-000011', fixture, 'extinguisher_inspection', fixture['ext1'], fixture['recent'], vendor_payload), name, observer, lambda: (human.commit(), human.close()))
        assert 'value' in result, (name, result)
        value = result['value']
        assert value['linked'] is False and value['delivery']['event']['state'] == 'conflict' and value['delivery']['event']['reason'] == 'already_recorded' and value['delivery']['receipt'] is None, (name, value['delivery']['event'])
        assert value['record']['finalized_at'] is not None, (name, value['record'])
        occ = observer.execute('SELECT effective_receipt_id::text FROM public.operation_task_instances WHERE id=%s', (task,)).fetchone()
        assert occ == (held['receipt']['id'],), (name, occ)
        summary = dict(outcome='service record landed as a pending conflict after the human recording; the record is final; the human receipt stays effective', sqlstate=None, receipts=1, waited_on=result['waited_on'])
    else:
        held = record_service(admin, 'col159-race-000012', fixture, 'extinguisher_inspection', fixture['ext1'], fixture['recent'], vendor_payload)
        assert held['linked'] is True and held['delivery']['event']['state'] == 'satisfied', held['delivery']['event']
        result = run_waiting(human, lambda: record_work(human, task, 'col159-race-000013', {"outcome": "performed", "entry_kind": "late", "entry_reason": "Race fixture"}), name, observer, lambda: (admin.commit(), admin.close()))
        assert result.get('sqlstate') == '23505' and 'Work is already recorded' in result['error'], (name, result)
        assert result['detail'] == f"current_receipt_id={held['delivery']['receipt']['id']}", (name, result)
        occ = observer.execute('SELECT effective_receipt_id::text,execution_state FROM public.operation_task_instances WHERE id=%s', (task,)).fetchone()
        assert occ == (held['delivery']['receipt']['id'], 'completed'), (name, occ)
        summary = dict(outcome='human recording refused after the wait naming the service record receipt', sqlstate='23505', receipts=1, waited_on=result['waited_on'])
    for conn in (human, admin):
        if not conn.closed:
            conn.close()
    return summary


@with_clone
def correct_vs_void(name, database, fixture, ids, observer, correction_first):
    task = ids['occ_ext_insp1_d0']
    recorder = session(database, fixture, 'maint', 'maintenance_role')
    held = record_service(recorder, 'col159-race-000020', fixture, 'extinguisher_inspection', fixture['ext1'], fixture['recent'], dict(readings={"tag_year": 2026}))
    recorder.commit()
    recorder.close()
    record_id = held['record']['id']
    corrector = session(database, fixture, 'maint', 'maintenance_role')
    voider = session(database, fixture, 'admin_a', 'facility_admin')
    if correction_first:
        held_c = correct_service(corrector, record_id, 'col159-race-000021', 1, {"reason": "Tag year misread", "readings": {"tag_year": 2025}})
        result = run_waiting(voider, lambda: void_service(voider, record_id, 'col159-race-000022', 'Wrong unit'), name, observer, lambda: (corrector.commit(), corrector.close()))
        assert 'value' in result, (name, result)
        value = result['value']
        assert held_c['delivery']['event']['state'] == 'corrected' and held_c['record']['record_version'] == 2, held_c['delivery']['event']
        assert value['delivery']['event']['state'] == 'invalidated' and value['delivery']['event']['source_record_version'] == '2' and value['record']['voided_at'] is not None, (name, value['delivery']['event'])
        rows = receipts_of(observer, task)
        assert rows == [('performance', '1', True), ('performance', '2', True), ('reversal', '2', False)], (name, rows)
        occ = observer.execute('SELECT effective_receipt_id,execution_state FROM public.operation_task_instances WHERE id=%s', (task,)).fetchone()
        assert occ == (None, 'none'), (name, occ)
        summary = dict(outcome='void waited on the record lock behind the correction and invalidated the corrected version; chain retained; occurrence unrecorded', receipts=3, waited_on=result['waited_on'])
    else:
        held_v = void_service(voider, record_id, 'col159-race-000023', 'Wrong unit')
        assert held_v['delivery']['event']['state'] == 'invalidated', held_v['delivery']['event']
        result = run_waiting(corrector, lambda: correct_service(corrector, record_id, 'col159-race-000024', 1, {"reason": "Tag year misread", "readings": {"tag_year": 2025}}), name, observer, lambda: (voider.commit(), voider.close()))
        assert result.get('sqlstate') == 'P0001' and 'Service record is voided' in result['error'], (name, result)
        rows = receipts_of(observer, task)
        assert rows == [('performance', '1', True), ('reversal', '1', False)], (name, rows)
        version = observer.execute('SELECT record_version,voided_at IS NOT NULL FROM public.facility_service_records WHERE id=%s', (record_id,)).fetchone()
        assert version == (1, True), (name, version)
        summary = dict(outcome='correction refused after the wait because the void landed first; record stays voided at version 1; reversal retained', sqlstate='P0001', receipts=2, waited_on=result['waited_on'])
    for conn in (corrector, voider):
        if not conn.closed:
            conn.close()
    return summary


@with_clone
def same_key_twice(name, database, fixture, ids, observer):
    first = session(database, fixture, 'cook', 'dietary')
    second = session(database, fixture, 'cook', 'dietary')
    held = record_substitution(first, 'col159-race-000030', fixture, fixture['recent'])
    result = run_waiting(second, lambda: record_substitution(second, 'col159-race-000030', fixture, fixture['recent']), name, observer, lambda: (first.commit(), first.close()))
    assert 'value' in result, (name, result)
    value = result['value']
    assert value['replayed'] is True and value['record']['id'] == held['record']['id'] and value['delivery']['event']['id'] == held['delivery']['event']['id'], (name, value['record'])
    records = observer.execute("SELECT count(*) FROM public.dietary_records").fetchone()[0]
    requests = observer.execute("SELECT count(*) FROM public.operation_source_record_requests WHERE request_key='col159-race-000030'").fetchone()[0]
    assert (records, requests) == (1, 1), (name, records, requests)
    second.close()
    return dict(outcome='second session waited on the request-key lock and replayed the first reply; one meal-level record, one request row', records=1, waited_on=result['waited_on'])


def main():
    report = {
        'issue': 'COL-159',
        'baseline': baseline,
        'runtime': 'native PostgreSQL scratch cluster ' + socket.name,
        'recorded_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'cases': {},
    }
    report['cases']['two_aed_checks_one_aed'] = two_aed_checks_one_aed('two_aed_checks_one_aed')
    report['cases']['human_first_then_service'] = service_vs_human('human_first_then_service', True)
    report['cases']['service_first_then_human'] = service_vs_human('service_first_then_human', False)
    report['cases']['correction_first_then_void'] = correct_vs_void('correction_first_then_void', True)
    report['cases']['void_first_then_correction'] = correct_vs_void('void_first_then_correction', False)
    report['cases']['same_key_twice'] = same_key_twice('same_key_twice')
    report['status'] = 'PASS'
    print(json.dumps(report, indent=2, default=str))


if __name__ == '__main__':
    main()
