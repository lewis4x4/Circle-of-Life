"""Local disposable PostgreSQL proof; requires the explicitly run-owned server."""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess

root = Path.cwd()
socket = Path(os.environ['PG_VERIFY_NATIVE_SOCKET']).resolve()
assert socket.is_relative_to(Path.home() / '.hermes/tmp/agent-runs')
manifest = json.loads((socket / 'manifest.json').read_text())
assert manifest['created_by'] == 'codex' and manifest['run_id'] == socket.name
bin_path = Path(os.environ['PG_VERIFY_NATIVE_BIN'])
connection = ['-h', str(socket), '-p', os.environ['PG_VERIFY_NATIVE_PORT'], '-U', 'postgres']
db = 'haven_po_concurrency_' + str(os.getpid())

def command(tool, args, sql=None):
    return subprocess.run([str(bin_path / tool), *connection, *args], input=sql, text=True, capture_output=True, timeout=180)

def sql(text):
    result = command('psql', ['-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], text)
    if result.returncode:
        raise RuntimeError(result.stderr[-4000:])
    if result.stderr and "PASS:" in result.stderr:
        print(result.stderr.strip())
    return result.stdout

assert command('createdb', [db]).returncode == 0
try:
    sql((root / 'scripts/pg-verify-stub.sql').read_text())
    for migration in sorted((root / 'supabase/migrations').glob('*.sql')):
        sql(migration.read_text())
    sql((root / 'supabase/tests/review_section4_purchase_order.sql').read_text())
    setup = (root / 'supabase/tests/review_section4_purchase_order.sql').read_text().split('SET LOCAL ROLE authenticated;')[0]
    setup = setup.replace('CREATE TEMP TABLE', 'CREATE TABLE') + '\nCOMMIT;'
    sql(setup)
    sql("CREATE FUNCTION po_overlap() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$; CREATE TRIGGER po_overlap BEFORE INSERT ON purchase_orders FOR EACH ROW EXECUTE FUNCTION po_overlap();")
    actor = "SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.actor,'session_id',f.actor_session,'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,'role','authenticated')::text,true) FROM po_fixture f JOIN user_profiles p ON p.id=f.actor;"
    def create(_):
        return command('psql', ['-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], 'BEGIN;' + actor + "SET LOCAL ROLE authenticated; SELECT create_purchase_order(request,actor,facility,vendor,current_date,lines) FROM po_fixture; COMMIT;")
    before = sql('SELECT coalesce(sum(last_number),0) FROM vendor_po_sequences;').strip()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        runs = list(pool.map(create, [0,1]))
    assert [r.returncode for r in runs] == [0,0], [(r.returncode,r.stderr) for r in runs]
    receipts = [[line for line in r.stdout.splitlines() if 'purchase_order_id' in line][0] for r in runs]
    assert receipts[0] == receipts[1], receipts
    state = sql('SELECT (SELECT count(*) FROM purchase_orders WHERE vendor_id=f.vendor),(SELECT count(*) FROM po_line_items l JOIN purchase_orders p ON p.id=l.purchase_order_id WHERE p.vendor_id=f.vendor),(SELECT count(*) FROM purchase_order_creation_receipts WHERE caller_id=f.actor) FROM po_fixture f;').strip()
    assert state == '1|2|1', state
    assert int(sql('SELECT sum(last_number) FROM vendor_po_sequences;').strip()) == int(before)+1
    print('PASS: actual SQL rollback/authorization/draft-edit regression and concurrent identical caller requests: matching receipt, one header, two lines, one receipt, one allocator increment')
finally:
    dropped = command('dropdb', [db])
    assert dropped.returncode == 0, dropped.stderr
