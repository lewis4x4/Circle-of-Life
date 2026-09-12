#!/usr/bin/env python3
"""COL-152 observed multi-connection races on run-owned PostgreSQL 17 only.

Loads the repository stub and ordered migrations into a uniquely owned database;
each race gets an isolated clone and synthetic SQL-probe fixtures. No hosted URL,
application database, external delivery, or staff acceptance is exercised.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[2]
SOCKET = Path(os.environ['PG_VERIFY_NATIVE_SOCKET']).resolve()
assert SOCKET.is_relative_to((Path.home() / '.hermes/tmp/agent-runs').resolve())
manifest = json.loads((SOCKET / 'manifest.json').read_text())
assert manifest['created_by'] == 'codex' and manifest['run_id'] == SOCKET.name
BIN = Path(os.environ['PG_VERIFY_NATIVE_BIN'])
assert BIN.is_absolute()
PORT = os.environ.get('PG_VERIFY_NATIVE_PORT', '55462')
CONNECTION = dict(host=str(SOCKET), port=PORT, user='postgres')
TOKEN = uuid.uuid4().hex[:16]
BASELINE = 'hfo_reminder_base_' + TOKEN
PROVENANCE = SOCKET / ('reminder-concurrency-' + TOKEN + '.json')
owned = []


def provenance():
    PROVENANCE.write_text(json.dumps(dict(created_by='codex', run_id=SOCKET.name,
        owner='COL-152 reminder concurrency proof', artifacts=[str(PROVENANCE)],
        scratch_databases=owned), indent=2) + '\n')


def connect(database, **kwargs):
    return psycopg.connect(**CONNECTION, dbname=database, **kwargs)


def create(admin, database, template=None):
    statement = sql.SQL('CREATE DATABASE {}').format(sql.Identifier(database))
    if template:
        statement += sql.SQL(' TEMPLATE {}').format(sql.Identifier(template))
    admin.execute(statement)
    owned.append(dict(name=database, state='created'))
    provenance()


def drop(admin, database):
    admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(database)))
    next(item for item in owned if item['name'] == database)['state'] = 'dropped'
    provenance()


def actor_session(database, fixture):
    conn = connect(database)
    version = conn.execute('SELECT auth_claim_version FROM user_profiles WHERE id=%s', (fixture['maint'],)).fetchone()[0]
    conn.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps(dict(
        sub=str(fixture['maint']), session_id=str(fixture['maint_session']),
        role='authenticated', app_role='maintenance_role', organization_id=str(fixture['org']),
        auth_claim_version=version)),))
    conn.execute('SET ROLE authenticated')
    conn.execute("SET statement_timeout='12s'")
    return conn


def command(conn, task, issue=None, expected=None, key=None):
    return conn.execute('SELECT public.operation_reminder_review(%s,%s,%s,NULL,%s,%s)',
        (task, 'acknowledge' if key else 'refresh', expected, key, issue)).fetchone()[0]


def race(observer, second, operation, release):
    result = {}

    def run():
        try:
            result['value'] = operation()
            second.commit()
        except psycopg.Error as error:
            result.update(sqlstate=error.sqlstate, error=str(error))
            second.rollback()

    thread = threading.Thread(target=run)
    thread.start()
    try:
        deadline = time.monotonic() + 8
        while thread.is_alive() and time.monotonic() < deadline:
            state = observer.execute('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=%s', (second.info.backend_pid,)).fetchone()
            if state and state[0] == 'Lock':
                result['observed_wait'] = state[1]
                break
            time.sleep(0.02)
        assert result.get('observed_wait') == 'advisory', result
        blockers = observer.execute('SELECT pg_blocking_pids(%s)', (second.info.backend_pid,)).fetchone()[0]
        assert blockers, 'Expected a real blocking transaction'
        release()
    finally:
        thread.join(8)
        if thread.is_alive():
            second.cancel()
            thread.join(2)
    assert not thread.is_alive(), 'Command did not finish after lock release'
    return result


def fixture_sql():
    probe = (ROOT / 'supabase/tests/review_hfo_reminders.sql').read_text()
    prefix = probe.split('-- Freeze synthetic occurrence timing')[0]
    # Keep the transaction-scoped fixture helper functions and JWT settings
    # intact until this complete synthetic setup commits.
    problems = probe.split('-- Two independent open problems on the same task keep separate windows/ownership.')[1].split("INSERT INTO ifx_results VALUES('issue1'")[0]
    return prefix.replace('CREATE TEMP TABLE', 'CREATE TABLE') + "\nSELECT pg_temp.i_login('maint'); SET LOCAL ROLE authenticated;\n" + problems + '\nRESET ROLE; COMMIT;'


def case(admin, name):
    database = 'hfo_reminder_race_' + uuid.uuid4().hex[:16]
    create(admin, database, BASELINE)
    sessions = []
    try:
        observer = connect(database, autocommit=True)
        sessions.append(observer)
        observer.execute(fixture_sql())
        with connect(database, row_factory=dict_row) as reader:
            fixture = reader.execute('SELECT * FROM ifx').fetchone()
        ids = dict(observer.execute('SELECT label,id FROM ifx_ids').fetchall())
        task, issue1, issue2 = (ids[key] for key in ('occ_a1_d1', 'problem1', 'problem2'))
        first, second = actor_session(database, fixture), actor_session(database, fixture)
        sessions += [first, second]
        if name == 'distinct_issues_same_task':
            initial = command(first, task, issue1)
            result = race(observer, second, lambda: command(second, task, issue2), first.commit)
            assert 'sqlstate' not in result, result
            assert initial['id'] != result['value']['id']
            assert initial['state'] == result['value']['state'] == 'active'
            assert observer.execute('SELECT count(*),count(DISTINCT reminder_issue_id) FROM operation_escalation_deliveries WHERE task_instance_id=%s', (task,)).fetchone() == (2, 2)
            assert command(first, task, issue1)['id'] == initial['id']
            first.commit()
            assert command(second, task, issue2)['id'] == result['value']['id']
            second.commit()
            expected_episodes, expected_responses = 2, 0
        elif name == 'same_request_exact_replay':
            initial = command(first, task, issue1)
            first.commit()
            saved = command(first, task, issue1, initial['revision'], 'race-reminder-ack-0001')
            result = race(observer, second, lambda: command(second, task, issue1, initial['revision'], 'race-reminder-ack-0001'), first.commit)
            assert 'sqlstate' not in result, result
            replay = result['value']
            assert replay['replayed'] is True
            assert {k: v for k, v in replay.items() if k != 'replayed'} == {k: v for k, v in saved.items() if k != 'replayed'}
            expected_episodes, expected_responses = 1, 1
        else:
            first.execute('RESET ROLE')
            first.execute("SELECT pg_advisory_xact_lock(hashtextextended('operation-reminder:'||%s,0))", (str(task),))

            def release():
                column = 'revoked_at' if name == 'revoked_during_wait' else 'operation_expires_at'
                observer.execute(sql.SQL("UPDATE user_facility_access SET {}=clock_timestamp()-interval '1 second' WHERE user_id=%s AND facility_id=%s").format(sql.Identifier(column)), (fixture['maint'], fixture['site_a']))
                first.commit()

            result = race(observer, second, lambda: command(second, task, issue1), release)
            assert result.get('sqlstate') == '42501', result
            expected_episodes, expected_responses = 0, 0
        episodes = observer.execute('SELECT count(*) FROM operation_escalation_deliveries').fetchone()[0]
        responses = observer.execute('SELECT count(*) FROM operation_reminder_responses').fetchone()[0]
        assert (episodes, responses) == (expected_episodes, expected_responses)
        assert observer.execute('SELECT count(*) FROM operation_execution_receipts').fetchone()[0] == 0
        return dict(case=name, result='PASS', observed_wait=result['observed_wait'],
            sqlstate=result.get('sqlstate'), replayed=result.get('value', {}).get('replayed'),
            episode_count=episodes, response_count=responses, work_receipt_count=0)
    finally:
        for session in reversed(sessions):
            session.close()
        drop(admin, database)


def main():
    provenance()
    evidence = dict(scope='Local native PostgreSQL 17 with Supabase stubs and synthetic fixtures',
        recorded_at=datetime.now(timezone.utc).isoformat(), cases=[], provenance=str(PROVENANCE))
    with connect('postgres', autocommit=True) as admin:
        create(admin, BASELINE)
        try:
            files = [ROOT / 'scripts/pg-verify-stub.sql', *sorted((ROOT / 'supabase/migrations').glob('*.sql'))]
            evidence['migration_count'] = len(files) - 1
            evidence['migration_350_sha256'] = hashlib.sha256(files[-1].read_bytes()).hexdigest()
            evidence['postgres_version'] = admin.execute('SHOW server_version').fetchone()[0]
            for file in files:
                result = subprocess.run([str(BIN / 'psql'), '-h', str(SOCKET), '-p', PORT, '-U', 'postgres', '-d', BASELINE, '-v', 'ON_ERROR_STOP=1', '-f', str(file)], capture_output=True, text=True, timeout=120)
                if result.returncode:
                    raise RuntimeError(f'{file.name}: {result.stderr}')
            for name in ('distinct_issues_same_task', 'same_request_exact_replay', 'revoked_during_wait', 'expired_during_wait'):
                evidence['cases'].append(case(admin, name))
                print(json.dumps(evidence['cases'][-1]), flush=True)
            evidence['result'] = 'PASS'
        except Exception as error:
            evidence.update(result='FAIL', error=str(error))
            raise
        finally:
            drop(admin, BASELINE)
            destination = ROOT / 'docs/facility-operations/col152-evidence/concurrency.json'
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(json.dumps(evidence, indent=2) + '\n')


if __name__ == '__main__':
    main()
