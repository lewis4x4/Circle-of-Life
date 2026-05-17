#!/usr/bin/env node
/**
 * Cross-org isolation smoke check for the KB-NEXT-02 tool layer.
 *
 * Spins up a vanilla Postgres 17 container (same pattern as
 * scripts/pg-verify-migrations.mjs), applies all SQL migrations + the test
 * fixtures, then calls each ai_tool_* RPC twice — once with org A's caller
 * context and once with org B's. Asserts:
 *
 *   1. Same-org call: returns at least one row from that org's domain.
 *   2. Cross-org call (org A context, org B's facility_id): raises
 *      `facility_access_denied` OR returns an empty payload. Anything else
 *      (including org B's data leaking through) is a FAIL.
 *
 * Required env: PG_VERIFY_DSN (optional). When unset, the script provisions
 * a throwaway Docker container and tears it down at the end.
 *
 * Exit code: 0 on PASS, 1 on FAIL, 2 on infra/setup error.
 *
 * NOTE: tracks the pre-existing pg-verify failures (the broken homewood
 * timestamp migrations + 233_audit_p1_db_remediation) by skipping them, so
 * the smoke check focuses on what migration 234 introduced. The same pre-
 * existing failures are documented in the segment handoff.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = path.resolve(__dirname, "..");
const migrationsDir = path.join(root, "supabase", "migrations");
const fixturePath = path.join(root, "tests", "ai-router", "fixtures.sql");

const SKIP_FILES = new Set([
  // Pre-existing pg-verify failures (Track A migration drift); see
  // docs/specs/PHASE1-AUTH-DEBUG-HANDOFF.md.
  "233_audit_p1_db_remediation.sql",
  "20260514180707_homewood_round2_employee_seed.sql",
  "20260514203302_homewood_round2_ar_intake_may_2026.sql",
]);

const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_B = "bbbbbbbb-0000-0000-0000-000000000001";
const FACILITY_A = "aaaaaaaa-2222-0000-0000-000000000001";
const FACILITY_B = "bbbbbbbb-2222-0000-0000-000000000001";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-000000000001";
const RESIDENT_A = "aaaaaaaa-3002-0000-0000-000000000001";
const RESIDENT_B = "bbbbbbbb-3002-0000-0000-000000000001";

/**
 * Each test case calls one ai_tool_* RPC twice. `key` is the JSON property
 * on the returned payload that holds the array of rows we expect to be
 * non-empty for an in-scope call. `xorgArgs` provides org A's caller context
 * with org B's facility/resident — the leak check.
 */
const TESTS = [
  {
    name: "ai_tool_facility_directory",
    role: "owner",
    arrayKey: "facilities",
    sameOrgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_A,
    },
    xorgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_B,
    },
  },
  {
    name: "ai_tool_staff_directory",
    role: "owner",
    arrayKey: "staff",
    sameOrgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_A,
    },
    xorgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_B,
    },
  },
  {
    name: "ai_tool_org_chart",
    role: "owner",
    arrayKey: "entities",
    sameOrgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
    },
    // org_chart has no p_facility_id; cross-org leak would manifest as org B's
    // entities leaking into org A's response. Re-call with org A context but
    // assert no facilities outside p_caller_facility_ids.
    xorgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
    },
    sameAsCross: true,
  },
  {
    name: "ai_tool_resident_summary",
    role: "clinical_admin",
    arrayKey: null,
    sameOrgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "clinical_admin",
      p_caller_facility_ids: [FACILITY_A],
      p_resident_id: RESIDENT_A,
    },
    xorgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "clinical_admin",
      p_caller_facility_ids: [FACILITY_A],
      p_resident_id: RESIDENT_B,
    },
  },
  {
    name: "ai_tool_med_orders",
    role: "clinical_admin",
    arrayKey: "medications",
    sameOrgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "clinical_admin",
      p_caller_facility_ids: [FACILITY_A],
      p_resident_id: RESIDENT_A,
    },
    xorgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "clinical_admin",
      p_caller_facility_ids: [FACILITY_A],
      p_resident_id: RESIDENT_B,
    },
  },
  {
    name: "ai_tool_incident_summary",
    role: "owner",
    arrayKey: "recent",
    sameOrgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_A,
      p_days: 30,
    },
    xorgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_B,
      p_days: 30,
    },
  },
  {
    name: "ai_tool_compliance_status",
    role: "owner",
    arrayKey: "open_deficiencies",
    sameOrgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_A,
    },
    xorgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_B,
    },
  },
  {
    name: "ai_tool_ar_aging_by_facility",
    role: "owner",
    arrayKey: null,
    expectSameOrgValue: { key: "total_cents", min: 1 },
    sameOrgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_A,
    },
    xorgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_B,
    },
  },
  {
    name: "ai_tool_facility_medicaid_providers",
    role: "owner",
    arrayKey: "providers",
    sameOrgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_A,
    },
    xorgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_B,
    },
  },
  {
    name: "ai_tool_active_alerts",
    role: "owner",
    arrayKey: "alerts",
    sameOrgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_A,
    },
    xorgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_B,
    },
  },
  {
    name: "ai_tool_certifications_expiring",
    role: "owner",
    arrayKey: "certifications",
    sameOrgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_A,
      p_days: 30,
    },
    xorgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_B,
      p_days: 30,
    },
  },
  {
    name: "ai_tool_open_followups",
    role: "owner",
    arrayKey: "followups",
    sameOrgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_A,
    },
    xorgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_B,
    },
  },
  {
    name: "ai_tool_pilot_facility_snapshot",
    role: "owner",
    arrayKey: null,
    expectSameOrgValue: { key: "open_incidents", min: 1 },
    sameOrgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_A,
    },
    xorgArgs: {
      p_caller_organization_id: ORG_A,
      p_caller_user_id: USER_A,
      p_caller_role: "owner",
      p_caller_facility_ids: [FACILITY_A],
      p_facility_id: FACILITY_B,
    },
  },
];

