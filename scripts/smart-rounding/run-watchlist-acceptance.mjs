#!/usr/bin/env node
/**
 * Replay every migration into a throwaway database on the scratch cluster, then
 * run the watchlist acceptance assertions against it and print the
 * result table.
 *
 * Uses the same run-owned native cluster as `npm run migrations:verify:pg`, and
 * refuses anything else. Docker is not used on this machine.
 *
 *   export PG_VERIFY_NATIVE_SOCKET=$(cat /tmp/smart-rounding-pgdir.txt)
 *   export PG_VERIFY_NATIVE_BIN=/opt/homebrew/opt/postgresql@17/bin
 *   export PG_VERIFY_NATIVE_PORT=55439
 *   node scripts/smart-rounding/run-watchlist-acceptance.mjs
 *
 * Pass --keep to leave the replayed database behind for a follow-up query.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const migrationsDir = path.join(root, "supabase", "migrations");
const stub = path.join(root, "scripts", "pg-verify-stub.sql");
const acceptance = path.join(root, "scripts", "smart-rounding", "watchlist-acceptance.sql");
const keep = process.argv.includes("--keep");

const socket = process.env.PG_VERIFY_NATIVE_SOCKET;
const bin = process.env.PG_VERIFY_NATIVE_BIN;
if (!socket || !bin || !path.isAbsolute(bin)) {
  console.error("Set PG_VERIFY_NATIVE_SOCKET and PG_VERIFY_NATIVE_BIN to the run-owned scratch cluster.");
  process.exit(2);
}

// Same ownership gate scripts/pg-verify-migrations.mjs applies: only a cluster
// this run created, never an application socket and never a network database.
const base = path.join(process.env.HOME, ".hermes", "tmp", "agent-runs");
const resolved = fs.realpathSync(socket);
if (!resolved.startsWith(`${fs.realpathSync(base)}${path.sep}`)) {
  console.error("Native replay requires a run-owned scratch cluster");
  process.exit(2);
}

const connection = ["-h", resolved, "-p", process.env.PG_VERIFY_NATIVE_PORT || "55439", "-U", "postgres"];
const database = `haven_watchlist_${process.pid}_${Date.now()}`;
const run = (tool, args, opts = {}) =>
  spawnSync(path.join(bin, tool), args, { encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024, ...opts });

const created = run("createdb", [...connection, database]);
if (created.status !== 0) {
  console.error(created.stderr || "Could not create the replay database");
  process.exit(1);
}

function applyFile(file, quiet = true) {
  const args = [...connection, "-d", database, "-v", "ON_ERROR_STOP=1", "-f", file];
  if (quiet) args.push("-q");
  return run("psql", args);
}

let failed = null;
try {
  const stubResult = applyFile(stub);
  if (stubResult.status !== 0) throw new Error(`stub: ${stubResult.stderr}`);

  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    const result = applyFile(path.join(migrationsDir, name));
    if (result.status !== 0) throw new Error(`${name}: ${result.stderr}`);
  }
  console.log(`[watchlist] replayed ${files.length} migration files`);

  const probe = applyFile(acceptance, false);
  process.stdout.write(probe.stdout ?? "");
  if (probe.status !== 0) {
    process.stderr.write(probe.stderr ?? "");
    throw new Error("acceptance assertions failed");
  }
  console.log("[watchlist] PASS");
} catch (cause) {
  failed = cause;
} finally {
  if (!keep) run("dropdb", [...connection, database]);
  else console.log(`[watchlist] kept database ${database}`);
}

if (failed) {
  console.error(failed.message);
  process.exit(1);
}
