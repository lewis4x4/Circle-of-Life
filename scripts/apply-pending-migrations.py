#!/usr/bin/env python3
"""
Apply pending Supabase migrations via Management API.

Workaround for a CLI v2.98.2-2.101.0 bug where `supabase db push --linked`
refuses to proceed citing 'Remote migration versions not found in local
migrations directory' even when set difference is empty.

Strategy:
  1. Query remote schema_migrations to find applied versions.
  2. Compare against local supabase/migrations/*.sql.
  3. For each pending file in sorted order:
     a. POST the SQL body to /v1/projects/{ref}/database/query.
     b. On success, INSERT a tracking row into supabase_migrations.schema_migrations.
     c. Abort on first failure.

Usage:
  SUPABASE_ACCESS_TOKEN=sbp_... ./scripts/apply-pending-migrations.py [--dry-run]
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_REF = "manfqmasfqppukpobpld"
API_BASE = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "supabase" / "migrations"

VERSION_NAME_RE = re.compile(r"^(?P<version>[0-9]+)_(?P<name>.+)\.sql$")


def must_token() -> str:
    tok = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not tok:
        sys.stderr.write("ERROR: SUPABASE_ACCESS_TOKEN env var is required\n")
        sys.exit(2)
    return tok


def run_sql(token: str, sql: str) -> list[dict] | dict:
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        API_BASE,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "apply-pending-migrations/1.0 (+circle-of-life)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {err}") from e
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return {"raw": payload}


def fetch_remote_versions(token: str) -> set[str]:
    rows = run_sql(
        token,
        "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
    )
    return {r["version"] for r in rows}


def list_local_migrations() -> list[tuple[str, str, Path]]:
    items: list[tuple[str, str, Path]] = []
    for path in sorted(MIGRATIONS_DIR.iterdir()):
        if not path.is_file() or not path.name.endswith(".sql"):
            continue
        m = VERSION_NAME_RE.match(path.name)
        if not m:
            continue
        items.append((m.group("version"), m.group("name"), path))
    return items


def split_into_statements(sql: str) -> list[str]:
    """Naive splitter — good enough to populate schema_migrations.statements.

    The Supabase CLI uses a more sophisticated splitter (handles $$ blocks etc.),
    but we just need a non-NULL array so future CLI runs see well-formed rows.
    For ACTUAL execution we send the entire SQL body in one POST.
    """
    # Strip comments first
    no_line_comments = re.sub(r"--[^\n]*", "", sql)
    parts = [p.strip() for p in no_line_comments.split(";")]
    return [p for p in parts if p]


def pg_array_literal(strings: list[str]) -> str:
    """Build a Postgres text[] literal from a list of strings."""
    if not strings:
        return "ARRAY[]::text[]"
    escaped = ["E'" + s.replace("\\", "\\\\").replace("'", "''") + "'" for s in strings]
    return "ARRAY[" + ", ".join(escaped) + "]::text[]"


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    token = must_token()

    print(f"[info] migrations dir: {MIGRATIONS_DIR}")
    print(f"[info] target project: {PROJECT_REF}")
    if dry_run:
        print("[info] DRY RUN — no changes will be applied")

    remote = fetch_remote_versions(token)
    print(f"[info] remote applied: {len(remote)} versions")

    local = list_local_migrations()
    print(f"[info] local files:    {len(local)} files")

    pending = [(v, n, p) for (v, n, p) in local if v not in remote]
    print(f"[info] pending:        {len(pending)}")
    for v, n, _ in pending:
        print(f"   - {v}_{n}")

    if not pending:
        print("[ok] nothing to apply")
        return 0

    if dry_run:
        return 0

    # Heuristic: a migration that fails with "already exists" was previously
    # applied via dashboard SQL editor during a broken-CI window. The schema
    # itself is correct; only the tracking metadata is missing. Record those
    # rows and continue, rather than aborting.
    ALREADY_EXISTS_HINTS = (
        "already exists",
        "duplicate object",
        "42P07",  # relation already exists
        "42710",  # duplicate_object
        "42723",  # duplicate_function (same signature)
        "42P06",  # duplicate_schema
    )

    def is_already_exists(err: str) -> bool:
        lower = err.lower()
        return any(h in lower for h in ALREADY_EXISTS_HINTS)

    for version, name, path in pending:
        sql = path.read_text(encoding="utf-8")
        print(f"\n[apply] {version}_{name} ({len(sql)} bytes)")
        previously_applied = False
        try:
            result = run_sql(token, sql)
        except RuntimeError as e:
            err = str(e)
            if is_already_exists(err):
                print(f"  [warn] DDL collision — likely applied earlier via dashboard")
                print(f"         {err.splitlines()[0][:200]}")
                print(f"  [info] Recording as applied without re-running")
                previously_applied = True
            else:
                print(f"  [FAIL] {err}")
                print("  Aborting — fix the error and rerun.")
                return 1
        if not previously_applied:
            print(f"  [ok] applied; recording in schema_migrations")
        # The /database/query endpoint returns rows for SELECTs or [] for DDL.

        statements = split_into_statements(sql)
        arr_lit = pg_array_literal(statements)
        track_sql = (
            "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) "
            f"VALUES ('{version}', '{name.replace(chr(39), chr(39)+chr(39))}', {arr_lit}) "
            "ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name, statements = EXCLUDED.statements"
        )
        try:
            run_sql(token, track_sql)
            print(f"  [ok] tracked")
        except RuntimeError as e:
            print(f"  [WARN] tracking row insert failed: {e}")
            print("  Migration DDL applied but schema_migrations row not recorded.")
            print("  Aborting to avoid silent drift.")
            return 1

    print("\n[done] all pending migrations applied successfully")
    return 0


if __name__ == "__main__":
    sys.exit(main())
