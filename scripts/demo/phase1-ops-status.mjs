#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

const PROJECT_REF = "manfqmasfqppukpobpld";
const REQUIRED_FUNCTIONS = [
  "export-audit-log",
  "dispatch-push",
  "generate-monthly-invoices",
  "exec-kpi-snapshot",
];

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseMigrationList(stdout) {
  const rows = stdout
    .split("\n")
    .map((line) => line.match(/^\s*(\d{3})\s*\|\s*(\d{3})\s*\|/))
    .filter(Boolean)
    .map((match) => ({
      local: match[1],
      remote: match[2],
    }));

  return {
    rows,
    local_versions: rows.map((row) => row.local),
    remote_versions: rows.map((row) => row.remote),
    aligned: rows.length > 0 && rows.every((row) => row.local === row.remote),
    latest_local: rows.at(-1)?.local ?? null,
    latest_remote: rows.at(-1)?.remote ?? null,
  };
}

function parseFunctionsList(stdout) {
  const rows = stdout
    .split("\n")
    .filter((line) => line.includes("|"))
    .map((line) => line.split("|").map((part) => part.trim()))
    .filter((parts) => parts.length >= 6)
    .filter((parts) => /^[0-9a-f-]{36}$/i.test(parts[0]))
    .map((parts) => ({
      id: parts[0],
      name: parts[1],
      slug: parts[2],
      status: parts[3],
      version: parts[4],
      updated_at: parts[5],
    }));

  const presentSlugs = new Set(rows.map((row) => row.slug));
  return {
    rows,
    required_functions_present: REQUIRED_FUNCTIONS.every((slug) => presentSlugs.has(slug)),
    required_functions_active: REQUIRED_FUNCTIONS.every((slug) =>
      rows.some((row) => row.slug === slug && row.status === "ACTIVE"),
    ),
  };
}

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    return {
      ok: false,
      parse_error: error instanceof Error ? error.message : String(error),
      raw_stdout: stdout,
    };
  }
}

const migrationCommand = runCommand("supabase", ["migration", "list"]);
if (!migrationCommand.ok) {
  console.error(
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        project_ref: PROJECT_REF,
        ok: false,
        failed_step: "migration_list",
        stdout: migrationCommand.stdout,
        stderr: migrationCommand.stderr,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const functionCommand = runCommand("supabase", ["functions", "list", "--project-ref", PROJECT_REF]);
if (!functionCommand.ok) {
  console.error(
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        project_ref: PROJECT_REF,
        ok: false,
        failed_step: "functions_list",
        stdout: functionCommand.stdout,
        stderr: functionCommand.stderr,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const authCommand = runCommand("node", ["scripts/demo/check-auth-diagnostics.mjs"]);
const migrationStatus = parseMigrationList(migrationCommand.stdout);
const functionStatus = parseFunctionsList(functionCommand.stdout);
const authStatus = authCommand.ok
  ? parseJson(authCommand.stdout)
  : {
      ok: false,
      stdout: authCommand.stdout,
      stderr: authCommand.stderr,
    };

const output = {
  checked_at: new Date().toISOString(),
  project_ref: PROJECT_REF,
  migration_status: {
    ok: migrationCommand.ok,
    aligned: migrationStatus.aligned,
    latest_local: migrationStatus.latest_local,
    latest_remote: migrationStatus.latest_remote,
    row_count: migrationStatus.rows.length,
  },
  function_status: {
    ok: functionCommand.ok,
    required_functions_present: functionStatus.required_functions_present,
    required_functions_active: functionStatus.required_functions_active,
    functions: functionStatus.rows,
  },
  auth_status: {
    ok: authCommand.ok,
    settings_ok: authStatus.settings?.ok ?? false,
    pilot_login_ok: authStatus.verdict?.pilot_login_ok ?? false,
    common_error: authStatus.verdict?.common_error ?? null,
  },
  verdict: {
    remote_alignment_ok: migrationStatus.aligned,
    functions_ok: functionStatus.required_functions_present && functionStatus.required_functions_active,
    auth_probe_ok: authStatus.settings?.ok ?? false,
    pilot_login_ok: authStatus.verdict?.pilot_login_ok ?? false,
  },
};

console.log(JSON.stringify(output, null, 2));
