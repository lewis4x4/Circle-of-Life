#!/usr/bin/env node
/**
 * Homewood Lodge ALF — RBAC matrix verifier (Sprint 4 of Homewood Go-Live).
 *
 * Signs in as one canonical account per role (COL-615 model) and fetches each
 * route in scripts/homewood/rbac-matrix.json with that session's cookie. Each cell
 * expects one outcome from the proxy's shell layer:
 *   allow    → 2xx
 *   redirect → 3xx to the named in-app route (the role's own home)
 *   deny     → login / 401 / 403
 *
 * The JSON is generated from src/lib/auth/rbac-matrix.ts and a unit test keeps it
 * equal to the shell-access functions, so a mismatch here means the deployed app
 * differs from the code. docs/homewood/RBAC_MATRIX.md is the readable copy.
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   HOMEWOOD_LAUNCH_PASSWORD (or PHASE1_DEMO_PASSWORD fallback)
 *   BASE_URL — the running app, e.g. http://127.0.0.1:4310
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function requireEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

// Retired 2026-09-16: the hardcoded @circleoflifealf.com personas that used to sit here were fictitious accounts and no longer exist. Supply real accounts via the env var below.
// HOMEWOOD_RBAC_ACCOUNTS is JSON keyed by the COL-615 roles:
// {"owner":"...","facility_admin":"...","med_tech":"...","cook":"...","housekeeper":"...","recruiter":"...","family":"..."}
//
// The matrix is scripts/homewood/rbac-matrix.json (COL-627). It is generated from the
// app's own shell-access functions and src/lib/auth/rbac-matrix.test.ts fails if it
// drifts from them, so this script checks the DEPLOYED app against the code.
const MATRIX_FILE = JSON.parse(readFileSync(path.join(ROOT, "scripts", "homewood", "rbac-matrix.json"), "utf8"));
const RBAC_ROLES = MATRIX_FILE.roles;
const MATRIX = Object.entries(MATRIX_FILE.matrix).map(([route, cells]) => ({ route, expectations: cells }));

function readCanonicalAccounts() {
  const raw = process.env.HOMEWOOD_RBAC_ACCOUNTS;
  if (!raw) {
    console.error("[rbac] HOMEWOOD_RBAC_ACCOUNTS is required.");
    console.error(`[rbac] Provide JSON mapping each of ${RBAC_ROLES.join(", ")} to a real account email.`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`[rbac] HOMEWOOD_RBAC_ACCOUNTS is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const missing = RBAC_ROLES.filter((role) => !parsed[role]);
  if (missing.length > 0) {
    console.error(`[rbac] HOMEWOOD_RBAC_ACCOUNTS is missing: ${missing.join(", ")}`);
    process.exit(2);
  }
  return Object.fromEntries(RBAC_ROLES.map((role) => [role, parsed[role]]));
}

const CANONICAL_ACCOUNTS = readCanonicalAccounts();

/** allow (2xx), redirect (3xx to an in-app route, with its path) or deny (login / 401 / 403). */
function describe(cell) {
  return cell.outcome + (cell.location ? ` ${cell.location}` : "");
}

function classify(statusCode, locationHeader, baseUrl) {
  if (statusCode >= 200 && statusCode < 300) return { outcome: "allow" };
  if (statusCode === 401 || statusCode === 403) return { outcome: "deny" };
  if (statusCode >= 300 && statusCode < 400) {
    const pathname = locationHeader ? new URL(locationHeader, baseUrl).pathname : "";
    if (pathname === "/login" || pathname === "/unauthorized") return { outcome: "deny", location: pathname };
    return { outcome: "redirect", location: pathname };
  }
  return { outcome: statusCode >= 400 ? "deny" : "unknown" };
}

// The app reads the Supabase SSR session cookie, not an Authorization header.
async function fetchWithSession(baseUrl, route, cookie) {
  const res = await fetch(`${baseUrl}${route}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location") };
}

function sessionCookie(supabaseUrl, session) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const payload = {
    access_token: session.access_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  };
  return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
}

async function main() {
  loadEnvFile(path.join(ROOT, ".env.local"));
  const baseUrl = process.env.BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) {
    console.error("[homewood:verify-rbac] FAIL: BASE_URL not set (e.g. http://127.0.0.1:4310).");
    process.exit(2);
  }
  const url = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");
  const password = requireEnv("HOMEWOOD_LAUNCH_PASSWORD", "PHASE1_DEMO_PASSWORD");
  if (!url || !anonKey || !password) {
    console.error("[homewood:verify-rbac] FAIL: Supabase URL/anon-key/password missing.");
    process.exit(2);
  }

  const failures = [];
  const passes = [];
  let totalCells = 0;

  for (const [role, email] of Object.entries(CANONICAL_ACCOUNTS)) {
    process.stdout.write(`\n[role=${role}] signing in as ${email}\n`);
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signIn, error: sErr } = await client.auth.signInWithPassword({ email, password });
    if (sErr) {
      console.error(`  ! sign-in failed: ${sErr.message}`);
      for (const row of MATRIX) {
        const expected = row.expectations[role];
        failures.push({ role, route: row.route, expected: describe(expected), observed: `sign-in failed: ${sErr.message}` });
        totalCells += 1;
      }
      continue;
    }
    const cookie = signIn.session ? sessionCookie(url, signIn.session) : null;

    for (const row of MATRIX) {
      const expected = row.expectations[role];
      totalCells += 1;
      try {
        const { status, location } = await fetchWithSession(baseUrl, row.route, cookie);
        const cell = classify(status, location, baseUrl);
        const observed = cell.outcome + (cell.location ? ` ${cell.location}` : "");
        const isPass =
          cell.outcome === expected.outcome && (expected.outcome !== "redirect" || cell.location === expected.location);
        if (isPass) {
          passes.push({ role, route: row.route, expected: describe(expected), status, observed });
          process.stdout.write(`  OK   ${describe(expected).padEnd(28)} ${row.route.padEnd(24)} → ${status}\n`);
        } else {
          failures.push({ role, route: row.route, expected: describe(expected), observed: `${status} (${observed})` });
          process.stdout.write(`  FAIL ${describe(expected).padEnd(28)} ${row.route.padEnd(24)} → ${status} (${observed})\n`);
        }
      } catch (err) {
        const msg = err.message || String(err);
        failures.push({ role, route: row.route, expected: describe(expected), observed: `fetch failed: ${msg}` });
        process.stdout.write(`  FAIL ${describe(expected).padEnd(28)} ${row.route.padEnd(24)} → ${msg}\n`);
      }
    }
    await client.auth.signOut().catch(() => {});
  }

  console.log(`\n[homewood:verify-rbac] ${passes.length}/${totalCells} cells matched the matrix`);
  if (failures.length > 0) {
    console.error(`[homewood:verify-rbac] FAIL — ${failures.length} mismatches:`);
    for (const f of failures.slice(0, 30)) {
      console.error(`  - ${f.role.padEnd(14)} ${f.route.padEnd(30)} expected ${f.expected} got ${f.observed}`);
    }
    if (failures.length > 30) console.error(`  ...and ${failures.length - 30} more`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[homewood:verify-rbac] FATAL:", err.message || err);
  process.exit(1);
});
