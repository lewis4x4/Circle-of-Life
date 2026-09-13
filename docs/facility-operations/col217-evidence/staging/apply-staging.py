"""Apply only a committed, passing integration to the explicitly approved new staging project."""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request

REF = "iwcnajanvjvynolltflw"
ROOT = Path(__file__).resolve().parent
SOURCE = Path("/Users/brianlewis/Circle of Life/Haven HFO Staging Integration")
PRIVATE = Path.home() / ".config/haven-staging"
CONTROL = PRIVATE / "control"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sha", required=True)
    parser.add_argument("--gate", type=Path, required=True)
    parser.add_argument("--migration-dir", type=Path)
    parser.add_argument("--staging-manifest", type=Path)
    args = parser.parse_args()
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=SOURCE, text=True).strip()
    assert sha == args.sha
    subprocess.run(["git", "diff", "--exit-code", "HEAD", "--", "src", "supabase", "scripts"], cwd=SOURCE, check=True, capture_output=True)
    gate = json.loads(args.gate.read_text())
    assert gate["verdict"] == "PASS"
    assert all(c["status"] == "passed" for c in gate["checks"] if c.get("required"))
    values = dict(line.split("=", 1) for line in (PRIVATE / "col217.env").read_text().splitlines() if "=" in line)
    assert values["STAGING_PROJECT_REF"] == REF
    assert (CONTROL / "supabase/.temp/project-ref").read_text().strip() == REF
    assert values["PGUSER"] == "postgres." + REF
    env = {**os.environ, **values, "PGPASSWORD": values["SUPABASE_DB_PASSWORD"]}
    inventory = subprocess.run(["supabase", "projects", "list", "--output", "json"], env=env, capture_output=True, text=True)
    assert inventory.returncode == 0
    project = next(p for p in json.loads(inventory.stdout) if p["id"] == REF)
    assert project["name"] == "Haven HFO Staging" and project["organization_id"] == "macizkpxodsegtptaytu"
    assert project["status"] == "ACTIVE_HEALTHY"
    token = None
    for account in ["access-token", "supabase"]:
        found = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-a", account, "-w"], capture_output=True, text=True)
        if found.returncode == 0 and found.stdout.strip():
            token = found.stdout.strip()
            break
    assert token, "Cannot verify live bootstrap isolation"
    if token.startswith("go-keyring-base64:"):
        token = base64.b64decode(token.split(":", 1)[1]).decode()
    baseline = subprocess.run(["/opt/homebrew/opt/postgresql@17/bin/psql", "-X", "-At", "-c", "SELECT json_build_object('ledger_table',to_regclass('supabase_migrations.schema_migrations'),'haven_table',to_regclass('public.organizations'));"], env=env, capture_output=True, text=True)
    assert baseline.returncode == 0
    (ROOT / "ledger-before.json").write_text(json.dumps({"ref": REF, "observed": json.loads(baseline.stdout)}, indent=2))
    migration_dir = args.migration_dir or SOURCE / "supabase/migrations"
    migrations = sorted(migration_dir.glob("*.sql"))
    variant = None
    if args.migration_dir:
        assert args.staging_manifest, "Explicit staging-copy manifest required"
        variant = json.loads(args.staging_manifest.read_text())
        assert variant["source_commit"] == sha and variant["target"] == REF
        equivalence = variant["schema_equivalence"]
        assert equivalence["status"] == "PASS" and equivalence["per_file_transactions"] is True and equivalence["sql_probes_passed"] == 46
        assert variant["independent_review"]["result"] == "approved" and not variant["independent_review"]["remaining_source_findings"]
        by_name = {row["file"]: row for row in variant["files"]}
        assert set(by_name) == {f.name for f in migrations}
        for f in migrations:
            assert hashlib.sha256(f.read_bytes()).hexdigest() == by_name[f.name]["applied_sha256"]
            assert hashlib.sha256((SOURCE / "supabase/migrations" / f.name).read_bytes()).hexdigest() == by_name[f.name]["original_sha256"]
    target = CONTROL / "supabase/migrations"
    target.mkdir(exist_ok=True)
    expected = {f.name for f in migrations}
    assert not ({f.name for f in target.iterdir()} - expected), "Unexpected staging control migrations"
    for f in migrations:
        shutil.copyfile(f, target / f.name)
    manifest = {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in migrations}
    manifest_path = ROOT / "applied-source-manifest.json"
    if manifest_path.exists():
        previous = ROOT / ("applied-source-manifest-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S") + ".json")
        manifest_path.rename(previous)
    manifest_path.write_text(json.dumps({"ref": REF, "source_sha": sha, "migrations": [{"file": name, "sha256": value} for name, value in manifest.items()], "staging_seed_variant": variant}, indent=2))
    for label, command in [
        ("apply-dry-run", ["supabase", "db", "push", "--linked", "--dry-run"]),
        ("apply", ["supabase", "db", "push", "--linked", "--yes"]),
    ]:
        assert (CONTROL / "supabase/.temp/project-ref").read_text().strip() == REF
        request = urllib.request.Request("https://api.supabase.com/v1/projects/" + REF + "/config/auth", headers={"Authorization": "Bearer " + token})
        auth = json.load(urllib.request.urlopen(request, timeout=30))
        assert auth["external_email_enabled"] is False and auth["disable_signup"] is True, "Bootstrap authentication isolation changed"
        result = subprocess.run(command, cwd=CONTROL, env=env, capture_output=True, text=True)
        output = result.stdout + result.stderr
        for secret in [values["SUPABASE_DB_PASSWORD"], values["SUPABASE_SERVICE_ROLE_KEY"], values["NEXT_PUBLIC_SUPABASE_ANON_KEY"]]:
            output = output.replace(secret, "[REDACTED]")
        log = ROOT / (label + ".log")
        if log.exists():
            suffix = 1
            while (ROOT / (label + "-previous-" + str(suffix) + ".log")).exists():
                suffix += 1
            log.rename(ROOT / (label + "-previous-" + str(suffix) + ".log"))
        log.write_text(output)
        print(label, "exit", result.returncode, flush=True)
        if result.returncode:
            raise SystemExit("Staging application stopped; retained redacted log. Authentication remains disabled.")
    result = subprocess.run(["/opt/homebrew/opt/postgresql@17/bin/psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", "SELECT json_agg(t) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version) t;"], env=env, capture_output=True, text=True)
    assert result.returncode == 0
    ledger = json.loads(result.stdout)
    assert len(ledger) == len(migrations), "Ledger count differs from applied source"
    (ROOT / "ledger-after.json").write_text(json.dumps({"ref": REF, "source_sha": sha, "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "ledger": ledger}, indent=2))
    print("Verified staging ledger entries", len(ledger), flush=True)

if __name__ == "__main__":
    main()
