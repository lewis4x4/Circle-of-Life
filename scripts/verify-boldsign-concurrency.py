#!/usr/bin/env python3
"""COL-294 multi-connection regression on an explicitly run-owned PostgreSQL.

PG_VERIFY_NATIVE_SOCKET/PORT/BIN must identify the isolated cluster created by
pg-verify-migrations.mjs. This script creates and drops only databases whose
names include this process identity. It never accepts an application/hosted DSN
and all fixtures are synthetic.
"""

import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import threading
import time


ROOT = Path(__file__).resolve().parents[1]
SOCKET = Path(os.environ["PG_VERIFY_NATIVE_SOCKET"]).resolve()
RUNS = (Path.home() / ".hermes/tmp/agent-runs").resolve()
assert SOCKET.is_relative_to(RUNS), "Run-owned local cluster required"
manifest = json.loads((SOCKET / "manifest.json").read_text())
assert manifest["created_by"] == "codex" and manifest["run_id"] == SOCKET.name
BIN = Path(os.environ["PG_VERIFY_NATIVE_BIN"])
assert BIN.is_absolute()
CONN = [
    "-h",
    str(SOCKET),
    "-p",
    os.environ.get("PG_VERIFY_NATIVE_PORT", "55439"),
    "-U",
    "postgres",
]
PREFIX = f"boldsign_concurrency_{os.getpid()}_{int(time.time())}"
created = []
children = []


def command(tool, args, sql=None):
    return subprocess.run(
        [str(BIN / tool), *CONN, *args],
        input=sql,
        text=True,
        capture_output=True,
        timeout=120,
    )


def query(db, sql, must_pass=True):
    result = command(
        "psql",
        ["-X", "-At", "-d", db, "-v", "ON_ERROR_STOP=1"],
        sql,
    )
    if must_pass and result.returncode:
        raise RuntimeError(result.stderr[-4000:])
    return result


def create(name, template=None):
    args = ["-T", template, name] if template else [name]
    result = command("createdb", args)
    assert result.returncode == 0, result.stderr
    created.append(name)


def service_call(contract_id, request_id, actor_id, organization_id, facility_id):
    return f"""SELECT public.prepare_boldsign_contract_send(
      '{contract_id}'::uuid,'{request_id}'::uuid,'{actor_id}'::uuid,
      '{organization_id}'::uuid,'{facility_id}'::uuid,
      'synthetic-template',true,'test');"""


def webhook_call(event_id, payload):
    escaped = payload.replace("'", "''")
    return f"""SELECT public.apply_boldsign_webhook_event(
      'test','{event_id}','Viewed','synthetic-webhook-document',
      timestamptz '2026-09-20 12:05Z','{escaped}'::jsonb,
      NULL,NULL,'identical@boldsign.invalid',NULL,true);"""


def overlap(db, statements):
    barrier = threading.Barrier(len(statements))

    def worker(sql):
        barrier.wait(timeout=10)
        return query(db, "SET ROLE service_role; " + sql, must_pass=False)

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=len(statements)
    ) as pool:
        return list(pool.map(worker, statements))


def json_result(result):
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])


def fixture(db):
    row = query(
        db,
        """SELECT json_build_object(
          'organization_id',organization_id,'facility_id',facility_id,
          'actor_id',actor_id,'contract_identical',contract_identical,
          'contract_competing',contract_competing,'contract_mutation',contract_mutation,
          'signer_mutation',signer_mutation,'request_identical',request_identical,
          'request_competing_a',request_competing_a,
          'request_competing_b',request_competing_b,
          'request_mutation',request_mutation)
        FROM boldsign_concurrency_fixture;""",
    ).stdout.strip()
    return json.loads(row)


def claim_count(db, contract_id):
    return int(
        query(
            db,
            f"SELECT count(*) FROM public.resident_contract_send_claims "
            f"WHERE contract_id='{contract_id}'::uuid;",
        ).stdout.strip()
    )


