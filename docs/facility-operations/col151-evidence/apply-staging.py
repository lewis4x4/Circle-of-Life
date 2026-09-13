#!/usr/bin/env python3
"""Apply only reviewed additive migrations364/365 to retained Haven HFO staging.

No seed replay, config change, production target, or destructive rollback. Both
DDL files and their ledger records commit together. Failed transactions retain363.
"""
import argparse
import base64
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
REF = "iwcnajanvjvynolltflw"
FILES = ["364_hfo_attention_ownership.sql", "365_hfo_activity_history_exports.sql"]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["inspect", "apply"])
    parser.add_argument("--ready", type=Path)
    args = parser.parse_args()
    credential = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-a", "access-token", "-w"], capture_output=True, text=True, check=True).stdout.strip()
    if credential.startswith("go-keyring-base64:"):
        credential = base64.b64decode(credential.split(":", 1)[1]).decode()

    def request(path, body=None):
        payload = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request("https://api.supabase.com/v1/" + path, data=payload,
                                     headers={"Authorization": "Bearer " + credential, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as response:
                return json.load(response)
        except Exception:
            raise RuntimeError("Staging management request failed; inspect target state before retrying") from None

    def identify():
        project = next(p for p in request("projects") if p["id"] == REF)
        require(project["name"] == "Haven HFO Staging" and project["organization_id"] == "macizkpxodsegtptaytu"
                and project["status"] == "ACTIVE_HEALTHY", "Staging identity/status changed")
        return {k: project[k] for k in ["id", "name", "organization_id", "status"]}

    def sql(query):
        return request("projects/" + REF + "/database/query", {"query": query})

    project = identify()
    ledger = sql("SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version")
    migration_bytes = {name: (ROOT / "supabase/migrations" / name).read_bytes() for name in FILES}
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in migration_bytes.items()}
    before = {"target": REF, "at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "project": project,
              "ledger": ledger, "migration_hashes": hashes}
    (OUT / "staging-apply-preflight.json").write_text(json.dumps(before, indent=2) + "\n")
    if args.action == "inspect":
        print(json.dumps({"target": REF, "ledger_count": len(ledger), "pending": [f for f in FILES if f[:3] not in {r['version'] for r in ledger}]}))
        return
    require(args.ready is not None, "Explicit reviewed release readiness required")
    ready = json.loads(args.ready.read_text())
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    require(ready["target"] == REF and ready["sourceSha"] == sha and ready["migration_hashes"] == hashes, "Reviewed source mismatch")
    require(subprocess.run(["git", "diff", "--quiet", "HEAD", "--", "src", "supabase", "scripts", str(Path(__file__).resolve())], cwd=ROOT).returncode == 0, "Uncommitted runtime or release-runner changes")
    for key in ["gate", "review"]:
        ref = ready[key]
        raw = Path(ref["path"]).read_bytes()
        require(hashlib.sha256(raw).hexdigest() == ref["sha256"], "Readiness evidence changed")
        evidence = json.loads(raw)
        if key == "gate":
            require(ref["sourceSha"] == sha, "Gate source binding does not match current source")
            require(evidence["verdict"] == "PASS" and any(c.get("required") for c in evidence["checks"])
                    and all(c["status"] == "passed" for c in evidence["checks"] if c.get("required")), "Required gates did not pass")
        else:
            require(evidence["sourceSha"] == sha and evidence["independent"] is True
                    and evidence["result"] == "[PROOF PASS — CLEAN]", "Independent source review required")
    versions = {r["version"] for r in ledger}
    require("363" in versions and "364" not in versions and "365" not in versions and len(ledger) == 366, "Unexpected staging ledger; inspect instead of reapplying")
    statements = ["BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';",
                  "SELECT pg_advisory_xact_lock(hashtextextended('haven-col151-staging-release',0));",
                  "LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;",
                  "DO $$ BEGIN IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>366 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN ('364','365')) THEN RAISE EXCEPTION 'Staging ledger changed'; END IF; END $$;"]
    for name in FILES:
        source = migration_bytes[name].decode()
        require(source.lstrip().startswith("BEGIN;") and source.rstrip().endswith("COMMIT;"), "Migration transaction shape changed")
        body = source.strip()[len("BEGIN;"):-len("COMMIT;")]
        statements += [body, "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ("
                       + literal(name[:3]) + "," + literal(name[4:-4]) + ",ARRAY[" + literal(source) + "]);" ]
    statements += ["NOTIFY pgrst, 'reload schema'; COMMIT;"]
    identify()  # immediate live identity check before the one bounded mutation
    sql("\n".join(statements))
    after = sql("SELECT version,name FROM supabase_migrations.schema_migrations WHERE version IN ('363','364','365') ORDER BY version")
    posture = sql("SELECT c.relrowsecurity,NOT has_table_privilege('authenticated',c.oid,'SELECT') AS private_table,to_regprocedure('public.create_operation_history_export(uuid,uuid,uuid)') IS NOT NULL AS create_rpc,to_regprocedure('public.read_operation_history_export(uuid,integer,integer)') IS NOT NULL AS read_rpc FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='haven' AND c.relname='operation_history_exports'")
    require({r["version"] for r in after} == {"363", "364", "365"} and len(posture) == 1 and all(posture[0].values()), "Post-application schema verification failed")
    record = {"target": REF, "sourceSha": sha, "migration365Verified": True, "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "migration_hashes": hashes, "ledger": after, "posture": posture, "result": "PASS", "scope": "Additive staging schema only; no fixture or operating acceptance"}
    (OUT / "staging-readiness.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"target": REF, "result": "PASS", "versions": [r["version"] for r in after]}))


if __name__ == "__main__":
    main()
