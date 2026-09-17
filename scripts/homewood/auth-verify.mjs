#!/usr/bin/env node
/**
 * CI gate auth verification.
 *
 * Read-only. Signs in as each account in the CI account map and confirms the
 * session resolves to the expected `app_role`. If `BASE_URL` is set, also
 * fetches that role's canonical landing route with the authenticated token and
 * expects a non-4xx.
 *
 * ## Why this no longer enumerates a facility (COL-443)
 *
 * It used to read every active `user_facility_access` grant at Homewood Lodge
 * and try to sign each one in with `HOMEWOOD_LAUNCH_PASSWORD`. That was right
 * when every Homewood grantee was a seeded persona sharing one demo password.
 * It stopped being right the moment real staff were onboarded: Homewood's
 * grants are now Brian, Charlene Elmore, Darren Webb, Michelle Norris, Jessica
 * Murphy and Milton Smith — real people with their own passwords. The gate
 * would have failed on all of them, and the only ways to make it pass were to
 * hand CI their credentials or to grant CI accounts access to the live launch
 * facility. Both are worse than the gate.
 *
 * So the gate verifies a named list of accounts that exist to be verified, and
 * nothing else. It asserts a property of the CI fixtures — "these logins work
 * and carry the role they claim" — not a property of a facility's roster.
 *
 * ## Why there is no service-role key here
 *
 * Enumerating users required `SUPABASE_SERVICE_ROLE_KEY`. Verifying a known
 * list does not: each account proves its own role by signing in. That removes
 * an RLS-bypassing production key from a CI job, which is worth more than the
 * orphan-grant check it used to perform. Roster integrity belongs in the Data
 * Health panel (COL-361), which is where an operator will actually see it.
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)
 *   HOMEWOOD_LAUNCH_ACCOUNTS   JSON object of role -> email
 *   HOMEWOOD_LAUNCH_PASSWORD   (or PHASE1_DEMO_PASSWORD)
 *
 * Optional env:
 *   BASE_URL                   e.g. http://127.0.0.1:4310 — enables route fetch
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, "docs", "homewood", "AUTH_VERIFICATION.md");

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

function readAccountMap() {
  const raw = requireEnv("HOMEWOOD_LAUNCH_ACCOUNTS");
  if (!raw) {
    console.error("[verify-auth] FAIL: HOMEWOOD_LAUNCH_ACCOUNTS not set.");
    console.error("[verify-auth] Expected JSON mapping role -> email, e.g. {\"owner\":\"ci-owner@haven-ci.test\"}.");
    console.error("[verify-auth] This gate verifies named CI accounts only — never a facility's real roster.");
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`[verify-auth] FAIL: HOMEWOOD_LAUNCH_ACCOUNTS is not valid JSON: ${safeMessage(error)}`);
    process.exit(2);
  }
  const entries = Object.entries(parsed).filter(([, email]) => typeof email === "string" && email.trim());
  if (entries.length === 0) {
    console.error("[verify-auth] FAIL: HOMEWOOD_LAUNCH_ACCOUNTS is empty — nothing to verify.");
    process.exit(2);
  }
  return entries.map(([role, email]) => ({ role, email: email.trim() }));
}

async function main() {
  loadEnvFile(path.join(ROOT, ".env.local"));

  const password = requireEnv("HOMEWOOD_LAUNCH_PASSWORD", "PHASE1_DEMO_PASSWORD");
  if (!password) {
    console.error("[verify-auth] FAIL: HOMEWOOD_LAUNCH_PASSWORD not set. The shared CI password lives in 1Password under 'Haven CI gates'.");
    process.exit(2);
  }

  const url = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    console.error("[verify-auth] FAIL: Supabase URL/anon key missing.");
    process.exit(2);
  }

  const accounts = readAccountMap();
  const baseUrl = process.env.BASE_URL?.replace(/\/$/, "") || null;
  const supabaseHost = new URL(url).host;

  console.log(`[verify-auth] verifying ${accounts.length} CI account(s) against ${supabaseHost}`);

  const results = [];
  for (const account of accounts) {
    const result = {
      ...account,
      signedIn: false,
      roleMatch: false,
      actualRole: null,
      landingRoute: ROLE_LANDING_ROUTES[account.role] ?? null,
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
      console.error(`  FAIL ${account.role.padEnd(16)} ${account.email}: ${result.reason}`);
      continue;
    }
    result.signedIn = true;
    result.actualRole = signIn.user?.app_metadata?.app_role ?? "(none)";
    result.roleMatch = result.actualRole === account.role;

    if (!result.roleMatch) {
      result.reason = `role mismatch (expected '${account.role}', got '${result.actualRole}')`;
      results.push(result);
      console.error(`  FAIL ${account.role.padEnd(16)} ${account.email}: ${result.reason}`);
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
          console.error(`  FAIL ${account.role.padEnd(16)} ${account.email}: ${result.reason}`);
          results.push(result);
          await client.auth.signOut().catch(() => {});
          continue;
        }
      } catch (err) {
        result.routeStatus = "fetch_error";
        result.reason = `landing route fetch failed: ${safeMessage(err)}`;
        console.error(`  FAIL ${account.role.padEnd(16)} ${account.email}: ${result.reason}`);
        results.push(result);
        await client.auth.signOut().catch(() => {});
        continue;
      }
    }

    results.push(result);
    console.log(`  OK   ${account.role.padEnd(16)} ${account.email}${result.routeStatus ? ` (${result.landingRoute} → ${result.routeStatus})` : ""}`);
    await client.auth.signOut().catch(() => {});
  }

  const passed = results.filter(
    (r) => r.signedIn && r.roleMatch && (!r.landingRoute || !baseUrl || (typeof r.routeStatus === "number" && r.routeStatus < 400)),
  );

  const lines = [];
  lines.push("# CI gate — auth verification");
  lines.push("");
  lines.push(`_Generated: \`${new Date().toISOString()}\` against \`${supabaseHost}\`._`);
  lines.push("");
  lines.push("This gate verifies the **named CI accounts** in `HOMEWOOD_LAUNCH_ACCOUNTS` and nothing else.");
  lines.push("It deliberately does not enumerate a facility's grants: Homewood Lodge's grantees are real");
  lines.push("staff with their own passwords, and a gate that tried to sign them in could only pass by");
  lines.push("holding their credentials or by putting test identities on the live launch facility (COL-443).");
  lines.push("");
  lines.push("Roster integrity is the Data Health panel's job (COL-361), not this script's.");
  lines.push("");
  lines.push(`Re-run with \`npm run homewood:verify-auth\`. Set \`BASE_URL\` to additionally fetch each role's landing route.`);
  lines.push("");
  lines.push("## Top-line");
  lines.push("");
  lines.push(`- CI accounts verified: **${passed.length} / ${results.length}**`);
  lines.push(`- Route-fetch mode: ${baseUrl ? "**enabled** (BASE_URL set)" : "skipped (set BASE_URL to enable)"}`);
  lines.push("");
  lines.push("## Per-account detail");
  lines.push("");
  lines.push("| Email | Expected role | Signed in | Role OK | Landing route | Route status | Reason |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of results) {
    lines.push(
      `| ${r.email} | ${r.role} | ${r.signedIn ? "✅" : "❌"} | ${r.roleMatch ? "✅" : "❌"} | ${r.landingRoute ?? "—"} | ${r.routeStatus ?? "—"} | ${(r.reason ?? "").replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");
  lines.push("_Passwords are never logged or written. The shared CI password lives in 1Password under \"Haven CI gates\"._");
  lines.push("");

  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`);
  console.log(`[verify-auth] report written: ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`[verify-auth] result: ${passed.length}/${results.length} accounts passed`);

  process.exit(passed.length === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error("[verify-auth] FATAL:", safeMessage(err));
  process.exit(1);
});
