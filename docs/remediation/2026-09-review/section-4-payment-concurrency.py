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
db = 'haven_payment_concurrency_' + str(os.getpid())

def command(tool, args, sql=None):
    return subprocess.run([str(bin_path / tool), *connection, *args], input=sql, text=True, capture_output=True, timeout=180)

def sql(text):
    result = command('psql', ['-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], text)
    if result.returncode:
        raise RuntimeError(result.stderr[-4000:])
    return result.stdout

assert command('createdb', [db]).returncode == 0
try:
    sql((root / 'scripts/pg-verify-stub.sql').read_text())
    for migration in sorted((root / 'supabase/migrations').glob('*.sql')):
        sql(migration.read_text())
    setup = (root / 'supabase/tests/review_section4_payment.sql').read_text().split('SET LOCAL ROLE authenticated;')[0]
    setup = setup.replace('CREATE TEMP TABLE', 'CREATE TABLE') + '\nCOMMIT;'
    sql(setup)
    # Force overlapping invoice updates; the second transaction must read the
    # committed live balance after the first releases its row lock.
    sql("CREATE FUNCTION payment_overlap() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$; CREATE TRIGGER payment_overlap BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION payment_overlap();")
    actor = "SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM payment_fixture f JOIN user_profiles p ON p.id=f.actor;"
    def pay(amount):
        return command('psql', ['-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], 'BEGIN;' + actor + "SET LOCAL ROLE authenticated; SELECT record_payment(gen_random_uuid(),resident,invoice,current_date," + str(amount) + ",'cash',p_expected_caller=>actor) FROM payment_invoice_fixture; COMMIT;")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        runs = list(pool.map(pay, [6000,6000]))
    assert sorted(r.returncode for r in runs) == [0,3], [(r.returncode,r.stderr) for r in runs]
    state = sql('SELECT amount_paid,balance_due,(SELECT count(*) FROM payments WHERE invoice_id=i.id),(SELECT count(*) FROM payment_recording_receipts) FROM invoices i JOIN payment_invoice_fixture f ON f.invoice=i.id;').strip()
    assert state == '6000|4000|1|1', state
    print('PASS: concurrent same-invoice payments: one commit, one live-balance rejection; paid=6000, balance=4000, payments=1, receipts=1')
finally:
    dropped = command('dropdb', [db])
    assert dropped.returncode == 0, dropped.stderr
