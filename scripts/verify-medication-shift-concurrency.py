#!/usr/bin/env python3
"""Section 3 medication shift multi-connection SQL regression; only an explicitly run-owned local cluster.

PG_VERIFY_NATIVE_SOCKET/PORT/BIN must point to the same isolated cluster used by
pg-verify-migrations.mjs. Creates and drops only databases named by this process.
No application/hosted DSN is accepted. SQL fixtures contain synthetic data only.
"""
import json
import concurrent.futures
import threading
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
SOCKET = Path(os.environ['PG_VERIFY_NATIVE_SOCKET']).resolve()
BASE = (Path.home() / '.hermes/tmp/agent-runs').resolve()
assert SOCKET.is_relative_to(BASE), 'Run-owned local cluster required'
manifest = json.loads((SOCKET / 'manifest.json').read_text())
assert manifest['created_by'] == 'codex' and manifest['run_id'] == SOCKET.name
BIN = Path(os.environ['PG_VERIFY_NATIVE_BIN'])
assert BIN.is_absolute()
CONN = ['-h', str(SOCKET), '-p', os.environ.get('PG_VERIFY_NATIVE_PORT', '55439'), '-U', 'postgres']
PREFIX = f'section3_medshift_{os.getpid()}_{int(time.time())}'
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


try:
    database=PREFIX+'_base'
    create(database)
    files=[ROOT/'scripts/pg-verify-stub.sql',*sorted((ROOT/'supabase/migrations').glob('*.sql'))]
    for file in files: query(database,file.read_text())
    fixture=(ROOT/'supabase/tests/review_section3_medication_shifts.sql').read_text().split('GRANT SELECT ON clinical_fixture TO authenticated;')[0]
    fixture=fixture.replace('CREATE TEMP TABLE','CREATE TABLE')
    query(database,fixture+"ALTER TABLE clinical_fixture ADD COLUMN starts_at timestamptz DEFAULT now()-interval '1 hour',ADD COLUMN ends_at timestamptz DEFAULT now()+interval '7 hours'; GRANT SELECT ON clinical_fixture TO authenticated; COMMIT;")
    def authority(operator):
        person='witness' if operator else 'actor'
        session='operator_session' if operator else 'actor_session'
        return f"SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.{person},'session_id',f.{session},'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM clinical_fixture f JOIN user_profiles p ON p.id=f.{person}; SET LOCAL ROLE authenticated;"
    def overlap(sql,operator=False):
        barrier=threading.Barrier(6)
        def worker(_):
            barrier.wait(timeout=10)
            return query(database,'BEGIN;'+authority(operator)+sql+'COMMIT;',must_pass=False)
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool: results=list(pool.map(worker,range(6)))
        assert all(r.returncode==0 for r in results),[r.stderr for r in results]
    overlap('SELECT create_med_tech_shift(shift_id,facility,witness,starts_at,ends_at,ARRAY[resident]) FROM clinical_fixture;')
    overlap('SELECT start_med_tech_shift(shift_id) FROM clinical_fixture;',True)
    state=json.loads(query(database,"SELECT json_build_object('shifts',(SELECT count(*) FROM med_tech_shifts WHERE id=f.shift_id),'assignments',(SELECT count(*) FROM med_tech_shift_residents WHERE shift_id=f.shift_id),'passes',(SELECT count(*) FROM med_passes WHERE shift_id=f.shift_id),'start_events',(SELECT count(*) FROM shift_tape_events WHERE shift_id=f.shift_id AND event_type='shift_started'),'emar',(SELECT count(*) FROM emar_records WHERE resident_medication_id=f.med)) FROM clinical_fixture f;").stdout.strip())
    assert state=={'shifts':1,'assignments':1,'passes':1,'start_events':1,'emar':0},state
    print(json.dumps({'environment':'run-owned PostgreSQL with Auth stubs','migration_files':len(files)-1,'concurrent_create_requests':6,'concurrent_start_requests':6,'final_state':state,'passed':True},indent=2))
finally:
    for name in reversed(created):
        result=command('dropdb',[name])
        if result.returncode: raise RuntimeError(f'Run-owned database retained: {name}: {result.stderr}')
