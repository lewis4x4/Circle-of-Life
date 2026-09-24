#!/usr/bin/env python3
"""Prove direct assignment edits cannot deadlock parent-first schedule RPCs.

Run only against a run-owned native PostgreSQL cluster with migration 497 applied.
Requires PG_VERIFY_NATIVE_SOCKET, PG_VERIFY_NATIVE_BIN, and
WORKFORCE_CONCURRENCY_BASELINE_DB. The baseline is cloned; the exact clone is
always dropped. No hosted connection or application database is accepted.
"""
import json
import os
from pathlib import Path
import subprocess
import uuid


root = Path(__file__).resolve().parents[2]
socket = Path(os.environ['PG_VERIFY_NATIVE_SOCKET']).resolve()
allowed = (Path.home() / '.hermes/tmp/agent-runs').resolve()
if not socket.is_relative_to(allowed) or socket == allowed:
    raise RuntimeError('A run-owned scratch cluster is required')
manifest = json.loads((socket / 'manifest.json').read_text())
if manifest.get('created_by') != 'codex' or manifest.get('run_id') != socket.name:
    raise RuntimeError('Scratch cluster ownership manifest does not match')
bin_dir = Path(os.environ['PG_VERIFY_NATIVE_BIN'])
if not bin_dir.is_absolute():
    raise RuntimeError('PG_VERIFY_NATIVE_BIN must be absolute')
baseline = os.environ['WORKFORCE_CONCURRENCY_BASELINE_DB']
database = 'workforce_schedule_race_' + uuid.uuid4().hex
connection = ['-h', str(socket), '-p', os.environ.get('PG_VERIFY_NATIVE_PORT', '55488'), '-U', 'postgres']
psql = [str(bin_dir / 'psql'), *connection, '-d', database, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']


def run(sql):
    return subprocess.run(psql, input=sql, text=True, capture_output=True, timeout=15)


def expect_success(result):
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout


actor = """
BEGIN;
SET LOCAL statement_timeout='8s';
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session_id,
 'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,
 'role','authenticated','app_role','manager','organization_id',p.organization_id)::text,true)
 FROM public.workforce_race_actors a JOIN public.user_profiles p ON p.id=a.id WHERE a.role='manager';
SET LOCAL ROLE authenticated;
"""
writer = None
try:
    subprocess.run([str(bin_dir / 'createdb'), *connection, '-T', baseline, database], check=True, capture_output=True, text=True)
    # Reuse the SQL probe's authenticated fixture, without its assertions.
    probe = (root / 'supabase/tests/review_workforce_schedule.sql').read_text()
    fixture = probe.split("SELECT pg_temp.schedule_actor('manager');", 1)[0]
    fixture += """
CREATE TABLE public.workforce_race_fixture AS TABLE schedule_fixture;
CREATE TABLE public.workforce_race_actors AS TABLE schedule_actors;
GRANT SELECT ON public.workforce_race_fixture,public.workforce_race_actors TO authenticated;
SELECT pg_temp.schedule_actor('manager');
SET LOCAL ROLE authenticated;
SELECT public.schedule_bulk_upsert(week,(SELECT updated_at FROM public.schedules WHERE id=f.week),
 jsonb_build_array(jsonb_build_object('staff_id',staff,'shift_date','2091-01-01','shift_definition_id',definition))) FROM schedule_fixture f;
RESET ROLE;
COMMIT;
"""
    expect_success(run(fixture))
    # This RPC owns the parent first; a direct UPDATE owns the assignment before
    # its row trigger. The latter must fail for retry, never wait on the parent.
    bulk = actor + """
SELECT id FROM public.schedules WHERE id=(SELECT week FROM public.workforce_race_fixture) FOR UPDATE;
SELECT 'parent_locked';
SELECT pg_sleep(1);
SELECT public.schedule_bulk_upsert(week,(SELECT updated_at FROM public.schedules WHERE id=f.week),
 jsonb_build_array(jsonb_build_object('staff_id',staff,'shift_date','2091-01-01','shift_definition_id',overlap_definition))) FROM public.workforce_race_fixture f;
COMMIT;
"""
    writer = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    writer.stdin.write(bulk)
    writer.stdin.close()
    writer.stdin = None
    while True:
        line = writer.stdout.readline()
        if line.strip() == 'parent_locked':
            break
        if not line:
            raise AssertionError('RPC did not acquire its parent: ' + writer.stderr.read())
    direct = actor + """
UPDATE public.shift_assignments SET notes='retried direct edit'
 WHERE schedule_id=(SELECT week FROM public.workforce_race_fixture) AND deleted_at IS NULL;
COMMIT;
"""
    collision = run(direct)
    if collision.returncode == 0 or '55P03' not in collision.stderr or 'Schedule is being edited. Reload and retry.' not in collision.stderr:
        raise AssertionError('Expected an immediate retry conflict: ' + collision.stderr)
    out, err = writer.communicate(timeout=15)
    if writer.returncode:
        raise AssertionError('Parent-first RPC failed: ' + err)
    writer = None
    expect_success(run("""
DO $$ BEGIN
 IF (SELECT count(*) FROM public.shift_assignments a JOIN public.workforce_race_fixture f ON a.schedule_id=f.week
     WHERE a.deleted_at IS NULL AND a.shift_definition_id=f.overlap_definition AND a.notes IS NULL)<>1 THEN
   RAISE EXCEPTION 'Collision changed the assignment or RPC did not commit';
 END IF;
END $$;
"""))
    expect_success(run(direct))
    expect_success(run("""
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.shift_assignments a JOIN public.workforce_race_fixture f ON a.schedule_id=f.week
     WHERE a.deleted_at IS NULL AND a.shift_definition_id=f.overlap_definition AND a.notes='retried direct edit') THEN
   RAISE EXCEPTION 'Direct edit did not succeed after reload/retry';
 END IF;
END $$;
"""))
    print('PASS: direct edit returns 55P03 without deadlock or partial write; concurrent bulk RPC commits; direct retry succeeds')
finally:
    if writer is not None:
        writer.terminate()
        writer.communicate(timeout=15)
    subprocess.run([str(bin_dir / 'dropdb'), *connection, '--if-exists', database], check=True, capture_output=True, text=True)
