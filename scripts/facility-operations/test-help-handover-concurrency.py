#!/usr/bin/env python3
"""Observed lock races for COL-153 in a run-owned native PostgreSQL cluster.

Requires the already installed psycopg and a migrated HFO_HANDOVER_BASELINE_DB.
No hosted database URL is accepted. Each case clones and drops its own database.
"""
import json
import os
from pathlib import Path
import threading
import time
import uuid

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

root = Path(__file__).resolve().parents[2]
socket = Path(os.environ["PG_VERIFY_NATIVE_SOCKET"]).resolve()
assert socket.is_relative_to((Path.home() / ".hermes/tmp/agent-runs").resolve())
manifest = json.loads((socket / "manifest.json").read_text())
assert manifest["created_by"] == "codex" and manifest["run_id"] == socket.name
connection = dict(host=str(socket), port=os.environ.get("PG_VERIFY_NATIVE_PORT", "55453"), user="postgres")
baseline = os.environ["HFO_HANDOVER_BASELINE_DB"]
probe = (root / "supabase/tests/review_hfo_task_help_handover.sql").read_text()


def connect(database, **kwargs):
    return psycopg.connect(**connection, dbname=database, **kwargs)


def actor_session(database, fixture):
    conn = connect(database)
    version = conn.execute("SELECT auth_claim_version FROM public.user_profiles WHERE id=%s", (fixture["actor"],)).fetchone()[0]
    conn.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps(dict(
        sub=str(fixture["actor"]), session_id=str(fixture["actor_session"]), role="authenticated",
        app_role="facility_admin", organization_id=str(fixture["org"]), auth_claim_version=version)),))
    conn.execute("SET ROLE authenticated")
    return conn


def help_command(conn, fixture, key):
    return conn.execute("SELECT public.write_operation_help_handover_review(%s,%s,'help',%s,NULL,%s::jsonb)",
                        (fixture["activity"], fixture["site"], key,
                         json.dumps(dict(how_to="Synthetic race guidance", examples="", contact="", protected_document_ids=[])))).fetchone()[0]


def race(observer, second, operation, release):
    result = {}

    def run():
        try:
            result["value"] = operation()
            second.commit()
        except psycopg.Error as error:
            result["sqlstate"] = error.sqlstate
            result["error"] = str(error)
            second.rollback()

    thread = threading.Thread(target=run)
    thread.start()
    deadline = time.monotonic() + 8
    while thread.is_alive() and time.monotonic() < deadline:
        state = observer.execute("SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=%s", (second.info.backend_pid,)).fetchone()
        if state and state[0] == "Lock":
            result["observed_wait"] = state[1]
            break
        time.sleep(0.02)
    try:
        assert "observed_wait" in result, "Command did not reach an observed database lock wait"
        release()
    finally:
        thread.join(8)
        if thread.is_alive():
            second.cancel()
            thread.join(2)
    assert not thread.is_alive(), "Command did not finish after lock release"
    return result


def case(name):
    database = "hfo_handover_race_" + uuid.uuid4().hex[:16]
    admin = connect("postgres", autocommit=True)
    admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE {}").format(sql.Identifier(database), sql.Identifier(baseline)))
    sessions = []
    try:
        observer = connect(database, autocommit=True)
        sessions.append(observer)
        # Fixture-only prefix is authored by the SQL probe and never performs
        # help/assignment commands. Persist its temp tables only in this clone.
        fixture_sql = probe.split("-- FIXTURES-END")[0].replace("BEGIN;", "").replace("CREATE TEMP TABLE", "CREATE TABLE")
        observer.execute(fixture_sql)
        with connect(database, row_factory=dict_row) as reader:
            fixture = reader.execute("SELECT * FROM cf").fetchone()
        first = actor_session(database, fixture)
        second = actor_session(database, fixture)
        sessions += [first, second]
        if name in ("same_key_replay", "stale_parallel_publication"):
            saved = help_command(first, fixture, "race-first-0001")
            key = "race-first-0001" if name == "same_key_replay" else "race-second-0001"
            result = race(observer, second, lambda: help_command(second, fixture, key), first.commit)
            if name == "same_key_replay":
                assert result["value"]["replayed"] is True
                assert result["value"]["event"]["id"] == saved["event"]["id"]
            else:
                assert result.get("sqlstate") == "P0001", result
            assert observer.execute("SELECT count(*) FROM operation_help_handover_events").fetchone()[0] == 1
        else:
            # Block before authority acquisition, then revoke/expire the actor
            # while its command waits. A pre-wait authority check is insufficient.
            first.execute("RESET ROLE")
            first.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,153))", (str(fixture["activity"]) + ":" + str(fixture["site"]),))

            def release():
                column = "revoked_at" if name == "revoked_during_wait" else "operation_expires_at"
                observer.execute(sql.SQL("UPDATE user_facility_access SET {}=clock_timestamp()-interval '1 second' WHERE user_id=%s AND facility_id=%s").format(sql.Identifier(column)), (fixture["actor"], fixture["site"]))
                first.commit()

            result = race(observer, second, lambda: help_command(second, fixture, "race-denied-0001"), release)
            assert result.get("sqlstate") == "42501", result
            assert observer.execute("SELECT count(*) FROM operation_help_handover_events").fetchone()[0] == 0
        return dict(case=name, result="PASS", observed_wait=result["observed_wait"], sqlstate=result.get("sqlstate"), replayed=result.get("value", {}).get("replayed"))
    finally:
        for session in reversed(sessions):
            session.close()
        admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database)))
        admin.close()


if __name__ == "__main__":
    for name in ("same_key_replay", "stale_parallel_publication", "revoked_during_wait", "expired_during_wait"):
        print(json.dumps(case(name)), flush=True)
