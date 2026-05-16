#!/usr/bin/env node
/**
 * Verify that every account in `canonical-roster.mjs` authenticates
 * against the pilot project using `signInWithPassword` + the canonical
 * password. Fails non-zero on the FIRST account that doesn't authenticate
 * with the expected role — that's the gate the audit infra has been
 * missing.
 *
 * Run locally:  `npm run seed:verify`
 * Run in CI:    same; `.github/workflows/ci-gates.yml` invokes it as
 *               a required check on every PR.
 *
 * Exit codes:
 *   0  every roster account authenticates with its expected role
 *   1  one or more accounts failed (auth error, role mismatch, missing user)
 *   2  environment misconfigured (missing URL / anon key)
 *
 * On failure, the output names every drifted account so the repair
 * (`npm run seed:repair`) can run targeted next.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

import { CANONICAL_PASSWORD, CANONICAL_ROSTER } from "./canonical-roster.mjs";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!(key in process.env)) process.env[key] = rest.join("=");
  }
}
loadEnvFile(ENV_PATH);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[seed:verify] FAIL: NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY required.");
  process.exit(2);
}

const supa = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const failures = [];

console.log(`[seed:verify] checking ${CANONICAL_ROSTER.length} roster accounts against ${new URL(supabaseUrl).host}`);

for (const account of CANONICAL_ROSTER) {
  const { email, appRole } = account;
  const { data, error } = await supa.auth.signInWithPassword({
    email,
    password: CANONICAL_PASSWORD,
  });

  if (error) {
    failures.push({ email, expectedRole: appRole, reason: error.message });
    console.error(`  FAIL  ${appRole.padEnd(16)} ${email}  → ${error.message}`);
    continue;
  }

  const actualRole = data.user?.app_metadata?.app_role ?? "(none)";
  if (actualRole !== appRole) {
    failures.push({
      email,
      expectedRole: appRole,
      reason: `app_role mismatch: expected '${appRole}', got '${actualRole}'`,
    });
    console.error(`  FAIL  ${appRole.padEnd(16)} ${email}  → role drift (got ${actualRole})`);
    continue;
  }

  console.log(`  OK    ${appRole.padEnd(16)} ${email}`);

  // Sign out so the next iteration's session doesn't collide.
  await supa.auth.signOut().catch(() => {});
}

console.log("");
if (failures.length === 0) {
  console.log(`[seed:verify] OK — every roster account (${CANONICAL_ROSTER.length}) authenticates with the expected role.`);
  process.exit(0);
}

console.error(`[seed:verify] FAIL — ${failures.length} of ${CANONICAL_ROSTER.length} roster account(s) drifted:`);
for (const f of failures) {
  console.error(`  - ${f.email} (expected ${f.expectedRole}): ${f.reason}`);
}
console.error("");
console.error("[seed:verify] next steps:");
console.error("  1. Confirm SUPABASE_SERVICE_ROLE_KEY is in .env.local");
console.error("  2. Run `npm run seed:repair` to reset the drifted accounts");
console.error("  3. Re-run `npm run seed:verify` to confirm");
console.error("  4. Add an entry to docs/ui-audit/SEED_DRIFT.md describing what drifted and why");
process.exit(1);