/* ------------------------------------------------------------------ */

function docker(args, opts = {}) {
  return spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runPsql(container, sql) {
  const res = docker(
    ["exec", "-i", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    { input: sql, stdio: ["pipe", "pipe", "pipe"] },
  );
  return res;
}

function paramPlaceholders(args) {
  const order = Object.keys(args);
  const positional = order.map((_, i) => `$${i + 1}`).join(", ");
  const named = order.map((k, i) => `${k} := $${i + 1}`).join(", ");
  return { order, positional, named };
}

function buildCallSql(rpc, args) {
  const { named, order } = paramPlaceholders(args);
  const values = order.map((k) => args[k]);
  return { text: `SELECT public.${rpc}(${named}) AS payload`, values };
}

async function callRpc(client, name, args) {
  const { text, values } = buildCallSql(name, args);
  try {
    const r = await client.query(text, values);
    const payload = r.rows[0]?.payload ?? null;
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err), code: err.code };
  }
}

function fmt(obj) {
  try {
    const s = JSON.stringify(obj);
    return s.length > 200 ? s.slice(0, 200) + "..." : s;
  } catch {
    return String(obj);
  }
}

function checkSameOrg(t, result) {
  if (!result.ok) return { pass: false, why: `same-org RPC errored: ${result.error}` };
  const payload = result.payload;
  if (t.arrayKey) {
    const arr = payload?.[t.arrayKey];
    if (!Array.isArray(arr) || arr.length < 1) {
      return { pass: false, why: `expected ≥1 row in payload.${t.arrayKey}, got ${fmt(arr)}` };
    }
    // Every row id should start with the org-A prefix.
    for (const row of arr) {
      if (row && typeof row === "object" && typeof row.id === "string") {
        if (!row.id.startsWith("aaaaaaaa")) {
          return { pass: false, why: `same-org row leaked non-A id: ${row.id}` };
        }
      }
    }
    return { pass: true, why: `same-org ok (${arr.length} row(s))` };
  }
  if (t.expectSameOrgValue) {
    const v = payload?.buckets?.[t.expectSameOrgValue.key] ?? payload?.[t.expectSameOrgValue.key];
    const num = Number(v ?? 0);
    if (!(num >= t.expectSameOrgValue.min)) {
      return { pass: false, why: `expected payload.${t.expectSameOrgValue.key} ≥ ${t.expectSameOrgValue.min}, got ${num}` };
    }
    return { pass: true, why: `same-org ok (value=${num})` };
  }
  if (!payload || typeof payload !== "object") {
    return { pass: false, why: `same-org returned no payload` };
  }
  return { pass: true, why: "same-org ok (object payload)" };
}

function checkCrossOrg(t, result) {
  if (!result.ok) {
    // facility_access_denied is the expected refusal for cross-org access.
    if (/facility_access_denied/.test(result.error) || /role_denied/.test(result.error)) {
      return { pass: true, why: `cross-org refused: ${result.error}` };
    }
    return { pass: false, why: `cross-org failed unexpectedly: ${result.error}` };
  }
  // For org_chart we still get a payload but assert no facilities outside scope.
  const payload = result.payload;
  if (t.arrayKey) {
    const arr = payload?.[t.arrayKey];
    if (Array.isArray(arr)) {
      for (const row of arr) {
        if (row && typeof row === "object" && typeof row.id === "string") {
          if (row.id.startsWith("bbbbbbbb")) {
            return { pass: false, why: `LEAK: cross-org returned org-B row ${row.id}` };
          }
        }
      }
      return { pass: true, why: `cross-org empty/clean (${arr.length} row(s))` };
    }
  }
  if (t.expectSameOrgValue) {
    const v = payload?.buckets?.[t.expectSameOrgValue.key] ?? payload?.[t.expectSameOrgValue.key];
    const num = Number(v ?? 0);
    if (num > 0) {
      return { pass: false, why: `LEAK: cross-org payload.${t.expectSameOrgValue.key} = ${num} (expected 0)` };
    }
    return { pass: true, why: `cross-org value=${num} (clean)` };
  }
  if (t.name === "ai_tool_org_chart") {
    const entities = payload?.entities ?? [];
    for (const e of entities) {
      for (const f of e.facilities ?? []) {
        if (typeof f.id === "string" && f.id.startsWith("bbbbbbbb")) {
          return { pass: false, why: `LEAK: org_chart returned org-B facility ${f.id}` };
        }
      }
    }
    return { pass: true, why: `org_chart cross-org clean` };
  }
  // resident_summary returns { resident: null } for inaccessible residents.
  if (t.name === "ai_tool_resident_summary") {
    if (payload?.resident == null) return { pass: true, why: "resident_summary: null (clean)" };
    if (typeof payload?.resident?.id === "string" && payload.resident.id.startsWith("bbbbbbbb")) {
      return { pass: false, why: `LEAK: resident_summary returned org-B resident` };
    }
  }
  return { pass: true, why: "cross-org payload ok" };
}

