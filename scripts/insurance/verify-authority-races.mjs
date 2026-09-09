#!/usr/bin/env node
/** Real PostgreSQL concurrency regressions, restricted to a validated run-owned socket. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nonce = randomUUID().slice(0, 8);
const runId = `${Date.now()}-${process.pid}-${nonce}`;
const database = `insurance_authority_${process.pid}_${Date.now()}_${nonce}`;
const resultPath = path.join(repo, "test-results/insurance/authority-races", `${runId}.json`);
const children = new Set();
const started = Date.now();
const deadline = started + 180_000;
let interrupted = false;
let config;
let created = false;
const result = {
  schema_version: 1,
  run_id: runId,
  started_at: new Date(started).toISOString(),
  fixture_only: true,
  scope: "Real concurrent PostgreSQL authorization with repository Supabase stubs; no hosted access, provider, upload, or clinical acceptance claim.",
  database,
  passed: false,
  migrations: [],
  checks: [],
  cleanup: { database_created: false, database_dropped: false },
};

// Never inherit a service file, PGHOSTADDR, password, or another project's
// connection settings. Every child uses the validated Unix socket explicitly.
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG")));
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const jsonLiteral = (value) => `${literal(JSON.stringify(value))}::jsonb`;
const digest = (data) => createHash("sha256").update(data).digest("hex");

function checkDeadline() {
  if (interrupted) throw new Error("Regression interrupted; cleaning its scratch database");
  if (Date.now() > deadline) throw new Error("Regression exceeded its three-minute wall-clock budget");
}
function start(tool, args, { input, appName, timeoutMs = 30_000, cleanup = false } = {}) {
  if (!cleanup) checkDeadline();
  const child = spawn(path.join(config.bin, tool), args, {
    env: { ...childEnv, ...(appName ? { PGAPPNAME: appName } : {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  let stdout = "";
  let stderr = "";
  let finished = false;
  let timedOut = false;
  let settled = false;
  const permittedTimeout = cleanup ? timeoutMs : Math.min(timeoutMs, Math.max(1, deadline - Date.now()));
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, permittedTimeout);
  const done = new Promise((resolve) => {
    const finish = (code, signal, error) => {
      if (settled) return;
      settled = true;
      finished = true;
      clearTimeout(timer);
      children.delete(child);
      resolve({ code, signal, stdout, stderr, timedOut, error });
    };
    child.on("error", (error) => finish(null, null, error.message));
    child.on("close", (code, signal) => finish(code, signal));
  });
  child.stdout.on("data", (data) => {
    stdout += data.toString();
    if (stdout.length > 2 * 1024 * 1024) child.kill("SIGKILL");
  });
  child.stderr.on("data", (data) => {
    stderr += data.toString();
    if (stderr.length > 2 * 1024 * 1024) child.kill("SIGKILL");
  });
  child.stdin.on("error", () => { /* The exit result reports early psql failures. */ });
  if (input !== undefined) child.stdin.end(input);
  return {
    child, done,
    get finished() { return finished; },
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    send(text) { if (!finished) child.stdin.write(text); },
  };
}
function connection(db = database) {
  return ["-h", config.socket, "-p", config.port, "-U", "postgres", "-d", db];
}
function psqlArgs(db = database) {
  return ["-X", "-w", "-qAt", ...connection(db), "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
}
async function execute(tool, args, options) {
  const outcome = await start(tool, args, options).done;
  if (outcome.code !== 0 || outcome.timedOut || outcome.error) {
    // No connection credentials or fixture claims are printed or retained.
    const firstError = outcome.stderr.split("\n").find((line) => /ERROR:|error:|FATAL:/.test(line));
    throw new Error(`${tool} failed${outcome.timedOut ? " (timeout)" : ""}: ${firstError || outcome.error || outcome.signal || outcome.code}`);
  }
  return outcome.stdout.trim();
}
async function sql(query, { db = database, timeoutMs = 15_000, cleanup = false } = {}) {
  return execute("psql", psqlArgs(db), {
    input: `SET statement_timeout='10s'; SET lock_timeout='5s';\n${query}`,
    timeoutMs,
    cleanup,
  });
}
async function validateConfiguration() {
  assert(process.env.PG_VERIFY_NATIVE_SOCKET, "PG_VERIFY_NATIVE_SOCKET is required; no URL/host fallback exists");
  const base = await fs.realpath(path.join(os.homedir(), ".hermes/tmp/agent-runs"));
  const socket = await fs.realpath(process.env.PG_VERIFY_NATIVE_SOCKET);
  assert(socket.startsWith(`${base}${path.sep}`), "Native socket must be beneath the agent-runs root");
  const manifestFile = path.join(socket, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  assert(manifest.created_by === "codex" && manifest.run_id === path.basename(socket), "Run ownership manifest does not match");
  const bin = process.env.PG_VERIFY_NATIVE_BIN;
  assert(bin && path.isAbsolute(bin), "PG_VERIFY_NATIVE_BIN must identify installed PostgreSQL binaries");
  const port = process.env.PG_VERIFY_NATIVE_PORT || "55439";
  assert(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535, "Invalid local PostgreSQL port");
  assert((await fs.stat(path.join(socket, `.s.PGSQL.${port}`))).isSocket(), "Expected run-owned Unix socket was not found");
  for (const tool of ["psql", "createdb", "dropdb"]) await fs.access(path.join(bin, tool));
  config = { socket, bin, port };
  const transport = JSON.parse(await sql("SELECT json_build_object('database',current_database(),'server_address',inet_server_addr(),'version',version());", { db: "postgres" }));
  assert(transport.database === "postgres" && transport.server_address === null, "Refusing a network or unexpected bootstrap connection");
  result.postgres_version = transport.version;
  result.native_run_id = manifest.run_id;
  result.manifest_sha256 = digest(await fs.readFile(manifestFile));
}
async function waitUntilBlocked(appName, contender, timeoutMs = 8_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    checkDeadline();
    if (contender.finished) throw new Error("Contender finished before reaching its expected domain lock");
    const state = await sql(`SELECT coalesce(json_agg(json_build_object('wait_event',wait_event,'wait_event_type',wait_event_type)),'[]'::json) FROM pg_stat_activity WHERE datname=${literal(database)} AND application_name=${literal(appName)} AND wait_event_type='Lock';`);
    const rows = JSON.parse(state);
    if (rows.length === 1) return rows[0];
    await delay(25);
  }
  throw new Error("Contender did not reach the expected lock within eight seconds");
}
async function waitForMarker(session) {
  const until = Date.now() + 8_000;
  while (!session.stdout.includes("LOCK_HELD")) {
    if (session.finished || Date.now() > until) throw new Error("Could not acquire regression blocker lock");
    checkDeadline();
    await delay(20);
  }
}
async function release(session, commit) {
  if (!session) return;
  if (!session.finished) session.send(`${commit ? "COMMIT" : "ROLLBACK"};\n\\q\n`);
  const outcome = await session.done;
  if (commit && outcome.code !== 0) throw new Error("Blocker did not commit/release successfully");
}
async function runRace({ name, hold, request, revoke, expectedState, expectedMessage, inspect }) {
  const begin = Date.now();
  const appName = `insurance_race_${nonce}_${result.checks.length}`;
  const check = { name, passed: false, blocked_observed: false };
  result.checks.push(check);
  let blocker;
  let contender;
  try {
    blocker = start("psql", psqlArgs(), { timeoutMs: 30_000 });
    blocker.send(`SET statement_timeout='20s'; SET idle_in_transaction_session_timeout='25s'; BEGIN; ${hold}; SELECT 'LOCK_HELD';\n`);
    await waitForMarker(blocker);
    contender = start("psql", psqlArgs(), {
      input: `SET statement_timeout='20s'; SET lock_timeout='15s';\n${request}`,
      appName,
      timeoutMs: 25_000,
    });
    const blocked = await waitUntilBlocked(appName, contender);
    check.blocked_observed = true;
    check.wait_event = blocked.wait_event;
    if (revoke) {
      await sql(revoke);
      check.revocation_committed_before_release = true;
    }
    await release(blocker, true);
    check.blocker_released = true;
    if (!revoke) check.assignee_disable_committed_after_wait = true;
    const outcome = await contender.done;
    const state = /ERROR:\s+([A-Z0-9]{5}):/.exec(outcome.stderr)?.[1];
    check.sqlstate = state || null;
    check.expected_sqlstate = expectedState;
    assert(outcome.code !== 0 && !outcome.timedOut, "Contender must fail at the authorization/qualification fence, not time out");
    assert(state === expectedState && outcome.stderr.includes(expectedMessage), "Contender failed for an unexpected reason");
    const mutationState = JSON.parse(await sql(inspect));
    check.mutation_state = mutationState;
    assert(Object.values(mutationState).every((value) => value === 0), "Forbidden mutation persisted after concurrent revocation");
    check.passed = true;
    console.log(`[insurance:authority-races] PASS ${name}`);
  } catch (error) {
    check.error = error.message;
    throw error;
  } finally {
    await release(blocker, false).catch(() => {});
    if (contender && !contender.finished) contender.child.kill("SIGKILL");
    if (contender) await contender.done;
    check.elapsed_ms = Date.now() - begin;
  }
}
async function actorRequest(fixture, rpc, action, payload) {
  const claimVersion = Number(await sql(`SELECT auth_claim_version FROM public.user_profiles WHERE id=${literal(fixture.actor_id)};`));
  const claims = { role: "authenticated", sub: fixture.actor_id, session_id: fixture.actor_session_id, auth_claim_version: claimVersion };
  return `BEGIN; SET LOCAL request.jwt.claims=${literal(JSON.stringify(claims))}; SET LOCAL ROLE authenticated; SELECT public.${rpc}(${literal(action)},${jsonLiteral(payload)}); COMMIT;`;
}
function servicingPayload(fixture, id, ownerId) {
  return {
    id, kind: "claim_matter", title: "Synthetic concurrent authority check",
    entity_id: fixture.entity_id, facility_id: null, policy_id: null,
    document_id: null, owner_id: ownerId, due_date: null,
    payload: { incident_id: null, carrier_reference: null, loss_date: "2026-02-01", reported_date: null, recipient: null, acknowledgment: null, next_action: "Synthetic review", description: "Synthetic fixture only" },
  };
}
async function main() {
  try {
    result.runner_sha256 = digest(await fs.readFile(fileURLToPath(import.meta.url)));
    await validateConfiguration();
    assert(/^insurance_authority_[a-z0-9_]+$/.test(database) && database.length < 63);
    await execute("createdb", ["-w", "-h", config.socket, "-p", config.port, "-U", "postgres", database]);
    created = true;
    result.cleanup.database_created = true;
    const migrations = (await fs.readdir(path.join(repo, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
    const inputs = ["scripts/pg-verify-stub.sql", ...migrations.map((name) => `supabase/migrations/${name}`), "scripts/insurance/fixtures/authority-races.sql"];
    for (const file of inputs) {
      const body = await fs.readFile(path.join(repo, file));
      await execute("psql", [...psqlArgs(), "-f", path.join(repo, file)]);
      result.migrations.push({ file, sha256: digest(body) });
    }
    const fixture = JSON.parse(await sql("SELECT row_to_json(f) FROM insurance_race_probe.fixture f;"));
    const restore = async () => sql(`UPDATE public.user_profiles SET is_active=true WHERE id IN(${literal(fixture.actor_id)},${literal(fixture.assignee_id)});`);
    const revoke = `UPDATE public.user_profiles SET is_active=false WHERE id=${literal(fixture.actor_id)};`;

    const servicingId = randomUUID();
    await runRace({
      name: "servicing_org_lock_actor_revocation",
      hold: `SELECT pg_advisory_xact_lock(hashtextextended(${literal(fixture.organization_id)},337))`,
      request: await actorRequest(fixture, "insurance_servicing", "save", servicingPayload(fixture, servicingId, null)),
      revoke, expectedState: "28000", expectedMessage: "Authentication required after waiting",
      inspect: `SELECT json_build_object('records',count(*)) FROM public.insurance_servicing_records WHERE id=${literal(servicingId)};`,
    });
    await restore();

    const draftId = randomUUID();
    const policy = {
      entity_id: fixture.entity_id, policy_type: "general_liability", carrier_name: "Synthetic race carrier", policy_number: draftId,
      effective_date: "2026-01-01", expiration_date: "2026-12-31", premium_cents: null, aggregate_limit_cents: null, occurrence_limit_cents: null, deductible_cents: null,
      shared_limit: false, parties: [{ entity_id: fixture.entity_id, role: "primary_named_insured", effective_from: "2026-01-01", effective_to: null }], facilities: [],
    };
    const evidence = Object.fromEntries(["entity_id", "policy_type", "carrier_name", "policy_number", "effective_date", "expiration_date", "shared_limit", "parties.0"].map((field) => [field, { source: "manual", reason: "Synthetic concurrency regression" }]));
    await sql(await actorRequest(fixture, "insurance_workspace", "save_draft", { id: draftId, kind: "new_policy", payload: policy, evidence }));
    await runRace({
      name: "core_approval_row_lock_actor_revocation",
      hold: `SELECT id FROM public.insurance_drafts WHERE id=${literal(draftId)} FOR UPDATE`,
      request: await actorRequest(fixture, "insurance_workspace", "approve_draft", { id: draftId, revision: 1, confirm_evidence: true }),
      revoke, expectedState: "28000", expectedMessage: "Authentication required after waiting",
      inspect: `SELECT json_build_object('policies',(SELECT count(*) FROM public.insurance_policies WHERE policy_number=${literal(draftId)}),'approved_drafts',(SELECT count(*) FROM public.insurance_drafts WHERE id=${literal(draftId)} AND status='approved'));`,
    });
    await restore();

    await runRace({
      name: "trusted_processing_row_lock_actor_revocation",
      hold: `SELECT id FROM public.insurance_documents WHERE id=${literal(fixture.document_id)} FOR UPDATE`,
      request: `BEGIN; SET LOCAL ROLE service_role; SELECT public.insurance_processing('start_extraction',${jsonLiteral({ document_id: fixture.document_id, actor_id: fixture.actor_id, organization_id: fixture.organization_id, run_id: randomUUID() })}); COMMIT;`,
      revoke, expectedState: "42501", expectedMessage: "Current insurance manager required after waiting",
      inspect: `SELECT json_build_object('changed_documents',count(*)) FROM public.insurance_documents WHERE id=${literal(fixture.document_id)} AND (extraction_status<>'pending' OR run_id IS NOT NULL);`,
    });
    await restore();

    const assignmentId = randomUUID();
    await runRace({
      name: "new_assignee_disable_during_scope_lock",
      hold: `UPDATE public.user_profiles SET is_active=false WHERE id=${literal(fixture.assignee_id)}`,
      request: await actorRequest(fixture, "insurance_servicing", "save", servicingPayload(fixture, assignmentId, fixture.assignee_id)),
      expectedState: "22023", expectedMessage: "Invalid work owner",
      inspect: `SELECT json_build_object('records',count(*)) FROM public.insurance_servicing_records WHERE id=${literal(assignmentId)};`,
    });
    result.passed = result.checks.length === 4 && result.checks.every((check) => check.passed);
  } catch (error) {
    result.error = error.message;
    process.exitCode = 1;
  } finally {
    for (const child of children) child.kill("SIGKILL");
    if (created) {
      try {
        await execute("dropdb", ["-w", "--force", "-h", config.socket, "-p", config.port, "-U", "postgres", database], { cleanup: true });
        result.cleanup.database_dropped = true;
      } catch (error) {
        result.cleanup.error = error.message;
        result.passed = false;
        process.exitCode = 1;
      }
    }
    result.finished_at = new Date().toISOString();
    result.elapsed_ms = Date.now() - started;
    await fs.mkdir(path.dirname(resultPath), { recursive: true });
    await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    console.log(`[insurance:authority-races] ${result.passed ? "PASS" : "FAIL"} — ${path.relative(repo, resultPath)}`);
    if (result.error) console.error(result.error);
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  interrupted = true;
  for (const child of children) child.kill("SIGKILL");
});
await main();
