/** Synthetic transport -> actual reducer -> actual local PG RPC -> scoped read. No remote DB. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createReceiverStore,
  runSyntheticReceiver,
  type ReceiverServiceRpcClient,
} from "../../src/lib/insurance/insureflow/server";
import { createSyntheticFeedTransport } from "../../src/lib/insurance/insureflow/transport";
import fixtures from "../../src/lib/insurance/insureflow/synthetic-fixtures.json";

async function main() {
  const repo = process.cwd();
  const socket = fs.realpathSync(process.env.PG_VERIFY_NATIVE_SOCKET!);
  const runBase = fs.realpathSync(
    path.join(process.env.HOME!, ".hermes/tmp/agent-runs"),
  );
  assert(socket.startsWith(runBase + path.sep));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(socket, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.created_by, "codex");
  assert.equal(manifest.run_id, path.basename(socket));
  assert.equal(process.env.NODE_ENV, "test");
  const bin = process.env.PG_VERIFY_NATIVE_BIN!;
  assert(path.isAbsolute(bin));
  const db = `insureflow_receiver_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const connection = [
    "-h",
    socket,
    "-p",
    process.env.PG_VERIFY_NATIVE_PORT || "55439",
    "-U",
    "postgres",
  ];
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("PG")),
  );
  const result: Record<string, unknown> = {
    synthetic_only: true,
    scope:
      "Actual local PostgreSQL with Supabase auth stubs and injected provider responses; no hosted or live-provider acceptance",
    started_at: new Date().toISOString(),
    passed: false,
    checks: [],
  };
  const checks = result.checks as string[];
  const evidence = path.join(
    repo,
    "test-results/insurance/insureflow",
    `${Date.now()}-local-integration.json`,
  );
  const literal = (v: string) => "'" + v.replaceAll("'", "''") + "'";
  function run(tool: string, args: string[], input?: string) {
    const r = spawnSync(path.join(bin, tool), args, {
      input,
      encoding: "utf8",
      env,
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0)
      throw new Error(r.stderr || r.error?.message || `${tool} failed`);
    return r.stdout.trim();
  }
  function sql(input: string) {
    return run(
      "psql",
      [...connection, "-d", db, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
      input,
    );
  }
  function rpc(action: string, payload: unknown) {
    return JSON.parse(
      sql(
        `set role service_role; select public.insureflow_receiver_service(${literal(action)},${literal(JSON.stringify(payload))}::jsonb);`,
      ),
    );
  }
  let created = false;
  try {
    run("createdb", [...connection, db]);
    created = true;
    const migrations = fs
      .readdirSync(path.join(repo, "supabase/migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort();
    result.migrations = migrations.map((name) => ({
      name,
      sha256: createHash("sha256")
        .update(fs.readFileSync(path.join(repo, "supabase/migrations", name)))
        .digest("hex"),
    }));
    for (const file of [
      "scripts/pg-verify-stub.sql",
      ...migrations.map((n) => `supabase/migrations/${n}`),
      "scripts/insurance/fixtures/insureflow-receiver.sql",
    ]) {
      run("psql", [
        ...connection,
        "-d",
        db,
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        path.join(repo, file),
      ]);
    }
    // Fixture and source use only fabricated IDs; actor/session provenance is local.
    const fixture = JSON.parse(
      sql("select row_to_json(f) from haven.insureflow_receiver_fixture f;"),
    );
    const id = randomUUID();
    const payload = {
      id,
      organization_id: fixture.organization_id,
      actor_id: fixture.actor_id,
      name: "Synthetic receiver integration",
      provider_instance: "synthetic:integration",
      source_integration_id:
        fixtures.synthetic_crosswalk_example.source_integration_id,
      ttl_seconds: 300,
      enabled: false,
      mappings: [
        {
          account_id: fixtures.synthetic_crosswalk_example.source_account_id,
          entity_id: fixture.entity_id,
          approved: true,
        },
      ],
    };
    let c = rpc("create", payload);
    c = rpc("configure", {
      connection_id: id,
      organization_id: fixture.organization_id,
      actor_id: fixture.actor_id,
      expected_revision: c.revision,
      enabled: true,
      ttl_seconds: 300,
      mappings: payload.mappings,
    });
    const client: ReceiverServiceRpcClient = {
      rpc: async (_name, args) => {
        try {
          return { data: rpc(args.p_action, args.p_payload), error: null };
        } catch (error) {
          return { data: null, error: { message: String(error) } };
        }
      },
    };
    const store = createReceiverStore(client);
    const transport = (responses: unknown[]) =>
      createSyntheticFeedTransport({
        mode: "synthetic",
        origin: "https://insureflow.synthetic.invalid",
        integrationId: payload.source_integration_id,
        token: "hvn_" + "0".repeat(64),
        fetch: async () => {
          assert(responses.length, "Unexpected extra poll");
          return new Response(JSON.stringify(responses.shift()), {
            headers: { "Content-Type": "application/json" },
          });
        },
      });
    const execute = (responses: unknown[], maxPages = 1) =>
      runSyntheticReceiver({
        mode: "synthetic",
        connectionId: id,
        organizationId: fixture.organization_id,
        providerInstance: payload.provider_instance,
        store,
        transport: transport(responses),
        maxPages,
      });
    const read = () =>
      JSON.parse(
        sql(
          `set role authenticated; select set_config('request.jwt.claims',${literal(JSON.stringify(fixture.claims))},false); select public.insureflow_receiver_read('list','{}');`,
        )
          .split("\n")
          .at(-1)!,
      );
    const initial = structuredClone(fixtures.scenarios[0].response);
    initial.data.events[0].id =
      fixtures.fault_injection_cases[0].initial_receiver_state.current_authorized_releases[0].release_id;
    initial.data.events[0].sequence = "4";
    initial.data.next_cursor = "4";
    initial.data.current_authorized_releases = structuredClone(
      fixtures.fault_injection_cases[0].initial_receiver_state
        .current_authorized_releases,
    );
    assert.equal((await execute([initial])).pagesCommitted, 1);
    assert.equal(read().connections[0].summaries.length, 1);
    checks.push(
      "initial exact approved summary visible through authenticated database projection",
    );
    assert.equal(
      (await execute([fixtures.fault_injection_cases[0].response]))
        .pagesCommitted,
      1,
    );
    const view = read().connections[0];
    assert.equal(view.summaries.length, 1);
    assert.equal(
      view.summaries[0].source_policy_id,
      fixtures.fault_injection_cases[0].expected_outcome.visible_policy_ids[0],
    );
    const stored = JSON.parse(
      sql(
        `select state from public.insureflow_receiver_connections where id=${literal(id)};`,
      ),
    );
    assert.equal(stored.cursor, "7");
    assert.equal(stored.health, "degraded");
    assert(!JSON.stringify(stored).includes("2026-02-30"));
    assert.equal(
      Object.keys(stored.recovery).filter(
        (k) => stored.recovery[k].status !== "resolved",
      ).length,
      1,
    );
    checks.push(
      "mixed validity atomically advances cursor, withdraws prior summary, publishes unrelated valid summary and quarantines malformed body with durable recovery",
    );
    // Invalid controls during replay must leave authoritative state unchanged (failure metadata is separate).
    const before = sql(
      `select state from public.insureflow_receiver_connections where id=${literal(id)};`,
    );
    assert.equal(
      (await execute([fixtures.fault_injection_cases[1].response])).status,
      "failed",
    );
    assert.equal(
      sql(
        `select state from public.insureflow_receiver_connections where id=${literal(id)};`,
      ),
      before,
    );
    checks.push(
      "invalid controls leave manifest receipts recovery and cursor byte-equivalent in actual database",
    );
    result.passed = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    if (created) {
      run("dropdb", [...connection, db]);
      result.database_dropped = true;
    }
    result.finished_at = new Date().toISOString();
    fs.mkdirSync(path.dirname(evidence), { recursive: true });
    fs.writeFileSync(evidence, JSON.stringify(result, null, 2) + "\n");
    console.log(
      JSON.stringify({
        passed: result.passed,
        checks,
        evidence,
        error: result.error,
      }),
    );
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Local receiver check failed",
  );
  process.exitCode = 1;
});