SEED = """
CREATE TABLE boldsign_concurrency_fixture AS SELECT
  gen_random_uuid() organization_id,
  gen_random_uuid() entity_id,
  gen_random_uuid() facility_id,
  gen_random_uuid() actor_id,
  gen_random_uuid() resident_id,
  gen_random_uuid() contract_identical,
  gen_random_uuid() contract_competing,
  gen_random_uuid() contract_mutation,
  gen_random_uuid() signer_identical,
  gen_random_uuid() signer_competing,
  gen_random_uuid() signer_mutation,
  gen_random_uuid() request_identical,
  gen_random_uuid() request_competing_a,
  gen_random_uuid() request_competing_b,
  gen_random_uuid() request_mutation;

INSERT INTO public.organizations(id,name)
SELECT organization_id,'Synthetic BoldSign concurrency organization'
FROM boldsign_concurrency_fixture;
INSERT INTO public.entities(id,organization_id,name)
SELECT entity_id,organization_id,'Synthetic BoldSign concurrency entity'
FROM boldsign_concurrency_fixture;
INSERT INTO public.facilities(
  id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds
)
SELECT facility_id,entity_id,organization_id,
  'Synthetic BoldSign concurrency facility','1 Synthetic Way','Test','32000',1
FROM boldsign_concurrency_fixture;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT actor_id,actor_id||'@boldsign.invalid',
  jsonb_build_object('organization_id',organization_id,'app_role','owner'),
  '{}'::jsonb
FROM boldsign_concurrency_fixture;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role)
SELECT actor_id,organization_id,actor_id||'@boldsign.invalid',
  'Synthetic signing actor','owner'::public.app_role
FROM boldsign_concurrency_fixture;
INSERT INTO public.residents(
  id,facility_id,organization_id,first_name,last_name,date_of_birth,gender,status
)
SELECT resident_id,facility_id,organization_id,'Synthetic','Resident',
  '1940-01-01','other'::public.gender,'active'::public.resident_status
FROM boldsign_concurrency_fixture;
INSERT INTO public.resident_contracts(
  id,organization_id,facility_id,resident_id,contract_type,title,provider,status
)
SELECT contract_identical,organization_id,facility_id,resident_id,
  'admission_agreement','Identical request contract','boldsign','draft'
FROM boldsign_concurrency_fixture
UNION ALL
SELECT contract_competing,organization_id,facility_id,resident_id,
  'financial_agreement','Competing request contract','boldsign','draft'
FROM boldsign_concurrency_fixture
UNION ALL
SELECT contract_mutation,organization_id,facility_id,resident_id,
  'arbitration_agreement','Signer mutation contract','boldsign','draft'
FROM boldsign_concurrency_fixture;
INSERT INTO public.resident_contract_signers(
  id,organization_id,facility_id,contract_id,resident_id,signer_role,
  signer_name,signer_email,routing_order,status
)
SELECT signer_identical,organization_id,facility_id,contract_identical,resident_id,
  'resident','Synthetic Identical','identical@boldsign.invalid',1,'pending'
FROM boldsign_concurrency_fixture
UNION ALL
SELECT signer_competing,organization_id,facility_id,contract_competing,resident_id,
  'resident','Synthetic Competing','competing@boldsign.invalid',1,'pending'
FROM boldsign_concurrency_fixture
UNION ALL
SELECT signer_mutation,organization_id,facility_id,contract_mutation,resident_id,
  'resident','Synthetic Mutation','mutation@boldsign.invalid',1,'pending'
FROM boldsign_concurrency_fixture;
GRANT SELECT ON boldsign_concurrency_fixture TO service_role;
"""


