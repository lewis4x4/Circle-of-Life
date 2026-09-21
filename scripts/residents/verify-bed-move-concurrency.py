#!/usr/bin/env python3
"""Real independent-session races against a manifest-owned native replay only.

Uses standard-library psql transport, synthetic rollback-probe fixtures, and an
explicit local baseline. Never accepts an application URL or hosted database.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
SOCKET = Path(os.environ["PG_VERIFY_NATIVE_SOCKET"]).resolve()
assert SOCKET.is_relative_to((Path.home() / ".hermes/tmp/agent-runs").resolve())
manifest = json.loads((SOCKET / "manifest.json").read_text())
assert manifest["created_by"] == "codex" and manifest["run_id"] == SOCKET.name
BIN = Path(os.environ["PG_VERIFY_NATIVE_BIN"])
assert BIN.is_absolute()
BASELINE = os.environ["BED_MOVE_BASELINE_DB"]
assert BASELINE.startswith("haven_bed_move"), "Explicit bed-move replay baseline required"
CONN = ["-h", str(SOCKET), "-p", os.environ.get("PG_VERIFY_NATIVE_PORT", "55439"), "-U", "postgres"]


def query(db, sql, require=True):
    result = subprocess.run([str(BIN / "psql"), *CONN, "-X", "-qAt", "-d", db,
                             "-v", "ON_ERROR_STOP=1"], input=sql, text=True,
                            capture_output=True, timeout=30)
    if require and result.returncode:
        raise AssertionError(result.stderr[-2500:])
    return result


def login():
    return "BEGIN; SELECT public.bm_login('nurse'); SET LOCAL ROLE authenticated; "


def move(resident, destination="target", expected="source"):
    return (f"SELECT public.change_resident_bed((SELECT {resident} FROM bm),"
            f"(SELECT id FROM bm_beds WHERE label='{destination}'),"
            f"(SELECT id FROM bm_beds WHERE label='{expected}')); ")


results = []
for case in ("two-residents", "direct-write-versus-rpc", "stale-source-double-submit"):
    database = "haven_bed_move_race_" + uuid.uuid4().hex[:12]
    created = subprocess.run([str(BIN / "createdb"), *CONN, "-T", BASELINE, database],
                             capture_output=True, text=True, timeout=30)
    assert created.returncode == 0, created.stderr
    first = None
    try:
        fixture = (ROOT / "supabase/tests/review_resident_bed_moves.sql").read_text()
        fixture = fixture.split("-- Fixture boundary used by the independent-session concurrency harness.")[0]
        fixture = fixture.replace("CREATE TEMP TABLE", "CREATE TABLE").replace("pg_temp.", "public.")
        # Unlike the rollback probe this fixture commits, so do not persist a
        # cluster-wide role alteration merely to test authenticated races.
        fixture = fixture.replace("ALTER ROLE service_role BYPASSRLS;", "")
        query(database, fixture + "\nUPDATE residents SET bed_id=(SELECT id FROM bm_beds WHERE label='empty') WHERE id=(SELECT unassigned FROM bm); COMMIT;")
        before_audits = int(query(database, "SELECT count(*) FROM audit_log WHERE table_name='residents' AND organization_id=(SELECT org FROM bm);").stdout)
        first = subprocess.Popen([str(BIN / "psql"), *CONN, "-X", "-qAt", "-d", database,
                                  "-v", "ON_ERROR_STOP=1"], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        first.stdin.write(login() + move("resident") + "SELECT 'first-held';\n")
        first.stdin.flush()
        while first.stdout.readline().strip() != "first-held":
            if first.poll() is not None:
                raise AssertionError(first.stderr.read())
        if case == "two-residents":
            mutation = move("unassigned", expected="empty")
        elif case == "direct-write-versus-rpc":
            mutation = "UPDATE residents SET bed_id=(SELECT id FROM bm_beds WHERE label='target') WHERE id=(SELECT unassigned FROM bm); "
        else:
            mutation = move("resident", destination="hold")
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(query, database,
                                  "SET application_name='bed-move-contender'; " + login() + mutation + "COMMIT;", False)
            deadline = time.monotonic() + 10
            while True:
                waiting = query(database, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='bed-move-contender' AND wait_event_type='Lock');").stdout.strip()
                if waiting == "t":
                    break
                assert time.monotonic() < deadline, "Expected overlapping lock wait was not observed"
                time.sleep(0.03)
            first.stdin.write("COMMIT;\n")
            first.stdin.close()
            first.wait(timeout=15)
            assert first.returncode == 0, first.stderr.read()
            second = pending.result(timeout=15)
        assert second.returncode != 0, "Both competing assignments committed"
        expected_error = "assignment changed" if case == "stale-source-double-submit" else "already occupied"
        assert expected_error in second.stderr, second.stderr
        state = json.loads(query(database, """SELECT json_build_object(
          'winner',(SELECT bed_id=(SELECT id FROM bm_beds WHERE label='target') FROM residents WHERE id=(SELECT resident FROM bm)),
          'loser_unchanged',(SELECT bed_id=(SELECT id FROM bm_beds WHERE label='empty') FROM residents WHERE id=(SELECT unassigned FROM bm)),
          'target_pointer',(SELECT status='occupied' AND current_resident_id=(SELECT resident FROM bm) FROM beds WHERE id=(SELECT id FROM bm_beds WHERE label='target')),
          'source_released',(SELECT status='available' AND current_resident_id IS NULL FROM beds WHERE id=(SELECT id FROM bm_beds WHERE label='source')),
          'loser_pointer',(SELECT status='occupied' AND current_resident_id=(SELECT unassigned FROM bm) FROM beds WHERE id=(SELECT id FROM bm_beds WHERE label='empty')),
          'resident_audits',(SELECT count(*) FROM audit_log WHERE table_name='residents' AND organization_id=(SELECT org FROM bm)));
        """).stdout)
        assert all(state[key] for key in ("winner", "loser_unchanged", "target_pointer", "source_released", "loser_pointer")), state
        assert state["resident_audits"] == before_audits + 1, "Losing assignment produced committed audit"
        results.append({"case": case, "overlap_observed": True, "commits": 1, "conflicts": 1, "status": "PASS"})
    finally:
        if first is not None and first.poll() is None:
            first.terminate()
            first.wait(timeout=10)
        dropped = subprocess.run([str(BIN / "dropdb"), *CONN, "--force", database], capture_output=True, text=True, timeout=30)
        assert dropped.returncode == 0, f"Run-owned database retained: {database}: {dropped.stderr}"

print(json.dumps({"environment": "isolated native PostgreSQL, synthetic fixtures", "results": results}, indent=2))