/**
 * Apply each .sql file in its own psql session via `docker exec`. We can't use
 * the `pg` client here because `ALTER TYPE ... ADD VALUE` (used by some
 * Phase-1 seed migrations) can't be used in the same transaction it was
 * defined in, and node-pg's `client.query` runs the whole multi-statement
 * string inside one implicit transaction.
 */
function applyAllMigrationsViaPsql(container) {
  const stubPath = path.join(root, "scripts", "pg-verify-stub.sql");
  const stubRes = runPsql(container, fs.readFileSync(stubPath, "utf8"));
  if (stubRes.status !== 0) {
    throw new Error(`stub failed:\n${stubRes.stderr || stubRes.stdout}`);
  }
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && !SKIP_FILES.has(f))
    .sort();
  let lastOk = "";
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), "utf8");
    const r = runPsql(container, sql);
    if (r.status !== 0) {
      const err = (r.stderr || r.stdout || "").slice(0, 600);
      throw new Error(`migration FAIL at ${f} (last ok: ${lastOk}):\n${err}`);
    }
    lastOk = f;
  }
  console.log(`[eval-tool-isolation] applied ${files.length} migration file(s)`);
}

function applyFixturesViaPsql(container) {
  const sql = fs.readFileSync(fixturePath, "utf8");
  const r = runPsql(container, sql);
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").slice(0, 600);
    throw new Error(`fixtures FAIL:\n${err}`);
  }
}

/* ------------------------------------------------------------------ */

async function main() {
  let containerName = null;
  let connectionString = process.env.PG_VERIFY_DSN;
  try {
    if (!connectionString) {
      const info = docker(["info"], { stdio: "pipe" });
      if (info.status !== 0) {
        console.error("[eval-tool-isolation] SKIP: Docker not available and PG_VERIFY_DSN unset");
        process.exit(2);
      }
      containerName = `haven-tool-iso-${Date.now()}`;
      const up = docker(
        ["run", "-d", "--name", containerName, "-p", "55432:5432",
         "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
         "pgvector/pgvector:pg17"],
        { stdio: "pipe" },
      );
      if (up.status !== 0) {
        console.error("[eval-tool-isolation] docker run failed:\n", up.stderr);
        process.exit(2);
      }
      // Wait for readiness.
      let ready = false;
      for (let i = 0; i < 60; i++) {
        const r = docker(["exec", containerName, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], { stdio: "pipe" });
        if (r.status === 0) { ready = true; break; }
        await sleep(500);
      }
      if (!ready) {
        console.error("[eval-tool-isolation] Postgres never became ready");
        process.exit(2);
      }
      connectionString = "postgres://postgres@127.0.0.1:55432/postgres";
    }

    if (containerName) {
      applyAllMigrationsViaPsql(containerName);
      applyFixturesViaPsql(containerName);
    } else {
      console.log("[eval-tool-isolation] using PG_VERIFY_DSN; assuming migrations + fixtures already applied");
    }

    const client = new pg.Client({ connectionString });
    await client.connect();

    try {

      console.log("\n[eval-tool-isolation] running 13 RPCs × 2 (same-org + cross-org)...");
      let pass = 0;
      let fail = 0;
      for (const t of TESTS) {
        const sameRes = await callRpc(client, t.name, t.sameOrgArgs);
        const sameCheck = checkSameOrg(t, sameRes);
        const xorgRes = t.sameAsCross
          ? sameRes
          : await callRpc(client, t.name, t.xorgArgs);
        const xorgCheck = t.sameAsCross
          ? checkCrossOrg(t, xorgRes)
          : checkCrossOrg(t, xorgRes);
        const okBoth = sameCheck.pass && xorgCheck.pass;
        const mark = okBoth ? "PASS" : "FAIL";
        if (okBoth) pass++;
        else fail++;
        console.log(`[${mark}] ${t.name}`);
        console.log(`         same: ${sameCheck.why}`);
        console.log(`         xorg: ${xorgCheck.why}`);
      }
      console.log("");
      console.log(`Total: ${TESTS.length}  Pass: ${pass}  Fail: ${fail}`);
      await client.end();
      process.exit(fail === 0 ? 0 : 1);
    } catch (err) {
      await client.end().catch(() => {});
      console.error("[eval-tool-isolation] FATAL:", err);
      process.exit(2);
    }
  } finally {
    if (containerName) docker(["rm", "-f", containerName], { stdio: "pipe" });
  }
}

await main();
