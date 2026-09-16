#!/usr/bin/env node
/**
 * Apply all SQL migrations in order to a throwaway Postgres 17 container (Docker).
 * Matches supabase/config.toml major_version = 17.
 * Catches DDL errors and most dependency issues; uses auth.* stubs (not a full Supabase clone).
 *
 * SKIP: set SKIP_PG_VERIFY=1
 * REQUIRE: set REQUIRE_PG_VERIFY=1 to fail when Docker is unavailable (recommended in CI with Docker).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const migrationsDir = process.env.MIGRATIONS_DIR
  ? path.resolve(process.env.MIGRATIONS_DIR)
  : path.join(root, "supabase", "migrations");

const skip = process.env.SKIP_PG_VERIFY === "1";
const requireDocker = process.env.REQUIRE_PG_VERIFY === "1";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function docker(args, opts = {}) {
  return spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}

function orderedMigrationFiles() {
  // Match ordinary filename ordering; new migrations continue the legacy
  // numbered chain after316 rather than interleaving timestamps with it.
  return fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
}

/**
 * 07A level-engine parity (TS fixture vs public.care_event_derive) against the
 * freshly replayed database. Runs after every migration file and before the
 * SQL probes so a TS/SQL drift fails the replay, not a later audit. `env`
 * selects the script's transport: CARE_EVENT_PARITY_DB_URL for the native
 * cluster, CARE_EVENT_PARITY_DOCKER_CONTAINER + _DB for the Docker container.
 * Returns the failure text, or null when the script passed.
 */
function runLevelParity(env) {
  const script = path.join(root, "scripts", "care-events", "verify-level-parity.mjs");
  if (!fs.existsSync(script)) return null;
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status === 0) return null;
  return result.stderr || result.stdout || result.error?.message || `exited ${result.status}`;
}

function nativeVerification(socket) {
  // Only use the explicitly identified run-owned temporary cluster. Never
  // accept a normal application socket or a network database URL here.
  const base = path.join(process.env.HOME, ".hermes", "tmp", "agent-runs");
  const resolved = fs.realpathSync(socket);
  if (!resolved.startsWith(`${fs.realpathSync(base)}${path.sep}`)) throw new Error("Native replay requires a run-owned scratch cluster");
  const manifest = JSON.parse(fs.readFileSync(path.join(resolved, "manifest.json"), "utf8"));
  if (manifest.created_by !== "codex" || manifest.run_id !== path.basename(resolved)) throw new Error("Native replay ownership manifest does not match");
  const bin = process.env.PG_VERIFY_NATIVE_BIN;
  if (!bin || !path.isAbsolute(bin)) throw new Error("PG_VERIFY_NATIVE_BIN must identify installed PostgreSQL binaries");
  const connection = ["-h", resolved, "-p", process.env.PG_VERIFY_NATIVE_PORT || "55439", "-U", "postgres"];
  const database = `haven_verify_${process.pid}_${Date.now()}`;
  const run = (tool, args, opts = {}) => spawnSync(path.join(bin, tool), args, { encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024, ...opts });
  const create = run("createdb", [...connection, database]);
  if (create.status !== 0) throw new Error(create.stderr || create.error?.message || "Could not create isolated replay database");
  try {
    const files = orderedMigrationFiles();
    const tests = fs.readdirSync(path.join(root, "supabase", "tests"))
      .filter((name) => /^review_.*\.sql$/.test(name) || ["rpc_grant_posture.sql", "family_portal_messages_one_way.sql", "team_space_rls_no_recursion.sql"].includes(name)).sort();
    const applyFile = (file) => {
      const result = run("psql", [...connection, "-d", database, "-v", "ON_ERROR_STOP=1", "-f", file]);
      if (result.status !== 0) throw new Error(`${path.basename(file)}: ${result.stderr || result.error?.message || "SQL failed"}`);
    };
    for (const file of [path.join(root, "scripts", "pg-verify-stub.sql"), ...files.map((file) => path.join(migrationsDir, file))]) applyFile(file);
    // Level-engine parity against the replayed cluster over its socket, before the probes.
    const parityFailure = runLevelParity({
      CARE_EVENT_PARITY_DB_URL: `postgresql://postgres@/${database}?host=${encodeURIComponent(resolved)}&port=${process.env.PG_VERIFY_NATIVE_PORT || "55439"}`,
      CARE_EVENT_PARITY_PSQL: path.join(bin, "psql"),
    });
    if (parityFailure) throw new Error(`care-events level parity: ${parityFailure}`);
    for (const file of tests.map((file) => path.join(root, "supabase", "tests", file))) applyFile(file);
    console.log(`[migrations:verify:pg] PASS (${files.length} migration files, ${tests.length} SQL probes, level parity; native PostgreSQL with Supabase stubs)`);
  } finally {
    const dropped = run("dropdb", [...connection, database]);
    if (dropped.status !== 0) throw new Error(`Run-owned replay database retained: ${database}. ${dropped.stderr}`);
  }
}

