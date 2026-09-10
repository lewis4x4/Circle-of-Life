#!/usr/bin/env python3
"""COL-145: observed PostgreSQL lock races for corrections in an explicitly
run-owned scratch cluster (native PostgreSQL, never Docker). Requires
psycopg. Clones the migrated scratch database named by
HFO_CORRECTION_BASELINE_DB (default col145_base344, which must already carry
migration 344) and applies the probe's fixture section. Local storage.objects
rows stand in for uploads; no byte moves. Every clone is dropped by exact
name in finally.

Cases:
1. Two corrections of one receipt with the same expected revision race: the
   second is observed waiting on the occurrence row lock held by the first;
   after the first commits it re-reads the effective receipt and is refused
   with the conflict naming the winner's correction and revision; exactly
   one correction exists and the corrected receipt is superseded once.
2. A correction races an evidence finalization on the same receipt, in both
   orders. Correction first: the finalization waits on the occurrence row,
   then finds its receipt superseded and is refused; the evidence stays
   uploaded and the correction stays performed-with-missing-evidence.
   Finalization first: the correction waits, then counts the finalized
   photo across the chain and completes with complete evidence.
3. A correction races a verification of the same receipt, in both orders.
   Verification first: the correction waits, then supersedes the review it
   finds bound to the corrected receipt and the occurrence awaits review
   again. Correction first: the verification waits, then is refused because
   the receipt it names is no longer the effective one; no review exists.
"""
import hashlib
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
baseline = os.environ.get('HFO_CORRECTION_BASELINE_DB', 'col145_base344')
probe = (root / 'supabase/tests/review_hfo_corrections.sql').read_text()
fixture_sql = probe.split('-- FIXTURES-BEGIN')[1].split('-- FIXTURES-END')[0]
helpers_sql = probe.split('BEGIN;')[1].split('-- Nothing in the migrations')[0].replace('ALTER ROLE service_role BYPASSRLS;', '')
ASSET_VALUES = {"pads_ok": True, "battery_pct": 70}


