#!/usr/bin/env python3
"""Exercise COL-132 against disposable, already replayed pre-336 PostgreSQL.

Requires a local scratch server and baseline database through migration335. Creates
four explicitly named databases, retains them for inspection, and never targets a
hosted URL. Output JSON is suitable for a run's evidence log. No extra dependencies.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('--host', required=True, help='Absolute local PostgreSQL socket directory')
parser.add_argument('--port', required=True)
parser.add_argument('--user', default='postgres')
parser.add_argument('--baseline', required=True)
parser.add_argument('--prefix', required=True)
args = parser.parse_args()
if not pathlib.Path(args.host).is_absolute() or not pathlib.Path(args.host).is_dir():
    parser.error('--host must be an existing absolute local socket directory')
scratch = pathlib.Path(args.host).resolve()
scratch_root = (pathlib.Path.home() / '.hermes/tmp/agent-runs').resolve()
if scratch_root not in scratch.parents:
    parser.error('--host must be beneath the run-owned scratch root')
try:
    ownership = json.loads((scratch / 'manifest.json').read_text())
except (OSError, ValueError):
    parser.error('--host requires a recorded ownership manifest')
if ownership.get('created_by') != 'codex' or ownership.get('run_id') != scratch.name:
    parser.error('Scratch ownership manifest does not match this run')
if not args.prefix.replace('_', '').isalnum():
    parser.error('--prefix must contain only letters, numbers and underscores')
base = ['-h', args.host, '-p', args.port, '-U', args.user]
repo = pathlib.Path(__file__).resolve().parents[2]
migration = repo / 'supabase/migrations/336_hfo_activity_catalog.sql'

def run(db, sql, ok=True):
    result = subprocess.run(['psql', *base, '-d', db, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True)
    if ok and result.returncode:
        raise RuntimeError(result.stderr)
    return result

def query(db, sql):
    return run(db, sql).stdout.strip()

root = '92000000-0000-0000-0000-000000000001'
revision = '92000000-0000-0000-0000-000000000002'
instance = '92000000-0000-0000-0000-000000000003'
audit = '92000000-0000-0000-0000-000000000004'
owner = '92000000-0000-0000-0000-000000000005'
session = '92000000-0000-0000-0000-000000000006'
wait_revision = '92000000-0000-0000-0000-000000000007'
wait_instance = '92000000-0000-0000-0000-000000000008'
fixture = f"""
INSERT INTO public.operation_task_templates(id,organization_id,facility_id,name,description,category,cadence_type)
 SELECT '{root}',organization_id,id,'Root before migration','Fixture','safety','on_demand' FROM public.facilities WHERE deleted_at IS NULL ORDER BY id LIMIT 1;
INSERT INTO public.operation_task_templates(id,organization_id,facility_id,name,description,category,cadence_type,previous_version_id,version)
 SELECT '{revision}',organization_id,facility_id,'Changed wording before migration','Fixture','safety','on_demand',id,2 FROM public.operation_task_templates WHERE id='{root}';
INSERT INTO public.operation_task_instances(id,organization_id,facility_id,template_id,template_name,template_category,template_cadence_type,assigned_shift_date,status,completed_at,completion_notes,completion_evidence_paths)
 SELECT '{instance}',organization_id,facility_id,id,'Historical wording','safety','on_demand','2026-01-02','completed','2026-01-02T12:00:00Z','Retained historical evidence',ARRAY['fixture/private/evidence.pdf'] FROM public.operation_task_templates WHERE id='{revision}';
INSERT INTO public.operation_audit_log(id,organization_id,facility_id,task_instance_id,event_type,from_status,to_status,event_notes)
 SELECT '{audit}',organization_id,facility_id,id,'completed','pending','completed','Historical completion receipt' FROM public.operation_task_instances WHERE id='{instance}';
