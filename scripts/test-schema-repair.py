#!/usr/bin/env python3
"""Test the COL252 repair on an explicitly run-owned scratch cluster."""
import argparse
import json
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", type=Path, required=True)
    parser.add_argument("--port", required=True)
    parser.add_argument("--bin", type=Path, required=True)
    args = parser.parse_args()
    socket = args.socket.resolve()
    socket.relative_to(Path.home() / ".hermes/tmp/agent-runs")
    manifest = json.loads((socket / "manifest.json").read_text())
    if manifest["created_by"] != "codex" or manifest["run_id"] != socket.name:
        raise ValueError("scratch cluster ownership mismatch")
    database = "col252_" + uuid.uuid4().hex
    connection = ["-h", str(socket), "-p", args.port, "-U", "postgres"]

    def run(tool, extra, **kwargs):
        return subprocess.run([str(args.bin / tool), *connection, *extra],
                              capture_output=True, text=True, **kwargs)

    def sql(statement, fail=False):
        result = run("psql", ["-d", database, "-X", "-v", "ON_ERROR_STOP=1"],
                     input=statement)
        if (result.returncode != 0) != fail:
            raise AssertionError(result.stderr or "expected SQL refusal")
        return result.stdout

    run("createdb", [database], check=True)
    try:
        foundation = (ROOT / "supabase/migrations/006_audit_triggers.sql").read_text()
        foundation = foundation.split("-- BEFORE UPDATE: timestamps")[0]
        sql("""
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
CREATE TABLE public.facilities(id uuid PRIMARY KEY, alf_license_type text);
CREATE TABLE public.vendor_facilities(id uuid PRIMARY KEY);
CREATE TYPE public.vendor_category AS ENUM ('other');
CREATE TABLE public.fl_statutes(id uuid PRIMARY KEY, organization_id uuid,
  statute_title text, updated_at timestamptz, updated_by uuid);
INSERT INTO facilities VALUES (gen_random_uuid(),'standard_alf');
INSERT INTO vendor_facilities VALUES (gen_random_uuid());
""" + foundation)
        repair = (ROOT / "supabase/migrations/381_col252_restore_missing_schema_effects.sql").read_text()
        sql("BEGIN;\n" + repair + "\nCOMMIT;")
        sql("BEGIN;\n" + repair + "\nCOMMIT;")  # idempotent replay
        sql("""
DO $test$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  IF (SELECT count(*) FROM pg_attribute WHERE
      attrelid='public.vendor_facilities'::regclass AND attnum>0
      AND NOT attisdropped) <> 7 THEN
    RAISE EXCEPTION 'missing repaired columns';
  END IF;
  IF EXISTS (SELECT 1 FROM vendor_facilities WHERE coi_on_file IS NOT NULL
      OR coi_expiration IS NOT NULL OR service_contract_status IS NOT NULL
      OR service_contract_expiration IS NOT NULL OR last_invoice_at IS NOT NULL
      OR last_payment_at IS NOT NULL) THEN
    RAISE EXCEPTION 'repair fabricated compliance data';
  END IF;
  IF (SELECT count(*) FROM pg_enum WHERE enumtypid='public.vendor_category'::regtype
      AND enumlabel IN ('government_partner','community_partner')) <> 2 THEN
    RAISE EXCEPTION 'enum repair missing';
  END IF;
  IF (SELECT alf_license_type FROM facilities LIMIT 1) <> 'standard_alf' THEN
    RAISE EXCEPTION 'repair changed licensure';
  END IF;
  BEGIN
    INSERT INTO facilities VALUES (gen_random_uuid(),'invalid');
    RAISE EXCEPTION 'invalid license accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO fl_statutes(id,statute_title,updated_at)
    VALUES(v_id,'synthetic before','2000-01-01');
  UPDATE fl_statutes SET statute_title='synthetic after' WHERE id=v_id;
  IF (SELECT count(*) FROM audit_log WHERE record_id=v_id) <> 2 THEN
    RAISE EXCEPTION 'audit trigger missing or duplicated';
  END IF;
  IF (SELECT updated_at FROM fl_statutes WHERE id=v_id) <= '2000-01-01'::timestamptz THEN
    RAISE EXCEPTION 'timestamp trigger missing';
  END IF;
END
$test$;
""")
        # A same-named but wrong column must not be accepted by IF NOT EXISTS.
        sql("ALTER TABLE vendor_facilities ALTER COLUMN coi_on_file TYPE text;")
        sql("BEGIN;\n" + repair + "\nCOMMIT;", fail=True)
        sql("ALTER TABLE vendor_facilities ALTER COLUMN coi_on_file TYPE boolean "
            "USING coi_on_file::boolean;")
        # A failure must roll back additions, rather than leave a partial repair.
        sql("ALTER TABLE facilities DROP CONSTRAINT facilities_alf_license_type_check; "
            "INSERT INTO facilities VALUES(gen_random_uuid(),'invalid'); "
            "ALTER TABLE vendor_facilities DROP COLUMN coi_on_file;")
        sql("BEGIN;\n" + repair + "\nCOMMIT;", fail=True)
        sql("""
DO $test$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE
   attrelid='vendor_facilities'::regclass AND attname='coi_on_file'
   AND NOT attisdropped) THEN RAISE EXCEPTION 'partial repair persisted'; END IF;
END $test$;
""")
        print("PASS: additive repair, repeat application, unknown data preserved, "
              "license refusal, real audit/timestamp triggers, atomic failure rollback")
    finally:
        run("dropdb", [database], check=True)


if __name__ == "__main__":
    main()
