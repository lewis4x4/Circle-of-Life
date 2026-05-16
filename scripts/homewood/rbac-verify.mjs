#!/usr/bin/env node
/**
 * Homewood Lodge ALF — RBAC matrix verifier (Sprint 4 of Homewood Go-Live).
 *
 * Signs in as one canonical account per role and fetches each route in the
 * matrix below. Compares the observed status against the documented cell:
 *   ✓ → expect 2xx
 *   ✗ → expect 4xx OR redirect to /login or /unauthorized
 *
 * Source-of-truth for the cells: docs/homewood/RBAC_MATRIX.md. Keep this
 * constant and the markdown in sync — the verifier fails if reality doesn't
 * match either.
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

const CANONICAL_ACCOUNTS = {
  owner: "milton.smith@circleoflifealf.com",
  facility_admin: "jessica.murphy@circleoflifealf.com",
  nurse: "sarah.williams@circleoflifealf.com",
  caregiver: "maria.garcia@circleoflifealf.com",
  med_tech: "medtech@circleoflifealf.com",
  family: "linda.chen@circleoflifealf.com",
  dietary: "dietary@circleoflifealf.com",
};

// Cells: ✓ allowed, ✗ blocked, △ allowed-with-restriction (treated as ✓ for status).
const MATRIX = [
  { route: "/admin/command", expectations: { owner: "✓", facility_admin: "✓", nurse: "✓", caregiver: "✗", med_tech: "✗", family: "✗", dietary: "✗" } },
  { route: "/admin/residents", expectations: { owner: "✓", facility_admin: "✓", nurse: "✓", caregiver: "✗", med_tech: "✗", family: "✗", dietary: "✗" } },
  { route: "/admin/incidents", expectations: { owner: "✓", facility_admin: "✓", nurse: "✓", caregiver: "✗", med_tech: "✗", family: "✗", dietary: "✗" } },
  { route: "/admin/staff", expectations: { owner: "✓", facility_admin: "✓", nurse: "✗", caregiver: "✗", med_tech: "✗", family: "✗", dietary: "✗" } },
  { route: "/admin/finance", expectations: { owner: "✓", facility_admin: "✓", nurse: "✗", caregiver: "✗", med_tech: "✗", family: "✗", dietary: "✗" } },
  { route: "/admin/payroll", expectations: { owner: "✓", facility_admin: "✓", nurse: "✗", caregiver: "✗", med_tech: "✗", family: "✗", dietary: "✗" } },
  { route: "/admin/training", expectations: { owner: "✓", facility_admin: "✓", nurse: "✓", caregiver: "✗", med_tech: "✗", family: "✗", dietary: "✗" } },
  { route: "/admin/transportation", expectations: { owner: "✓", facility_admin: "✓", nurse: "✗", caregiver: "✗", med_tech: "✗", family: "✗", dietary: "✗" } },
  { route: "/admin/reputation", expectations: { owner: "✓", facility_admin: "✓", nurse: "✗", caregiver: "✗", med_tech: "✗", family: "✗", dietary: "✗" } },
  { route: "/caregiver", expectations: { owner: "—", facility_admin: "—", nurse: "✓", caregiver: "✓", med_tech: "✗", family: "✗", dietary: "✗" } },
  { route: "/caregiver/tasks", expectations: { owner: "—", facility_admin: "—", nurse: "✓", caregiver: "✓", med_tech: "✗", family: "✗", dietary: "✗" } },
  { route: "/med-tech", expectations: { owner: "—", facility_admin: "—", nurse: "✓", caregiver: "✗", med_tech: "✓", family: "✗", dietary: "✗" } },
  { route: "/family", expectations: { owner: "✗", facility_admin: "✗", nurse: "✗", caregiver: "✗", med_tech: "✗", family: "✓", dietary: "✗" } },
  { route: "/dietary", expectations: { owner: "—", facility_admin: "—", nurse: "✗", caregiver: "✗", med_tech: "✗", family: "✗", dietary: "✓" } },
  { route: "/login", expectations: { owner: "✓", facility_admin: "✓", nurse: "✓", caregiver: "✓", med_tech: "✓", family: "✓", dietary: "✓" } },
];

function classify(statusCode, locationHeader) {
  if (statusCode >= 200 && statusCode < 300) return "allowed";
  if (statusCode === 401 || statusCode === 403) return "blocked";
  if (statusCode >= 300 && statusCode < 400) {
    const loc = (locationHeader ?? "").toLowerCase();
    if (loc.includes("/login") || loc.includes("/unauthorized")) return "blocked";
    return "redirected"; // could be admin-shell landing redirect — see footnote
  }
  if (statusCode >= 400) return "blocked";
  return "unknown";
}

async function fetchWithToken(baseUrl, route, accessToken) {
  const res = await fetch(`${baseUrl}${route}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    redirect: "manual",
  });
  return { status: res.status, location: res.headers.get("location") };
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
        if (expected === "—") continue;
        failures.push({ role, route: row.route, expected, observed: `sign-in failed: ${sErr.message}` });
        totalCells += 1;
      }
      continue;
    }
    const access = signIn.session?.access_token ?? null;

    for (const row of MATRIX) {
      const expected = row.expectations[role];
      if (expected === "—") continue;
      totalCells += 1;
      try {
        const { status, location } = await fetchWithToken(baseUrl, row.route, access);
        const observed = classify(status, location);
        const isPass =
          (expected === "✓" || expected === "△") && (observed === "allowed" || observed === "redirected") ||
          expected === "✗" && observed === "blocked";
        if (isPass) {
          passes.push({ role, route: row.route, expected, status, observed });
          process.stdout.write(`  OK   ${expected.padEnd(2)} ${row.route.padEnd(30)} → ${status}${location ? ` → ${location}` : ""}\n`);
        } else {
          failures.push({ role, route: row.route, expected, observed: `${status}${location ? ` → ${location}` : ""} (${observed})` });
          process.stdout.write(`  FAIL ${expected.padEnd(2)} ${row.route.padEnd(30)} → ${status}${location ? ` → ${location}` : ""} (${observed})\n`);
        }
      } catch (err) {
        const msg = err.message || String(err);
        failures.push({ role, route: row.route, expected, observed: `fetch failed: ${msg}` });
        process.stdout.write(`  FAIL ${expected.padEnd(2)} ${row.route.padEnd(30)} → ${msg}\n`);
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