"""
results = []
for case in ['happy', 'cycle', 'cross_org', 'cross_site']:
    db = f'{args.prefix}_{case}'
    subprocess.run(['createdb', *base, '--template', args.baseline, db], check=True, capture_output=True, text=True)
    run(db, fixture)
    before = query(db, f"SELECT to_jsonb(i)::text FROM public.operation_task_instances i WHERE id='{instance}';")
    receipt = query(db, f"SELECT to_jsonb(a)::text FROM public.operation_audit_log a WHERE id='{audit}';")
    if case == 'cycle':
        run(db, f"UPDATE public.operation_task_templates SET previous_version_id='{revision}' WHERE id='{root}';")
    elif case == 'cross_org':
        run(db, f"INSERT INTO public.organizations(id,name) VALUES('92000000-0000-0000-0000-000000000099','Other org'); UPDATE public.operation_task_templates SET organization_id='92000000-0000-0000-0000-000000000099',facility_id=NULL WHERE id='{revision}';")
    elif case == 'cross_site':
        run(db, f"INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT '92000000-0000-0000-0000-000000000099',organization_id,entity_id,'Other site','Test','Test','00000',1 FROM public.facilities WHERE id=(SELECT facility_id FROM public.operation_task_templates WHERE id='{root}'); UPDATE public.operation_task_templates SET facility_id='92000000-0000-0000-0000-000000000099' WHERE id='{revision}';")
    result = run(db, migration.read_text(), ok=False)
    if case != 'happy':
        expected = 'Cyclic operation template lineage' if case == 'cycle' else 'Invalid operation template lineage scope'
        assert result.returncode and expected in result.stderr, result.stderr
        assert query(db, "SELECT to_regclass('public.operation_activities') IS NULL;") == 't', 'Migration did not roll back atomically'
        assert query(db, f"SELECT to_jsonb(i)::text FROM public.operation_task_instances i WHERE id='{instance}';") == before
        results.append({'database': db, 'case': case, 'result': 'rejected atomically; historical receipt unchanged'})
        continue
    assert not result.returncode, result.stderr
    assert query(db, f"SELECT (to_jsonb(i)-'activity_id')::text FROM public.operation_task_instances i WHERE id='{instance}';") == before, 'Existing completed instance changed beyond activity link'
    assert query(db, f"SELECT to_jsonb(a)::text FROM public.operation_audit_log a WHERE id='{audit}';") == receipt, 'Historical completion audit changed'
    assert query(db, f"SELECT count(DISTINCT activity_id) FROM public.operation_task_templates WHERE id IN ('{root}','{revision}');") == '1'
    assert query(db, f"SELECT activity_id='{root}'::uuid FROM public.operation_task_instances WHERE id='{instance}';") == 't'
    assert query(db, "SELECT count(*) FROM public.operation_activity_source_items;") == '91'
    results.append({'database': db, 'case': case, 'result': 'one root activity; completed instance and audit byte-equivalent except activity link; 91 sources'})

# Real concurrent transactions: a held template row lock must not create a new
# instance wait, and a revision waiting on lineage must recheck a revoked session.
db = f'{args.prefix}_happy'
run(db, f"""
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT '{owner}','hfo-lock@review.invalid',jsonb_build_object('organization_id',organization_id,'app_role','owner'),'{{"full_name":"HFO lock owner"}}' FROM public.operation_task_templates WHERE id='{root}';
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT '{owner}','hfo-lock@review.invalid','HFO lock owner','owner',organization_id,true FROM public.operation_task_templates WHERE id='{root}' ON CONFLICT(id) DO UPDATE SET app_role='owner',organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) VALUES('{session}','{owner}');
GRANT USAGE ON SCHEMA auth,haven TO authenticated;
GRANT SELECT,INSERT ON public.operation_task_templates,public.operation_task_instances TO authenticated;
""")
claims = query(db, f"SELECT jsonb_build_object('sub',id,'session_id','{session}','role','authenticated','auth_claim_version',auth_claim_version)::text FROM public.user_profiles WHERE id='{owner}';")

def actor_sql(command, appname):
    return f"SET application_name='{appname}'; SET request.jwt.claims='{claims}'; SET ROLE authenticated; {command}"

def lock_template(mode):
    proc = subprocess.Popen(['psql', *base, '-d', db, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    proc.stdin.write(f"BEGIN; SELECT id FROM public.operation_task_templates WHERE id='{root}' FOR {mode};\n\\echo HFO_LOCKED\n")
    proc.stdin.flush()
    while proc.stdout.readline().strip() != 'HFO_LOCKED':
        if proc.poll() is not None:
            raise RuntimeError(proc.stderr.read())
    return proc

def release(proc):
    proc.stdin.write('ROLLBACK;\n\\q\n')
    proc.stdin.flush()
    proc.wait(timeout=10)

locker = lock_template('NO KEY UPDATE')
try:
    sql = actor_sql(f"INSERT INTO public.operation_task_instances(id,organization_id,facility_id,template_id,template_name,template_category,template_cadence_type,assigned_shift_date) SELECT '{wait_instance}',organization_id,facility_id,id,'Nonblocking fixture','safety','on_demand',CURRENT_DATE FROM public.operation_task_templates WHERE id='{root}';", 'hfo_instance_no_wait')
    result = subprocess.run(['psql', *base, '-d', db, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True, timeout=5)
    assert not result.returncode, result.stderr
finally:
    release(locker)
results.append({'case': 'instance_no_added_wait', 'result': 'INSERT finished under 5 seconds while template NO KEY UPDATE lock remained held'})

locker = lock_template('UPDATE')
try:
    sql = actor_sql(f"INSERT INTO public.operation_task_templates(id,organization_id,facility_id,name,description,category,cadence_type,previous_version_id,version) SELECT '{wait_revision}',organization_id,facility_id,'Waiting revision','Fixture','safety','on_demand',id,3 FROM public.operation_task_templates WHERE id='{root}';", 'hfo_revision_revocation')
    waiter = subprocess.Popen(['psql', *base, '-d', db, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    waiter.stdin.write(sql)
    waiter.stdin.close()
    deadline = time.monotonic() + 10
    while query(db, "SELECT count(*) FROM pg_stat_activity WHERE application_name='hfo_revision_revocation' AND wait_event_type='Lock';") != '1':
        assert time.monotonic() < deadline, 'Revision did not reach expected lineage lock wait'
        time.sleep(0.05)
    run(db, f"DELETE FROM auth.sessions WHERE id='{session}';")
finally:
    release(locker)
waiter.wait(timeout=10)
error = waiter.stderr.read()
assert waiter.returncode and 'Operation catalog actor is no longer authorized' in error, error
assert query(db, f"SELECT count(*) FROM public.operation_task_templates WHERE id='{wait_revision}';") == '0'
results.append({'case': 'revision_session_revoked_while_waiting', 'result': 'Rejected after real lineage lock wait; no revision/catalog mutation committed'})
print(json.dumps({'status': 'PASS', 'migration_sha256': hashlib.sha256(migration.read_bytes()).hexdigest(), 'checks': results}, indent=2))
