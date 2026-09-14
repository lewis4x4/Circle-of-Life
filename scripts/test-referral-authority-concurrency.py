#!/usr/bin/env python3
"""Prove referral writes and facility-access revocation cannot deadlock.

This regression runs only against an explicitly run-owned local PostgreSQL
cluster. It creates and drops one process-named database, replays every
migration, and uses synthetic identities only.
"""

import json
import os
from pathlib import Path
import subprocess
import time
import uuid


ROOT = Path(__file__).resolve().parents[1]
SOCKET = Path(os.environ["PG_VERIFY_NATIVE_SOCKET"]).resolve()
RUNS_ROOT = (Path.home() / ".hermes/tmp/agent-runs").resolve()
assert SOCKET.is_relative_to(RUNS_ROOT), "Run-owned local cluster required"
manifest = json.loads((SOCKET / "cleanup-manifest.json").read_text())
assert manifest["created_by"] == "codex" and manifest["run_id"] == SOCKET.name
BIN = Path(os.environ["PG_VERIFY_NATIVE_BIN"]).resolve()
assert BIN.is_absolute()
PORT = os.environ.get("PG_VERIFY_NATIVE_PORT", "55439")
DATABASE_USER = os.environ.get("PG_VERIFY_NATIVE_USER", "postgres")
CONNECTION = ["-h", str(SOCKET), "-p", PORT, "-U", DATABASE_USER]
DATABASE = f"referral_concurrency_{os.getpid()}_{int(time.time())}"


def command(tool, args, sql=None, timeout=120):
    return subprocess.run(
        [str(BIN / tool), *CONNECTION, *args],
        input=sql,
        text=True,
        capture_output=True,
        timeout=timeout,
    )


def query(sql, *, must_pass=True):
    result = command(
        "psql", ["-X", "-qAt", "-d", DATABASE, "-v", "ON_ERROR_STOP=1"], sql
    )
    if must_pass and result.returncode:
        raise RuntimeError(result.stderr[-4000:])
    return result


