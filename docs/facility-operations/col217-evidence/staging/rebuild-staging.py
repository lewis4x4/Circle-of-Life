"""Clear only this run-created, unused staging bootstrap before synthetic replay."""
import base64
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.request

REF = "iwcnajanvjvynolltflw"
ROOT = Path(__file__).resolve().parent
PRIVATE = Path.home() / ".config/haven-staging"
SOURCE = Path("/Users/brianlewis/Circle of Life/Haven HFO Staging Integration")

def main():
    # The parent creates this only after independent copy review and schema/probe PASS.
    ready = json.loads((ROOT / "SYNTHETIC-REPLAY-READY.json").read_text())
    assert ready["target"] == REF and ready["schema_equivalence"] == "PASS" and ready["review"] == "PASS"
    assert not (PRIVATE / "col143-fixtures.json").exists(), "Proof fixtures already exist; reset no longer permitted"
    values = dict(line.split("=", 1) for line in (PRIVATE / "col217.env").read_text().splitlines() if "=" in line)
    assert values["STAGING_PROJECT_REF"] == REF and values["PGUSER"] == "postgres." + REF
    token = None
    for account in ["access-token", "supabase"]:
        r = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-a", account, "-w"], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            token = r.stdout.strip()
            break
    assert token
    if token.startswith("go-keyring-base64:"):
        token = base64.b64decode(token.split(":", 1)[1]).decode()
    def api(path):
        request = urllib.request.Request("https://api.supabase.com/v1/projects/" + REF + path, headers={"Authorization": "Bearer " + token})
        return json.load(urllib.request.urlopen(request, timeout=30))
    project = api("")
    original = json.loads((ROOT / "provisioned-project.json").read_text())["project"]
    assert project["id"] == REF and project["created_at"] == original["created_at"]
    assert project["name"] == "Haven HFO Staging" and project["organization_id"] == "macizkpxodsegtptaytu"
    auth = api("/config/auth")
    assert auth["external_email_enabled"] is False and auth["disable_signup"] is True
    env = {**os.environ, **values, "PGPASSWORD": values["SUPABASE_DB_PASSWORD"]}
    def sql(query):
        r = subprocess.run(["/opt/homebrew/opt/postgresql@17/bin/psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", query], env=env, capture_output=True, text=True)
        assert r.returncode == 0, "Staging guard query failed"
        return json.loads(r.stdout)
    before = sql("SELECT json_build_object('auth_ids',(SELECT coalesce(json_agg(id),'[]'::json) FROM auth.users),'sessions',(SELECT count(*) FROM auth.sessions),'objects',(SELECT count(*) FROM storage.objects),'ledger_count',(SELECT count(*) FROM supabase_migrations.schema_migrations));")
    assert before["sessions"] == 0 and before["objects"] == 0 and before["ledger_count"] == 202
    source_text = "\n".join(p.read_text() for p in (SOURCE / "supabase/migrations").glob("*.sql"))
    known_ids = set(re.findall(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", source_text))
    assert set(before["auth_ids"]) <= known_ids, "Non-source Auth identity found; refusing reset"
    control = PRIVATE / "reset-control"
    (control / "supabase/.temp").mkdir(parents=True, exist_ok=True)
    control.chmod(0o700)
    shutil.copyfile(PRIVATE / "control/supabase/config.toml", control / "supabase/config.toml")
    for name in ["project-ref", "pooler-url", "postgres-version"]:
        source = PRIVATE / "control/supabase/.temp" / name
        if source.exists():
            shutil.copyfile(source, control / "supabase/.temp" / name)
    assert not (control / "supabase/migrations").exists()
    assert (control / "supabase/.temp/project-ref").read_text().strip() == REF
    (ROOT / "rebuild-before.json").write_text(json.dumps({"target": REF, "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "before": before, "scope": "Only run-created staging; all Auth IDs match embedded source seeds; zero sessions and uploaded objects."}, indent=2))
    result = subprocess.run(["supabase", "db", "reset", "--linked", "--no-seed", "--yes"], cwd=control, env=env, capture_output=True, text=True)
    log = result.stdout + result.stderr
    for secret in [values["SUPABASE_DB_PASSWORD"], values["SUPABASE_SERVICE_ROLE_KEY"], values["NEXT_PUBLIC_SUPABASE_ANON_KEY"]]:
        log = log.replace(secret, "[REDACTED]")
    (ROOT / "rebuild.log").write_text(log)
    if result.returncode != 0:
        assert "SQLSTATE 53200" in log and "out of shared memory" in log, "Reset stopped; inspect retained log"
        # The CLI's single DO transaction exceeds Micro's lock table. Its failed
        # transaction rolled back. Clear only the same run-owned application
        # objects in short transactions, retaining managed schemas/roles.
        unchanged = sql("SELECT json_build_object('users',(SELECT count(*) FROM auth.users),'sessions',(SELECT count(*) FROM auth.sessions),'objects',(SELECT count(*) FROM storage.objects),'ledger',(SELECT count(*) FROM supabase_migrations.schema_migrations));")
        assert unchanged["users"] == len(before["auth_ids"]) and unchanged["sessions"] == 0 and unchanged["objects"] == 0 and unchanged["ledger"] == 202
        commands = []
        def execute(statement):
            r = subprocess.run(["/opt/homebrew/opt/postgresql@17/bin/psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", statement], env=env, capture_output=True, text=True)
            commands.append({"sql": statement, "exit": r.returncode})
            (ROOT / "rebuild-batched.json").write_text(json.dumps({"ref": REF, "commands": commands}, indent=2))
            assert r.returncode == 0, "Batched reset stopped: " + r.stderr[:300]
        execute("DROP SCHEMA IF EXISTS haven CASCADE;")
        for kind, keyword in [("v", "VIEW"), ("m", "MATERIALIZED VIEW"), ("r", "TABLE"), ("p", "TABLE")]:
            objects = sql("SELECT coalesce(json_agg(quote_ident(n.nspname)||'.'||quote_ident(c.relname)),'[]'::json) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='" + kind + "' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e');")
            for name in objects:
                execute("DROP " + keyword + " IF EXISTS " + name + " CASCADE;")
            print("Cleared application", keyword.lower(), "objects", len(objects), flush=True)
            fresh = api("/config/auth")
            assert fresh["external_email_enabled"] is False and fresh["disable_signup"] is True
        functions = sql("SELECT coalesce(json_agg(p.oid::regprocedure::text),'[]'::json) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e');")
        for function in functions:
            execute("DROP FUNCTION IF EXISTS " + function + " CASCADE;")
        types = sql("SELECT coalesce(json_agg(quote_ident(n.nspname)||'.'||quote_ident(t.typname)),'[]'::json) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype IN('e','c','d','r','m') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_type'::regclass AND d.objid=t.oid AND d.deptype='e');")
        for name in types:
            execute("DROP TYPE IF EXISTS " + name + " CASCADE;")
        policies = sql("SELECT coalesce(json_agg(format('DROP POLICY IF EXISTS %I ON %I.%I;',policyname,schemaname,tablename)),'[]'::json) FROM pg_policies WHERE schemaname='storage';")
        for statement in policies:
            execute(statement)
        # Before proof begins, every Auth identity and all migration history
        # belong to this run's failed source bootstrap; no live sessions/objects.
        execute("TRUNCATE auth.users CASCADE;")
        execute("TRUNCATE supabase_migrations.schema_migrations;")
        seed_table = sql("SELECT json_build_object('exists',to_regclass('supabase_migrations.seed_files')::text);")
        if seed_table["exists"]:
            execute("TRUNCATE supabase_migrations.seed_files;")
    after = sql("SELECT json_build_object('users',(SELECT count(*) FROM auth.users),'sessions',(SELECT count(*) FROM auth.sessions),'objects',(SELECT count(*) FROM storage.objects),'haven_table',to_regclass('public.organizations'));")
    (ROOT / "rebuild-after.json").write_text(json.dumps({"target": REF, "after": after}, indent=2))
    assert after["users"] == 0 and after["sessions"] == 0 and after["objects"] == 0 and after["haven_table"] is None
    print("Run-created staging reset verified; no Auth users, sessions, uploaded objects or Haven schema remain.")

if __name__ == "__main__":
    main()
