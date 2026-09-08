"""Local disposable PostgreSQL proof; requires the explicitly run-owned server."""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import time

root = Path.cwd()
socket = Path(os.environ['PG_VERIFY_NATIVE_SOCKET']).resolve()
assert socket.is_relative_to(Path.home() / '.hermes/tmp/agent-runs')
manifest = json.loads((socket / 'manifest.json').read_text())
assert manifest['created_by'] == 'codex' and manifest['run_id'] == socket.name
bin_path = Path(os.environ['PG_VERIFY_NATIVE_BIN'])
connection = ['-h', str(socket), '-p', os.environ['PG_VERIFY_NATIVE_PORT'], '-U', 'postgres']
db = 'haven_payroll_concurrency_' + str(os.getpid())

def command(tool, args, sql=None):
    return subprocess.run([str(bin_path / tool), *connection, *args], input=sql, text=True, capture_output=True, timeout=180)

def sql(text):
    result = command('psql', ['-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], text)
    if result.returncode:
        raise RuntimeError(result.stderr[-4000:])
    if result.stderr and "PASS:" in result.stderr:
        print(result.stderr.strip())
    return result.stdout

manifest.setdefault('scratch_databases', []).append(db)
(socket / 'manifest.json').write_text(json.dumps(manifest))
assert command('createdb', [db]).returncode == 0
try:
    sql((root / 'scripts/pg-verify-stub.sql').read_text())
    for migration in sorted((root / 'supabase/migrations').glob('*.sql')):
        if migration.name.startswith('334_payroll_source_freshness'):
            setup = (root / 'supabase/tests/review_payroll_freshness.sql').read_text().split('SET LOCAL ROLE authenticated;')[0]
            sql(setup + "INSERT INTO payroll_export_lines(organization_id,batch_id,staff_id,line_kind,time_record_id,idempotency_key,payload) SELECT org,journal,employee,'time_record_hours',punch,'time_record:'||punch::text,'{\"actual_hours\":7.5}'::jsonb FROM payroll_fixture; UPDATE time_records SET clock_out='2090-01-02 21:00Z' WHERE id=(SELECT punch FROM payroll_fixture); DO $$ BEGIN IF (SELECT public.payroll_export_snapshot(journal)->'lines'->0->'payload'->>'actual_hours' FROM payroll_fixture)<>'7.5' THEN RAISE EXCEPTION 'Baseline stale-payload reproduction changed'; END IF; END $$; ROLLBACK;")
            print('PASS: baseline reproduces stale 7.5-hour export after source correction to 8.5 hours')
        sql(migration.read_text())
    sql((root / 'supabase/tests/review_payroll_freshness.sql').read_text())
    setup = (root / 'supabase/tests/review_payroll_freshness.sql').read_text().split('SET LOCAL ROLE authenticated;')[0]
    sql(setup.replace('CREATE TEMP TABLE', 'CREATE TABLE') + '\nCOMMIT;')
    actor = "SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM payroll_fixture f JOIN user_profiles p ON p.id=f.actor;"
    def call(query,name):
        return command('psql', ['-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], "SET application_name='"+name+"'; BEGIN;"+actor+"SET LOCAL ROLE authenticated; "+query+" COMMIT;")
    refresh="SELECT public.refresh_payroll_time_records(journal,actor) FROM payroll_fixture;"
    snapshot="SELECT public.payroll_export_snapshot(journal) FROM payroll_fixture;"
    def wait_for(name,event):
        for _ in range(100):
            if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='"+name+"' AND wait_event='"+event+"';").strip()=='1': return
            time.sleep(.03)
        raise AssertionError('Overlap not observed: '+name+' '+event)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        sql("CREATE FUNCTION payroll_overlap() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$; CREATE TRIGGER payroll_overlap BEFORE INSERT ON payroll_export_lines FOR EACH ROW EXECUTE FUNCTION payroll_overlap();")
        a=pool.submit(call,refresh,'payroll_first'); wait_for('payroll_first','PgSleep')
        b=pool.submit(call,refresh,'payroll_second'); wait_for('payroll_second','advisory')
        assert a.result().returncode==0 and b.result().returncode==0
        assert sql("SELECT count(*) FROM payroll_export_lines WHERE batch_id=(SELECT journal FROM payroll_fixture);").strip()=='1'
        sql('DROP TRIGGER payroll_overlap ON payroll_export_lines; DROP FUNCTION payroll_overlap();')
        print('PASS: observed concurrent imports retain one line and global source key')
        correction=pool.submit(sql,"SET application_name='payroll_correction'; BEGIN; UPDATE time_records SET clock_out='2090-01-02 21:00Z' WHERE id=(SELECT punch FROM payroll_fixture); SELECT pg_sleep(1.5); COMMIT;")
        wait_for('payroll_correction','PgSleep')
        pending=pool.submit(call,snapshot,'payroll_snapshot'); wait_for('payroll_snapshot','transactionid')
        correction.result(); result=pending.result()
        assert result.returncode!=0 and 'Payroll punches changed' in result.stderr,result.stderr
        print('PASS: snapshot waits for concurrent correction and rejects revoked approval')
        approval=pool.submit(sql,"SET application_name='payroll_approval'; BEGIN; UPDATE time_records SET approved=true,approved_at=clock_timestamp() WHERE id=(SELECT punch FROM payroll_fixture); SELECT pg_sleep(1.5); COMMIT;")
        wait_for('payroll_approval','PgSleep')
        pending=pool.submit(call,snapshot,'payroll_reapproval_snapshot'); wait_for('payroll_reapproval_snapshot','transactionid')
        pending_refresh=pool.submit(call,refresh,'payroll_refresh'); wait_for('payroll_refresh','advisory')
        approval.result(); result=pending.result(); assert result.returncode!=0 and 'Payroll punches changed' in result.stderr,result.stderr
        result=pending_refresh.result(); assert result.returncode==0,result.stderr
        assert call(snapshot,'payroll_fresh').returncode==0
        print('PASS: concurrent reapproval does not bless stale snapshot; queued refresh restores corrected hours')
        blocker=pool.submit(sql,"SET application_name='payroll_auth_block'; BEGIN; SELECT id FROM time_records WHERE id=(SELECT punch FROM payroll_fixture) FOR UPDATE; SELECT pg_sleep(1.5); COMMIT;")
        wait_for('payroll_auth_block','PgSleep')
        pending=pool.submit(call,snapshot,'payroll_auth_snapshot'); wait_for('payroll_auth_snapshot','transactionid')
        sql("UPDATE user_profiles SET is_active=false WHERE id=(SELECT actor FROM payroll_fixture);")
        blocker.result(); result=pending.result(); assert result.returncode!=0 and 'not authorized' in result.stderr,result.stderr
        print('PASS: authority revoked during source lock wait prevents privileged snapshot return')
finally:
    result = command('dropdb', [db])
    assert result.returncode == 0, result.stderr
