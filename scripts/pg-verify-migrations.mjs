#!/usr/bin/env node
/**
 * Apply all SQL migrations in order to a throwaway Postgres 16 container (Docker).
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

async function main() {
  if (skip) {
    if (process.env.REQUIRE_PG_VERIFY === "1") {
      console.error("[migrations:verify:pg] FAIL: REQUIRE_PG_VERIFY=1 conflicts with SKIP_PG_VERIFY=1");
      process.exit(1);
    }
    console.log("[migrations:verify:pg] SKIP: SKIP_PG_VERIFY=1");
    process.exit(0);
  }

  const info = docker(["info"], { stdio: "pipe" });
  if (info.status !== 0) {
    if (requireDocker) {
      console.error("[migrations:verify:pg] FAIL: Docker required but not available");
      process.exit(1);
    }
    console.log("[migrations:verify:pg] SKIP: Docker not available (set REQUIRE_PG_VERIFY=1 in CI with Docker)");
    process.exit(0);
  }

  const name = `haven-pg-verify-${Date.now()}`;
  const stubPath = path.join(root, "scripts", "pg-verify-stub.sql");

  let up = docker(
    [
      "run",
      "-d",
      "--name",
      name,
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "postgres:16-alpine",
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
        ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
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
      "postgres",
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

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of files) {
      runFile(f, path.join(migrationsDir, f));
    }

    console.log(`[migrations:verify:pg] PASS (${files.length} migration file(s))`);
  } finally {
    cleanup();
  }
}

await main();
