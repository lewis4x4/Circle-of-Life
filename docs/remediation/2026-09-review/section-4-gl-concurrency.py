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
db = 'haven_gl_concurrency_' + str(os.getpid())

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
        sql(migration.read_text())
    sql((root / 'supabase/tests/review_section4_source_gl.sql').read_text())
    setup = (root / 'supabase/tests/review_section4_source_gl.sql').read_text().split('SET LOCAL ROLE authenticated;')[0]
    sql(setup.replace('CREATE TEMP TABLE', 'CREATE TABLE') + '\nCOMMIT;')
    actor = "SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM gl_fixture f JOIN user_profiles p ON p.id=f.actor;"
    def post(source, name):
        return command('psql', ['-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], "SET application_name='"+name+"'; BEGIN;" + actor + "SET LOCAL ROLE authenticated; SELECT post_source_to_gl('invoice','"+source+"'); COMMIT;")
    def fresh():
        return sql("INSERT INTO invoices(resident_id,facility_id,organization_id,entity_id,invoice_number,invoice_date,due_date,period_start,period_end,subtotal,total,balance_due) SELECT resident,facility,org,entity,gen_random_uuid()::text,'2090-01-15','2090-01-30',(date '2090-01-01'+(SELECT count(*)::int FROM invoices)),(date '2090-01-31'+(SELECT count(*)::int FROM invoices)),1000,1000,1000 FROM gl_fixture RETURNING id;").splitlines()[0]
    def wait_for(name, event):
        for _ in range(100):
            if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='"+name+"' AND wait_event='"+event+"';").strip()=='1': return
            time.sleep(0.03)
        raise AssertionError('Expected overlap not observed: '+name+' '+event)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        # Holding first insert makes competing callers overlap at the source row.
        sql("CREATE FUNCTION gl_overlap() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$; CREATE TRIGGER gl_overlap BEFORE INSERT ON journal_entries FOR EACH ROW EXECUTE FUNCTION gl_overlap();")
        source=fresh()
        a=pool.submit(post, source, 'gl_first'); wait_for('gl_first','PgSleep')
        b=pool.submit(post, source, 'gl_second'); wait_for('gl_second','transactionid')
        runs=[a.result(),b.result()]
        assert all(r.returncode==0 for r in runs), [r.stderr for r in runs]
        receipts=[json.loads(next(line for line in r.stdout.splitlines() if 'journal_entry_id' in line)) for r in runs]
        assert receipts[0]['journal_entry_id']==receipts[1]['journal_entry_id'] and receipts[0]['already_posted'] is False and receipts[1]['already_posted'] is True
        assert sql("SELECT count(*) FROM journal_entries WHERE source_id='"+source+"';").strip()=='1'
        sql('DROP TRIGGER gl_overlap ON journal_entries; DROP FUNCTION gl_overlap();')
        print('PASS: observed overlapping source calls produce one journal and truthful first/retry receipts')
        cases=[
            ('source', "UPDATE invoices SET total=1200 WHERE id='{source}';", True, ''),
            ('account', "UPDATE gl_accounts SET is_active=false WHERE id=(SELECT debit FROM gl_fixture);", False, "UPDATE gl_accounts SET is_active=true WHERE id=(SELECT debit FROM gl_fixture);"),
            ('absent_period', "INSERT INTO gl_period_closes(organization_id,entity_id,period_year,period_month,status) SELECT org,entity,2090,1,'closed' FROM gl_fixture;", False, "UPDATE gl_period_closes SET status='open' WHERE period_year=2090 AND entity_id=(SELECT entity FROM gl_fixture);"),
            ('existing_period', "UPDATE gl_period_closes SET status='closed' WHERE period_year=2090 AND entity_id=(SELECT entity FROM gl_fixture);", False, "UPDATE gl_period_closes SET status='open' WHERE period_year=2090 AND entity_id=(SELECT entity FROM gl_fixture);")]
        for name,mutation,success,restore in cases:
            source=fresh(); blocker_name='gl_block_'+name
            blocker=pool.submit(sql,"SET application_name='"+blocker_name+"'; BEGIN;"+mutation.format(source=source)+"SELECT pg_sleep(1); COMMIT;")
            wait_for(blocker_name,'PgSleep')
            result=post(source,'gl_post_'+name); blocker.result()
            assert (result.returncode==0)==success,(name,result.stderr)
            if success:
                assert sql("SELECT sum(debit_cents) FROM journal_entry_lines WHERE journal_entry_id IN(SELECT id FROM journal_entries WHERE source_id='"+source+"');").strip()=='1200'
            else:
                assert sql("SELECT count(*) FROM journal_entries WHERE source_id='"+source+"';").strip()=='0'
            if restore: sql(restore)
            print('PASS: concurrent '+name+' write serialized with posting, outcome and rollback verified')
        source=fresh()
        blocker=pool.submit(sql,"SET application_name='gl_auth_block'; BEGIN; SELECT id FROM gl_accounts WHERE id=(SELECT debit FROM gl_fixture) FOR UPDATE; SELECT pg_sleep(1.5); COMMIT;")
        wait_for('gl_auth_block','PgSleep')
        pending=pool.submit(post,source,'gl_auth_post'); wait_for('gl_auth_post','transactionid')
        sql("UPDATE user_profiles SET is_active=false WHERE id=(SELECT actor FROM gl_fixture);")
        result=pending.result(); blocker.result()
        assert result.returncode!=0 and sql("SELECT count(*) FROM journal_entries WHERE source_id='"+source+"';").strip()=='0',result.stderr
        print('PASS: actor revoked during observed account-lock wait cannot mutate or receive posting success')
        # Exercise the EXECUTE-granted helper directly, without the outer RPC's
        # final authority check. Re-enable the fixture and obtain current claims.
        sql("UPDATE user_profiles SET is_active=true WHERE id=(SELECT actor FROM gl_fixture);")
        journal=receipts[0]['journal_entry_id']
        blocker=pool.submit(sql,"SET application_name='gl_helper_block'; BEGIN; SELECT id FROM gl_accounts WHERE id=(SELECT debit FROM gl_fixture) FOR UPDATE; SELECT pg_sleep(1.5); COMMIT;")
        wait_for('gl_helper_block','PgSleep')
        direct="SET application_name='gl_direct_helper'; BEGIN;"+actor+"SET LOCAL ROLE authenticated; SELECT haven.source_gl_line_state('"+journal+"',1000,NULL,NULL); COMMIT;"
        pending=pool.submit(command,'psql',['-d',db,'-v','ON_ERROR_STOP=1','-At'],direct)
        wait_for('gl_direct_helper','transactionid')
        sql("UPDATE user_profiles SET is_active=false WHERE id=(SELECT actor FROM gl_fixture);")
        result=pending.result(); blocker.result()
        assert result.returncode!=0 and 'Source journal is no longer authorized' in result.stderr and 'history_count' not in result.stdout,result.stderr
        print('PASS: direct history helper denied after actor revocation during observed account-lock wait; no history facts returned')
finally:
    dropped = command('dropdb', [db])
    assert dropped.returncode == 0, dropped.stderr