def session(database, fixture, who, role):
    conn = psycopg.connect(**connection, dbname=database)
    conn.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps(dict(
        sub=str(fixture[who]), session_id=str(fixture[who.replace('_actor', '') + '_session']), role='authenticated', app_role=role, organization_id=str(fixture['org']),
        auth_claim_version=conn.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s', (fixture[who],)).fetchone()[0])),))
    conn.execute('SET ROLE authenticated')
    return conn


def correct(conn, task, key, receipt, revision, payload):
    return conn.execute('SELECT public.correct_operation_work_review(%s,%s,%s,%s,%s::jsonb)', (task, key, receipt, revision, json.dumps(payload))).fetchone()[0]


def verify(conn, task, key, receipt, revision):
    return conn.execute('SELECT public.verify_operation_work_review(%s,%s,%s::jsonb)', (task, key, json.dumps({"decision": "verified", "receipt_id": str(receipt), "receipt_revision": revision}))).fetchone()[0]


def prepare_and_upload(conn, receipt, key):
    # The declared MD5 and the eTag Storage would write (the quoted MD5 of the stored bytes) agree, as in the 343 race script.
    digest = hashlib.md5(b"race.jpg").hexdigest()
    payload = json.dumps({"kind": "photo", "rule_label": "Panel photo", "filename": "race.jpg", "mime": "image/jpeg", "size_bytes": 321, "md5": digest})
    value = conn.execute('SELECT public.prepare_operation_evidence_review(%s,%s,%s::jsonb)', (receipt, key, payload)).fetchone()[0]
    evidence = value['evidence']['id']
    conn.execute("INSERT INTO storage.objects(bucket_id,name,owner,metadata,version) VALUES('operation-evidence',%s,auth.uid(),%s::jsonb,gen_random_uuid()::text)",
                 (value['evidence']['object_path'], json.dumps({"size": 321, "mimetype": "image/jpeg", "eTag": f'"{digest}"'})))
    conn.execute('SELECT public.mark_operation_evidence_uploaded_review(%s,%s)', (evidence, key + '-up'))
    conn.commit()
    return evidence


def finalize(conn, evidence, key, revision):
    return conn.execute("SELECT public.finalize_operation_evidence_review(%s,%s,%s,'{}'::jsonb)", (evidence, key, revision)).fetchone()[0]


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
    fixture = dict(zip([x.name for x in setup.execute('SELECT * FROM cf').description], setup.execute('SELECT * FROM cf').fetchone()))
    ids = dict(setup.execute('SELECT label,id FROM cf_ids').fetchall())
    setup.commit()
    setup.close()
    return fixture, ids


def revision_of(observer, receipt):
    return observer.execute('SELECT revision FROM public.operation_execution_receipts WHERE id=%s', (receipt,)).fetchone()[0]


def run_waiting(second, command, name, observer, release):
    """Run command on the second session in a thread, observe it waiting on a row lock, release the holder, and return the outcome."""
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
    wait_for_lock(observer, second.info.backend_pid, thread, name)
    release()
    thread.join(8)
    if thread.is_alive():
        second.cancel()
        thread.join(2)
        raise AssertionError(f'{name}: waiting command did not finish after release')
    return result


def with_clone(fn):
    def runner(name, *args):
        database = 'hfo_correction_probe_' + uuid.uuid4().hex[:16]
        admin = psycopg.connect(**connection, dbname='postgres', autocommit=True)
        admin.execute(sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(database), sql.Identifier(baseline)))
        try:
            fixture, ids = prepare(database)
            observer = psycopg.connect(**connection, dbname=database, autocommit=True)
            try:
                return fn(name, database, fixture, ids, observer, *args)
            finally:
                observer.close()
        finally:
            admin.execute(sql.SQL('DROP DATABASE IF EXISTS {} WITH (FORCE)').format(sql.Identifier(database)))
            admin.close()
    return runner


@with_clone
def two_corrections(name, database, fixture, ids, observer):
    task, receipt = ids['occ_a1_d1'], ids['r_a1']
    revision = revision_of(observer, receipt)
    first = session(database, fixture, 'maint', 'maintenance_role')
    second = session(database, fixture, 'maint', 'maintenance_role')
    first_value = correct(first, task, 'col145-race-000001', receipt, revision, {"reason": "first correction", "outcome": "performed", "values": ASSET_VALUES})
    assert first_value['replayed'] is False and first_value['receipt']['corrects_receipt_id'] == str(receipt), first_value
    result = run_waiting(second, lambda: correct(second, task, 'col145-race-000002', receipt, revision, {"reason": "second correction", "outcome": "performed", "values": {"pads_ok": True, "battery_pct": 71}}),
                         name, observer, lambda: (first.commit(), first.close()))
    winner = first_value['receipt']['id']
    assert result.get('sqlstate') == 'P0001' and 'Receipt changed since it was read' in result['error'], (name, result)
    assert result['detail'] == f"current_receipt_id={winner};current_receipt_revision={revision_of(observer, winner)}", (name, result)
    rows = observer.execute('SELECT id::text,corrects_receipt_id::text,superseded_by_receipt_id::text,correction_seq FROM public.operation_execution_receipts WHERE task_instance_id=%s ORDER BY recorded_at', (task,)).fetchall()
    assert rows == [(str(receipt), None, winner, 0), (winner, str(receipt), None, 1)], (name, rows)
    state = observer.execute('SELECT effective_receipt_id::text,status,execution_state FROM public.operation_task_instances WHERE id=%s', (task,)).fetchone()
    assert state == (winner, 'completed', 'completed'), (name, state)
    second.close()
    return dict(outcome='second correction refused after the wait with the conflict naming the winner', sqlstate='P0001', corrections=1, waited_on='occurrence row')


@with_clone
def correction_vs_finalization(name, database, fixture, ids, observer, correction_first):
    task, receipt = ids['occ_fac_d2'], ids['r_fac2']
    uploader = session(database, fixture, 'maint', 'maintenance_role')
    evidence = prepare_and_upload(uploader, receipt, 'col145-race-000010')
    uploader.close()
    revision = revision_of(observer, receipt)
    holder = session(database, fixture, 'maint', 'maintenance_role')
    second = session(database, fixture, 'maint', 'maintenance_role')
    if correction_first:
        held = correct(holder, task, 'col145-race-000011', receipt, revision, {"reason": "note fix", "outcome": "performed", "note": "Load test done"})
        result = run_waiting(second, lambda: finalize(second, evidence, 'col145-race-000012', revision), name, observer, lambda: (holder.commit(), holder.close()))
        assert result.get('sqlstate') == 'P0001' and 'Evidence attaches to the effective performance receipt' in result['error'], (name, result)
        state = observer.execute('SELECT state FROM public.operation_evidence WHERE id=%s', (evidence,)).fetchone()[0]
        assert state == 'uploaded', (name, state)
        kinds = [e[0] for e in observer.execute('SELECT event_kind FROM public.operation_evidence_events WHERE receipt_id=%s ORDER BY event_seq', (receipt,)).fetchall()]
        assert kinds == ['prepared', 'uploaded'], (name, kinds)
        correction = held['receipt']['id']
        row = observer.execute('SELECT evidence_status,evidence_status_current,completion_state FROM public.operation_execution_receipts WHERE id=%s', (correction,)).fetchone()
        assert row == ('missing', 'missing', 'performed_missing_evidence'), (name, row)
        occ = observer.execute('SELECT effective_receipt_id::text,status,execution_state FROM public.operation_task_instances WHERE id=%s', (task,)).fetchone()
        assert occ == (correction, 'in_progress', 'performed_missing_evidence'), (name, occ)
        summary = dict(outcome='finalization refused after the wait because its receipt was superseded; evidence stays uploaded; correction stays performed-with-missing-evidence', sqlstate='P0001', finalized_events=0, waited_on='occurrence row')
    else:
        held = finalize(holder, evidence, 'col145-race-000013', revision)
        assert held['satisfaction']['receipt_evidence_status'] == 'complete', held
        result = run_waiting(second, lambda: correct(second, task, 'col145-race-000014', receipt, revision, {"reason": "note fix", "outcome": "performed", "note": "Load test done"}),
                             name, observer, lambda: (holder.commit(), holder.close()))
        assert 'value' in result, (name, result)
        value = result['value']
        assert value['receipt']['evidence_status'] == 'complete' and value['receipt']['completion_state'] == 'completed' and value['receipt']['missing_evidence'] == [], (name, value['receipt'])
        assert value['occurrence']['status'] == 'completed' and value['occurrence']['execution_state'] == 'completed', (name, value['occurrence'])
        ev = observer.execute('SELECT state,receipt_id::text FROM public.operation_evidence WHERE id=%s', (evidence,)).fetchone()
        assert ev == ('finalized', str(receipt)), (name, ev)
        kinds = [e[0] for e in observer.execute('SELECT event_kind FROM public.operation_evidence_events WHERE receipt_id=%s ORDER BY event_seq', (receipt,)).fetchall()]
        assert kinds == ['prepared', 'uploaded', 'finalized', 'satisfied'], (name, kinds)
        summary = dict(outcome='correction landed after the finalization and carries the chain evidence as complete', finalized_events=1, satisfied_events=1, waited_on='occurrence row')
    second.close()
    return summary


@with_clone
def correction_vs_verification(name, database, fixture, ids, observer, correction_first):
    task, receipt = ids['occ_res_d1'], ids['r_res1']
    revision = revision_of(observer, receipt)
    if correction_first:
        holder = session(database, fixture, 'nurse', 'nurse')
        second = session(database, fixture, 'admin_a', 'facility_admin')
        held = correct(holder, task, 'col145-race-000020', receipt, revision, {"reason": "wrong week", "outcome": "performed", "note": "Weight down 2 lb"})
        result = run_waiting(second, lambda: verify(second, task, 'col145-race-000021', receipt, revision), name, observer, lambda: (holder.commit(), holder.close()))
        correction = held['receipt']['id']
        assert result.get('sqlstate') == 'P0001' and 'Receipt changed since it was read' in result['error'], (name, result)
        assert result['detail'] == f"current_receipt_id={correction};current_receipt_revision={revision_of(observer, correction)}", (name, result)
        reviews = observer.execute("SELECT count(*) FROM public.operation_execution_receipts WHERE task_instance_id=%s AND receipt_kind='verification'", (task,)).fetchone()[0]
        assert reviews == 0, (name, reviews)
        occ = observer.execute('SELECT effective_receipt_id::text,verification_receipt_id,status,execution_state FROM public.operation_task_instances WHERE id=%s', (task,)).fetchone()
        assert occ == (correction, None, 'in_progress', 'awaiting_verification'), (name, occ)
        summary = dict(outcome='verification refused after the wait with the conflict naming the correction; no review written; occurrence awaits review of the correction', sqlstate='P0001', verification_receipts=0, waited_on='occurrence row')
    else:
        holder = session(database, fixture, 'admin_a', 'facility_admin')
        second = session(database, fixture, 'nurse', 'nurse')
        held = verify(holder, task, 'col145-race-000022', receipt, revision)
        assert held['receipt']['verifies_receipt_id'] == str(receipt) and held['receipt']['verified_receipt_revision'] == revision, held
        result = run_waiting(second, lambda: correct(second, task, 'col145-race-000023', receipt, revision, {"reason": "wrong week", "outcome": "performed", "note": "Weight down 2 lb"}),
                             name, observer, lambda: (holder.commit(), holder.close()))
        assert 'value' in result, (name, result)
        value = result['value']
        review = held['receipt']['id']
        assert value['verification_superseded_receipt_id'] == review, (name, value)
        assert value['receipt']['completion_state'] == 'awaiting_verification' and value['occurrence']['execution_state'] == 'awaiting_verification', (name, value)
        row = observer.execute('SELECT superseded_by_receipt_id::text,verifies_receipt_id::text FROM public.operation_execution_receipts WHERE id=%s', (review,)).fetchone()
        assert row == (value['receipt']['id'], str(receipt)), (name, row)
        occ = observer.execute('SELECT effective_receipt_id::text,verification_receipt_id,second_sign_by,status,execution_state FROM public.operation_task_instances WHERE id=%s', (task,)).fetchone()
        assert occ == (value['receipt']['id'], None, None, 'in_progress', 'awaiting_verification'), (name, occ)
        summary = dict(outcome='correction landed after the verification and superseded the review bound to the corrected receipt; occurrence awaits review again', verification_receipts=1, superseded_reviews=1, waited_on='occurrence row')
    second.close()
    return summary


def main():
    report = {
        'issue': 'COL-145',
        'baseline_database': baseline,
        'cases': [
            dict(name='two corrections with the same expected revision', **two_corrections('two corrections')),
            dict(name='correction racing an evidence finalization', orders=[
                dict(order='correction first', **correction_vs_finalization('finalization after correction', True)),
                dict(order='finalization first', **correction_vs_finalization('correction after finalization', False)),
            ]),
            dict(name='correction racing a verification', orders=[
                dict(order='verification first', **correction_vs_verification('correction after verification', False)),
                dict(order='correction first', **correction_vs_verification('verification after correction', True)),
            ]),
        ],
        'boundary': 'local PostgreSQL 17 with Supabase auth and storage stubs; run-owned socket-only cluster; no byte transferred',
    }
    print(json.dumps(report, indent=2, default=str))
    print('COL-145 correction concurrency PASS')


if __name__ == '__main__':
    main()
