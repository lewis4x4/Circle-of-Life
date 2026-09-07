#!/usr/bin/env python3
"""Section 2 multi-connection SQL regression; only an explicitly run-owned local cluster.

PG_VERIFY_NATIVE_SOCKET/PORT/BIN must point to the same isolated cluster used by
pg-verify-migrations.mjs. Creates and drops only databases named by this process.
No application/hosted DSN is accepted. SQL fixtures contain synthetic data only.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOCKET = Path(os.environ['PG_VERIFY_NATIVE_SOCKET']).resolve()
BASE = (Path.home() / '.hermes/tmp/agent-runs').resolve()
assert SOCKET.is_relative_to(BASE), 'Run-owned local cluster required'
manifest = json.loads((SOCKET / 'manifest.json').read_text())
assert manifest['created_by'] == 'codex' and manifest['run_id'] == SOCKET.name
BIN = Path(os.environ['PG_VERIFY_NATIVE_BIN'])
assert BIN.is_absolute()
CONN = ['-h', str(SOCKET), '-p', os.environ.get('PG_VERIFY_NATIVE_PORT', '55439'), '-U', 'postgres']
PREFIX = f'section2_concurrency_{os.getpid()}_{int(time.time())}'
created = []


def command(tool, args, sql=None):
    return subprocess.run([str(BIN / tool), *CONN, *args], input=sql, text=True,
                          capture_output=True, timeout=120)


def query(db, sql, must_pass=True):
    result = command('psql', ['-X', '-At', '-d', db, '-v', 'ON_ERROR_STOP=1'], sql)
    if must_pass and result.returncode:
        raise RuntimeError(result.stderr[-4000:])
    return result


def create(name, template=None):
    result = command('createdb', (['-T', template] if template else []) + [name])
    assert result.returncode == 0, result.stderr
    created.append(name)


def overlap(db, statements):
    barrier = threading.Barrier(len(statements))
    def worker(sql):
        barrier.wait(timeout=10)
        return query(db, 'SET ROLE service_role; ' + sql, must_pass=False)
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(statements)) as pool:
        return list(pool.map(worker, statements))


def receipt_table(db):
    names = query(db, "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%round%completion%receipt%';").stdout.strip().splitlines()
    assert len(names) == 1, names
    return names[0]


def counts(db):
    table = receipt_table(db)
    sql = f"""SELECT json_build_object(
      'logs',(SELECT count(*) FROM resident_observation_logs WHERE task_id IN (SELECT task FROM rounding_fixture UNION ALL SELECT direct_task FROM rounding_fixture UNION ALL SELECT rollback_task FROM rounding_fixture)),
      'exceptions',(SELECT count(*) FROM resident_observation_exceptions WHERE log_id IN (SELECT id FROM resident_observation_logs WHERE staff_id=(SELECT staff_id FROM rounding_fixture))),
      'receipts',(SELECT count(*) FROM {table}),
      'flags',(SELECT count(*) FROM resident_observation_integrity_flags WHERE staff_id=(SELECT staff_id FROM rounding_fixture)),
      'completed_tasks',(SELECT count(*) FROM resident_observation_tasks WHERE id IN (SELECT task FROM rounding_fixture UNION ALL SELECT direct_task FROM rounding_fixture UNION ALL SELECT rollback_task FROM rounding_fixture) AND completed_log_id IS NOT NULL));"""
    return json.loads(query(db, sql).stdout.strip())


try:
    template = PREFIX + '_base'
    create(template)
    files = [ROOT / 'scripts/pg-verify-stub.sql', *sorted((ROOT / 'supabase/migrations').glob('*.sql'))]
    for file in files:
        query(template, file.read_text())
    # Reuse precisely the fixture used in the rollback regression, committing it
    # only in this disposable database so independent sessions share the same tasks.
    fixture = (ROOT / 'supabase/tests/review_rounding_completion_receipts.sql').read_text().split('\\if :{?rounding_before}')[0]
    fixture = fixture.replace('CREATE TEMP TABLE rounding_fixture', 'CREATE TABLE rounding_fixture').replace('pg_temp.', 'public.')
    query(template, fixture + '\nCOMMIT;')
    report = {'migration_files': len(files)-1, 'environment': 'isolated native PostgreSQL with Supabase stubs', 'cases': []}

    db = PREFIX + '_duplicate'
    create(db, template)
    results = overlap(db, ['SELECT public.round_complete();'] * 6)
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    receipts = [json.loads(r.stdout.strip().splitlines()[-1]) for r in results]
    assert len({r['log_id'] for r in receipts}) == 1, receipts
    observed = counts(db)
    assert observed == {'logs': 1, 'exceptions': 1, 'receipts': 1, 'flags': 1, 'completed_tasks': 1}, observed
    report['cases'].append({'case': 'six concurrent identical retries', 'successes': 6, 'unique_log_ids': 1, **observed})

    db = PREFIX + '_competing'
    create(db, template)
    statements = [f"SELECT public.round_complete(NULL,public.round_payload('{uuid.uuid4()}'::uuid));" for _ in range(2)]
    results = overlap(db, statements)
    assert sorted(r.returncode == 0 for r in results) == [False, True], [(r.returncode,r.stderr) for r in results]
    failure = next(r.stderr for r in results if r.returncode)
    assert 'conflict' in failure.lower() or 'complet' in failure.lower(), failure
    observed = counts(db)
    assert observed == {'logs': 1, 'exceptions': 1, 'receipts': 1, 'flags': 1, 'completed_tasks': 1}, observed
    report['cases'].append({'case': 'two concurrent different request keys', 'successes': 1, 'conflicts': 1, **observed})

    db = PREFIX + '_patterns'
    create(db, template)
    statements = [f"SELECT public.round_complete((SELECT {field} FROM rounding_fixture),public.round_payload('{uuid.uuid4()}'::uuid));" for field in ['task','direct_task','rollback_task']]
    if time.time() % 60 > 55:
        time.sleep(61 - time.time() % 60)
    results = overlap(db, statements)
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    observed = counts(db)
    # Three late exceptions plus the velocity threshold flag from the third
    # serialized completion. These fixtures deliberately use one resident.
    assert observed == {'logs': 3, 'exceptions': 3, 'receipts': 3, 'flags': 4, 'completed_tasks': 3}, observed
    report['cases'].append({'case': 'three different tasks concurrently cross staff velocity threshold', 'successes': 3, **observed})
    db = PREFIX + '_revocation'
    create(db, template)
    # Hold the grant update in a separate transaction, then submit completion.
    # The actor verifier must wait and reject after the revocation commits.
    revoker = subprocess.Popen([str(BIN / 'psql'), *CONN, '-X', '-qAt', '-d', db, '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    revoker.stdin.write("BEGIN; UPDATE user_facility_access SET revoked_at=now() WHERE user_id=(SELECT actor FROM rounding_fixture); SELECT 'revocation-held'; SELECT pg_sleep(1); COMMIT;\n")
    revoker.stdin.close()
    assert revoker.stdout.readline().strip() == 'revocation-held'
    denied = query(db, 'SET ROLE service_role; SELECT public.round_complete();', must_pass=False)
    revoker.wait(timeout=10)
    assert revoker.returncode == 0, revoker.stderr.read()
    assert denied.returncode != 0 and 'authoriz' in denied.stderr.lower(), denied.stderr
    observed = counts(db)
    assert observed == {'logs': 0, 'exceptions': 0, 'receipts': 0, 'flags': 0, 'completed_tasks': 0}, observed
    report['cases'].append({'case': 'grant revocation holds lock before concurrent completion', 'denied': 1, **observed})
    report['verdict'] = 'PASS'
    print(json.dumps(report, indent=2))
finally:
    for db in reversed(created):
        result = command('dropdb', [db])
        if result.returncode:
            raise RuntimeError(f'Run-owned database retained: {db}: {result.stderr}')
