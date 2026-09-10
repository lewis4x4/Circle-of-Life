#!/usr/bin/env python3
"""COL-143: observed PostgreSQL lock races for evidence finalization in an
explicitly run-owned scratch cluster (native PostgreSQL, never Docker).
Requires psycopg. Clones the migrated scratch database named by
HFO_EVIDENCE_BASELINE_DB (default col143_base343, which must already carry
the current migration 343 with checksum verification) and applies the
probe's fixture section. Local storage.objects rows stand in for uploads with
eTags equal to the MD5 of known bytes; no byte moves. Every clone is dropped
by exact name in finally.

Cases:
1. Two finalizations of the same uploaded evidence with different request
   keys race: the second is observed waiting on the evidence row lock held by
   the first; after the first commits it re-reads the row and is refused
   because the evidence is already finalized; exactly one finalized event and
   exactly one satisfaction event exist and the occurrence completed once.
2. A finalization races a receipt correction: a superuser session holds the
   receipt row with a revision change (standing in for the HFO-08 supersession
   command) while the uploader finalizes with the revision it read; the
   finalization is observed waiting on the receipt row, re-reads it after the
   commit and is refused because the receipt changed; no finalized event, no
   satisfaction, the evidence stays uploaded and the occurrence stays
   performed-with-missing-evidence.
3. Two finalizations of two different evidence rows on one receipt overlap:
   session A already holds the occurrence row (it is mid-command), B
   finalizes its own row and is observed waiting on the occurrence row, then A
   finalizes and commits. Both complete without a deadlock (the evidence
   commands lock occurrence, then receipt, then evidence, in that order) and
   exactly one satisfaction exists.
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
baseline = os.environ.get('HFO_EVIDENCE_BASELINE_DB', 'col143_base343')
probe = (root / 'supabase/tests/review_hfo_verified_evidence.sql').read_text()
fixture_sql = probe.split('-- FIXTURES-BEGIN')[1].split('-- FIXTURES-END')[0]
helpers_sql = probe.split('BEGIN;')[1].split('-- Nothing in the migrations')[0].replace('ALTER ROLE service_role BYPASSRLS;', '')


def session(database, fixture, who, role):
    conn = psycopg.connect(**connection, dbname=database)
    conn.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps(dict(
        sub=str(fixture[who]), session_id=str(fixture[who.replace('_actor', '') + '_session']), role='authenticated', app_role=role, organization_id=str(fixture['org']),
        auth_claim_version=conn.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s', (fixture[who],)).fetchone()[0])),))
    conn.execute('SET ROLE authenticated')
    return conn


def prepare_and_upload(conn, receipt, key, filename):
    # The known bytes of the stand-in upload are the filename; the declared MD5
    # and the eTag Storage would write (the quoted MD5 of the stored bytes) agree.
    digest = hashlib.md5(filename.encode()).hexdigest()
    payload = json.dumps({"kind": "photo", "rule_label": "Panel photo", "filename": filename, "mime": "image/jpeg", "size_bytes": 321, "md5": digest})
    value = conn.execute('SELECT public.prepare_operation_evidence_review(%s,%s,%s::jsonb)', (receipt, key, payload)).fetchone()[0]
    evidence = value['evidence']['id']
    conn.execute("INSERT INTO storage.objects(bucket_id,name,owner,metadata,version) VALUES('operation-evidence',%s,auth.uid(),%s::jsonb,gen_random_uuid()::text)",
                 (value['evidence']['object_path'], json.dumps({"size": 321, "mimetype": "image/jpeg", "eTag": f'"{digest}"'})))
    uploaded = conn.execute('SELECT public.mark_operation_evidence_uploaded_review(%s,%s)', (evidence, key + '-up')).fetchone()[0]
    assert uploaded['outcome'] == 'uploaded' and uploaded['evidence']['checksum_verified'] is True, uploaded
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
    fixture = dict(zip([x.name for x in setup.execute('SELECT * FROM ef').description], setup.execute('SELECT * FROM ef').fetchone()))
    ids = dict(setup.execute('SELECT label,id FROM ef_ids').fetchall())
    setup.commit()
    setup.close()
    return fixture, ids


def run_overlap_case(name):
    database = 'hfo_evidence_probe_' + uuid.uuid4().hex[:16]
    admin = psycopg.connect(**connection, dbname='postgres', autocommit=True)
    admin.execute(sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(database), sql.Identifier(baseline)))
    try:
        fixture, ids = prepare(database)
        observer = psycopg.connect(**connection, dbname=database, autocommit=True)
        receipt = ids['r_fac3']
        occurrence = ids['occ_fac_d3']
        uploader = session(database, fixture, 'maint', 'maintenance_role')
        ev_a = prepare_and_upload(uploader, receipt, 'col143-race-000101', 'race-a.jpg')
        ev_b = prepare_and_upload(uploader, receipt, 'col143-race-000102', 'race-b.jpg')
        revision = observer.execute('SELECT revision FROM public.operation_execution_receipts WHERE id=%s', (receipt,)).fetchone()[0]
        # Session A is a superuser backend that adopts the uploader's session so
        # it can hold the occurrence row (as the command itself does mid-flight)
        # and then run the finalization on the same connection.
        first = psycopg.connect(**connection, dbname=database)
        first.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps(dict(
            sub=str(fixture['maint']), session_id=str(fixture['maint_session']), role='authenticated', app_role='maintenance_role', organization_id=str(fixture['org']),
            auth_claim_version=first.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s', (fixture['maint'],)).fetchone()[0])),))
        first.execute('SELECT id FROM public.operation_task_instances WHERE id=%s FOR UPDATE', (occurrence,))
        second = session(database, fixture, 'maint', 'maintenance_role')
        result = {}

        def command():
            try:
                result['value'] = finalize(second, ev_b, 'col143-race-000103', revision)
                second.commit()
            except psycopg.Error as error:
                result['sqlstate'] = error.sqlstate
                result['error'] = str(error)
                second.rollback()

        thread = threading.Thread(target=command)
        thread.start()
        wait_for_lock(observer, second.info.backend_pid, thread, name)
        first_value = finalize(first, ev_a, 'col143-race-000104', revision)
        first.commit()
        first.close()
        thread.join(8)
        if thread.is_alive():
            second.cancel()
            thread.join(2)
            raise AssertionError(f'{name}: waiting command did not finish after release')
        assert 'value' in result and result['value']['evidence']['state'] == 'finalized', (name, result)
        assert first_value['evidence']['state'] == 'finalized' and first_value['satisfaction']['receipt_evidence_status'] == 'complete', (name, first_value)
        assert result['value']['satisfaction'] is None, (name, result['value']['satisfaction'])
        kinds = [e[0] for e in observer.execute('SELECT event_kind FROM public.operation_evidence_events WHERE receipt_id=%s ORDER BY event_seq', (receipt,)).fetchall()]
        assert kinds.count('finalized') == 2 and kinds.count('satisfied') == 1, (name, kinds)
        row = observer.execute('SELECT status,execution_state FROM public.operation_task_instances WHERE id=%s', (occurrence,)).fetchone()
        assert row == ('completed', 'completed'), (name, row)
        second.close()
        uploader.close()
        observer.close()
        return dict(outcome='both finalizations completed without a deadlock; one satisfaction', finalized_events=2, satisfied_events=1, waited_on='occurrence row')
    finally:
        admin.execute(sql.SQL('DROP DATABASE IF EXISTS {} WITH (FORCE)').format(sql.Identifier(database)))
        admin.close()


def run_case(name, correction=False):
    database = 'hfo_evidence_probe_' + uuid.uuid4().hex[:16]
    admin = psycopg.connect(**connection, dbname='postgres', autocommit=True)
    admin.execute(sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(database), sql.Identifier(baseline)))
    try:
        fixture, ids = prepare(database)
        observer = psycopg.connect(**connection, dbname=database, autocommit=True)
        receipt = ids['r_fac3']
        occurrence = ids['occ_fac_d3']
        uploader = session(database, fixture, 'maint', 'maintenance_role')
        evidence = prepare_and_upload(uploader, receipt, 'col143-race-000001', 'race.jpg')
        revision = observer.execute('SELECT revision FROM public.operation_execution_receipts WHERE id=%s', (receipt,)).fetchone()[0]
        result = {}
        if correction:
            holder = psycopg.connect(**connection, dbname=database)
            # A superuser stands in for the HFO-08 supersession command: the
            # row-level triggers are bypassed so the revision can move while
            # the row lock is held; the finalization must see the new revision.
            holder.execute("SET session_replication_role='replica'")
            holder.execute("UPDATE public.operation_execution_receipts SET revision=encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex') WHERE id=%s", (receipt,))
            second = session(database, fixture, 'maint', 'maintenance_role')
        else:
            first = session(database, fixture, 'maint', 'maintenance_role')
            second = session(database, fixture, 'maint', 'maintenance_role')
            first_value = finalize(first, evidence, 'col143-race-000002', revision)
            assert first_value['replayed'] is False and first_value['evidence']['state'] == 'finalized', first_value

        def command():
            try:
                result['value'] = finalize(second, evidence, 'col143-race-000003', revision)
                second.commit()
            except psycopg.Error as error:
                result['sqlstate'] = error.sqlstate
                result['error'] = str(error)
                second.rollback()

        thread = threading.Thread(target=command)
        thread.start()
        wait_for_lock(observer, second.info.backend_pid, thread, name)
        if correction:
            holder.commit()
            holder.close()
        else:
            first.commit()
            first.close()
        thread.join(8)
        if thread.is_alive():
            second.cancel()
            thread.join(2)
            raise AssertionError(f'{name}: waiting command did not finish after release')
        events = observer.execute('SELECT event_kind FROM public.operation_evidence_events WHERE receipt_id=%s ORDER BY event_seq', (receipt,)).fetchall()
        state = observer.execute('SELECT state FROM public.operation_evidence WHERE id=%s', (evidence,)).fetchone()[0]
        row = observer.execute('SELECT status,execution_state FROM public.operation_task_instances WHERE id=%s', (occurrence,)).fetchone()
        receipt_row = observer.execute('SELECT evidence_status_current FROM public.operation_execution_receipts WHERE id=%s', (receipt,)).fetchone()[0]
        kinds = [e[0] for e in events]
        if correction:
            assert result.get('sqlstate') == 'P0001' and 'changed since it was read' in result['error'], (name, result)
            assert kinds == ['prepared', 'uploaded'] and state == 'uploaded', (name, kinds, state)
            assert row == ('in_progress', 'performed_missing_evidence') and receipt_row == 'missing', (name, row, receipt_row)
            summary = dict(outcome='finalization refused by the moved receipt revision after the wait; nothing satisfied', sqlstate='P0001', finalized_events=0, satisfied_events=0, waited_on='receipt row')
        else:
            assert result.get('sqlstate') == 'P0001' and 'already finalized' in result['error'], (name, result)
            assert kinds == ['prepared', 'uploaded', 'finalized', 'satisfied'] and state == 'finalized', (name, kinds, state)
            assert row == ('completed', 'completed') and receipt_row == 'complete', (name, row, receipt_row)
            summary = dict(outcome='second finalization refused after the wait; one finalized event, one satisfaction', sqlstate='P0001', finalized_events=1, satisfied_events=1, waited_on='occurrence row (first lock in the command order)')
        second.close()
        uploader.close()
        observer.close()
        return summary
    finally:
        admin.execute(sql.SQL('DROP DATABASE IF EXISTS {} WITH (FORCE)').format(sql.Identifier(database)))
        admin.close()


def main():
    report = {
        'issue': 'COL-143',
        'baseline_database': baseline,
        'cases': [
            dict(name='two finalizations of one uploaded evidence', **run_case('finalize')),
            dict(name='finalization racing a receipt correction', **run_case('correction', correction=True)),
            dict(name='two finalizations on one receipt overlapping on the occurrence row', **run_overlap_case('overlap')),
        ],
        'boundary': 'local PostgreSQL 17 with Supabase auth and storage stubs; run-owned socket-only cluster; no byte transferred',
    }
    print(json.dumps(report, indent=2, default=str))
    print('COL-143 evidence concurrency PASS')


if __name__ == '__main__':
    main()
