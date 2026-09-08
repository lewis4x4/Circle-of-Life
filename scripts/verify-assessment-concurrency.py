#!/usr/bin/env python3
"""Section 3 assessment multi-connection SQL regression; only an explicitly run-owned local cluster.

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
PREFIX = f'section3_assessment_{os.getpid()}_{int(time.time())}'
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
    files = [ROOT / 'scripts/pg-verify-stub.sql', *sorted((ROOT / 'supabase/migrations').glob('*.sql'))]
    for file in files:
        query(database, file.read_text())
    fixture = (ROOT / 'supabase/tests/review_section3_assessment_risk.sql').read_text().split('GRANT SELECT ON clinical_fixture TO authenticated;')[0]
    fixture = fixture.replace('CREATE TEMP TABLE clinical_fixture', 'CREATE TABLE clinical_fixture')
    query(database, fixture + 'GRANT SELECT ON clinical_fixture TO authenticated; GRANT INSERT,UPDATE ON assessments TO authenticated; COMMIT;')
    authority = """SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM clinical_fixture f JOIN user_profiles p ON p.id=f.actor; SET LOCAL ROLE authenticated;"""
    report = {'migration_files':len(files)-1,'environment':'run-owned PostgreSQL with Auth stubs','cases':[]}
    for field, first_days, first_score, second_days, second_score in [('resident',10,0,1,65),('resident2',1,65,10,0)]:
        def insert(days, score):
            return f"INSERT INTO assessments(resident_id,facility_id,organization_id,assessment_type,assessment_date,total_score,assessed_by) SELECT {field},facility,org,'morse_fall',current_date-{days},{score},actor FROM clinical_fixture;"
        first_sql = 'BEGIN;'+authority+insert(first_days,first_score)+"\n\\echo LOCKED\nSELECT pg_sleep(2); COMMIT;\n"
        first = subprocess.Popen([str(BIN/'psql'),*CONN,'-X','-At','-d',database,'-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        first.stdin.write(first_sql)
        first.stdin.close()
        for line in first.stdout:
            if line.strip() == 'LOCKED':
                break
        else:
            raise RuntimeError(first.stderr.read())
        second = query(database, 'BEGIN;'+authority+insert(second_days,second_score)+'COMMIT;')
        assert first.wait(timeout=15)==0, first.stderr.read()
        result = query(database,f"SELECT fall_risk_level FROM residents WHERE id=(SELECT {field} FROM clinical_fixture);").stdout.strip()
        assert result=='high', result
        count = query(database,f"SELECT count(*) FROM assessments WHERE resident_id=(SELECT {field} FROM clinical_fixture);").stdout.strip()
        assert count=='2', count
        report['cases'].append({'first_assessment_days_ago':first_days,'second_assessment_days_ago':second_days,'current_risk':result,'retained_assessments':2,'passed':True})
    print(json.dumps(report,indent=2))
finally:
    for name in reversed(created):
        result = command('dropdb',[name])
        if result.returncode:
            raise RuntimeError(f'Run-owned database retained: {name}: {result.stderr}')
