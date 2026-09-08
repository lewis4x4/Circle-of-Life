#!/usr/bin/env python3
"""Section 3 discharge/reservation multi-connection SQL regression; only an explicitly run-owned local cluster.

PG_VERIFY_NATIVE_SOCKET/PORT/BIN must point to the same isolated cluster used by
pg-verify-migrations.mjs. Creates and drops only databases named by this process.
No application/hosted DSN is accepted. SQL fixtures contain synthetic data only.
"""
import json
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
PREFIX = f'section3_discharge_{os.getpid()}_{int(time.time())}'
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
    database = PREFIX + '_base'
    create(database)
    files = [ROOT/'scripts/pg-verify-stub.sql',*sorted((ROOT/'supabase/migrations').glob('*.sql'))]
    for file in files:
        query(database,file.read_text())
    fixture = (ROOT/'supabase/tests/review_section3_discharge.sql').read_text().split('-- Verify the clinical role')[0]
    fixture = fixture.replace('CREATE TEMP TABLE','CREATE TABLE')
    query(database,fixture+'COMMIT;')
    admission = query(database,"INSERT INTO admission_cases(organization_id,facility_id,resident_id,status,financial_clearance_at,physician_orders_received_at) SELECT org,facility,resident2,'draft',now(),now() FROM clinical_fixture RETURNING id;").stdout.splitlines()[0]
    reservation = f"UPDATE admission_cases SET status='bed_reserved',bed_id=(SELECT bed_id FROM discharge_bed_fixture) WHERE id='{admission}';"
    denied = query(database,reservation,must_pass=False)
    assert denied.returncode != 0 and 'This bed is no longer available for reservation' in denied.stderr,denied.stderr
    first_sql = "BEGIN; UPDATE residents SET status='discharged',bed_id=NULL,discharge_date=current_date WHERE id=(SELECT resident FROM clinical_fixture);\n\\echo LOCKED\nSELECT pg_sleep(2); COMMIT;\n"
    first = subprocess.Popen([str(BIN/'psql'),*CONN,'-X','-At','-d',database,'-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    first.stdin.write(first_sql); first.stdin.close()
    for line in first.stdout:
        if line.strip()=='LOCKED': break
    else: raise RuntimeError(first.stderr.read())
    query(database,reservation)
    assert first.wait(timeout=15)==0,first.stderr.read()
    state=json.loads(query(database,"SELECT json_build_object('resident_status',r.status,'resident_bed',r.bed_id,'bed_status',b.status,'occupant',b.current_resident_id,'reservation',b.reserved_for_admission_case_id) FROM residents r JOIN clinical_fixture f ON r.id=f.resident JOIN discharge_bed_fixture x ON true JOIN beds b ON b.id=x.bed_id;").stdout.strip())
    assert state=={'resident_status':'discharged','resident_bed':None,'bed_status':'hold','occupant':None,'reservation':admission},state
    print(json.dumps({'environment':'run-owned native PostgreSQL with Auth stubs','migration_files':len(files)-1,'reservation_while_occupied':'rejected','reservation_overlapping_discharge':'passed','final_state':state},indent=2))
finally:
    for name in reversed(created):
        result=command('dropdb',[name])
        if result.returncode: raise RuntimeError(f'Run-owned database retained: {name}: {result.stderr}')