async function main() {
  if (skip) {
    if (process.env.REQUIRE_PG_VERIFY === "1") {
      console.error("[migrations:verify:pg] FAIL: REQUIRE_PG_VERIFY=1 conflicts with SKIP_PG_VERIFY=1");
      process.exit(1);
    }
    console.log("[migrations:verify:pg] SKIP: SKIP_PG_VERIFY=1");
    process.exit(0);
  }

  if (process.env.PG_VERIFY_NATIVE_SOCKET) { nativeVerification(process.env.PG_VERIFY_NATIVE_SOCKET); return; }

  const info = docker(["info"], { stdio: "pipe", timeout: 10000 });
  if (info.status !== 0) {
    if (requireDocker) {
      console.error("[migrations:verify:pg] FAIL: Docker required but not available");
      process.exit(1);
    }
    console.log("[migrations:verify:pg] SKIP: Docker not available (set REQUIRE_PG_VERIFY=1 in CI with Docker)");
    process.exit(0);
  }

  const name = `haven-pg-verify-${Date.now()}`;
  const database = `haven_verify_${process.pid}_${Date.now()}`;
  const stubPath = path.join(root, "scripts", "pg-verify-stub.sql");

  let up = docker(
    [
      "run",
      "-d",
      "--name",
      name,
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      `POSTGRES_DB=${database}`,
      // pgvector required for migration 126 (Knowledge Base embeddings)
      "pgvector/pgvector:pg17",
    ],
    { stdio: "pipe" },
  );
  if (up.status !== 0) {
    console.error("[migrations:verify:pg] FAIL: docker run\n", up.stderr);
    process.exit(1);
  }

  const cleanup = () => {
    docker(["rm", "-f", name], { stdio: "pipe" });
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  try {
    let ready = false;
    for (let i = 0; i < 90; i++) {
      const r = docker(
        ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", database],
        { stdio: "pipe" },
      );
      if (r.status === 0) {
        ready = true;
        break;
      }
      await sleep(500);
    }
    if (!ready) {
      const logs = docker(["logs", name], { stdio: "pipe" });
      console.error("[migrations:verify:pg] FAIL: Postgres did not become ready\n", logs.stdout || logs.stderr);
      cleanup();
      process.exit(1);
    }

    const psqlBase = [
      "exec",
      "-i",
      name,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
    ];

    const runFile = (label, absPath) => {
      const sql = fs.readFileSync(absPath, "utf8");
      const r = docker(psqlBase, {
        input: sql,
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (r.status !== 0) {
        const logs = docker(["logs", name], { stdio: "pipe" });
        console.error(`[migrations:verify:pg] FAIL at ${label}\n`, r.stderr || r.stdout);
        if (logs.stdout || logs.stderr) {
          console.error("[migrations:verify:pg] container logs:\n", logs.stdout || logs.stderr);
        }
        cleanup();
        process.exit(1);
      }
    };

    runFile("stub", stubPath);

    const files = orderedMigrationFiles();
    for (const f of files) {
      runFile(f, path.join(migrationsDir, f));
    }

    // Level-engine parity (07A) against the replayed container, before the probes.
    const parityFailure = runLevelParity({
      CARE_EVENT_PARITY_DOCKER_CONTAINER: name,
      CARE_EVENT_PARITY_DOCKER_DB: database,
    });
    if (parityFailure) {
      console.error(`[migrations:verify:pg] FAIL at care-events level parity\n`, parityFailure);
      cleanup();
      process.exit(1);
    }

    const rpcGrantPosturePath = path.join(root, "supabase", "tests", "rpc_grant_posture.sql");
    if (fs.existsSync(rpcGrantPosturePath)) {
      runFile("rpc_grant_posture", rpcGrantPosturePath);
    }

    const familyOneWayPath = path.join(root, "supabase", "tests", "family_portal_messages_one_way.sql");
    if (fs.existsSync(familyOneWayPath)) {
      runFile("family_portal_messages_one_way", familyOneWayPath);
    }

    const teamSpaceRlsPath = path.join(root, "supabase", "tests", "team_space_rls_no_recursion.sql");
    if (fs.existsSync(teamSpaceRlsPath)) {
      runFile("team_space_rls_no_recursion", teamSpaceRlsPath);
    }

    for (const file of fs.readdirSync(path.join(root, "supabase", "tests")).filter((file) => /^review_.*\.sql$/.test(file)).sort()) {
      runFile(file, path.join(root, "supabase", "tests", file));
    }

    console.log(`[migrations:verify:pg] PASS (${files.length} migration file(s), level parity)`);
  } finally {
    cleanup();
  }
}

await main();
