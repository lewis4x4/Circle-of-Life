#!/usr/bin/env node
/**
 * Homewood Lodge ALF — auth verification (Sprint 2 of Homewood Go-Live).
 *
 * Read-only. For every user with an active `user_facility_access` grant at
 * the Homewood facility, attempt sign-in with `HOMEWOOD_LAUNCH_PASSWORD`.
 * Confirm the session resolves to the expected `app_role`. If `BASE_URL` is
 * set, additionally fetch the role's canonical landing route with the
 * authenticated cookie and expect a 200.
 *
 * Writes `docs/homewood/AUTH_VERIFICATION.md` with per-role + per-account
 * pass/fail. Redacts passwords. Exits non-zero if any account fails.
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY  (to enumerate accounts)
 *   HOMEWOOD_LAUNCH_PASSWORD   (fails loudly if missing — by design)
 *
 * Optional env:
 *   HOMEWOOD_FACILITY_ID       (defaults to 00000000-0000-0000-0002-000000000003)
 *   BASE_URL                   (e.g. http://127.0.0.1:4310 — enables route-fetch)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, "docs", "homewood", "AUTH_VERIFICATION.md");
const DEFAULT_HOMEWOOD_FACILITY_ID = "00000000-0000-0000-0002-000000000003";

const ROLE_LANDING_ROUTES = {
  owner: "/admin/command",
  org_admin: "/admin/command",
  facility_admin: "/admin/command",
  nurse: "/admin/command",
  caregiver: "/caregiver",
  family: "/family",
  med_tech: "/med-tech",
  dietary: "/dietary",
  maintenance_role: "/admin",
  housekeeper: "/caregiver",
  broker: "/admin",
  admin_assistant: "/admin",
  coordinator: "/admin",
};

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

function safeMessage(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  return err.message || err.code || JSON.stringify(err);
}

function todayIso() {
  return new Date().toISOString();
}

async function main() {
  loadEnvFile(path.join(ROOT, ".env.local"));

  const password = requireEnv("HOMEWOOD_LAUNCH_PASSWORD");
  if (!password) {
    console.error("[homewood:verify-auth] FAIL: HOMEWOOD_LAUNCH_PASSWORD not set. Configure repo secret or local .env to verify Homewood accounts.");
    process.exit(2);
  }

  const url = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) {
    console.error("[homewood:verify-auth] FAIL: SUPABASE_URL/ANON/SERVICE keys missing.");
    process.exit(2);
  }

  const facilityId = process.env.HOMEWOOD_FACILITY_ID?.trim() || DEFAULT_HOMEWOOD_FACILITY_ID;
  const baseUrl = process.env.BASE_URL?.replace(/\/$/, "") || null;
  const supabaseHost = new URL(url).host;

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1) Enumerate Homewood-scoped users via user_facility_access.
  const { data: grants, error: gerr } = await admin
    .from("user_facility_access")
    .select("user_id")
    .eq("facility_id", facilityId)
    .is("revoked_at", null);
  if (gerr) {
    console.error(`[homewood:verify-auth] FAIL listing user_facility_access: ${safeMessage(gerr)}`);
    process.exit(1);
  }
  const userIds = [...new Set((grants ?? []).map((g) => g.user_id))];
  console.log(`[homewood:verify-auth] Homewood user_facility_access grants: ${userIds.length}`);

  if (userIds.length === 0) {
    console.warn("[homewood:verify-auth] WARNING: no Homewood-scoped users found. The auth check has nothing to verify.");
  }

  // 2) Look up each user's auth record (email + app_role).
  const { data: authUsersData, error: lerr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (lerr) {
    console.error(`[homewood:verify-auth] FAIL listing auth users: ${safeMessage(lerr)}`);
    process.exit(1);
  }
  const userMap = new Map();
  for (const u of authUsersData?.users ?? []) userMap.set(u.id, u);

  const accounts = userIds
    .map((id) => userMap.get(id))
    .filter(Boolean)
    .map((u) => ({
      id: u.id,
      email: u.email ?? "(no email)",
      expectedRole: u.app_metadata?.app_role ?? "(none)",
      fullName: u.user_metadata?.full_name ?? null,
    }));

  console.log(`[homewood:verify-auth] auth.users matches for grants: ${accounts.length}/${userIds.length}`);

  // 3) For each account, attempt sign-in + role check (+ optional route fetch).
  const results = [];
  for (const account of accounts) {
    const result = {
      ...account,
      signedIn: false,
      roleMatch: false,
      actualRole: null,
      landingRoute: ROLE_LANDING_ROUTES[account.expectedRole] ?? null,
      routeStatus: null,
      reason: null,
    };

    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signIn, error: sErr } = await client.auth.signInWithPassword({
      email: account.email,
      password,
    });
    if (sErr) {
      result.reason = `signInWithPassword: ${safeMessage(sErr)}`;
      results.push(result);
      console.error(`  FAIL ${account.expectedRole.padEnd(16)} ${account.email}: ${result.reason}`);
      continue;
    }
    result.signedIn = true;
    result.actualRole = signIn.user?.app_metadata?.app_role ?? "(none)";
    result.roleMatch = result.actualRole === account.expectedRole;

    if (!result.roleMatch) {
      result.reason = `role mismatch (expected '${account.expectedRole}', got '${result.actualRole}')`;
      results.push(result);
      console.error(`  FAIL ${account.expectedRole.padEnd(16)} ${account.email}: ${result.reason}`);
      await client.auth.signOut().catch(() => {});
      continue;
    }

    if (baseUrl && result.landingRoute) {
      try {
        const access = signIn.session?.access_token;
        const res = await fetch(`${baseUrl}${result.landingRoute}`, {
          headers: access ? { Authorization: `Bearer ${access}` } : {},
          redirect: "manual",
        });
        result.routeStatus = res.status;
        if (res.status >= 400) {
          result.reason = `landing route ${result.landingRoute} returned ${res.status}`;
          console.error(`  FAIL ${account.expectedRole.padEnd(16)} ${account.email}: ${result.reason}`);
          results.push(result);
          await client.auth.signOut().catch(() => {});
          continue;
        }
      } catch (err) {
        result.routeStatus = "fetch_error";
        result.reason = `landing route fetch failed: ${safeMessage(err)}`;
        console.error(`  FAIL ${account.expectedRole.padEnd(16)} ${account.email}: ${result.reason}`);
        results.push(result);
        await client.auth.signOut().catch(() => {});
        continue;
      }
    }

    results.push(result);
    console.log(`  OK   ${account.expectedRole.padEnd(16)} ${account.email}${result.routeStatus ? ` (${result.landingRoute} → ${result.routeStatus})` : ""}`);
    await client.auth.signOut().catch(() => {});
  }

  // 4) Account for grants that don't have a matching auth.users row.
  const missingAuth = userIds.filter((id) => !userMap.has(id));
  for (const id of missingAuth) {
    results.push({
      id,
      email: "(no auth.users row)",
      expectedRole: "(unknown)",
      fullName: null,
      signedIn: false,
      roleMatch: false,
      actualRole: null,
      landingRoute: null,
      routeStatus: null,
      reason: "user_facility_access references a user_id that does not exist in auth.users",
    });
    console.error(`  FAIL <orphan-grant>      user_id=${id}: no auth.users row`);
  }

  const passed = results.filter((r) => r.signedIn && r.roleMatch && (!r.landingRoute || !baseUrl || (typeof r.routeStatus === "number" && r.routeStatus < 400)));
  const expected = results.length;

  // 5) Build per-role summary.
  const roleBuckets = new Map();
  for (const r of results) {
    const list = roleBuckets.get(r.expectedRole) ?? [];
    list.push(r);
    roleBuckets.set(r.expectedRole, list);
  }

  const generatedAt = todayIso();
  const lines = [];
  lines.push(`# Homewood Lodge ALF — Auth Verification`);
  lines.push("");
  lines.push(`_Generated: \`${generatedAt}\` against \`${supabaseHost}\` (facility \`${facilityId}\`)._`);
  lines.push("");
  lines.push(`Re-run with \`npm run homewood:verify-auth\`. Set \`BASE_URL=http://127.0.0.1:4310\` (or your deploy) to additionally fetch each role's landing route.`);
  lines.push("");
  lines.push(`## Top-line`);
  lines.push("");
  lines.push(`- Homewood \`user_facility_access\` grants: **${userIds.length}**`);
  lines.push(`- Accounts with matching \`auth.users\` row: **${accounts.length}**`);
  lines.push(`- Orphan grants (user_id without auth row): **${missingAuth.length}**`);
  lines.push(`- Accounts that authenticate with the configured password and resolve to the expected role: **${passed.length} / ${expected}**`);
  lines.push(`- Route-fetch mode: ${baseUrl ? "**enabled** (BASE_URL set)" : "skipped (set BASE_URL to enable)"}`);
  lines.push("");
  lines.push(`## Per-role summary`);
  lines.push("");
  lines.push("| Role | Accounts | Passed | Failed |");
  lines.push("|---|---:|---:|---:|");
  for (const [role, list] of [...roleBuckets.entries()].sort()) {
    const pass = list.filter((r) => r.signedIn && r.roleMatch && (!r.landingRoute || !baseUrl || (typeof r.routeStatus === "number" && r.routeStatus < 400))).length;
    lines.push(`| ${role} | ${list.length} | ${pass} | ${list.length - pass} |`);
  }
  lines.push("");
  lines.push(`## Per-account detail`);
  lines.push("");
  lines.push("| Email | Expected role | Signed in | Role OK | Landing route | Route status | Reason |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of results) {
    lines.push(
      `| ${r.email} | ${r.expectedRole} | ${r.signedIn ? "✅" : "❌"} | ${r.roleMatch ? "✅" : "❌"} | ${r.landingRoute ?? "—"} | ${r.routeStatus ?? "—"} | ${(r.reason ?? "").replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");
  lines.push(`_Passwords are never logged or written. Sign-in attempts use \`HOMEWOOD_LAUNCH_PASSWORD\` from the environment._`);
  lines.push("");

  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`);
  console.log(`[homewood:verify-auth] report written: ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`[homewood:verify-auth] result: ${passed.length}/${expected} accounts passed`);

  if (passed.length !== expected || expected === 0) {
    if (expected === 0) {
      console.error("[homewood:verify-auth] FAIL: no Homewood accounts present to verify.");
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[homewood:verify-auth] FATAL:", safeMessage(err));
  process.exit(1);
});
