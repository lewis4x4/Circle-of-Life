#!/usr/bin/env python3
"""Exercise actual migration 332 repair against synthetic stale/missing index rows.
Only a provenance-checked local PostgreSQL socket is accepted; no hosted DSN.
"""
import json
import os
from pathlib import Path
import subprocess
import time

root = Path(__file__).resolve().parents[1]
socket = Path(os.environ['PG_VERIFY_NATIVE_SOCKET']).resolve()
assert socket.is_relative_to((Path.home()/'.hermes/tmp/agent-runs').resolve())
manifest = json.loads((socket/'manifest.json').read_text())
assert manifest['created_by'] == 'codex' and manifest['run_id'] == socket.name
pg = Path(os.environ['PG_VERIFY_NATIVE_BIN'])
assert pg.is_absolute()
conn = ['-h', str(socket), '-p', os.environ.get('PG_VERIFY_NATIVE_PORT','55439'), '-U','postgres']
database = f'section2_search_repair_{os.getpid()}_{int(time.time())}'

def sql(text):
    result = subprocess.run([str(pg/'psql'),*conn,'-X','-At','-d',database,'-v','ON_ERROR_STOP=1'],input=text,text=True,capture_output=True,timeout=120)
    assert result.returncode == 0, result.stderr[-4000:]
    return result.stdout

subprocess.run([str(pg/'createdb'),*conn,database],check=True,capture_output=True)
try:
    migrations = sorted((root/'supabase/migrations').glob('*.sql'))
    sql((root/'scripts/pg-verify-stub.sql').read_text())
    for migration in migrations:
        sql(migration.read_text())
    setup = (root/'supabase/tests/review_section2_search.sql').read_text().split('SELECT pg_temp.search_claims();')[0]
    defects = """
ALTER TABLE sf ADD COLUMN missing uuid DEFAULT gen_random_uuid(), ADD COLUMN removed uuid DEFAULT gen_random_uuid(), ADD COLUMN orphan uuid DEFAULT gen_random_uuid(), ADD COLUMN vendor uuid DEFAULT gen_random_uuid();
INSERT INTO residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,deleted_at)
 SELECT missing,organization,facility,'Missing','Synthetic','1940-01-01'::date,'female'::gender,NULL::timestamptz FROM sf
 UNION ALL SELECT removed,organization,facility,'Deleted','Synthetic','1940-01-01'::date,'female'::gender,now() FROM sf;
DELETE FROM search_documents WHERE source_id=(SELECT missing FROM sf);
UPDATE residents SET facility_id=(SELECT target_facility FROM sf) WHERE id=(SELECT resident FROM sf);
UPDATE search_documents SET organization_id=(SELECT other_org FROM sf),facility_id=(SELECT facility FROM sf),label='Obsolete name',search_tsv=to_tsvector('english','obsolete') WHERE source_id=(SELECT resident FROM sf);
UPDATE search_documents SET deleted_at=NULL WHERE source_id=(SELECT removed FROM sf);
INSERT INTO search_documents(organization_id,facility_id,source_table,source_id,label,search_tsv)
 SELECT organization,facility,'residents',orphan,'Orphan',to_tsvector('english','orphan') FROM sf
 UNION ALL SELECT organization,facility,'vendors',vendor,'External producer fixture',to_tsvector('english','vendor') FROM sf;
CREATE TEMP TABLE external_before AS SELECT to_jsonb(d) row FROM search_documents d WHERE source_id=(SELECT vendor FROM sf);
"""
    # Remove only the migration's outer transaction markers so the actual repair
    # runs inside this synthetic fixture transaction, which is rolled back below.
    repair = (root/'supabase/migrations/332_resident_search_current_scope.sql').read_text().replace('\nBEGIN;\n','\n').replace('\nCOMMIT;\n','\n')
    assertions = """
SELECT pg_temp.search_assert((SELECT d.organization_id=r.organization_id AND d.facility_id=r.facility_id AND d.label=r.last_name||', '||r.first_name AND d.search_tsv @@ plainto_tsquery('english','SectionTwoSearch') FROM search_documents d JOIN residents r ON r.id=d.source_id WHERE r.id=(SELECT resident FROM sf)),'actual migration repairs stale scope label and lexical content');
SELECT pg_temp.search_assert(EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT missing FROM sf) AND deleted_at IS NULL),'actual migration backfills missing resident');
SELECT pg_temp.search_assert(EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT removed FROM sf) AND deleted_at IS NOT NULL),'actual migration preserves source soft deletion');
SELECT pg_temp.search_assert(EXISTS(SELECT 1 FROM search_documents WHERE source_id=(SELECT orphan FROM sf) AND deleted_at IS NOT NULL),'actual migration retires orphan index without hard deletion');
SELECT pg_temp.search_assert((SELECT to_jsonb(d)=(SELECT row FROM external_before) FROM search_documents d WHERE source_id=(SELECT vendor FROM sf)),'actual migration leaves other producers byte-for-byte unchanged');
SELECT json_build_object('verdict','PASS','repair_assertions',5,'migration','332','environment','run-owned native PostgreSQL with synthetic fixtures');
ROLLBACK;
"""
    output = sql(setup + defects + repair + assertions)
    report = next(json.loads(line) for line in output.splitlines() if line.startswith('{"verdict"'))
    report['migration_files_replayed'] = len(migrations)
    print(json.dumps(report,indent=2))
finally:
    subprocess.run([str(pg/'dropdb'),*conn,database],check=True,capture_output=True)