try:
    template = PREFIX + "_base"
    create(template)
    files = [
        ROOT / "scripts/pg-verify-stub.sql",
        *sorted((ROOT / "supabase/migrations").glob("*.sql")),
    ]
    for file in files:
        query(template, file.read_text())
    query(template, SEED)
    report = {
        "migration_files": len(files) - 1,
        "environment": "isolated native PostgreSQL with Supabase stubs",
        "cases": [],
    }

    db = PREFIX + "_identical"
    create(db, template)
    ids = fixture(db)
    call = service_call(
        ids["contract_identical"],
        ids["request_identical"],
        ids["actor_id"],
        ids["organization_id"],
        ids["facility_id"],
    )
    results = overlap(db, [call, call])
    payloads = [json_result(result) for result in results]
    actions = sorted(payload["action"] for payload in payloads)
    assert actions == ["reconcile", "send"], payloads
    assert claim_count(db, ids["contract_identical"]) == 1
    report["cases"].append(
        {
            "case": "two concurrent identical request IDs",
            "actions": actions,
            "claims": 1,
        }
    )

    db = PREFIX + "_competing"
    create(db, template)
    ids = fixture(db)
    statements = [
        service_call(
            ids["contract_competing"],
            request_id,
            ids["actor_id"],
            ids["organization_id"],
            ids["facility_id"],
        )
        for request_id in [
            ids["request_competing_a"],
            ids["request_competing_b"],
        ]
    ]
    results = overlap(db, statements)
    successes = [result for result in results if result.returncode == 0]
    failures = [result for result in results if result.returncode != 0]
    assert len(successes) == 1 and len(failures) == 1, [
        (result.returncode, result.stdout, result.stderr) for result in results
    ]
    assert json_result(successes[0])["action"] == "send"
    assert "contract_send_already_claimed" in failures[0].stderr, failures[0].stderr
    assert claim_count(db, ids["contract_competing"]) == 1
    report["cases"].append(
        {
            "case": "two concurrent different request IDs for one contract",
            "send_claims": 1,
            "conflicts": 1,
        }
    )

    db = PREFIX + "_webhook_duplicate"
    create(db, template)
    ids = fixture(db)
    prepared = json_result(
        query(
            db,
            "SET ROLE service_role; "
            + service_call(
                ids["contract_identical"],
                ids["request_identical"],
                ids["actor_id"],
                ids["organization_id"],
                ids["facility_id"],
            ),
        )
    )
    query(
        db,
        "SET ROLE service_role; SELECT public.commit_boldsign_contract_send("
        f"'{ids['contract_identical']}'::uuid,'{ids['request_identical']}'::uuid,"
        f"'{prepared['request_sha256']}',{prepared['generation']},"
        "'synthetic-webhook-document','{}'::jsonb,clock_timestamp());",
    )
    event_id = "concurrent-webhook-identical"
    payload = '{"event":{"id":"concurrent-webhook-identical","eventType":"Viewed"}}'
    results = overlap(db, [webhook_call(event_id, payload)] * 2)
    actions = sorted(json_result(result)["action"] for result in results)
    assert actions == ["applied", "duplicate"], actions
    assert int(query(
        db,
        "SELECT count(*) FROM public.resident_contract_events "
        f"WHERE provider_environment='test' AND provider_event_id='{event_id}';",
    ).stdout.strip()) == 1
    report["cases"].append(
        {
            "case": "two concurrent identical webhook deliveries",
            "actions": actions,
            "event_receipts": 1,
        }
    )

    db = PREFIX + "_webhook_conflict"
    create(db, template)
    ids = fixture(db)
    prepared = json_result(
        query(
            db,
            "SET ROLE service_role; "
            + service_call(
                ids["contract_identical"],
                ids["request_identical"],
                ids["actor_id"],
                ids["organization_id"],
                ids["facility_id"],
            ),
        )
    )
    query(
        db,
        "SET ROLE service_role; SELECT public.commit_boldsign_contract_send("
        f"'{ids['contract_identical']}'::uuid,'{ids['request_identical']}'::uuid,"
        f"'{prepared['request_sha256']}',{prepared['generation']},"
        "'synthetic-webhook-document','{}'::jsonb,clock_timestamp());",
    )
    event_id = "concurrent-webhook-conflict"
    statements = [
        webhook_call(event_id, '{"event":{"id":"concurrent-webhook-conflict","value":1}}'),
        webhook_call(event_id, '{"event":{"id":"concurrent-webhook-conflict","value":2}}'),
    ]
    results = overlap(db, statements)
    successes = [result for result in results if result.returncode == 0]
    failures = [result for result in results if result.returncode != 0]
    assert len(successes) == 1 and len(failures) == 1
    assert "provider_event_content_conflict" in failures[0].stderr
    assert int(query(
        db,
        "SELECT count(*) FROM public.resident_contract_events "
        f"WHERE provider_environment='test' AND provider_event_id='{event_id}';",
    ).stdout.strip()) == 1
    report["cases"].append(
        {
            "case": "two concurrent conflicting webhook deliveries",
            "accepted": 1,
            "content_conflicts": 1,
            "event_receipts": 1,
        }
    )

    db = PREFIX + "_commit_webhook"
    create(db, template)
    ids = fixture(db)
    prepared = json_result(
        query(
            db,
            "SET ROLE service_role; "
            + service_call(
                ids["contract_identical"],
                ids["request_identical"],
                ids["actor_id"],
                ids["organization_id"],
                ids["facility_id"],
            ),
        )
    )
    commit_sql = (
        "SELECT public.commit_boldsign_contract_send("
        f"'{ids['contract_identical']}'::uuid,'{ids['request_identical']}'::uuid,"
        f"'{prepared['request_sha256']}',{prepared['generation']},"
        "'synthetic-webhook-document','{}'::jsonb,clock_timestamp());"
    )
    webhook_sql = (
        "SELECT public.apply_boldsign_webhook_event("
        "'test','commit-webhook-race','Sent','synthetic-webhook-document',"
        "clock_timestamp(),'{\"event\":{\"id\":\"commit-webhook-race\","
        "\"eventType\":\"Sent\"}}'::jsonb,"
        f"'{prepared['recovery_label']}',NULL,'identical@boldsign.invalid',NULL,true);"
    )
    results = overlap(db, [commit_sql, webhook_sql])
    assert all(result.returncode == 0 for result in results), [
        result.stderr for result in results
    ]
    final_state = json.loads(
        query(
            db,
            f"""SELECT json_build_object(
              'status',status,'provider_document_id',provider_document_id,
              'claim_state',(SELECT state FROM public.resident_contract_send_claims
                WHERE request_id='{ids['request_identical']}'::uuid))
            FROM public.resident_contracts
            WHERE id='{ids['contract_identical']}'::uuid;""",
        ).stdout.strip()
    )
    assert final_state == {
        "status": "sent",
        "provider_document_id": "synthetic-webhook-document",
        "claim_state": "committed",
    }, final_state
    report["cases"].append(
        {
            "case": "provider response commit races matching recovery webhook",
            "successes": 2,
            **final_state,
        }
    )

    db = PREFIX + "_mutation"
    create(db, template)
    ids = fixture(db)
    prepared = json_result(
        query(
            db,
            "SET ROLE service_role; "
            + service_call(
                ids["contract_mutation"],
                ids["request_mutation"],
                ids["actor_id"],
                ids["organization_id"],
                ids["facility_id"],
            ),
        )
    )
    assert prepared["action"] == "send", prepared
    mutator = subprocess.Popen(
        [
            str(BIN / "psql"),
            *CONN,
            "-X",
            "-qAt",
            "-d",
            db,
            "-v",
            "ON_ERROR_STOP=1",
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    children.append(mutator)
    mutator.stdin.write(
        "BEGIN; "
        "UPDATE public.resident_contract_signers "
        "SET signer_name='Changed while provider result was in flight' "
        f"WHERE id='{ids['signer_mutation']}'::uuid; "
        "SELECT 'signer-mutation-held'; SELECT pg_sleep(1); COMMIT;\n"
    )
    mutator.stdin.close()
    assert mutator.stdout.readline().strip() == "signer-mutation-held"
    started = time.monotonic()
    committed = json_result(
        query(
            db,
            "SET ROLE service_role; "
            "SELECT public.commit_boldsign_contract_send("
            f"'{ids['contract_mutation']}'::uuid,"
            f"'{ids['request_mutation']}'::uuid,"
            f"'{prepared['request_sha256']}',"
            f"{prepared['generation']},'synthetic-document',"
            "'{\"documentId\":\"synthetic-document\"}'::jsonb,"
            "timestamptz '2026-09-20 12:00Z');",
        )
    )
    waited_seconds = time.monotonic() - started
    mutator.wait(timeout=10)
    assert mutator.returncode == 0, mutator.stderr.read()
    children.remove(mutator)
    assert waited_seconds >= 0.75, waited_seconds
    assert committed["action"] == "reconcile", committed
    state = json.loads(
        query(
            db,
            f"""SELECT json_build_object(
              'status',status,'provider_document_id',provider_document_id,
              'claim_state',(SELECT state FROM public.resident_contract_send_claims
                WHERE request_id='{ids['request_mutation']}'::uuid))
            FROM public.resident_contracts
            WHERE id='{ids['contract_mutation']}'::uuid;""",
        ).stdout.strip()
    )
    assert state == {
        "status": "draft",
        "provider_document_id": None,
        "claim_state": "reconciliation_required",
    }, state
    report["cases"].append(
        {
            "case": "signer mutation held across provider success commit",
            "waited_seconds": round(waited_seconds, 3),
            "action": committed["action"],
            **state,
        }
    )

    report["verdict"] = "PASS"
    print(json.dumps(report, indent=2))
finally:
    for child in children:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
    for db in reversed(created):
        result = command("dropdb", [db])
        if result.returncode:
            raise RuntimeError(f"Run-owned database retained: {db}: {result.stderr}")