def open_session():
    process = subprocess.Popen(
        [
            str(BIN / "psql"),
            *CONNECTION,
            "-X",
            "-qAt",
            "-d",
            DATABASE,
            "-v",
            "ON_ERROR_STOP=1",
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    process.stdin.write("SELECT pg_backend_pid();\n")
    process.stdin.flush()
    return process, int(process.stdout.readline().strip())


def send(process, sql):
    process.stdin.write(sql + "\n")
    process.stdin.flush()


def read_until(process, marker, timeout=10):
    deadline = time.monotonic() + timeout
    lines = []
    while time.monotonic() < deadline:
        line = process.stdout.readline()
        if not line:
            break
        lines.append(line.rstrip())
        if line.strip() == marker:
            return lines
    raise RuntimeError(f"Session did not reach {marker}: {lines}")


def finish(process, timeout=15):
    process.stdin.close()
    process.wait(timeout=timeout)
    output = process.stdout.read()
    error = process.stderr.read()
    if process.returncode:
        raise RuntimeError(error[-4000:])
    if "40P01" in error or "deadlock detected" in error.lower():
        raise RuntimeError(error[-4000:])
    return output, error


def wait_until_blocked(waiter_pid, blocker_pid, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        observed = query(
            f"SELECT {blocker_pid} = ANY(pg_blocking_pids({waiter_pid}));"
        ).stdout.strip()
        if observed == "t":
            return
        time.sleep(0.05)
    raise RuntimeError(
        f"Backend {waiter_pid} did not block behind expected backend {blocker_pid}"
    )


created = False
sessions = []
try:
    result = command("createdb", [DATABASE])
    if result.returncode:
        raise RuntimeError(result.stderr)
    created = True

    files = [
        ROOT / "scripts/pg-verify-stub.sql",
        *sorted((ROOT / "supabase/migrations").glob("*.sql")),
    ]
    for path in files:
        query(path.read_text())
    query(
        """
        GRANT USAGE ON SCHEMA auth, haven TO authenticated;
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
        LANGUAGE sql STABLE AS $$
          SELECT nullif(auth.jwt()->>'sub','')::uuid
        $$;
        CREATE OR REPLACE FUNCTION auth.role() RETURNS text
        LANGUAGE sql STABLE AS $$
          SELECT nullif(auth.jwt()->>'role','')
        $$;
        """
    )

    organization_id = uuid.uuid4()
    entity_id = uuid.uuid4()
    facility_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    session_id = uuid.uuid4()
    fixture_sql = f"""
      INSERT INTO public.organizations (id, name)
      VALUES ('{organization_id}', 'COL-329 concurrency organization');
      INSERT INTO public.entities (id, organization_id, name)
      VALUES ('{entity_id}', '{organization_id}', 'COL-329 concurrency entity');
      INSERT INTO public.facilities (
        id, entity_id, organization_id, name, address_line_1, city, state, zip,
        total_licensed_beds
      ) VALUES (
        '{facility_id}', '{entity_id}', '{organization_id}',
        'COL-329 concurrency facility', '1 Test Way', 'Test', 'FL', '00000', 10
      );
      INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
      VALUES ('{actor_id}', '{actor_id}@col329.invalid', '{{}}', '{{}}');
      INSERT INTO public.user_profiles (
        id, organization_id, email, full_name, app_role, is_active
      ) VALUES (
        '{actor_id}', '{organization_id}', '{actor_id}@col329.invalid',
        'COL-329 concurrency actor', 'owner', true
      );
      INSERT INTO auth.sessions (id, user_id) VALUES ('{session_id}', '{actor_id}');
      INSERT INTO public.user_facility_access (
        user_id, facility_id, organization_id, is_primary
      ) VALUES ('{actor_id}', '{facility_id}', '{organization_id}', true);
    """
    query(fixture_sql)
    claim_version = int(
        query(
            f"SELECT auth_claim_version FROM public.user_profiles WHERE id='{actor_id}';"
        ).stdout.strip()
    )
    claims = json.dumps(
        {
            "sub": str(actor_id),
            "session_id": str(session_id),
            "role": "authenticated",
            "auth_claim_version": claim_version,
            "app_role": "owner",
            "organization_id": str(organization_id),
        }
    ).replace("'", "''")

    blocker, blocker_pid = open_session()
    command_session, command_pid = open_session()
    revoker, revoker_pid = open_session()
    sessions.extend([blocker, command_session, revoker])

    send(
        blocker,
        f"""
        BEGIN;
        SELECT id FROM auth.users WHERE id = '{actor_id}' FOR UPDATE;
        SELECT 'blocker-ready';
        """,
    )
    read_until(blocker, "blocker-ready")

    send(
        command_session,
        f"""
        BEGIN;
        SET LOCAL statement_timeout = '10s';
        SELECT set_config('request.jwt.claims', '{claims}', true);
        SET LOCAL ROLE authenticated;
        SELECT public.referral_episode_capture(
          'col329:concurrency:profile-before-revocation',
          public.referral_episode_initial_revision(),
          jsonb_build_object(
            'facility_id', '{facility_id}',
            'first_name', 'Concurrency',
            'last_name', 'Proof',
            'receipt_precision', 'unknown'
          )
        );
        COMMIT;
        SELECT 'command-complete';
        """,
    )
    wait_until_blocked(command_pid, blocker_pid)

    send(
        revoker,
        f"""
        BEGIN;
        SET LOCAL statement_timeout = '10s';
        UPDATE public.user_facility_access
        SET revoked_at = clock_timestamp()
        WHERE user_id = '{actor_id}' AND facility_id = '{facility_id}';
        COMMIT;
        SELECT 'revocation-complete';
        """,
    )
    wait_until_blocked(revoker_pid, command_pid)

    send(blocker, "COMMIT; SELECT 'blocker-complete';")
    read_until(blocker, "blocker-complete")
    finish(blocker)
    sessions.remove(blocker)

    command_output, _ = finish(command_session)
    sessions.remove(command_session)
    revoker_output, _ = finish(revoker)
    sessions.remove(revoker)
    if "command-complete" not in command_output:
        raise RuntimeError("Referral command did not commit before revocation")
    if "revocation-complete" not in revoker_output:
        raise RuntimeError("Facility-access revocation did not commit")

    final_state = query(
        f"""
        SELECT json_build_object(
          'referral_rows', (
            SELECT count(*) FROM public.referral_leads
            WHERE facility_id = '{facility_id}'
          ),
          'access_revoked', (
            SELECT revoked_at IS NOT NULL FROM public.user_facility_access
            WHERE user_id = '{actor_id}' AND facility_id = '{facility_id}'
          ),
          'claim_version_advanced', (
            SELECT auth_claim_version > {claim_version} FROM public.user_profiles
            WHERE id = '{actor_id}'
          )
        );
        """
    ).stdout.strip()
    observed = json.loads(final_state)
    expected = {
        "referral_rows": 1,
        "access_revoked": True,
        "claim_version_advanced": True,
    }
    if observed != expected:
        raise RuntimeError(f"Unexpected serialized result: {observed}")

    print(
        json.dumps(
            {
                "scope": "local synthetic native concurrency",
                "case": "command profile lock overlaps facility-access revocation",
                "observed_waits": [
                    "command waited on the auth-user blocker after locking profile",
                    "revocation waited on the command profile lock after locking access",
                ],
                "result": observed,
                "deadlock": False,
                "revocation_victim": False,
                "verdict": "PASS",
            },
            indent=2,
        )
    )
finally:
    for process in sessions:
        process.kill()
        process.wait()
    if created:
        result = command("dropdb", [DATABASE])
        if result.returncode:
            raise RuntimeError(
                f"Run-owned database retained: {DATABASE}: {result.stderr}"
            )
